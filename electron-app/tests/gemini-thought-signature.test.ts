/**
 * Gemini thought_signature multi-turn tool loop — production-path regression.
 *
 * Root cause (live-trace verified): Gemini 3.x returns an opaque
 * `extra_content.google.thought_signature` per functionCall; Perplexica's
 * OpenAILLM dropped it on (a) stream receive, (b) ToolCall carry, (c) next-
 * request serialization → Gemini answered HTTP 400 "Function call is missing
 * a thought_signature" on researcher iter-2 → unhandled rejection → /api/search
 * never settled (eternal spinner).
 *
 * These tests drive the REAL Perplexica OpenAILLM (same parser, same history
 * serializer the researcher uses) plus the REAL APISearchAgent error path,
 * against a local fake Gemini OpenAI-compat server that replays captured
 * live wire shapes. Skipped when the Perplexica checkout is absent.
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

import OpenAILLM from '@/lib/models/providers/openai/openaiLLM';
import type { Message } from '@/lib/types';
import type { StreamTextOutput, ToolCall } from '@/lib/models/types';
import {
  ProviderError,
  normalizeProviderError,
} from '@/lib/utils/providerError';

const PERPLEXICA_SRC =
  process.env.PAB_PERPLEXICA_SRC ?? 'D:/Projects/Perplexica/src';
const RUN = existsSync(PERPLEXICA_SRC);

// Importing the agent graph pulls Perplexica's ConfigManager singleton, which
// writes `${DATA_DIR}/data/config.json` at module evaluation — point it at an
// isolated temp dir BEFORE any dynamic import below.
const PERPLEXICA_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'pab-test-data-'));
mkdirSync(path.join(PERPLEXICA_DATA_DIR, 'data'), { recursive: true });
process.env.DATA_DIR = PERPLEXICA_DATA_DIR;

// Real zod instance from the Perplexica tree — the provider calls
// z.toJSONSchema on tool schemas, so schemas must come from ITS instance.
const perplexicaRequire = createRequire(
  path.join(PERPLEXICA_SRC, 'lib/models/providers/openai/openaiLLM.ts'),
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { z } = perplexicaRequire('zod') as typeof import('zod');

const SIG_A = 'El4KXAFpFH0TfwlNSztZ+R5xu5oV9h4NmciAkKH9rZWQBsvIxofcNBuX6ZJPc';
const SIG_B = 'El4KXAFpFH0TmnXpcr3g/tAwa4x2U2GJy/+zczEQ/vNT+Zl4iHoQlU4FHtKUcHt';

const TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web',
    schema: z.object({ query: z.string().describe('The query') }),
  },
] as never;

// ---------------------------------------------------------------------------
// Fake Gemini OpenAI-compatible server (wire shapes captured live 2026-09-18)
// ---------------------------------------------------------------------------

type Responder = (
  callNumber: number,
  body: any,
  respond: (resp: {
    status?: number;
    json?: any;
    sse?: any[];
    errorBody?: { code: number; message: string; status?: string };
  }) => void,
) => void;

function startFakeGemini(respondersOrFn: Responder | Responder[]) {
  const responders = Array.isArray(respondersOrFn)
    ? respondersOrFn
    : [respondersOrFn];
  const bodies: any[] = [];
  let call = 0;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: any = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        body = {};
      }
      bodies.push(body);
      call++;
      const responder = responders[Math.min(call - 1, responders.length - 1)]!;
      responder(call, body, ({ status = 200, json, sse, errorBody }) => {
        if (errorBody) {
          res.writeHead(errorBody.code, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                code: errorBody.code,
                message: errorBody.message,
                status: errorBody.status ?? 'INVALID_ARGUMENT',
              },
            }),
          );
          return;
        }
        if (sse) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          for (const chunk of sse) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json ?? {}));
      });
    });
  });

  return new Promise<{
    port: number;
    bodies: any[];
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        bodies,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** One complete Gemini-style tool-call delta (no `index`, full arguments). */
function geminiToolCallChunk(
  id: string,
  name: string,
  argsJson: string,
  signature: string | undefined,
): any {
  return {
    id: `chatcmpl-${id}`,
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model: 'gemini-3.5-flash',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              ...(signature
                ? { extra_content: { google: { thought_signature: signature } } }
                : {}),
              function: { arguments: argsJson, name },
              id,
              type: 'function',
            },
          ],
        },
        finish_reason: null,
      },
    ],
  };
}

