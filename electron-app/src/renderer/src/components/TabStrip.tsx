import { useState, useCallback, type KeyboardEvent, type MouseEvent } from 'react';
import type { TabState } from '@shared/browser-types';

interface TabStripProps {
  tabs: TabState[];
  activeTabId: string | null;
  onOpenTab: () => void;
  onCloseTab: (tabId: string) => void;
  onActivateTab: (tabId: string) => void;
}

export function TabStrip({
  tabs,
  activeTabId,
  onOpenTab,
  onCloseTab,
  onActivateTab,
}: TabStripProps) {
  return (
    <div className="tabstrip">
      <div className="tabstrip__tabs">
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
        className="tabstrip__new"
        onClick={onOpenTab}
        aria-label="Open new tab"
        title="Open new tab (Ctrl+T)"
      >
        +
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

  const title = tab.title || tab.pendingUrl || 'New Tab';
  const displayUrl = tab.url || tab.pendingUrl || '';
  const faviconText = displayUrl ? new URL(displayUrl).host.charAt(0).toUpperCase() : '?';

  return (
    <div
      className={`tab ${active ? 'tab--active' : ''} ${
        tab.loadState === 'loading' ? 'tab--loading' : ''
      } ${tab.loadState === 'error' ? 'tab--error' : ''} ${
        tab.isIncognito ? 'tab--incognito' : ''
      }`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      title={displayUrl || title}
    >
      <span className="tab__favicon">{faviconText}</span>
      <span className="tab__title">{title}</span>
      {tab.loadState === 'loading' && <span className="tab__spinner" aria-hidden />}
      <button
        className={`tab__close ${hovered || active ? 'tab__close--visible' : ''}`}
        onClick={onCloseClick}
        aria-label={`Close ${title}`}
        title="Close tab (Ctrl+W)"
      >
        ×
      </button>
    </div>
  );
}
