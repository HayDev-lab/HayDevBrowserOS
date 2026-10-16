/**
 * VaultPanel — minimal credential vault UI.
 *
 * Shows:
 *   - List of saved credentials (domain, username, created/updated metadata)
 *   - Delete button per credential
 *   - Manual save form (domain + username + password — password cleared after save)
 *   - Generate password button (domain + username)
 *
 * SECURITY:
 *   - The manual-save password input is cleared from React state immediately
 *     after the save operation completes (success or failure).
 *   - The password is NEVER stored in component state beyond the input field's
 *     transient value.
 *   - The panel does NOT show passwords (they are not available via IPC).
 */
import { useState, useCallback } from 'react';
import { nativeErrorMessage } from '@shared/native-errors';
import { useI18n } from '../../i18n';
import { useVaultStore } from '../../store/vault-store';
import { formatRelativeTime, type RelativeTimeLabels } from '../../store/ui-logic';

interface VaultPanelProps {
  open: boolean;
  onClose: () => void;
  activeTabId: string | null;
}

export function VaultPanel({ open, onClose, activeTabId }: VaultPanelProps) {
  const { t, lang } = useI18n();
  const vault = useVaultStore();
  const [domain, setDomain] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!domain.trim() || !username.trim() || !password.trim()) return;
    const result = await vault.save(domain.trim(), username.trim(), password);
    // SECURITY: Clear the password immediately regardless of result.
    setPassword('');
    setStatus(result.success ? t('panel.saved') : nativeErrorMessage(result.error, lang));
    if (result.success) {
      setDomain('');
      setUsername('');
    }
  }, [domain, username, password, vault, t, lang]);

  const handleGenerate = useCallback(async () => {
    if (!domain.trim() || !username.trim()) return;
    const result = await vault.generateAndStore(domain.trim(), username.trim());
    setStatus(result.success ? t('panel.generated') : nativeErrorMessage(result.error, lang));
    if (result.success) {
      setDomain('');
      setUsername('');
    }
  }, [domain, username, vault, t, lang]);

  const handleDelete = useCallback(async (id: string) => {
    const result = await vault.delete(id);
    setStatus(result.success ? null : nativeErrorMessage(result.error, lang));
  }, [vault, lang]);

  const handleFill = useCallback(async (credId: string) => {
    if (!activeTabId) {
      setStatus(t('panel.noActiveTab'));
      return;
    }
    // PROMPT 03: fill from the concrete record id; the host authorizes
    // inside the native command (domain_policy), not by display string.
    const result = await vault.fill(credId, activeTabId);
    setStatus(result.success ? t('panel.filled') : nativeErrorMessage(result.error, lang));
  }, [activeTabId, vault, t, lang]);

  if (!open) return null;

  const rel: Partial<RelativeTimeLabels> = {
    justNow: t('rel.justNow'),
    mAgo: t('rel.mAgo'),
    hAgo: t('rel.hAgo'),
    dAgo: t('rel.dAgo'),
  };

  return (
    <section className="panel panel--vault" aria-label={t('panel.vaultName')}>
      <header className="panel__header">
        <div className="panel__title">
          <span className="panel__title-mark" aria-hidden />
          <h2>{t('panel.vault')}</h2>
          <span className="panel__count">{vault.credentials.length}</span>
        </div>
        <button
          type="button"
          className="panel__close"
          onClick={onClose}
          aria-label={t('panel.closeAria', { name: t('panel.vaultName') })}
        >
          ×
        </button>
      </header>
      <div className="panel__body">
        {/* Manual save form */}
        <div className="vault-form">
          <input
            type="text"
            className="vault-form__input"
            placeholder={t('panel.domainPh')}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            spellCheck={false}
            aria-label={t('panel.domainAria')}
          />
          <input
            type="text"
            className="vault-form__input"
            placeholder={t('panel.usernamePh')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            spellCheck={false}
            aria-label={t('panel.usernameAria')}
          />
          <input
            type="password"
            className="vault-form__input"
            placeholder={t('panel.passwordPh')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('panel.passwordAria')}
          />
          <div className="vault-form__actions">
            <button
              type="button"
              className="vault-form__btn"
              onClick={handleSave}
              disabled={!domain.trim() || !username.trim() || !password.trim()}
              title={t('panel.saveTip')}
            >
              {t('pw.save')}
            </button>
            <button
              type="button"
              className="vault-form__btn"
              onClick={handleGenerate}
              disabled={!domain.trim() || !username.trim()}
              title={t('panel.genTip')}
            >
              {t('panel.generate')}
            </button>
          </div>
        </div>

        {vault.error && <p className="vault-form__status" role="alert">{nativeErrorMessage(vault.error, lang)}</p>}
        {status && <p className="vault-form__status" role="status">{status}</p>}

        {/* Credential list */}
        {vault.loading ? (
          <p className="panel__empty">{t('panel.loading')}</p>
        ) : vault.error ? null : vault.credentials.length === 0 ? (
          <p className="panel__empty">{t('panel.vaultEmpty')}</p>
        ) : (
          <ul className="panel__list">
            {vault.credentials.map((cred) => (
              <li key={cred.id} className="list-item list-item--vault">
                <button
                  type="button"
                  className="list-item__main"
                  onClick={() => handleFill(cred.id)}
                  title={t('panel.fillTip', { domain: cred.domain })}
                >
                  <span className="list-item__title">{cred.domain}</span>
                  <span className="list-item__url">{cred.username}</span>
                  <span className="list-item__meta">
                    {t('panel.updated', { time: formatRelativeTime(cred.updatedAt, Date.now(), rel) })}
                  </span>
                </button>
                <button
                  type="button"
                  className="list-item__delete"
                  onClick={() => handleDelete(cred.id)}
                  aria-label={t('panel.deleteCredAria', { domain: cred.domain })}
                  title={t('panel.credDeleteTip')}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
