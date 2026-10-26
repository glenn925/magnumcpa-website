// FILE: token.ts
// WEBSITE FEATURE: the admin login for the gated video library (the page where
// Glenn adds/edits/reorders videos). USED BY: routes/admin.ts (login, "sign out
// everywhere", and checking the token on every admin request). TESTED IN:
// test/units.test.ts ("token" group). Run `npm test` after changing anything here.
//
// Admin credential handling for the video library.
//
// Explicitly NOT the pattern used by the main site's admin-login.html, which
// compares a plaintext password in client-side JS — that file is publicly
// served, so the password is readable by anyone who views source. Here the
// password never reaches the browser, the Worker stores only a PBKDF2 digest,
// and the browser holds a short-lived HMAC-signed token instead.
//
// Everything below is pure (no KV, no env beyond the secret strings), which
// makes it directly unit-testable — see the tests in the Video Library repo.

// How many times the password is re-hashed when creating a NEW hash. Higher =
// slower for an attacker to guess passwords, but slower logins too. Do NOT go
// above 100,000: Cloudflare Workers refuses larger PBKDF2 counts. (Tests expect 100000.)
const PBKDF2_ITERATIONS = 100_000;
// Length of the password digest in bits (256 = 32 bytes). Changing this makes
// every existing ADMIN_PASSWORD_HASH stop working (verifyPassword checks the length).
const PBKDF2_BITS = 256;
// Prefix written on every admin token ("v1.xxx.yyy"). Changing it logs everyone out.
const TOKEN_VERSION = 'v1';
// How long an admin stays logged in after entering the password. Shorter = safer
// if a laptop is left open; longer = fewer re-logins. Applies to newly issued tokens.
const TOKEN_TTL_SECONDS = 8 * 60 * 60; // 8 hours, no refresh — re-login

// The data sealed inside an admin token. The browser can read it but cannot
// change it without breaking the signature.
export interface AdminTokenPayload {
  // Always 'admin' — tokens with any other scope are rejected.
  scope: 'admin';
  iat: number;   // epoch seconds
  exp: number;   // epoch seconds
  // A random unique id for this token (not currently tracked anywhere).
  jti: string;
  ver: number;   // settings.adminTokenVersion at issue time
}

// Shared text <-> bytes converters (the crypto functions only work on bytes).
const enc = new TextEncoder();
const dec = new TextDecoder();

