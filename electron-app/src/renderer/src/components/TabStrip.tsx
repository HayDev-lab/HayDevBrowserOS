import { useState, useCallback, type KeyboardEvent, type MouseEvent } from 'react';
import type { TabState } from '@shared/browser-types';
import {
  getTabModifiers,
  getTabDisplayTitle,
  getFaviconFallback,
  truncateTitle,
} from '../store/ui-logic';

interface TabStripProps {
  tabs: TabState[];
  activeTabId: string | null;
  onOpenTab: () => void;
  onCloseTab: (tabId: string) => void;
  onActivateTab: (tabId: string) => void;
}

const TAB_TITLE_MAX = 28;

export function TabStrip({
  tabs,
  activeTabId,
  onOpenTab,
  onCloseTab,
  onActivateTab,
}: TabStripProps) {
  return (
    <div className="tabstrip" role="tablist" aria-label="Browser tabs">
      <div className="tabstrip__scroll" role="presentation">
        {tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onClose={() => onCloseTab(tab.id)}
            onActivate={() => onActivateTab(tab.id)}
          />
        ))}
      </div>
      <button
        type="button"
        className="tabstrip__new"
        onClick={onOpenTab}
        aria-label="Open new tab"
        title="Open new tab (Ctrl+T)"
      >
        <span aria-hidden>+</span>
      </button>
    </div>
  );
}

interface TabButtonProps {
  tab: TabState;
  active: boolean;
  onClose: () => void;
  onActivate: () => void;
}

function TabButton({ tab, active, onClose, onActivate }: TabButtonProps) {
  const [hovered, setHovered] = useState(false);
  const onClick = useCallback(() => onActivate(), [onActivate]);
  const onCloseClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onClose();
    },
    [onClose]
  );
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
    [onActivate]
  );

  const displayTitle = getTabDisplayTitle(tab);
  const displayUrl = tab.url || tab.pendingUrl || '';
  const faviconText = getFaviconFallback(displayUrl);
  const truncatedTitle = truncateTitle(displayTitle, TAB_TITLE_MAX);
  const mods = getTabModifiers({
    active,
    loadState: tab.loadState,
    isIncognito: tab.isIncognito,
    isAudioPlaying: tab.isAudioPlaying,
    hovered,
  });

  const classNames = ['tab'];
  if (mods.length > 0) classNames.push(mods);

  return (
    <div
      className={classNames.join(' ')}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="tab"
      tabIndex={0}
      aria-selected={active}
      aria-label={displayTitle}
      title={displayUrl || displayTitle}
      data-tab-id={tab.id}
    >
      <span className="tab__favicon" aria-hidden>
        {faviconText}
      </span>
      <span className="tab__title">{truncatedTitle}</span>
      {tab.loadState === 'loading' && (
        <span className="tab__spinner" aria-hidden />
      )}
      <button
        type="button"
        className={`tab__close ${hovered || active ? 'tab__close--visible' : ''}`}
        onClick={onCloseClick}
        aria-label={`Close ${displayTitle}`}
        title="Close tab (Ctrl+W)"
      >
        ×
      </button>
    </div>
  );
}
