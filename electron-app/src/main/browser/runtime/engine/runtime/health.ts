/**
 * Health probes for managed services (spec §32: "process running !=
 * service ready"). Plain-HTTP functional checks with hard timeouts.
 */
import type { URL } from 'node:url';

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  /** Machine-readable failure (HEALTH_TIMEOUT / HEALTH_STATUS_<n> / …). */
  errorCode: string | null;
}

/** GET a URL; ok when 2xx (optionally validated by `validate`). */
export async function probeHttp(
  url: string,
  opts: { timeoutMs: number; validate?: (status: number, body: string) => boolean }
): Promise<HealthResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, opts.timeoutMs));
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const body = await resp.text().catch(() => '');
    const ok = resp.status >= 200 && resp.status < 300 && (opts.validate ? opts.validate(resp.status, body) : true);
    return {
      ok,
      latencyMs: Date.now() - started,
      errorCode: ok ? null : ok ? null : resp.status >= 200 && resp.status < 300 ? 'HEALTH_BODY' : `HEALTH_STATUS_${resp.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      errorCode: err instanceof Error && err.name === 'AbortError' ? 'HEALTH_TIMEOUT' : 'HEALTH_UNREACHABLE',
    };
  } finally {
    clearTimeout(timer);
  }
}
