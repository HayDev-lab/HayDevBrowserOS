/**
 * PasswordCaptureService — pending "save password?" prompt state machine.
 *
 * Receives captured login submissions from tab preloads (via IPC in main),
 * validates them, and holds AT MOST ONE pending prompt. The plaintext
 * password is kept HERE (main process) and never leaves until resolve —
 * the prompt object handed to the renderer carries no password.
 *
 * PURE — no Electron imports. Caller (vault IPC handlers) wires:
 *   - tab metadata (incognito filtering)
 *   - expiry timers
 *   - push events to the renderer chrome
 *
 * Rules:
 *   - Incognito tabs are NEVER captured (privacy guarantee).
 *   - Only http/https URLs; the domain is canonicalized from the URL host.
 *   - A new submission REPLACES the pending prompt (last login wins).
 *   - An identical pending {domain, username, password} is not re-prompted.
 *   - resolve() hands the credentials out exactly once, then clears.
 *   - expire() clears the pending prompt without saving.
 */
import type { PasswordSavePrompt } from '@shared/vault-types';
import { canonicalizeDomain } from './domain-matcher';

export interface CapturedSubmitInput {
  url: string;
  username: string;
  password: string;
}

export interface TabMeta {
  tabId: string;
  isIncognito: boolean;
}

export interface ResolvedCapture {
  domain: string;
  username: string;
  password: string;
}

const USERNAME_MAX = 320;
const PASSWORD_MAX = 1024;
export const PROMPT_TTL_MS = 5 * 60_000;

export interface PasswordCaptureDeps {
  /** Override Date.now for tests. */
  now?: () => number;
  idFactory?: () => string;
}

export class PasswordCaptureService {
  private pending: {
    prompt: PasswordSavePrompt;
    password: string;
    expiresAt: number;
  } | null = null;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private idCounter = 0;

  constructor(deps: PasswordCaptureDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.idFactory =
      deps.idFactory ??
      (() => {
        this.idCounter += 1;
        return `pwsave_${this.now().toString(36)}_${this.idCounter.toString(36)}`;
      });
  }

  /**
   * Handle a captured form submission. Returns the created prompt, or null
   * when the submission must be ignored (incognito, non-web URL, empty or
   * oversized fields, invalid host, duplicate of the pending prompt).
   */
  submit(input: CapturedSubmitInput, tab: TabMeta): PasswordSavePrompt | null {
    if (tab.isIncognito) return null;

    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;

    const domainResult = canonicalizeDomain(parsed.hostname);
    if (!domainResult.domain) return null;

    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    if (!password || password.length > PASSWORD_MAX) return null;
    if (username.length > USERNAME_MAX) return null;

    if (this.pending) {
      const same =
        this.pending.prompt.domain === domainResult.domain &&
        this.pending.prompt.username === username &&
        this.pending.password === password;
      // Same login re-submitted — keep the existing prompt, just refresh TTL.
      if (same) {
        this.pending.expiresAt = this.now() + PROMPT_TTL_MS;
        return this.pending.prompt;
      }
    }

    const prompt: PasswordSavePrompt = {
      id: this.idFactory(),
      tabId: tab.tabId,
      domain: domainResult.domain,
      username,
      createdAt: this.now(),
    };
    this.pending = {
      prompt,
      password,
      expiresAt: this.now() + PROMPT_TTL_MS,
    };
    return prompt;
  }

  /** The pending prompt (safe to hand to the renderer — no password). */
  current(): PasswordSavePrompt | null {
    if (!this.pending) return null;
    if (this.now() >= this.pending.expiresAt) {
      this.pending = null;
    }
    return this.pending?.prompt ?? null;
  }

  /** True when the pending prompt has expired (caller-driven TTL check). */
  expired(): boolean {
    return this.pending !== null && this.now() >= this.pending.expiresAt;
  }

  /**
   * Resolve the pending prompt. With save=true returns the captured
   * credentials exactly once (password included — main process only);
   * with save=false returns null. Either way the pending prompt clears.
   */
  resolve(save: boolean): ResolvedCapture | null {
    const pending = this.pending;
    this.pending = null;
    if (!pending || !save) return null;
    return {
      domain: pending.prompt.domain,
      username: pending.prompt.username,
      password: pending.password,
    };
  }

  /** Drop the pending prompt without resolving (e.g. TTL elapsed). */
  expire(): void {
    this.pending = null;
  }
}
