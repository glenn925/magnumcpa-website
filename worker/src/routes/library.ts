// Public endpoints for the gated video library:
//   POST /api/library/access   the gate form
//   GET  /api/videos           the catalogue
//   POST /api/track            the analytics beacon
import type { Env } from '../kv';
import { validateGateLead, type GateLeadInput } from '../validate';
import { sanitizeLeadFields, sanitizeText } from '../sanitize';
import { normalizeName, normalizeEmail, normalizePhoneE164 } from '../normalize';
import { computeSpamScore, SPAM_SCORE_THRESHOLD } from '../spam';
import { checkRateLimit } from '../ratelimit';
import { verifyTurnstile } from '../turnstile';
import { logEvent } from '../audit';
import { jsonResponse, genericError, noContent } from '../http';
import { getSettings } from '../settings';
import { getVideoList, toPublicVideo } from '../videos';
import { markAndCheckRepeat, newLeadId, type LibraryLead } from '../leads';
import { deliverLead } from '../library-delivery';
import { bucketReferrer, recordEvent, isSafeTarget, type EventType } from '../analytics';

// ===== FILE OVERVIEW (plain English) =====
// Powers the public VIDEO LIBRARY page (not the admin panel). Called by the
// router in index.ts. Edit here to change the gate form's checks, what the
// catalogue returns, or which analytics events are accepted.
// KV keys written (all in LIBRARY_KV): "audit:<time>:<id>" (log),
// "rlg:<ip>:<window>" (gate rate limit), "vldup:email:<email>" (repeat
// visitor marker), "lead:..." / "leadidx:..." (via library-delivery.ts),
// "ev:..." (analytics events, via analytics.ts).

// ===== SETTINGS =====
// Largest gate-form body accepted: 16 KB.
const MAX_BODY_BYTES = 16 * 1024;
// Form timestamp must be within 10 minutes of server time (anti-replay).
const REPLAY_WINDOW_MS = 10 * 60 * 1000;
// A gate is retried more often than a consultation form — a typo in a phone
// number shouldn't lock someone out of watching a video — so this is looser
// than the lead form's 5, and counted under its own prefix so the two can
// never exhaust each other.
// 10 tries per IP per 600 seconds (10 min). Counter key: "rlg:<ip>:<window>".
const GATE_RATE_LIMIT = { prefix: 'rlg:', max: 10, windowSeconds: 600 };

