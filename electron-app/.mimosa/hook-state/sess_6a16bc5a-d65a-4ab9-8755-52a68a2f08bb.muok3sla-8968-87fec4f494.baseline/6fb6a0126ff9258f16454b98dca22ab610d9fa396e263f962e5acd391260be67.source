/**
 * Local MCP Server runtime (PROMPT 8).
 *
 * Real `@modelcontextprotocol/sdk` Server exposed over Streamable HTTP on
 * 127.0.0.1 ONLY, using the SDK's documented stateless pattern: one Server +
 * one StreamableHTTPServerTransport per POST request, no session state.
 *
 * Evidence for the SDK API (verified against installed 1.30.0):
 *   - `Server`                from '@modelcontextprotocol/sdk/server/index.js'
 *   - `StreamableHTTPServerTransport`
 *                            from '@modelcontextprotocol/sdk/server/streamableHttp.js'
 *   - `ListToolsRequestSchema`, `CallToolRequestSchema`
 *                            from '@modelcontextprotocol/sdk/types.js'
 *   - `transport.handleRequest(req: IncomingMessage, res: ServerResponse)` —
 *     the Node transport bridges to the web-standard implementation itself.
 *
 * NETWORK BOUNDARY (hard invariant):
 *   - HOST is pinned to 127.0.0.1 (localhost only — not configurable).
 *   - Single configurable port; occupied port → EXPLICIT startup error.
 *   - No port-range scanning, no WebSocket, no Event Bus, no remote MCP.
 *
 * LIFECYCLE: start() / stop() / status(). Electron shutdown must call
 * stop() so no dangling listener remains.
 *
 * No Electron import — the server runs in the main process but is testable
 * in plain Node (see the real protocol test).
 */
import http from 'node:http';
import { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpServerStatus } from '@shared/mcp-types';
import { McpToolHandler } from './mcp-tool-handler';
import {
  MCP_TOOL_DEFINITIONS,
  listMcpToolNames,
} from '../pure/mcp-tool-registry';
import { serializePayload } from '../pure/mcp-result';
import type { McpOwnershipGuard } from '../pure/mcp-ownership';

// ---------------------------------------------------------------------------
// Network boundary — pinned constants
// ---------------------------------------------------------------------------
export const MCP_HOST = '127.0.0.1' as const;
export const MCP_DEFAULT_PORT = 27_301;
const MCP_PATH = '/mcp';
const SERVER_INFO = { name: 'personal-agentic-browser', version: '0.1.0' } as const;

export interface McpServerRuntimeDeps {
  handler: McpToolHandler;
  ownership: McpOwnershipGuard;
  /**
   * Single configurable port (V1 policy: no scanning). Port 0 asks the OS
   * for an ephemeral port — used by the protocol test; production wiring
   * always passes a fixed port (or the default).
   */
  port?: number;
}

export class McpServerRuntime {
  private httpServer: http.Server | null = null;
  private readonly activeTransports = new Set<StreamableHTTPServerTransport>();
  private running = false;
  private port: number;

  constructor(private deps: McpServerRuntimeDeps) {
    this.port = deps.port ?? MCP_DEFAULT_PORT;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start listening on 127.0.0.1:<port>. Rejects with an EXPLICIT error if
   * the port is occupied or binding fails. No automatic port fallback.
   */
  start(): Promise<void> {
    if (this.running) {
      return Promise.reject(new Error('MCP server is already running'));
    }
    return new Promise<void>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleNodeRequest(req, res).catch((err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'mcp_server_internal_error' }));
          console.error('[mcp] request handling failed:', err instanceof Error ? err.message : err);
        });
      });

      const onError = (err: NodeJS.ErrnoException) => {
        this.running = false;
        this.httpServer = null;
        if (err.code === 'EADDRINUSE') {
          reject(
            new Error(
              `MCP server failed to start: port ${this.port} on ${MCP_HOST} is already in use (EADDRINUSE)`
            )
          );
        } else {
          reject(new Error(`MCP server failed to start on ${MCP_HOST}:${this.port}: ${err.message}`));
        }
      };
      server.once('error', onError);

      // localhost-only bind — the network boundary is enforced here.
      server.listen(this.port, MCP_HOST, () => {
        server.removeListener('error', onError);
        const address = server.address();
        if (typeof address === 'object' && address !== null) {
          this.port = address.port; // resolves ephemeral port 0 to the real one
        }
        this.httpServer = server;
        this.running = true;
        resolve();
      });
    });
  }

  /**
   * Graceful stop: close the HTTP listener and every in-flight transport.
   * Leaves no dangling socket/listener. Idempotent.
   */
  async stop(): Promise<void> {
    this.running = false;
    const server = this.httpServer;
    this.httpServer = null;

    const transports = [...this.activeTransports];
    this.activeTransports.clear();
    for (const transport of transports) {
      try {
        await transport.close();
      } catch {
        // Closing a half-dead transport must not break shutdown.
      }
    }

    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Force-close any keep-alive sockets so close() actually completes.
      server.closeAllConnections?.();
    });
  }

  status(): McpServerStatus {
    return {
      running: this.running,
      host: MCP_HOST,
      port: this.running ? this.port : null,
      toolCount: MCP_TOOL_DEFINITIONS.length,
      executionOwner: this.deps.ownership.getOwner(),
    };
  }

  /** Exposed for tests: the approved tool names. */
  toolNames(): string[] {
    return listMcpToolNames();
  }

  // -------------------------------------------------------------------------
  // Node ⇄ Web-standard bridge + stateless request handling
  // -------------------------------------------------------------------------

  private async handleNodeRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${MCP_HOST}:${this.port}`);
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    const method = (req.method ?? 'GET').toUpperCase();
    if (method !== 'POST') {
      // Stateless server: only POST (JSON-RPC messages) is supported.
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }

    // Stateless pattern (SDK-documented): fresh Server + transport per
    // request, both disposed when the response finishes. The Node transport
    // accepts (IncomingMessage, ServerResponse) directly.
    const sdkServer = new SdkServer(SERVER_INFO, { capabilities: { tools: {} } });
    this.registerToolHandlers(sdkServer);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    this.activeTransports.add(transport);

    res.on('close', () => {
      this.activeTransports.delete(transport);
      void transport.close().then(() => sdkServer.close()).catch(() => undefined);
    });

    await sdkServer.connect(transport);
    await transport.handleRequest(req, res);
  }

  private registerToolHandlers(sdkServer: SdkServer): void {
    sdkServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: MCP_TOOL_DEFINITIONS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }));

    sdkServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const name = request.params.name;
      const args = request.params.arguments;
      const payload = await this.deps.handler.handle(name, args);
      return {
        content: [{ type: 'text' as const, text: serializePayload(payload) }],
        isError: !payload.success,
      };
    });
  }
}
