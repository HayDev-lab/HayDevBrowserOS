/**
 * Controlled provider error model.
 *
 * Any LLM-provider failure (Gemini 400, NVIDIA 5xx, network timeout, tool
 * loop crash) must surface as a `ProviderError` so the API routes can emit a
 * controlled `error` event on the session instead of leaving the HTTP
 * request pending forever (the "eternal spinner" class of bugs).
 */

export type ProviderErrorCode =
  | 'GEMINI_INVALID_ARGUMENT'
  | 'PROVIDER_UNAVAILABLE'
  | 'MODEL_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'TOOL_LOOP_FAILED';

export type ProviderErrorPayload = {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  diagnostics?: string;
};

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly diagnostics?: string;

  constructor(payload: ProviderErrorPayload) {
    super(payload.message);
    this.name = 'ProviderError';
    this.code = payload.code;
    this.retryable = payload.retryable;
    this.httpStatus = payload.httpStatus;
    this.diagnostics = payload.diagnostics;
  }

  /** Wire-safe subset sent to API clients (no stacks). */
  toJSON(): ProviderErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.httpStatus !== undefined ? { httpStatus: this.httpStatus } : {}),
      ...(this.diagnostics ? { diagnostics: this.diagnostics } : {}),
    };
  }
}

/** Statuses that are worth a bounded retry. 4xx protocol errors are NOT. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Extract an HTTP status from an OpenAI SDK APIError-like object. */
function extractHttpStatus(err: any): number | undefined {
  if (typeof err?.status === 'number') return err.status;
  if (typeof err?.httpStatus === 'number') return err.httpStatus;
  return undefined;
}

function isAbortTimeout(err: any): boolean {
  const name = err?.name ?? '';
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    name === 'APIUserAbortError' ||
    name === 'APIConnectionTimeoutError'
  );
}

/**
 * Map any thrown value to a ProviderError. Already-normalized errors pass
 * through untouched (idempotent).
 */
export function normalizeProviderError(
  err: unknown,
  context?: string,
): ProviderError {
  if (err instanceof ProviderError) return err;

  const anyErr = err as any;
  const rawMessage =
    anyErr?.message ??
    (typeof err === 'string' ? err : 'Unknown provider error');
  const status = extractHttpStatus(anyErr);
  const cause = anyErr?.cause;
  const causeText = cause
    ? ` — ${cause?.code ?? cause?.message ?? String(cause)}`
    : '';
  const diagnostics = `${context}: ${rawMessage}${causeText}`;

  let code: ProviderErrorCode;
  let retryable = false;
  let message: string;

  if (isAbortTimeout(anyErr)) {
    code = 'PROVIDER_TIMEOUT';
    retryable = true;
    message = 'The AI provider timed out. Please try again.';
  } else if (status === 400) {
    code = 'GEMINI_INVALID_ARGUMENT';
    message = 'The AI provider rejected the request as invalid.';
  } else if (status === 404) {
    code = 'MODEL_UNAVAILABLE';
    message = 'The selected model is not available for this account.';
  } else if (status === 401 || status === 403) {
    code = 'PROVIDER_UNAVAILABLE';
    message = 'The AI provider rejected the credentials.';
  } else if (status === 429) {
    code = 'RATE_LIMITED';
    retryable = true;
    message = 'Rate limited by the AI provider. Please try again shortly.';
  } else if (status !== undefined && status >= 500) {
    code = 'PROVIDER_UNAVAILABLE';
    retryable = RETRYABLE_STATUSES.has(status);
    message = 'The AI provider is temporarily unavailable. Please try again.';
  } else if (anyErr instanceof TypeError && /fetch|network/i.test(rawMessage)) {
    code = 'PROVIDER_UNAVAILABLE';
    retryable = true;
    message = 'Could not reach the AI provider (network error).';
  } else {
    code = 'TOOL_LOOP_FAILED';
    message = 'The research pipeline failed unexpectedly.';
  }

  return new ProviderError({
    code,
    message,
    retryable,
    ...(status !== undefined ? { httpStatus: status } : {}),
    diagnostics,
  });
}

export function isRetryableProviderError(err: unknown): boolean {
  return normalizeProviderError(err).retryable;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
