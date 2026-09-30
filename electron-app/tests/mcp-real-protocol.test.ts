/**
 * REAL MCP PROTOCOL TEST (PROMPT 8).
 *
 * This is a REAL protocol-level interaction with the installed
 * `@modelcontextprotocol/sdk` (v1.30.0) — no fakes on the protocol path:
 *
 *   start MCP server (real SDK Server + StreamableHTTPServerTransport,
 *   real node:http listener on 127.0.0.1, ephemeral port)
 *     → connect a REAL MCP Client (StreamableHTTPClientTransport)
 *     → listTools
 *     → call browser.status / validation failures / unknown tool
 *     → disconnect
 *     → stop server
 *
 * The HANDLER dependencies are fakes (fake browser/agent ports) because the
 * real Electron GUI is unavailable in this environment — the protocol path
 * (SDK client ↔ SDK server ↔ HTTP ↔ handler) is entirely real.
 */
import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ActionResult, ActionInput } from '@shared/browser-actions-types';
import type { AgentRunRequest, AgentRunResult, AgentStatusSnapshot } from '@shared/agent-types';
import type { McpBrowserPort, McpAgentPort } from '@shared/mcp-types';
import { McpOwnershipGuard } from '../src/main/browser/mcp/pure/mcp-ownership';
import { McpToolHandler } from '../src/main/browser/mcp/runtime/mcp-tool-handler';
import { McpServerRuntime } from '../src/main/browser/mcp/runtime/mcp-server';

// ---------------------------------------------------------------------------
// Fake ports (protocol path stays real; only the Electron-bound services
// are faked — MCP_TO_REAL_BROWSER = DEFERRED_RUNTIME without a GUI).
// ---------------------------------------------------------------------------

class RecordingBrowserPort implements McpBrowserPort {
  public readonly calls: ActionInput[] = [];
  startExecutionContext(): string {
    return 'exec_1';
  }
  stopExecutionContext(): { executionId: string; aborted: boolean; cancelledCount: number } {
    return { executionId: 'exec_1', aborted: false, cancelledCount: 0 };
  }
  async dispatch(input: ActionInput): Promise<ActionResult<unknown>> {
    this.calls.push(input);
    return { success: true, data: { echoed: input.kind }, executionId: 'exec_1', completedAt: 1 };
  }
}

