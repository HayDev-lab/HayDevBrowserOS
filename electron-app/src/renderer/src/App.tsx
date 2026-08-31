import { useEffect, useState } from 'react';
import type { AppVersionInfo, FoundationPingResult } from '@shared/ipc-types';

/**
 * Foundation-stage renderer.
 *
 * Purpose:
 *  - Prove the security boundary works end-to-end: renderer talks to main
 *    only through `window.api` (the contextBridge surface).
 *  - Prove the typed IPC contract compiles on both sides.
 *
 * Out of scope for PROMPT 1:
 *  - tabs, address bar, navigation UI, Neural Cockpit visuals, AI panel.
 */
export function App() {
  const [version, setVersion] = useState<AppVersionInfo | null>(null);
  const [pingResult, setPingResult] = useState<FoundationPingResult | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await window.api.getVersion();
        if (!cancelled) setVersion(v);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onPing() {
    try {
      const r = await window.api.ping({
        timestamp: Date.now(),
        message: 'foundation:hello',
      });
      setPingResult(r);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main className="foundation-root">
      <header className="foundation-header">
        <h1>Personal Agentic Browser</h1>
        <p className="foundation-subtitle">
          Foundation v0.1 · Electron + TypeScript + React
        </p>
      </header>

      <section className="foundation-card">
        <h2>Runtime version</h2>
        {version ? (
          <ul>
            <li>Electron: <code>{version.electron}</code></li>
            <li>Chrome: <code>{version.chrome}</code></li>
            <li>Node: <code>{version.node}</code></li>
            <li>App version: <code>{version.appVersion}</code></li>
          </ul>
        ) : (
          <p className="muted">Awaiting IPC response…</p>
        )}
      </section>

      <section className="foundation-card">
        <h2>Typed IPC ping</h2>
        <button onClick={onPing}>Ping main process</button>
        {pingResult ? (
          <pre>{JSON.stringify(pingResult, null, 2)}</pre>
        ) : (
          <p className="muted">No ping sent yet.</p>
        )}
      </section>

      {error && (
        <section className="foundation-card foundation-error">
          <h2>Error</h2>
          <pre>{error}</pre>
        </section>
      )}
    </main>
  );
}
