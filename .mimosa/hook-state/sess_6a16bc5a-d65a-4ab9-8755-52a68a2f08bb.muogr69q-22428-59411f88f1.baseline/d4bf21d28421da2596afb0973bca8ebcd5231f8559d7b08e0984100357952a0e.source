import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONTROL_STATE,
  getControlModeLabel,
  getControlModeAccent,
  getTakeControlVisibility,
  canTransitionControlMode,
  applyTakeControl,
  clearTakeoverLatch,
  switchToAgent,
  setAgentRunning,
  getTabModifiers,
  truncateTitle,
  getFaviconFallback,
  getTabDisplayTitle,
  getCommandBarState,
  getCommandBarStateModifier,
  getPanelState,
  isPanelEmptyState,
  getIncognitoVisualState,
  getAppIncognitoModifier,
  getDownloadStateColorClass,
  isDownloadTerminal,
  isDownloadInProgress,
  formatBytes,
  formatPercent,
  formatRelativeTime,
  pickLayoutKind,
  getLayoutModifier,
  isPanelActive,
  findWebAppTabId,
  isWebAppTabActive,
  type ControlState,
} from '../src/renderer/src/store/ui-logic';
import type { TabState, TabLoadState, DownloadStateName } from '@shared/browser-types';
import { WEB_APP_PINS } from '@shared/browser-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab_1',
    url: 'https://example.com/',
    pendingUrl: 'https://example.com/',
    title: 'Example',
    loadState: 'committed' as TabLoadState,
    error: null,
    canGoBack: false,
    canGoForward: false,
    isIncognito: false,
    isActive: true,
    isAudioPlaying: false,
      unreadCount: 0,
      isDiscarded: false,
    createdAt: 1_000_000,
    lastActivatedAt: 1_000_000,
    ...overrides,
  };
}

// ===========================================================================
// Control mode
// ===========================================================================
describe('ui-logic / control mode label + accent', () => {
  it('returns the mode name as the label', () => {
    expect(getControlModeLabel('HUMAN')).toBe('HUMAN');
    expect(getControlModeLabel('AGENT')).toBe('AGENT');
  });

  it('returns the accent token for each mode', () => {
    expect(getControlModeAccent('HUMAN')).toBe('--nc-accent');
    expect(getControlModeAccent('AGENT')).toBe('--nc-agent');
  });
});

describe('ui-logic / getTakeControlVisibility', () => {
  it('returns hidden when HUMAN and no agent activity', () => {
    expect(getTakeControlVisibility(DEFAULT_CONTROL_STATE)).toBe('hidden');
  });

  it('returns elevated when AGENT and idle', () => {
    const s: ControlState = { mode: 'AGENT', agentRunning: false, takeoverLatched: false };
    expect(getTakeControlVisibility(s)).toBe('elevated');
  });

  it('returns critical when AGENT and running', () => {
    const s: ControlState = { mode: 'AGENT', agentRunning: true, takeoverLatched: false };
    expect(getTakeControlVisibility(s)).toBe('critical');
  });

  it('returns critical when takeover is latched (even in HUMAN)', () => {
    const s: ControlState = { mode: 'HUMAN', agentRunning: false, takeoverLatched: true };
    expect(getTakeControlVisibility(s)).toBe('critical');
  });

  it('returns subtle when HUMAN but agentRunning true (shutdown in progress)', () => {
    const s: ControlState = { mode: 'HUMAN', agentRunning: true, takeoverLatched: false };
    expect(getTakeControlVisibility(s)).toBe('subtle');
  });
});

describe('ui-logic / canTransitionControlMode', () => {
  it('refuses transition to the same mode', () => {
    expect(canTransitionControlMode(DEFAULT_CONTROL_STATE, 'HUMAN')).toBe(false);
    const s: ControlState = { mode: 'AGENT', agentRunning: false, takeoverLatched: false };
    expect(canTransitionControlMode(s, 'AGENT')).toBe(false);
  });

  it('allows transition to HUMAN (TAKE CONTROL) unconditionally', () => {
    const running: ControlState = { mode: 'AGENT', agentRunning: true, takeoverLatched: false };
    expect(canTransitionControlMode(running, 'HUMAN')).toBe(true);
  });

  it('refuses transition to AGENT when an agent task is running', () => {
    const running: ControlState = { mode: 'AGENT', agentRunning: true, takeoverLatched: false };
    expect(canTransitionControlMode(running, 'AGENT')).toBe(false);
  });

  it('allows transition to AGENT from HUMAN when not running', () => {
    expect(canTransitionControlMode(DEFAULT_CONTROL_STATE, 'AGENT')).toBe(true);
  });
});

