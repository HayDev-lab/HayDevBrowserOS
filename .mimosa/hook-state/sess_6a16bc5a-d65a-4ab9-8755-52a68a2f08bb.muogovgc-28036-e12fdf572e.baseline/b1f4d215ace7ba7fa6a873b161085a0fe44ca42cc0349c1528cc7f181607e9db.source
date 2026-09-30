/**
 * FakeOllamaClient — test fixture implementing OllamaClientPort.
 *
 * Scripts responses in order: each `chat()` call returns the next scripted
 * response. Allows full agent-loop verification without real network calls.
 *
 * NOT a production fallback — test fixture only.
 */
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaClientConfig,
  OllamaClientPort,
} from '@shared/agent-types';

export interface FakeOllamaClientOptions {
  config?: Partial<OllamaClientConfig>;
  configured?: boolean;
  /** Scripted responses, returned in order. */
  responses?: string[];
  /** If true, chat() throws. */
  failChat?: boolean;
  /** Error to throw from chat(). */
  chatError?: Error;
  /** If true, repeat the last response after the scripted list is exhausted. */
  repeatLast?: boolean;
  /** Delay before responding, in ms. Default: 0 (instant). */
  delayMs?: number;
}

export class FakeOllamaClient implements OllamaClientPort {
  readonly config: OllamaClientConfig;
  private readonly responses: string[];
  private responseIndex = 0;
  private readonly failChat: boolean;
  private readonly chatError: Error | undefined;
  private readonly _isConfigured: boolean;
  private readonly repeatLast: boolean;
  private readonly delayMs: number;
  public readonly calls: OllamaChatRequest[] = [];

  constructor(opts: FakeOllamaClientOptions = {}) {
    this.config = {
      baseUrl: opts.config?.baseUrl ?? 'https://fake.ollama.local',
      model: opts.config?.model ?? 'fake-model',
      credentialRef: opts.config?.credentialRef ?? 'env:FAKE_OLLAMA_API_KEY',
    };
    this._isConfigured = opts.configured ?? true;
    this.responses = opts.responses ?? [];
    this.failChat = opts.failChat ?? false;
    this.chatError = opts.chatError;
    this.repeatLast = opts.repeatLast ?? false;
    this.delayMs = opts.delayMs ?? 0;
  }

  isConfigured(): boolean {
    return this._isConfigured;
  }

  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    this.calls.push(request);
    if (this.failChat) {
      throw this.chatError ?? new Error('OLLAMA_FAKE_ERROR: simulated failure');
    }
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    let response: string;
    if (this.responseIndex < this.responses.length) {
      response = this.responses[this.responseIndex]!;
      this.responseIndex += 1;
    } else if (this.repeatLast && this.responses.length > 0) {
      response = this.responses[this.responses.length - 1]!;
    } else {
      response = '';
    }
    return {
      content: response,
      totalTokens: response.length,
    };
  }

  /** Test helper: reset the response index. */
  reset(): void {
    this.responseIndex = 0;
    this.calls.length = 0;
  }

  /** Test helper: remaining responses count. */
  remainingResponses(): number {
    return Math.max(0, this.responses.length - this.responseIndex);
  }
}

// ---------------------------------------------------------------------------
// Scripted response builders — produce model output strings
// ---------------------------------------------------------------------------

/**
 * Build a tool-call response string (JSON, fenced).
 */
export function toolCallResponse(
  tool: string,
  args: Record<string, unknown> = {},
  reasoning?: string
): string {
  const obj: Record<string, unknown> = { tool, args };
  if (reasoning) obj.reasoning = reasoning;
  return '```json\n' + JSON.stringify(obj) + '\n```';
}

/**
 * Build a final-answer response string.
 */
export function finalAnswerResponse(answer: string): string {
  return answer;
}

/**
 * Build an unparseable response (to test parse_error handling).
 */
export function unparseableResponse(): string {
  return '{ this is not valid json';
}
