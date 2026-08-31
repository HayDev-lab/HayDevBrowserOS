/**
 * TopBar — cohesive top browser surface.
 *
 * Combines:
 *   - Tab strip (full width, scrollable)
 *   - Command bar (the visual anchor)
 *   - Browser actions (bookmark / history / bookmarks / downloads)
 *   - Control module (HUMAN ↔ AGENT + TAKE CONTROL)
 *
 * Layout strategy:
 *   - Two horizontal rows in the chrome:
 *       row 1: [tab strip ──────────── new-tab] (full width)
 *       row 2: [command-bar ─ actions ─ control-module] (full width)
 *   - On narrow windows the control-module collapses to compact mode
 *     and the actions row hides labels, keeping TAKE CONTROL accessible.
 */
import type { TabState } from '@shared/browser-types';
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
  onOpenTab: () => void;
  onCloseTab: (tabId: string) => void;
  onActivateTab: (tabId: string) => void;
  onNavigate: (tabId: string, input: string) => void;
  onBack: (tabId: string) => void;
  onForward: (tabId: string) => void;
  onReload: (tabId: string) => void;
  onStop: (tabId: string) => void;
  onAddBookmark: () => void;
  onTogglePanel: (kind: PanelKind) => void;
  onSetControlMode: (mode: ControlMode) => void;
  onTakeControl: () => void;
}

export function TopBar(props: TopBarProps) {
  const incognito = getIncognitoVisualState(props.tabs, props.activeTabId);
  const incognitoMod = getAppIncognitoModifier(incognito);

  return (
    <div className={`topbar ${incognitoMod}`}>
      <div className="topbar__row topbar__row--tabs">
        <TabStrip
          tabs={props.tabs}
          activeTabId={props.activeTabId}
          onOpenTab={props.onOpenTab}
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
          <ActionToggle
            glyph="★"
            label="Bookmark"
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
        </div>
        <ControlModule
          mode={props.controlMode}
          agentRunning={props.agentRunning}
          onSetMode={props.onSetControlMode}
          onTakeControl={props.onTakeControl}
        />
      </div>
    </div>
  );
}

interface ActionToggleProps {
  glyph: string;
  label: string;
  count?: number;
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
}

function ActionToggle({
  glyph,
  label,
  count,
  active = false,
  disabled = false,
  title,
  onClick,
}: ActionToggleProps) {
  return (
    <button
      type="button"
      className={`action-toggle ${active ? 'action-toggle--active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={title}
    >
      <span className="action-toggle__glyph" aria-hidden>
        {glyph}
      </span>
      <span className="action-toggle__label">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="action-toggle__count" aria-label={`${count} items`}>
          {count}
        </span>
      )}
    </button>
  );
}
