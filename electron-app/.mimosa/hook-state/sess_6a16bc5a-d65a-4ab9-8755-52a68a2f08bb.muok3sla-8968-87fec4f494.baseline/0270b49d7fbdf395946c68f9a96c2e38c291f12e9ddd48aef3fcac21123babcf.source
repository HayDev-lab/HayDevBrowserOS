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
import { useVaultStore } from '../../store/vault-store';
import { formatRelativeTime } from '../../store/ui-logic';

interface VaultPanelProps {
  open: boolean;
  onClose: () => void;
  activeTabId: string | null;
}

export function VaultPanel({ open, onClose, activeTabId }: VaultPanelProps) {
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
    setStatus(result.success ? 'Saved.' : `Error: ${result.error}`);
    if (result.success) {
      setDomain('');
      setUsername('');
    }
  }, [domain, username, password, vault]);

  const handleGenerate = useCallback(async () => {
    if (!domain.trim() || !username.trim()) return;
    const result = await vault.generateAndStore(domain.trim(), username.trim());
    setStatus(result.success ? 'Generated and stored.' : `Error: ${result.error}`);
    if (result.success) {
      setDomain('');
      setUsername('');
    }
  }, [domain, username, vault]);

  const handleDelete = useCallback(async (id: string) => {
    await vault.delete(id);
  }, [vault]);

  const handleFill = useCallback(async (credDomain: string) => {
    if (!activeTabId) {
      setStatus('No active tab.');
      return;
    }
    const result = await vault.fill(activeTabId, credDomain);
    setStatus(result.success ? 'Filled.' : `Error: ${result.error}`);
  }, [activeTabId, vault]);

  if (!open) return null;

  return (
    <section className="panel panel--vault" aria-label="Vault panel">
      <header className="panel__header">
        <div className="panel__title">
          <span className="panel__title-mark" aria-hidden />
          <h2>VAULT</h2>
          <span className="panel__count">{vault.credentials.length}</span>
        </div>
        <button
          type="button"
          className="panel__close"
          onClick={onClose}
          aria-label="Close vault panel"
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
            placeholder="Domain (e.g. example.com)"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            spellCheck={false}
            aria-label="Domain"
          />
          <input
            type="text"
            className="vault-form__input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            spellCheck={false}
            aria-label="Username"
          />
          <input
            type="password"
            className="vault-form__input"
            placeholder="Password (cleared after save)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-label="Password"
          />
          <div className="vault-form__actions">
            <button
              type="button"
              className="vault-form__btn"
              onClick={handleSave}
              disabled={!domain.trim() || !username.trim() || !password.trim()}
              title="Save credential (password is encrypted with OS key)"
            >
              Save
            </button>
            <button
              type="button"
              className="vault-form__btn"
              onClick={handleGenerate}
              disabled={!domain.trim() || !username.trim()}
              title="Generate a secure password and store it"
            >
              Generate
            </button>
          </div>
        </div>

        {status && <p className="vault-form__status" role="status">{status}</p>}

        {/* Credential list */}
        {vault.loading ? (
          <p className="panel__empty">Loading…</p>
        ) : vault.credentials.length === 0 ? (
          <p className="panel__empty">No saved credentials.</p>
        ) : (
          <ul className="panel__list">
            {vault.credentials.map((cred) => (
              <li key={cred.id} className="list-item list-item--vault">
                <button
                  type="button"
                  className="list-item__main"
                  onClick={() => handleFill(cred.domain)}
                  title={`Fill credentials for ${cred.domain}`}
                >
                  <span className="list-item__title">{cred.domain}</span>
                  <span className="list-item__url">{cred.username}</span>
                  <span className="list-item__meta">
                    updated {formatRelativeTime(cred.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className="list-item__delete"
                  onClick={() => handleDelete(cred.id)}
                  aria-label={`Delete credential for ${cred.domain}`}
                  title="Delete credential"
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
