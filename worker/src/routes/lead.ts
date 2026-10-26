// The "Request a Consultation" endpoint for the main site (index.html posts
// here via LEAD_API_URL). Moved out of index.ts verbatim when the Worker grew
// a route table — the pipeline below is byte-for-byte what it was, so a diff
// shows a pure move and this money path can't regress behind a refactor.
//
// Deliberately NOT reused by the video-library gate: this handler calls
// markSubmitted(), which writes dup:email/dup:phone keys with a 24h TTL. A
// visitor gated into the video library in the morning would then be silently
// dropped as a duplicate if they submitted a real consultation request that
// afternoon. See routes/library.ts for the gate's own path.
import type { Env } from '../kv';
import { kvPutJSON, uuid } from '../kv';
import { validateLead, type LeadInput } from '../validate';
import { sanitizeLeadFields } from '../sanitize';
import { normalizeName, normalizeEmail, normalizePhoneE164 } from '../normalize';
import { computeSpamScore, SPAM_SCORE_THRESHOLD } from '../spam';
import { checkDuplicate, markSubmitted } from '../dedupe';
import { checkRateLimit } from '../ratelimit';
import { verifyTurnstile } from '../turnstile';
import { canopyConfigured, createProspect, type NormalizedLead } from '../canopy-client';
import { logEvent } from '../audit';
import { jsonResponse, genericError } from '../http';
import { type PendingCanopyItem } from '../queue';

// ===== FILE OVERVIEW (plain English) =====
// Handles POST /lead from the "Request a Consultation" form on index.html.
// Called by the router in index.ts. Order of checks: content type -> size ->
// JSON -> timestamp -> honeypot -> Turnstile -> rate limit -> validation ->
// clean-up -> spam/duplicate check -> send to Canopy (or queue it).
// Edit here to change what happens after the consultation form is sent.
// KV keys written (all in LEADS_KV): "audit:<time>:<id>" (log, via
// logEvent), "rl:<ip>:<window>" (rate limit), "dup:email|phone|name:<value>"
// (duplicate markers, via dedupe.ts), "pending:<id>" (lead waiting for Canopy).

