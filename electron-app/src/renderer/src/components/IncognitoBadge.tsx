/**
 * IncognitoBadge — visual indicator for incognito mode.
 *
 * The badge reflects the `isIncognito` flag from the active tab AND the
 * REAL egress policy/state (privacy_status) in its tooltip — never a
 * "Tor" claim derived from the incognito flag alone (PROMPT 02).
 */
import { useEffect, useState } from 'react';
import type { IncognitoVisualState } from '../store/ui-logic';
import type { PrivacyStatus } from '@shared/ipc-types';
import { useI18n } from '../i18n';
import { platformApi } from '../platform';

interface IncognitoBadgeProps {
  state: IncognitoVisualState;
}

export function IncognitoBadge({ state }: IncognitoBadgeProps) {
  const { t } = useI18n();
  const [privacy, setPrivacy] = useState<PrivacyStatus | null>(null);
  useEffect(() => {
    if (!state.anyIncognito || privacy) return;
    let cancelled = false;
    void platformApi.privacy
      .status()
      .then((s) => {
        if (!cancelled) setPrivacy(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [state.anyIncognito, privacy]);

  if (!state.anyIncognito) return null;
  const isActive = state.activeIncognito;
  const baseTip = isActive ? t('inc.activeTip') : t('inc.anyTip');
  const egressTip = privacy
    ? ` — egress: ${privacy.privateEgress}${
        privacy.torAvailable
          ? ` (Tor up${privacy.torEndpoint ? ` ${privacy.torEndpoint}` : ''})`
          : ' (Tor gateway down)'
      }`
    : '';
  const tip = `${baseTip}${egressTip}`;
  return (
    <div
      className={`incognito-badge ${isActive ? 'incognito-badge--active' : 'incognito-badge--any'}`}
      role="status"
      aria-label={isActive ? t('inc.activeAria') : t('inc.anyAria')}
      title={tip}
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
        {isActive ? t('inc.active') : t('inc.any')}
      </span>
    </div>
  );
}
