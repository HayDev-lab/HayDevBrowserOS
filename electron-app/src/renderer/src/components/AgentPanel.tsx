/**
 * AgentPanel — Neural Cockpit agent control shell.
 *
 * Scope (PROMPT 3):
 *   - Task input field (placeholder only; no real command parser yet)
 *   - Status indicator (idle / running / takeover)
 *   - Action timeline placeholder (deterministic, no real agent)
 *   - STOP button (calls onTakeControl)
 *   - TAKE CONTROL button (calls onTakeControl)
 *
 * NON-GOALS for PROMPT 3:
 *   - Real Ollama call (PROMPT 5)
 *   - Real tool-call execution (PROMPT 5)
 *   - Real action timeline (PROMPT 5)
 *
 * The shell consumes the local `useControlState` hook to render its visual
 * state deterministically. The host app passes `onSubmitTask` which will
 * (in PROMPT 5) invoke the AgentController; here it just latches the
 * `agentRunning` flag and pushes a placeholder timeline entry.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useControlState } from '../store/control-store';
import type { ControlMode } from '../store/ui-logic';

export interface AgentTimelineEntry {
  id: string;
  label: string;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  timestamp: number;
}

export interface AgentPanelProps {
  /** Called when the user submits a task. The shell itself controls the local state. */
  onSubmitTask?: (task: string) => void;
  /** Called when STOP or TAKE CONTROL is pressed. */
  onTakeControl?: () => void;
  /** External control state hook. If omitted, the panel uses its own. */
  controlState?: ReturnType<typeof useControlState>;
  /** Optional external timeline (e.g. fed by the real AgentController in PROMPT 5). */
  timeline?: AgentTimelineEntry[];
}

