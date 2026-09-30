/**
 * DarkWebDownloadManager — quarantine for downloads from onion tabs
 * (spec §14).
 *
 * FLOW:
 *   1. `attach(session)` intercepts will-download on dark-web sessions and
 *      redirects the item into a quarantine directory (userData/darkweb/
 *      quarantine). Nothing lands in the user's Downloads folder and
 *      nothing is ever executed or opened.
 *   2. Metadata (filename, MIME, size, source URL, dangerous-flag) is
 *      listed by the pab://darkweb page.
 *   3. "Save as…" shows a real save dialog and COPIES the file there —
 *      a separate, explicit user action. "Discard" deletes the quarantine
 *      copy.
 *   4. On app quit every still-quarantined file is wiped.
 *
 * Executable/archive extensions get `dangerous: true` — the UI shouts, the
 * main process still simply never runs anything.
 */
import { dialog, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Session, DownloadItem } from 'electron';
import type { DarkWebDownloadInfo } from '@shared/darkweb-types';
import type { DarkWebDownloadStore } from '../runtime/darkweb-pab-api';

const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.msi', '.dll', '.scr', '.bat', '.cmd', '.ps1', '.apk', '.jar',
  '.iso', '.vbs', '.com', '.pif', '.hta', '.lnk', '.reg',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.cab',
]);

interface QuarantineRecord extends DarkWebDownloadInfo {
  quarantinePath: string | null;
}

export class DarkWebDownloadManager implements DarkWebDownloadStore {
  private readonly records = new Map<string, QuarantineRecord>();
  private readonly quarantineDir: string;
  private readonly genId = (): string => `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  constructor(userDataDir: string) {
    this.quarantineDir = path.join(userDataDir, 'darkweb', 'quarantine');
  }

  /** Intercept downloads on a dark-web session. Call once per session. */
  attach(session: Session): void {
    session.on('will-download', (_event, item) => {
      this.intercept(item);
    });
  }

  private intercept(item: DownloadItem): void {
    const id = this.genId();
    const filename = sanitizeFilename(item.getFilename());
    // Electron suppresses its own dialog once setSavePath is called — the
    // download lands in quarantine silently and waits for the user.
    const quarantinePath = path.join(this.quarantineDir, `${id}-${filename}`);
    try {
      item.setSavePath(quarantinePath);
    } catch {
      item.cancel();
      return;
    }
    const record: QuarantineRecord = {
      id,
      filename,
      mimeType: item.getMimeType() || null,
      sizeBytes: 0,
      sourceUrl: item.getURL(),
      receivedAt: Date.now(),
      state: 'QUARANTINED',
      dangerous: DANGEROUS_EXTENSIONS.has(path.extname(filename).toLowerCase()),
      quarantinePath,
    };
    this.records.set(id, record);

    item.once('done', (_e, state) => {
      if (state === 'completed') {
        record.sizeBytes = item.getTotalBytes();
        record.state = 'QUARANTINED';
      } else {
        record.state = 'BLOCKED';
        void fs.rm(quarantinePath, { force: true }).catch(() => {});
      }
    });
  }

  list(): DarkWebDownloadInfo[] {
    return [...this.records.values()].map(({ quarantinePath: _q, ...pub }) => pub);
  }

  /** Explicit "Save as…" — copies the quarantine file to the chosen path. */
  async save(id: string): Promise<{ ok: boolean; reason?: string }> {
    const rec = this.records.get(id);
    if (!rec) return { ok: false, reason: 'NOT_FOUND' };
    if (rec.state !== 'QUARANTINED') return { ok: false, reason: rec.state };
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win, {
      defaultPath: rec.filename,
      buttonLabel: 'Save download',
    });
    if (result.canceled || !result.filePath) return { ok: false, reason: 'CANCELLED' };
    try {
      await fs.mkdir(path.dirname(result.filePath), { recursive: true });
      await fs.copyFile(rec.quarantinePath!, result.filePath);
      rec.state = 'SAVED';
      await fs.rm(rec.quarantinePath!, { force: true });
      rec.quarantinePath = null;
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message.slice(0, 120) : 'SAVE_FAILED' };
    }
  }

  discard(id: string): boolean {
    const rec = this.records.get(id);
    if (!rec || rec.state !== 'QUARANTINED') return false;
    void fs.rm(rec.quarantinePath!, { force: true }).catch(() => {});
    rec.state = 'DISCARDED';
    rec.quarantinePath = null;
    return true;
  }

  /** Wipe still-quarantined files (app quit). Never touches saved copies. */
  async cleanup(): Promise<void> {
    for (const rec of this.records.values()) {
      if (rec.quarantinePath) {
        await fs.rm(rec.quarantinePath, { force: true }).catch(() => {});
        rec.quarantinePath = null;
      }
    }
    await fs.rm(this.quarantineDir, { recursive: true, force: true }).catch(() => {});
  }
}

function sanitizeFilename(name: string): string {
  const base = path.basename(String(name ?? 'download'));
  // Strip path tricks and control chars; keep it recognizable.
  // eslint-disable-next-line no-control-regex -- control chars are exactly what we strip
  return base.replace(/[\x00-\x1f<>:"|?*]/g, '_').slice(0, 120) || 'download';
}

/** Ensure the quarantine dir exists before the first download lands. */
export async function prepareQuarantineDir(userDataDir: string): Promise<void> {
  await fs.mkdir(path.join(userDataDir, 'darkweb', 'quarantine'), { recursive: true }).catch(() => {});
}