// ===== HELPER: READ JSON BODY =====
// Reads and parses the request body. Returns null if it's empty, larger than
// maxBytes (SECURITY: size cap), or not valid JSON.
async function readJson(request: Request, maxBytes: number): Promise<unknown | null> {
  const declared = Number(request.headers.get('Content-Length') || '0');
  if (declared > maxBytes) return null;
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/videos
//
// Public on purpose. The gate is lead capture, not access control: every
// embedUrl points at a public YouTube/Drive/social post, and any client-side
// "hasAccess" flag can be set from the console in two seconds. Pretending
// otherwise would add a token check that stops nobody while implying a
// guarantee this design does not make.
// ---------------------------------------------------------------------------
// ===== HANDLER: GET /api/videos =====
// Returns the visible videos, the category buttons (with counts), and the
// "book a call" link. Reads KV only (videos:list, settings:app); no writes.
export async function handleVideos(env: Env, origin: string | null, allowed: string[]): Promise<Response> {
  const [list, settings] = await Promise.all([getVideoList(env), getSettings(env)]);
  // Videos marked "hidden" in the admin panel are left out.
  const visible = list.videos.filter(v => !v.hidden);

  // Count how many visible videos are in each category.
  const counts = new Map<string, number>();
  for (const v of visible) counts.set(v.category, (counts.get(v.category) || 0) + 1);

  // Category buttons in the admin-chosen order, skipping empty categories.
  const categories = settings.categories
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(c => ({ slug: c.slug, label: c.label, count: counts.get(c.slug) || 0 }))
    .filter(c => c.count > 0);

  return jsonResponse(
    {
      ok: true,
      rev: list.rev,
      bookUrl: settings.bookUrl,
      categories,
      videos: visible.map(toPublicVideo),
    },
    200,
    origin,
    allowed,
    // Short public cache; the admin's own view always reads fresh.
    { 'Cache-Control': 'public, max-age=60' }
  );
}

// ---------------------------------------------------------------------------
// POST /api/library/access
// ---------------------------------------------------------------------------
// ===== HANDLER: POST /api/library/access (THE GATE FORM) =====
// The name/email/phone form a visitor fills in before watching videos.
// Returns { ok: true } so the page unlocks; 400/429 on rejection.
// Side effects: saves the lead, forwards it (webhook/Canopy), logs, counts it.
export async function handleGate(
  request: Request,
  env: Env,
  origin: string | null,
  allowed: string[]
): Promise<Response> {
  // Only accept JSON bodies.
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) return genericError(origin, allowed);

  // Read + parse the body (16 KB cap). Bad or oversized -> generic error.
  const payload = (await readJson(request, MAX_BODY_BYTES)) as
    | { meta?: Record<string, unknown>; lead?: GateLeadInput }
    | null;
  if (!payload) return genericError(origin, allowed);

  // Same fields as the consultation form: hp = hidden honeypot, ts = form
  // timestamp, turnstileToken = Cloudflare human check; ip from Cloudflare.
  const meta = payload.meta || {};
  const leadRaw = payload.lead || {};
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const userAgent = request.headers.get('User-Agent');
  const honeypot = String(meta.hp ?? '');
  const clientTs = Number(meta.ts ?? 0);
  const turnstileToken = String(meta.turnstileToken ?? '');

  // ===== SECURITY CHECKS =====
  // Stale/replayed submission: timestamp more than 10 min off -> reject.
  // (Skipped if the page sent no timestamp.)
  if (clientTs && Math.abs(Date.now() - clientTs) > REPLAY_WINDOW_MS) {
    await logEvent(env.LIBRARY_KV, { type: 'gate_rejected', reason: 'stale_timestamp', ip });
    return genericError(origin, allowed);
  }

  // Same trick as the consultation form: let the bot believe it worked.
  if (honeypot.trim().length > 0) {
    await logEvent(env.LIBRARY_KV, { type: 'gate_flagged', reason: 'honeypot_filled', ip });
    return jsonResponse({ ok: true }, 200, origin, allowed);
  }

  // Turnstile (Cloudflare's "are you human" check) blocks bots. Runs only if
  // the admin setting "gateTurnstile" is on AND the secret key is set;
  // otherwise it is skipped silently.
  const settings = await getSettings(env);
  if (settings.gateTurnstile && env.TURNSTILE_SECRET_KEY) {
    const passed = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstileToken, ip);
    if (!passed) {
      await logEvent(env.LIBRARY_KV, { type: 'gate_rejected', reason: 'turnstile_failed', ip });
      return genericError(origin, allowed);
    }
  }

  // Rate limit per IP (GATE_RATE_LIMIT above). Over the limit -> HTTP 429.
  const rl = await checkRateLimit(env.LIBRARY_KV, ip, GATE_RATE_LIMIT);
  if (!rl.allowed) {
    await logEvent(env.LIBRARY_KV, { type: 'gate_rejected', reason: 'rate_limited', ip });
    return jsonResponse({ ok: false, error: 'rate_limited' }, 429, origin, allowed);
  }

  // Validation: name/email/phone rules live in validate.ts (validateGateLead).
  const validation = validateGateLead(leadRaw);
  if (!validation.valid) {
    return jsonResponse({ ok: false, error: 'validation', fields: validation.errors }, 400, origin, allowed);
  }

  // ===== CLEAN UP + BUILD THE LEAD =====
  // Strip tags/control characters, then lowercase/tidy the email.
  const sanitized = sanitizeLeadFields(leadRaw as Record<string, unknown>);
  const email = normalizeEmail(sanitized.email);

  // Spam is flagged, never blocked. Someone who just handed over their name,
  // email and phone has earned the videos; a false positive that shows them a
  // blank page is a worse outcome than one junk row in the CSV.
  const spam = computeSpamScore({ honeypot, userAgent, email, message: '' });
  const isRepeat = await markAndCheckRepeat(env, email);
  const referrerRaw = sanitizeText(meta.referrer).slice(0, 500);

  // The record that gets saved (see LibraryLead in leads.ts). Text fields are
  // cut to fixed lengths (500/200/300 chars) so nobody can store huge values.
  const lead: LibraryLead = {
    id: newLeadId(),
    firstName: normalizeName(sanitized.firstName),
    lastName: normalizeName(sanitized.lastName),
    email,
    phone: normalizePhoneE164(sanitized.phone),
    source: bucketReferrer(referrerRaw),
    referrer: referrerRaw,
    landingPath: sanitizeText(meta.landingPath).slice(0, 200),
    isRepeat,
    userAgent: (userAgent || '').slice(0, 300),
    submittedAt: new Date().toISOString(),
  };

  // Looks like spam: log it and reply ok (visitor still sees videos), but
  // the lead is NOT saved or forwarded.
  if (spam.score >= SPAM_SCORE_THRESHOLD) {
    await logEvent(env.LIBRARY_KV, {
      type: 'gate_flagged',
      reason: spam.reasons.join(','),
      email,
      ip,
      meta: { spamScore: spam.score },
    });
    return jsonResponse({ ok: true, flagged: true }, 200, origin, allowed);
  }

  // ===== SAVE + FORWARD =====
  // Save the lead and send it to webhook/Canopy (library-delivery.ts).
  await deliverLead(env, lead);
  // Counted server-side, not by a beacon — a number Glenn makes decisions on
  // should not be something a visitor's browser can decline to report.
  await recordEvent(env, 'lead', lead.source);
  await logEvent(env.LIBRARY_KV, { type: 'gate_accepted', email, ip, meta: { source: lead.source, isRepeat } });

  return jsonResponse({ ok: true }, 200, origin, allowed);
}

