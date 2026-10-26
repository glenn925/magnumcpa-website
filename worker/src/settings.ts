// FILE: settings.ts
// WEBSITE FEATURE: video library settings — the category list, the "book a
// call" link, whether the gate form uses Turnstile, and "sign out everywhere".
// USED BY: routes/library.ts (public page), routes/admin.ts (settings screen
// and admin login). Stored in LIBRARY_KV under "settings:app".
//
// The library's single settings document. Small, rarely written, read on
// nearly every request — so it's read through the edge cache and always
// merged over defaults, meaning a missing or partially-written document
// degrades to sane values instead of throwing.
import type { Env } from './kv';
import { kvGetJSON, kvPutJSON } from './kv';

// KV key where the settings document is saved.
const SETTINGS_KEY = 'settings:app';
// How long a cached copy may be used on public reads. Lower = changes appear
// sooner but cost more KV reads.
const SETTINGS_CACHE_TTL = 60; // seconds

// One video category. slug = internal id saved on each video (keep it stable);
// label = the name visitors see; order = position in the list (0 first).
export interface Category {
  slug: string;
  label: string;
  order: number;
}

// The full settings document.
export interface AppSettings {
  categories: Category[];
  // Where the library's "Book a call" button sends visitors.
  bookUrl: string;
  // Turnstile on the gate form. On by default; the site key already exists.
  gateTurnstile: boolean;
  // Bumping this invalidates every admin token already issued — that's what
  // "sign out everywhere" does, and it's why tokens carry a `ver` claim.
  adminTokenVersion: number;
  updatedAt: string;
}

// Mirrors the four service tiles on the main site so the library's categories
// read as the same business, not a second taxonomy.
// These are only DEFAULTS, used until settings are saved from the admin page —
// after that, the saved copy in KV wins and editing this has no effect.
export const DEFAULT_SETTINGS: AppSettings = {
  categories: [
    { slug: 'tax', label: 'Tax', order: 0 },
    { slug: 'bookkeeping-payroll', label: 'Bookkeeping & Payroll', order: 1 },
    { slug: 'consulting', label: 'Consulting', order: 2 },
    { slug: 'security', label: 'Security', order: 3 },
    { slug: 'general', label: 'General', order: 4 },
  ],
  bookUrl: 'https://magnumcpa.as.me/10MinuteCall',
  gateTurnstile: true,
  adminTokenVersion: 1,
  updatedAt: '1970-01-01T00:00:00.000Z',
};

// Reads settings via the edge cache (may be up to 60s old). Input: env.
// Returns: saved settings layered over DEFAULT_SETTINGS. Read-only.
export async function getSettings(env: Env): Promise<AppSettings> {
  const stored = await kvGetJSON<Partial<AppSettings>>(env.LIBRARY_KV, SETTINGS_KEY, SETTINGS_CACHE_TTL);
  if (!stored) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    // An empty category list would leave the admin unable to file anything;
    // fall back rather than persist a dead end.
    categories: stored.categories?.length ? stored.categories : DEFAULT_SETTINGS.categories,
  };
}

// Reads without the cache TTL. Used on the write path, where acting on a
// 60-second-stale adminTokenVersion would silently undo a "sign out
// everywhere" that just happened.
export async function getSettingsFresh(env: Env): Promise<AppSettings> {
  const stored = await kvGetJSON<Partial<AppSettings>>(env.LIBRARY_KV, SETTINGS_KEY);
  if (!stored) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    categories: stored.categories?.length ? stored.categories : DEFAULT_SETTINGS.categories,
  };
}

// Saves the whole settings document (stamping updatedAt). Returns the saved copy.
// SIDE EFFECT: overwrites "settings:app" in LIBRARY_KV.
export async function putSettings(env: Env, settings: AppSettings): Promise<AppSettings> {
  const next = { ...settings, updatedAt: new Date().toISOString() };
  await kvPutJSON(env.LIBRARY_KV, SETTINGS_KEY, next);
  return next;
}

// True if `slug` is one of the configured categories. Used to reject a video
// filed under a category that doesn't exist.
export function isKnownCategory(settings: AppSettings, slug: string): boolean {
  return settings.categories.some(c => c.slug === slug);
}
