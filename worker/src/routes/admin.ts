// Admin API for the video library. Every route below requires a valid bearer
// token except /login itself.
//
// admin.html is served publicly from GitHub Pages and always will be — the
// API is the security boundary, not the page. Do not "hide" the admin page and
// treat that as protection.
import type { Env } from '../kv';
import { logEvent } from '../audit';
import { checkRateLimit } from '../ratelimit';
import { sanitizeText } from '../sanitize';
import { jsonResponse, csvResponse } from '../http';
import { verifyPassword, verifyToken, signToken, newAdminPayload } from '../token';
import { getSettings, getSettingsFresh, putSettings, isKnownCategory, type AppSettings } from '../settings';
import { getVideoListFresh, putVideoList, newVideoId, type Video } from '../videos';
import { normalizeEmbedUrl } from '../videourl';
import { listLeads, leadsToCsv, monthsBetween } from '../leads';
import { getSummary } from '../analytics';

// ===== FILE OVERVIEW (plain English) =====
// Backend for admin.html (the video-library admin panel). index.ts sends
// every /api/admin/... request to handleAdmin() at the bottom of this file.
// Routes (all except login need "Authorization: Bearer <token>"):
//   POST   /api/admin/login         password -> token (8 hours)
//   GET    /api/admin/session       "is my token still valid?"
//   POST   /api/admin/logout        sign out everywhere
//   GET    /api/admin/videos        list videos   | POST: add a video
//   PUT    /api/admin/videos/order  reorder videos
//   PUT    /api/admin/videos/<id>   edit a video  | DELETE: remove a video
//   GET    /api/admin/leads         library leads as JSON
//   GET    /api/admin/leads.csv     library leads as a CSV download
//   GET    /api/admin/analytics     dashboard numbers
//   GET    /api/admin/settings      read settings | PUT: change settings
// KV keys used (LIBRARY_KV): "rla:<ip>:<window>" + "rla:global:<window>"
// (login rate limits), "settings:app", "videos:list", "audit:<time>:<id>".

// ===== LIMITS =====
// Largest admin request body: 32 KB.
const MAX_BODY_BYTES = 32 * 1024;
// Max characters for a video title / description (longer text is cut off).
const MAX_TITLE = 160;
const MAX_DESCRIPTION = 600;
// Max number of videos in the library; adding more returns an error.
const MAX_VIDEOS = 500;

// Per-IP and global login budgets. The global one exists because a single
// shared password is guessable from a botnet, where per-IP limiting never
// triggers — that's the attack per-IP limiting structurally cannot see.
// Per IP: 5 login attempts per 900 seconds (15 min).
const LOGIN_RATE_LIMIT = { prefix: 'rla:', max: 5, windowSeconds: 900 };
// Everyone combined: 20 login attempts per 15 min (counted under id "global").
const LOGIN_GLOBAL_RATE_LIMIT = { prefix: 'rla:', max: 20, windowSeconds: 900 };

// Bundle of things every handler below needs (env + CORS info), passed
// around so each function doesn't need four separate arguments.
type Ctx = { env: Env; origin: string | null; allowed: string[] };

// ===== RESPONSE + BODY HELPERS =====
// ok(): success reply { ok: true, ...body }. err(): failure reply
// { ok: false, error, ...extra } with the given HTTP status.
function ok(ctx: Ctx, body: Record<string, unknown>, status = 200): Response {
  return jsonResponse({ ok: true, ...body }, status, ctx.origin, ctx.allowed);
}
function err(ctx: Ctx, error: string, status: number, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ ok: false, error, ...extra }, status, ctx.origin, ctx.allowed);
}

// Reads and parses the JSON body. Returns null if empty, over 32 KB, or invalid.
async function readJson<T>(request: Request): Promise<T | null> {
  const declared = Number(request.headers.get('Content-Length') || '0');
  if (declared > MAX_BODY_BYTES) return null;
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as T;
  } catch {
    return null;
  }
}

// ===== AUTH CHECKS =====
// True only when both admin secrets are set (via `wrangler secret put`):
// ADMIN_PASSWORD_HASH (the hashed password) and ADMIN_TOKEN_SECRET (signs tokens).
function adminConfigured(env: Env): boolean {
  return !!(env.ADMIN_PASSWORD_HASH && env.ADMIN_TOKEN_SECRET);
}