describe('ui-logic / state transitions', () => {
  it('applyTakeControl switches to HUMAN, latches takeover, clears running', () => {
    const s: ControlState = { mode: 'AGENT', agentRunning: true, takeoverLatched: false };
    const next = applyTakeControl(s);
    expect(next.mode).toBe('HUMAN');
    expect(next.agentRunning).toBe(false);
    expect(next.takeoverLatched).toBe(true);
  });

  it('clearTakeoverLatch clears the latched flag only', () => {
    const s: ControlState = { mode: 'HUMAN', agentRunning: false, takeoverLatched: true };
    const next = clearTakeoverLatch(s);
    expect(next.takeoverLatched).toBe(false);
    expect(next.mode).toBe('HUMAN');
  });

  it('switchToAgent succeeds when not running', () => {
    const next = switchToAgent(DEFAULT_CONTROL_STATE);
    expect(next.mode).toBe('AGENT');
    expect(next.takeoverLatched).toBe(false);
  });

  it('switchToAgent refuses when agent is running', () => {
    const running: ControlState = { mode: 'AGENT', agentRunning: true, takeoverLatched: false };
    const next = switchToAgent(running);
    expect(next).toBe(running);
  });

  it('setAgentRunning flips the running flag without switching modes', () => {
    const s: ControlState = { mode: 'AGENT', agentRunning: false, takeoverLatched: false };
    const next = setAgentRunning(s, true);
    expect(next.agentRunning).toBe(true);
    expect(next.mode).toBe('AGENT');
  });
});

// ===========================================================================
// Tab styling
// ===========================================================================
describe('ui-logic / getTabModifiers', () => {
  it('returns no modifiers for a plain inactive committed tab', () => {
    const mods = getTabModifiers({
      active: false,
      loadState: 'committed',
      isIncognito: false,
      isAudioPlaying: false,
      hovered: false,
    });
    expect(mods).toBe('');
  });

  it('returns active modifier for the active tab', () => {
    const mods = getTabModifiers({
      active: true,
      loadState: 'committed',
      isIncognito: false,
      isAudioPlaying: false,
      hovered: false,
    });
    expect(mods).toContain('tab--active');
    expect(mods).toContain('tab--committed');
  });

  it('returns loading modifier', () => {
    const mods = getTabModifiers({
      active: true,
      loadState: 'loading',
      isIncognito: false,
      isAudioPlaying: false,
      hovered: false,
    });
    expect(mods).toContain('tab--loading');
    expect(mods).toContain('tab--active');
  });

  it('returns error modifier', () => {
    const mods = getTabModifiers({
      active: false,
      loadState: 'error',
      isIncognito: false,
      isAudioPlaying: false,
      hovered: false,
    });
    expect(mods).toContain('tab--error');
  });

  it('returns incognito modifier', () => {
    const mods = getTabModifiers({
      active: false,
      loadState: 'committed',
      isIncognito: true,
      isAudioPlaying: false,
      hovered: false,
    });
    expect(mods).toContain('tab--incognito');
  });

  it('returns audio modifier', () => {
    const mods = getTabModifiers({
      active: false,
      loadState: 'committed',
      isIncognito: false,
      isAudioPlaying: true,
      hovered: false,
    });
    expect(mods).toContain('tab--audio');
  });

  it('returns hovered modifier', () => {
    const mods = getTabModifiers({
      active: false,
      loadState: 'committed',
      isIncognito: false,
      isAudioPlaying: false,
      hovered: true,
    });
    expect(mods).toContain('tab--hovered');
  });

  it('combines multiple modifiers', () => {
    const mods = getTabModifiers({
      active: true,
      loadState: 'loading',
      isIncognito: true,
      isAudioPlaying: false,
      hovered: true,
    });
    expect(mods).toContain('tab--active');
    expect(mods).toContain('tab--loading');
    expect(mods).toContain('tab--incognito');
    expect(mods).toContain('tab--hovered');
  });
});

