// Library analytics — the KV half. All pure logic lives in analytics-core.ts.
//
// The shape here is driven by two KV constraints rather than by taste:
//   * A single key absorbs roughly one write per second, so a hot counter
//     incremented per click would throttle under any burst.
//   * Read-modify-write on a shared counter loses increments whenever two
//     requests overlap.
// Both disappear if requests never touch the counters. So a request only
// *appends* a throwaway event key, and the cron is the sole writer of every
// rolled-up total.
//
// The second trick: an event carries all of its data in the key NAME
// (ev:{bucket}:{type}:{target}:{uuid}) and an empty value. The rollup can then
// fold thousands of events with list() calls alone and never get() a single
// one — which is what keeps it inside the Worker subrequest budget.
import type { Env } from './kv';
import { kvGetJSON, kvPutJSON, kvListAll, uuid } from './kv';
import {
  bucketOf, dayOf, monthOf, emptyStats, mergeInto, applyEvent,
  parseEventKey, isSafeTarget, type StatsDoc, type EventType,
} from './analytics-core';

// ===== FILE OVERVIEW (plain English) =====
// Powers the admin panel's Analytics tab for the video library.
// - recordEvent(): called by routes/library.ts on each play/click/sign-up.
// - rollupAnalytics(): called by the cron in index.ts every 15 minutes.
// - getSummary(): called by GET /api/admin/analytics (routes/admin.ts).
// KV keys (all in LIBRARY_KV):
//   ev:<bucket>:<type>:<target>:<uuid>  one raw event, value "1", lives 24h
//   stats:day:<YYYY-MM-DD>              that day's totals (a StatsDoc)
//   stats:month:<YYYY-MM>               that month's totals
//   stats:totals                        all-time totals
//   stats:watermark                     last 15-min bucket already counted

// Re-exported so other files can import these from './analytics' directly.
export {
  bucketOf, bucketReferrer, parseEventKey, isSafeTarget,
  type StatsDoc, type EventType,
} from './analytics-core';

// ===== SETTINGS =====
// Raw events expire after 24h. If the cron stops for over a day, uncounted
// events are lost, so don't shorten this.
const EVENT_TTL_SECONDS = 60 * 60 * 24; // events are disposable once rolled up
// Daily/monthly stats documents are kept 400 days, then auto-deleted.
const STATS_TTL_SECONDS = 60 * 60 * 24 * 400;
// KV key remembering the last bucket already counted (so nothing counts twice).
const WATERMARK_KEY = 'stats:watermark';
// KV key holding the all-time totals document.
const TOTALS_KEY = 'stats:totals';

// Appends one event. Never throws into the request path: analytics failing is
// never a reason for a visitor's page or form submission to fail.
// ===== RECORD ONE EVENT =====
// Inputs: event type ('play' | 'cta' | 'filter' | 'lead') and target (video
// id, category, button, or traffic source). Side effect: one KV write.
export async function recordEvent(env: Env, type: EventType, target: string): Promise<void> {
  // SECURITY: refuse odd characters, since the target becomes part of a key name.
  if (!isSafeTarget(target)) return;
  try {
    const key = `ev:${bucketOf(Date.now())}:${type}:${target}:${uuid()}`;
    await env.LIBRARY_KV.put(key, '1', { expirationTtl: EVENT_TTL_SECONDS });
  } catch {
    /* analytics is best-effort by design */
  }
}

