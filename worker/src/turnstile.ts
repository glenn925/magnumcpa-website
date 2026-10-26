// FILE: turnstile.ts
// WEBSITE FEATURE: the "I am human" check (Cloudflare Turnstile widget) on the
// consultation form and the video library gate form.
// USED BY: routes/lead.ts and routes/library.ts.
// WHY: the widget in the browser only produces a one-time token; a bot could
// send a fake one. This file asks Cloudflare whether the token is genuine.
// Needs the TURNSTILE_SECRET_KEY secret (see wrangler.toml).
//
// Cloudflare's Turnstile siteverify endpoint — this one IS a stable,
// documented Cloudflare API (unlike the Canopy endpoints elsewhere in this
// project, which are placeholders). https://developers.cloudflare.com/turnstile/
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Asks Cloudflare if a Turnstile token is valid. Inputs: secret key, the token
// the form sent, the visitor's IP. Returns: true only if Cloudflare says
// success. SIDE EFFECT: one network call to Cloudflare. Never throws.
export async function verifyTurnstile(secretKey: string, token: string, remoteIp: string): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: secretKey, response: token, remoteip: remoteIp });
    const resp = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    const data = await resp.json() as { success?: boolean };
    return data.success === true;
  } catch {
    // Network/parse failure — fail closed (treat as not verified) rather
    // than silently letting an unverifiable request through.
    return false;
  }
}
