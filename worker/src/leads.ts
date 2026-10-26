// Storage for leads captured by the video-library gate.
//
// Two representations, deliberately:
//
//   lead:{YYYY-MM}:{iso}:{uuid}  canonical, WRITE-ONCE. Never read-modify-
//                                written, so two visitors submitting at the
//                                same instant can never overwrite each other.
//                                Losing a lead is the one unacceptable failure
//                                here, so the authoritative copy gets the
//                                storage pattern that cannot lose one.
//   leadidx:{YYYY-MM}            a derived cache holding the same records in
//                                one document, so the admin panel can read a
//                                month of leads in ONE subrequest instead of
//                                one per lead.
//
// The index is read-modify-written and therefore CAN drop an entry under
// concurrent submissions. That's tolerable precisely because it is a cache:
// reconcile() compares it against a key listing (which costs one subrequest
// per 1000 keys and no reads) and repairs any gap by fetching only the
// canonical records that are actually missing — normally none.
//
// This matters because the Workers free plan allows 50 subrequests per
// request. Reading leads one key at a time would cap the admin panel at ~45
// leads and make a full CSV export impossible.
import type { Env } from './kv';
import { kvGetJSON, kvPutJSON, kvListAll, uuid } from './kv';
import { toCsv } from './csv';

// ===== FILE OVERVIEW (plain English) =====
// Saves and reads the people who filled in the VIDEO LIBRARY gate form (not
// the consultation form — those live in LEADS_KV, see routes/lead.ts).
// Called by library-delivery.ts (saving) and routes/admin.ts (the admin
// panel's Leads table and CSV download). All data is in LIBRARY_KV.

// ===== SETTINGS =====
// How long each saved library lead is kept: 400 days. After that KV deletes
// it automatically. Raise this (or remove the TTL) to keep leads longer.
const LEAD_TTL_SECONDS = 60 * 60 * 24 * 400;
// How long the "seen this email before" marker lasts: 30 days. A visitor
// returning within 30 days is flagged "Returning Visitor: Yes".
const REPEAT_MARKER_TTL_SECONDS = 60 * 60 * 24 * 30;
// Max missing leads fetched one-by-one to repair the monthly index per request.
const MAX_RECONCILE_FETCHES = 25; // stay well inside the subrequest budget

// The shape of one saved library lead (one row in the admin Leads table/CSV).
export interface LibraryLead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;       // bucketed referrer, e.g. 'canopy'
  referrer: string;     // raw referrer, truncated
  landingPath: string;
  isRepeat: boolean;
  userAgent: string;
  submittedAt: string;  // ISO
}

// ===== KEY HELPERS =====
// Turns an ISO date like "2026-10-26T14:00:00Z" into its month, "2026-10".
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

// Builds the KV key for one lead: "lead:<YYYY-MM>:<iso time>:<id>".
// That key holds the full LibraryLead record (the permanent copy).
function leadKey(lead: LibraryLead): string {
  // ISO timestamp in the key name makes a prefix listing chronological for
  // free — no sorting pass, no separate time index.
  return `lead:${monthOf(lead.submittedAt)}:${lead.submittedAt}:${lead.id}`;
}

// Returns a fresh random unique id for a new lead.
export function newLeadId(): string {
  return uuid();
}

// Marks that this email has been seen before, and reports whether it had.
// Unlike LEADS_KV's dup: keys, this NEVER causes a rejection — a returning
// visitor still gets the library. It only annotates the record.
// ===== REPEAT VISITOR CHECK =====
// Input: normalized email. Returns true if seen in the last 30 days.
// Side effect: writes/refreshes the KV marker below.
export async function markAndCheckRepeat(env: Env, email: string): Promise<boolean> {
  // KV key "vldup:email:<email>" (LIBRARY_KV) = { at: timestamp } of the last
  // gate submission from this email. Expires after REPEAT_MARKER_TTL_SECONDS.
  const key = `vldup:email:${email}`;
  const seen = await kvGetJSON<{ at: number }>(env.LIBRARY_KV, key);
  await kvPutJSON(env.LIBRARY_KV, key, { at: Date.now() }, REPEAT_MARKER_TTL_SECONDS);
  return !!seen;
}

