/**
 * GeminiClient (internal agent provider) + Perplexica gemini-provider
 * seeding.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { GeminiClient, toOpenAiMessage } from '../src/main/browser/agent/runtime/gemini-client';
import { buildGeminiProviderEntry, ensureGeminiProvider, ensureOpenAiCompatProvider, perplexicaConfigHash } from '../src/main/browser/runtime/engine/runtime/search-services';
import crypto from 'node:crypto';

describe('GeminiClient (agent provider)', () => {
  const KEY = 'test-key-1234567890';
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  it('isConfigured follows the env key', () => {
    delete process.env.GEMINI_API_KEY;
    const c = new GeminiClient({});
    expect(c.isConfigured()).toBe(false);
    process.env.GEMINI_API_KEY = KEY;
    expect(c.isConfigured()).toBe(true);
    expect(c.config.credentialRef).toBe('env:GEMINI_API_KEY');
    expect(c.config.baseUrl).toContain('generativelanguage.googleapis.com');
  });

  it('chats via the OpenAI-compatible endpoint and maps the reply', async () => {
    process.env.GEMINI_API_KEY = KEY;
    const orig = globalThis.fetch;
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from Gemini' } }],
          usage: { total_tokens: 42 },
        }),
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const c = new GeminiClient({ model: 'gemini-2.5-flash' });
      const r = await c.chat({
        model: '',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.1,
      });
      expect(r.content).toBe('Hello from Gemini');
      expect(r.totalTokens).toBe(42);
      expect(captured!.url).toContain('/v1beta/openai/chat/completions');
      const headers = captured!.init.headers as Record<string, string>;
      expect(headers.authorization).toBe(`Bearer ${KEY}`);
      const body = JSON.parse(String(captured!.init.body));
      expect(body.model).toBe('gemini-2.5-flash');
      expect(body.messages[0].content).toBe('hi');
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('maps base64 images to image_url parts (vision grounding)', () => {
    const m = toOpenAiMessage({ role: 'user', content: 'look', images: ['QUJD'] });
    const parts = m.content as Array<Record<string, unknown>>;
    expect(parts[0]).toEqual({ type: 'text', text: 'look' });
    expect(parts[1].type).toBe('image_url');
    expect(JSON.stringify(parts[1])).toContain('data:image/jpeg;base64,QUJD');
  });

  it('fails honestly without a key', async () => {
    delete process.env.GEMINI_API_KEY;
    const c = new GeminiClient({});
    await expect(c.chat({ model: 'x', messages: [] })).rejects.toMatchObject({
      message: 'GEMINI_API_KEY_NOT_CONFIGURED',
    });
  });
});

describe('Perplexica gemini provider seeding', () => {
  it('hash mirrors Perplexica hashObj (sha256 of sorted-key JSON)', () => {
    const config = { apiKey: 'k' };
    const expected = crypto.createHash('sha256')
      .update(JSON.stringify(config, Object.keys(config).sort()))
      .digest('hex');
    expect(perplexicaConfigHash(config)).toBe(expected);
  });

  it('builds a native gemini entry with cheap+quality models', () => {
    const entry = buildGeminiProviderEntry({ apiKey: 'K' }) as {
      id: string; type: string; chatModels: Array<{ key: string }>; embeddingModels: Array<{ key: string }>; config: { apiKey: string }; hash: string;
    };
    expect(entry.id).toBe('gemini');
    expect(entry.type).toBe('gemini');
    expect(entry.chatModels[0].key).toBe('models/gemini-2.5-flash');
    expect(entry.chatModels.some((m) => m.key.includes('flash-lite'))).toBe(true);
    expect(entry.embeddingModels.length).toBeGreaterThan(0);
    expect(entry.config.apiKey).toBe('K');
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ensureGeminiProvider replaces only the gemini entry, preserves others', () => {
    const cfg = {
      modelProviders: [
        { id: 'ollama', name: 'Ollama', type: 'ollama', chatModels: [], embeddingModels: [], config: {}, hash: 'a' },
        { id: 'gemini', name: 'old', type: 'gemini', chatModels: [], embeddingModels: [], config: { apiKey: 'stale' }, hash: 'b' },
      ],
    };
    ensureGeminiProvider(cfg, { apiKey: 'NEW', chatModelKey: 'models/gemini-2.5-flash' });
    expect(cfg.modelProviders).toHaveLength(2);
    expect(cfg.modelProviders[0].id).toBe('gemini');
    expect((cfg.modelProviders[0].config as { apiKey: string }).apiKey).toBe('NEW');
    expect(cfg.modelProviders[1].id).toBe('ollama');
  });
});

describe('NVIDIA NIM provider seeding (openai-compat)', () => {
  it('builds an openai entry pointing at integrate.api.nvidia.com with baseURL+key config', () => {
    const cfg: { modelProviders?: Array<Record<string, unknown>> } = {};
    ensureOpenAiCompatProvider(cfg, {
      id: 'openai',
      name: 'NVIDIA NIM',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'nvapi-x',
      models: [{ key: 'deepseek-ai/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash (NIM)' }],
    });
    const e = cfg.modelProviders![0] as { id: string; type: string; config: { apiKey: string; baseURL: string }; chatModels: Array<{ key: string }>; hash: string };
    expect(e.id).toBe('openai');
    expect(e.type).toBe('openai');
    expect(e.config.baseURL).toBe('https://integrate.api.nvidia.com/v1');
    expect(e.config.apiKey).toBe('nvapi-x');
    expect(e.chatModels[0].key).toBe('deepseek-ai/deepseek-v4-flash-0731');
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
