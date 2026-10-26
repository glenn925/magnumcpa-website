// FILE: normalize.ts
// WEBSITE FEATURE: tidies up names, emails and phone numbers from the
// consultation form and the video library gate form so leads look consistent
// (and duplicates match). Runs AFTER validate.ts and sanitize.ts.
// USED BY: routes/lead.ts and routes/library.ts.
//
// Capitalizes each word and squashes extra spaces: "  jOHN   smith" -> "John Smith".
// Input: a name. Returns: the tidied name. Caution: also turns "McDonald" into
// "Mcdonald" and "DeShawn" into "Deshawn".
export function normalizeName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

// Lowercases and trims an email so "Bob@X.com " and "bob@x.com" count as the same.
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// US/Canada-only NANP normalization to E.164 (+1XXXXXXXXXX). Good enough for
// a US-focused CPA firm's contact form; a full international phone library
// would be overkill here and isn't justified by the spec's "US phone number
// format" requirement.
// Input: phone as typed. Returns: "+1" + 10 digits, or the original text if it
// isn't a 10- or 11-digit US number.
export function normalizePhoneE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return raw.trim(); // already failed validate.ts's format check if malformed
}