// Fails CLOSED when the secrets are unset — the deliberate opposite of the
// Turnstile check in routes/lead.ts, which fails open. That asymmetry is the
// point: letting spam through beats blocking every customer, but letting an
// unauthenticated request through is never better than refusing it.
// SECURITY: the token check guarding every admin route. Returns null if the
// request is allowed, or an error Response (401/503) to send back instead.
async function requireAdmin(request: Request, ctx: Ctx): Promise<Response | null> {
  const { env } = ctx;
  if (!adminConfigured(env)) return err(ctx, 'admin_not_configured', 503);

  // Read the token from the "Authorization: Bearer <token>" header.
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return err(ctx, 'unauthorized', 401);

  // Check the token's signature and expiry (token.ts). Forged/expired -> 401.
  const payload = await verifyToken(token, env.ADMIN_TOKEN_SECRET!);
  if (!payload) return err(ctx, 'unauthorized', 401);

  // The token version check is what makes "sign out everywhere" real. Read
  // through the cache: an 8-hour token surviving up to 60 extra seconds after
  // a logout is an acceptable trade for not spending a KV read per request.
  const settings = await getSettings(env);
  if (payload.ver !== settings.adminTokenVersion) return err(ctx, 'unauthorized', 401);

  return null;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
// ===== LOGIN / LOGOUT =====
// POST /api/admin/login. Body: { password }. Returns { token, expiresAt } on
// success. Side effects: rate-limit counters and audit log entries in KV.
async function login(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Secrets not set -> admin is switched off (503).
  if (!adminConfigured(env)) {
    await logEvent(env.LIBRARY_KV, { type: 'admin_login_unconfigured', ip });
    return err(ctx, 'admin_not_configured', 503);
  }

  // SECURITY: brute-force protection. Both the per-IP and the global counter
  // go up on EVERY attempt (right or wrong). Either over its limit -> 429.
  const perIp = await checkRateLimit(env.LIBRARY_KV, ip, LOGIN_RATE_LIMIT);
  const global = await checkRateLimit(env.LIBRARY_KV, 'global', LOGIN_GLOBAL_RATE_LIMIT);
  if (!perIp.allowed || !global.allowed) {
    await logEvent(env.LIBRARY_KV, { type: 'admin_login_rate_limited', ip });
    return err(ctx, 'rate_limited', 429);
  }

  // Compare the submitted password with the stored hash (token.ts).
  const body = await readJson<{ password?: string }>(request);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!password) return err(ctx, 'unauthorized', 401);

  const valid = await verifyPassword(password, env.ADMIN_PASSWORD_HASH!);
  if (!valid) {
    // Logged so a brute-force attempt is visible in the audit trail rather
    // than being invisibly absorbed by the rate limiter.
    await logEvent(env.LIBRARY_KV, { type: 'admin_login_failed', ip });
    return err(ctx, 'unauthorized', 401);
  }

  // Password correct: issue a signed token stamped with the current token
  // version (so "sign out everywhere" can cancel it later).
  const settings = await getSettings(env);
  const payload = newAdminPayload(settings.adminTokenVersion);
  const token = await signToken(payload, env.ADMIN_TOKEN_SECRET!);
  await logEvent(env.LIBRARY_KV, { type: 'admin_login_ok', ip });

  return ok(ctx, { token, expiresAt: payload.exp });
}

