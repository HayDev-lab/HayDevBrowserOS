/**
 * CommandBar — the visual anchor of the Neural Cockpit.
 *
 * Renamed from AddressBar in PROMPT 3 to reflect that it is more than a URL
 * input: it is the future command surface for the AI agent. PROMPT 3 only
 * implements the visual language; no command parser is added.
 *
 * Visual states (mapped from `getCommandBarState`):
 *   idle       — no tab, dim placeholder
 *   focused    — accent border, bright placeholder
 *   loading    — accent border + spinner overlay
 *   navigating — typed-but-not-submitted hint
 *   invalid    — danger border + warning icon (blocked protocol)
 *   secure     — https lock icon, accent-tinted
 *   insecure   — http warning icon, muted
 */
import { useState, useEffect, useCallback, type KeyboardEvent } from 'react';
import type { TabState } from '@shared/browser-types';
import {
  getCommandBarState,
  getCommandBarStateModifier,
} from '../store/ui-logic';

interface CommandBarProps {
  tab: TabState | null;
  onNavigate: (tabId: string, input: string) => void;
  onBack: (tabId: string) => void;
  onForward: (tabId: string) => void;
  onReload: (tabId: string) => void;
  onStop: (tabId: string) => void;
}

export function CommandBar({
  tab,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onStop,
}: CommandBarProps) {
  const [input, setInput] = useState('');
  const [isFocused, setFocused] = useState(false);

  // Sync the input field with the active tab's URL when it changes (and the
  // user is NOT actively editing).
  useEffect(() => {
    if (isFocused) return;
    if (!tab) {
      setInput('');
      return;
    }
    setInput(tab.url || tab.pendingUrl || '');
  }, [tab?.id, tab?.url, tab?.pendingUrl, isFocused]);

  const handleSubmit = useCallback(() => {
    if (!tab) return;
    if (input.trim().length === 0) return;
    onNavigate(tab.id, input);
  }, [tab, input, onNavigate]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === 'Escape') {
        if (tab) setInput(tab.url || tab.pendingUrl || '');
        (e.target as HTMLInputElement).blur();
      }
    },
    [handleSubmit, tab]
  );

  const canGoBack = tab?.canGoBack ?? false;
  const canGoForward = tab?.canGoForward ?? false;
  const isLoading = tab?.loadState === 'loading';

  const state = getCommandBarState({
    isFocused,
    isLoading,
    hasUrl: !!(tab?.url),
    isHttps: !!(tab?.url?.startsWith('https://')),
    isIncognito: !!tab?.isIncognito,
    input,
  });

  return (
    <div
      className={`commandbar ${getCommandBarStateModifier(state)}`}
      role="search"
      aria-label="Address and command bar"
    >
      <NavButton
        glyph="◀"
        label="Back"
        shortcut="Alt+Left"
        disabled={!canGoBack}
        onClick={() => tab && onBack(tab.id)}
      />
      <NavButton
        glyph="▶"
        label="Forward"
        shortcut="Alt+Right"
        disabled={!canGoForward}
        onClick={() => tab && onForward(tab.id)}
      />
      <NavButton
        glyph={isLoading ? '✕' : '⟳'}
        label={isLoading ? 'Stop' : 'Reload'}
        shortcut={isLoading ? undefined : 'Ctrl+R'}
        disabled={!tab}
        onClick={() => tab && (isLoading ? onStop(tab.id) : onReload(tab.id))}
      />

      <div className="commandbar__field">
        <StateIndicator state={state} isIncognito={!!tab?.isIncognito} />
        <input
          className="commandbar__input"
          type="text"
          value={input}
          placeholder={getPlaceholder(tab)}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          aria-label="URL or search query"
          aria-invalid={state === 'invalid'}
        />
        {state === 'invalid' && (
          <span
            className="commandbar__invalid-icon"
            title="Blocked protocol — javascript:, data:, vbscript:, blob: are not allowed"
            aria-hidden
          >
            ⚠
          </span>
        )}
      </div>
    </div>
  );
}

interface NavButtonProps {
  glyph: string;
  label: string;
  shortcut?: string;
  disabled: boolean;
  onClick: () => void;
}

function NavButton({ glyph, label, shortcut, disabled, onClick }: NavButtonProps) {
  return (
    <button
      type="button"
      className="commandbar__nav-btn"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      <span aria-hidden>{glyph}</span>
    </button>
  );
}

function StateIndicator({
  state,
  isIncognito,
}: {
  state: ReturnType<typeof getCommandBarState>;
  isIncognito: boolean;
}) {
  if (state === 'invalid') {
    return <span className="commandbar__state-icon commandbar__state-icon--invalid" aria-hidden>⚠</span>;
  }
  if (state === 'secure') {
    return (
      <span className="commandbar__state-icon commandbar__state-icon--secure" aria-hidden>
        {isIncognito ? '◆' : '🔒'}
      </span>
    );
  }
  if (state === 'insecure') {
    return <span className="commandbar__state-icon commandbar__state-icon--insecure" aria-hidden>ⓘ</span>;
  }
  if (state === 'loading') {
    return <span className="commandbar__state-icon commandbar__state-icon--loading" aria-hidden>⟳</span>;
  }
  if (state === 'focused' || state === 'navigating') {
    return <span className="commandbar__state-icon commandbar__state-icon--focus" aria-hidden>›</span>;
  }
  return <span className="commandbar__state-icon" aria-hidden />;
}

function getPlaceholder(tab: TabState | null): string {
  if (!tab) return 'No tab active';
  return 'Search or enter address';
}
