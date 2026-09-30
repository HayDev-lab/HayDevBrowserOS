/**
 * IncognitoBadge — visual indicator for incognito mode.
 *
 * PROMPT 3 scope: VISUAL STATE ONLY.
 * Real session isolation (separate Electron partition, history exclusion,
 * cookie clear-on-close) is implemented in the Browser Core (PROMPT 2) and
 * will be extended in PROMPT 7. This component does NOT make privacy claims
 * — it only reflects the `isIncognito` flag from the active tab.
 */
import type { IncognitoVisualState } from '../store/ui-logic';

interface IncognitoBadgeProps {
  state: IncognitoVisualState;
}

export function IncognitoBadge({ state }: IncognitoBadgeProps) {
  if (!state.anyIncognito) return null;
  const isActive = state.activeIncognito;
  return (
    <div
      className={`incognito-badge ${isActive ? 'incognito-badge--active' : 'incognito-badge--any'}`}
      role="status"
      aria-label={
        isActive
          ? 'Incognito mode active on current tab'
          : 'One or more tabs are in incognito mode'
      }
      title={
        isActive
          ? 'Incognito mode active on current tab'
          : 'Incognito tabs are open'
      }
    >
      <svg
        className="incognito-badge__icon"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden
        focusable="false"
      >
        {/* Stylized incognito: hat + glasses. No external image dep. */}
        <path
          d="M3 6 L8 2 L13 6 Z"
          fill="currentColor"
        />
        <circle cx="5.5" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="10.5" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M7.5 10.5 H8.5"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
        />
      </svg>
      <span className="incognito-badge__label">
        {isActive ? 'INCOGNITO' : 'INCOGNITO TAB'}
      </span>
    </div>
  );
}
