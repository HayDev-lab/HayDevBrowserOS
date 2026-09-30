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
import { usePasswordPrompt } from '../store/vault-store';

export function PasswordPrompt() {
  const { prompt, resolving, resolve } = usePasswordPrompt();
  if (!prompt) return null;

  return (
    <aside
      className="password-prompt"
      role="alertdialog"
      aria-label={`Save password for ${prompt.domain}`}
    >
      <div className="password-prompt__head">
        <span className="password-prompt__glyph" aria-hidden>
          🔒
        </span>
        <span className="password-prompt__title">SAVE PASSWORD</span>
        <button
          type="button"
          className="password-prompt__close"
          onClick={() => void resolve(false)}
          disabled={resolving}
          aria-label="Dismiss save password prompt"
          title="Not now"
        >
          ×
        </button>
      </div>
      <p className="password-prompt__text">
        Save login for <span className="password-prompt__domain">{prompt.domain}</span>?
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
          title="Encrypt with OS key and store in the vault"
        >
          Save
        </button>
        <button
          type="button"
          className="password-prompt__btn"
          onClick={() => void resolve(false)}
          disabled={resolving}
        >
          Not now
        </button>
      </div>
    </aside>
  );
}