function textDelta(text: string): any {
  return {
    id: 'chatcmpl-text',
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model: 'gemini-3.5-flash',
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  };
}

function finishChunk(reason: string): any {
  return {
    id: 'chatcmpl-finish',
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model: 'gemini-3.5-flash',
    choices: [{ index: 0, delta: {}, finish_reason: reason }],
  };
}

async function consume(
  llm: OpenAILLM,
  input: { messages: Message[]; tools?: never[] },
): Promise<StreamTextOutput[]> {
  const chunks: StreamTextOutput[] = [];
  for await (const chunk of llm.streamText(input as never)) chunks.push(chunk);
  return chunks;
}

const makeLlm = (port: number) =>
  new OpenAILLM({
    apiKey: 'test-key',
    model: 'gemini-3.5-flash',
    baseURL: `http://127.0.0.1:${port}/v1`,
  });

// The production Gemini provider instantiates the LLM with the real
// generativelanguage host; the local fake server stands in for it, so the
// endpoint gate is overridden here (the gate itself is covered directly in
// the serialization test below).
class FakeEndpointGeminiLLM extends OpenAILLM {
  protected isGeminiCompatEndpoint(): boolean {
    return true;
  }
}

const makeLoopLlm = (port: number) =>
  new FakeEndpointGeminiLLM({
    apiKey: 'test-key',
    model: 'gemini-3.5-flash',
    baseURL: `http://127.0.0.1:${port}/v1`,
  });

