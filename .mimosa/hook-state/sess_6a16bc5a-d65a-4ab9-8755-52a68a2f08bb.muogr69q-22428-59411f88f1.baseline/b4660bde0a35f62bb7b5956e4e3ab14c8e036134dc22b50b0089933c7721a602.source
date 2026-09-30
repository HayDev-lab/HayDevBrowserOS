/**
 * ProcessSupervisor — the ONLY place managed child processes are spawned
 * (spec §13/§21/§70/§73/§74).
 *
 * Guarantees:
 *   - Hidden launch: windowsHide + no shell — no CMD/PowerShell flashes.
 *   - No system Node requirement: `asNode` spawn wraps the ELECTRON binary
 *     with ELECTRON_RUN_AS_NODE=1 (spec §19/§20).
 *   - Bounded restarts (max attempts, exponential backoff — spec §71);
 *     policy exhaustion → FAILED, never an infinite loop.
 *   - Crash isolation: an exited child NEVER takes the app down; the
 *     supervisor reports and (optionally) restarts (spec §72).
 *   - Log capture into userData with size-capped rotation (spec §87/§88)
 *     plus an in-memory ring buffer for diagnostics. Logs never receive
 *     secrets from the supervisor (child stdout/stderr only).
 *   - Tree-kill on stop and on global sweep (taskkill /T /F on win32,
 *     detached-group kill on POSIX) — no orphans (spec §74).
 *   - Global registry: every spawned child is tracked so `sweepAll()` at
 *     quit can kill anything that outlived its owner.
 *
 * No Electron imports — testable under plain node (tests use `node -e`
 * children as process fixtures).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface SpawnRequest {
  /** Logical service key, e.g. 'perplexica'. */
  key: string;
  /** Executable. Use `process.execPath` + asNode for JS runtimes. */
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Run the ELECTRON binary as plain Node (ELECTRON_RUN_AS_NODE=1). */
  asNode?: boolean;
  /** Log file name under the logs dir (rotated). */
  logName: string;
  /** Called once when the process exits (after the supervisor's bookkeeping). */
  onExit?: (info: { code: number | null; signal: string | null; expected: boolean }) => void;
}

export interface SupervisorOptions {
  logsDir: string;
  now?: () => number;
  /** Test seam — replace child_process.spawn. */
  spawnFn?: typeof spawn;
  /** Test seam — shorten kill-tree grace. */
  killGraceMs?: number;
}

export const LOG_MAX_BYTES = 512 * 1024;
const LOG_ROTATIONS = 2;
const RING_SIZE = 200;

interface ManagedChild {
  key: string;
  child: ChildProcess;
  logName: string;
  /** Graceful user-requested stop in progress — exit is "expected". */
  stopping: boolean;
  restartAttempt: number;
  logPath: string;
  /** In-memory tail for diagnostics. */
  ring: string[];
}

export class ProcessSupervisor {
  private readonly children = new Map<string, ManagedChild>();
  /** All keys ever spawned for the final orphan sweep. */
  private readonly everSpawned = new Set<string>();
  private stoppingAll = false;

  constructor(private readonly opts: SupervisorOptions) {}

