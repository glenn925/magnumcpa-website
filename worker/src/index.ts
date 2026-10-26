// Router. Two features share this Worker:
//   /lead      — the main site's "Request a Consultation" form (routes/lead.ts)
//   /api/*     — the gated video library and its admin panel (routes/library.ts,
//                routes/admin.ts)
//
// They share a Worker so the library can reuse the lead pipeline's hardened
// modules (validate/sanitize/normalize/ratelimit/audit) rather than growing a
// second, drifting copy of each. The cost is a shared deploy: a bug in library
// code ships alongside the live lead form. Two mitigations, both deliberate —
// the /lead handler was moved out verbatim (a diff shows a pure move), and
// every handler runs inside the try/catch below, so an exception in library
// code returns a 500 for that one request instead of taking /lead down.
import type { Env } from './kv';
import { kvGetJSON, kvPutJSON, kvListPrefix } from './kv';
import { canopyConfigured, createProspect } from './canopy-client';
import { logEvent } from './audit';
import { jsonResponse, corsPreflight } from './http';
import { handleLead } from './routes/lead';
import { handleGate, handleVideos, handleTrack } from './routes/library';
import { handleAdmin } from './routes/admin';
import { getVideoListFresh } from './videos';
import { rollupAnalytics } from './analytics';
import { drainLibraryQueue } from './library-delivery';
import { MAX_CANOPY_ATTEMPTS, BASE_RETRY_DELAY_MS, type PendingCanopyItem } from './queue';

// ===== FILE OVERVIEW (plain English) =====
// This is the Worker's front door. Cloudflare calls `fetch` for every web
// request and `scheduled` on the cron timer (every 15 minutes, set in
// wrangler.toml). This file only decides WHICH handler runs; the real work
// lives in routes/lead.ts, routes/library.ts, routes/admin.ts.
// Routes handled:
//   POST /lead                 -> handleLead   (consultation form on index.html)
//   GET  /api/videos           -> handleVideos (video list for the library page)
//   POST /api/library/access   -> handleGate   (library sign-up/gate form)
//   POST /api/track            -> handleTrack  (play/click analytics beacon)
//   *    /api/admin/...        -> handleAdmin  (admin.html panel; see routes/admin.ts)
//   OPTIONS (any path)         -> corsPreflight (browser CORS pre-check)
// Two KV storage buckets are used: LEADS_KV (consultation form) and
// LIBRARY_KV (video library, its leads, analytics, settings).

// ===== ROUTER =====
export default {
  // Runs once per incoming HTTP request. Input: the request + env (secrets,
  // KV bindings). Returns the HTTP response sent back to the browser.
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // The website address the browser says it is calling from (e.g.
    // https://magnumcpa.com). Used only to decide the CORS response header.
    const origin = request.headers.get('Origin');
    // ALLOWED_ORIGINS comes from wrangler.toml [vars], comma-separated. Add a
    // new domain there if a new site needs to call this Worker from a browser.
    // SECURITY: only these origins get CORS approval, so other websites' pages
    // can't read responses. (Non-browser tools can still send requests.)
    const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

    // Browsers send an OPTIONS "preflight" before some cross-site requests;
    // answer it with the allowed methods/headers and stop.
    if (request.method === 'OPTIONS') return corsPreflight(url.pathname, origin, allowedOrigins);

    // Every route runs inside this try so a crash in one returns a 500 for
    // that request only (see the catch block at the bottom).
    try {
      // Consultation form ("Request a Consultation" on index.html). POST only.
      if (url.pathname === '/lead') {
        if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, origin, allowedOrigins);
        return await handleLead(request, env, origin, allowedOrigins);
      }

      // Public video catalogue for the library page. GET only.
      if (url.pathname === '/api/videos') {
        if (request.method !== 'GET') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, origin, allowedOrigins);
        return await handleVideos(env, origin, allowedOrigins);
      }

      // Video-library gate form (name/email/phone before watching). POST only.
      if (url.pathname === '/api/library/access') {
        if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, origin, allowedOrigins);
        return await handleGate(request, env, origin, allowedOrigins);
      }

      // Analytics beacon from the library page (video plays, filter clicks,
      // "book a call" clicks). POST only.
      if (url.pathname === '/api/track') {
        if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, origin, allowedOrigins);
        return await handleTrack(request, env, origin, allowedOrigins);
      }

      // Everything under /api/admin/ goes to the admin sub-router, which does
      // its own method checks and password/token checks (routes/admin.ts).
      if (url.pathname.startsWith('/api/admin/')) {
        return await handleAdmin(request, env, origin, allowedOrigins, url.pathname);
      }

      // No route matched: reply 404 Not Found.
      return jsonResponse({ ok: false, error: 'not_found' }, 404, origin, allowedOrigins);
    } catch (err) {
      // A thrown handler must never surface a stack trace to the caller or
      // take down the sibling route. Log it and return an opaque 500.
      await logEvent(env.LEADS_KV, {
        type: 'worker_error',
        reason: String(err),
        meta: { path: url.pathname, method: request.method },
      });
      return jsonResponse({ ok: false, error: 'server_error' }, 500, origin, allowedOrigins);
    }
  },

  // ===== SCHEDULED JOBS (CRON) =====
  // Cron Trigger (see wrangler.toml). Three jobs, each isolated: the video
  // library's rollup and delivery queue must never be able to prevent the
  // consultation queue from flushing, or vice versa.
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    // 1. Fold raw analytics events into daily/monthly counters. The cron is
    //    the ONLY writer of stats:* documents, which is what removes the
    //    read-modify-write race on every counter.
    try {
      // Build a video-id -> category lookup so plays can also be counted
      // per category ("top categories" on the admin dashboard).
      const videos = await getVideoListFresh(env);
      const categoryById = new Map(videos.videos.map(v => [v.id, v.category]));
      await rollupAnalytics(env, id => categoryById.get(id));
    } catch (err) {
      await logEvent(env.LIBRARY_KV, { type: 'analytics_rollup_error', reason: String(err) });
    }

    // 2. Retry any video-library lead delivery that failed (webhook/Canopy).
    try {
      await drainLibraryQueue(env);
    } catch (err) {
      await logEvent(env.LIBRARY_KV, { type: 'library_queue_error', reason: String(err) });
    }

    // 3. Flush the main site's pending-Canopy queue once real credentials
    //    exist. A no-op scan (cheap) while Canopy is unconfigured. Unchanged.
    await flushCanopyQueue(env);
  },
};

