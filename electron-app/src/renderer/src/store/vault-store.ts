import { platformApi } from '../platform';
import { nativeErrorCode } from '@shared/native-errors';
/**
 * Vault store — renderer-side React hook for the Credential Vault.
 *
 * Calls platformApi.vault.* (IPC) and manages local state.
 *
 * SECURITY:
 *   - The `password` field from manual-save is cleared from local state
 *     immediately after the save operation completes (or fails).
 *   - The store NEVER holds a decrypted password — decryption happens
 *     only in the main process during `vault.fill`.
 */
import { useState, useEffect, useCallback } from 'react';
import type { CredentialMetadata } from '@shared/ipc-types';
import type { PasswordSavePrompt } from '@shared/vault-types';

export interface UseVaultStore {
  credentials: CredentialMetadata[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (domain: string, username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  generateAndStore: (domain: string, username: string) => Promise<{ success: boolean; error?: string }>;
  delete: (id: string) => Promise<{ success: boolean; error?: string }>;
  fill: (id: string, tabId: string | null) => Promise<{ success: boolean; error?: string }>;
}

export function useVaultStore(): UseVaultStore {
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await platformApi.vault.list();
      setCredentials(result.credentials);
      setError(null);
    } catch (e) {
      setError(nativeErrorCode(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (domain: string, username: string, password: string) => {
    try {
      const result = await platformApi.vault.save({ domain, username, password });
      if (result.success) {
        await refresh();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: nativeErrorCode(e) };
    }
  }, [refresh]);

  const generateAndStore = useCallback(async (domain: string, username: string) => {
    try {
      const result = await platformApi.vault.generateAndStore({ domain, username });
      if (result.success) {
        await refresh();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: nativeErrorCode(e) };
    }
  }, [refresh]);

  const del = useCallback(async (id: string) => {
    try {
      const result = await platformApi.vault.delete(id);
      if (result.success) {
        await refresh();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: nativeErrorCode(e) };
    }
  }, [refresh]);

  const fill = useCallback(async (id: string, tabId: string | null) => {
    try {
      // PROMPT 03 contract: fill from a CONCRETE record id; the tab's live
      // URL is authorized against the record domain inside the host.
      const result = await platformApi.vault.fill({ id, tabId: tabId ?? undefined });
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: nativeErrorCode(e) };
    }
  }, []);

  return {
    credentials,
    loading,
    error,
    refresh,
    save,
    generateAndStore,
    delete: del,
    fill,
  };
}

// ---------------------------------------------------------------------------
// Save-password prompt (login capture)
// ---------------------------------------------------------------------------

export interface UsePasswordPrompt {
  /** The pending prompt (null = nothing pending). Never carries a password. */
  prompt: PasswordSavePrompt | null;
  /** True while the resolve call is in flight. */
  resolving: boolean;
  resolve: (save: boolean) => Promise<void>;
}

/**
 * Subscribes to `vault:prompt:update` pushes and fetches the current prompt
 * on mount. Deliberately NO `initialized` ref guard — React 18 StrictMode
 * remounts effects and the cleanup would otherwise kill the subscription.
 */
export function usePasswordPrompt(): UsePasswordPrompt {
  const [prompt, setPrompt] = useState<PasswordSavePrompt | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    void platformApi.vault.prompt
      .current()
      .then(setPrompt)
      .catch(() => {});

    const off = platformApi.on('vault:prompt:update', (data) => {
      const update = data as
        | { kind: 'set'; prompt: PasswordSavePrompt }
        | { kind: 'clear' };
      setPrompt(update.kind === 'set' ? update.prompt : null);
    });
    return () => {
      off?.();
    };
  }, []);

  const resolve = useCallback(
    async (save: boolean) => {
      if (!prompt) return;
      setResolving(true);
      try {
        await platformApi.vault.prompt.resolve({ promptId: prompt.id, save });
      } finally {
        setResolving(false);
        setPrompt(null);
      }
    },
    [prompt]
  );

  return { prompt, resolving, resolve };
}
