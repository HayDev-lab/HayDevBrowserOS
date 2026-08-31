/**
 * Vault IPC handlers — Main process side.
 *
 * Wires CredentialVault to the typed IPC channels:
 *   - vault:save / vault:has / vault:list / vault:generateAndStore / vault:fill / vault:delete
 *
 * SECURITY:
 *   - vault:save accepts plaintext password from the renderer (user input),
 *     encrypts it immediately, and NEVER returns it.
 *   - vault:fill decrypts inside the main process and fills the DOM; NEVER
 *     returns the plaintext to the renderer.
 *   - vault:list returns metadata only (no encryptedPassword field).
 */
import { ipcMain } from 'electron';
import type {
  VaultSaveInput,
  VaultHasInput,
  VaultGenerateInput,
  VaultFillInput,
} from '@shared/ipc-types';
import type { CredentialVault } from './browser/vault/runtime/credential-vault';

export function registerVaultIpcHandlers(vault: CredentialVault): void {
  ipcMain.handle('vault:save', (_evt, input: VaultSaveInput) => {
    return vault.save(input);
  });

  ipcMain.handle('vault:has', (_evt, input: VaultHasInput) => {
    return vault.has(input);
  });

  ipcMain.handle('vault:list', () => {
    return vault.list();
  });

  ipcMain.handle('vault:generateAndStore', (_evt, input: VaultGenerateInput) => {
    return vault.generateAndStore(input);
  });

  ipcMain.handle('vault:fill', (_evt, input: VaultFillInput) => {
    return vault.fill(input);
  });

  ipcMain.handle('vault:delete', (_evt, id: string) => {
    return vault.delete(id);
  });
}