// ===== SETTINGS =====
// Largest request body accepted: 50 KB. Bigger requests get HTTP 413.
const MAX_BODY_BYTES = 50 * 1024;
// The form's timestamp must be within 10 minutes of server time, or the
// submission is rejected as stale/replayed.
const REPLAY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// ===== HANDLER: POST /lead =====
// Inputs: the request, env, caller's origin and allowlist (for CORS headers).
// Returns a JSON response: { ok: true } on success (also for silently
// dropped spam), or { ok: false, error } with 400/413/429.
export async function handleLead(
  request: Request,
  env: Env,
  origin: string | null,
  allowedOrigins: string[]
): Promise<Response> {
  // Only accept JSON bodies (the form sends JSON).
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) return genericError(origin, allowedOrigins);

  // Never trust a client-supplied Content-Length alone — check it as an
  // early rejection, then verify the real body size after reading it.
  const declaredLength = Number(request.headers.get('Content-Length') || '0');
  if (declaredLength > MAX_BODY_BYTES) return jsonResponse({ ok: false, error: 'payload_too_large' }, 413, origin, allowedOrigins);

  const bodyBuf = await request.arrayBuffer();
  if (bodyBuf.byteLength > MAX_BODY_BYTES) return jsonResponse({ ok: false, error: 'payload_too_large' }, 413, origin, allowedOrigins);
  if (bodyBuf.byteLength === 0) return genericError(origin, allowedOrigins);

  // Parse the JSON. Expected shape: { meta: {hp, ts, turnstileToken}, lead: {...form fields} }.
  let payload: { meta?: Record<string, unknown>; lead?: LeadInput };
  try {
    payload = JSON.parse(new TextDecoder().decode(bodyBuf));
  } catch {
    return genericError(origin, allowedOrigins);
  }

  // Pull out the pieces used below. ip = visitor's IP (set by Cloudflare);
  // hp = the hidden honeypot field; ts = when the form was loaded/sent;
  // turnstileToken = proof from the Cloudflare "are you human" widget.
  const meta = payload.meta || {};
  const leadRaw = payload.lead || {};
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const userAgent = request.headers.get('User-Agent');
  const honeypot = String(meta.hp ?? '');
  const clientTs = Number(meta.ts ?? 0);
  const turnstileToken = String(meta.turnstileToken ?? '');

  // ===== SECURITY CHECKS =====
  // Replay/staleness check — independent of Turnstile's own single-use
  // token behavior, since Turnstile may not be configured yet in dev.
  if (clientTs && Math.abs(Date.now() - clientTs) > REPLAY_WINDOW_MS) {
    await logEvent(env.LEADS_KV, { type: 'lead_rejected', reason: 'stale_timestamp', ip });
    return genericError(origin, allowedOrigins);
  }

  // Honeypot: appear to succeed to the bot (don't teach it what tripped
  // the trap) while quietly logging and dropping the submission.
  if (honeypot.trim().length > 0) {
    await logEvent(env.LEADS_KV, { type: 'lead_flagged', reason: 'honeypot_filled', ip });
    return jsonResponse({ ok: true }, 200, origin, allowedOrigins);
  }

  // Turnstile: fail closed once configured. If TURNSTILE_SECRET_KEY isn't
  // set yet (pre-launch/dev), skip with an audit note rather than blocking
  // every submission — this must be configured before real launch; see
  // SETUP-CLOUDFLARE.md.
  if (env.TURNSTILE_SECRET_KEY) {
    const passed = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstileToken, ip);
    if (!passed) {
      await logEvent(env.LEADS_KV, { type: 'lead_rejected', reason: 'turnstile_failed', ip });
      return genericError(origin, allowedOrigins);
    }
  } else {
    await logEvent(env.LEADS_KV, { type: 'warning', reason: 'turnstile_not_configured', ip });
  }

  // Rate limit: SECURITY against floods/bots. Default is 5 submissions per IP
  // per 10 minutes (set in ratelimit.ts). KV key "rl:<ip>:<window>" holds
  // the count. Over the limit -> HTTP 429.
  const rl = await checkRateLimit(env.LEADS_KV, ip);
  if (!rl.allowed) {
    await logEvent(env.LEADS_KV, { type: 'lead_rejected', reason: 'rate_limited', ip });
    return jsonResponse({ ok: false, error: 'rate_limited' }, 429, origin, allowedOrigins);
  }

  // Validation: required fields, formats, lengths (rules live in validate.ts).
  // Failures go back with per-field messages so the form can show them.
  const validation = validateLead(leadRaw);
  if (!validation.valid) {
    return jsonResponse({ ok: false, error: 'validation', fields: validation.errors }, 400, origin, allowedOrigins);
  }

  // ===== CLEAN UP THE DATA =====
  // Strip HTML/unsafe characters (sanitize.ts), then tidy formats: name
  // capitalization, lowercase email, phone in +1XXXXXXXXXX form (normalize.ts).
  const sanitized = sanitizeLeadFields(leadRaw as Record<string, unknown>);
  const normalized: NormalizedLead = {
    firstName: normalizeName(sanitized.firstName),
    lastName: normalizeName(sanitized.lastName),
    email: normalizeEmail(sanitized.email),
    phone: normalizePhoneE164(sanitized.phone),
    businessName: sanitized.businessName || '',
    state: sanitized.state || '',
    serviceNeeded: sanitized.serviceNeeded || '',
    revenue: sanitized.revenue || '',
    preferredContact: sanitized.preferredContact || '',
    bestTimeToCall: sanitized.bestTimeToCall || '',
    message: sanitized.message || '',
    submittedAt: new Date().toISOString(),
  };
  const fullName = `${normalized.firstName} ${normalized.lastName}`;

  // ===== SPAM + DUPLICATE CHECK =====
  // Spam score rules live in spam.ts. Duplicate check (dedupe.ts) looks for
  // KV keys "dup:email:<email>", "dup:phone:<phone>" (24h) and
  // "dup:name:<full name>" (10 min) left by an earlier submission.
  const spamCheck = computeSpamScore({ honeypot, userAgent, email: normalized.email, message: normalized.message });
  const dupCheck = await checkDuplicate(env.LEADS_KV, normalized.email, normalized.phone, fullName);

  // Spammy (score at/over SPAM_SCORE_THRESHOLD in spam.ts) or a duplicate:
  // log it to the audit trail and reply "ok" without saving the lead.
  if (spamCheck.score >= SPAM_SCORE_THRESHOLD || dupCheck.isDuplicate) {
    await logEvent(env.LEADS_KV, {
      type: 'lead_flagged',
      reason: [...spamCheck.reasons, ...dupCheck.reasons].join(','),
      email: normalized.email,
      ip,
      meta: { spamScore: spamCheck.score },
    });
    // Flagged, not deleted — a human can review the audit log — but we
    // don't create a Canopy prospect or count it as a clean lead.
    return jsonResponse({ ok: true }, 200, origin, allowedOrigins);
  }

  // Clean lead: write the "dup:" markers so a repeat within 24h is caught.
  await markSubmitted(env.LEADS_KV, normalized.email, normalized.phone, fullName);

  // ===== DELIVER THE LEAD =====
  // If Canopy credentials are set, try to create the prospect right now.
  if (canopyConfigured(env)) {
    try {
      const { canopyId } = await createProspect(env, normalized);
      await logEvent(env.LEADS_KV, { type: 'canopy_created', email: normalized.email, ip, meta: { canopyId } });
      return jsonResponse({ ok: true }, 200, origin, allowedOrigins);
    } catch (err) {
      await logEvent(env.LEADS_KV, { type: 'canopy_error', email: normalized.email, ip, meta: { error: String(err) } });
      // fall through to the pending queue below — the lead is never lost
    }
  }

  // Canopy not set up yet (or it just failed): save the lead to the queue as
  // "pending:<id>" in LEADS_KV. The cron in index.ts retries it later.
  // This is currently where every consultation lead is stored.
  const item: PendingCanopyItem = {
    id: uuid(),
    lead: normalized,
    attempts: 0,
    nextRetryAt: Date.now(),
    createdAt: Date.now(),
  };
  await kvPutJSON(env.LEADS_KV, `pending:${item.id}`, item);
  await logEvent(env.LEADS_KV, { type: 'canopy_pending', email: normalized.email, ip });

  // Tell the form it worked (it then shows its thank-you message).
  return jsonResponse({ ok: true }, 200, origin, allowedOrigins);
}