class RecordingAgentPort implements McpAgentPort {
  public readonly runCalls: AgentRunRequest[] = [];
  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    this.runCalls.push(request);
    return { state: 'COMPLETED', answer: 'ok', stepCount: 1, reason: null, error: null };
  }
  stop(): { accepted: boolean } {
    return { accepted: true };
  }
  takeControl(): { accepted: boolean } {
    return { accepted: true };
  }
  getStatus(): AgentStatusSnapshot {
    return {
      state: 'IDLE',
      controlMode: 'HUMAN',
      stepCount: 0,
      maxSteps: 15,
      startedAt: null,
      endedAt: null,
      reason: null,
      error: null,
      providerConfigured: false,
      providerConfig: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const live: { server: McpServerRuntime | null } = { server: null };

function makeServer(): { server: McpServerRuntime; browser: RecordingBrowserPort; agent: RecordingAgentPort; guard: McpOwnershipGuard } {
  const browser = new RecordingBrowserPort();
  const agent = new RecordingAgentPort();
  const guard = new McpOwnershipGuard();
  const handler = new McpToolHandler({ browser, agent, ownership: guard, now: () => 1 });
  const server = new McpServerRuntime({ handler, ownership: guard, port: 0 });
  return { server, browser, agent, guard };
}

async function startAndConnect(): Promise<{
  server: McpServerRuntime;
  client: Client;
  url: string;
  browser: RecordingBrowserPort;
  agent: RecordingAgentPort;
  guard: McpOwnershipGuard;
}> {
  const { server, browser, agent, guard } = makeServer();
  await server.start();
  live.server = server;
  const status = server.status();
  expect(status.running).toBe(true);
  expect(status.host).toBe('127.0.0.1');
  const url = `http://127.0.0.1:${status.port}/mcp`;
  const client = new Client({ name: 'protocol-test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return { server, client, url, browser, agent, guard };
}

afterEach(async () => {
  if (live.server) {
    await live.server.stop();
    live.server = null;
  }
});

/** Parse the single text content block of a CallToolResult. */
function parsePayload(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const text = result.content.find((c) => c.type === 'text')?.text;
  expect(text).toBeDefined();
  return JSON.parse(text!);
}

// ---------------------------------------------------------------------------
// The real protocol flow demanded by PROMPT 8
// ---------------------------------------------------------------------------

describe('REAL MCP PROTOCOL (real SDK client ↔ real SDK server over HTTP)', () => {
  it('start server → connect real client → listTools → 22 approved tools (13 V1 + 8 darkweb + runtime_status)', async () => {
    const { client } = await startAndConnect();
    const listed = await client.listTools();
    expect(listed.tools.length).toBe(22);
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toContain('browser.status');
    expect(names).toContain('browser.take_control');
    expect(names).toContain('agent.run');
    expect(names.filter((n) => n.startsWith('vault.'))).toEqual([]);
    // Schemas are real JSON Schema objects over the wire:
    const status = listed.tools.find((t) => t.name === 'browser.status');
    expect(status?.inputSchema.type).toBe('object');
    await client.close();
  });

  it('call browser.status → validate response', async () => {
    const { client } = await startAndConnect();
    const result = await client.callTool({ name: 'browser.status', arguments: {} });
    const payload = parsePayload(result as never);
    expect(payload.success).toBe(true);
    expect(payload.status).toBe('ok');
    const data = payload.data as Record<string, unknown>;
    expect(data.controlMode).toBe('HUMAN');
    expect(data.agentState).toBe('IDLE');
    expect(data.executionOwner).toBe('NONE');
    await client.close();
  });

  it('call browser.navigate → routes through the port over the real protocol', async () => {
    const { client, browser } = await startAndConnect();
    const result = await client.callTool({
      name: 'browser.navigate',
      arguments: { tabId: 'tab_real', url: 'https://example.com' },
    });
    const payload = parsePayload(result as never);
    expect(payload.success).toBe(true);
    expect(browser.calls).toEqual([{ kind: 'navigate', tabId: 'tab_real', url: 'https://example.com' }]);
    await client.close();
  });

  it('invalid URL over the real protocol → isError + errorCode, zero dispatches', async () => {
    const { client, browser } = await startAndConnect();
    const result = (await client.callTool({
      name: 'browser.navigate',
      arguments: { tabId: 't', url: 'javascript:alert(1)' },
    })) as unknown as { isError?: boolean };
    expect(result.isError).toBe(true);
    const payload = parsePayload(result as never);
    expect(payload.errorCode).toBe('invalid_arguments');
    expect(browser.calls.length).toBe(0);
    await client.close();
  });

  it('unknown tool over the real protocol → isError + unknown_tool', async () => {
    const { client } = await startAndConnect();
    const result = (await client.callTool({ name: 'vault.get_password', arguments: {} })) as unknown as {
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    const payload = parsePayload(result as never);
    expect(payload.errorCode).toBe('unknown_tool');
    await client.close();
  });

  it('ownership over the real protocol: INTERNAL_AGENT rejects a browser action', async () => {
    const { client, guard } = await startAndConnect();
    guard.markInternalAgentActive(true);
    const result = (await client.callTool({
      name: 'tabs.list',
      arguments: {},
    })) as unknown as { isError?: boolean };
    expect(result.isError).toBe(true);
    const payload = parsePayload(result as never);
    expect(payload.errorCode).toBe('internal_agent_active');
    await client.close();
  });

  it('take_control over the real protocol → owner released', async () => {
    const { client, guard } = await startAndConnect();
    guard.markInternalAgentActive(true);
    const result = await client.callTool({ name: 'browser.take_control', arguments: { reason: 'test' } });
    const payload = parsePayload(result as never);
    expect(payload.success).toBe(true);
    const data = payload.data as Record<string, unknown>;
    expect(data.executionOwner).toBe('NONE');
    expect(guard.getOwner()).toBe('NONE');
    await client.close();
  });

  it('disconnect → stop server → status reflects shutdown; restart works', async () => {
    const { server, client } = await startAndConnect();
    await client.close();
    await server.stop();
    const stopped = server.status();
    expect(stopped.running).toBe(false);
    expect(stopped.port).toBeNull();

    // Restart on the SAME port must succeed (graceful stop left no listener).
    await server.start();
    expect(server.status().running).toBe(true);
    const client2 = new Client({ name: 'protocol-test-client', version: '1.0.0' }, { capabilities: {} });
    await client2.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.status().port}/mcp`))
    );
    const listed = await client2.listTools();
    expect(listed.tools.length).toBe(22);
    await client2.close();
  });
});

describe('MCP server lifecycle / port policy', () => {
  it('occupied port → EXPLICIT startup error (no scanning, no fallback)', async () => {
    // Occupy a port with a plain TCP listener.
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const occupiedPort = (blocker.address() as net.AddressInfo).port;

    const { server } = makeServer();
    // Force the occupied port (bypassing the ephemeral default).
    (server as unknown as { port: number }).port = occupiedPort;
    await expect(server.start()).rejects.toThrow(/already in use \(EADDRINUSE\)/);
    expect(server.status().running).toBe(false);

    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });

  it('double start is rejected; stop is idempotent', async () => {
    const { server } = makeServer();
    await server.start();
    live.server = server;
    await expect(server.start()).rejects.toThrow(/already running/);
    await server.stop();
    await server.stop(); // idempotent
    expect(server.status().running).toBe(false);
  });
});