describe('ui-logic / truncateTitle', () => {
  it('returns short titles unchanged', () => {
    expect(truncateTitle('Short', 28)).toBe('Short');
  });

  it('truncates long titles with ellipsis', () => {
    const long = 'A'.repeat(50);
    const out = truncateTitle(long, 28);
    expect(out.length).toBe(28);
    expect(out.endsWith('…')).toBe(true);
    expect(out.slice(0, -1)).toBe('A'.repeat(27));
  });

  it('returns empty string for empty input', () => {
    expect(truncateTitle('', 28)).toBe('');
  });

  it('handles maxLen of 1', () => {
    expect(truncateTitle('abc', 1)).toBe('…');
  });

  it('returns the title unchanged if exactly at maxLen', () => {
    expect(truncateTitle('abcde', 5)).toBe('abcde');
  });
});

describe('ui-logic / getFaviconFallback', () => {
  it('returns the first letter of the host (uppercase)', () => {
    expect(getFaviconFallback('https://example.com/')).toBe('E');
  });

  it('returns ? for empty input', () => {
    expect(getFaviconFallback('')).toBe('?');
  });

  it('returns ? for non-URL input', () => {
    expect(getFaviconFallback('not a url')).toBe('?');
  });

  it('returns ? for malformed URLs without throwing', () => {
    expect(getFaviconFallback('http://')).toBe('?');
  });
});

describe('ui-logic / getTabDisplayTitle', () => {
  it('uses tab.title when present', () => {
    expect(getTabDisplayTitle(makeTab({ title: 'Real Title' }))).toBe('Real Title');
  });

  it('falls back to url when title is empty', () => {
    expect(getTabDisplayTitle(makeTab({ title: '', url: 'https://x.com/' }))).toBe('https://x.com/');
  });

  it('falls back to pendingUrl when url is also empty', () => {
    const tab = makeTab({ title: '', url: '', pendingUrl: 'https://pending.com/' });
    expect(getTabDisplayTitle(tab)).toBe('https://pending.com/');
  });

  it('falls back to "New Tab" when nothing is set', () => {
    const tab = makeTab({ title: '', url: '', pendingUrl: '' });
    expect(getTabDisplayTitle(tab)).toBe('New Tab');
  });
});

