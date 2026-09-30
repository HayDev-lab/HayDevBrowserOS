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
import { buildSiteUserAgent } from '../pure/site-user-agent';

const DEFAULT_PARTITION = 'default'; // Electron's persistent default session.
const INCOGNITO_PARTITION_PREFIX = 'memory:incognito-';
const DARKWEB_PARTITION_PREFIX = 'memory:darkweb-';

const incognitoPartitions = new Set<string>();
const darkWebPartitions = new Set<string>();

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
   * Dark-web tab session (spec §16/§18): a FRESH in-memory partition per
   * tab — cookies/storage/localStorage never persist, never touch the
   * normal profile, and never mix with the user's clearnet identity.
   *
   * The SOCKS5 (Tor) proxy is applied by `configureDarkWebSession` — with
   * loopback forced through the proxy (`<-loopback>` bypass rule), so a
   * dark-web page CANNOT quietly reach local services: everything either
   * goes through Tor or fails (fail-closed, spec §11/§33/§57).
   */
  forDarkWeb(): Session {
    const partition = `${DARKWEB_PARTITION_PREFIX}${Date.now().toString(36)}`;
    darkWebPartitions.add(partition);
    return session.fromPartition(partition, { cache: false });
  }

  /** Fixed SOCKS5 (Tor) proxy on a dark-web session; no direct path remains. */
  configureDarkWebSession(s: Session, socksHost: string, socksPort: number): void {
    void s.setProxy({
      mode: 'fixed_servers',
      proxyRules: `socks5://${socksHost}:${socksPort}`,
      // '<-loopback>' re-enables proxying for loopback (Chromium bypasses it
      // by default) — SSRF targets fail in Tor instead of hitting localhost.
      proxyBypassRules: '<-loopback>',
    });
    s.setUserAgent(buildSiteUserAgent(s.getUserAgent()));
    // Spec §16: deny every privileged API on dark-web sessions.
    s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    s.setPermissionCheckHandler(() => false);
    s.setSpellCheckerEnabled?.(false);
  }

  /**
   * Discard all known ephemeral partitions. Called on app quit or when the
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
    await this.discardDarkWeb();
  }

  /** Wipe every dark-web partition (storage + cache + resolver). */
  async discardDarkWeb(): Promise<void> {
    for (const partition of darkWebPartitions) {
      try {
        const s = session.fromPartition(partition);
        await s.clearStorageData();
        await s.clearCache();
        await s.clearHostResolverCache();
        await s.clearAuthCache();
      } catch (err) {
        console.error('[session-manager] failed to clear darkweb partition', err);
      }
    }
    darkWebPartitions.clear();
  }

  /**
   * Configure a session for browsing.
   *
   * User-Agent: sites parse the UA for the browser FAMILY and reject
   * unknown products ("Electron") regardless of engine version (WhatsApp
   * demands "Chrome 100+" but blocks us on Chromium 152 while the shell
   * tokens are present). Present the engine only — the Chrome/Chromium
   * version stays honest, just the embedding-shell tokens are hidden.
   *
   * We do NOT register a `will-download` hook here — that's the
   * `DownloadManager.attach(session)` job. Once the DownloadManager is
   * attached, Electron suppresses the built-in save dialog automatically
   * because the DownloadItem's path is set programmatically by our handler.
   */
  configureForBrowser(s: Session): void {
    s.setUserAgent(buildSiteUserAgent(s.getUserAgent()));
  }
}