// ---------------------------------------------------------------------------
// POST /api/track
//
// Must stay a CORS-*simple* request (text/plain, no custom headers) because
// navigator.sendBeacon cannot set headers and cannot perform a preflight.
// Asking for application/json here would silently break every beacon sent
// during page unload.
// ---------------------------------------------------------------------------
// ===== HANDLER: POST /api/track (ANALYTICS BEACON) =====
// Body: { e: [{ t: 'play'|'filter'|'cta', id: '<target>' }, ...] }.
// Always returns 204. Side effect: one "ev:..." KV write per accepted event.
export async function handleTrack(
  request: Request,
  env: Env,
  origin: string | null,
  allowed: string[]
): Promise<Response> {
  // SECURITY: size cap — ignore empty bodies or anything over 2 KB.
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > 2048) return noContent(origin, allowed);

  // Parse JSON; ignore anything that isn't valid JSON.
  let body: { e?: Array<{ t?: string; id?: string }> };
  try {
    body = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return noContent(origin, allowed);
  }

  // Accept at most 20 events per beacon; extra ones are ignored.
  const events = Array.isArray(body.e) ? body.e.slice(0, 20) : [];
  if (events.length === 0) return noContent(origin, allowed);

  // Validate every target against the real catalogue and category list.
  // Without this, anyone could mint unlimited KV keys by POSTing junk ids.
  const [list, settings] = await Promise.all([getVideoList(env), getSettings(env)]);
  const videoIds = new Set(list.videos.map(v => v.id));
  const categorySlugs = new Set(settings.categories.map(c => c.slug));

  // Record each event only if it names something real: a known video id
  // (play), a known category (filter), or the "book10" button (cta).
  for (const ev of events) {
    const type = ev.t as EventType;
    const target = String(ev.id ?? '');
    if (!isSafeTarget(target)) continue;

    if (type === 'play' && videoIds.has(target)) {
      await recordEvent(env, 'play', target);
    } else if (type === 'filter' && categorySlugs.has(target)) {
      await recordEvent(env, 'filter', target);
    } else if (type === 'cta' && target === 'book10') {
      await recordEvent(env, 'cta', target);
    }
  }

  // Always 204, even for rejected events — the beacon has nothing useful to do
  // with an error, and a detailed response would only help someone probing
  // which ids exist.
  return noContent(origin, allowed);
}