describe.skipIf(!RUN)(
  'Gemini thought_signature preserve/replay (production path)',
  () => {
    it(
      'streamText captures the signature exactly as received',
      async () => {
        const srv = await startFakeGemini((_n, _b, respond) =>
          respond({
            sse: [
              geminiToolCallChunk('call_1', 'web_search', '{"query":"openai news"}', SIG_A),
              finishChunk('tool_calls'),
            ],
          }),
        );
        try {
          const llm = makeLlm(srv.port);
          const chunks = await consume(llm, {
            messages: [{ role: 'user', content: 'q' }],
            tools: TOOLS,
          });
          const emitted = chunks.flatMap((c) => c.toolCallChunk);
          expect(emitted).toHaveLength(1);
          expect(emitted[0]!.thoughtSignature).toBe(SIG_A);
          expect(emitted[0]!.arguments).toEqual({ query: 'openai news' });
        } finally {
          await srv.close();
        }
      },
      20_000,
    );

    it(
      'parallel tool calls keep their OWN signatures, order and placement',
      async () => {
        const srv = await startFakeGemini((_n, _b, respond) =>
          respond({
            sse: [
              geminiToolCallChunk('call_A', 'web_search', '{"query":"a"}', SIG_A),
              geminiToolCallChunk('call_B', 'scrape_url', '{"url":"https://x"}', SIG_B),
              geminiToolCallChunk('call_C', 'done', '{}', undefined),
              finishChunk('tool_calls'),
            ],
          }),
        );
        try {
          const llm = makeLlm(srv.port);
          const chunks = await consume(llm, {
            messages: [{ role: 'user', content: 'q' }],
            tools: TOOLS,
          });
          const emitted = chunks.flatMap((c) => c.toolCallChunk);
          expect(emitted.map((t) => t.id)).toEqual(['call_A', 'call_B', 'call_C']);
          expect(emitted[0]!.thoughtSignature).toBe(SIG_A);
          expect(emitted[1]!.thoughtSignature).toBe(SIG_B);
          // The unrelated call must NOT receive a copied signature.
          expect(emitted[2]!.thoughtSignature).toBeUndefined();
        } finally {
          await srv.close();
        }
      },
      20_000,
    );

    it(
      'accumulates OpenAI-style indexed split deltas without losing the signature',
      async () => {
        const srv = await startFakeGemini((_n, _b, respond) =>
          respond({
            sse: [
              {
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call_9',
                          type: 'function',
                          function: { name: 'web_search', arguments: '{"query":"ope' },
                          extra_content: { google: { thought_signature: SIG_A } },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              },
              {
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [{ index: 0, function: { arguments: 'nai"}' } }],
                    },
                    finish_reason: null,
                  },
                ],
              },
              finishChunk('tool_calls'),
            ],
          }),
        );
        try {
          const llm = makeLlm(srv.port);
          const chunks = await consume(llm, {
            messages: [{ role: 'user', content: 'q' }],
            tools: TOOLS,
          });
          const emitted = chunks.flatMap((c) => c.toolCallChunk);
          expect(emitted[emitted.length - 1]!.arguments).toEqual({ query: 'openai' });
          expect(emitted[emitted.length - 1]!.thoughtSignature).toBe(SIG_A);
        } finally {
          await srv.close();
        }
      },
      20_000,
    );

    it(
      'sequential 2-step tool loop: iter-2 request replays the EXACT signature (no 400)',
      async () => {
        // Server enforces the Gemini contract: an assistant tool_call without
        // its thought_signature on the SECOND request is a 400, exactly like
        // the live provider.
        const srv = await startFakeGemini((callNumber, _b, respond) => {
          if (callNumber === 1) {
            respond({
              sse: [
                geminiToolCallChunk(
                  'call_A',
                  'web_search',
                  '{"query":"latest OpenAI developments"}',
                  SIG_A,
                ),
                finishChunk('tool_calls'),
              ],
            });
            return;
          }
          const assistant = _b.messages.find(
            (m: any) => m.role === 'assistant' && m.tool_calls?.length,
          );
          const replayed =
            assistant?.tool_calls?.[0]?.extra_content?.google?.thought_signature;
          if (replayed !== SIG_A) {
            respond({
              errorBody: {
                code: 400,
                message:
                  'Function call is missing a thought_signature in functionCall parts',
              },
            });
            return;
          }
          respond({
            sse: [textDelta('Final answer with sources.'), finishChunk('stop')],
          });
        });
        try {
          const llm = makeLoopLlm(srv.port);
          // Production-shaped loop (mirrors Researcher.research):
          const history: Message[] = [
            { role: 'user', content: 'Latest OpenAI developments?' },
          ];

          const iter1 = await consume(llm, {
            messages: [{ role: 'system', content: 'researcher prompt' }, ...history],
            tools: TOOLS,
          });
          const iter1Calls = iter1.flatMap((c) => c.toolCallChunk);
          expect(iter1Calls).toHaveLength(1);
          expect(iter1Calls[0]!.thoughtSignature).toBe(SIG_A);

          history.push({
            role: 'assistant',
            content: '',
            tool_calls: iter1Calls,
          });
          history.push({
            role: 'tool',
            id: iter1Calls[0]!.id,
            name: iter1Calls[0]!.name,
            content: JSON.stringify({
              results: [
                { title: 'OpenAI news', url: 'https://openai.com', content: '...' },
              ],
            }),
          });

          const iter2 = await consume(llm, {
            messages: [{ role: 'system', content: 'researcher prompt' }, ...history],
            tools: TOOLS,
          });
          const iter2Text = iter2.map((c) => c.contentChunk).join('');
          expect(iter2Text).toContain('Final answer');

          // Explicit proof of custody on the wire:
          const secondRequest = srv.bodies[1]!;
          const wireAssistant = secondRequest.messages.find(
            (m: any) => m.role === 'assistant' && m.tool_calls?.length,
          );
          expect(
            wireAssistant.tool_calls[0].extra_content.google.thought_signature,
          ).toBe(SIG_A);
          // And the tool result still maps to its call:
          // [system, user, assistant(tool_calls), tool]
          expect(secondRequest.messages[3].tool_call_id).toBe('call_A');
        } finally {
          await srv.close();
        }
      },
      20_000,
    );

    it(
      'serialization gate: extra_content only travels to the Gemini endpoint, and verbatim',
      () => {
        const toolCall: ToolCall = {
          id: 'call_A',
          name: 'web_search',
          arguments: { query: 'a' },
          thoughtSignature: SIG_A,
        };
        const history: Message[] = [
          { role: 'assistant', content: '', tool_calls: [toolCall] },
          { role: 'tool', id: 'call_A', name: 'web_search', content: '{}' },
        ];

        const geminiLlm = new OpenAILLM({
          apiKey: 'k',
          model: 'gemini-3.5-flash',
          baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        });
        const toGemini = geminiLlm.convertToOpenAIMessages(history);
        const geminiAssistant = toGemini[0] as any;
        expect(
          geminiAssistant.tool_calls[0].extra_content.google.thought_signature,
        ).toBe(SIG_A);
        expect(geminiAssistant.tool_calls[0].function.name).toBe('web_search');
        expect(JSON.parse(geminiAssistant.tool_calls[0].function.arguments)).toEqual({
          query: 'a',
        });

        const nvidiaLlm = new OpenAILLM({
          apiKey: 'k',
          model: 'nemotron',
          baseURL: 'https://integrate.api.nvidia.com/v1',
        });
        const toNvidia = nvidiaLlm.convertToOpenAIMessages(history);
        const nvidiaAssistant = toNvidia[0] as any;
        expect(nvidiaAssistant.tool_calls[0].extra_content).toBeUndefined();
      },
    );

    it(
      'a 400 (signature genuinely missing) is non-retryable GEMINI_INVALID_ARGUMENT — exactly 1 request',
      async () => {
        let requests = 0;
        const srv = await startFakeGemini((_n, _b, respond) => {
          requests++;
          respond({
            errorBody: {
              code: 400,
              message:
                'Function call is missing a thought_signature in functionCall parts',
            },
          });
        });
        try {
          const llm = makeLlm(srv.port);
          const err = await consume(llm, {
            messages: [{ role: 'user', content: 'q' }],
            tools: TOOLS,
          }).then(
            () => null,
            (e) => e,
          );
          expect(err).toBeInstanceOf(ProviderError);
          expect((err as ProviderError).code).toBe('GEMINI_INVALID_ARGUMENT');
          expect((err as ProviderError).retryable).toBe(false);
          expect(requests).toBe(1);
        } finally {
          await srv.close();
        }
      },
      20_000,
    );

    it(
      'transient 503s are retried with backoff and then succeed (bounded to 2 retries)',
      async () => {
        let requests = 0;
        const srv = await startFakeGemini((_n, _b, respond) => {
          requests++;
          if (requests <= 2) {
            respond({
              errorBody: { code: 503, message: 'overloaded', status: 'UNAVAILABLE' },
            });
            return;
          }
          respond({
            json: {
              id: 'x',
              object: 'chat.completion',
              created: 1,
              model: 'gemini-3.5-flash',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'recovered' },
                  finish_reason: 'stop',
                },
              ],
            },
          });
        });
        try {
          const llm = makeLlm(srv.port);
          const out = await llm.generateText({
            messages: [{ role: 'user', content: 'q' }],
          });
          expect(out.content).toBe('recovered');
          expect(requests).toBe(3); // 2 failures + 1 success — bounded, no masking
        } finally {
          await srv.close();
        }
      },
      30_000,
    );

    it(
      'non-stream generateText captures the signature as well',
      async () => {
        const srv = await startFakeGemini((_n, _b, respond) =>
          respond({
            json: {
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: '',
                    tool_calls: [
                      {
                        id: 'call_5',
                        type: 'function',
                        function: { name: 'web_search', arguments: '{"query":"x"}' },
                        extra_content: { google: { thought_signature: SIG_A } },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            },
          }),
        );
        try {
          const llm = makeLlm(srv.port);
          const out = await llm.generateText({
            messages: [{ role: 'user', content: 'q' }],
            tools: TOOLS,
          });
          expect(out.toolCalls[0]!.thoughtSignature).toBe(SIG_A);
        } finally {
          await srv.close();
        }
      },
      20_000,
    );
  },
);