// ===========================================================================
// Command bar state
// ===========================================================================
describe('ui-logic / getCommandBarState', () => {
  it('returns idle when no tab and no input', () => {
    expect(
      getCommandBarState({
        isFocused: false,
        isLoading: false,
        hasUrl: false,
        isHttps: false,
        isIncognito: false,
        input: '',
      })
    ).toBe('idle');
  });

  it('returns focused when focused and input empty', () => {
    expect(
      getCommandBarState({
        isFocused: true,
        isLoading: false,
        hasUrl: false,
        isHttps: false,
        isIncognito: false,
        input: '',
      })
    ).toBe('focused');
  });

  it('returns navigating when focused and input non-empty', () => {
    expect(
      getCommandBarState({
        isFocused: true,
        isLoading: false,
        hasUrl: false,
        isHttps: false,
        isIncognito: false,
        input: 'example.com',
      })
    ).toBe('navigating');
  });

  it('returns loading when isLoading (regardless of focus)', () => {
    expect(
      getCommandBarState({
        isFocused: true,
        isLoading: true,
        hasUrl: true,
        isHttps: true,
        isIncognito: false,
        input: 'https://example.com/',
      })
    ).toBe('loading');
  });

  it('returns invalid for javascript: protocol', () => {
    expect(
      getCommandBarState({
        isFocused: true,
        isLoading: false,
        hasUrl: false,
        isHttps: false,
        isIncognito: false,
        input: 'javascript:alert(1)',
      })
    ).toBe('invalid');
  });

  it('returns invalid for data: protocol', () => {
    expect(
      getCommandBarState({
        isFocused: true,
        isLoading: false,
        hasUrl: false,
        isHttps: false,
        isIncognito: false,
        input: 'data:text/html,<script>1</script>',
      })
    ).toBe('invalid');
  });

  it('returns invalid for vbscript: protocol', () => {
    expect(
      getCommandBarState({
        isFocused: true,
        isLoading: false,
        hasUrl: false,
        isHttps: false,
        isIncognito: false,
        input: 'vbscript:msgbox(1)',
      })
    ).toBe('invalid');
  });

  it('returns invalid for blob: protocol', () => {
    expect(
      getCommandBarState({
        isFocused: true,
        isLoading: false,
        hasUrl: false,
        isHttps: false,
        isIncognito: false,
        input: 'blob:https://example.com/abc',
      })
    ).toBe('invalid');
  });

  it('returns invalid even when not focused (input stays in the field)', () => {
    expect(
      getCommandBarState({
        isFocused: false,
        isLoading: false,
        hasUrl: false,
        isHttps: false,
        isIncognito: false,
        input: 'javascript:alert(1)',
      })
    ).toBe('invalid');
  });

  it('returns secure for https URL when not focused', () => {
    expect(
      getCommandBarState({
        isFocused: false,
        isLoading: false,
        hasUrl: true,
        isHttps: true,
        isIncognito: false,
        input: 'https://example.com/',
      })
    ).toBe('secure');
  });

  it('returns insecure for http URL when not focused', () => {
    expect(
      getCommandBarState({
        isFocused: false,
        isLoading: false,
        hasUrl: true,
        isHttps: false,
        isIncognito: false,
        input: 'http://example.com/',
      })
    ).toBe('insecure');
  });

  it('returns idle for internal pages (about:blank) instead of insecure', () => {
    expect(
      getCommandBarState({
        isFocused: false,
        isLoading: false,
        hasUrl: true,
        isHttps: false,
        isWebUrl: false,
        isIncognito: false,
        input: 'about:blank',
      })
    ).toBe('idle');
  });

  it('is case-insensitive for protocol detection', () => {
    expect(
      getCommandBarState({
        isFocused: true,
        isLoading: false,
        hasUrl: false,
        isHttps: false,
        isIncognito: false,
        input: '  JavaScript:alert(1)',
      })
    ).toBe('invalid');
  });
});

describe('ui-logic / getCommandBarStateModifier', () => {
  it('returns the matching class name', () => {
    expect(getCommandBarStateModifier('focused')).toBe('commandbar--focused');
    expect(getCommandBarStateModifier('invalid')).toBe('commandbar--invalid');
    expect(getCommandBarStateModifier('secure')).toBe('commandbar--secure');
  });
});

// ===========================================================================
// Panel state
// ===========================================================================
describe('ui-logic / getPanelState', () => {
  it('returns closed when not open', () => {
    expect(getPanelState(false, 10)).toBe('closed');
  });

  it('returns empty when open with no items', () => {
    expect(getPanelState(true, 0)).toBe('empty');
  });

  it('returns list when open with items', () => {
    expect(getPanelState(true, 5)).toBe('list');
  });

  it('returns loading when open and isLoading', () => {
    expect(getPanelState(true, 5, true)).toBe('loading');
  });
});

describe('ui-logic / isPanelEmptyState', () => {
  it('returns true only when open and empty', () => {
    expect(isPanelEmptyState(true, 0)).toBe(true);
    expect(isPanelEmptyState(false, 0)).toBe(false);
    expect(isPanelEmptyState(true, 5)).toBe(false);
  });
});

describe('ui-logic / isPanelActive', () => {
  it('returns true when the active panel matches the kind', () => {
    expect(isPanelActive('history', 'history')).toBe(true);
    expect(isPanelActive('history', 'bookmarks')).toBe(false);
    expect(isPanelActive(null, 'history')).toBe(false);
  });
});

// ===========================================================================
// Incognito visual state
// ===========================================================================
describe('ui-logic / getIncognitoVisualState', () => {
  it('returns all-false when no incognito tabs', () => {
    const state = getIncognitoVisualState(
      [makeTab({ isIncognito: false })],
      'tab_1'
    );
    expect(state.anyIncognito).toBe(false);
    expect(state.activeIncognito).toBe(false);
  });

  it('returns activeIncognito=true when the active tab is incognito', () => {
    const state = getIncognitoVisualState(
      [
        makeTab({ id: 'tab_1', isIncognito: true, isActive: true }),
        makeTab({ id: 'tab_2', isIncognito: false }),
      ],
      'tab_1'
    );
    expect(state.anyIncognito).toBe(true);
    expect(state.activeIncognito).toBe(true);
  });

  it('returns anyIncognito=true but activeIncognito=false when only background tab is incognito', () => {
    const state = getIncognitoVisualState(
      [
        makeTab({ id: 'tab_1', isIncognito: false, isActive: true }),
        makeTab({ id: 'tab_2', isIncognito: true }),
      ],
      'tab_1'
    );
    expect(state.anyIncognito).toBe(true);
    expect(state.activeIncognito).toBe(false);
  });
});

