// FILE: test/units.test.ts
// HOW TO RUN: open a terminal in the worker/ folder and type `npm test`.
// Every line should say "ok"; any "not ok" means something is broken — fix it
// before deploying with `npx wrangler deploy`. Run it after editing any file in src/.
// These tests run on your computer only; they never touch the live site or KV.
//
// Unit tests for the pure modules — the ones with real logic and no KV.
//
// Run with:  npm test   (Node 24 strips the TypeScript natively, no build step)
//
// These four are where a silent bug would be most expensive: a broken embed
// URL renders a blank iframe, a broken CSV escape is a security hole, and a
// broken token check is an auth bypass.
// Node's built-in test runner and assertion helpers (no extra packages needed).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// The functions under test, imported straight from the Worker's source files.
import { normalizeEmbedUrl } from '../src/videourl.ts';
import { csvCell, toCsv } from '../src/csv.ts';
import { hashPassword, verifyPassword, signToken, verifyToken, newAdminPayload, randomSecretB64 } from '../src/token.ts';
import { validateGateLead } from '../src/validate.ts';
import { bucketReferrer, parseEventKey, isSafeTarget } from '../src/analytics-core.ts';

// VIDEO LINKS (src/videourl.ts). Protects against: pasted video links showing a
// blank player, and dangerous links (javascript:, unknown sites) being embedded.
describe('videourl', () => {
  // The most common paste: a normal YouTube page link.
  test('converts a YouTube watch URL to an embed URL', () => {
    const r = normalizeEmbedUrl('https://www.youtube.com/watch?v=8ZnrVnLpm-o&t=42s');
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.value.embedUrl, 'https://www.youtube.com/embed/8ZnrVnLpm-o?rel=0');
    assert.equal(r.ok && r.value.provider, 'youtube');
    // sourceUrl is what "View original" links to — it must stay the public post.
    assert.equal(r.ok && r.value.sourceUrl, 'https://www.youtube.com/watch?v=8ZnrVnLpm-o');
  });

  // Short share links and YouTube Shorts must give the same embed URL.
  test('handles youtu.be and /shorts/', () => {
    for (const url of ['https://youtu.be/8ZnrVnLpm-o', 'https://www.youtube.com/shorts/8ZnrVnLpm-o']) {
      const r = normalizeEmbedUrl(url);
      assert.equal(r.ok && r.value.embedUrl, 'https://www.youtube.com/embed/8ZnrVnLpm-o?rel=0', url);
    }
  });

  // Drive "share" links render blank unless turned into /preview links.
  test('converts a Google Drive share link to /preview', () => {
    const r = normalizeEmbedUrl('https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view?usp=sharing');
    assert.equal(r.ok && r.value.embedUrl, 'https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/preview');
    assert.equal(r.ok && r.value.provider, 'drive');
  });

  // Editing a video re-sends its saved embed URL; it must come back unchanged.
  test('is idempotent — re-submitting a stored embed URL is stable', () => {
    const once = normalizeEmbedUrl('https://www.youtube.com/watch?v=8ZnrVnLpm-o');
    assert.equal(once.ok, true);
    const twice = normalizeEmbedUrl(once.ok ? once.value.embedUrl : '');
    assert.equal(twice.ok && twice.value.embedUrl, once.ok && once.value.embedUrl);
  });

  // Security: script links, plain http, unknown hosts and junk must be refused.
  test('rejects dangerous and unsupported URLs', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://www.youtube.com/watch?v=8ZnrVnLpm-o', // not https
      'https://evil.example.com/video.mp4',
      'not a url',
      '',
    ]) {
      assert.equal(normalizeEmbedUrl(bad).ok, false, `should reject: ${bad}`);
    }
  });
});

