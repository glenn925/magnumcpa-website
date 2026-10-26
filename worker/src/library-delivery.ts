// Where a captured gate lead goes.
//
// Three sinks behind one interface, each independently enabled, so the "for
// now" answer and the "eventually" answer can coexist without a rewrite:
//
//   kvSink      always on. The authoritative copy. If this fails, the whole
//               submission fails — everything else is delivery, this is the
//               record.
//   webhookSink on when LEAD_WEBHOOK_URL is set. The useful one today: point
//               it at a Zapier/Make webhook and every lead lands in a live
//               Google Sheet or Excel Online file, with no code and without
//               waiting on Canopy API access.
//   canopySink  on when canopyConfigured(env) is true, which it is not yet.
//               Wraps the existing createProspect() untouched. When real
//               credentials arrive, the only file that changes is
//               canopy-client.ts, where the endpoints are marked CONFIRM.
//
// Failures queue under vlpending:. That prefix is deliberately NOT the
// consultation form's pending: — a bug in library delivery must not be able
// to drain or corrupt the queue the main site's leads sit in.
import type { Env } from './kv';
import { kvGetJSON, kvPutJSON, kvListAll, uuid } from './kv';
import { logEvent } from './audit';
import { storeLead, type LibraryLead } from './leads';
import { canopyConfigured, createProspect, type NormalizedLead } from './canopy-client';

// ===== FILE OVERVIEW (plain English) =====
// After someone fills in the VIDEO LIBRARY gate form, routes/library.ts calls
// deliverLead() here: save the lead, then forward it to the webhook (e.g.
// Zapier -> Google Sheet) and Canopy if those are switched on. Failed sends
// are retried by drainLibraryQueue(), which the cron in index.ts runs.

// ===== RETRY SETTINGS =====
// Give up on a failed delivery after this many tries (it then goes to
// "vldeadletter:<id>"). Raise to retry for longer.
const MAX_ATTEMPTS = 8;
// First retry wait: 5 minutes, doubling every attempt (5, 10, 20, 40 min...).
const BASE_RETRY_DELAY_MS = 5 * 60 * 1000;

// One queued retry, stored at KV key "vlpending:<id>" (LIBRARY_KV): which
// sink failed, the lead itself, how many tries so far, and when to try next.
interface PendingDelivery {
  id: string;
  sink: string;
  lead: LibraryLead;
  attempts: number;
  nextRetryAt: number;
  createdAt: number;
}

// A "sink" = one place a lead can be sent. Each has a name, a check for
// whether it's switched on, and a send() that throws if delivery fails.
export interface LeadSink {
  name: string;
  configured(env: Env): boolean;
  send(env: Env, lead: LibraryLead): Promise<void>;
}

// ===== FORMAT FOR CANOPY =====
// Converts a library lead into the shape Canopy's client expects (the same
// shape the consultation form uses). Fields the gate doesn't collect are ''.
export function toNormalizedLead(lead: LibraryLead): NormalizedLead {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    businessName: '',
    state: '',
    // Tags the record inside Canopy so video-library leads are distinguishable
    // from people who asked for a consultation. They are different intents and
    // should not land in the same bucket unlabelled.
    serviceNeeded: 'Video Library',
    revenue: '',
    preferredContact: '',
    bestTimeToCall: '',
    // A short note shown on the Canopy record: where the lead came from.
    // Lines that are null (e.g. no referrer) are dropped.
    message: [
      'Lead source: Magnum CPA video library (gated access form)',
      `Traffic source: ${lead.source}`,
      lead.referrer ? `Referrer: ${lead.referrer}` : null,
      lead.landingPath ? `Landing page: ${lead.landingPath}` : null,
      lead.isRepeat ? 'Returning visitor: yes' : null,
    ]
      .filter(Boolean)
      .join('\n'),
    submittedAt: lead.submittedAt,
  };
}

// ===== DELIVERY SINKS =====
// Webhook sink: POSTs the lead as JSON to LEAD_WEBHOOK_URL (a secret/var).
// On when that URL is set. Network call; throws on any non-2xx reply.
const webhookSink: LeadSink = {
  name: 'webhook',
  configured: env => !!env.LEAD_WEBHOOK_URL,
  async send(env, lead) {
    const resp = await fetch(env.LEAD_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'video-library-gate', lead }),
    });
    if (!resp.ok) throw new Error(`webhook responded ${resp.status}`);
  },
};

// Canopy sink: creates a prospect in Canopy via canopy-client.ts.
// On only once Canopy credentials are configured.
const canopySink: LeadSink = {
  name: 'canopy',
  configured: env => canopyConfigured(env),
  async send(env, lead) {
    await createProspect(env, toNormalizedLead(lead));
  },
};

