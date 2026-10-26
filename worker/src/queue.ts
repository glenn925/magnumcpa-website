// FILE: queue.ts
// WEBSITE FEATURE: the safety net for the "Request a Consultation" form — if a
// lead can't be sent to Canopy right away, it is saved in LEADS_KV under
// "pending:<id>" and retried by the 15-minute cron (see wrangler.toml).
// (Video library gate leads have their own copy of these numbers in library-delivery.ts.)
//
// The Canopy delivery retry queue's shape and backoff constants, shared by the
// route that enqueues (routes/lead.ts) and the cron that drains it (index.ts).
// Extracted from index.ts unchanged when the router was split out.
import type { NormalizedLead } from './canopy-client';

// How many times to try sending a lead to Canopy before giving up and moving
// it to "deadletter:<id>" (kept for manual follow-up). Raise to keep trying longer.
export const MAX_CANOPY_ATTEMPTS = 8;
// Base wait between retries; it doubles after each failure (index.ts uses
// BASE x 2^attempts: 10, 20, 40, 80 min...). The cron runs every 15 min, so waits round up.
export const BASE_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes, doubles per attempt

// One waiting lead as stored in KV.
export interface PendingCanopyItem {
  id: string;
  lead: NormalizedLead;
  // How many delivery attempts have failed so far.
  attempts: number;
  // Time (milliseconds since 1970) when the cron may try again.
  nextRetryAt: number;
  createdAt: number;
}
