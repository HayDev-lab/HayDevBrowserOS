/**
 * AgentPanel — Neural Cockpit agent control shell.
 *
 * PROMPT 5: now wired to the real runtime. The panel receives:
 *   - mode + agentRunning (from useAgentStore → control mode)
 *   - timeline (from useAgentStore → push events)
 *   - onRun / onStop / onTakeControl (callbacks to useAgentStore)
 *
 * The local `useControlState` is no longer used — all state comes from props.
 */
import { useState, useRef, type KeyboardEvent } from 'react';
import type {
  AgentTimelineEntry,
  ControlMode,
  AgentStatusSnapshot,
} from '@shared/ipc-types';

export interface AgentPanelProps {
  mode: ControlMode;
  agentRunning: boolean;
  agentStatus: AgentStatusSnapshot | null;
  timeline: AgentTimelineEntry[];
  onRun: (command: string) => void;
  onStop: () => void;
  onTakeControl: () => void;
}

export function AgentPanel({
  mode,
  agentRunning,
  agentStatus,
  timeline,
  onRun,
  onStop,
  onTakeControl,
}: AgentPanelProps) {
  const [task, setTask] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the task input when entering AGENT mode.
  if (mode === 'AGENT' && !agentRunning && document.activeElement !== inputRef.current) {
    // Defer focus to next tick to avoid React setState warnings during render.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const handleSubmit = () => {
    const trimmed = task.trim();
    if (trimmed.length === 0) return;
    if (mode !== 'AGENT') return;
    if (agentRunning) return;
    onRun(trimmed);
    setTask('');
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

  const statusBadge = getStatusBadge(mode, agentRunning, agentStatus);

  return (
    <aside
      className={`agent-panel agent-panel--${mode.toLowerCase()} ${
        agentRunning ? 'agent-panel--running' : ''
      }`}
      aria-label="Agent panel"
    >
      <header className="agent-panel__header">
        <div className="agent-panel__title">
          <span className="agent-panel__title-mark" aria-hidden />
          <span>AGENT</span>
        </div>
        <div className="agent-panel__status" aria-live="polite">
          <span
            className={`agent-panel__status-badge agent-panel__status-badge--${statusBadge.state}`}
            aria-label={`Agent status: ${statusBadge.label}`}
          >
            {statusBadge.label}
          </span>
        </div>
      </header>

      <div className="agent-panel__task-input">
        <input
          ref={inputRef}
          type="text"
          className="agent-panel__input"
          value={task}
          placeholder={getTaskPlaceholder(mode, agentRunning, agentStatus)}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={mode !== 'AGENT' || agentRunning}
          spellCheck={false}
          autoComplete="off"
          aria-label="Agent task input"
        />
        <button
          type="button"
          className="agent-panel__submit"
          onClick={handleSubmit}
          disabled={mode !== 'AGENT' || agentRunning || task.trim().length === 0}
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
            {mode === 'AGENT'
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
                <span className="agent-panel__timeline-label">
                  <span className="agent-panel__timeline-step">#{entry.step}</span>
                  {' '}
                  {entry.summary}
                </span>
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
          onClick={onStop}
          disabled={!agentRunning}
          aria-label="Stop the current agent task"
          title="Stop agent task"
        >
          STOP
        </button>
        <button
          type="button"
          className="takecontrol takecontrol--critical takecontrol--panel"
          onClick={onTakeControl}
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

function getStatusBadge(
  mode: ControlMode,
  running: boolean,
  status: AgentStatusSnapshot | null
): { label: string; state: 'idle' | 'running' | 'takeover' | 'human' | 'failed' } {
  if (status?.state === 'FAILED') {
    return { label: 'FAILED', state: 'failed' };
  }
  if (mode === 'HUMAN') {
    return { label: 'HUMAN', state: 'human' };
  }
  if (running) {
    return { label: 'RUNNING', state: 'running' };
  }
  return { label: 'READY', state: 'idle' };
}

function getTaskPlaceholder(
  mode: ControlMode,
  running: boolean,
  status: AgentStatusSnapshot | null
): string {
  if (status && !status.providerConfigured) {
    return 'AI_PROVIDER_NOT_CONFIGURED — set OLLAMA_API_KEY';
  }
  if (mode === 'HUMAN') return 'Switch to AGENT mode to enter a task…';
  if (running) return 'Agent is running… press STOP to abort.';
  return 'Describe a task for the agent…';
}
