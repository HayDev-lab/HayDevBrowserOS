/**
 * LIVE model discovery + capability certification (gated GEMINI_CERT=1).
 * Probes chat / structured / tools(non-stream+stream) / native-tools with
 * the CURRENT key; records latency and a verdict per candidate.
 * Never prints API keys (spec §3/§25/§37).
 */
import { describe, it, expect } from 'vitest';

const RUN = process.env.GEMINI_CERT === '1';
const KEY = () => process.env.GEMINI_API_KEY?.trim();
const OPENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const NATIVE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const d = (m: string): void => console.log(`[cert] ${m}`);

interface CertRow {
  model: string;
  chat?: string;
  structured?: string;
  tools?: string;
  streamTools?: string;
  nativeTools?: string;
  latencyMs?: number;
}

const TOOL = {
  type: 'function',
  function: {
    name: 'get_test_value',
    description: 'Get a test value for a query',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
};

async function probe(label: string, url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: string; ms: number }> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = await r.text();
    return { status: r.status, body, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, body: `ERR:${e instanceof Error ? e.message.slice(0, 60) : 'unknown'}`, ms: Date.now() - t0 };
  }
}

describe.skipIf(!RUN)('LIVE Gemini discovery + certification', () => {
  it('discovers and certifies candidates', { timeout: 900_000 }, async () => {
    expect(KEY(), 'GEMINI_API_KEY required').toBeTruthy();

    // ---- 1. Live model list with supportedGenerationMethods ----------------
    const list = await fetch(`${NATIVE_BASE}/models`, { headers: { 'x-goog-api-key': KEY()! } }).then((r) => r.json()) as {
      models?: Array<{ name: string; supportedGenerationMethods?: string[]; displayName?: string }>;
    };
    const all = list.models ?? [];
    d(`total models listed: ${all.length}`);
    const usable = all.filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'));
    // Candidates: flash-lite class (cheap) + flash class (quality), skip
    // pro/tts/image/omni/robotics/transcribe/preview/deprecated families.
    const DEAD = /pro|tts|image|omni|robot|transcri|embed|computer-use|guard|thinking-exp|exp-|preview/i;
    const candidates = usable
      .map((m) => m.name.replace('models/', ''))
      .filter((n) => /flash/i.test(n) && !DEAD.test(n) && !/2\.5/.test(n)) // 2.5 series = dead for this key (proven)
      .sort();
    d('candidates: ' + JSON.stringify(candidates));

    const rows: CertRow[] = [];
    for (const model of candidates.slice(0, 12)) {
      const row: CertRow = { model };
      const auth = { 'content-type': 'application/json', authorization: `Bearer ${KEY()}` };

      // chat
      const chat = await probe('chat', `${OPENAI_BASE}/chat/completions`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply only OK' }], max_tokens: 10 }),
      }, 25_000);
      row.chat = chat.status === 200 ? 'PASS' : `FAIL_${chat.status}`;
      row.latencyMs = chat.ms;
      if (chat.status !== 200) { rows.push(row); d(JSON.stringify(row)); continue; }

      // structured output (json_object) — thinking models spend tokens on
      // reasoning first: a small max_tokens yields an empty content and a
      // false BODY_NO_JSON. Production budget = 2000.
      const st = await probe('structured', `${OPENAI_BASE}/chat/completions`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({
          model, max_tokens: 2000, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Respond ONLY with JSON {"answer":"..."}' },
            { role: 'user', content: 'What is 2+2? Answer briefly.' },
          ],
        }),
      }, 45_000);
      row.structured = st.status === 200 && /"answer"/i.test(st.body) ? 'PASS' : st.status === 200 ? 'BODY_NO_JSON' : `FAIL_${st.status}`;

      // tools non-stream
      const tn = await probe('tools', `${OPENAI_BASE}/chat/completions`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({
          model, max_tokens: 200, tools: [TOOL], tool_choice: 'auto',
          messages: [{ role: 'user', content: "You MUST call get_test_value with query='test'. Then return its value." }],
        }),
      }, 45_000);
      if (tn.status !== 200) row.tools = `FAIL_${tn.status}`;
      else {
        try {
          const tc = JSON.parse(tn.body).choices[0].message.tool_calls;
          row.tools = tc?.length ? 'PASS' : 'NO_TOOL_CALL';
        } catch { row.tools = 'PARSE_FAIL'; }
      }

      // tools STREAM (the exact researcher path)
      const ts = await probe('streamTools', `${OPENAI_BASE}/chat/completions`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({
          model, max_tokens: 200, stream: true, tools: [TOOL], tool_choice: 'auto',
          messages: [{ role: 'user', content: "You MUST call get_test_value with query='test'." }],
        }),
      }, 45_000);
      if (ts.status !== 200) row.streamTools = `FAIL_${ts.status}`;
      else {
        const hasToolDelta = ts.body.includes('"tool_calls"');
        const done = ts.body.includes('[DONE]');
        row.streamTools = hasToolDelta && done ? 'PASS' : hasToolDelta ? 'NO_DONE' : done ? 'NO_TOOL_DELTA' : 'EMPTY';
      }

      // NATIVE tools (functionDeclarations) — the comparison path
      const nat = await probe('nativeTools', `${NATIVE_BASE}/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY()! },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: "You MUST call get_test_value with query='test'." }] }],
          tools: [{ functionDeclarations: [{ name: 'get_test_value', description: 'Get a test value', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] } }] }],
        }),
      }, 45_000);
      if (nat.status !== 200) row.nativeTools = `FAIL_${nat.status}`;
      else row.nativeTools = nat.body.includes('functionCall') ? 'PASS' : 'NO_FUNCTION_CALL';

      rows.push(row);
      d(JSON.stringify(row));
    }

    // ---- Summary table ------------------------------------------------------
    d('---- CERTIFICATION MATRIX ----');
    for (const r of rows) {
      d(`${r.model} | chat=${r.chat} structured=${r.structured} tools=${r.tools} streamTools=${r.streamTools} nativeTools=${r.nativeTools} | ${r.latencyMs}ms`);
    }
    expect(rows.length).toBeGreaterThan(0);
  });
});
  // ---- NVIDIA certification (spec §10) ------------------------------------
  describe.skipIf(!RUN)('LIVE NVIDIA certification', () => {
    it('certifies NIM candidates for tools/structured/stream', { timeout: 600_000 }, async () => {
      const key = process.env.NVIDIA_API_KEY?.trim();
      expect(key, 'NVIDIA_API_KEY required').toBeTruthy();
      const base = 'https://integrate.api.nvidia.com/v1';
      const auth = { 'content-type': 'application/json', authorization: 'Bearer ' + key };
      const models = [
        process.env.NVIDIA_MODEL?.trim() || 'openai/gpt-oss-20b',
        'nvidia/nemotron-3.5-lightning-30b-a3b',
      ].filter(Boolean);
      for (const model of models) {
        const row: CertRow = { model };
        const chat = await probe('chat', base + '/chat/completions', { method: 'POST', headers: auth,
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply only OK' }], max_tokens: 2000 }) }, 30_000);
        row.chat = chat.status === 200 ? 'PASS' : 'FAIL_' + chat.status;
        row.latencyMs = chat.ms;
        if (chat.status === 200) {
          const st = await probe('structured', base + '/chat/completions', { method: 'POST', headers: auth,
            body: JSON.stringify({ model, max_tokens: 2000, response_format: { type: 'json_object' },
              messages: [{ role: 'system', content: 'Respond ONLY with JSON {\"answer\":\"...\"}' }, { role: 'user', content: 'What is 2+2?' }] }) }, 45_000);
          row.structured = st.status === 200 && /\"answer\"/.test(st.body) ? 'PASS' : st.status === 200 ? 'BODY_NO_JSON' : 'FAIL_' + st.status;
          const tn = await probe('tools', base + '/chat/completions', { method: 'POST', headers: auth,
            body: JSON.stringify({ model, max_tokens: 4000, tools: [TOOL], tool_choice: 'auto',
              messages: [{ role: 'user', content: 'You MUST call get_test_value with query=test.' }] }) }, 60_000);
          if (tn.status !== 200) row.tools = 'FAIL_' + tn.status;
          else { try { const tc = JSON.parse(tn.body).choices[0].message.tool_calls; row.tools = tc?.length ? 'PASS' : 'NO_TOOL_CALL'; } catch { row.tools = 'PARSE_FAIL'; } }
          const ts = await probe('streamTools', base + '/chat/completions', { method: 'POST', headers: auth,
            body: JSON.stringify({ model, max_tokens: 4000, stream: true, tools: [TOOL],
              messages: [{ role: 'user', content: 'You MUST call get_test_value with query=test.' }] }) }, 60_000);
          if (ts.status !== 200) row.streamTools = 'FAIL_' + ts.status;
          else row.streamTools = ts.body.includes('[DONE]') ? (ts.body.includes('tool_calls') ? 'PASS' : 'NO_TOOL_DELTA') : 'NO_DONE';
        }
        d(JSON.stringify(row));
      }
    });
  });