describe('ui-logic / getAppIncognitoModifier', () => {
  it('returns empty when no incognito', () => {
    expect(
      getAppIncognitoModifier({ anyIncognito: false, activeIncognito: false })
    ).toBe('');
  });

  it('returns --any when only background tab is incognito', () => {
    expect(
      getAppIncognitoModifier({ anyIncognito: true, activeIncognito: false })
    ).toBe('app--incognito-any');
  });

  it('returns --active when active tab is incognito', () => {
    expect(
      getAppIncognitoModifier({ anyIncognito: true, activeIncognito: true })
    ).toBe('app--incognito-active');
  });
});

// ===========================================================================
// Download state helpers
// ===========================================================================
describe('ui-logic / getDownloadStateColorClass', () => {
  it('returns the matching class name for each state', () => {
    const states: DownloadStateName[] = [
      'pending',
      'progressing',
      'completed',
      'cancelled',
      'interrupted',
    ];
    for (const s of states) {
      expect(getDownloadStateColorClass(s)).toBe(`download-item__state--${s}`);
    }
  });
});

describe('ui-logic / isDownloadTerminal', () => {
  it('returns true for completed, cancelled, interrupted', () => {
    expect(isDownloadTerminal('completed')).toBe(true);
    expect(isDownloadTerminal('cancelled')).toBe(true);
    expect(isDownloadTerminal('interrupted')).toBe(true);
  });

  it('returns false for pending, progressing', () => {
    expect(isDownloadTerminal('pending')).toBe(false);
    expect(isDownloadTerminal('progressing')).toBe(false);
  });
});

describe('ui-logic / isDownloadInProgress', () => {
  it('returns true for pending, progressing', () => {
    expect(isDownloadInProgress('pending')).toBe(true);
    expect(isDownloadInProgress('progressing')).toBe(true);
  });

  it('returns false for terminal states', () => {
    expect(isDownloadInProgress('completed')).toBe(false);
    expect(isDownloadInProgress('cancelled')).toBe(false);
    expect(isDownloadInProgress('interrupted')).toBe(false);
  });
});

// ===========================================================================
// Format helpers
// ===========================================================================
describe('ui-logic / formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes with one decimal when value < 10', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 5)).toBe('5.0 MB');
  });

  it('formats megabytes with no decimals when value >= 10', () => {
    expect(formatBytes(1024 * 1024 * 12)).toBe('12 MB');
  });

  it('handles negative and non-finite inputs', () => {
    expect(formatBytes(-100)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(Infinity)).toBe('0 B');
  });
});

describe('ui-logic / formatPercent', () => {
  it('returns 0 for zero or negative total', () => {
    expect(formatPercent(10, 0)).toBe(0);
    expect(formatPercent(10, -1)).toBe(0);
  });

  it('returns 0 for negative received', () => {
    expect(formatPercent(-10, 100)).toBe(0);
  });

  it('returns 0 for non-finite inputs', () => {
    expect(formatPercent(NaN, 100)).toBe(0);
    expect(formatPercent(10, NaN)).toBe(0);
  });

  it('returns the integer percentage', () => {
    expect(formatPercent(50, 100)).toBe(50);
    expect(formatPercent(33, 100)).toBe(33);
    expect(formatPercent(99.7, 100)).toBe(100); // clamped
  });

  it('clamps to 100', () => {
    expect(formatPercent(150, 100)).toBe(100);
  });
});

