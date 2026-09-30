/**
 * Tab unread badge — pure title parsing.
 *
 * Messengers (WhatsApp Web, Telegram Web, mail apps) encode unread counts
 * into the page title with a leading "(N)" / "(N+)" / "[N]" prefix, e.g.
 * "(3) WhatsApp" or "(9+) Telegram". The tab strip shows a badge with that
 * count and hides the prefix from the displayed title.
 *
 * Pure — no Electron imports.
 */

/** Matches a leading unread marker: (3) (9+) [3] [9+] — capped at 3 digits. */
const UNREAD_PREFIX = /^\((\d{1,3}\+?)\)\s+|^\[(\d{1,3}\+?)\]\s+/;

export interface ParsedUnreadTitle {
  /** Unread count (0 when the title carries no marker). */
  unreadCount: number;
  /** Title with the unread marker removed. */
  title: string;
}

export function parseUnreadTitle(rawTitle: string): ParsedUnreadTitle {
  if (typeof rawTitle !== 'string' || rawTitle.length === 0) {
    return { unreadCount: 0, title: rawTitle ?? '' };
  }
  const match = rawTitle.match(UNREAD_PREFIX);
  if (!match) {
    return { unreadCount: 0, title: rawTitle };
  }
  const marker = match[1] ?? match[2] ?? '';
  const plus = marker.endsWith('+');
  const value = Number.parseInt(plus ? marker.slice(0, -1) : marker, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return { unreadCount: 0, title: rawTitle };
  }
  return { unreadCount: value, title: rawTitle.slice(match[0].length) };
}

/** Unread count only — convenience for state updates. */
export function parseUnreadCount(rawTitle: string): number {
  return parseUnreadTitle(rawTitle).unreadCount;
}
