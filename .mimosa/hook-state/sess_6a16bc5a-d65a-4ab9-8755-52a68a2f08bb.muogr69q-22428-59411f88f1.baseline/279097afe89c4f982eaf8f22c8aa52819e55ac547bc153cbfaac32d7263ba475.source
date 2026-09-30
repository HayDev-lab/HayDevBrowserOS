import { describe, it, expect } from 'vitest';
import {
  TOOL_DEFINITIONS,
  isKnownTool,
  getToolDefinition,
  listToolNames,
  buildToolDescriptionsBlock,
} from '../src/main/browser/agent/pure/tool-registry';

describe('tool-registry / known tools', () => {
  it('exposes exactly 15 V1 tools (11 browser + 3 vault + memory)', () => {
    expect(TOOL_DEFINITIONS.length).toBe(15);
  });

  it('includes the required tool names', () => {
    const names = listToolNames();
    expect(names).toContain('browser.navigate');
    expect(names).toContain('browser.read');
    expect(names).toContain('tabs.list');
    expect(names).toContain('tabs.open');
    expect(names).toContain('tabs.activate');
    expect(names).toContain('tabs.close');
    expect(names).toContain('page.click');
    expect(names).toContain('page.type');
    expect(names).toContain('page.scroll');
    expect(names).toContain('agent.stop');
  });

  it('does NOT include forbidden tools', () => {
    const names = listToolNames();
    expect(names).not.toContain('execute_js');
    expect(names).not.toContain('shell');
    expect(names).not.toContain('filesystem');
    expect(names).not.toContain('http_request');
    expect(names).not.toContain('electron_call');
  });
});

describe('tool-registry / isKnownTool', () => {
  it('returns true for known tools', () => {
    expect(isKnownTool('browser.navigate')).toBe(true);
    expect(isKnownTool('page.click')).toBe(true);
    expect(isKnownTool('agent.stop')).toBe(true);
  });

  it('returns false for unknown tools', () => {
    expect(isKnownTool('execute_js')).toBe(false);
    expect(isKnownTool('shell')).toBe(false);
    expect(isKnownTool('browser.fly')).toBe(false);
    expect(isKnownTool('')).toBe(false);
  });
});

describe('tool-registry / getToolDefinition', () => {
  it('returns the definition for a known tool', () => {
    const def = getToolDefinition('browser.navigate');
    expect(def).not.toBeNull();
    expect(def!.name).toBe('browser.navigate');
    expect(def!.parameters.length).toBe(2);
  });

  it('returns null for unknown tools (TS-safe at compile time, runtime-safe too)', () => {
    expect(getToolDefinition('unknown' as never)).toBeNull();
  });
});

describe('tool-registry / parameter specs', () => {
  it('browser.navigate requires url', () => {
    const def = getToolDefinition('browser.navigate')!;
    const urlParam = def.parameters.find((p) => p.name === 'url');
    expect(urlParam).toBeDefined();
    expect(urlParam!.required).toBe(true);
    expect(urlParam!.type).toBe('string');
  });

  it('page.type requires elementId and text', () => {
    const def = getToolDefinition('page.type')!;
    const elementIdParam = def.parameters.find((p) => p.name === 'elementId');
    const textParam = def.parameters.find((p) => p.name === 'text');
    expect(elementIdParam!.required).toBe(true);
    expect(textParam!.required).toBe(true);
  });

  it('page.scroll direction has enum constraint', () => {
    const def = getToolDefinition('page.scroll')!;
    const dirParam = def.parameters.find((p) => p.name === 'direction')!;
    expect(dirParam.enum).toEqual(['up', 'down', 'left', 'right']);
  });

  it('tabs.list has no parameters', () => {
    const def = getToolDefinition('tabs.list')!;
    expect(def.parameters).toEqual([]);
  });
});

describe('tool-registry / buildToolDescriptionsBlock', () => {
  it('produces a non-empty string with all tool names', () => {
    const block = buildToolDescriptionsBlock();
    expect(typeof block).toBe('string');
    expect(block.length).toBeGreaterThan(100);
    for (const name of listToolNames()) {
      expect(block).toContain(name);
    }
  });

  it('includes parameter descriptions', () => {
    const block = buildToolDescriptionsBlock();
    expect(block).toContain('required');
    expect(block).toContain('optional');
  });
});
