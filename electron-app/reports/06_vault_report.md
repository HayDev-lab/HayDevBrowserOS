# 06 — Credential Vault Report
## Personal Agentic Browser — Production v1

**Stage:** Credential Vault + Safe Autofill (PROMPT 6)
**Final Status:** `STATIC_VERIFIED + UNIT_VERIFIED + INTEGRATION_VERIFIED + DEFERRED_RUNTIME`

---

## FACT

- Repository at start of PROMPT 6: PROMPT 1–5 + Repair 5R complete. 618/618 tests, 22 files, clean git tree.
- `BrowserCore.resolveWebContents(tabId)` (PROMPT 5R) provides the WebContents accessor needed for vault fill.
- `AgentController` accepts optional `vault?: VaultPort` in deps — integration point ready.
- `safeStorage` (Electron) is the encryption boundary — `DEFERRED_RUNTIME` for real DPAPI verification (sandbox has no GUI).

## ASSUMPTION

- `safeStorage.encryptString(plaintext)` returns Buffer (base64 for storage); `safeStorage.decryptString(buffer)` returns plaintext.
- Password generation uses `node:crypto.randomBytes` (not `Math.random`).
- Vault file: `credentials.vault` in `app.getPath('userData')`. Atomic write via temp-file-rename.
- Agent gets `vault.has/fill/generate_and_store`. NOT `vault.getPassword`/`vault.decrypt` (these don't exist).
- `vault.save(domain, username, password)` is user/UI-only (requires plaintext from user input).

## UNKNOWN

- Whether `safeStorage` is available in sandboxed Electron without GUI — `DEFERRED_RUNTIME`.
- Exact real page DOM structure for fill — `DEFERRED_RUNTIME`. Static templates handle common login forms.

## Vault Architecture

```
    ┌──────────────────────────────────────────────────────┐
    │ RENDERER (React)                                     │
    │  VaultPanel ← vault-store (useVaultStore IPC hook)   │
    │     ↓ window.api.vault.save/has/list/fill/delete      │
    └──────┬───────────────────────────────────────────────┘
           │ IPC (contextBridge)
    ┌──────▼──────────────────────────────────────────────┐
    │ MAIN PROCESS                                          │
    │  vault-ipc-handlers.ts (typed ipcMain.handle)        │
    │     ↓                                                 │
    │  CredentialVault (runtime/credential-vault.ts)        │
    │    ├─ EncryptionAdapter (SafeStorageEncryptionAdapter)│
    │    │    ↑ safeStorage.encryptString/decryptString     │
    │    ├─ VaultStorageAdapter (FileVaultStorageAdapter)  │
    │    │    ↑ credentials.vault in userData              │
    │    ├─ DomainMatcher (pure — canonical + subdomain)    │
    │    ├─ PasswordGenerator (pure — crypto.randomBytes)   │
    │    └─ VaultFillAdapter (runtime/vault-fill-adapter.ts)│
    │         ↑ WebContents.executeJavaScript (static tmpl)│
    │         ↑ BrowserCore.resolveWebContents(tabId)      │
    │     ↓ (as VaultPort)                                  │
    │  AgentController (vault?: VaultPort)                 │
    │    ↓                                                  │
    │  Agent Loop (routes vault.* → VaultPort)              │
    └──────────────────────────────────────────────────────┘
```

## Data Model

```typescript
interface CredentialRecord {
  id: string;
  domain: string;          // canonicalized (lowercased, port-stripped)
  username: string;
  encryptedPassword: string; // base64-encoded safeStorage-encrypted
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, string>;
}

// Safe metadata (returned to renderer/IPC/agent — NEVER includes password)
interface CredentialMetadata {
  id: string;
  domain: string;
  username: string;
  createdAt: number;
  updatedAt: number;
}
```

## Encryption Boundary

| Layer | What it sees | What it doesn't see |
|---|---|---|
| Renderer (VaultPanel) | CredentialMetadata only | encryptedPassword, plaintext |
| IPC (vault:* channels) | VaultSaveInput (transient plaintext from UI) → VaultSaveResult (metadata) | encryptedPassword in results |
| Agent (VaultPort) | VaultHasResult, VaultFillResult, VaultGenerateResult — all metadata-only | password, encryptedPassword |
| Timeline | `vault.fill → example.com (<redacted>)` | password value |
| Storage (credentials.vault) | CredentialRecord with encryptedPassword | plaintext |
| Main process (fill) | Decrypts → fills DOM → discards reference | plaintext persisted anywhere |

**Key rule**: Plaintext exists ONLY inside `CredentialVault.fill()` (decrypted for autofill, then discarded). `generateAndStore()` generates + encrypts + discards plaintext immediately.

## Domain Matching

- **Exact match**: `example.com` matches stored `example.com`.
- **Subdomain match**: `login.example.com` matches stored `example.com` (page is a subdomain).
- **Anti-evil-suffix**: `evil-example.com` does NOT match `example.com` (uses `.stored` suffix check, not `includes`).
- **Anti-malicious-parent**: `example.com.attacker.net` does NOT match `example.com`.
- **Case-insensitive**: All domains lowercased before comparison.
- **Ports stripped**: `example.com:443` → `example.com`.
- **IP addresses rejected**: `192.168.1.1` → null.
- **localhost rejected**: Not a real domain for vault.

## Safe Autofill

`vault.fill(tabId, domain)`:
1. Canonicalize domain
2. Find matching stored credential (domain match)
3. Decrypt password (main-process only, via safeStorage)
4. Execute fill script on WebContents (static template — username + password passed via JSON.stringify, not code interpolation)
5. Return `{success, usernameFilled, passwordFilled, matchedDomain}` — NO password
6. Plaintext reference discarded after fill

## Agent Integration

3 vault tools added to tool-registry:
- `vault.has(domain)` → `VaultHasResult` (metadata only)
- `vault.fill(tabId, domain)` → `VaultFillResult` (success flags only)
- `vault.generate_and_store(domain, username)` → `VaultGenerateResult` (metadata only, NO password)

**Agent does NOT get**: `vault.getPassword`, `vault.decrypt`, `vault.listWithPasswords` — these methods DO NOT EXIST in any API surface.

Agent loop routes `vault.*` tools to `VaultPort` (separate from `BrowserActionPort`). Timeline summaries for vault tools include `<redacted>` marker.

## Registration Foundation

Flow: `generateAndStore(domain, username)` → `fill(tabId, domain)` → safe completion. Password NEVER appears in test-observed model history, timeline, or IPC results. Verified by `credential-vault.test.ts > registration foundation` test.

## Changed Files

### Created (new)

| Path | Purpose |
|---|---|
| `src/shared/vault-types.ts` | Typed contracts: CredentialRecord, CredentialMetadata, VaultInput/Result types, VaultPort, EncryptionAdapter, VaultStorageAdapter, VAULT_BOUNDS |
| `src/main/browser/vault/pure/domain-matcher.ts` | Canonical domain matching, subdomain policy, anti-evil-suffix |
| `src/main/browser/vault/pure/password-generator.ts` | Crypto-secure password generation (crypto.randomBytes, rejection sampling, Fisher-Yates shuffle) |
| `src/main/browser/vault/pure/vault-record-validator.ts` | Record validation, metadata sanitization, toMetadata/toMetadataList |
| `src/main/browser/vault/pure/vault-result-mapper.ts` | Safe result mapping (no plaintext), timeline summaries, isResultSafe defense-in-depth |
| `src/main/browser/vault/runtime/encryption-adapter.ts` | SafeStorageEncryptionAdapter (production — uses electron safeStorage) |
| `src/main/browser/vault/runtime/vault-storage-adapter.ts` | FileVaultStorageAdapter (file-backed in userData, atomic write) |
| `src/main/browser/vault/runtime/credential-vault.ts` | Orchestrator: save/has/list/generateAndStore/fill/delete, VaultPort implementation |
| `src/main/browser/vault/runtime/vault-fill-adapter.ts` | WebContents fill via executeJavaScript (static template, JSON.stringify for values) |
| `src/main/vault-ipc-handlers.ts` | Typed ipcMain.handle for vault:* channels |
| `src/renderer/src/store/vault-store.ts` | useVaultStore() React hook |
| `src/renderer/src/components/panels/VaultPanel.tsx` | Minimal vault UI (save form + generate + list + delete + fill) |
| `tests/_fake-vault.ts` | FakeEncryptionAdapter, FakeUnavailableEncryptionAdapter, MemoryVaultStorageAdapter |
| `tests/domain-matcher.test.ts` | 26 tests |
| `tests/password-generator.test.ts` | 7 tests |
| `tests/vault-record-validator.test.ts` | 21 tests |
| `tests/credential-vault.test.ts` | 30 tests |
| `tests/vault-security.test.ts` | 21 tests |
| `reports/06_vault_report.md` | This report |

### Modified

| Path | Change |
|---|---|
| `src/shared/agent-types.ts` | + vault tools in ToolName, + VaultPort import |
| `src/shared/ipc-types.ts` | + VaultChannel, VaultApi, vault types re-export, ExposedApi.vault |
| `src/preload/index.ts` | + 6 vault invoke channels, vaultApi object |
| `src/main/browser/agent/pure/tool-registry.ts` | + 3 vault tool definitions |
| `src/main/browser/agent/pure/tool-validator.ts` | Vault tools skip ActionInput construction (routed to VaultPort) |
| `src/main/browser/agent/pure/agent-loop.ts` | + VaultPort in deps, + executeVaultTool routing, vault tools in listToolsForRequest |
| `src/main/browser/agent/pure/timeline-redactor.ts` | + vault.has/fill/generate_and_store summaries (all include `<redacted>`) |
| `src/main/browser/agent/runtime/agent-controller.ts` | + vault?: VaultPort in deps, passed to loopDeps |
| `src/main/index.ts` | + CredentialVault construction (SafeStorageEncryptionAdapter + FileVaultStorageAdapter), registerVaultIpcHandlers |
| `src/renderer/src/store/ui-logic.ts` | PanelKind += 'vault' |
| `src/renderer/src/App.tsx` | + VaultPanel render, Vault toggle button |
| `src/renderer/src/components/TopBar.tsx` | + Vault toggle button |
| `src/renderer/src/styles.css` | + vault panel + vault form styles |

## Commands Actually Run

```bash
# Baseline: 618 tests / 22 files PASS

# After IMPLEMENT:
tsc --noEmit -p tsconfig.{node,web,test}.json  # all PASS
bun run lint                                    # PASS
vitest run --config vitest.config.ts           # 723/723 PASS (27 files)

# Vite builds:
vite build --config vite.main.config.ts         # main.js 86.21 kB (+13.84)
vite build --config vite.preload.config.ts      # preload.js 2.50 kB (+0.29)
vite build --config vite.renderer.config.ts     # renderer 173.64 kB JS + 31.71 kB CSS

# Forge package: app.asar 298173 bytes (+20112)

# Runtime: DEFERRED_RUNTIME (Missing X server)

# Security: 0 anti-patterns, 0 vault.getPassword/decrypt, safeStorage used, 0 Math.random in bundle
```

## Tests Added

| Test file | Tests | Covers |
|---|---|---|
| `tests/domain-matcher.test.ts` | 26 | Canonicalization (URLs, ports, casing, IP, localhost, protocols), matching (exact, subdomain, anti-evil-suffix, anti-malicious-parent, reverse-subdomain), findMatchingDomain |
| `tests/password-generator.test.ts` | 7 | Default/custom length, clamping, character classes (4 required), uniqueness (1000 unique), no Math.random in code |
| `tests/vault-record-validator.test.ts` | 21 | validateSaveInput, validateGenerateInput, validateRecord, toMetadata (strips password), toMetadataList, sanitizeMetadata |
| `tests/credential-vault.test.ts` | 30 | save (encrypt, update, separate), has (exact, subdomain, anti-evil-suffix, invalid), list (metadata only), delete, generateAndStore (no password returned, encrypted), fill (success, subdomain, mismatch, missing, destroyed, decrypt-only-during-fill), encryption boundary (no plaintext in storage, unavailable), registration foundation, agent security (no password in results, no getPassword/decrypt methods) |
| `tests/vault-security.test.ts` | 21 | Timeline summaries (vault.has/fill/generate all redacted), isResultSafe (detects password fields), agent tool security (no getPassword/decrypt/listWithPasswords in registry, 13 tools total), source audit (no plaintext in logs, VaultPort has no getPassword/decrypt, ExposedApi/preload clean) |
| **Total** | **105** | |

## STATIC_VERIFIED

| Check | Result |
|---|---|
| typecheck:node | ✅ PASS |
| typecheck:web | ✅ PASS |
| typecheck:test | ✅ PASS |
| lint | ✅ PASS |
| vite build (main) | ✅ PASS — main.js 86.21 kB |
| vite build (preload) | ✅ PASS — preload.js 2.50 kB |
| vite build (renderer) | ✅ PASS — 173.64 kB JS + 31.71 kB CSS |
| electron-forge package | ✅ PASS — app.asar 298173 bytes |
| Security grep (source) | ✅ 0 anti-patterns |
| Security flags (bundle) | ✅ all 5 correct |
| 0 Math.random in bundle | ✅ |
| safeStorage used in production | ✅ 8 references |
| 0 vault.getPassword/decrypt in source | ✅ |

## UNIT_VERIFIED

723/723 tests PASS (27 files). +105 new (5 new files). All 618 prior tests PASS — zero regression.

## INTEGRATION_VERIFIED

`credential-vault.test.ts` (30 tests) exercises real `CredentialVault` with `FakeEncryptionAdapter` + `MemoryVaultStorageAdapter` + `FakeFillWebContents` — verifies save/has/list/generateAndStore/fill/delete, encryption boundary, registration foundation, agent security.

## SAFE_STORAGE_REAL_WINDOWS

`DEFERRED_RUNTIME` — sandbox has no Electron GUI, no DPAPI/Keychain available. All encryption verification via `FakeEncryptionAdapter`. Production code uses `SafeStorageEncryptionAdapter` (imports `electron.safeStorage`).

## DEFERRED_RUNTIME

| Item | Reason |
|---|---|
| Real safeStorage (DPAPI/Keychain) | Requires running Electron GUI |
| Real WebContents fill (executeJavaScript on live page) | Requires running WebContents |
| Real file I/O for credentials.vault | Requires running Electron userData dir |
| VaultPanel UI rendering | Requires running renderer |

## Security Review

| Check | Result |
|---|---|
| No plaintext password in storage | ✅ — encryptedPassword only (verified by test) |
| No password in logs | ✅ — grep confirms 0 console.log with password |
| No password in timeline | ✅ — vault.fill/generate summaries include `<redacted>` |
| No password in IPC responses | ✅ — VaultSaveResult/VaultFillResult/VaultGenerateResult have no password field |
| No decrypted values through IPC | ✅ — decrypt only happens inside fill(), result has no password |
| No vault.getPassword agent tool | ✅ — method doesn't exist in VaultPort |
| No vault.decrypt agent tool | ✅ — method doesn't exist in VaultPort |
| safeStorage used in production | ✅ — SafeStorageEncryptionAdapter |
| Domain validation before fill | ✅ — matchDomain check in fill() |
| Renderer has no safeStorage access | ✅ — 0 references in renderer |
| Renderer has no filesystem access | ✅ — 0 references in renderer |
| BrowserActionService remains execution boundary | ✅ — vault tools go through VaultPort, not BrowserActionService |

## Password Leak Audit

Grep for "password" in source distinguishes:
- **Identifiers** (field names, variable names, test descriptions) — ALLOWED
- **Redaction markers** (`<redacted>`) — ALLOWED
- **Actual secret values** (plaintext passwords) — NOT FOUND in storage, logs, timeline, IPC results, or agent observations

Verified by:
- `credential-vault.test.ts > encryption boundary > plaintext does not appear in the persisted representation`
- `credential-vault.test.ts > agent security > VaultPort.has/fill/generateAndStore returns no password`
- `vault-security.test.ts > source audit > no console.log with password`

## Confirmed Errors

7 confirmed errors, all closed one-by-one:

1. Test: `generateAndStore` compared `encryptCalls[0]` (plaintext input) with `encryptedPassword` (encrypted output) → fixed test to verify they differ
2. Test: `handles unavailable encryption gracefully` — vault.save() didn't catch encryption throw → added try/catch in save() + generateAndStore()
3. Test: `Math.random` in source comment matched regex → refined regex to strip comments before checking
4. Test: `TOOL_DEFINITIONS.length` expected 10, now 13 → updated to 13 (2 files)
5. Test: `vault.fill` summary didn't include `<redacted>` → added redacted marker
6. Test: `getPassword` in vault-types.ts comment matched regex → strip comments before checking
7. Test: TS2352 `Record<string, unknown>` cast → use double-cast through `unknown`

## Fix Loop History

| # | Error | Fix | Verify |
|---|---|---|---|
| 1 | generateAndStore test wrong comparison | Compare encrypted ≠ plaintext | PASS |
| 2 | save() didn't catch encryption throw | Added try/catch in save + generateAndStore | PASS |
| 3 | Math.random regex matched comment | Strip comments before regex | PASS |
| 4 | TOOL_DEFINITIONS.length 10 → 13 | Updated 2 test files | PASS |
| 5 | vault.fill summary missing redacted | Added `<redacted>` marker | PASS |
| 6 | getPassword regex matched comment | Strip comments before regex | PASS |
| 7 | TS2352 Record cast | Double-cast through unknown | PASS |

## Regression Results

| Check | Before | After | Verdict |
|---|---|---|---|
| typecheck | PASS | PASS | ✅ |
| lint | PASS | PASS | ✅ |
| vitest | 618/618 | 723/723 | ✅ all 618 prior PASS |
| vite build (main) | 72.37 kB | 86.21 kB | ✅ expected growth |
| vite build (preload) | 2.21 kB | 2.50 kB | ✅ |
| vite build (renderer) | 169.11 kB | 173.64 kB | ✅ |
| forge package | 278061 | 298173 | ✅ |
| Security baseline | 0 anti-patterns | 0 anti-patterns | ✅ |
| Browser Core tests | 123 PASS | 123 PASS | ✅ |
| BrowserActionService tests | 173 PASS | 173 PASS | ✅ |
| Neural Cockpit tests | 116 PASS | 116 PASS | ✅ |
| Agent Runtime tests | 175 PASS | 175 PASS | ✅ |
| WebContents resolver tests | 31 PASS | 31 PASS | ✅ |

## Remaining Blockers

| # | Blocker | Severity |
|---|---|---|
| B1 | Real safeStorage (DPAPI/Keychain) verification | P1 — DEFERRED_RUNTIME |
| B2 | Real WebContents fill on live page | P1 — DEFERRED_RUNTIME |
| B3 | Real VaultPanel UI rendering | P2 — DEFERRED_RUNTIME |

## Final Status

**`STATIC_VERIFIED + UNIT_VERIFIED + INTEGRATION_VERIFIED + DEFERRED_RUNTIME`**

### Exit Criteria assessment

| Criterion | State |
|---|---|
| CredentialVault exists | ✅ |
| Production encryption uses safeStorage | ✅ |
| Persistent plaintext absent | ✅ (verified by test) |
| generateAndStore does not return password | ✅ |
| fill does not return password | ✅ |
| Domain validation present | ✅ (26 domain-matcher tests) |
| Agent cannot request plaintext | ✅ (no getPassword/decrypt in VaultPort) |
| No decrypt/getPassword agent tools | ✅ |
| Registration foundation works through tests | ✅ |
| Vault UI minimally integrated | ✅ (VaultPanel in App.tsx + TopBar toggle) |
| Password/log/timeline redaction proven | ✅ (21 vault-security tests) |
| typecheck PASS | ✅ |
| lint PASS | ✅ |
| tests PASS | ✅ (723/723) |
| builds PASS | ✅ |
| previous regression tests PASS | ✅ (618/618 prior) |
| security audit PASS | ✅ |
| Windows DPAPI verification | ⛔ DEFERRED_RUNTIME |

**`PROMPT_6 = STATIC_VERIFIED + UNIT_VERIFIED + INTEGRATION_VERIFIED + DEFERRED_RUNTIME`**

**`NEXT_ALLOWED = PROMPT_7_INCOGNITO`**
