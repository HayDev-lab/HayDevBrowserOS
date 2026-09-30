/**
 * New Tab bridge — shared contracts for the scoped pab://newtab ↔ main IPC.
 *
 * The Matrix New Tab page (served by the pab:// protocol handler, running in
 * a sandboxed WebContentsView) needs exactly two privileged operations:
 *   1. picking a search/research attachment (native file dialog), and
 *   2. starting a Deep Research run on the REAL agent pipeline.
 *
 * Both are exposed by the tab preload ONLY on pab://newtab documents and are
 * re-validated against the sender URL in the main-process handlers.
 *
 * SECURITY:
 *   - No arbitrary filesystem access: the renderer never sees paths; it only
 *     receives opaque attachment descriptors (name/mime/size/thumbnail).
 *   - File reads happen in the MAIN process with hard size caps.
 *   - `isNewTabDocumentUrl` is the single source of truth for origin checks.
 *
 * Pure — no Electron imports (used by preload, main, and tests).
 */

/** Opaque descriptor for a picked attachment (no filesystem paths leak). */
export interface NewTabAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Small JPEG data-URL thumbnail — images only. */
  thumbnail?: string;
}

export interface NewTabResearchRequest {
  query: string;
  attachmentIds: string[];
}

export interface NewTabResearchResult {
  started: boolean;
  /** Human-readable failure reason (HUMAN mode, provider missing, …). */
  error?: string;
}

/** Result of the attachment picker — `attachment` is null when cancelled. */
export interface NewTabPickResult {
  attachment: NewTabAttachment | null;
}

/** Main-side view of a pending attachment (registry entry). */
export interface PendingNewTabAttachment {
  attachment: NewTabAttachment;
  /** Bounded utf-8 text excerpt for text-like files (no path leaves main). */
  text?: string;
  /** Full-size (≤1024px) JPEG base64 for vision models — images only. */
  modelImageBase64?: string;
}

/** Hard caps — enforced in the MAIN process, mirrored into the page script. */
export const NEWTAB_ATTACH_MAX_FILES = 4;
export const NEWTAB_ATTACH_MAX_TEXT_BYTES = 256 * 1024; // 256 KB read cap
export const NEWTAB_ATTACH_INLINE_TEXT_LIMIT = 24 * 1024; // 24 KB inline cap
export const NEWTAB_ATTACH_MAX_IMAGES = 2;
export const NEWTAB_IMAGE_MAX_EDGE = 1024;
export const NEWTAB_THUMB_EDGE = 192;
export const NEWTAB_RESEARCH_QUERY_MAX = 2_000;

/** True only for the internal newtab document (pab://newtab, optional /?query). */
export function isNewTabDocumentUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^pab:\/\/newtab\/?(\?.*)?$/i.test(url.trim());
}

/**
 * True for any internal document allowed to hold the attachment/research
 * bridge: the Matrix New Tab AND the HayDev Search chat (pab://search) —
 * the search page hosts the mode switcher whose Deep Research button needs
 * the bridge. Both are our own pab:// pages served by the protocol handler;
 * no web origin can ever match.
 */
export function isBridgeDocumentUrl(url: string | null | undefined): boolean {
  if (isNewTabDocumentUrl(url)) return true;
  if (!url) return false;
  return /^pab:\/\/search\/?(\?.*)?$/i.test(url.trim());
}

/** Text-like attachments whose content can be safely inlined into a command. */
export function isTextLikeAttachment(mime: string, name: string): boolean {
  if (/^text\//i.test(mime)) return true;
  if (/(json|xml|csv|md|txt|log|ya?ml|ini|tsv)$/i.test(name.split('.').pop() ?? '')) {
    return true;
  }
  return /json|xml|csv/i.test(mime);
}

/** True for image attachments the vision path can consume. */
export function isImageAttachment(mime: string): boolean {
  return /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(mime);
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '?';
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / (1024 * 1024)).toFixed(1) + ' MB';
}

export interface ResearchAttachmentDigest {
  name: string;
  mime: string;
  size: number;
  text?: string;
}

/**
 * Compose the Deep Research command from the user query + bounded attachment
 * digests. Text-like content is inlined (capped); binaries are announced by
 * metadata only. Pure string assembly — no secrets, no paths.
 */
export function composeResearchCommand(
  query: string,
  attachments: ResearchAttachmentDigest[]
): string {
  const parts: string[] = [query.trim()];
  for (const a of attachments) {
    const header = `[attached file: ${a.name} — ${a.mime || 'unknown type'}, ${formatBytes(a.size)}]`;
    if (a.text && a.text.length > 0) {
      const inline = a.text.slice(0, NEWTAB_ATTACH_INLINE_TEXT_LIMIT);
      parts.push(`${header}\n<attached-file name="${sanitizeFileName(a.name)}">\n${inline}\n</attached-file>`);
    } else {
      parts.push(`${header}\n(binary content — analyze using this file's metadata)`);
    }
  }
  return parts.join('\n\n');
}

/** Keep attachment names out of tag-like positions in the composed command. */
export function sanitizeFileName(name: string): string {
  return name.replace(/[<>"'&]/g, '').slice(0, 80) || 'file';
}
