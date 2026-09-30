/**
 * OllamaClient — production HTTP client for Ollama Cloud.
 *
 * Uses the global `fetch` API (available in Node 18+ and Electron's main
 * process). Reads the API key from the environment variable named in
 * `config.credentialRef` AT CALL TIME — never stores the key in the
 * config object, never logs it, never returns it to callers.
 *
 * DEFERRED_RUNTIME: real HTTP calls require network access + a valid
 * Ollama Cloud endpoint + credential. Without a credential,
 * `isConfigured()` returns false and `chat()` throws
 * `OLLAMA_NOT_CONFIGURED`.
 *
 * SECURITY:
 *   - The API key is read from `process.env[credentialRef]` at call time.
 *   - The key is NEVER stored in the client instance.
 *   - The key is NEVER logged.
 *   - The key is NEVER included in error messages.
 *   - The key is NEVER sent to the renderer (the config object returned by
 *     `getConfig()` contains only `baseUrl`, `model`, and `credentialRef`).
 */
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaClientConfig,
  OllamaClientPort,
} from '@shared/agent-types';

export interface OllamaClientOptions {
  baseUrl: string;
  model: string;
  /** Environment variable name that holds the API key. */
  apiKeyEnvVar: string;
  /** Optional request timeout in ms. Default: 30 000. */
  timeoutMs?: number;
  /** Optional fetch override (for tests). */
  fetchImpl?: typeof fetch;
}

const REDACTED = '<redacted>';

export class OllamaClient implements OllamaClientPort {
  readonly config: OllamaClientConfig;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OllamaClientOptions) {
    this.config = {
      baseUrl: opts.baseUrl.replace(/\/+$/, ''),
      model: opts.model,
      credentialRef: `env:${opts.apiKeyEnvVar}`,
    };
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'OllamaClient: global fetch is not available. Provide fetchImpl or run on Node 18+.'
      );
    }
  }

  isConfigured(): boolean {
    const key = this.readKey();
    return typeof key === 'string' && key.length > 0;
  }

  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    if (!this.isConfigured()) {
      throw new Error('OLLAMA_NOT_CONFIGURED');
    }
    const key = this.readKey();
    const url = `${this.config.baseUrl}/api/chat`;
    const body = JSON.stringify({
      model: request.model,
      messages: request.messages,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.2,
      },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Ollama Cloud uses Bearer auth; self-hosted Ollama does not require
          // a key (but accepts one). We always send the header if a key exists.
          Authorization: `Bearer ${key}`,
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        // NEVER include the key in the error message.
        throw new Error(
          `OLLAMA_HTTP_${response.status}: ${truncate(await safeReadText(response), 200)}`
        );
      }
      const data = (await response.json()) as {
        message?: { content?: string };
        content?: string;
        total_tokens?: number;
      };
      const content = data.message?.content ?? data.content ?? '';
      return {
        content,
        totalTokens: data.total_tokens,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`OLLAMA_TIMEOUT: request exceeded ${this.timeoutMs}ms`);
      }
      // Strip any potential key leakage from the error.
      throw new Error(sanitizeError(err));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read the API key from the environment. NEVER log this value.
   */
  private readKey(): string | undefined {
    // The credentialRef is `env:<VAR_NAME>`. Extract the var name.
    const match = /^env:(.+)$/.exec(this.config.credentialRef);
    if (!match) return undefined;
    const varName = match[1]!;
    const value = process.env[varName];
    if (typeof value !== 'string' || value.length === 0) return undefined;
    return value;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    let msg = err.message;
    // If the message contains anything that looks like a bearer token or
    // API key, redact it. This is defense-in-depth — the fetch API should
    // not include the Authorization header in error messages, but we
    // sanitize anyway.
    msg = msg.replace(/Bearer\s+[A-Za-z0-9._-]+/g, `Bearer ${REDACTED}`);
    msg = msg.replace(/sk-[A-Za-z0-9]{20,}/g, REDACTED);
    return truncate(msg, 300);
  }
  return truncate(String(err), 300);
}