// ===== CONSULTATION QUEUE FLUSH =====
// Retries sending saved consultation-form leads to Canopy (the CRM).
// Input: env. Returns nothing. Side effects: reads/deletes/rewrites
// LEADS_KV "pending:<id>" keys, writes "deadletter:<id>", calls Canopy's API,
// writes audit log entries. Called only by the cron above.
async function flushCanopyQueue(env: Env): Promise<void> {
  // Canopy credentials not set yet -> leave every lead parked in the queue.
  if (!canopyConfigured(env)) return;

  // KV key "pending:<id>" (LEADS_KV) = one consultation lead waiting to be
  // sent to Canopy, with its attempt count and next retry time.
  // Note: this reads only the first 1000 pending keys per cron run.
  const list = await kvListPrefix(env.LEADS_KV, 'pending:');
  const now = Date.now();

  // Walk every queued lead and try to send the ones whose retry time is due.
  for (const key of list.keys) {
    const item = await kvGetJSON<PendingCanopyItem>(env.LEADS_KV, key.name);
    // Skip if the key vanished or it isn't time to retry this one yet.
    if (!item || item.nextRetryAt > now) continue;

    try {
      // Success: create the prospect in Canopy, remove it from the queue, log it.
      const { canopyId } = await createProspect(env, item.lead);
      await env.LEADS_KV.delete(key.name);
      await logEvent(env.LEADS_KV, { type: 'canopy_created', email: item.lead.email, meta: { canopyId, fromQueue: true } });
    } catch (err) {
      const attempts = item.attempts + 1;
      // Too many failures (MAX_CANOPY_ATTEMPTS, in queue.ts): give up retrying
      // and move it to "deadletter:<id>" — a permanent record (no expiry) of
      // a lead that never reached Canopy, kept for a human to handle.
      if (attempts >= MAX_CANOPY_ATTEMPTS) {
        await kvPutJSON(env.LEADS_KV, `deadletter:${item.id}`, { ...item, lastError: String(err) });
        await env.LEADS_KV.delete(key.name);
        await logEvent(env.LEADS_KV, { type: 'canopy_deadletter', email: item.lead.email, meta: { attempts } });
      } else {
        // Otherwise wait longer each time (exponential backoff: 5 min base,
        // doubling per attempt) and save the updated item back to the queue.
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempts);
        await kvPutJSON(env.LEADS_KV, key.name, { ...item, attempts, nextRetryAt: now + delay });
      }
    }
  }
}
