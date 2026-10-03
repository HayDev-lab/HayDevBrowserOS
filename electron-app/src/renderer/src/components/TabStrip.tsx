import { useState, useCallback, type KeyboardEvent, type MouseEvent } from 'react';
import type { TabState, WebAppPin } from '@shared/browser-types';
import { WEB_APP_PINS } from '@shared/browser-types';
import { parseUnreadTitle } from '@shared/tab-unread';
import {
  getTabModifiers,
  getTabDisplayTitle,
  getFaviconFallback,
  truncateTitle,
  isWebAppTabActive,
} from '../store/ui-logic';

interface TabStripProps {
  tabs: TabState[];
  activeTabId: string | null;
  onOpenTab: () => void;
  onOpenWebApp: (app: WebAppPin) => void;
  onCloseTab: (tabId: string) => void;
  onActivateTab: (tabId: string) => void;
}

const TAB_TITLE_MAX = 28;

export function TabStrip({
  tabs,
  activeTabId,
  onOpenTab,
  onOpenWebApp,
  onCloseTab,
  onActivateTab,
}: TabStripProps) {
  const activeTabUrl = tabs.find((t) => t.id === activeTabId)?.url ?? '';

  return (
    <div className="tabstrip" role="tablist" aria-label="Browser tabs">
      <div className="tabstrip__apps" role="group" aria-label="Pinned web apps">
        {WEB_APP_PINS.map((app) => (
          <button
            key={app.id}
            type="button"
            className={`webapp-pin webapp-pin--card webapp-pin--${app.id} ${
              isWebAppTabActive(activeTabUrl, app) ? 'webapp-pin--active' : ''
            }`}
            onClick={() => onOpenWebApp(app)}
            aria-label={`Open ${app.label}`}
            aria-pressed={isWebAppTabActive(activeTabUrl, app)}
            title={app.label}
          >
            {app.id === 'whatsapp' ? (
              <WhatsAppGlyph />
            ) : app.id === 'telegram' ? (
              <TelegramGlyph />
            ) : app.id === 'proton' ? (
              <ProtonGlyph />
            ) : app.id === 'youtube' ? (
              <YouTubeGlyph />
            ) : app.id === 'hdrezka' ? (
              <HdRezkaGlyph />
            ) : (
              <HayDevGlyph />
            )}
            <span className="webapp-pin__label">{app.label}</span>
          </button>
        ))}
      </div>
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

/* Brand glyphs (Simple Icons paths, viewBox 0 0 24 24). Fill comes from
   the CSS token per brand — no hardcoded colors in markup. */
function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        className="webapp-pin__glyph"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
      />
    </svg>
  );
}

function TelegramGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        className="webapp-pin__glyph"
        d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
      />
    </svg>
  );
}

function HayDevGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        className="webapp-pin__glyph"
        d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.49 4.49 0 0 1 9.5 14zm-.5-7h1v2h2v1h-2v2H9v-2H7V9h2z"
      />
      <path className="webapp-pin__glyph" d="M4 4h6v1.5H4zM4 7h4v1.5H4z" opacity="0.55" />
    </svg>
  );
}

/* Proton Mail pin — envelope mark. */
function ProtonGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        className="webapp-pin__glyph"
        d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"
      />
    </svg>
  );
}

/* YouTube pin (Simple Icons play-button mark, viewBox 0 0 24 24). */
function YouTubeGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        className="webapp-pin__glyph"
        d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
      />
    </svg>
  );
}

/* HDRezka pin — film clapper mark (Material movie path). */
function HdRezkaGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        className="webapp-pin__glyph"
        d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"
      />
    </svg>
  );
}

/* Small inline onion mark shown in place of the favicon on Tor tabs. */
function OnionTabGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M12 2c-3.9 3-6.5 6.2-6.5 10a6.5 6.5 0 0 0 13 0c0-3.8-2.6-7-6.5-10zm0 18.5a3 3 0 0 1-3-3c0-1.8 1.3-3.6 3-5.5 1.7 1.9 3 3.7 3 5.5a3 3 0 0 1-3 3z"
      />
    </svg>
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
  // With an unread badge showing the count, strip the "(N)" prefix the
  // page put into its own title so the number isn't shown twice.
  const badgeTitle = tab.unreadCount > 0 ? parseUnreadTitle(displayTitle).title : displayTitle;
  const truncatedTitle = truncateTitle(badgeTitle, TAB_TITLE_MAX);
  const mods = getTabModifiers({
    active,
    loadState: tab.loadState,
    isIncognito: tab.isIncognito,
    isAudioPlaying: tab.isAudioPlaying,
    hovered,
    isDarkWeb: tab.isDarkWeb,
  });

  const classNames = ['tab'];
  if (mods.length > 0) classNames.push(mods);
  if (tab.isDiscarded) classNames.push('tab--discarded');

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
        {tab.isDarkWeb ? <OnionTabGlyph /> : faviconText}
      </span>
      <span className="tab__title">{truncatedTitle}</span>
      {tab.isDarkWeb && (
        <span className="tab__onion" aria-label="Dark web (Tor) tab" title="Dark web — routed through Tor, JavaScript off">
          ONION
        </span>
      )}
      {tab.loadState === 'loading' && (
        <span className="tab__spinner" aria-hidden />
      )}
      {tab.unreadCount > 0 && (
        <span
          className="tab__badge"
          aria-label={`${tab.unreadCount} unread notifications`}
          title={`${tab.unreadCount} unread`}
        >
          {tab.unreadCount > 99 ? '99+' : tab.unreadCount}
        </span>
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