// The list of sinks tried for every lead, in this order. Add a new sink
// object to this array to send leads somewhere else as well.
const DELIVERY_SINKS: LeadSink[] = [webhookSink, canopySink];

// ===== RETRY QUEUE =====
// Saves a failed delivery for the cron to retry later. Inputs: sink name,
// lead, attempts so far. Side effect: writes KV key "vlpending:<id>".
async function enqueue(env: Env, sink: string, lead: LibraryLead, attempts = 0): Promise<void> {
  const item: PendingDelivery = {
    id: uuid(),
    sink,
    lead,
    attempts,
    nextRetryAt: Date.now() + BASE_RETRY_DELAY_MS * Math.pow(2, attempts),
    createdAt: Date.now(),
  };
  await kvPutJSON(env.LIBRARY_KV, `vlpending:${item.id}`, item);
}

// Called on the request path. The canonical write is awaited and allowed to
// throw; every outbound delivery is attempted but never allowed to fail the
// visitor's submission — they handed over their details and must get the
// library either way.
// ===== DELIVER A NEW LEAD =====
// Input: the lead. Side effects: KV writes (lead + audit log), network calls
// to each switched-on sink, and a "vlpending:" entry for any sink that fails.
export async function deliverLead(env: Env, lead: LibraryLead): Promise<void> {
  // Step 1: save the permanent copy (leads.ts). If this throws, stop here.
  await storeLead(env, lead);

  // Step 2: try each switched-on sink; a failure is logged and queued.
  for (const sink of DELIVERY_SINKS) {
    if (!sink.configured(env)) continue;
    try {
      await sink.send(env, lead);
      await logEvent(env.LIBRARY_KV, {
        type: 'library_lead_delivered',
        email: lead.email,
        meta: { sink: sink.name },
      });
    } catch (err) {
      await logEvent(env.LIBRARY_KV, {
        type: 'library_delivery_error',
        email: lead.email,
        meta: { sink: sink.name, error: String(err) },
      });
      await enqueue(env, sink.name, lead);
    }
  }
}

// ===== CRON: RETRY QUEUED DELIVERIES =====
// Cron half. Mirrors the consultation queue's backoff, over its own prefix.
// Called every 15 min by index.ts. Returns counts of sent/failed this run.
// Side effects: network calls, deletes/rewrites "vlpending:", writes
// "vldeadletter:<id>" (permanent record of a lead that never got delivered).
export async function drainLibraryQueue(env: Env): Promise<{ sent: number; failed: number }> {
  // Lists up to 2 pages (2000 keys) of queued items per run.
  const names = await kvListAll(env.LIBRARY_KV, 'vlpending:', 2);
  const now = Date.now();
  let sent = 0;
  let failed = 0;

  for (const name of names) {
    const item = await kvGetJSON<PendingDelivery>(env.LIBRARY_KV, name);
    // Skip if the item vanished or its retry time hasn't come yet.
    if (!item || item.nextRetryAt > now) continue;

    const sink = DELIVERY_SINKS.find(s => s.name === item.sink);
    // A sink that has since been unconfigured (webhook URL removed) would
    // retry forever. Drop the item instead of accumulating dead entries.
    if (!sink || !sink.configured(env)) {
      await env.LIBRARY_KV.delete(name);
      continue;
    }

    // Retry the send; on success remove it from the queue and log it.
    try {
      await sink.send(env, item.lead);
      await env.LIBRARY_KV.delete(name);
      sent++;
      await logEvent(env.LIBRARY_KV, {
        type: 'library_lead_delivered',
        email: item.lead.email,
        meta: { sink: item.sink, fromQueue: true },
      });
    } catch (err) {
      failed++;
      const attempts = item.attempts + 1;
      // Out of retries: move to "vldeadletter:<id>" and stop retrying.
      if (attempts >= MAX_ATTEMPTS) {
        await kvPutJSON(env.LIBRARY_KV, `vldeadletter:${item.id}`, { ...item, lastError: String(err) });
        await env.LIBRARY_KV.delete(name);
        await logEvent(env.LIBRARY_KV, {
          type: 'library_delivery_deadletter',
          email: item.lead.email,
          meta: { sink: item.sink, attempts },
        });
      } else {
        // Still has retries left: bump the count and push the next try later.
        await kvPutJSON(env.LIBRARY_KV, name, {
          ...item,
          attempts,
          nextRetryAt: now + BASE_RETRY_DELAY_MS * Math.pow(2, attempts),
        });
      }
    }
  }

  return { sent, failed };
}
