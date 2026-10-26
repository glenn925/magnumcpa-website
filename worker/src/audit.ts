// FILE: audit.ts
// WEBSITE FEATURE: a behind-the-scenes log of what happened to each form
// submission and admin action (accepted, flagged as spam, rate-limited, sent to
// Canopy, admin logins...). Useful for answering "why didn't this lead arrive?".
// USED BY: index.ts, routes/lead.ts, routes/library.ts, routes/admin.ts,
// library-delivery.ts. Entries are KV keys starting "audit:" (view them in the
// Cloudflare dashboard under KV, or with `npx wrangler kv key list`).
import { kvPutJSON, uuid } from './kv';

// How long each log entry is kept before Cloudflare deletes it (90 days).
// Longer = more history but more stored keys.
const AUDIT_RETENTION_SECONDS = 60 * 60 * 24 * 90; // 90 days; adjust as needed

// One log entry. Only `type` is required; the rest is optional detail.
export interface AuditEvent {
  type: string;         // e.g. 'lead_accepted' | 'lead_flagged' | 'canopy_pending' | 'canopy_created'
  reason?: string;
  email?: string;
  ip?: string;
  meta?: Record<string, unknown>;
}

// Writes one log entry. Inputs: which KV namespace (LEADS_KV or LIBRARY_KV)
// and the event. The key starts with the time, so entries list in time order.
// SIDE EFFECT: one KV write. Returns nothing.
export async function logEvent(kv: KVNamespace, event: AuditEvent): Promise<void> {
  const key = `audit:${new Date().toISOString()}:${uuid()}`;
  await kvPutJSON(kv, key, { ...event, at: Date.now() }, AUDIT_RETENTION_SECONDS);
}
