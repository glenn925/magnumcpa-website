// FILE: dedupe.ts
// WEBSITE FEATURE: stops the same person sending the "Request a Consultation"
// form over and over (double-clicks, impatient resubmits, bots). A repeat is
// flagged in the audit log instead of creating a second lead.
// USED BY: routes/lead.ts only (the video library gate uses its own "vldup:" marker).
// Data: LEADS_KV keys "dup:email:...", "dup:phone:...", "dup:name:...".
import { kvGetJSON, kvPutJSON } from './kv';

// How long the same email or phone counts as a duplicate (24 hours). Shorten
// it if real clients need to resubmit sooner; lengthen to block repeats longer.
const EMAIL_PHONE_WINDOW_SECONDS = 60 * 60 * 24; // 24h: same email/phone re-submitting
// How long the same full name counts as a duplicate. Kept short because two
// different people can share a name.
const NAME_WINDOW_SECONDS = 60 * 10;             // 10min: same name in a short burst

// isDuplicate = true if any check matched; reasons lists which ones.
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reasons: string[];
}

// Checks whether this email, phone or name was submitted recently.
// Inputs: KV namespace, normalized email/phone, full name. Returns:
// DuplicateCheckResult. Read-only (markSubmitted does the recording).
export async function checkDuplicate(
  kv: KVNamespace,
  email: string,
  phone: string,
  fullName: string
): Promise<DuplicateCheckResult> {
  const reasons: string[] = [];

  if (await kvGetJSON(kv, `dup:email:${email}`)) reasons.push('duplicate_email');
  if (await kvGetJSON(kv, `dup:phone:${phone}`)) reasons.push('duplicate_phone');
  if (await kvGetJSON(kv, `dup:name:${fullName.toLowerCase()}`)) reasons.push('duplicate_name_recent');

  return { isDuplicate: reasons.length > 0, reasons };
}

// Records an accepted lead so later repeats are caught. Inputs: same as above.
// SIDE EFFECT: writes three short-lived KV keys (they expire on their own).
export async function markSubmitted(kv: KVNamespace, email: string, phone: string, fullName: string): Promise<void> {
  await Promise.all([
    kvPutJSON(kv, `dup:email:${email}`, { at: Date.now() }, EMAIL_PHONE_WINDOW_SECONDS),
    kvPutJSON(kv, `dup:phone:${phone}`, { at: Date.now() }, EMAIL_PHONE_WINDOW_SECONDS),
    kvPutJSON(kv, `dup:name:${fullName.toLowerCase()}`, { at: Date.now() }, NAME_WINDOW_SECONDS),
  ]);
}
