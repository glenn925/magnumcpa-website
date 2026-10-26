// FILE: sanitize.ts
// WEBSITE FEATURE: cleans text typed into the consultation form, the video
// library gate form, and the admin page (video titles, descriptions, category
// names) before it is stored. USED BY: routes/lead.ts, routes/library.ts,
// routes/admin.ts. WHY: stops someone typing HTML/script code into a form field
// and having it show up "live" when staff later view the data.
//
// The real security boundary for injection. Client-side sanitization in
// index.html is UX politeness only — an attacker can always call this Worker
// directly, bypassing the browser entirely, so nothing here may assume the
// client-side pass already ran.

// Invisible "control" characters (except tab, newline and carriage return),
// which have no place in a form answer and can confuse logs or other systems.
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
// Anything that looks like an HTML tag: "<" ... ">". Note this also removes
// innocent text like "a < b > c" (rare in a contact form).
const TAG_RE = /<[^>]*>/g;

// Removes control characters. Input: text. Returns: cleaned text.
export function stripControlChars(s: string): string {
  return s.replace(CONTROL_CHARS_RE, '');
}

// Removes any HTML/script tags outright rather than trying to escape and
// re-render them anywhere — this data only ever needs to be plain text
// (stored in KV, sent to Canopy as a note, or read by staff).
export function stripTags(s: string): string {
  return s.replace(TAG_RE, '');
}

// Converts < > & " ' into safe HTML codes so text displays as text instead of
// being treated as HTML. Input: text. Returns: escaped text.
// (Currently not called anywhere in the Worker; kept for future use.)
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The main cleaner for one value. Input: anything (non-text becomes "").
// Returns: text with control chars and tags removed and spaces trimmed.
export function sanitizeText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return stripTags(stripControlChars(raw)).trim();
}

// Runs sanitizeText on every field of a submitted form. Input: the form object.
// Returns: a new object with the same keys and cleaned text values.
export function sanitizeLeadFields<T extends Record<string, unknown>>(lead: T): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(lead)) {
    out[key] = sanitizeText(lead[key]);
  }
  return out;
}
