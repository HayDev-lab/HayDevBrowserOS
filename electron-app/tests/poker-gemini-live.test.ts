import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PokerGeminiLive } from "../src/renderer/src/poker-gemini-live";
import type { PokerLiveApi, PokerLiveTicket } from "../src/shared/poker-types";
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  constructor(public url: string) {
    Socket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    const value = JSON.parse(raw);
    this.sent.push(value);
    if (value.setup) queueMicrotask(() => this.receive({ setupComplete: {} }));
  }
  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}
const ticket: PokerLiveTicket = {
  sessionId: "session",
  runId: "generation-1",
  token: "auth_tokens/fake",
  model: "test-live",
  setup: { model: "models/test-live" },
};
let api: PokerLiveApi;
let callbacks: {
  text: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  status: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  error: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  ended: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
};
let clients: PokerGeminiLive[];
function client() {
  const value = new PokerGeminiLive(
    api,
    { sessionId: "session", tabId: "tab", format: "cash" },
    "human",
    "ru",
    callbacks,
  );
  clients.push(value);
  return value;
}
beforeEach(() => {
  Socket.instances = [];
  clients = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal(
    "AudioContext",
    class {
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
    },
  );
  api = {
    status: vi.fn(async () => ({
      configured: true,
      model: "test-live",
      activeSessionId: null,
    })),
    importToken: vi.fn(),
    start: vi.fn(async () => ticket),
    frame: vi.fn(async () => ({ _imageBase64: "jpeg" })),
    tool: vi.fn(async () => ({ result: { ok: true }, ended: false })),
    refresh: vi.fn(async () => ticket),
    record: vi.fn(async () => {}),
    stop: vi.fn(async () => ({ accepted: true })),
  };
  callbacks = {
    text: vi.fn(),
    status: vi.fn(),
    error: vi.fn(),
    ended: vi.fn(),
  };
});
afterEach(async () => {
  for (const c of clients) await c.close();
  vi.unstubAllGlobals();
});
describe("Gemini Live authority and protocol", () => {
  it("waits for setup, sends frames with native generation and revokes on stop", async () => {
    const c = client();
    await c.start(false);
    const socket = Socket.instances[0];
    expect(socket.url).toContain(
      "BidiGenerateContentConstrained?access_token=",
    );
    expect(socket.sent[0]).toHaveProperty("setup");
    expect(api.frame).toHaveBeenCalledWith("session", "generation-1");
    c.sendText("question");
    expect(api.record).toHaveBeenCalledWith(
      "session",
      "generation-1",
      "user",
      "question",
    );
    await c.close();
    expect(api.stop).toHaveBeenCalledExactlyOnceWith("session", "generation-1");
    expect(() => c.sendText("late")).toThrow("LIVE_NOT_READY");
  });
  it("executes a repeated call ID once and ignores canceled calls", async () => {
    const c = client();
    await c.start(false);
    const socket = Socket.instances[0];
    const event = {
      toolCall: {
        functionCalls: [{ id: "once", name: "poker_observe", args: {} }],
      },
    };
    socket.receive(event);
    socket.receive(event);
    socket.receive({ toolCallCancellation: { ids: ["canceled"] } });
    socket.receive({
      toolCall: {
        functionCalls: [{ id: "canceled", name: "poker_observe", args: {} }],
      },
    });
    await vi.waitFor(() =>
      expect(socket.sent.filter((v) => v.toolResponse)).toHaveLength(2),
    );
    expect(api.tool).toHaveBeenCalledExactlyOnceWith(
      "session",
      "generation-1",
      "poker_observe",
      {},
    );
    socket.receive({
      toolCall: {
        functionCalls: [{ id: "once", name: "poker_act", args: {} }],
      },
    });
    await vi.waitFor(() =>
      expect(callbacks.error).toHaveBeenCalledWith("GEMINI_LIVE_TOOL_FAILED"),
    );
    expect(api.tool).toHaveBeenCalledTimes(1);
  });
  it("revokes a ticket returned after Stop without opening a socket", async () => {
    let provision: ((t: PokerLiveTicket) => void) | undefined;
    api.start = vi.fn(
      () =>
        new Promise<PokerLiveTicket>((resolve) => {
          provision = resolve;
        }),
    );
    const c = client();
    const starting = c.start(false);
    await vi.waitFor(() => expect(provision).toBeDefined());
    await c.close();
    provision!(ticket);
    await starting;
    expect(Socket.instances).toHaveLength(0);
    expect(api.stop).toHaveBeenCalledWith("session", "generation-1");
  });
  it("resumes the same native generation and rejects stale refresh tickets", async () => {
    const c = client();
    await c.start(false);
    const first = Socket.instances[0];
    first.receive({
      sessionResumptionUpdate: { resumable: true, newHandle: "resume-test" },
    });
    first.close();
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(2));
    expect(Socket.instances[1].sent[0]).toMatchObject({
      setup: { sessionResumption: { handle: "resume-test" } },
    });
    expect(api.refresh).toHaveBeenCalledWith("session", "generation-1");
    api.refresh = vi.fn(async () => ({ ...ticket, runId: "other-generation" }));
    Socket.instances[1].receive({
      sessionResumptionUpdate: { resumable: true, newHandle: "next" },
    });
    Socket.instances[1].close();
    await vi.waitFor(() =>
      expect(callbacks.error).toHaveBeenCalledWith("GEMINI_LIVE_RESUME_FAILED"),
    );
    expect(Socket.instances).toHaveLength(2);
  });
  it("stops locally on a spoken stop command before dispatching simultaneous tools", async () => {
    const c = client();
    await c.start(false);
    Socket.instances[0].receive({
      serverContent: { inputTranscription: { text: "стоп." } },
      toolCall: {
        functionCalls: [{ id: "late", name: "poker_act", args: {} }],
      },
    });
    await vi.waitFor(() =>
      expect(api.stop).toHaveBeenCalledWith("session", "generation-1"),
    );
    expect(api.tool).not.toHaveBeenCalled();
  });
  it("does not ask for media or start a native run when no key exists", async () => {
    api.status = vi.fn(async () => ({
      configured: false,
      model: "test-live",
      activeSessionId: null,
    }));
    await expect(client().start(true)).rejects.toThrow(
      "GEMINI_KEY_NOT_CONFIGURED",
    );
    expect(api.start).not.toHaveBeenCalled();
  });
});
