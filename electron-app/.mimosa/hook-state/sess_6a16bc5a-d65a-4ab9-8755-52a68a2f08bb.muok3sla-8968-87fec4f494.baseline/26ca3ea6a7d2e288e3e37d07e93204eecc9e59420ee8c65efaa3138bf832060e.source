/**
 * Download state machine — pure logic.
 *
 * Applies a stream of `DownloadEvent`s to maintain a list of `DownloadItemState`s.
 * The runtime `DownloadManager` (Electron-side) listens to `session.on('will-download')`
 * and the subsequent `DownloadItem` events, then calls `apply(event)` here.
 *
 * NO electron import. Fully unit-testable.
 *
 * State transitions:
 *
 *   pending → progressing → completed
 *                       └→ cancelled
 *                       └→ interrupted
 *                       └→ completed (final, no further events accepted)
 */
import type { DownloadItemState, DownloadStateName } from '@shared/browser-types';

export type DownloadEvent =
  | {
      type: 'started';
      id: string;
      url: string;
      filename: string;
      totalBytes: number;
      startTime: number;
      savePath: string | null;
      mimeType: string | null;
      tabId: string | null;
    }
  | {
      type: 'progress';
      id: string;
      receivedBytes: number;
      totalBytes?: number;
    }
  | { type: 'completed'; id: string; endTime: number; savePath?: string | null }
  | { type: 'cancelled'; id: string; endTime: number }
  | { type: 'interrupted'; id: string; endTime: number; error: string }
  | { type: 'removed'; id: string };

const TERMINAL_STATES: ReadonlySet<DownloadStateName> = new Set([
  'completed',
  'cancelled',
  'interrupted',
]);

let _dlIdCounter = 0;
export function generateDownloadId(): string {
  _dlIdCounter += 1;
  return `dl_${Date.now().toString(36)}_${_dlIdCounter.toString(36)}`;
}

export class DownloadStateManager {
  private items = new Map<string, DownloadItemState>();
  private order: string[] = [];

  constructor(
    private idGenerator: () => string = generateDownloadId,
    private limit: number = 500
  ) {}

  /**
   * Apply an event. Returns the resulting state (or null if the event
   * was rejected — e.g. an event for a non-existent id, or a transition
   * out of a terminal state).
   */
  apply(event: DownloadEvent): DownloadItemState | null {
    switch (event.type) {
      case 'started':
        return this.handleStarted(event);
      case 'progress':
        return this.handleProgress(event);
      case 'completed':
        return this.handleCompleted(event);
      case 'cancelled':
        return this.handleCancelled(event);
      case 'interrupted':
        return this.handleInterrupted(event);
      case 'removed':
        return this.handleRemoved(event);
      default: {
        // Exhaustiveness check.
        const _exhaustive: never = event;
        return _exhaustive;
      }
    }
  }

  list(): DownloadItemState[] {
    return this.order
      .map((id) => this.items.get(id))
      .filter((x): x is DownloadItemState => x !== undefined);
  }

  get(id: string): DownloadItemState | null {
    return this.items.get(id) ?? null;
  }

  /** Return all downloads that are NOT in a terminal state. */
  active(): DownloadItemState[] {
    return this.list().filter((d) => !TERMINAL_STATES.has(d.state));
  }

  /** Return all downloads in a terminal state. */
  finished(): DownloadItemState[] {
    return this.list().filter((d) => TERMINAL_STATES.has(d.state));
  }

  /** Remove a download from the in-memory list. Returns true if removed. */
  remove(id: string): boolean {
    if (!this.items.has(id)) return false;
    this.items.delete(id);
    const idx = this.order.indexOf(id);
    if (idx !== -1) this.order.splice(idx, 1);
    return true;
  }

  /** Clear all downloads from memory (does not delete files on disk). */
  clear(): void {
    this.items.clear();
    this.order = [];
  }

  /** Drop oldest entries beyond the configured limit. */
  private enforceLimit(): void {
    while (this.order.length > this.limit) {
      const oldestId = this.order.shift()!;
      this.items.delete(oldestId);
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------
  private handleStarted(
    event: Extract<DownloadEvent, { type: 'started' }>
  ): DownloadItemState | null {
    if (this.items.has(event.id)) {
      // Already exists — reject duplicate 'started' event.
      return null;
    }
    const item: DownloadItemState = {
      id: event.id,
      url: event.url,
      filename: event.filename,
      state: 'pending',
      totalBytes: event.totalBytes,
      receivedBytes: 0,
      startTime: event.startTime,
      endTime: null,
      savePath: event.savePath,
      mimeType: event.mimeType,
      error: null,
      tabId: event.tabId,
    };
    this.items.set(event.id, item);
    this.order.push(event.id);
    this.enforceLimit();
    return item;
  }

  private handleProgress(
    event: Extract<DownloadEvent, { type: 'progress' }>
  ): DownloadItemState | null {
    const item = this.items.get(event.id);
    if (!item) return null;
    if (TERMINAL_STATES.has(item.state)) return null;
    if (item.state === 'pending') item.state = 'progressing';
    if (event.totalBytes !== undefined && event.totalBytes > 0) {
      item.totalBytes = event.totalBytes;
    }
    if (event.receivedBytes > item.receivedBytes) {
      item.receivedBytes = event.receivedBytes;
    }
    return item;
  }

  private handleCompleted(
    event: Extract<DownloadEvent, { type: 'completed' }>
  ): DownloadItemState | null {
    const item = this.items.get(event.id);
    if (!item) return null;
    if (TERMINAL_STATES.has(item.state)) return null;
    item.state = 'completed';
    item.endTime = event.endTime;
    if (event.savePath) item.savePath = event.savePath;
    // If we never saw a progress event, mark bytes as complete.
    if (item.totalBytes > 0 && item.receivedBytes < item.totalBytes) {
      item.receivedBytes = item.totalBytes;
    }
    return item;
  }

  private handleCancelled(
    event: Extract<DownloadEvent, { type: 'cancelled' }>
  ): DownloadItemState | null {
    const item = this.items.get(event.id);
    if (!item) return null;
    if (TERMINAL_STATES.has(item.state)) return null;
    item.state = 'cancelled';
    item.endTime = event.endTime;
    return item;
  }

  private handleInterrupted(
    event: Extract<DownloadEvent, { type: 'interrupted' }>
  ): DownloadItemState | null {
    const item = this.items.get(event.id);
    if (!item) return null;
    if (TERMINAL_STATES.has(item.state)) return null;
    item.state = 'interrupted';
    item.endTime = event.endTime;
    item.error = event.error;
    return item;
  }

  private handleRemoved(
    event: Extract<DownloadEvent, { type: 'removed' }>
  ): DownloadItemState | null {
    const item = this.items.get(event.id);
    if (!item) return null;
    this.remove(event.id);
    return item;
  }
}
