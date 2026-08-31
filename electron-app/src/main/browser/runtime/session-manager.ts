/**
 * SessionManager — owns Electron session partition selection.
 *
 * Two kinds:
 *   - `default`: persistent normal session.
 *   - `incognito`: in-memory partition, cleared on close.
 *
 * DEFERRED_RUNTIME: imports `electron`. Not unit-tested directly; the
 * selection logic (which partition name corresponds to which kind) is
 * trivial and covered by integration tests of BrowserCore on Windows.
 *
 * SECURITY: incognito partitions use Electron's `partition: 'persist:...'`
 * vs `'memory:...'` semantics. We never persist incognito cookies/state.
 *
 * INCognito autofill and history behaviour are enforced at the
 * HistoryStore / Vault layers (PROMPT 6/7), NOT here.
 */
import { session, Session } from 'electron';
import type { SessionKind } from '@shared/browser-types';

const DEFAULT_PARTITION = 'default'; // Electron's persistent default session.
const INCOGNITO_PARTITION_PREFIX = 'memory:incognito-';

const incognitoPartitions = new Set<string>();

export class SessionManager {
  /**
   * Get or create a session for the given kind.
   * For `incognito`, a fresh in-memory partition is created each call.
   */
  forKind(kind: SessionKind): Session {
    if (kind === 'default') {
      return session.fromPartition(DEFAULT_PARTITION);
    }
    // Incognito: use a unique memory partition per call so each session is
    // isolated from the next.
    const partition = `${INCOGNITO_PARTITION_PREFIX}${Date.now().toString(36)}`;
    incognitoPartitions.add(partition);
    return session.fromPartition(partition, { cache: false });
  }

  /**
   * Discard all known incognito partitions. Called on app quit or when the
   * last incognito window closes.
   */
  async discardIncognito(): Promise<void> {
    for (const partition of incognitoPartitions) {
      try {
        const s = session.fromPartition(partition);
        await s.clearStorageData();
        await s.clearCache();
        await s.clearHostResolverCache();
        await s.clearAuthCache();
      } catch (err) {
        // Best-effort: log and continue.
        console.error('[session-manager] failed to clear incognito partition', err);
      }
    }
    incognitoPartitions.clear();
  }

  /**
   * Configure a session's download behaviour.
   *
   * We do NOT register a `will-download` hook here — that's the
   * `DownloadManager.attach(session)` job. Once the DownloadManager is
   * attached, Electron suppresses the built-in save dialog automatically
   * because the DownloadItem's path is set programmatically by our handler.
   *
   * This method exists so future per-session configuration (e.g. CSP headers,
   * permission policy) can be added in one place.
   */
  configureForBrowser(_s: Session): void {
    // No-op for V1. Reserved for future per-session configuration.
  }
}