// ===== SAVE A LEAD =====
// Saves one library lead. Input: the full LibraryLead. Returns nothing.
// Side effects: writes "lead:..." (must succeed) and updates "leadidx:<month>".
// Throws if the main save fails, so the caller knows the lead wasn't stored.
export async function storeLead(env: Env, lead: LibraryLead): Promise<void> {
  // Canonical write first, and never inside a try/catch that would swallow a
  // failure — if this throws, the caller must know the lead wasn't saved.
  await kvPutJSON(env.LIBRARY_KV, leadKey(lead), lead, LEAD_TTL_SECONDS);

  // Index write second, best-effort. A failure here costs a cache entry that
  // reconcile() will rebuild, not a lead.
  try {
    // KV key "leadidx:<YYYY-MM>" = an array of every lead for that month, kept
    // in one document so the admin panel can load a month in a single read.
    const month = monthOf(lead.submittedAt);
    const key = `leadidx:${month}`;
    const idx = (await kvGetJSON<LibraryLead[]>(env.LIBRARY_KV, key)) ?? [];
    idx.push(lead);
    await kvPutJSON(env.LIBRARY_KV, key, idx, LEAD_TTL_SECONDS);
  } catch {
    /* cache only — reconcile() repairs it */
  }
}

// ===== READ LEADS (ADMIN PANEL) =====
// Returns a month's leads, newest first, repairing the index if it has drifted
// from the canonical keys.
// Input: month "YYYY-MM". Side effect: may rewrite "leadidx:<month>".
export async function listLeadsForMonth(env: Env, month: string): Promise<LibraryLead[]> {
  const idxKey = `leadidx:${month}`;
  // Load the month's index document, plus the list of permanent lead key names.
  const idx = (await kvGetJSON<LibraryLead[]>(env.LIBRARY_KV, idxKey)) ?? [];
  const names = await kvListAll(env.LIBRARY_KV, `lead:${month}:`);

  // Counts differ -> the index missed some leads; fetch the missing ones
  // (at most MAX_RECONCILE_FETCHES per call) and add them back.
  if (names.length !== idx.length) {
    const have = new Set(idx.map(l => l.id));
    // Key format is lead:{month}:{iso}:{uuid} — the id is the last segment.
    const missing = names.filter(n => !have.has(n.slice(n.lastIndexOf(':') + 1)));
    let repaired = false;
    for (const name of missing.slice(0, MAX_RECONCILE_FETCHES)) {
      const lead = await kvGetJSON<LibraryLead>(env.LIBRARY_KV, name);
      if (lead) {
        idx.push(lead);
        repaired = true;
      }
    }
    // Save the repaired index so the next read doesn't have to repair again.
    if (repaired) {
      try {
        await kvPutJSON(env.LIBRARY_KV, idxKey, idx, LEAD_TTL_SECONDS);
      } catch {
        /* best effort */
      }
    }
  }

  // Sort newest first.
  return idx.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
}

// Months are enumerated from the requested range rather than listed, so the
// cost is predictable: one index read (plus one cheap key listing) per month.
// Inputs: start and end dates. Returns ["YYYY-MM", ...] inclusive, oldest first.
export function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 7));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

// Loads leads for several months (from monthsBetween) and returns them all
// in one list, newest first. Used by GET /api/admin/leads and leads.csv.
export async function listLeads(env: Env, months: string[]): Promise<LibraryLead[]> {
  const all: LibraryLead[] = [];
  for (const m of months) all.push(...(await listLeadsForMonth(env, m)));
  return all.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
}

// ===== CSV EXPORT =====
// Column titles for the admin "Download CSV" file. If you add/reorder a column
// here, change the matching row list in leadsToCsv below in the same order.
export const LEAD_CSV_HEADERS = [
  'Submitted (UTC)',
  'First Name',
  'Last Name',
  'Email',
  'Phone',
  'Source',
  'Referrer',
  'Landing Page',
  'Returning Visitor',
];

// Turns a list of leads into CSV text (one row per lead). No side effects.
export function leadsToCsv(leads: LibraryLead[]): string {
  return toCsv(
    LEAD_CSV_HEADERS,
    leads.map(l => [
      l.submittedAt,
      l.firstName,
      l.lastName,
      l.email,
      l.phone,
      l.source,
      l.referrer,
      l.landingPath,
      l.isRepeat ? 'Yes' : 'No',
    ])
  );
}
