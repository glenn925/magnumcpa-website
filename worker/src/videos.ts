// FILE: videos.ts
// WEBSITE FEATURE: the list of videos shown on the gated video library page,
// and the add/edit/delete/reorder actions on the library admin page.
// USED BY: routes/library.ts (public list), routes/admin.ts (editing), and
// index.ts (the 15-minute cron reads the list for analytics). Data lives in
// LIBRARY_KV under the key "videos:list".
//
// The video catalogue: one KV document holding every video in display order.
//
// One document rather than one key per video, because the library page needs
// all of them on every load (1 KV read, edge-cached), because order is a
// property of the list rather than of any item, and because N-key reads would
// spend the Worker's subrequest budget on a page that renders a grid.
//
// The cost of one document is that concurrent writers can clobber each other.
// That's handled with an explicit `rev` rather than a lock: a mutation must
// state the rev it read, and a stale one is rejected with 409 instead of
// silently overwriting. With a single admin this effectively never fires, but
// it turns the one case that does happen — two admin tabs open, reorder in
// one and delete in the other — from silent data loss into "refresh and retry".
import type { Env } from './kv';
import { kvGetJSON, kvPutJSON, uuid } from './kv';
import type { Provider } from './videourl';

// The KV key holding the whole list. Changing it would make existing videos "disappear".
const VIDEOS_KEY = 'videos:list';
// How long visitors may see a cached copy after an edit. Lower = edits show up
// sooner but more KV reads (cost); higher = cheaper but slower to update.
const VIDEOS_CACHE_TTL = 60; // seconds, public reads only

// One video as stored in KV.
export interface Video {
  // Random unique id (from newVideoId), used for edit/delete/reorder.
  id: string;
  title: string;
  description: string;
  // Must be one of the category slugs in settings.ts.
  category: string;
  // embedUrl/sourceUrl/provider come from videourl.ts, never raw admin input.
  embedUrl: string;
  sourceUrl: string;
  provider: Provider;
  // true = kept in the admin list but not shown to visitors.
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

// The whole stored document: the videos plus a revision counter.
export interface VideoList {
  // Goes up by 1 on every save; used to detect two admin tabs clashing (409).
  rev: number;
  updatedAt: string;
  videos: Video[];
}

// What we return when nothing has been saved yet (a brand-new library).
const EMPTY: VideoList = { rev: 0, updatedAt: '1970-01-01T00:00:00.000Z', videos: [] };

// Public read path — edge-cached. Staleness of up to VIDEOS_CACHE_TTL is fine
// for visitors; the admin path uses getVideoListFresh so an edit is never
// applied on top of a cached copy.
// Input: env (KV access). Returns: the VideoList (empty list if none saved). Read-only.
export async function getVideoList(env: Env): Promise<VideoList> {
  const stored = await kvGetJSON<VideoList>(env.LIBRARY_KV, VIDEOS_KEY, VIDEOS_CACHE_TTL);
  return normalizeList(stored);
}

// Same as getVideoList but skips the edge cache, so it always sees the latest
// save. Used by the admin page before any change. Read-only.
export async function getVideoListFresh(env: Env): Promise<VideoList> {
  const stored = await kvGetJSON<VideoList>(env.LIBRARY_KV, VIDEOS_KEY);
  return normalizeList(stored);
}

// Repairs whatever came out of KV into a valid VideoList (missing/broken
// document -> empty list; missing rev -> 0). Input: stored value or null.
function normalizeList(stored: VideoList | null): VideoList {
  if (!stored || !Array.isArray(stored.videos)) return { ...EMPTY, videos: [] };
  return {
    rev: typeof stored.rev === 'number' ? stored.rev : 0,
    updatedAt: stored.updatedAt || EMPTY.updatedAt,
    videos: stored.videos,
  };
}

// Writes the list at rev+1. Callers must have already compared the client's
// rev against the freshly-read one.
// Inputs: env, the full new video array, the rev that was read. Returns: the
// saved document. SIDE EFFECT: overwrites "videos:list" in LIBRARY_KV.
export async function putVideoList(env: Env, videos: Video[], currentRev: number): Promise<VideoList> {
  const next: VideoList = {
    rev: currentRev + 1,
    updatedAt: new Date().toISOString(),
    videos,
  };
  await kvPutJSON(env.LIBRARY_KV, VIDEOS_KEY, next);
  return next;
}

// Returns a new random id for a video being added.
export function newVideoId(): string {
  return uuid();
}

// What the public library page is allowed to see: hidden videos withheld, and
// no internal bookkeeping fields.
// Input: one stored Video. Returns: a copy with only the fields visitors need.
// (Hiding is done by the caller filtering out hidden videos first.)
export function toPublicVideo(v: Video) {
  return {
    id: v.id,
    title: v.title,
    description: v.description,
    category: v.category,
    embedUrl: v.embedUrl,
    sourceUrl: v.sourceUrl,
    provider: v.provider,
  };
}
