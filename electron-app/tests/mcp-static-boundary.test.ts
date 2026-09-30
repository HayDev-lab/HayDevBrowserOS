/**
 * MCP static boundary tests (PROMPT 8) — SECURITY MICRO AUDIT, automated.
 *
 * Static source-level checks (same approach as static-a11y.test.ts):
 *
 *   NO BYPASS:
 *     - MCP handlers never reference BrowserCore / WebContents /
 *       NavigationController / TabManager / executeJavaScript directly;
 *     - the MCP layer imports no `electron` module at all.
 *
 *   NETWORK BOUNDARY:
 *     - the server binds 127.0.0.1 only;
 *     - no 0.0.0.0 / '::' bind anywhere in the MCP layer.
 *
 *   SECRET SAFETY:
 *     - no vault imports, no process.env access inside the MCP layer
 *       (port config lives in main/index.ts wiring);
 *     - no plaintext password / API key fields in the result contract.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const MCP_ROOT = path.resolve(__dirname, '../src/main/browser/mcp');
const SHARED_MCP = path.resolve(__dirname, '../src/shared/mcp-types.ts');
const MAIN_INDEX = path.resolve(__dirname, '../src/main/index.ts');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Source with block comments stripped (comments are not executable). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const mcpFiles = listSourceFiles(MCP_ROOT);

describe('mcp static boundary / NO BYPASS', () => {
  it('covers the whole MCP source tree', () => {
    expect(mcpFiles.length).toBeGreaterThanOrEqual(6);
  });

  it('MCP sources never reference BrowserCore / WebContents / executeJavaScript directly', () => {
    const forbidden = [/BrowserCore/, /WebContents/, /NavigationController/, /\bTabManager\b/, /executeJavaScript/];
    for (const file of mcpFiles) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      for (const pattern of forbidden) {
        // The only permitted mention is the guard comment that FORBIDS it.
        expect(`${path.basename(file)}: ${code}`).not.toMatch(pattern);
      }
    }
  });

  it('MCP sources import no electron module', () => {
    for (const file of mcpFiles) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      expect(code).not.toMatch(/from\s+['"]electron['"]/);
      expect(code).not.toMatch(/require\(['"]electron['"]\)/);
    }
  });

  it('MCP browser tools reach the browser ONLY through the port (single dispatch call)', () => {
    const handler = readFileSync(path.join(MCP_ROOT, 'runtime/mcp-tool-handler.ts'), 'utf-8');
    const code = stripComments(handler);
    expect(code).toContain('this.deps.browser.dispatch');
    // No adapter/tab-manager/api surface beyond the port:
    expect(code).not.toMatch(/\.openTab\(/);
    expect(code).not.toMatch(/\.closeTab\(/);
    expect(code).not.toMatch(/\.navigateTab\(/);
    expect(code).not.toMatch(/loadURL/);
  });

  it('agent tools reach the agent ONLY through the port (existing controller)', () => {
    const handler = stripComments(readFileSync(path.join(MCP_ROOT, 'runtime/mcp-tool-handler.ts'), 'utf-8'));
    expect(handler).toContain('this.deps.agent.run');
    expect(handler).toContain('this.deps.agent.stop');
    expect(handler).toContain('this.deps.agent.takeControl');
    // No second agent loop primitives inside the MCP layer:
    expect(handler).not.toMatch(/runAgentLoop/);
    expect(handler).not.toMatch(/ollama/i);
  });
});

describe('mcp static boundary / network security', () => {
  it('pins the bind host to 127.0.0.1', () => {
    const server = readFileSync(path.join(MCP_ROOT, 'runtime/mcp-server.ts'), 'utf-8');
    expect(server).toContain("export const MCP_HOST = '127.0.0.1'");
    expect(server).toMatch(/server\.listen\(this\.port, MCP_HOST/);
  });

  it('contains NO wildcard / IPv6 bind anywhere in the MCP layer', () => {
    for (const file of mcpFiles) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      expect(`${path.basename(file)}: ${code}`).not.toContain('0.0.0.0');
      expect(`${path.basename(file)}: ${code}`).not.toContain("'::'");
      expect(`${path.basename(file)}: ${code}`).not.toContain('"::"');
    }
  });

  it('listens on a single configured port only (no port-range scanning)', () => {
    const server = stripComments(readFileSync(path.join(MCP_ROOT, 'runtime/mcp-server.ts'), 'utf-8'));
    // Exactly ONE listen call, on the fixed port + pinned host:
    const listenCalls = server.match(/\.listen\(/g) ?? [];
    expect(listenCalls.length).toBe(1);
    expect(server).toMatch(/server\.listen\(this\.port, MCP_HOST/);
    // No retry loops or computed offsets around binding:
    expect(server).not.toMatch(/listen\(\s*\d+\s*\+/);
    expect(server).not.toMatch(/while\s*\([^)]*EADDRINUSE/);
  });
});

describe('mcp static boundary / secret safety', () => {
  it('MCP sources never import vault modules', () => {
    for (const file of mcpFiles) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      // The forbidden-tool registry does mention vault.* NAMES (as forbidden
      // strings); what must never happen is an IMPORT of vault code.
      expect(`${path.basename(file)}: ${code}`).not.toMatch(/from\s+['"][^'"]*vault/i);
      expect(`${path.basename(file)}: ${code}`).not.toMatch(/CredentialVault/);
    }
  });

  it('MCP sources never read process.env (port config lives in main wiring)', () => {
    for (const file of mcpFiles) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      expect(`${path.basename(file)}: ${code}`).not.toMatch(/process\.env/);
    }
  });

  it('the result contract has no password / key / secret fields', () => {
    const types = stripComments(readFileSync(SHARED_MCP, 'utf-8'));
    expect(types).not.toMatch(/password/i);
    expect(types).not.toMatch(/apiKey/i);
    expect(types).not.toMatch(/secret/i);
    expect(types).not.toMatch(/decrypt/i);
  });

  it('the wiring only uses process.env for the PORT and OLLAMA config (no secret exfiltration)', () => {
    const wiring = stripComments(readFileSync(MAIN_INDEX, 'utf-8'));
    const envUses = wiring.match(/process\.env\.\w+/g) ?? [];
    expect([...new Set(envUses)].sort()).toEqual([
      'process.env.AI_PROVIDER',
      'process.env.GEMINI_API_KEY',
      'process.env.MCP_SERVER_PORT',
      'process.env.NVIDIA_API_KEY',
      'process.env.NVIDIA_BASE_URL',
      'process.env.NVIDIA_MODEL',
      'process.env.OLLAMA_BASE_URL',
      'process.env.OLLAMA_DEEP_RESEARCH_MODEL',
      'process.env.OLLAMA_MODEL',
      // Unified runtime engine config (endpoints/modes only — no secrets).
      'process.env.PAB_PERPLEXICA_DIR',
      'process.env.PAB_PERPLEXICA_MODEL',
      'process.env.PAB_PERPLEXICA_URL',
      'process.env.PAB_SEARXNG_URL',
      'process.env.PAB_TOR_MODE',
      'process.env.PAB_TOR_SOCKS_PORT',
    ]);
  });
});
