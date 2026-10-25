import haydevLogo from '../assets/haydev-logo.png';
import { useEffect, useState } from 'react';
import { platformApi } from '../platform';
import type { ShieldStatus } from '@shared/ipc-types';
/**
 * TopBar — cohesive top browser surface (Matrix concept, 3 rows):
 *   row 0  title bar: brand + status + window controls (frameless)
 *   row 1  tab strip: [New Tab][WhatsApp][Telegram][+] card tabs
 *   row 2  toolbar: nav buttons | address bar | bookmark/history/downloads/
 *          vault | HUMAN | AGENT
 *
 * Navigation controls live in the browser toolbar, where AGENT, search and
 * Vault are already exposed. The title bar remains a status surface only.
 */
import type { TabState, WebAppPin } from '@shared/browser-types';
import type { PanelKind, ControlMode } from '../store/ui-logic';
import { TabStrip } from './TabStrip';
import { CommandBar } from './CommandBar';
import { ControlModule } from './ControlModule';
import { IncognitoBadge } from './IncognitoBadge';
import { useI18n, LOCALE_LABELS } from '../i18n';
import { getIncognitoVisualState, getAppIncognitoModifier } from '../store/ui-logic';

interface TopBarProps {
  tabs: TabState[];
  activeTabId: string | null;
  activeTab: TabState | null;
  activePanel: PanelKind;
  historyCount: number;
  bookmarksCount: number;
  downloadsCount: number;
  controlMode: ControlMode;
  agentRunning: boolean;
  online: boolean;
  onOpenTab: () => void;
  onOpenWebApp: (app: WebAppPin) => void;
  onCloseTab: (tabId: string) => void;
  onActivateTab: (tabId: string) => void;
  onNavigate: (tabId: string, input: string) => void;
  onOpenUrl: (url: string) => void;
  onBack: (tabId: string) => void;
  onForward: (tabId: string) => void;
  onReload: (tabId: string) => void;
  onStop: (tabId: string) => void;
  onAddBookmark: () => void;
  onTogglePanel: (kind: PanelKind) => void;
  onSetControlMode: (mode: ControlMode) => void;
  onTakeControl: () => void;
  agentPanelOpen: boolean;
  onToggleAgentPanel: () => void;
}