// LEAD EXPORT (src/csv.ts). Protects against: a visitor typing an Excel formula
// as their name that runs when the export is opened, and garbled/broken CSV files.
describe('csv', () => {
  // Security: anything starting = + - @ that could be a formula gets a ' prefix.
  test('neutralises formula injection', () => {
    assert.equal(csvCell('=HYPERLINK("http://evil","x")'), '"\'=HYPERLINK(""http://evil"",""x"")"');
    assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
    // No comma or double-quote in this one, so it needs the formula guard but
    // not RFC-4180 quoting.
    assert.equal(csvCell('=cmd|\' /c calc\'!A0'), '\'=cmd|\' /c calc\'!A0');
  });

  // The guard must not uglify ordinary phone numbers like +15551234567.
  test('leaves phone numbers and negative numbers readable', () => {
    // A leading + or - only matters if it can form a real formula; these can't,
    // so they must not be disfigured with a stray apostrophe in every row.
    assert.equal(csvCell('+15551234567'), '+15551234567');
    assert.equal(csvCell('-42'), '-42');
    assert.equal(csvCell('(555) 123-4567'), '(555) 123-4567');
  });

  // Commas and quotes inside a value must not split it into extra columns.
  test('quotes per RFC 4180', () => {
    assert.equal(csvCell('O\'Brien, Jr'), '"O\'Brien, Jr"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell(null), '');
  });

  // Accented names must open correctly in Excel (needs the BOM marker).
  test('emits a UTF-8 BOM and CRLF line endings', () => {
    const csv = toCsv(['A', 'B'], [['1', 'Ünïcødé']]);
    assert.equal(csv.charCodeAt(0), 0xfeff, 'missing BOM — Excel would mangle non-ASCII');
    assert.match(csv, /\r\n/);
    assert.match(csv, /Ünïcødé/);
  });
});

// ADMIN LOGIN (src/token.ts). Protects against: wrong passwords getting in,
// forged or edited login tokens, and expired logins still working.
describe('token', () => {
  // Basic login check. Also pins the iteration count at 100000 — update this
  // test if PBKDF2_ITERATIONS in token.ts is ever changed.
  test('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.match(hash, /^pbkdf2\$100000\$/);
    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
    assert.equal(await verifyPassword('wrong', hash), false);
  });

  // A random salt must be used, so identical passwords give different hashes.
  test('salts — the same password hashes differently every time', async () => {
    assert.notEqual(await hashPassword('same'), await hashPassword('same'));
  });

  // A broken or weakened stored hash must never let anyone in.
  test('refuses a malformed or work-factor-stripped hash', async () => {
    for (const bad of ['', 'plaintext', 'pbkdf2$1$c2FsdA==$aGFzaA==', 'md5$100000$a$b', 'pbkdf2$100000$a']) {
      assert.equal(await verifyPassword('anything', bad), false, `should reject: ${bad}`);
    }
  });

  // A token the Worker signs must be accepted by the Worker.
  test('round-trips a signed token', async () => {
    const secret = randomSecretB64();
    const token = await signToken(newAdminPayload(7), secret);
    const payload = await verifyToken(token, secret);
    assert.equal(payload?.scope, 'admin');
    assert.equal(payload?.ver, 7);
  });

  // Security: any edit to a token, or a token signed with another key, fails.
  test('rejects a tampered payload, a bad signature and the wrong secret', async () => {
    const secret = randomSecretB64();
    const token = await signToken(newAdminPayload(1), secret);
    const [v, payload, sig] = token.split('.');

    assert.equal(await verifyToken(token.slice(0, -1) + 'A', secret), null, 'tampered signature');
    assert.equal(await verifyToken(`${v}.${btoa('{"scope":"admin","exp":99999999999,"ver":1}')}.${sig}`, secret), null, 'swapped payload');
    assert.equal(await verifyToken(token, randomSecretB64()), null, 'wrong secret');
    assert.equal(await verifyToken('garbage', secret), null);
  });

  // A correctly signed but expired token must be refused.
  test('rejects an expired token', async () => {
    const secret = randomSecretB64();
    const expired = await signToken(
      { scope: 'admin', iat: 1000, exp: 2000, jti: 'x', ver: 1 },
      secret
    );
    assert.equal(await verifyToken(expired, secret), null);
  });
});

// VIDEO LIBRARY SIGN-UP FORM (src/validate.ts). Protects against: real visitors
// being wrongly rejected, bad data being accepted, and odd input crashing the Worker.
describe('validateGateLead', () => {
  // A normal, complete sign-up must pass.
  test('accepts the four gate fields without serviceNeeded', () => {
    const r = validateGateLead({ firstName: 'Dana', lastName: 'Whitfield', email: 'd@example.com', phone: '(555) 246-8100' });
    assert.equal(r.valid, true);
  });

  // Missing last name, bad email and bad phone must each get an error message.
  test('flags missing and malformed fields', () => {
    const r = validateGateLead({ firstName: 'Dana', email: 'not-an-email', phone: '12' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.lastName);
    assert.ok(r.errors.email);
    assert.ok(r.errors.phone);
  });

  // Numbers/objects instead of text must be rejected politely, not crash.
  test('coerces non-string input instead of throwing', () => {
    // The Worker parses arbitrary JSON; a direct API call can send anything.
    assert.doesNotThrow(() => validateGateLead({ firstName: 42, email: {}, phone: [] } as never));
  });
});

// VIDEO LIBRARY STATS (src/analytics-core.ts). Protects against: visitors
// stuffing junk into the stats storage keys, and the 15-minute stats rollup
// miscounting or crashing on unexpected keys.
describe('analytics', () => {
  // "Where did visitors come from" must be one of a few fixed labels.
  test('buckets referrers to a fixed set', () => {
    assert.equal(bucketReferrer('https://app.canopytax.com/portal/x'), 'canopy');
    assert.equal(bucketReferrer('https://www.google.com/search?q=cpa'), 'google');
    assert.equal(bucketReferrer(''), 'direct');
    assert.equal(bucketReferrer('not a url'), 'other');
    // The key-space guard: an arbitrary host must collapse to 'other'.
    assert.equal(bucketReferrer('https://attacker-controlled-domain.test/'), 'other');
  });

  // The rollup must read good event keys and skip anything malformed.
  test('parses well-formed event keys and rejects junk', () => {
    const p = parseEventKey('ev:1988160:play:abc-123:uuid-here');
    assert.deepEqual(p, { bucket: 1988160, type: 'play', target: 'abc-123' });
    assert.equal(parseEventKey('ev:1988160:play:abc-123'), null, 'too few segments');
    assert.equal(parseEventKey('ev:notanumber:play:a:b'), null);
    assert.equal(parseEventKey('lead:2026-09:x:y:z'), null);
    assert.equal(parseEventKey('ev:1:bogustype:a:b'), null);
  });

  // Video ids used in keys may only contain safe characters, max 64 long.
  test('only allows key-safe targets', () => {
    assert.equal(isSafeTarget('abc-123_XY'), true);
    assert.equal(isSafeTarget('has:colon'), false, 'a colon would corrupt the key structure');
    assert.equal(isSafeTarget(''), false);
    assert.equal(isSafeTarget('x'.repeat(65)), false);
  });
});
