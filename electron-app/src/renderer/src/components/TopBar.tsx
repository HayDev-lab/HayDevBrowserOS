import haydevLogo from '../assets/haydev-logo.png';
import { platformApi } from '../platform';
/**
 * TopBar — cohesive top browser surface (Matrix concept, 3 rows):
 *   row 0  title bar: brand + tagline | THINK RESEARCH BUILD AUTOMATE |
 *          ONLINE · LOCAL · SECURE · SETTINGS | window controls (frameless)
 *   row 1  tab strip: [New Tab][WhatsApp][Telegram][+] card tabs
 *   row 2  toolbar: nav buttons | address bar | bookmark/history/downloads/
 *          vault | HUMAN | AGENT
 */
import type { TabState, WebAppPin } from '@shared/browser-types';
import type { PanelKind, ControlMode } from '../store/ui-logic';
import { TabStrip } from './TabStrip';
import { CommandBar } from './CommandBar';
import { ControlModule } from './ControlModule';
import { IncognitoBadge } from './IncognitoBadge';
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
  onNavAction: (action: 'think' | 'research' | 'build' | 'automate' | 'settings') => void;
}

export function TopBar(props: TopBarProps) {
  const incognito = getIncognitoVisualState(props.tabs, props.activeTabId);
  const incognitoMod = getAppIncognitoModifier(incognito);

  return (
    <div className={`topbar ${incognitoMod}`}>
      <div className="titlebar">
        <div className="titlebar__brand">
          <BrandGlyph />
          <div className="titlebar__brand-text">
            <span className="titlebar__name">HayDev Browser OS</span>
            <span className="titlebar__tagline">Your Intelligence Layer</span>
          </div>
        </div>
        <nav className="titlebar__nav" aria-label="Quick actions">
          <TitleNavLink label="THINK" title="Focus the agent input" onClick={() => props.onNavAction('think')} />
          <TitleNavLink label="RESEARCH" title="Open HayDev Search" onClick={() => props.onNavAction('research')} />
          <TitleNavLink label="BUILD" title="Open the Credential Vault" onClick={() => props.onNavAction('build')} />
          <TitleNavLink label="AUTOMATE" title="Switch to AGENT mode" onClick={() => props.onNavAction('automate')} />
        </nav>
        <div className="titlebar__status">
          <span className={`titlebar__pill ${props.online ? 'titlebar__pill--ok' : 'titlebar__pill--down'}`}
            title={props.online ? 'Network reachable' : 'No network connection'}>
            <span className="titlebar__dot" aria-hidden />
            ONLINE
          </span>
          <span className="titlebar__pill" title="Managed runtimes on localhost (Perplexica · SearXNG · Tor)">
            <span className="titlebar__dot titlebar__dot--dim" aria-hidden />
            LOCAL
          </span>
          <span className="titlebar__pill" title="Sandboxed renderer, isolated sessions, encrypted vault">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <rect x="4" y="10" width="16" height="11" rx="2"></rect>
              <path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
            </svg>
            SECURE
          </span>
          <button type="button" className="titlebar__pill titlebar__pill--btn" title="Vault & security settings"
            onClick={() => props.onNavAction('settings')}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            SETTINGS
          </button>
        </div>
        <div className="titlebar__wincontrols">
          <button type="button" className="titlebar__winbtn" aria-label="Minimize window" title="Minimize"
            onClick={() => platformApi.window.minimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
          <button type="button" className="titlebar__winbtn" aria-label="Maximize or restore window" title="Maximize / Restore"
            onClick={() => platformApi.window.toggleMaximize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
          <button type="button" className="titlebar__winbtn titlebar__winbtn--close" aria-label="Close window" title="Close"
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
            label="Bookmark"
            iconOnly
            onClick={props.onAddBookmark}
            disabled={!props.activeTab?.url}
            title="Bookmark this page"
          />
          <ActionToggle
            glyph=" ⟳ "
            label="History"
            count={props.historyCount}
            active={props.activePanel === 'history'}
            onClick={() => props.onTogglePanel('history')}
            title="History"
          />
          <ActionToggle
            glyph=" ☆ "
            label="Bookmarks"
            count={props.bookmarksCount}
            active={props.activePanel === 'bookmarks'}
            onClick={() => props.onTogglePanel('bookmarks')}
            title="Bookmarks"
          />
          <ActionToggle
            glyph=" ↓ "
            label="Downloads"
            count={props.downloadsCount}
            active={props.activePanel === 'downloads'}
            onClick={() => props.onTogglePanel('downloads')}
            title="Downloads"
          />
          <ActionToggle
            glyph=" 🔒 "
            label="Vault"
            active={props.activePanel === 'vault'}
            onClick={() => props.onTogglePanel('vault')}
            title="Credential Vault"
          />
        </div>
        <ControlModule
          mode={props.controlMode}
          agentRunning={props.agentRunning}
          onSetMode={props.onSetControlMode}
          onTakeControl={props.onTakeControl}
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

function TitleNavLink({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button type="button" className="titlebar__navlink" title={title} onClick={onClick}>
      {label}
    </button>
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

/**
 * Spec §67 — persistent visual indicator while the user is in an onion tab,
 * so a Tor session is never confused with the normal internet.
 */
function OnionBadge() {
  return (
    <span
      className="onion-badge"
      title="Dark web tab — isolated session, routed through Tor, JavaScript off, downloads quarantined"
    >
      ONION · TOR
    </span>
  );
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
