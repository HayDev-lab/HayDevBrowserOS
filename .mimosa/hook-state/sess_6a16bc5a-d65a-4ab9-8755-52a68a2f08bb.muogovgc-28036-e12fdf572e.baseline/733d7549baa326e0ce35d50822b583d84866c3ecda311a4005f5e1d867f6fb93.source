/**
 * tab-unread tests — "(N) Title" unread badge parsing.
 *
 * Messengers (WhatsApp Web, Telegram Web) encode unread counts as a title
 * prefix; the tab strip shows the count in a badge and strips the prefix.
 */
import { describe, it, expect } from 'vitest';
import { parseUnreadTitle, parseUnreadCount } from '../src/shared/tab-unread';

describe('parseUnreadTitle', () => {
  it('parses parenthesized counts and strips the prefix', () => {
    expect(parseUnreadTitle('(3) WhatsApp')).toEqual({
      unreadCount: 3,
      title: 'WhatsApp',
    });
    expect(parseUnreadTitle('(12) Telegram')).toEqual({
      unreadCount: 12,
      title: 'Telegram',
    });
  });

  it('parses bracketed counts and the 99+ overflow marker', () => {
    expect(parseUnreadTitle('[5] Mail')).toEqual({ unreadCount: 5, title: 'Mail' });
    expect(parseUnreadTitle('(99+) Community')).toEqual({
      unreadCount: 99,
      title: 'Community',
    });
  });

  it('returns 0 and the untouched title when there is no marker', () => {
    expect(parseUnreadTitle('WhatsApp')).toEqual({ unreadCount: 0, title: 'WhatsApp' });
    expect(parseUnreadTitle('Episode 3 — Podcast')).toEqual({
      unreadCount: 0,
      title: 'Episode 3 — Podcast',
    });
  });

  it('does not match markers that are not a prefix', () => {
    expect(parseUnreadTitle('Chat (3)')).toEqual({ unreadCount: 0, title: 'Chat (3)' });
    expect(parseUnreadTitle('(group) Chat')).toEqual({
      unreadCount: 0,
      title: '(group) Chat',
    });
  });

  it('ignores zero and malformed counts', () => {
    expect(parseUnreadTitle('(0) WhatsApp')).toEqual({
      unreadCount: 0,
      title: '(0) WhatsApp',
    });
  });

  it('handles empty and non-string input defensively', () => {
    expect(parseUnreadTitle('')).toEqual({ unreadCount: 0, title: '' });
    expect(parseUnreadCount('')).toBe(0);
  });
});

describe('parseUnreadCount', () => {
  it('returns just the number', () => {
    expect(parseUnreadCount('(7) WhatsApp')).toBe(7);
    expect(parseUnreadCount('WhatsApp')).toBe(0);
  });
});