// POST /api/admin/logout. Adds 1 to adminTokenVersion in "settings:app",
// which makes every token issued so far invalid (within about 60 seconds).
async function logoutEverywhere(ctx: Ctx): Promise<Response> {
  const settings = await getSettingsFresh(ctx.env);
  await putSettings(ctx.env, { ...settings, adminTokenVersion: settings.adminTokenVersion + 1 });
  return ok(ctx, {});
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------
// ===== VIDEOS =====
// Fields the admin panel may send when adding/editing a video. `rev` is the
// list version the panel last saw; if someone else saved since, we reply 409
// ("stale_rev") instead of overwriting their change. All videos are stored
// together in KV key "videos:list" (see videos.ts).
interface VideoInput {
  title?: string;
  description?: string;
  category?: string;
  embedUrl?: string;
  hidden?: boolean;
  rev?: number;
}

// Cleans a title: strips tags, cuts to MAX_TITLE characters.
function cleanTitle(raw: unknown): string {
  return sanitizeText(raw).slice(0, MAX_TITLE);
}

// sanitizeText strips tags at the boundary; the frontend additionally renders
// every one of these with textContent. Note it does NOT html-escape here —
// escaping on write and rendering as text would show a literal "&amp;" in any
// title containing an ampersand.
function cleanDescription(raw: unknown): string {
  return sanitizeText(raw).slice(0, MAX_DESCRIPTION);
}

// GET /api/admin/videos. Returns ALL videos (including hidden ones), the
// categories and booking link. Reads fresh (uncached) from KV.
async function listVideosAdmin(ctx: Ctx): Promise<Response> {
  const [list, settings] = await Promise.all([getVideoListFresh(ctx.env), getSettings(ctx.env)]);
  return ok(ctx, { rev: list.rev, videos: list.videos, categories: settings.categories, bookUrl: settings.bookUrl });
}

// POST /api/admin/videos. Adds one video. Validates title, link, category,
// then saves the whole list to "videos:list". Returns the new video + list.
async function createVideo(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readJson<VideoInput>(request);
  if (!body) return err(ctx, 'bad_request', 400);

  // Title is required.
  const title = cleanTitle(body.title);
  if (!title) return err(ctx, 'validation', 400, { fields: { title: 'Give the video a title.' } });

  // The video link must be a supported provider (YouTube, Drive, etc. — rules
  // in videourl.ts); it is converted to an embeddable URL.
  const embed = normalizeEmbedUrl(String(body.embedUrl ?? ''));
  if (!embed.ok) return err(ctx, 'validation', 400, { fields: { embedUrl: embed.error } });

  // Category must be one that exists in settings.
  const settings = await getSettings(ctx.env);
  const category = String(body.category ?? '');
  if (!isKnownCategory(settings, category)) {
    return err(ctx, 'validation', 400, { fields: { category: 'Choose a category.' } });
  }

  // Refuse if the list changed since the panel loaded it, or is full.
  const list = await getVideoListFresh(ctx.env);
  if (typeof body.rev === 'number' && body.rev !== list.rev) {
    return err(ctx, 'stale_rev', 409, { rev: list.rev });
  }
  if (list.videos.length >= MAX_VIDEOS) return err(ctx, 'too_many_videos', 400);

  const now = new Date().toISOString();
  const video: Video = {
    id: newVideoId(),
    title,
    description: cleanDescription(body.description),
    category,
    embedUrl: embed.value.embedUrl,
    sourceUrl: embed.value.sourceUrl,
    provider: embed.value.provider,
    hidden: body.hidden === true,
    createdAt: now,
    updatedAt: now,
  };

  // Append the new video at the end and save the list.
  const next = await putVideoList(ctx.env, [...list.videos, video], list.rev);
  return ok(ctx, { video, rev: next.rev, videos: next.videos });
}

// PUT /api/admin/videos/<id>. Edits one video; only fields that were sent are
// changed. Same checks as createVideo. Saves "videos:list".
async function updateVideo(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const body = await readJson<VideoInput>(request);
  if (!body) return err(ctx, 'bad_request', 400);

  const list = await getVideoListFresh(ctx.env);
  if (typeof body.rev === 'number' && body.rev !== list.rev) {
    return err(ctx, 'stale_rev', 409, { rev: list.rev });
  }

  // Find the video by id; 404 if it doesn't exist.
  const idx = list.videos.findIndex(v => v.id === id);
  if (idx === -1) return err(ctx, 'not_found', 404);

  const current = list.videos[idx];
  const settings = await getSettings(ctx.env);
  const updated: Video = { ...current, updatedAt: new Date().toISOString() };

  // Apply each field that was sent, validating it the same way as on create.
  if (body.title !== undefined) {
    const title = cleanTitle(body.title);
    if (!title) return err(ctx, 'validation', 400, { fields: { title: 'Give the video a title.' } });
    updated.title = title;
  }
  if (body.description !== undefined) updated.description = cleanDescription(body.description);
  if (body.category !== undefined) {
    if (!isKnownCategory(settings, String(body.category))) {
      return err(ctx, 'validation', 400, { fields: { category: 'Choose a category.' } });
    }
    updated.category = String(body.category);
  }
  if (body.embedUrl !== undefined) {
    const embed = normalizeEmbedUrl(String(body.embedUrl));
    if (!embed.ok) return err(ctx, 'validation', 400, { fields: { embedUrl: embed.error } });
    updated.embedUrl = embed.value.embedUrl;
    updated.sourceUrl = embed.value.sourceUrl;
    updated.provider = embed.value.provider;
  }
  if (body.hidden !== undefined) updated.hidden = body.hidden === true;

  // Swap the edited video into a copy of the list and save it.
  const videos = list.videos.slice();
  videos[idx] = updated;
  const next = await putVideoList(ctx.env, videos, list.rev);
  return ok(ctx, { video: updated, rev: next.rev, videos: next.videos });
}

// DELETE /api/admin/videos/<id>?rev=<n>. Removes one video and saves the list.
// The rev check only runs if ?rev= is in the URL.
async function deleteVideo(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const url = new URL(request.url);
  const revParam = url.searchParams.get('rev');

  const list = await getVideoListFresh(ctx.env);
  if (revParam !== null && Number(revParam) !== list.rev) {
    return err(ctx, 'stale_rev', 409, { rev: list.rev });
  }
  if (!list.videos.some(v => v.id === id)) return err(ctx, 'not_found', 404);

  const next = await putVideoList(ctx.env, list.videos.filter(v => v.id !== id), list.rev);
  return ok(ctx, { rev: next.rev, videos: next.videos });
}

// Takes the full ordered id array rather than a move delta. The server checks
// it against the current set, so a reorder computed from a stale list is
// rejected outright instead of quietly dropping or duplicating a video.
// PUT /api/admin/videos/order. Body: { ids: [...all ids in new order], rev }.
async function reorderVideos(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readJson<{ ids?: string[]; rev?: number }>(request);
  if (!body || !Array.isArray(body.ids)) return err(ctx, 'bad_request', 400);

  const list = await getVideoListFresh(ctx.env);
  if (typeof body.rev === 'number' && body.rev !== list.rev) {
    return err(ctx, 'stale_rev', 409, { rev: list.rev });
  }

  // The new order must contain exactly the same ids as now: same count,
  // no repeats, none missing or unknown.
  const current = list.videos.map(v => v.id);
  const given = body.ids.map(String);
  const sameSet =
    given.length === current.length &&
    new Set(given).size === given.length &&
    given.every(id => current.includes(id));
  if (!sameSet) return err(ctx, 'stale_rev', 409, { rev: list.rev });

  // Rebuild the list in the new order and save it.
  const byId = new Map(list.videos.map(v => [v.id, v]));
  const next = await putVideoList(ctx.env, given.map(id => byId.get(id)!), list.rev);
  return ok(ctx, { rev: next.rev, videos: next.videos });
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
// ===== LEADS (VIDEO LIBRARY SIGN-UPS) =====
// Reads ?from=&to= dates from the URL. Default (or if invalid): the last
// 365 days ending today. Returns { from, to }.
function rangeFromQuery(url: URL): { from: Date; to: Date } {
  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : new Date();
  const fromParam = url.searchParams.get('from');
  const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - 364 * 86400000);
  const valid = (d: Date) => !Number.isNaN(d.getTime());
  // Bad dates, or "from" after "to": fall back to the last 365 days.
  if (!valid(from) || !valid(to) || from > to) {
    const now = new Date();
    return { from: new Date(now.getTime() - 364 * 86400000), to: now };
  }
  return { from, to };
}

// GET /api/admin/leads?from=&to=&limit=. Returns { total, leads } newest
// first; at most `limit` leads (default 200, max 1000). Reads only.
async function leadsJson(request: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const { from, to } = rangeFromQuery(url);
  const leads = await listLeads(ctx.env, monthsBetween(from, to));
  const limit = Math.min(Number(url.searchParams.get('limit') || 200), 1000);
  return ok(ctx, { total: leads.length, leads: leads.slice(0, limit) });
}

// GET /api/admin/leads.csv?from=&to=. Downloads every lead in the range as a
// CSV file named magnum-video-library-leads-<today>.csv. Reads only.
async function leadsCsv(request: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const { from, to } = rangeFromQuery(url);
  const leads = await listLeads(ctx.env, monthsBetween(from, to));
  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(leadsToCsv(leads), `magnum-video-library-leads-${stamp}.csv`, ctx.origin, ctx.allowed);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
// ===== SETTINGS =====
// PUT /api/admin/settings. Body may include bookUrl, gateTurnstile,
// categories; only fields sent are changed. Saves KV key "settings:app".
async function updateSettings(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readJson<Partial<AppSettings>>(request);
  if (!body) return err(ctx, 'bad_request', 400);

  // Start from the current saved settings (read fresh, not cached).
  const current = await getSettingsFresh(ctx.env);
  const next: AppSettings = { ...current };

  // Booking link ("Book a 10-minute call" button): must be a full https:// URL.
  if (body.bookUrl !== undefined) {
    const raw = String(body.bookUrl).trim();
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return err(ctx, 'validation', 400, { fields: { bookUrl: 'Enter a full https:// link.' } });
    }
    // This value becomes an href on a public page; anything but https is a
    // vector, not a convenience.
    if (parsed.protocol !== 'https:') {
      return err(ctx, 'validation', 400, { fields: { bookUrl: 'The booking link must start with https://' } });
    }
    next.bookUrl = parsed.toString();
  }

  // On/off switch for the Turnstile human check on the library gate form.
  if (body.gateTurnstile !== undefined) next.gateTurnstile = body.gateTurnstile === true;

  // Category list: each slug is lowercased and limited to a-z, 0-9, "-"
  // (max 40 chars); label max 60 chars; order = position in the list.
  // Entries with an empty slug or label are dropped; at least one must remain.
  if (Array.isArray(body.categories)) {
    const cleaned = body.categories
      .map((c, i) => ({
        slug: sanitizeText((c as { slug?: unknown })?.slug).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40),
        label: sanitizeText((c as { label?: unknown })?.label).slice(0, 60),
        order: i,
      }))
      .filter(c => c.slug && c.label);
    if (cleaned.length === 0) {
      return err(ctx, 'validation', 400, { fields: { categories: 'Keep at least one category.' } });
    }
    next.categories = cleaned;
  }

  // Save and return the new settings.
  const saved = await putSettings(ctx.env, next);
  return ok(ctx, { settings: saved });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
// ===== ADMIN ROUTER =====
// Called by index.ts for any /api/admin/... path. Picks the handler by the
// rest of the path + HTTP method. Unknown path -> 404, wrong method -> 405.
export async function handleAdmin(
  request: Request,
  env: Env,
  origin: string | null,
  allowed: string[],
  pathname: string
): Promise<Response> {
  const ctx: Ctx = { env, origin, allowed };
  const method = request.method;
  // pathname arrives as /api/admin/<rest>
  const rest = pathname.replace(/^\/api\/admin\/?/, '');

  // Login is the only route reachable WITHOUT a token.
  if (rest === 'login') {
    if (method !== 'POST') return err(ctx, 'method_not_allowed', 405);
    return login(request, ctx);
  }

  // SECURITY: every route below this line requires a valid admin token.
  const denied = await requireAdmin(request, ctx);
  if (denied) return denied;

  // "session" just confirms the token is still good (the panel calls it on load).
  if (rest === 'session') return ok(ctx, {});
  if (rest === 'logout') {
    if (method !== 'POST') return err(ctx, 'method_not_allowed', 405);
    return logoutEverywhere(ctx);
  }

  // Video list: GET = list, POST = add.
  if (rest === 'videos') {
    if (method === 'GET') return listVideosAdmin(ctx);
    if (method === 'POST') return createVideo(request, ctx);
    return err(ctx, 'method_not_allowed', 405);
  }

  // Checked before the /videos/{id} pattern below — "order" is a route, not an id.
  if (rest === 'videos/order') {
    if (method !== 'PUT') return err(ctx, 'method_not_allowed', 405);
    return reorderVideos(request, ctx);
  }

  // One video by id: PUT = edit, DELETE = remove.
  if (rest.startsWith('videos/')) {
    const id = rest.slice('videos/'.length);
    if (!id || id.includes('/')) return err(ctx, 'not_found', 404);
    if (method === 'PUT') return updateVideo(request, ctx, id);
    if (method === 'DELETE') return deleteVideo(request, ctx, id);
    return err(ctx, 'method_not_allowed', 405);
  }

  // Library leads as JSON (table) or CSV (download). GET only.
  if (rest === 'leads') {
    if (method !== 'GET') return err(ctx, 'method_not_allowed', 405);
    return leadsJson(request, ctx);
  }
  if (rest === 'leads.csv') {
    if (method !== 'GET') return err(ctx, 'method_not_allowed', 405);
    return leadsCsv(request, ctx);
  }

  // Dashboard numbers. ?days=N (default 30, clamped to 1-90 in analytics.ts).
  if (rest === 'analytics') {
    if (method !== 'GET') return err(ctx, 'method_not_allowed', 405);
    const days = Number(new URL(request.url).searchParams.get('days') || 30);
    const summary = await getSummary(env, Number.isFinite(days) ? days : 30);
    const list = await getVideoListFresh(env);
    // Titles are joined here rather than in the browser so the dashboard can
    // label a play count even after the video itself has been deleted.
    const titles: Record<string, string> = {};
    for (const v of list.videos) titles[v.id] = v.title;
    return ok(ctx, { summary, videoTitles: titles });
  }

  // Settings: GET = read (fresh), PUT = change.
  if (rest === 'settings') {
    if (method === 'GET') return ok(ctx, { settings: await getSettingsFresh(env) });
    if (method === 'PUT') return updateSettings(request, ctx);
    return err(ctx, 'method_not_allowed', 405);
  }

  // No admin route matched.
  return err(ctx, 'not_found', 404);
}