export function AgentPanel({
  onSubmitTask,
  onTakeControl,
  controlState,
  timeline: externalTimeline,
}: AgentPanelProps) {
  const ownControl = useControlState();
  const ctrl = controlState ?? ownControl;
  const [task, setTask] = useState('');
  const [localTimeline, setLocalTimeline] = useState<AgentTimelineEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Stable id counter — survives across renders. Used only to disambiguate
  // rapid successive task submissions within the same millisecond.
  const entryIdRef = useRef(0);

  // Auto-focus the task input when entering AGENT mode.
  useEffect(() => {
    if (ctrl.mode === 'AGENT' && !ctrl.agentRunning) {
      inputRef.current?.focus();
    }
  }, [ctrl.mode, ctrl.agentRunning]);

  const handleSubmit = () => {
    const trimmed = task.trim();
    if (trimmed.length === 0) return;
    if (ctrl.mode !== 'AGENT') return;
    if (ctrl.agentRunning) return;

    ctrl.setAgentRunning(true);
    onSubmitTask?.(trimmed);

    // Local placeholder timeline entry. In PROMPT 5 this will be replaced
    // by real observations emitted by the AgentController.
    const entry: AgentTimelineEntry = {
      id: `agent_${Date.now()}_${entryIdRef.current++}`,
      label: trimmed,
      state: 'running',
      timestamp: Date.now(),
    };
    setLocalTimeline((prev) => [...prev, entry]);
    setTask('');
  };

  const handleStop = () => {
    ctrl.setAgentRunning(false);
    setLocalTimeline((prev) =>
      prev.map((e) => (e.state === 'running' ? { ...e, state: 'aborted' } : e))
    );
    onTakeControl?.();
  };

  const handleTakeControl = () => {
    ctrl.takeControl();
    setLocalTimeline((prev) =>
      prev.map((e) =>
        e.state === 'running' || e.state === 'pending'
          ? { ...e, state: 'aborted' }
          : e
      )
    );
    onTakeControl?.();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setTask('');
      (e.target as HTMLInputElement).blur();
    }
  };

  const timeline = externalTimeline ?? localTimeline;

  return (
    <aside
      className={`agent-panel agent-panel--${ctrl.mode.toLowerCase()} ${
        ctrl.agentRunning ? 'agent-panel--running' : ''
      } ${ctrl.takeoverLatched ? 'agent-panel--takeover' : ''}`}
      aria-label="Agent panel"
    >
      <header className="agent-panel__header">
        <div className="agent-panel__title">
          <span className="agent-panel__title-mark" aria-hidden />
          <span>AGENT</span>
        </div>
        <div className="agent-panel__status" aria-live="polite">
          <StatusBadge mode={ctrl.mode} running={ctrl.agentRunning} latched={ctrl.takeoverLatched} />
        </div>
      </header>

      <div className="agent-panel__task-input">
        <input
          ref={inputRef}
          type="text"
          className="agent-panel__input"
          value={task}
          placeholder={getTaskPlaceholder(ctrl.mode, ctrl.agentRunning)}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={ctrl.mode !== 'AGENT' || ctrl.agentRunning}
          spellCheck={false}
          autoComplete="off"
          aria-label="Agent task input"
        />
        <button
          type="button"
          className="agent-panel__submit"
          onClick={handleSubmit}
          disabled={ctrl.mode !== 'AGENT' || ctrl.agentRunning || task.trim().length === 0}
          aria-label="Submit task to agent"
          title="Submit task (Enter)"
        >
          ▶
        </button>
      </div>

      <div className="agent-panel__timeline">
        <div className="agent-panel__timeline-header">
          <span className="agent-panel__timeline-label">TIMELINE</span>
          <span className="agent-panel__timeline-count">{timeline.length}</span>
        </div>
        {timeline.length === 0 ? (
          <p className="agent-panel__timeline-empty">
            {ctrl.mode === 'AGENT'
              ? 'No task submitted yet. Enter a task above.'
              : 'Agent is idle. Switch to AGENT mode to start a task.'}
          </p>
        ) : (
          <ul className="agent-panel__timeline-list">
            {timeline.map((entry) => (
              <li
                key={entry.id}
                className={`agent-panel__timeline-item agent-panel__timeline-item--${entry.state}`}
              >
                <span
                  className="agent-panel__timeline-mark"
                  aria-hidden
                  data-state={entry.state}
                />
                <span className="agent-panel__timeline-label">{entry.label}</span>
                <span className="agent-panel__timeline-state">{entry.state}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="agent-panel__footer">
        <button
          type="button"
          className="agent-panel__stop"
          onClick={handleStop}
          disabled={!ctrl.agentRunning}
          aria-label="Stop the current agent task"
          title="Stop agent task"
        >
          STOP
        </button>
        <button
          type="button"
          className={`takecontrol takecontrol--${ctrl.takeControlVisibility} takecontrol--panel`}
          onClick={handleTakeControl}
          aria-label="Take control — abort agent and switch to HUMAN mode"
          title="TAKE CONTROL"
        >
          <span className="takecontrol__icon" aria-hidden>
            ◆
          </span>
          <span className="takecontrol__label">TAKE CONTROL</span>
        </button>
      </footer>
    </aside>
  );
}

function StatusBadge({
  mode,
  running,
  latched,
}: {
  mode: ControlMode;
  running: boolean;
  latched: boolean;
}) {
  let label = 'IDLE';
  let state: 'idle' | 'running' | 'takeover' | 'human' = 'idle';
  if (latched) {
    label = 'TAKEOVER';
    state = 'takeover';
  } else if (mode === 'AGENT' && running) {
    label = 'RUNNING';
    state = 'running';
  } else if (mode === 'AGENT') {
    label = 'READY';
    state = 'idle';
  } else {
    label = 'HUMAN';
    state = 'human';
  }
  return (
    <span
      className={`agent-panel__status-badge agent-panel__status-badge--${state}`}
      aria-label={`Agent status: ${label}`}
    >
      {label}
    </span>
  );
}

function getTaskPlaceholder(mode: ControlMode, running: boolean): string {
  if (mode === 'HUMAN') return 'Switch to AGENT mode to enter a task…';
  if (running) return 'Agent is running… press STOP to abort.';
  return 'Describe a task for the agent…';
}