describe('ui-logic / formatRelativeTime', () => {
  const NOW = 1_700_000_000_000; // arbitrary fixed point

  it('returns empty for invalid timestamp', () => {
    expect(formatRelativeTime(0, NOW)).toBe('');
    expect(formatRelativeTime(-1, NOW)).toBe('');
    expect(formatRelativeTime(NaN, NOW)).toBe('');
  });

  it('returns "just now" for future timestamps', () => {
    expect(formatRelativeTime(NOW + 1000, NOW)).toBe('just now');
  });

  it('returns "just now" for less than a minute', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('just now');
  });

  it('returns "5m ago" for 5 minutes', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
  });

  it('returns "2h ago" for 2 hours', () => {
    expect(formatRelativeTime(NOW - 2 * 3_600_000, NOW)).toBe('2h ago');
  });

  it('returns "3d ago" for 3 days', () => {
    expect(formatRelativeTime(NOW - 3 * 86_400_000, NOW)).toBe('3d ago');
  });

  it('returns a YYYY-MM-DD date for older than a week', () => {
    // Anchor to 12:00 UTC so the local date and the UTC date are the same
    // calendar day in any timezone (the formatter uses local components).
    const raw = NOW - 10 * 86_400_000;
    const shifted = new Date(raw);
    const old = Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      12
    );
    const expected = new Date(old).toISOString().slice(0, 10);
    expect(formatRelativeTime(old, NOW)).toBe(expected);
  });
});

// ===========================================================================
// Responsive layout
// ===========================================================================
describe('ui-logic / pickLayoutKind', () => {
  it('returns narrow for < 980', () => {
    expect(pickLayoutKind(320)).toBe('narrow');
    expect(pickLayoutKind(979)).toBe('narrow');
  });

  it('returns normal for 980–1439', () => {
    expect(pickLayoutKind(980)).toBe('normal');
    expect(pickLayoutKind(1280)).toBe('normal');
    expect(pickLayoutKind(1439)).toBe('normal');
  });

  it('returns wide for >= 1440', () => {
    expect(pickLayoutKind(1440)).toBe('wide');
    expect(pickLayoutKind(1920)).toBe('wide');
  });
});

describe('ui-logic / getLayoutModifier', () => {
  it('returns the matching class name', () => {
    expect(getLayoutModifier('narrow')).toBe('app--narrow');
    expect(getLayoutModifier('normal')).toBe('app--normal');
    expect(getLayoutModifier('wide')).toBe('app--wide');
  });
});

describe('ui-logic / web app pins', () => {
  const whatsapp = WEB_APP_PINS.find((p) => p.id === 'whatsapp')!;
  const telegram = WEB_APP_PINS.find((p) => p.id === 'telegram')!;

  it('WEB_APP_PINS declares WhatsApp and Telegram with https origins', () => {
    expect(whatsapp.url).toBe('https://web.whatsapp.com/');
    expect(telegram.url).toBe('https://web.telegram.org/');
  });

  it('findWebAppTabId matches a committed app tab (any path under the origin)', () => {
    const tabs = [
      makeTab({ id: 'tab_a', url: 'https://example.com/' }),
      makeTab({ id: 'tab_b', url: 'https://web.whatsapp.com/' }),
    ];
    expect(findWebAppTabId(tabs, whatsapp)).toBe('tab_b');
  });

  it('findWebAppTabId matches a still-loading tab via pendingUrl', () => {
    const tabs = [
      makeTab({
        id: 'tab_c',
        url: 'about:blank',
        pendingUrl: 'https://web.telegram.org/k/',
        loadState: 'loading',
      }),
    ];
    expect(findWebAppTabId(tabs, telegram)).toBe('tab_c');
  });

  it('findWebAppTabId returns null when the app has no tab', () => {
    const tabs = [makeTab({ id: 'tab_a', url: 'https://example.com/' })];
    expect(findWebAppTabId(tabs, whatsapp)).toBeNull();
    expect(findWebAppTabId([], telegram)).toBeNull();
  });

  it('isWebAppTabActive is true only for the matching origin', () => {
    expect(isWebAppTabActive('https://web.whatsapp.com/', whatsapp)).toBe(true);
    expect(isWebAppTabActive('https://web.whatsapp.com/send', whatsapp)).toBe(true);
    expect(isWebAppTabActive('https://web.telegram.org/', whatsapp)).toBe(false);
    expect(isWebAppTabActive('', telegram)).toBe(false);
  });
});
