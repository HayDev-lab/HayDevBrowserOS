/**
 * MCP tool registry — integrity tests (PROMPT 8 + Dark Web Search).
 *
 * Proves:
 *   - the registry exposes EXACTLY the approved tools
 *     (13 V1 browser/agent tools + 8 darkweb_* tools);
 *   - no duplicate names;
 *   - forbidden tools are absent;
 *   - schemas are well-formed;
 *   - unknown tools are rejected by lookup.
 */
import { describe, it, expect } from 'vitest';
import {
  MCP_TOOL_DEFINITIONS,
  FORBIDDEN_MCP_TOOLS,
  auditRegistry,
  isKnownMcpTool,
  getMcpToolDefinition,
  listMcpToolNames,
} from '../src/main/browser/mcp/pure/mcp-tool-registry';

const APPROVED_V1_TOOLS = [
  'browser.status',
  'browser.navigate',
  'browser.read',
  'tabs.list',
  'tabs.open',
  'tabs.activate',
  'tabs.close',
  'page.click',
  'page.type',
  'page.scroll',
  'agent.run',
  'agent.stop',
  'browser.take_control',
  // Dark Web Search subsystem (spec §28)
  'darkweb_status',
  'darkweb_providers',
  'darkweb_search',
  'darkweb_fetch',
  'darkweb_crawl',
  'darkweb_crawl_status',
  'darkweb_stop_crawl',
  'darkweb_search_local_index',
  'runtime_status',
] as const;

describe('mcp-tool-registry / approved set', () => {
  it('exposes EXACTLY the approved V1 tools', () => {
    expect([...listMcpToolNames()].sort()).toEqual([...APPROVED_V1_TOOLS].sort());
  });

  it('exposes exactly 22 tools (13 V1 + 8 darkweb + runtime_status)', () => {
    expect(MCP_TOOL_DEFINITIONS.length).toBe(APPROVED_V1_TOOLS.length);
  });

  it('has no duplicate tool names', () => {
    const names = MCP_TOOL_DEFINITIONS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('passes its own integrity audit', () => {
    const audit = auditRegistry();
    expect(audit.valid).toBe(true);
    expect(audit.problems).toEqual([]);
  });
});

describe('mcp-tool-registry / forbidden tools', () => {
  it('contains none of the forbidden tools', () => {
    const names = new Set(MCP_TOOL_DEFINITIONS.map((t) => t.name));
    for (const forbidden of FORBIDDEN_MCP_TOOLS) {
      expect(names.has(forbidden)).toBe(false);
    }
  });

  it('forbids arbitrary code execution tools by name', () => {
    for (const name of ['execute_js', 'eval', 'shell']) {
      expect(FORBIDDEN_MCP_TOOLS).toContain(name);
      expect(isKnownMcpTool(name)).toBe(false);
    }
  });

  it('forbids filesystem / environment / process tools by name', () => {
    for (const name of ['filesystem', 'environment', 'process_env']) {
      expect(FORBIDDEN_MCP_TOOLS).toContain(name);
      expect(isKnownMcpTool(name)).toBe(false);
    }
  });

  it('exposes NO vault tools over MCP', () => {
    const names = listMcpToolNames();
    for (const name of names) {
      expect(name.startsWith('vault.')).toBe(false);
    }
    expect(isKnownMcpTool('vault.decrypt')).toBe(false);
    expect(isKnownMcpTool('vault.get_password')).toBe(false);
    expect(isKnownMcpTool('vault.has')).toBe(false);
    expect(isKnownMcpTool('vault.fill')).toBe(false);
  });
});

describe('mcp-tool-registry / schemas', () => {
  it('every tool has a well-formed object inputSchema', () => {
    for (const tool of MCP_TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(typeof tool.inputSchema.properties).toBe('object');
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('every required param has a property definition of a scalar type', () => {
    for (const tool of MCP_TOOL_DEFINITIONS) {
      for (const req of tool.inputSchema.required) {
        const prop = tool.inputSchema.properties[req];
        expect(prop).toBeDefined();
        expect(['string', 'number', 'boolean']).toContain(prop!.type);
      }
    }
  });

  it('page.scroll direction is enum-constrained', () => {
    const tool = getMcpToolDefinition('page.scroll');
    expect(tool).not.toBeNull();
    expect(tool!.inputSchema.properties.direction.enum).toEqual([
      'up',
      'down',
      'left',
      'right',
    ]);
  });

  it('tab-scoped tools require tabId (same explicit-id rule as the internal agent)', () => {
    for (const name of ['browser.navigate', 'browser.read', 'page.click', 'page.type', 'page.scroll']) {
      const tool = getMcpToolDefinition(name);
      expect(tool!.inputSchema.required).toContain('tabId');
    }
    // Non tab-scoped tools do NOT require tabId.
    for (const name of ['tabs.list', 'tabs.open', 'agent.run', 'agent.stop', 'browser.take_control', 'browser.status']) {
      const tool = getMcpToolDefinition(name);
      expect(tool!.inputSchema.required).not.toContain('tabId');
    }
  });
});

describe('mcp-tool-registry / lookup', () => {
  it('recognizes every registered tool', () => {
    for (const tool of MCP_TOOL_DEFINITIONS) {
      expect(isKnownMcpTool(tool.name)).toBe(true);
      expect(getMcpToolDefinition(tool.name)?.name).toBe(tool.name);
    }
  });

  it('rejects unknown tools', () => {
    expect(isKnownMcpTool('browser.execute_js')).toBe(false);
    expect(isKnownMcpTool('vault.list')).toBe(false);
    expect(isKnownMcpTool('random.tool')).toBe(false);
    expect(getMcpToolDefinition('nope')).toBeNull();
  });
});
