/**
 * New Tab bridge IPC handlers — Main process side.
 *
 * Serves the scoped `__pabNewTab` surface exposed to pab://newtab documents
 * by the tab preload:
 *   - newtab:pickAttachment → native file dialog → opaque descriptor
 *     (name/mime/size + small image thumbnail). No paths reach the renderer.
 *   - newtab:runResearch   → REAL Deep Research run on the agent pipeline
 *     (AgentController, DEEP_RESEARCH profile) with bounded attachment
 *     digests + vision images.
 *
 * SECURITY:
 *   - Every call validates the sender frame URL against
 *     isBridgeDocumentUrl (pab://newtab + pab://search) — web origins are
 *     refused.
 *   - File reads happen here in main with hard caps
 *     (NEWTAB_ATTACH_MAX_TEXT_BYTES); binaries beyond metadata are never
 *     inlined.
 *   - Registry entries are in-memory only, capped, and expire.
 */
import { ipcMain, dialog, BrowserWindow, nativeImage, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import type { AgentController } from './browser/agent/runtime/agent-controller';
import {
  isBridgeDocumentUrl,
  isTextLikeAttachment,
  isImageAttachment,
  composeResearchCommand,
  NEWTAB_ATTACH_MAX_FILES,
  NEWTAB_ATTACH_MAX_IMAGES,
  NEWTAB_ATTACH_MAX_TEXT_BYTES,
  NEWTAB_IMAGE_MAX_EDGE,
  NEWTAB_THUMB_EDGE,
  NEWTAB_RESEARCH_QUERY_MAX,
  type NewTabAttachment,
  type NewTabPickResult,
  type NewTabResearchRequest,
  type NewTabResearchResult,
  type PendingNewTabAttachment,
} from '@shared/newtab-bridge';

/** Pending attachments live at most 30 minutes or until evicted (cap 8). */
const REGISTRY_CAP = 8;
const REGISTRY_TTL_MS = 30 * 60 * 1000;

const FILE_FILTERS = [
  { name: 'Documents & Images', extensions: [
    'pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'tsv', 'json', 'xml', 'log', 'yml', 'yaml', 'ini',
    'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp',
  ] },
];

const registry = new Map<string, PendingNewTabAttachment & { storedAt: number }>();

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
];

/** Shared picker core — native dialog → bounded opaque descriptor. */
async function pickAttachmentCore(kind?: 'file' | 'image'): Promise<NewTabPickResult> {
  if (registry.size >= REGISTRY_CAP + NEWTAB_ATTACH_MAX_FILES) {
    return { attachment: null };
  }
  const dialogOptions: Electron.OpenDialogOptions = {
    title: kind === 'image' ? 'Attach an image' : 'Attach a file or image',
    properties: ['openFile'],
    filters: kind === 'image' ? IMAGE_FILTERS : FILE_FILTERS,
  };
  const picked = await dialog.showOpenDialog(dialogOptions);
  if (picked.canceled || picked.filePaths.length === 0) {
    return { attachment: null };
  }
  const filePath = picked.filePaths[0];
  const name = filePath.split(/[\\/]/).pop() ?? 'file';
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return { attachment: null };

    const attachment: NewTabAttachment = {
      id: randomUUID(),
      name,
      mime: guessMime(name),
      size: info.size,
    };
    const entry: PendingNewTabAttachment = { attachment };

    if (isImageAttachment(attachment.mime)) {
      const img = nativeImage.createFromPath(filePath);
      if (!img.isEmpty()) {
        const thumb =
          img.getSize().width > NEWTAB_THUMB_EDGE || img.getSize().height > NEWTAB_THUMB_EDGE
            ? img.resize({ width: NEWTAB_THUMB_EDGE, height: NEWTAB_THUMB_EDGE, quality: 'good' })
            : img;
        attachment.thumbnail = 'data:image/jpeg;base64,' + thumb.toJPEG(80).toString('base64');

        const full =
          img.getSize().width > NEWTAB_IMAGE_MAX_EDGE || img.getSize().height > NEWTAB_IMAGE_MAX_EDGE
            ? img.resize({ width: NEWTAB_IMAGE_MAX_EDGE, height: NEWTAB_IMAGE_MAX_EDGE, quality: 'good' })
            : img;
        entry.modelImageBase64 = full.toJPEG(85).toString('base64');
      }
    } else if (
      isTextLikeAttachment(attachment.mime, name) &&
      info.size <= NEWTAB_ATTACH_MAX_TEXT_BYTES
    ) {
      entry.text = await readFile(filePath, 'utf-8');
    }

    remember(entry);
    return { attachment };
  } catch {
    return { attachment: null };
  }
}

/**
 * Resolve pending attachment ids (agent panel / newtab) into bounded
 * digests + vision images. Entries are SINGLE-USE: consumed runs drop
 * them so stale files never leak into later runs.
 */
