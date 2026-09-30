/**
 * DownloadManager — Electron-runtime listener that translates
 * `session.on('will-download')` and `DownloadItem` events into our
 * pure `DownloadStateManager` events.
 *
 * DEFERRED_RUNTIME: imports `electron`. The state machine itself is
 * unit-tested (see tests/download-state-machine.test.ts).
 */
import type { Session, DownloadItem } from 'electron';
import {
  DownloadStateManager,
  generateDownloadId,
  type DownloadEvent,
} from '../pure/download-state-machine';
import type { DownloadItemState } from '@shared/browser-types';

export interface DownloadManagerEvents {
  onStarted?: (item: DownloadItemState) => void;
  onProgress?: (item: DownloadItemState) => void;
  onCompleted?: (item: DownloadItemState) => void;
  onCancelled?: (item: DownloadItemState) => void;
  onInterrupted?: (item: DownloadItemState) => void;
  onRemoved?: (id: string) => void;
}

export class DownloadManager {
  // Map Electron DownloadItem -> our id. We use a WeakMap so the entry is
  // GC'd when the underlying item is destroyed.
  private readonly itemToId = new WeakMap<DownloadItem, string>();

  constructor(
    private readonly state: DownloadStateManager,
    private readonly events: DownloadManagerEvents = {},
    private readonly now: () => number = () => Date.now(),
    private readonly idGenerator: () => string = generateDownloadId
  ) {}

  /**
   * Attach to a session. Should be called once per session at startup.
   */
  attach(s: Session): void {
    s.on('will-download', (_evt, item, _webContents) => {
      this.handleWillDownload(item);
    });
  }

  /**
   * Public API: cancel an in-progress download by id.
   * Returns true if a matching DownloadItem is still alive.
   */
  cancel(id: string): boolean {
    const item = this.findItemById(id);
    if (!item) return false;
    item.cancel();
    return true;
  }

  /**
   * Public API: remove a download from our state (does not delete the file).
   */
  remove(id: string): boolean {
    const removed = this.state.apply({ type: 'removed', id });
    if (removed) {
      this.events.onRemoved?.(id);
      return true;
    }
    return false;
  }

  list(): DownloadItemState[] {
    return this.state.list();
  }

  get(id: string): DownloadItemState | null {
    return this.state.get(id);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  // We keep a parallel Map<id, DownloadItem> for cancel() lookups. Strong
  // references here are acceptable because the lifetime is bounded by the
  // download's lifetime; we delete on terminal events.
  private readonly idToItem = new Map<string, DownloadItem>();

  private findItemById(id: string): DownloadItem | null {
    return this.idToItem.get(id) ?? null;
  }

  private handleWillDownload(item: DownloadItem): void {
    const id = this.idGenerator();
    this.itemToId.set(item, id);
    this.idToItem.set(id, item);

    const startedEvent: DownloadEvent = {
      type: 'started',
      id,
      url: item.getURLChain()[0] ?? item.getURL(),
      filename: item.getFilename(),
      totalBytes: item.getTotalBytes(),
      startTime: this.now(),
      savePath: item.getSavePath() || null,
      mimeType: item.getMimeType() || null,
      tabId: null, // We don't track the originating tab in V1.
    };
    const started = this.state.apply(startedEvent);
    if (started) this.events.onStarted?.(started);

    item.on('updated', (_evt, state) => {
      if (state === 'progressing') {
        const progress = this.state.apply({
          type: 'progress',
          id,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
        });
        if (progress) this.events.onProgress?.(progress);
      } else if (state === 'interrupted') {
        const interrupted = this.state.apply({
          type: 'interrupted',
          id,
          endTime: this.now(),
          // Electron's DownloadItem does not expose the underlying error code
          // via a stable public method across all supported versions; we use
          // the state name itself as the error string for V1.
          error: 'interrupted',
        });
        if (interrupted) this.events.onInterrupted?.(interrupted);
      }
    });

    item.once('done', (_evt, state) => {
      if (state === 'completed') {
        const completed = this.state.apply({
          type: 'completed',
          id,
          endTime: this.now(),
          savePath: item.getSavePath(),
        });
        if (completed) this.events.onCompleted?.(completed);
      } else if (state === 'cancelled') {
        const cancelled = this.state.apply({
          type: 'cancelled',
          id,
          endTime: this.now(),
        });
        if (cancelled) this.events.onCancelled?.(cancelled);
      }
      // Cleanup the strong reference to the DownloadItem.
      this.idToItem.delete(id);
    });
  }
}