describe.skipIf(!RUN)('provider error normalization + route contract', () => {
  it('maps provider failures to the controlled error model', () => {
    const mk = (status: number, message: string) =>
      Object.assign(new Error(message), { status });

    expect(
      normalizeProviderError(mk(400, 'missing thought_signature')).code,
    ).toBe('GEMINI_INVALID_ARGUMENT');
    expect(normalizeProviderError(mk(404, 'model not found')).code).toBe(
      'MODEL_UNAVAILABLE',
    );
    expect(normalizeProviderError(mk(429, 'rate limited')).code).toBe('RATE_LIMITED');
    expect(normalizeProviderError(mk(429, 'x')).retryable).toBe(true);
    expect(normalizeProviderError(mk(503, 'overloaded')).code).toBe(
      'PROVIDER_UNAVAILABLE',
    );
    expect(normalizeProviderError(mk(503, 'x')).retryable).toBe(true);
    expect(normalizeProviderError(mk(401, 'bad key')).code).toBe(
      'PROVIDER_UNAVAILABLE',
    );
    expect(normalizeProviderError(mk(401, 'x')).retryable).toBe(false);

    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(normalizeProviderError(timeout).code).toBe('PROVIDER_TIMEOUT');
    expect(normalizeProviderError(new Error('plan exploded')).code).toBe(
      'TOOL_LOOP_FAILED',
    );

    // idempotent
    const already = normalizeProviderError(mk(400, 'x'));
    expect(normalizeProviderError(already)).toBe(already);
  });

  it(
    'APISearchAgent: a provider 400 emits a controlled session error and settles (no unhandled rejection, no pending)',
    async () => {
      const { default: APISearchAgent } = await import('@/lib/agents/search/api');
      const SessionManager = (await import('@/lib/session')).default;

      const failingLlm = {
        generateObject: async () => {
          throw new ProviderError({
            code: 'GEMINI_INVALID_ARGUMENT',
            message: 'Function call is missing a thought_signature',
            retryable: false,
            httpStatus: 400,
          });
        },
        streamText: async function* () {
          yield {
            contentChunk: '',
            toolCallChunk: [],
            additionalInfo: {},
            done: true,
          };
        },
      };

      const session = SessionManager.createSession();
      const events: Array<{ event: string; data: any }> = [];
      const unsubscribe = session.subscribe((event, data) => {
        events.push({ event, data });
      });

      const agent = new APISearchAgent();
      // Must RESOLVE (agent swallows + emits), never reject.
      await agent.searchAsync(session, {
        chatHistory: [],
        followUp: 'Latest OpenAI developments',
        classification: {
          classification: { skipSearch: false },
          standaloneFollowUp: 'x',
        },
        config: {
          llm: failingLlm as never,
          embedding: {} as never,
          sources: ['web'],
          mode: 'balanced',
          fileIds: [],
          systemInstructions: '',
        },
      } as never);

      const errorEvent = events.find((e) => e.event === 'error');
      expect(errorEvent).toBeTruthy();
      const payload = errorEvent!.data?.data;
      expect(payload.code).toBe('GEMINI_INVALID_ARGUMENT');
      expect(payload.retryable).toBe(false);
      expect(typeof payload.message).toBe('string');
      unsubscribe();
    },
    20_000,
  );
});
