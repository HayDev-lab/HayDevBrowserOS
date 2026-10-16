/**
 * PasswordPrompt — "save password?" bubble (login capture).
 *
 * Docks INSIDE the agent rail: the web view owns every pixel left of the
 * rail, so anything outside the rail's rectangle is invisible/unclickable
 * (view z-order, not CSS).
 *
 * SECURITY: the prompt carries domain + username only. The captured
 * password never leaves the main process — Save just resolves the prompt.
 */
import { useI18n } from '../i18n';
import { usePasswordPrompt } from '../store/vault-store';

export function PasswordPrompt() {
  const { t } = useI18n();
  const { prompt, resolving, resolve } = usePasswordPrompt();
  if (!prompt) return null;

  return (
    <aside
      className="password-prompt"
      role="alertdialog"
      aria-label={t('pw.aria', { domain: prompt.domain })}
    >
      <div className="password-prompt__head">
        <span className="password-prompt__glyph" aria-hidden>
          🔒
        </span>
        <span className="password-prompt__title">{t('pw.title')}</span>
        <button
          type="button"
          className="password-prompt__close"
          onClick={() => void resolve(false)}
          disabled={resolving}
          aria-label={t('pw.closeAria')}
          title={t('pw.closeTip')}
        >
          ×
        </button>
      </div>
      <p className="password-prompt__text">
        {t('pw.text', { domain: prompt.domain })}
      </p>
      {prompt.username && (
        <p className="password-prompt__user">{prompt.username}</p>
      )}
      <div className="password-prompt__actions">
        <button
          type="button"
          className="password-prompt__btn password-prompt__btn--save"
          onClick={() => void resolve(true)}
          disabled={resolving}
          title={t('pw.saveTip')}
        >
          {t('pw.save')}
        </button>
        <button
          type="button"
          className="password-prompt__btn"
          onClick={() => void resolve(false)}
          disabled={resolving}
        >
          {t('pw.notNow')}
        </button>
      </div>
    </aside>
  );
}
