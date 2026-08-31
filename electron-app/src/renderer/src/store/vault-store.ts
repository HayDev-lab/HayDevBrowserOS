/**
 * Vault store — renderer-side React hook for the Credential Vault.
 *
 * Calls window.api.vault.* (IPC) and manages local state.
 *
 * SECURITY:
 *   - The `password` field from manual-save is cleared from local state
 *     immediately after the save operation completes (or fails).
 *   - The store NEVER holds a decrypted password — decryption happens
 *     only in the main process during `vault.fill`.
 */
import { useState, useEffect, useCallback } from 'react';
import type { CredentialMetadata } from '@shared/ipc-types';

export interface UseVaultStore {
  credentials: CredentialMetadata[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (domain: string, username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  generateAndStore: (domain: string, username: string) => Promise<{ success: boolean; error?: string }>;
  delete: (id: string) => Promise<{ success: boolean; error?: string }>;
  fill: (tabId: string, domain: string) => Promise<{ success: boolean; error?: string }>;
}

export function useVaultStore(): UseVaultStore {
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.api.vault.list();
      setCredentials(result.credentials);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (domain: string, username: string, password: string) => {
    try {
      const result = await window.api.vault.save({ domain, username, password });
      if (result.success) {
        await refresh();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }, [refresh]);

  const generateAndStore = useCallback(async (domain: string, username: string) => {
    try {
      const result = await window.api.vault.generateAndStore({ domain, username });
      if (result.success) {
        await refresh();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }, [refresh]);

  const del = useCallback(async (id: string) => {
    try {
      const result = await window.api.vault.delete(id);
      if (result.success) {
        await refresh();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }, [refresh]);

  const fill = useCallback(async (tabId: string, domain: string) => {
    try {
      const result = await window.api.vault.fill({ tabId, domain });
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
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
