/**
 * Quick actions tests — domain-scoped one-click prompt matching.
 */
import { describe, it, expect } from 'vitest';
import { getQuickActionsForUrl } from '../src/shared/quick-actions';

describe('getQuickActionsForUrl', () => {
  it('offers video chapters on youtube watch URLs', () => {
    const actions = getQuickActionsForUrl('https://www.youtube.com/watch?v=abc');
    const ids = actions.map((a) => a.id);
    expect(ids).toContain('yt-chapters');
    expect(ids).toContain('yt-channel'); // generic youtube action also applies
  });

  it('no watch-specific action on channel pages', () => {
    const actions = getQuickActionsForUrl('https://www.youtube.com/@somechannel');
    expect(actions.map((a) => a.id)).not.toContain('yt-chapters');
  });

  it('offers shopping actions on product stores (incl. subdomains)', () => {
    const actions = getQuickActionsForUrl('https://www.amazon.com/dp/B0XXXX');
    expect(actions.map((a) => a.id)).toEqual(['shop-reviews', 'shop-discount']);
    expect(getQuickActionsForUrl('https://ozon.ru/product/123').map((a) => a.id)).toContain('shop-discount');
  });

  it('caps the chips at 3', () => {
    // youtube watch matches both rules → 3 actions max
    const actions = getQuickActionsForUrl('https://youtube.com/watch?v=x');
    expect(actions.length).toBeLessThanOrEqual(3);
  });

  it('returns nothing for unknown domains and non-web URLs', () => {
    expect(getQuickActionsForUrl('https://example.com/')).toEqual([]);
    expect(getQuickActionsForUrl('about:blank')).toEqual([]);
    expect(getQuickActionsForUrl('pab://newtab')).toEqual([]);
    expect(getQuickActionsForUrl('')).toEqual([]);
    expect(getQuickActionsForUrl('not a url')).toEqual([]);
  });

  it('never matches by substring — suffix host match only', () => {
    // evil-amazon.com.example.org must NOT match amazon.com
    expect(getQuickActionsForUrl('https://evil-amazon.com.example.org/x')).toEqual([]);
  });
});
