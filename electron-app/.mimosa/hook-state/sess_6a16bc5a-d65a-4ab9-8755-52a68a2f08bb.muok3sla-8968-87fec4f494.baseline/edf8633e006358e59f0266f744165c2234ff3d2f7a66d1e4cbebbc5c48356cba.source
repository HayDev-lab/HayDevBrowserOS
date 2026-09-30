/**
 * Today-in-Tech news — pure fetcher for the New Tab news strip.
 *
 * Pulls the current top stories from the Hacker News Firebase API (a free,
 * key-less JSON endpoint) and maps them into bounded card descriptors:
 *   GET https://hacker-news.firebaseio.com/v0/topstories.json  → id[]
 *   GET https://hacker-news.firebaseio.com/v0/item/<id>.json   → story
 *
 * Honesty rules:
 *   - The strip renders REAL stories (title, real URL, real age).
 *   - Any failure (offline, timeout, malformed payload) yields [] and the
 *     New Tab shows a quiet empty state — never fabricated items.
 *
 * Pure — the injectable fetch keeps this unit-testable without network.
 */

export interface TechNewsItem {
  rank: string;          // '01'…'04'
  title: string;
  url: string;
  /** HN discussion url (fallback target when the story has no url). */
  discussionUrl: string;
  /** Human age, e.g. '2h ago'. */
  age: string;
  /** Two-letter source key for the generated tile (e.g. 'NY', 'GH'). */
  sourceKey: string;
}

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';
const DEFAULT_LIMIT = 4;
const FETCH_TIMEOUT_MS = 2500;

export async function fetchTechNews(
  fetchImpl: typeof fetch,
  opts: { limit?: number; now?: number; attempts?: number } = {}
): Promise<TechNewsItem[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const now = opts.now ?? Date.now();
  // Cold boot races the network stack — retry a couple of times before
  // giving up (the New Tab renders an honest empty state on total failure).
  const attempts = opts.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const items = await fetchTechNewsOnce(fetchImpl, limit, now);
    if (items.length > 0) return items;
    if (attempt < attempts - 1) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return [];
}

async function fetchTechNewsOnce(
  fetchImpl: typeof fetch,
  limit: number,
  now: number
): Promise<TechNewsItem[]> {
  try {
    const idsRes = await withTimeout(fetchImpl(`${HN_BASE}/topstories.json`));
    if (!idsRes.ok) return [];
    const ids = (await idsRes.json()) as unknown;
    if (!Array.isArray(ids)) return [];

    const picks = (ids.slice(0, limit * 3) as number[]).filter((n) => typeof n === 'number');
    const stories = await Promise.all(
      picks.map(async (id) => {
        try {
          const res = await withTimeout(fetchImpl(`${HN_BASE}/item/${id}.json`));
          if (!res.ok) return null;
          return (await res.json()) as HnItem | null;
        } catch {
          return null;
        }
      })
    );

    const items: TechNewsItem[] = [];
    for (const s of stories) {
      if (items.length >= limit) break;
      if (!s || s.type !== 'story' || typeof s.title !== 'string') continue;
      const url = typeof s.url === 'string' && s.url.length > 0
        ? s.url
        : `https://news.ycombinator.com/item?id=${s.id}`;
      const ageMin = typeof s.time === 'number' ? Math.max(1, Math.round((now - s.time * 1000) / 60000)) : null;
      items.push({
        rank: String(items.length + 1).padStart(2, '0'),
        title: s.title.length > 90 ? s.title.slice(0, 89) + '…' : s.title,
        url,
        discussionUrl: `https://news.ycombinator.com/item?id=${s.id}`,
        age: ageMin === null ? '' : ageLabel(ageMin),
        sourceKey: sourceKeyOf(url),
      });
    }
    return items;
  } catch {
    return [];
  }
}

interface HnItem {
  id?: number;
  type?: string;
  title?: string;
  url?: string;
  time?: number;
}

async function withTimeout(p: Promise<Response>): Promise<Response> {
  return await Promise.race([
    p,
    new Promise<Response>((_, rej) => setTimeout(() => rej(new Error('timeout')), FETCH_TIMEOUT_MS)),
  ]);
}

function ageLabel(min: number): string {
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function sourceKeyOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const parts = host.split('.');
    const key = (parts.length >= 2 ? parts[parts.length - 2] : host) || host;
    return key.slice(0, 2).toUpperCase();
  } catch {
    return 'WW';
  }
}
