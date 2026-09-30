/**
 * New Tab bridge — pure contract tests (origin guard, attachment logic,
 * research command composition).
 */
import { describe, it, expect } from 'vitest';
import {
  isNewTabDocumentUrl,
  isBridgeDocumentUrl,
  isTextLikeAttachment,
  isImageAttachment,
  composeResearchCommand,
  sanitizeFileName,
  formatBytes,
  NEWTAB_ATTACH_INLINE_TEXT_LIMIT,
} from '@shared/newtab-bridge';

describe('isNewTabDocumentUrl (sender guard)', () => {
  it('accepts only the internal newtab document', () => {
    expect(isNewTabDocumentUrl('pab://newtab')).toBe(true);
    expect(isNewTabDocumentUrl('pab://newtab/')).toBe(true);
    expect(isNewTabDocumentUrl('pab://newtab/?x=1')).toBe(true);
  });

  it('refuses every other origin — web, file, other internal hosts', () => {
    expect(isNewTabDocumentUrl('https://evil.com/pab://newtab')).toBe(false);
    expect(isNewTabDocumentUrl('https://web.whatsapp.com/')).toBe(false);
    expect(isNewTabDocumentUrl('pab://search?q=x')).toBe(false);
    expect(isNewTabDocumentUrl('pab://darkweb')).toBe(false);
    expect(isNewTabDocumentUrl('file:///C:/newtab.html')).toBe(false);
    expect(isNewTabDocumentUrl('')).toBe(false);
    expect(isNewTabDocumentUrl(null)).toBe(false);
    expect(isNewTabDocumentUrl(undefined)).toBe(false);
    // Tricky lookalikes must NOT pass.
    expect(isNewTabDocumentUrl('pab://newtab.evil.com')).toBe(false);
    expect(isNewTabDocumentUrl('xpab://newtab')).toBe(false);
  });
});

describe('isBridgeDocumentUrl (bridge surfaces: newtab + search chat)', () => {
  it('accepts the newtab and the HayDev Search chat documents', () => {
    expect(isBridgeDocumentUrl('pab://newtab')).toBe(true);
    expect(isBridgeDocumentUrl('pab://newtab/?x=1')).toBe(true);
    expect(isBridgeDocumentUrl('pab://search')).toBe(true);
    expect(isBridgeDocumentUrl('pab://search/?q=quantum&src=academic')).toBe(true);
  });

  it('refuses everything else — web origins, file, darkweb, lookalikes', () => {
    expect(isBridgeDocumentUrl('https://evil.com/pab://newtab')).toBe(false);
    expect(isBridgeDocumentUrl('pab://darkweb?q=x')).toBe(false);
    expect(isBridgeDocumentUrl('pab://newtab.evil.com')).toBe(false);
    expect(isBridgeDocumentUrl('pab://search.evil.com')).toBe(false);
    expect(isBridgeDocumentUrl('file:///C:/search.html')).toBe(false);
    expect(isBridgeDocumentUrl('')).toBe(false);
    expect(isBridgeDocumentUrl(null)).toBe(false);
  });
});

describe('attachment classification', () => {
  it('treats text families as inlinable', () => {
    expect(isTextLikeAttachment('text/plain', 'a.txt')).toBe(true);
    expect(isTextLikeAttachment('application/json', 'data.json')).toBe(true);
    expect(isTextLikeAttachment('application/octet-stream', 'run.md')).toBe(true);
    expect(isTextLikeAttachment('text/csv', 'x.csv')).toBe(true);
  });

  it('keeps binaries out of the text path', () => {
    expect(isTextLikeAttachment('application/pdf', 'doc.pdf')).toBe(false);
    expect(isTextLikeAttachment('application/msword', 'old.doc')).toBe(false);
    expect(isTextLikeAttachment('image/png', 'shot.png')).toBe(false);
  });

  it('recognizes vision-consumable images', () => {
    expect(isImageAttachment('image/png')).toBe(true);
    expect(isImageAttachment('image/JPEG')).toBe(true);
    expect(isImageAttachment('image/webp')).toBe(true);
    expect(isImageAttachment('image/svg+xml')).toBe(false);
    expect(isImageAttachment('application/pdf')).toBe(false);
  });
});

describe('composeResearchCommand', () => {
  it('passes a clean query through untouched when no attachments', () => {
    expect(composeResearchCommand('  who owns the moon?  ', [])).toBe('who owns the moon?');
  });

  it('inlines bounded text content under a sanitized file tag', () => {
    const cmd = composeResearchCommand('summarize', [
      { name: 'notes<.txt', mime: 'text/plain', size: 12, text: 'hello world' },
    ]);
    expect(cmd).toContain('summarize');
    expect(cmd).toContain('[attached file: notes<.txt — text/plain, 12 B]');
    expect(cmd).toContain('<attached-file name="notes.txt">');
    expect(cmd).toContain('hello world');
  });

  it('announces binaries by metadata only', () => {
    const cmd = composeResearchCommand('analyze', [
      { name: 'doc.pdf', mime: 'application/pdf', size: 2048 },
    ]);
    expect(cmd).toContain('[attached file: doc.pdf — application/pdf, 2.0 KB]');
    expect(cmd).toContain('(binary content');
    expect(cmd).not.toContain('<attached-file');
  });

  it('caps inlined text at the hard limit', () => {
    const big = 'x'.repeat(NEWTAB_ATTACH_INLINE_TEXT_LIMIT + 500);
    const cmd = composeResearchCommand('q', [{ name: 'a.log', mime: 'text/plain', size: big.length, text: big }]);
    expect(cmd.length).toBeLessThan(big.length + 500);
  });
});

describe('name sanitization + formatting', () => {
  it('strips tag-significant characters from file names', () => {
    expect(sanitizeFileName('a<b>c"d\'e&f.xml')).toBe('abcdef.xml');
    expect(sanitizeFileName('')).toBe('file');
  });

  it('formats byte sizes for humans', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(-1)).toBe('?');
  });
});
