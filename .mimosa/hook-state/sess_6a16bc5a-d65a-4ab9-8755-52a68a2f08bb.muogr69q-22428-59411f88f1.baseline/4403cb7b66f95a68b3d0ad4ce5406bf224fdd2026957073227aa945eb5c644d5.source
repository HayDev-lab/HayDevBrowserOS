/**
 * Incognito policy — pure logic (no electron, no node imports).
 *
 * Centralizes ALL privacy policy decisions for Incognito mode. This is the
 * SINGLE source of truth for what is allowed/disallowed in private sessions.
 *
 * Policies enforced:
 *   - History persistence: OFF in Incognito (transient back/forward OK)
 *   - Agent task persistence: OFF in Incognito (in-memory timeline only)
 *   - Vault auto-save: OFF in Incognito (explicit user action required)
 *   - Vault existing-credential usage: ALLOWED (via explicit vault.fill)
 *   - Session isolation: Incognito uses temporary in-memory partition
 *
 * These functions are consumed by:
 *   - BrowserCore (history persistence check)
 *   - AgentController (timeline persistence check)
 *   - CredentialVault (auto-save check)
 *
 * Each function is a pure decision based on the tab's `isIncognito` flag.
 */
import type { TabState, SessionKind } from '@shared/browser-types';

// ---------------------------------------------------------------------------
// History persistence policy
// ---------------------------------------------------------------------------

/**
 * Whether navigation history should be persisted for this tab.
 *
 * Regular tabs: YES — write to HistoryStore.
 * Incognito tabs: NO — do NOT write to HistoryStore.
 *
 * Transient back/forward navigation state (NavigationStack) is still
 * maintained in memory for the tab's lifetime — it is discarded when the
 * tab is closed.
 */
export function shouldPersistHistory(tab: TabState): boolean {
  // Internal pages (pab://newtab) are not real visits — never persisted.
  if (tab.isIncognito || tab.url.startsWith('pab:')) return false;
  // Local Perplexica search URLs would flood history/top-sites with queries.
  if (/^http:\/\/(127\.0\.0\.1|localhost)/.test(tab.url)) return false;
  return true;
}

/**
 * Whether history should be persisted for a tab given its incognito flag
 * directly (for use before a TabState is fully constructed).
 */
export function shouldPersistHistoryForIncognito(isIncognito: boolean): boolean {
  return !isIncognito;
}

// ---------------------------------------------------------------------------
// Agent task persistence policy
// ---------------------------------------------------------------------------

/**
 * Whether agent task history/timeline should be persisted for this context.
 *
 * Regular context: follows existing persistence policy (V1: in-memory only,
 * but the policy allows future persistent storage).
 * Incognito context: NEVER persisted. Timeline is in-memory only and
 * cleared when the private context ends.
 */
export function shouldPersistAgentTimeline(isIncognitoContext: boolean): boolean {
  return !isIncognitoContext;
}

// ---------------------------------------------------------------------------
// Vault auto-save policy
// ---------------------------------------------------------------------------

/**
 * Whether the vault should auto-save new credentials in this context.
 *
 * Regular context: auto-save is OFF by default (requires explicit user action
 * in all contexts — V1 has no auto-save feature).
 * Incognito context: auto-save is explicitly DENIED. Even if a future
 * auto-save feature is added, it must NOT run in Incognito.
 *
 * Existing credential usage (vault.fill) is ALLOWED in Incognito — the
 * vault is a trusted separate store, and filling an existing credential
 * does not create a new record.
 */
export function shouldAutoSaveVault(isIncognitoContext: boolean): boolean {
  // V1: auto-save is OFF in ALL contexts. Incognito additionally
  // guarantees it will NEVER be turned on for private sessions.
  return false;
}

/**
 * Whether `vault.generate_and_store` is allowed in this context.
 *
 * Regular context: ALLOWED (the agent can generate + store a new credential).
 * Incognito context: DENIED by default. The agent must NOT create new
 * vault records from private browsing. If the user explicitly requests
 * credential generation while in Incognito, they must switch to a regular
 * tab first, or the UI must prompt for explicit confirmation.
 *
 * This prevents the agent from silently creating vault entries while
 * browsing in private mode.
 */
export function isVaultGenerateAllowed(isIncognitoContext: boolean): boolean {
  return !isIncognitoContext;
}

/**
 * Whether `vault.fill` (using existing credentials) is allowed in this context.
 *
 * Both regular and Incognito contexts: ALLOWED. Filling an existing
 * credential does not create a new record — it uses the trusted vault store.
 * The credential is decrypted in the main process and filled into the DOM;
 * no plaintext is returned to the agent or persisted.
 */
export function isVaultFillAllowed(_isIncognitoContext: boolean): boolean {
  return true;
}

/**
 * Whether `vault.has` (checking if a credential exists) is allowed in this context.
 *
 * Both regular and Incognito contexts: ALLOWED. Checking existence returns
 * metadata only — no password is exposed.
 */
export function isVaultHasAllowed(_isIncognitoContext: boolean): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Session isolation policy
// ---------------------------------------------------------------------------

/**
 * Returns the SessionKind for a tab based on its incognito flag.
 *
 * Regular tab → 'default' (persistent partition).
 * Incognito tab → 'incognito' (temporary in-memory partition).
 */
export function getSessionKindForTab(isIncognito: boolean): SessionKind {
  return isIncognito ? 'incognito' : 'default';
}

/**
 * Whether a SessionKind represents a private/temporary session.
 */
export function isPrivateSessionKind(kind: SessionKind): boolean {
  return kind === 'incognito';
}

/**
 * Whether a SessionKind represents a persistent session.
 */
export function isPersistentSessionKind(kind: SessionKind): boolean {
  return kind === 'default';
}

// ---------------------------------------------------------------------------
// Incognito context detection
// ---------------------------------------------------------------------------

/**
 * Determine if the current agent run context is incognito.
 *
 * The agent loop operates on tabs — if the active tab (or the tab the agent
 * is interacting with) is incognito, the agent context is incognito.
 *
 * For V1: the agent controller checks the active tab's isIncognito flag.
 */
export function isIncognitoContext(activeTab: TabState | null): boolean {
  return !!activeTab?.isIncognito;
}

/**
 * Validate that a state transition is safe for incognito.
 *
 * TAKE CONTROL should NOT clear private tabs or reload pages.
 * This function returns true if the transition is safe (i.e. does not
 * destroy private browser state).
 */
export function isSafeTakeControlForIncognito(_isIncognito: boolean): boolean {
  // TAKE CONTROL is always safe — it only aborts the agent run and switches
  // to HUMAN mode. It does NOT close tabs, reload pages, or destroy sessions.
  return true;
}
