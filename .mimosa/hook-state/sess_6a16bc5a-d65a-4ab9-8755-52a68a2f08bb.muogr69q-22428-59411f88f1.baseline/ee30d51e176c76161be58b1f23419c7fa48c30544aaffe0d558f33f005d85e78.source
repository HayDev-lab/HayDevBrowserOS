/**
 * GeminiClient — OpenAI-compatible client for the Gemini API, satisfying
 * the same OllamaClientPort the internal agent already consumes (spec: one
 * agent runtime, swappable providers).
 *
 * Gemini exposes an OpenAI-compatible endpoint:
 *   POST {baseUrl}/chat/completions   (Bearer API key)
 * Default base: https://generativelanguage.googleapis.com/v1beta/openai
 *
 * SECURITY: the API key is read from the environment at CALL time and is
 * NEVER stored on the config object nor echoed into logs/timeline (same
 * contract as OllamaClient's credentialRef).
 *
 * Vision: OllamaChatMessage.images (base64 JPEG, no data-URI prefix) are
 * mapped to OpenAI image_url content parts — grounded screenshots keep
 * working through Gemini.
 */
import type {
  OllamaChatMessage,
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaClientConfig,
  OllamaClientPort,
} from '@shared/agent-types';

export interface GeminiClientOptions {
  /** OpenAI-compatible base (no trailing slash). */
  baseUrl?: string;
  model?: string;
  credentialEnvVar?: string;
  timeoutMs?: number;
}

export class GeminiClient implements OllamaClientPort {
  readonly config: OllamaClientConfig;

  constructor(private readonly opts: GeminiClientOptions = {}) {
    this.config = {
      baseUrl: opts.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: opts.model ?? process.env.GEMINI_MODEL?.trim() ?? 'gemini-2.5-flash',
      credentialRef: `env:${opts.credentialEnvVar ?? 'GEMINI_API_KEY'}`,
    };
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  private readonly timeoutMs: number;

  private apiKey(): string | undefined {
    return process.env[this.opts.credentialEnvVar ?? 'GEMINI_API_KEY']?.trim() || undefined;
  }

  isConfigured(): boolean {
    const key = this.apiKey();
    return typeof key === 'string' && key.length > 8;
  }

  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    const key = this.apiKey();
    if (!key) throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');

    const messages = request.messages.map((m) => toOpenAiMessage(m));
    // Gemini's OpenAI-compat layer accepts a system message ONLY as the
    // first entry — mid-conversation system messages (the agent loop's
    // parse-error corrective notes) yield HTTP 400. Fold them into user
    // turns, preserving the leading system prompt as-is.
    let seenSystem = false;
    const normalized = messages.map((m) => {
      if (m.role !== 'system') {
        seenSystem = seenSystem || m.role === 'user' || m.role === 'assistant';
        return m;
      }
      if (!seenSystem) {
        seenSystem = true;
        return m;
      }
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return { role: 'user', content: `[system note]\n${text}` };
    });
    const body = {
      model: request.model || this.config.model,
      messages: normalized,
      temperature: request.temperature ?? 0.2,
      stream: false,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        // Diagnostic surface: request shape + full upstream error body, so
        // provider 4xx reports carry enough context to fix the request.
        console.error(
          '[gemini] HTTP', resp.status, 'request summary:',
          JSON.stringify({
            model: body.model,
            messages: messages.map((m) => [
              m.role,
              typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length,
            ]),
          })
        );
        throw new Error(`GEMINI_HTTP_${resp.status}: ${text.slice(0, 600)}`);
      }
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { total_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content ?? '';
      return {
        content,
        totalTokens: data.usage?.total_tokens,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Map an Ollama-style message (optionally with base64 images) to OpenAI shape. */
export function toOpenAiMessage(m: OllamaChatMessage): {
  role: string;
  content: string | Array<Record<string, unknown>>;
} {
  // Gemini's OpenAI-compat layer REJECTS role 'tool' (HTTP 400 "invalid
  // argument") — it only accepts system/user/assistant. Fold tool results
  // into a user message with an explicit marker so the agent protocol
  // stays intact for real Ollama backends.
  if (m.role === 'tool') {
    return { role: 'user', content: `[tool result]\n${m.content}` };
  }
  if (!m.images || m.images.length === 0) {
    return { role: m.role, content: m.content };
  }
  const parts: Array<Record<string, unknown>> = [{ type: 'text', text: m.content }];
  for (const img of m.images.slice(0, 4)) {
    parts.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${img}` },
    });
  }
  return { role: m.role, content: parts };
}
