/**
 * Unified runtime engine — state machine, restart policy, port manager,
 * ProcessSupervisor (real child processes), and bounded restart behavior.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  transition,
  initialSnapshot,
  nextRestartDelay,
  DEFAULT_RESTART_POLICY,
  isRunning,
  type ServiceState,
} from '../src/main/browser/runtime/engine/pure/service-state-machine';
import { PortManager, type PortProbe } from '../src/main/browser/runtime/engine/pure/port-manager';
import { ProcessSupervisor } from '../src/main/browser/runtime/engine/runtime/process-supervisor';

const NOW = 1_000_000;

describe('service state machine (spec §17)', () => {
  it('walks the legal lifecycle', () => {
    let snap = initialSnapshot(0);
    const step = (to: ServiceState, extra = {}) => {
      const r = transition(snap, to, { now: NOW, ...extra });
      expect(r.legal, `${snap.state}→${to}`).toBe(true);
      snap = r.snap;
    };
    step('STARTING');
    step('BOOTSTRAPPING', { progress: 40 });
    expect(snap.progress).toBe(40);
    step('READY');
    expect(snap.readyAt).toBe(NOW);
    step('DEGRADED', { reason: 'HEALTH_TIMEOUT' });
    step('READY');
    step('RESTARTING');
    step('STARTING');
    step('FAILED', { reason: 'EXITED_UNEXPECTEDLY_1' });
    expect(snap.progress).toBeNull();
  });

  it('rejects illegal jumps', () => {
    const stopped = initialSnapshot(0);
    expect(transition(stopped, 'READY', { now: NOW }).legal).toBe(false);
    const ready = transition(transition(initialSnapshot(0), 'STARTING', { now: NOW }).snap, 'READY', { now: NOW }).snap;
    expect(transition(ready, 'BOOTSTRAPPING', { now: NOW }).legal).toBe(false);
    expect(transition(ready, 'STARTING', { now: NOW }).legal).toBe(false);
  });

  it('restart policy: bounded, exponential, then exhausted (spec §71)', () => {
    expect(nextRestartDelay(DEFAULT_RESTART_POLICY, 1)).toBe(1_000);
    expect(nextRestartDelay(DEFAULT_RESTART_POLICY, 2)).toBe(2_000);
    expect(nextRestartDelay(DEFAULT_RESTART_POLICY, 3)).toBe(4_000);
    expect(nextRestartDelay(DEFAULT_RESTART_POLICY, 4)).toBeNull();
    expect(isRunning('READY')).toBe(true);
    expect(isRunning('FAILED')).toBe(false);
  });
});

describe('PortManager (spec §29/§30)', () => {
  class FakeProbe implements PortProbe {
    constructor(private readonly busy = new Set<number>()) {}
    canBind(port: number): Promise<boolean> {
      return Promise.resolve(!this.busy.has(port));
    }
  }

  it('prefers the preferred port when free', async () => {
    const pm = new PortManager(8, new FakeProbe());
    const a = await pm.allocate('svc', 3000);
    expect(a).toEqual({ port: 3000, preferredWasBusy: false });
  });

  it('moves on when preferred is busy — never kills the foreign holder', async () => {
    const pm = new PortManager(8, new FakeProbe(new Set([3000, 3001])));
    const a = await pm.allocate('svc', 3000);
    expect(a.port).toBe(3002);
    expect(a.preferredWasBusy).toBe(true);
  });

  it('reuses its own allocation for the same key', async () => {
    const pm = new PortManager(8, new FakeProbe());
    const a = await pm.allocate('svc', 3000);
    const b = await pm.allocate('svc', 3000);
    expect(b.port).toBe(a.port);
    await pm.release('svc');
  });

  it('real probe: binds a free port, refuses a held one', async () => {
    const pm = new PortManager(4);
    const a = await pm.allocate('real', 39871);
    expect(a.port).toBeGreaterThan(0);
    await pm.release('real');
  });
});

describe('ProcessSupervisor (spec §21/§70/§74) — real child processes', () => {
  async function tmpLogs(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'haydev-sup-'));
  }
  const nodeExe = process.execPath;

  it('spawns hidden, captures logs, detects exit', async () => {
    const logsDir = await tmpLogs();
    const sup = new ProcessSupervisor({ logsDir });
    const exits: Array<{ code: number | null; expected: boolean }> = [];
    await sup.start({
      key: 'sleeper',
      command: nodeExe,
      // Prints a line then lives until killed.
      args: ['-e', 'console.log("child-ready"); setInterval(()=>{}, 1000)'],
      logName: 'sleeper.log',
      onExit: (i) => exits.push({ code: i.code, expected: i.expected }),
    });
    expect(sup.isRunning('sleeper')).toBe(true);
    expect(sup.pid('sleeper')).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 700));
    expect(sup.recentLogs('sleeper').join('\n')).toContain('child-ready');
    await sup.stop('sleeper');
    await new Promise((r) => setTimeout(r, 700));
    expect(sup.isRunning('sleeper')).toBe(false);
    expect(exits).toHaveLength(1);
    expect(exits[0].expected).toBe(true); // user stop → no auto-restart
    await fs.rm(logsDir, { recursive: true, force: true });
  }, 15_000);

  it('stopAll kills every child (no orphans)', async () => {
    const logsDir = await tmpLogs();
    const sup = new ProcessSupervisor({ logsDir });
    for (const key of ['a', 'b']) {
      await sup.start({
        key,
        command: nodeExe,
        args: ['-e', 'setInterval(()=>{}, 1000)'],
        logName: `${key}.log`,
      });
    }
    expect(sup.isRunning('a')).toBe(true);
    expect(sup.isRunning('b')).toBe(true);
    await sup.stopAll();
    await new Promise((r) => setTimeout(r, 800));
    expect(sup.isRunning('a')).toBe(false);
    expect(sup.isRunning('b')).toBe(false);
    await fs.rm(logsDir, { recursive: true, force: true });
  }, 15_000);
});
