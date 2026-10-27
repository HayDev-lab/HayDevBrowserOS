// No credentials, token values, or provider response bodies are printed.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const req = createRequire(path.join(process.cwd(), "package.json"));
const WebSocket = req("ws");
const parsed = req("dotenv").parse(
  fs.readFileSync(process.env.HAYDEV_ENV_FILE || ".env"),
);
const key = process.env.GEMINI_API_KEY || parsed.GEMINI_API_KEY;
const model = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live";
(async () => {
  const r = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        uses: 1,
        fieldMask: "model,generation_config.response_modalities",
        bidiGenerateContentSetup: {
          model: "models/" + model,
          generationConfig: { responseModalities: ["AUDIO"] },
        },
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!r.ok) throw new Error("TOKEN_HTTP_" + r.status);
  const token = (await r.json()).name;
  const stats = {
    model,
    ticket: true,
    setup: false,
    tool: false,
    audioChunks: 0,
    transcript: false,
    turnComplete: false,
  };
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" +
        encodeURIComponent(token),
    );
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("LIVE_TIMEOUT"));
    }, 30000);
    ws.on("open", () =>
      ws.send(
        JSON.stringify({
          setup: {
            model: "models/" + model,
            generationConfig: { responseModalities: ["AUDIO"] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            sessionResumption: {},
            contextWindowCompression: { slidingWindow: {} },
            tools: [
              {
                functionDeclarations: [
                  {
                    name: "verify_sum",
                    description: "Add two numbers for this connection test.",
                    parameters: {
                      type: "object",
                      properties: {
                        a: { type: "number" },
                        b: { type: "number" },
                      },
                      required: ["a", "b"],
                    },
                  },
                ],
              },
            ],
          },
        }),
      ),
    );
    ws.on("message", (raw) => {
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.setupComplete) {
        stats.setup = true;
        ws.send(
          JSON.stringify({
            clientContent: {
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: "Use verify_sum to add 2 and 3. Then say the result in one short sentence.",
                    },
                  ],
                },
              ],
              turnComplete: true,
            },
          }),
        );
      }
      for (const call of m.toolCall?.functionCalls || []) {
        stats.tool = true;
        ws.send(
          JSON.stringify({
            toolResponse: {
              functionResponses: [
                { id: call.id, name: call.name, response: { result: 5 } },
              ],
            },
          }),
        );
      }
      for (const p of m.serverContent?.modelTurn?.parts || [])
        if (p.inlineData?.mimeType?.startsWith("audio/pcm"))
          stats.audioChunks++;
      if (m.serverContent?.outputTranscription?.text) stats.transcript = true;
      if (
        m.serverContent?.turnComplete &&
        stats.tool &&
        stats.audioChunks > 0 &&
        stats.transcript
      ) {
        stats.turnComplete = true;
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });
    ws.on("error", () => {
      clearTimeout(timer);
      reject(new Error("LIVE_SOCKET_FAILED"));
    });
    ws.on("close", (code) => {
      clearTimeout(timer);
      if (!stats.turnComplete) reject(new Error("LIVE_CLOSED_" + code));
    });
  });
  console.log(JSON.stringify(stats));
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exitCode = 1;
});
