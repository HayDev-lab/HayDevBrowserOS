/**
 * PasswordCaptureService tests — save-password prompt state machine.
 *
 * The service holds the ONLY copy of the captured plaintext password.
 * Everything it hands out (prompts) must be password-free.
 */
import { describe, it, expect } from 'vitest';
import {
  PasswordCaptureService,
  PROMPT_TTL_MS,
} from '../src/main/browser/vault/pure/password-capture';

function makeService(now: number = 1_000_000) {
  let t = now;
  let idCounter = 0;
  return {
    service: new PasswordCaptureService({
      now: () => t,
      idFactory: () => `id_${++idCounter}`,
    }),
    tick: (ms: number) => {
      t += ms;
    },
  };
}

const TAB = { tabId: 'tab_1', isIncognito: false };
const INCOGNITO = { tabId: 'tab_2', isIncognito: true };

const LOGIN = {
  url: 'https://mail.example.com/login',
  username: 'user@example.com',
  password: 's3cret!',
};

describe('PasswordCaptureService.submit', () => {
  it('creates a pending prompt with canonicalized domain and NO password', () => {
    const { service } = makeService();
    const prompt = service.submit(LOGIN, TAB);

    expect(prompt).not.toBeNull();
    // canonicalizeDomain normalizes the host but keeps subdomains —
    // subdomain grouping happens at match time (findMatchingDomain).
    expect(prompt!.domain).toBe('mail.example.com');
    expect(prompt!.username).toBe('user@example.com');
    expect(prompt!.tabId).toBe('tab_1');
    // SECURITY: the prompt object must never carry the password.
    expect(JSON.stringify(prompt)).not.toContain('s3cret');
    expect(service.current()?.id).toBe(prompt!.id);
  });

  it('ignores incognito tabs entirely', () => {
    const { service } = makeService();
    expect(service.submit(LOGIN, INCOGNITO)).toBeNull();
    expect(service.current()).toBeNull();
  });

  it('ignores non-http(s) URLs and unparseable URLs', () => {
    const { service } = makeService();
    expect(service.submit({ ...LOGIN, url: 'file:///etc/passwd' }, TAB)).toBeNull();
    expect(service.submit({ ...LOGIN, url: 'about:blank' }, TAB)).toBeNull();
    expect(service.submit({ ...LOGIN, url: 'not a url' }, TAB)).toBeNull();
  });

  it('ignores empty or oversized passwords', () => {
    const { service } = makeService();
    expect(service.submit({ ...LOGIN, password: '' }, TAB)).toBeNull();
    expect(service.submit({ ...LOGIN, password: 'x'.repeat(1025) }, TAB)).toBeNull();
  });

  it('accepts an empty username but not an oversized one', () => {
    const { service } = makeService();
    expect(service.submit({ ...LOGIN, username: '' }, TAB)?.username).toBe('');
    expect(
      service.submit({ ...LOGIN, username: 'u'.repeat(321) }, TAB)
    ).toBeNull();
  });

  it('replaces a pending prompt with a newer submission (last login wins)', () => {
    const { service } = makeService();
    service.submit(LOGIN, TAB);
    const second = service.submit(
      { ...LOGIN, username: 'other@example.com' },
      TAB
    );
    expect(second).not.toBeNull();
    expect(service.current()?.username).toBe('other@example.com');
  });

  it('does not re-prompt for an identical pending submission (refreshes TTL)', () => {
    const { service, tick } = makeService();
    const first = service.submit(LOGIN, TAB);
    tick(10_000);
    const again = service.submit(LOGIN, TAB);
    expect(again?.id).toBe(first!.id);
    // TTL was refreshed: still pending long after the first submit.
    tick(PROMPT_TTL_MS - 15_000);
    expect(service.current()?.id).toBe(first!.id);
  });
});

describe('PasswordCaptureService.current / expiry', () => {
  it('returns null after the TTL elapses', () => {
    const { service, tick } = makeService();
    service.submit(LOGIN, TAB);
    tick(PROMPT_TTL_MS - 1);
    expect(service.current()).not.toBeNull();
    tick(1);
    expect(service.current()).toBeNull();
  });

  it('expired() reports expiry and expire() clears without resolving', () => {
    const { service, tick } = makeService();
    service.submit(LOGIN, TAB);
    tick(PROMPT_TTL_MS + 1);
    expect(service.expired()).toBe(true);
    service.expire();
    expect(service.current()).toBeNull();
    // Expired prompts are NOT resolvable — the credentials are dropped.
    expect(service.resolve(true)).toBeNull();
  });
});

describe('PasswordCaptureService.resolve', () => {
  it('with save=true returns credentials exactly once', () => {
    const { service } = makeService();
    service.submit(LOGIN, TAB);

    const creds = service.resolve(true);
    expect(creds).toEqual({
      domain: 'mail.example.com',
      username: 'user@example.com',
      password: 's3cret!',
    });
    expect(service.current()).toBeNull();
    expect(service.resolve(true)).toBeNull();
  });

  it('with save=false clears the prompt and never leaks the password', () => {
    const { service } = makeService();
    service.submit(LOGIN, TAB);
    expect(service.resolve(false)).toBeNull();
    expect(service.current()).toBeNull();
    expect(service.resolve(true)).toBeNull();
  });

  it('resolve with no pending prompt is a harmless no-op', () => {
    const { service } = makeService();
    expect(service.resolve(true)).toBeNull();
    expect(service.resolve(false)).toBeNull();
  });
});