export function resolvePendingAttachments(
  ids: unknown
): { digests: { name: string; mime: string; size: number; text?: string }[]; images: string[] } {
  const list = Array.isArray(ids)
    ? ids.filter((x): x is string => typeof x === 'string').slice(0, NEWTAB_ATTACH_MAX_FILES)
    : [];
  const digests: { name: string; mime: string; size: number; text?: string }[] = [];
  const images: string[] = [];
  for (const id of list) {
    const entry = registry.get(id);
    if (!entry) continue;
    registry.delete(id);
    digests.push({
      name: entry.attachment.name,
      mime: entry.attachment.mime,
      size: entry.attachment.size,
      ...(entry.text ? { text: entry.text } : {}),
    });
    if (entry.modelImageBase64 && images.length < NEWTAB_ATTACH_MAX_IMAGES) {
      images.push(entry.modelImageBase64);
    }
  }
  return { digests, images };
}

/** Sender guard — ONLY the internal newtab document may call. */
function assertNewTabSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? event.sender.getURL();
  return isBridgeDocumentUrl(url);
}

function remember(entry: PendingNewTabAttachment): void {
  // TTL-evict stale picks, then cap the registry (oldest first).
  const now = Date.now();
  for (const [id, e] of registry) {
    if (now - e.storedAt > REGISTRY_TTL_MS) registry.delete(id);
  }
  registry.set(entry.attachment.id, { ...entry, storedAt: now });
  while (registry.size > REGISTRY_CAP) {
    const oldest = registry.keys().next().value;
    if (oldest === undefined) break;
    registry.delete(oldest);
  }
}

export function registerNewTabIpcHandlers(controller: AgentController): void {
  ipcMain.handle(
    'newtab:pickAttachment',
    async (event: IpcMainInvokeEvent, kind?: 'file' | 'image'): Promise<NewTabPickResult> => {
      if (!assertNewTabSender(event)) {
        return { attachment: null };
      }
      return pickAttachmentCore(kind);
    }
  );

  // Agent-panel (chrome renderer) attachment picker — same registry, same
  // caps; the chrome is our trusted contextIsolated UI.
  ipcMain.handle(
    'agent:pickAttachment',
    async (_event: IpcMainInvokeEvent, kind?: 'file' | 'image'): Promise<NewTabPickResult> => {
      return pickAttachmentCore(kind);
    }
  );

  ipcMain.handle(
    'newtab:runResearch',
    async (
      event: IpcMainInvokeEvent,
      req: NewTabResearchRequest
    ): Promise<NewTabResearchResult> => {
      if (!assertNewTabSender(event)) {
        return { started: false, error: 'Refused: not the New Tab page.' };
      }
      const query = typeof req?.query === 'string' ? req.query.trim() : '';
      if (query.length === 0) {
        return { started: false, error: 'Empty query.' };
      }
      if (query.length > NEWTAB_RESEARCH_QUERY_MAX) {
        return { started: false, error: 'Query too long.' };
      }
      const ids = Array.isArray(req?.attachmentIds)
        ? req.attachmentIds.filter((x): x is string => typeof x === 'string').slice(0, NEWTAB_ATTACH_MAX_FILES)
        : [];

      const digests = [];
      const images: string[] = [];
      for (const id of ids) {
        const entry = registry.get(id);
        if (!entry) continue;
        digests.push({
          name: entry.attachment.name,
          mime: entry.attachment.mime,
          size: entry.attachment.size,
          text: entry.text,
        });
        if (entry.modelImageBase64 && images.length < NEWTAB_ATTACH_MAX_IMAGES) {
          images.push(entry.modelImageBase64);
        }
      }

      const command = composeResearchCommand(query, digests);
      const runPromise = controller.run({
        command,
        profile: 'DEEP_RESEARCH',
        ...(images.length > 0 ? { images } : {}),
      });

      // The run promise settles when the whole research finishes (minutes).
      // Synchronous refusals (HUMAN mode / provider missing / already
      // running / invalid query) resolve on the same tick — surface them
      // honestly instead of making the page wait silently.
      const early = await Promise.race([
        runPromise.then((r) => ({ done: true as const, r })),
        new Promise<{ done: false }>((resolve) =>
          setTimeout(() => resolve({ done: false }), 400)
        ),
      ]);
      if (early.done) {
        if (early.r.state === 'FAILED') {
          return { started: false, error: friendlyRunError(early.r.error) };
        }
        return { started: true };
      }
      return { started: true };
    }
  );
}

function friendlyRunError(error: string | null | undefined): string {
  if (!error) return 'Deep Research could not start.';
  if (error.includes('HUMAN')) {
    return 'Switch to AGENT mode (top bar) to run Deep Research.';
  }
  if (error.includes('AI_PROVIDER_NOT_CONFIGURED')) {
    return 'AI provider is not configured — set it up before running Deep Research.';
  }
  if (error.includes('already active')) {
    return 'An agent run is already active — stop it first.';
  }
  return 'Deep Research: ' + error;
}

function guessMime(name: string): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, string> = {
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values',
    log: 'text/plain', json: 'application/json', xml: 'application/xml',
    yml: 'text/yaml', yaml: 'text/yaml', ini: 'text/plain',
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
  };
  return map[ext] ?? 'application/octet-stream';
}
