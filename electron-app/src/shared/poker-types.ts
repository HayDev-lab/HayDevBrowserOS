export interface PokerConfig {
  sessionId: string;
  tabId: string;
  format: "cash" | "mtt";
}
export interface PokerMemory {
  events: Array<{ id: number; kind: string; at: number; data: unknown }>;
  lessons: Array<{
    id: number;
    text: string;
    evidenceEvent: number;
    status: "candidate";
  }>;
  learning: string;
}
export interface PokerApi {
  live?: PokerLiveApi;
  memory(sessionId: string): Promise<PokerMemory>;
  message(sessionId: string, text: string): Promise<{ eventId: number }>;
  importKnowledge(
    kind?: "file" | "skill",
  ): Promise<{
    cancelled?: boolean;
    title?: string;
    status?: string;
    documentId?: string;
  }>;
}
export interface PokerLiveTicket {
  runId: string;
  sessionId: string;
  token: string;
  model: string;
  setup: Record<string, unknown>;
}
export interface PokerLiveApi {
  status(): Promise<{
    configured: boolean;
    model: string;
    activeSessionId: string | null;
  }>;
  importToken(): Promise<{
    cancelled?: boolean;
    configured?: boolean;
    persisted?: boolean;
  }>;
  start(
    config: PokerConfig,
    mode: "human" | "auto",
    language: string,
  ): Promise<PokerLiveTicket>;
  frame(sessionId: string, runId: string): Promise<{ _imageBase64: string }>;
  tool(
    sessionId: string,
    runId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ result: unknown; image?: string | null; ended: boolean }>;
  refresh(sessionId: string, runId: string): Promise<PokerLiveTicket>;
  record(
    sessionId: string,
    runId: string,
    role: "user" | "assistant",
    text: string,
  ): Promise<void>;
  stop(sessionId: string, runId: string): Promise<{ accepted: boolean }>;
}
