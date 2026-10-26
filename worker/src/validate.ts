// FILE: validate.ts
// WEBSITE FEATURE: checks the "Request a Consultation" form and the video
// library sign-up (gate) form for missing or badly formatted answers. The
// messages returned here are shown next to the form fields on the website.
// USED BY: routes/lead.ts (validateLead) and routes/library.ts (validateGateLead).
// TESTED IN: test/units.test.ts ("validateGateLead").
//
// The fields the consultation form sends. All optional here because the
// browser (or an attacker) might leave any of them out; validateLead decides.
export interface LeadInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  businessName?: string;
  state?: string;
  serviceNeeded?: string;
  revenue?: string;
  preferredContact?: string;
  bestTimeToCall?: string;
  message?: string;
}

// valid = true when there are no errors; errors maps field name -> message.
export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

// Exported so the video-library gate validator below reuses the exact same
// patterns. Two copies of a phone regex in one codebase will drift, and the
// two forms would then disagree about which phone numbers are valid.
// Email check: deliberately loose — "something@something.something" with no
// spaces. Stricter rules tend to reject real addresses.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts common US formats: (555) 555-5555, 555-555-5555, 555.555.5555, 5555555555, +1 555 555 5555
export const US_PHONE_RE = /^\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;

// Consultation-form fields that must be filled in. Add/remove a field name here
// to make it required/optional (keep the website form's "required" marks in sync).
const REQUIRED_FIELDS: (keyof LeadInput)[] = ['firstName', 'lastName', 'email', 'phone', 'serviceNeeded'];
// Longest allowed "message" box text, in characters. Longer -> "Message is too long."
const MAX_MESSAGE_LEN = 2000;
// Longest allowed value for every other text field (names, business, state...).
const MAX_TEXT_LEN = 200;

// This parses arbitrary, untrusted JSON — the declared `LeadInput` type is
// only a compile-time hint, not a runtime guarantee. A direct API call could
// send a number/object/array for any field, so every value must be coerced
// to a string defensively before calling .trim()/.test() on it, rather than
// trusting the type and risking an uncaught exception on malformed input.
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// Checks a consultation-form submission. Input: the raw submitted fields.
// Returns: { valid, errors }. No side effects. Note: only checks — cleaning up
// (sanitize.ts) and reformatting (normalize.ts) happen afterwards in routes/lead.ts.
export function validateLead(lead: LeadInput): ValidationResult {
  const errors: Record<string, string> = {};

  // 1. Required fields must not be blank.
  for (const field of REQUIRED_FIELDS) {
    const v = asString(lead[field]).trim();
    if (!v) errors[field] = 'This field is required.';
  }

  // 2. Email and phone must look right (only checked if something was typed).
  const email = asString(lead.email).trim();
  if (email && !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';

  const phone = asString(lead.phone).trim();
  if (phone && !US_PHONE_RE.test(phone)) errors.phone = 'Enter a valid US phone number.';

  // 3. Length limits (stops someone pasting huge text into storage / Canopy).
  if (asString(lead.message).length > MAX_MESSAGE_LEN) errors.message = 'Message is too long.';
  for (const field of ['firstName', 'lastName', 'businessName', 'state', 'serviceNeeded', 'revenue', 'preferredContact', 'bestTimeToCall'] as const) {
    if (asString(lead[field]).length > MAX_TEXT_LEN) errors[field] = 'Value is too long.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// The video-library gate asks for four fields, not five — there is no
// "service needed" question on it, and adding a synthetic value just to
// satisfy validateLead() would push a made-up answer into Canopy. Same
// coercion discipline and same regexes as above; different required set.
export interface GateLeadInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

// Gate-form fields that must be filled in (all four).
const GATE_REQUIRED_FIELDS: (keyof GateLeadInput)[] = ['firstName', 'lastName', 'email', 'phone'];

// Checks a video-library gate submission. Input: the raw submitted fields.
// Returns: { valid, errors }. No side effects. Same steps as validateLead:
// required -> email/phone format -> length limits (MAX_TEXT_LEN).
export function validateGateLead(lead: GateLeadInput): ValidationResult {
  const errors: Record<string, string> = {};

  for (const field of GATE_REQUIRED_FIELDS) {
    const v = asString(lead[field]).trim();
    if (!v) errors[field] = 'This field is required.';
  }

  const email = asString(lead.email).trim();
  if (email && !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';

  const phone = asString(lead.phone).trim();
  if (phone && !US_PHONE_RE.test(phone)) errors.phone = 'Enter a valid US phone number.';

  for (const field of GATE_REQUIRED_FIELDS) {
    if (asString(lead[field]).length > MAX_TEXT_LEN) errors[field] = 'Value is too long.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