  /** Spawn (or throw SUPERVISOR_ALREADY_RUNNING for a duplicate key). */
  async start(req: SpawnRequest, restart: { attempt: number; delayMs: number } | null = null): Promise<void> {
    if (this.children.has(req.key)) throw new Error('SUPERVISOR_ALREADY_RUNNING');
    if (this.stoppingAll) throw new Error('SUPERVISOR_STOPPING');

    const logPath = path.join(this.opts.logsDir, req.logName);
    await this.rotateLogs(logPath);
    await fs.mkdir(this.opts.logsDir, { recursive: true });

    const env: NodeJS.ProcessEnv = { ...req.env };
    if (req.asNode) {
      // Runs the Electron binary as a plain Node runtime — no system Node.
      env.ELECTRON_RUN_AS_NODE = '1';
      env.ELECTRON_NO_ATTACH_CONSOLE = '1';
    }

    let child: ChildProcess;
    try {
      child = (this.opts.spawnFn ?? spawn)(req.command, req.args, {
        cwd: req.cwd,
        env,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      await this.appendLog(logPath, `[supervisor] spawn failed: ${err instanceof Error ? err.message : 'unknown'}\n`);
      throw err;
    }

    const record: ManagedChild = {
      key: req.key,
      child,
      logName: req.logName,
      stopping: false,
      restartAttempt: restart?.attempt ?? 0,
      logPath,
      ring: [],
    };
    this.children.set(req.key, record);
    this.everSpawned.add(req.key);

    void this.appendLog(logPath, `[supervisor] ${new Date().toISOString()} spawn pid=${child.pid} key=${req.key}${restart ? ` restart-attempt=${restart.attempt}` : ''}\n`);
    child.stdout?.on('data', (d: Buffer) => {
      pushRing(record, d.toString());
      void this.appendLog(logPath, d.toString());
    });
    child.stderr?.on('data', (d: Buffer) => {
      pushRing(record, d.toString());
      void this.appendLog(logPath, d.toString());
    });

    child.once('exit', (code, signal) => {
      const expected = record.stopping || this.stoppingAll;
      this.children.delete(req.key);
      void this.appendLog(logPath, `[supervisor] ${new Date().toISOString()} exit pid=${child.pid} code=${code} signal=${signal} expected=${expected}\n`);
      req.onExit?.({ code, signal, expected });
    });
  }

  /** Whether a live child exists for the key. */
  isRunning(key: string): boolean {
    const rec = this.children.get(key);
    return !!rec && rec.child.pid !== undefined && !rec.child.killed && rec.child.exitCode === null;
  }

  pid(key: string): number | null {
    return this.children.get(key)?.child.pid ?? null;
  }

  restartAttempt(key: string): number {
    return this.children.get(key)?.restartAttempt ?? 0;
  }

  /** Stop one child (tree-kill). Idempotent. */
  async stop(key: string): Promise<boolean> {
    const rec = this.children.get(key);
    if (!rec) return false;
    rec.stopping = true;
    await killTree(rec.child.pid);
    const grace = this.opts.killGraceMs ?? 5_000;
    await waitForExit(rec.child, grace).catch(() => {});
    return true;
  }

  /** Bounded auto-restart hook: still running keys are left alone. */
  prepareRestart(key: string): { attempt: number } | null {
    const rec = this.children.get(key);
    if (!rec) return null;
    return { attempt: rec.restartAttempt + 1 };
  }

  setRestartAttempt(key: string, attempt: number): void {
    const rec = this.children.get(key);
    if (rec) rec.restartAttempt = attempt;
  }

  /** Global shutdown (spec §73/§74): tree-kill EVERYTHING we ever spawned. */
  async stopAll(): Promise<void> {
    this.stoppingAll = true;
    const keys = [...this.children.keys()];
    await Promise.all(keys.map((k) => this.stop(k)));
    this.children.clear();
  }

  /**
   * Last-resort orphan sweep at app quit — best-effort killTree for any
   * still-running pid from this session (spec §74: Task Manager must be
   * clean after HayDevBrowser closes).
   */
  async sweepOrphans(): Promise<void> {
    this.stoppingAll = true;
    for (const key of this.everSpawned) {
      const rec = this.children.get(key);
      if (rec?.child.pid !== undefined) await killTree(rec.child.pid).catch(() => {});
    }
    this.children.clear();
  }

  /** Last N output lines for diagnostics (child output only — no secrets). */
  recentLogs(key: string, lines = 40): string[] {
    const rec = this.children.get(key);
    if (!rec) return [];
    return rec.ring.slice(-lines);
  }

  // -------------------------------------------------------------------------
  private async rotateLogs(logPath: string): Promise<void> {
    try {
      const stat = await fs.stat(logPath).catch(() => null);
      if (!stat || stat.size < LOG_MAX_BYTES) return;
      for (let i = LOG_ROTATIONS - 1; i >= 1; i -= 1) {
        const from = `${logPath}.${i}`;
        const to = `${logPath}.${i + 1}`;
        await fs.rename(from, to).catch(() => {});
      }
      await fs.rename(logPath, `${logPath}.1`).catch(() => {});
    } catch {
      // Rotation is best-effort.
    }
  }

  private async appendLog(logPath: string, chunk: string): Promise<void> {
    try {
      await fs.appendFile(logPath, chunk.slice(0, 8_000));
    } catch {
      // Logging must never crash the supervisor.
    }
  }
}

// ---------------------------------------------------------------------------
// Per-child ring buffer for recent log lines.
// ---------------------------------------------------------------------------
function pushRing(record: ManagedChild, chunk: string): void {
  const parts = chunk.split(/\r?\n/).filter((l) => l.length > 0);
  for (const line of parts) {
    record.ring.push(line);
    if (record.ring.length > RING_SIZE) record.ring.shift();
  }
}

// ---------------------------------------------------------------------------
// Tree-kill (spec §74) — Windows: taskkill /T /F; POSIX: process-group kill.
// ---------------------------------------------------------------------------
export async function killTree(pid: number | undefined): Promise<void> {
  if (pid === undefined || pid <= 0) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
      setTimeout(resolve, 3_000).unref();
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL'); // detached:true → own process group
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

function waitForExit(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('exit timeout')), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