export function TopBar(props: TopBarProps) {
  const { t, lang, cycleLang } = useI18n();
  const incognito = getIncognitoVisualState(props.tabs, props.activeTabId);
  const incognitoMod = getAppIncognitoModifier(incognito);

  return (
    <div className={`topbar ${incognitoMod}`}>
      <div className="titlebar">
        <div className="titlebar__brand">
          <BrandGlyph />
          <div className="titlebar__brand-text">
            <span className="titlebar__name">HayDev Browser OS</span>
            <span className="titlebar__tagline">{t('topbar.tagline')}</span>
          </div>
        </div>
        <div className="titlebar__status">
          <ShieldPill />
          <FingerprintPill />
          <span className={`titlebar__pill ${props.online ? 'titlebar__pill--ok' : 'titlebar__pill--down'}`}
            title={props.online ? t('topbar.onlineTipOk') : t('topbar.onlineTipDown')}>
            <span className="titlebar__dot" aria-hidden />
            {t('topbar.online')}
          </span>
          <span className="titlebar__pill" title={t('topbar.localTip')}>
            <span className="titlebar__dot titlebar__dot--dim" aria-hidden />
            {t('topbar.local')}
          </span>
          <span className="titlebar__pill" title={t('topbar.secureTip')}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <rect x="4" y="10" width="16" height="11" rx="2"></rect>
              <path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
            </svg>
            {t('topbar.secure')}
          </span>
          <button type="button" className="titlebar__pill titlebar__pill--btn" title={t('topbar.langTip')}
            aria-label={t('topbar.langTip')}
            onClick={cycleLang}>
            {LOCALE_LABELS[lang]}
          </button>
        </div>
        <div className="titlebar__wincontrols">
          <button type="button" className="titlebar__winbtn" aria-label={t('topbar.minimize')} title={t('topbar.minimize')}
            onClick={() => platformApi.window.minimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
          <button type="button" className="titlebar__winbtn" aria-label={t('topbar.maximize')} title={t('topbar.maximize')}
            onClick={() => platformApi.window.toggleMaximize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
          <button type="button" className="titlebar__winbtn titlebar__winbtn--close" aria-label={t('topbar.close')} title={t('topbar.close')}
            onClick={() => platformApi.window.close()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
        </div>
      </div>
      <div className="topbar__row topbar__row--tabs">
        <TabStrip
          tabs={props.tabs}
          activeTabId={props.activeTabId}
          onOpenTab={props.onOpenTab}
          onOpenWebApp={props.onOpenWebApp}
          onCloseTab={props.onCloseTab}
          onActivateTab={props.onActivateTab}
        />
      </div>
      <div className="topbar__row topbar__row--toolbar">
        <CommandBar
          tab={props.activeTab}
          onNavigate={props.onNavigate}
          onBack={props.onBack}
          onForward={props.onForward}
          onReload={props.onReload}
          onStop={props.onStop}
        />
        <div className="topbar__actions">
          <IncognitoBadge state={incognito} />
          {props.activeTab?.isDarkWeb && <OnionBadge />}
          <ActionToggle
            glyph="★"
            label={t('topbar.bookmark')}
            iconOnly
            onClick={props.onAddBookmark}
            disabled={!props.activeTab?.url}
            title={t('topbar.bookmarkTip')}
          />
          <ActionToggle
            glyph=" ⟳ "
            label={t('topbar.history')}
            count={props.historyCount}
            active={props.activePanel === 'history'}
            onClick={() => props.onTogglePanel('history')}
            title={t('topbar.historyTip')}
          />
          <ActionToggle
            glyph=" ☆ "
            label={t('topbar.bookmarks')}
            count={props.bookmarksCount}
            active={props.activePanel === 'bookmarks'}
            onClick={() => props.onTogglePanel('bookmarks')}
            title={t('topbar.bookmarksTip')}
          />
          <ActionToggle
            glyph=" ↓ "
            label={t('topbar.downloads')}
            count={props.downloadsCount}
            active={props.activePanel === 'downloads'}
            onClick={() => props.onTogglePanel('downloads')}
            title={t('topbar.downloadsTip')}
          />
          <ActionToggle
            glyph=" 🔒 "
            label={t('topbar.vault')}
            active={props.activePanel === 'vault'}
            onClick={() => props.onTogglePanel('vault')}
            title={t('topbar.vaultTip')}
          />
        </div>
        <ControlModule
          mode={props.controlMode}
          agentRunning={props.agentRunning}
          onSetMode={props.onSetControlMode}
          onTakeControl={props.onTakeControl}
          agentPanelOpen={props.agentPanelOpen}
          onToggleAgentPanel={props.onToggleAgentPanel}
          slim
        />
      </div>
      <div className="chrome-page-border" aria-hidden="true" />
    </div>
  );
}

function BrandGlyph() {
  return (
    <span className="titlebar__glyph" aria-hidden="true">
      <img src={haydevLogo} alt="" className="titlebar__glyph-img" draggable={false} />
    </span>
  );
}

/**
 * Spec §67 — persistent visual indicator while the user is in an onion tab,
 * so a Tor session is never confused with the normal internet.
 */
function OnionBadge() {
  const { t } = useI18n();
  return (
    <span
      className="onion-badge"
      title={t('topbar.onionTip')}
    >
      ONION · TOR
    </span>
  );
}

interface ActionToggleProps {
  glyph: string;
  label: string;
  count?: number;
  active?: boolean;
  disabled?: boolean;
  /** Hide the text label (glyph-only button, concept style). */
  iconOnly?: boolean;
  title: string;
  onClick: () => void;
}

function ActionToggle({
  glyph,
  label,
  count,
  active = false,
  disabled = false,
  iconOnly = false,
  title,
  onClick,
}: ActionToggleProps) {
  return (
    <button
      type="button"
      className={`action-toggle ${active ? 'action-toggle--active' : ''} ${
        iconOnly ? 'action-toggle--icon' : ''
      }`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={title}
    >
      <span className="action-toggle__glyph" aria-hidden>
        {glyph}
      </span>
      {!iconOnly && <span className="action-toggle__label">{label}</span>}
      {typeof count === 'number' && count > 0 && (
        <span className="action-toggle__count" aria-label={`${count} items`}>
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * ShieldPill — real block counter (PROMPT 07). Live stats via the
 * `shield:stats` push; click toggles the shield. The tooltip states the
 * HONEST scope: a basic ad/tracker domain blocklist, not a full uBlock.
 */
/**
 * FingerprintPill — runtime toggle for the fingerprint-noise layer applied
 * to NEW private webviews (canvas/audio/ClientRects/WebGL/hardware/timezone
 * spoofing). ON = harden; OFF = plain WebView2 surface. The choice persists
 * in privacy.json; a switch never touches already-open tabs.
 */
function FingerprintPill() {
  const [noise, setNoise] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void platformApi.privacy
      .status()
      .then((s) => {
        if (alive) setNoise(s.fingerprintNoise);
      })
      .catch(() => {
        if (alive) setNoise(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  const toggle = () => {
    const next = !(noise ?? true);
    setNoise(next); // optimistic; the host answers in ms
    void platformApi.privacy
      .setFingerprintNoise(next)
      .then((r) => setNoise(r.fingerprintNoise))
      .catch(() => setNoise(noise));
  };
  const on = noise ?? true;
  return (
    <button
      type="button"
      className={`titlebar__pill titlebar__pill--btn ${on ? '' : 'titlebar__pill--down'}`}
      title="Fingerprint noise (private tabs): spoof canvas/audio/WebGL/hardware — applies to NEW private tabs"
      data-testid="fingerprint-pill"
      onClick={toggle}
    >
      <span className="titlebar__dot titlebar__dot--dim" aria-hidden />
      <span>FP {on ? 'ON' : 'OFF'}</span>
    </button>
  );
}

function ShieldPill() {
  const { t } = useI18n();
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<ShieldStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void platformApi.shield
      .status()
      .then((s) => {
        if (alive) setStatus(s);
      })
      .catch(() => setError(true));
    const off = platformApi.on('shield:stats', (data) => {
      setStatus(data as ShieldStatus);
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  const enabled = status?.enabled ?? false;
  const unavailable = !status || error || status.protectedTabs === 0 || !!status.storeError;
  const blocked = status?.totalBlocked ?? 0;
  const tip = t(unavailable ? 'shield.unavailable' : enabled ? 'shield.on' : 'shield.off', { count: blocked });
  return (
    <button
      type="button"
      className={`titlebar__pill titlebar__pill--btn ${enabled ? '' : 'titlebar__pill--down'}`}
      title={tip}
      data-testid="shield-pill"
      onClick={() => {
        void platformApi.shield
          .setEnabled(!enabled)
          .then((r) => {
            if (r.accepted) {
              return platformApi.shield.status().then(setStatus);
            }
            return undefined;
          })
          .catch(() => setError(true));
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z"></path>
      </svg>
      {unavailable ? 'Shield ⚠' : `Shield${blocked > 0 ? ` · ${blocked}` : ''}`}
    </button>
  );
}
