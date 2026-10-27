// Explicit opt-in: a short real Gemini call against an isolated native profile.
// No real table, microphone input, table actions or secret values are used/logged.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse } from "dotenv";
import WebSocket from "ws";
import { AppHandle } from "./e2e/harness.mjs";
import { fixtureServer } from "./e2e/fixtures/server.mjs";
const credentials = process.env.HAYDEV_ENV_FILE
  ? parse(readFileSync(process.env.HAYDEV_ENV_FILE))
  : {};
const secret = process.env.GEMINI_API_KEY || credentials.GEMINI_API_KEY;
if (!secret)
  throw new Error(
    "Set GEMINI_API_KEY or HAYDEV_ENV_FILE before this opt-in test",
  );
const app = new AppHandle();
let socket;
let interval;
let ticket;
let page;
const invoke = (name, args = {}) =>
  page.evaluate(
    ([n, a]) => window.__TAURI_INTERNALS__.invoke(n, a),
    [name, args],
  );
const stats = {
  native: true,
  setup: false,
  frame: false,
  humanRejectedAction: false,
  toolCalls: 0,
  audioChunks: 0,
  transcript: false,
  stopRevoked: false,
};
try {
  await app.launch({
    envOverrides: {
      GEMINI_API_KEY: secret,
      GEMINI_LIVE_MODEL: "gemini-3.8-live",
    },
  });
  page = app.chromePage();
  await page.waitForSelector(".commandbar__input", { timeout: 30000 });
  const tabId = await app.activeTabId(page);
  await invoke("browser_navigate", {
    req: { tabId, url: fixtureServer.url("/static") },
  });
  const fixture = await app.waitTabPage(/\/static/);
  await fixture.waitForSelector("#fixture-marker");
  const control = await invoke("control_set_mode", { mode: "AGENT" });
  assert.equal(control.accepted, true);
  ticket = await invoke("poker_live_start", {
    config: { sessionId: randomUUID(), tabId, format: "cash" },
    mode: "human",
    language: "en",
  });
  const ids = { sessionId: ticket.sessionId, runId: ticket.runId };
  await assert.rejects(
    invoke("poker_live_tool", { ...ids, name: "poker_act", args: {} }),
  );
  stats.humanRejectedAction = true;
  const frame = await invoke("poker_live_frame", ids);
  assert.ok(frame._imageBase64.length > 100);
  stats.frame = true;
  await new Promise((resolve, reject) => {
    const pending = [];
    socket = new WebSocket(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" +
        encodeURIComponent(ticket.token),
    );
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("NATIVE_LIVE_TIMEOUT"));
    }, 45000);
    let complete = false;
    const fail = () => {
      clearTimeout(timeout);
      reject(new Error("NATIVE_LIVE_EXCHANGE_FAILED"));
    };
    socket.on("open", () =>
      socket.send(JSON.stringify({ setup: ticket.setup })),
    );
    socket.on("error", fail);
    socket.on("close", () => {
      if (!complete) fail();
    });
    socket.on("message", (raw) => {
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        fail();
        return;
      }
      if (m.setupComplete) {
        stats.setup = true;
        socket.send(
          JSON.stringify({
            realtimeInput: {
              video: { mimeType: "image/jpeg", data: frame._imageBase64 },
            },
          }),
        );
        socket.send(
          JSON.stringify({
            clientContent: {
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: "This is a connection test on a local fixture page. Use poker_pot_odds with pot=150 and call=50. State the resulting break-even percentage in one spoken sentence. Wait afterwards; do not finish the session.",
                    },
                  ],
                },
              ],
              turnComplete: true,
            },
          }),
        );
      }
      for (const part of m.serverContent?.modelTurn?.parts || [])
        if (part.inlineData?.mimeType?.startsWith("audio/pcm"))
          stats.audioChunks++;
      if (m.serverContent?.outputTranscription?.text) stats.transcript = true;
      for (const call of m.toolCall?.functionCalls || []) {
        stats.toolCalls++;
        if (stats.toolCalls > 12) {
          fail();
          return;
        }
        const work = invoke("poker_live_tool", {
          ...ids,
          name: call.name,
          args: call.args || {},
        })
          .then((result) => {
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.send(
              JSON.stringify({
                toolResponse: {
                  functionResponses: [
                    {
                      id: call.id,
                      name: call.name,
                      response: { result: result.result },
                    },
                  ],
                },
              }),
            );
            if (result.image)
              socket.send(
                JSON.stringify({
                  realtimeInput: {
                    video: { mimeType: "image/jpeg", data: result.image },
                  },
                }),
              );
          })
          .catch(fail);
        pending.push(work);
      }
      if (
        m.serverContent?.turnComplete &&
        stats.toolCalls &&
        stats.audioChunks &&
        stats.transcript
      ) {
        complete = true;
        clearTimeout(timeout);
        Promise.all(pending).then(resolve, reject);
      }
    });
    let busy = false;
    interval = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await invoke("poker_live_frame", ids);
      } catch {
        fail();
      } finally {
        busy = false;
      }
    }, 1500);
  });
  clearInterval(interval);
  interval = null;
  socket.close();
  await invoke("poker_live_record", {
    ...ids,
    role: "assistant",
    text: "Native Live verification completed.",
  });
  await invoke("poker_live_stop", ids);
  await assert.rejects(invoke("poker_live_frame", ids));
  stats.stopRevoked = true;
  const memory = await invoke("poker_memory", { sessionId: ticket.sessionId });
  assert.ok(memory.events.length > 0);
  console.log(JSON.stringify({ ...stats, passed: true }));
} catch {
  console.log(
    JSON.stringify({
      ...stats,
      passed: false,
      error: "NATIVE_LIVE_VERIFICATION_FAILED",
    }),
  );
  process.exitCode = 1;
} finally {
  if (interval) clearInterval(interval);
  socket?.terminate();
  if (ticket && page)
    await invoke("poker_live_stop", {
      sessionId: ticket.sessionId,
      runId: ticket.runId,
    }).catch(() => {});
  await app.stop();
}
