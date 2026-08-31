import { useState, useEffect, useCallback, type KeyboardEvent } from 'react';
import type { TabState } from '@shared/browser-types';

interface AddressBarProps {
  tab: TabState | null;
  onNavigate: (tabId: string, input: string) => void;
  onBack: (tabId: string) => void;
  onForward: (tabId: string) => void;
  onReload: (tabId: string) => void;
  onStop: (tabId: string) => void;
}

export function AddressBar({
  tab,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onStop,
}: AddressBarProps) {
  const [input, setInput] = useState('');

  // Sync the input field with the active tab's URL when it changes.
  useEffect(() => {
    if (!tab) {
      setInput('');
      return;
    }
    setInput(tab.url || tab.pendingUrl || '');
  }, [tab?.id, tab?.url, tab?.pendingUrl]);

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
        // Restore the committed URL.
        if (tab) setInput(tab.url || tab.pendingUrl || '');
        (e.target as HTMLInputElement).blur();
      }
    },
    [handleSubmit, tab]
  );

  const canGoBack = tab?.canGoBack ?? false;
  const canGoForward = tab?.canGoForward ?? false;
  const isLoading = tab?.loadState === 'loading';

  return (
    <div className="addressbar">
      <button
        className="addressbar__btn"
        onClick={() => tab && onBack(tab.id)}
        disabled={!canGoBack}
        title="Back (Alt+Left)"
        aria-label="Back"
      >
        ◀
      </button>
      <button
        className="addressbar__btn"
        onClick={() => tab && onForward(tab.id)}
        disabled={!canGoForward}
        title="Forward (Alt+Right)"
        aria-label="Forward"
      >
        ▶
      </button>
      <button
        className="addressbar__btn"
        onClick={() => tab && (isLoading ? onStop(tab.id) : onReload(tab.id))}
        title={isLoading ? 'Stop' : 'Reload (Ctrl+R)'}
        aria-label={isLoading ? 'Stop' : 'Reload'}
      >
        {isLoading ? '✕' : '⟳'}
      </button>
      <input
        className="addressbar__input"
        type="text"
        value={input}
        placeholder="Search or enter address"
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoComplete="off"
      />
      {tab?.isIncognito && (
        <span className="addressbar__incognito" title="Incognito mode">
          🕶
        </span>
      )}
    </div>
  );
}