// Turns raw bytes into normal base64 text (used for the stored password hash).
// Input: bytes. Returns: base64 string. No side effects.
function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// The reverse of bytesToB64: base64 text back into bytes.
// Throws if the text is not valid base64 — callers wrap it in try/catch.
function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// "URL-safe" base64 (no + / or = characters) so tokens can travel in headers
// and URLs without being mangled. Input: bytes. Returns: base64url string.
function b64urlFromBytes(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The reverse of b64urlFromBytes: restores + / and the = padding, then decodes.
// Throws on garbage input — callers wrap it in try/catch.
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return b64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

// Compares two digests without leaking their contents through timing. Both
// values are HMAC'd under a key generated fresh for this single comparison,
// so even though the final loop isn't itself constant-time, an attacker can't
// use its timing to learn anything about the inputs — they'd have to predict
// a random key first. Preferred over Cloudflare's timingSafeEqual, which
// throws on a length mismatch (a trap: the throw is itself an oracle).
// In plain terms: a normal "==" check stops at the first wrong byte, and a
// patient attacker could time that to guess the hash byte by byte.
// Inputs: two byte arrays. Returns: true if identical. No side effects.
async function timingSafeEqual(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  const blindKey = await crypto.subtle.importKey(
    'raw',
    crypto.getRandomValues(new Uint8Array(32)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const [ma, mb] = await Promise.all([
    crypto.subtle.sign('HMAC', blindKey, a),
    crypto.subtle.sign('HMAC', blindKey, b),
  ]);
  const va = new Uint8Array(ma);
  const vb = new Uint8Array(mb);
  let diff = va.length ^ vb.length;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// Runs PBKDF2: the deliberately slow password-hashing function. Slowness is the
// point — it makes guessing millions of passwords impractical if a hash leaks.
// Inputs: password, random salt, iteration count. Returns: the 32-byte digest.
async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    PBKDF2_BITS
  );
  return new Uint8Array(bits);
}

// Format: pbkdf2$<iterations>$<saltB64>$<hashB64>
// Self-describing so the iteration count can be raised later without
// invalidating existing hashes.
// Input: the plain password. Returns: the string to store as the
// ADMIN_PASSWORD_HASH secret. Not called by the live Worker — used by tests and
// the hash-password helper script when (re)setting the admin password.
export async function hashPassword(password: string): Promise<string> {
  // A random "salt" makes the same password hash differently every time, so
  // pre-computed tables of common-password hashes are useless.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

// Checks a typed password against the stored ADMIN_PASSWORD_HASH.
// Inputs: password from the login form, stored hash. Returns: true/false.
// Never throws — any malformed stored hash simply means "wrong password".
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // Split "pbkdf2$<iterations>$<salt>$<hash>" into its four pieces.
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number(parts[1]);
  // Reject an absurdly low iteration count outright: a stored hash is
  // attacker-influenced input if the secret store is ever mis-set, and
  // honouring `pbkdf2$1$...` would silently disable the work factor.
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 5_000_000) return false;

  // Decode the salt and expected digest; bad base64 means a broken hash -> reject.
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = b64ToBytes(parts[2]);
    expected = b64ToBytes(parts[3]);
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== PBKDF2_BITS / 8) return false;

  // Re-hash the typed password the same way and compare without timing leaks.
  const actual = await deriveBits(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

// Turns the ADMIN_TOKEN_SECRET (base64 text) into a key the crypto API can use
// for signing/verifying tokens. Throws if the secret is not valid base64.
async function hmacKey(secretB64: string, usages: Array<'sign' | 'verify'>): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    b64ToBytes(secretB64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
}

// Current time as whole seconds since 1970 (the unit used inside tokens).
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// Token: v1.<base64url(payload JSON)>.<base64url(HMAC-SHA256 of the payload string)>
//
// The MAC covers the exact base64url payload *string*, never a re-serialized
// object — so verification can't be broken by JSON key ordering or by any
// difference between how two runtimes stringify the same value.
// WHY SIGN: the signature proves the Worker issued this token. Anyone who edits
// the payload (e.g. pushes `exp` into the future) breaks the signature.
// Inputs: payload + ADMIN_TOKEN_SECRET. Returns: the token string sent to the browser.
export async function signToken(payload: AdminTokenPayload, secretB64: string): Promise<string> {
  const payloadB64 = b64urlFromBytes(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secretB64, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  return `${TOKEN_VERSION}.${payloadB64}.${b64urlFromBytes(new Uint8Array(sig))}`;
}

// Builds the payload for a fresh login: issued now, expires TOKEN_TTL_SECONDS
// later. Input: current settings.adminTokenVersion. Returns: the payload (unsigned).
export function newAdminPayload(tokenVersion: number): AdminTokenPayload {
  const iat = nowSeconds();
  return {
    scope: 'admin',
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID(),
    ver: tokenVersion,
  };
}

// Returns the payload only if the signature is valid AND the token hasn't
// expired. The caller still has to check `ver` against current settings —
// that's the "sign out everywhere" check, and it needs a KV read this pure
// module deliberately doesn't do.
// Inputs: token from the browser + ADMIN_TOKEN_SECRET. Returns: payload or null.
export async function verifyToken(token: string, secretB64: string): Promise<AdminTokenPayload | null> {
  // Must look like "v1.<payload>.<signature>".
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;

  const payloadB64 = parts[1];
  let sig: Uint8Array;
  try {
    sig = b64urlToBytes(parts[2]);
  } catch {
    return null;
  }

  let valid: boolean;
  try {
    const key = await hmacKey(secretB64, ['verify']);
    // crypto.subtle.verify is constant-time by implementation, so no
    // hand-rolled comparison is needed on this hot path.
    valid = await crypto.subtle.verify('HMAC', key, sig, enc.encode(payloadB64));
  } catch {
    return null; // malformed secret
  }
  if (!valid) return null;

  // Only now that the signature is proven do we trust and decode the payload.
  let payload: AdminTokenPayload;
  try {
    payload = JSON.parse(dec.decode(b64urlToBytes(payloadB64)));
  } catch {
    return null;
  }

  // Sanity checks: right scope, not expired, and has a version number.
  if (payload?.scope !== 'admin') return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds()) return null;
  if (typeof payload.ver !== 'number') return null;

  return payload;
}

// Convenience for generating ADMIN_TOKEN_SECRET.
// Returns 32 random bytes as base64. Changing the real secret logs every admin out.
export function randomSecretB64(): string {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
}
