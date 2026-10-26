// FILE: ratelimit.ts
// WEBSITE FEATURE: limits how many times one visitor (by IP address) can submit
// the consultation form, the video library gate form, or try the admin password
// in a time window — slows down bots and password guessing.
// USED BY: routes/lead.ts (uses the defaults below), routes/library.ts
// (GATE_RATE_LIMIT: 10 per 10 min) and routes/admin.ts (LOGIN_RATE_LIMIT).
// Those other limits are set in the route files, not here.
import { kvGetJSON, kvPutJSON } from './kv';

// DEFAULT limit (the consultation form): 5 submissions per IP per 10 minutes.
// Raise MAX_PER_WINDOW if real clients get "too many requests"; lower it to be
// stricter. WINDOW_SECONDS must stay at least 60 (Cloudflare KV's minimum expiry).
const WINDOW_SECONDS = 60 * 10; // 10-minute fixed window
const MAX_PER_WINDOW = 5;

// What is stored in KV for each visitor + time window.
interface Counter { count: number }

// Optional overrides a caller can pass instead of the defaults above.
export interface RateLimitOptions {
  prefix?: string;        // key namespace, so callers don't share a counter
  max?: number;
  windowSeconds?: number;
}

// KV reads/writes aren't atomic, so under truly concurrent requests from the
// same IP within the same window this can under-count by a request or two.
// That's an acceptable trade-off for a low-volume contact form — it's not a
// substitute for Cloudflare's own zone-level Rate Limiting Rules once the
// domain is proxied through Cloudflare (see SETUP-CLOUDFLARE.md), just a
// working baseline that functions today on *.workers.dev with no DNS change.
//
// The defaults reproduce the original 2-argument behaviour exactly (`rl:{ip}:
// {bucket}`, 5 per 10 min), so routes/lead.ts's existing call is unchanged.
// `prefix` exists so a new caller gets its own counter: admin login attempts
// must not be able to exhaust the consultation form's budget, and vice versa.
// Inputs: KV namespace, the visitor id (usually IP), options. Returns:
// { allowed, count }. SIDE EFFECT: counts this attempt in KV (even if blocked).
export async function checkRateLimit(
  kv: KVNamespace,
  id: string,
  opts: RateLimitOptions = {}
): Promise<{ allowed: boolean; count: number }> {
  const windowSeconds = opts.windowSeconds ?? WINDOW_SECONDS;
  const max = opts.max ?? MAX_PER_WINDOW;
  const prefix = opts.prefix ?? 'rl:';

  // Which time window we're in (a number that ticks up every windowSeconds).
  // The counter key includes it, so each new window starts again at zero.
  const windowBucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `${prefix}${id}:${windowBucket}`;
  // Read the count, add one, save it back (auto-deleted after the window).
  const existing = await kvGetJSON<Counter>(kv, key);
  const count = (existing?.count ?? 0) + 1;
  await kvPutJSON(kv, key, { count }, windowSeconds);
  return { allowed: count <= max, count };
}