// ===== CRON: ROLL UP EVENTS INTO TOTALS =====
// Input: a function mapping a video id to its category. Returns how many
// events were counted. Side effects: reads ev:* keys, writes stats:* keys.
// Folds every complete 15-minute bucket into its day and month documents.
//
// Buckets at or after the current one are skipped — they're still being
// written to, and folding a half-full bucket would lose whatever arrived
// afterwards. The watermark makes the whole pass idempotent, so a run that
// dies partway through is safe to repeat. Rolled-up event keys are left to
// expire on their own 24h TTL rather than deleted: deletes would cost one
// subrequest each, and that is the budget this design exists to protect.
export async function rollupAnalytics(
  env: Env,
  categoryOf: (videoId: string) => string | undefined
): Promise<{ folded: number; through: number }> {
  // The 15-minute bucket we're in now (still filling) and the last bucket
  // already counted by a previous run.
  const currentBucket = bucketOf(Date.now());
  const watermark = await kvGetJSON<{ lastBucket: number }>(env.LIBRARY_KV, WATERMARK_KEY);
  const from = watermark?.lastBucket ?? 0;
  // Nothing new to count since the last run -> stop early.
  if (currentBucket - 1 <= from) return { folded: 0, through: from };

  // List every raw event key (names only — the data is in the name). Lists
  // up to 10 pages (10,000 keys); events beyond that are not counted.
  const names = await kvListAll(env.LIBRARY_KV, 'ev:');
  // Running tallies for this run, grouped by day and by month.
  const byDay = new Map<string, StatsDoc>();
  const byMonth = new Map<string, StatsDoc>();
  let folded = 0;

  // Count each event that falls after the watermark and before the bucket
  // that is still filling up.
  for (const name of names) {
    const ev = parseEventKey(name);
    if (!ev) continue;
    if (ev.bucket <= from || ev.bucket >= currentBucket) continue;

    const day = dayOf(ev.bucket);
    const month = monthOf(ev.bucket);
    if (!byDay.has(day)) byDay.set(day, emptyStats());
    if (!byMonth.has(month)) byMonth.set(month, emptyStats());

    applyEvent(byDay.get(day)!, ev, categoryOf);
    applyEvent(byMonth.get(month)!, ev, categoryOf);
    folded++;
  }

  const totals = (await kvGetJSON<StatsDoc>(env.LIBRARY_KV, TOTALS_KEY)) ?? emptyStats();

  // Add this run's counts onto each saved "stats:day:<date>" document, and
  // onto the all-time totals.
  for (const [day, stats] of byDay) {
    const key = `stats:day:${day}`;
    const existing = (await kvGetJSON<StatsDoc>(env.LIBRARY_KV, key)) ?? emptyStats();
    mergeInto(existing, stats);
    await kvPutJSON(env.LIBRARY_KV, key, existing, STATS_TTL_SECONDS);
    mergeInto(totals, stats);
  }
  // Same for each "stats:month:<YYYY-MM>" document.
  for (const [month, stats] of byMonth) {
    const key = `stats:month:${month}`;
    const existing = (await kvGetJSON<StatsDoc>(env.LIBRARY_KV, key)) ?? emptyStats();
    mergeInto(existing, stats);
    await kvPutJSON(env.LIBRARY_KV, key, existing, STATS_TTL_SECONDS);
  }

  // Save all-time totals, then move the watermark forward so these events
  // are never counted again.
  await kvPutJSON(env.LIBRARY_KV, TOTALS_KEY, totals);
  await kvPutJSON(env.LIBRARY_KV, WATERMARK_KEY, { lastBucket: currentBucket - 1 });

  return { folded, through: currentBucket - 1 };
}

// ===== ADMIN DASHBOARD SUMMARY =====
// What GET /api/admin/analytics sends back: totals for the period plus a
// per-day series (for the chart), and whether recent events aren't counted yet.
export interface AnalyticsSummary {
  days: number;
  from: string;
  to: string;
  totals: StatsDoc;
  series: Array<{ date: string; leads: number; plays: number }>;
  pendingEvents: boolean;
}

// Reads at most `days` daily documents — 30 by default, which with the
// catalogue and settings reads stays under the free plan's 50-subrequest cap.
// Input: number of days to show. Returns an AnalyticsSummary. Reads only.
export async function getSummary(env: Env, days: number): Promise<AnalyticsSummary> {
  // Keep the range between 1 and 90 days (90 = max the dashboard can ask for).
  const clamped = Math.max(1, Math.min(days, 90));
  const totals = emptyStats();
  const series: Array<{ date: string; leads: number; plays: number }> = [];

  // Build the list of dates (UTC, "YYYY-MM-DD"), oldest first, ending today.
  const today = new Date();
  const dates: string[] = [];
  for (let i = clamped - 1; i >= 0; i--) {
    dates.push(new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10));
  }

  // Read each day's stats document, add it to the totals, and record that
  // day's lead and play counts for the chart.
  for (const date of dates) {
    const stats = (await kvGetJSON<StatsDoc>(env.LIBRARY_KV, `stats:day:${date}`)) ?? emptyStats();
    mergeInto(totals, stats);
    series.push({
      date,
      leads: stats.leads,
      plays: Object.values(stats.plays).reduce((a, b) => a + b, 0),
    });
  }

  // Read the watermark to tell whether the cron is behind (events not yet counted).
  const watermark = await kvGetJSON<{ lastBucket: number }>(env.LIBRARY_KV, WATERMARK_KEY);
  return {
    days: clamped,
    from: dates[0],
    to: dates[dates.length - 1],
    totals,
    series,
    // Tells the admin UI to say "updated every 15 minutes" rather than letting
    // Glenn think a play he just tested was lost.
    pendingEvents: (watermark?.lastBucket ?? 0) < bucketOf(Date.now()) - 1,
  };
}
