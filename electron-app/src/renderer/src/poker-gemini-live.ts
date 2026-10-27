import type {
  PokerConfig,
  PokerLiveApi,
  PokerLiveTicket,
} from "@shared/poker-types";
import {
  audioSamples,
  base64,
  responseAudio,
  unbase64,
  type LiveEvent,
} from "./poker-live-protocol";

interface Callbacks {
  text(role: "user" | "assistant", text: string): void;
  status(text: string): void;
  error(text: string): void;
  ended(): void;
}
/** Native ticket -> direct Gemini WSS; long-lived keys never enter this class. */
export class PokerGeminiLive {
  private socket: WebSocket | null = null;
  private input: MediaStream | null = null;
  private microphoneMuted = false;
  private audio: AudioContext | null = null;
  private processor: AudioWorkletNode | null = null;
  private frames: ReturnType<typeof setInterval> | null = null;
  private playing = new Set<AudioBufferSourceNode>();
  private nextAudio = 0;
  private closed = false;
  private epoch = 0;
  private runId: string | null = null;
  private frameBusy = false;
  private setupReady = false;
  private resumeHandle: string | null = null;
  private reconnecting = false;
  private cancellations = new Set<string>();
  private completedCalls = new Map<
    string,
    { fingerprint: string; response: Record<string, unknown> }
  >();
  private tools: Promise<void> = Promise.resolve();
  private inputText = "";
  private outputText = "";
  private fallbackText = "";
  constructor(
    private api: PokerLiveApi,
    private config: PokerConfig,
    private mode: "human" | "auto",
    private language: string,
    private callbacks: Callbacks,
  ) {}
  async start(microphone: boolean) {
    try {
      const status = await this.api.status();
      if (this.closed) throw new Error("LIVE_CANCELLED");
      if (!status.configured)
        throw new Error(
          "GEMINI_KEY_NOT_CONFIGURED: import your .token file in the poker panel",
        );
      if (microphone) {
        this.input = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
          video: false,
        });
        if (this.closed) {
          this.input.getTracks().forEach((t) => t.stop());
          throw new Error("LIVE_CANCELLED");
        }
      }
      this.audio = new AudioContext({ sampleRate: 16000 });
      await this.audio.resume();
      const ticket = await this.api.start(
        this.config,
        this.mode,
        this.language,
      );
      this.runId = ticket.runId;
      if (this.closed) {
        await this.api.stop(this.config.sessionId, this.runId);
        return;
      }
      await this.open(ticket);
      if (this.input) await this.startMicrophone();
      this.frames = setInterval(() => void this.sendFrame(), 1200);
      await this.sendFrame();
      this.sendText(
        "Observe the poker table. Read the appropriate poker skill and explain your assessment. Wait for my questions; use tools for calculations.",
      );
    } catch (e) {
      await this.close();
      throw e;
    }
  }
  private send(value: unknown) {
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.setupReady &&
      !this.closed
    ) {
      if (this.socket.bufferedAmount > 512_000)
        throw new Error("LIVE_NETWORK_BACKPRESSURE");
      this.socket.send(JSON.stringify(value));
    }
  }
  private async open(ticket: PokerLiveTicket) {
    const generation = ++this.epoch;
    this.setupReady = false;
    this.callbacks.status(
      this.reconnecting
        ? "Gemini Live: reconnecting"
        : "Gemini Live: connecting",
    );
    const ws = new WebSocket(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" +
        encodeURIComponent(ticket.token),
    );
    this.socket = ws;
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => {
        reject(new Error("GEMINI_LIVE_SETUP_TIMEOUT"));
        ws.close();
      }, 15000);
      ws.onopen = () => {
        if (this.closed || generation !== this.epoch) {
          clearTimeout(timer);
          ws.close();
          reject(new Error("LIVE_CANCELLED"));
          return;
        }
        const setup = {
          ...ticket.setup,
          ...(this.resumeHandle
            ? { sessionResumption: { handle: this.resumeHandle } }
            : {}),
        };
        ws.send(JSON.stringify({ setup }));
      };
      ws.onmessage = (event) => {
        void (async () => {
          if (this.closed || generation !== this.epoch) return;
          const raw =
            typeof event.data === "string"
              ? event.data
              : await event.data.text();
          if (raw.length > 8_000_000)
            throw new Error("LIVE_RESPONSE_TOO_LARGE");
          const message = JSON.parse(raw) as LiveEvent;
          if (message.setupComplete) {
            ready = true;
            this.setupReady = true;
            clearTimeout(timer);
            this.callbacks.status("Gemini Live: connected");
            resolve();
          }
          await this.receive(message, generation);
        })().catch(() => void this.fail("GEMINI_LIVE_RESPONSE_FAILED"));
      };
      ws.onerror = () => {
        if (!ready) {
          clearTimeout(timer);
          reject(new Error("GEMINI_LIVE_WEBSOCKET_FAILED"));
        }
      };
      ws.onclose = (event) => {
        clearTimeout(timer);
        if (!ready) {
          reject(new Error(`GEMINI_LIVE_SETUP_CLOSED (${event.code})`));
          return;
        }
        if (!this.closed && generation === this.epoch) void this.reconnect();
      };
    });
  }
  private async reconnect() {
    if (this.reconnecting || this.closed) return;
    if (!this.resumeHandle) {
      await this.fail("GEMINI_LIVE_CLOSED: session resumption unavailable");
      return;
    }
    this.reconnecting = true;
    this.setupReady = false;
    this.flushAudio();
    try {
      const ticket = await this.api.refresh(this.config.sessionId, this.runId!);
      if (ticket.runId !== this.runId) throw new Error("STALE_LIVE_GENERATION");
      if (!this.closed) await this.open(ticket);
    } catch {
      await this.fail("GEMINI_LIVE_RESUME_FAILED");
    } finally {
      this.reconnecting = false;
    }
  }
  private async receive(message: LiveEvent, generation: number) {
    if (message.sessionResumptionUpdate)
      this.resumeHandle = message.sessionResumptionUpdate.resumable
        ? (message.sessionResumptionUpdate.newHandle ?? null)
        : null;
    for (const id of message.toolCallCancellation?.ids ?? [])
      this.cancellations.add(id);
    const content = message.serverContent;
    if (content?.interrupted) {
      this.flushAudio();
      this.flushText();
    }
    this.inputText += content?.inputTranscription?.text ?? "";
    if (/^(стоп|stop|կանգ)[.!]?$/iu.test(this.inputText.trim())) {
      this.flushText();
      await this.close();
      return;
    }
    this.outputText += content?.outputTranscription?.text ?? "";
    for (const part of content?.modelTurn?.parts ?? [])
      if (part.text && !part.thought) this.fallbackText += part.text;
    for (const chunk of responseAudio(message))
      this.play(chunk.data, chunk.rate);
    if (content?.turnComplete) this.flushText();
    if (message.toolCall?.functionCalls?.length) {
      const calls = message.toolCall.functionCalls;
      this.tools = this.tools
        .then(async () => {
          const responses = [];
          let image: string | null = null;
          let ended = false;
          for (const call of calls) {
            if (this.closed || generation !== this.epoch) return;
            if (call.id && this.cancellations.has(call.id)) continue;
            if (!call.id) throw new Error("LIVE_TOOL_ID_MISSING");
            const fingerprint = JSON.stringify([call.name, call.args ?? {}]);
            const previous = this.completedCalls.get(call.id);
            if (previous) {
              if (previous.fingerprint !== fingerprint)
                throw new Error("LIVE_TOOL_ID_REUSED");
              responses.push({
                id: call.id,
                name: call.name,
                response: previous.response,
              });
              continue;
            }
            if (this.completedCalls.size >= 10000)
              throw new Error("LIVE_TOOL_BUDGET");
            let response: Record<string, unknown>;
            try {
              const result = await this.api.tool(
                this.config.sessionId,
                this.runId!,
                call.name,
                call.args ?? {},
              );
              image = result.image ?? image;
              ended ||= result.ended;
              response = { result: result.result };
            } catch {
              response = { error: "TOOL_REJECTED_OR_FAILED" };
            }
            this.completedCalls.set(call.id, { fingerprint, response });
            if (!this.cancellations.has(call.id))
              responses.push({ id: call.id, name: call.name, response });
          }
          if (this.closed || generation !== this.epoch) return;
          if (responses.length)
            this.send({ toolResponse: { functionResponses: responses } });
          if (image)
            this.send({
              realtimeInput: { video: { data: image, mimeType: "image/jpeg" } },
            });
          if (ended) await this.close();
        })
        .catch(() => this.fail("GEMINI_LIVE_TOOL_FAILED"));
    }
    if (message.goAway) this.socket?.close(1000);
  }
  private flushText() {
    for (const [role, value] of [
      ["user", this.inputText],
      ["assistant", this.outputText || this.fallbackText],
    ] as const) {
      const text = value.trim().slice(0, 4000);
      if (!text) continue;
      this.callbacks.text(role, text);
      void this.api
        .record(this.config.sessionId, this.runId!, role, text)
        .catch(() => this.callbacks.error("LIVE_MEMORY_WRITE_FAILED"));
    }
    this.inputText = "";
    this.outputText = "";
    this.fallbackText = "";
  }
  private async startMicrophone() {
    const ctx = this.audio!;
    await ctx.audioWorklet.addModule(
      new URL("/poker-pcm-worklet.js", location.href),
    );
    if (this.closed) return;
    const node = new AudioWorkletNode(ctx, "haydev-pcm16");
    this.processor = node;
    node.port.onmessage = (event) => {
      if (this.closed || this.microphoneMuted) return;
      try {
        this.send({
          realtimeInput: {
            audio: {
              data: base64(event.data as ArrayBuffer),
              mimeType: "audio/pcm;rate=16000",
            },
          },
        });
      } catch {
        void this.fail("LIVE_AUDIO_BACKPRESSURE");
      }
    };
    const silent = ctx.createGain();
    silent.gain.value = 0;
    ctx.createMediaStreamSource(this.input!).connect(node);
    node.connect(silent).connect(ctx.destination);
  }
  private async sendFrame() {
    if (this.closed || !this.setupReady || this.frameBusy) return;
    this.frameBusy = true;
    try {
      const frame = await this.api.frame(this.config.sessionId, this.runId!);
      if (!this.closed)
        this.send({
          realtimeInput: {
            video: { data: frame._imageBase64, mimeType: "image/jpeg" },
          },
        });
    } catch {
      if (!this.closed) await this.fail("LIVE_FRAME_OR_AUTHORITY_LOST");
    } finally {
      this.frameBusy = false;
    }
  }
  private play(data: string, rate: number) {
    const ctx = this.audio;
    if (!ctx || this.closed) return;
    const samples = audioSamples(unbase64(data));
    if (this.nextAudio - ctx.currentTime > 15)
      throw new Error("LIVE_OUTPUT_BUFFER_LIMIT");
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    this.playing.add(source);
    source.onended = () => this.playing.delete(source);
    const start = Math.max(ctx.currentTime, this.nextAudio);
    source.start(start);
    this.nextAudio = start + samples.length / rate;
  }
  private flushAudio() {
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
    }
    this.playing.clear();
    this.nextAudio = 0;
  }
  sendText(text: string) {
    if (!text.trim()) return;
    if (
      this.closed ||
      !this.setupReady ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      throw new Error("LIVE_NOT_READY");
    this.send({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: text.slice(0, 4000) }] }],
        turnComplete: true,
      },
    });
    if (this.runId)
      void this.api
        .record(this.config.sessionId, this.runId, "user", text.slice(0, 4000))
        .catch(() => this.callbacks.error("LIVE_MEMORY_WRITE_FAILED"));
  }
  mute(muted: boolean) {
    this.microphoneMuted = muted;
    this.input?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
    if (muted) this.send({ realtimeInput: { audioStreamEnd: true } });
  }
  private async fail(message: string) {
    this.callbacks.error(message);
    await this.close();
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    ++this.epoch;
    if (this.frames) clearInterval(this.frames);
    this.frames = null;
    this.socket?.close();
    this.socket = null;
    this.processor?.disconnect();
    this.processor = null;
    this.input?.getTracks().forEach((t) => t.stop());
    this.input = null;
    this.flushAudio();
    if (this.audio) {
      await this.audio.close().catch(() => {});
      this.audio = null;
    }
    if (this.runId)
      await this.api.stop(this.config.sessionId, this.runId).catch(() => {});
    this.callbacks.status("Gemini Live: stopped");
    this.callbacks.ended();
  }
}
