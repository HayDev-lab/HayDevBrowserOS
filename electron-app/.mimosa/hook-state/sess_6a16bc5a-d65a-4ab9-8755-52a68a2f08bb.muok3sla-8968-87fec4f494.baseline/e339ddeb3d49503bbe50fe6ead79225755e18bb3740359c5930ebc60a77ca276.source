import { platformApi } from '../platform';
/**
 * AgentPanel — Matrix agent dock (concept 1:1).
 *
 * Structure:
 *   header    ● AGENT .................... ● HUMAN MODE / AGENT MODE
 *   hint      "Switch to AGENT mode…" collapsible (click = switch mode)
 *   tabs      CONVERSATION | TOOLS | SOURCES   (+ compact DEEP RESEARCH)
 *   body      conversation bubbles / tool timeline / research sources
 *   footer    STOP (when running) + TAKE CONTROL, then the message input:
 *             attach · "Type your message…" · mic · send
 *
 * All state is runtime state (mode, agentRunning, timeline, chat) — no
 * decorative local booleans. Quick Commands stay removed (spec §11).
 */
import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import type {
  AgentTimelineEntry,
  ControlMode,
  AgentStatusSnapshot,
  ResearchReport,
} from '@shared/ipc-types';
import type { NewTabAttachment } from '@shared/newtab-bridge';
import type { ChatMessage } from '../store/chat-logic';
import { isAwaitingAnswer } from '../store/chat-logic';
import { researchPhaseFrom } from '../research-phase-view';

export interface AgentPanelProps {
  mode: ControlMode;
  agentRunning: boolean;
  agentStatus: AgentStatusSnapshot | null;
  timeline: AgentTimelineEntry[];
  onRun: (command: string, opts?: { attachmentIds?: string[] }) => void;
  /** DEEP_RESEARCH profile run (PROMPT 9). */
  onResearch: (query: string) => void;
  researchReport: ResearchReport | null;
  researchActive: boolean;
  onStop: () => void;
  onTakeControl: () => void;
  /** Clean conversation transcript (user queries + agent answers). */
  chat?: ChatMessage[];
  /** Clear the conversation. */
  onClearChat?: () => void;
}

type PanelTab = 'conversation' | 'tools' | 'sources';

export function AgentPanel({
  mode,
  agentRunning,
  agentStatus,
  timeline,
  onRun,
  onResearch,
  researchReport,
  researchActive,
  onStop,
  onTakeControl,
  chat = [],
  onClearChat,
}: AgentPanelProps) {
  const [task, setTask] = useState('');
  const [tab, setTab] = useState<PanelTab>('conversation');
  const [hintOpen, setHintOpen] = useState(false);
  const [attachments, setAttachments] = useState<NewTabAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // THINK nav action focuses this input.
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener('pab:focus-agent-input', focus);
    return () => window.removeEventListener('pab:focus-agent-input', focus);
  }, []);

  const handleSubmit = () => {
    const trimmed = task.trim();
    if (trimmed.length === 0) return;
    if (mode !== 'AGENT') return;
    if (agentRunning) return;
    onRun(trimmed, attachments.length > 0 ? { attachmentIds: attachments.map((a) => a.id) } : undefined);
    setTask('');
    setAttachments([]);
  };

  const handleDeepResearch = () => {
    const trimmed = task.trim();
    if (trimmed.length === 0) return;
    if (mode !== 'AGENT') return;
    if (agentRunning) return;
    onResearch(trimmed);
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

  const handleAttach = async () => {
    setAttachError(null);
    if (attachments.length >= 4) {
      setAttachError('Up to 4 attachments per message.');
      return;
    }
    try {
      const res = await platformApi.agent.pickAttachment('file');
      if (res.attachment) {
        setAttachments((prev) => [...prev, res.attachment as NewTabAttachment]);
      }
    } catch {
      setAttachError('Could not open the file picker.');
    }
  };

  const statusBadge = getStatusBadge(mode, agentRunning, agentStatus);
  const researchPhase = researchPhaseFrom(agentStatus, timeline, researchActive);
  const report = researchReport;
  const sources = report?.sources ?? [];

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
        <span
          className={`agent-panel__mode-badge agent-panel__mode-badge--${mode.toLowerCase()}`}
          aria-live="polite"
        >
          <span className="agent-panel__mode-badge-dot" aria-hidden />
          {mode} MODE
        </span>
      </header>

      <div className={`agent-panel__hint ${hintOpen ? 'agent-panel__hint--open' : ''}`}>
        <button
          type="button"
          className="agent-panel__hint-btn"
          onClick={() => (mode === 'HUMAN' ? setHintOpen((v) => !v) : setHintOpen((v) => !v))}
          aria-expanded={hintOpen}
          title={mode === 'HUMAN' ? 'What does AGENT mode unlock?' : 'Agent mode is active'}
        >
          <span>
            {mode === 'HUMAN'
              ? 'Switch to AGENT mode to unlock advanced capabilities'
              : 'AGENT mode active — the agent can browse, research and execute'}
          </span>
          <span className="agent-panel__hint-chevron" aria-hidden>
            {hintOpen ? '▴' : '▾'}
          </span>
        </button>
        {hintOpen && (
          <div className="agent-panel__hint-body">
            <p>
              AGENT mode lets the assistant browse pages, click, type, run Deep
              Research and execute multi-step tasks — HUMAN mode keeps full
              manual control.
            </p>
            {mode === 'HUMAN' && (
              <button
                type="button"
                className="agent-panel__hint-switch"
                onClick={() => {
                  setHintOpen(false);
                  platformApi.control.setMode('AGENT');
                }}
              >
                Switch to AGENT mode
              </button>
            )}
          </div>
        )}
      </div>

      <nav className="agent-panel__tabs" role="tablist" aria-label="Agent panel sections">
        <PanelTabButton id="conversation" label="CONVERSATION" active={tab === 'conversation'} onSelect={setTab} />
        <PanelTabButton id="tools" label="TOOLS" active={tab === 'tools'} onSelect={setTab} />
        <PanelTabButton
          id="sources"
          label={`SOURCES${sources.length > 0 ? ` ${sources.length}` : ''}`}
          active={tab === 'sources'}
          onSelect={setTab}
        />
      </nav>

      {tab === 'conversation' && (
        <div className="agent-panel__chat" role="tabpanel" aria-label="Agent conversation">
          <div className="agent-panel__chat-toolbar">
            <span className="agent-panel__chat-label">CONVERSATION</span>
            {chat.length > 0 && onClearChat && (
              <button
                type="button"
                className="agent-panel__chat-clear"
                onClick={onClearChat}
                aria-label="Clear conversation"
                title="Clear conversation"
              >
                ×
              </button>
            )}
          </div>
          <div className="agent-panel__chat-list">
            <AgentGreeting agentName="HAYDEV AGENT" />
            {chat.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
            {isAwaitingAnswer(chat, agentRunning) && (
              <div className="agent-bubble agent-bubble--pending">
                <span className="agent-bubble__role">AGENT</span>
                <span className="agent-bubble__text">working…</span>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'tools' && (
        <div className="agent-panel__tools" role="tabpanel" aria-label="Agent tools timeline">
          <div className="agent-panel__chat-toolbar">
            <span className="agent-panel__chat-label">TOOLS · TIMELINE</span>
            <span className="agent-panel__timeline-count">{timeline.length}</span>
          </div>
          {timeline.length === 0 ? (
            <p className="agent-panel__chat-empty">
              {mode === 'AGENT'
                ? 'No task yet. Tool calls and steps will appear here.'
                : 'Agent is idle. Switch to AGENT mode to start a task.'}
            </p>
          ) : (
            <ul className="agent-panel__timeline-list">
              {timeline.map((entry) => (
                <li
                  key={entry.id}
                  className={`agent-panel__timeline-item agent-panel__timeline-item--${entry.state}`}
                >
                  <span className="agent-panel__timeline-mark" aria-hidden data-state={entry.state} />
                  <span className="agent-panel__timeline-label">
                    <span className="agent-panel__timeline-step">#{entry.step}</span> {entry.summary}
                  </span>
                  <span className="agent-panel__timeline-state">{entry.state}</span>
                </li>
              ))}
            </ul>
          )}
          {researchPhase && (
            <div className="agent-panel__research-phase" aria-live="polite">
              <span className="agent-panel__research-phase-label">RESEARCH</span>
              <span className="agent-panel__research-phase-value" data-phase={researchPhase}>
                {researchPhase}
              </span>
            </div>
          )}
        </div>
      )}

      {tab === 'sources' && (
        <div className="agent-panel__sources" role="tabpanel" aria-label="Research sources">
          <div className="agent-panel__chat-toolbar">
            <span className="agent-panel__chat-label">SOURCES</span>
          </div>
          {!report ? (
            <p className="agent-panel__chat-empty">
              No Deep Research report yet. Run a query with DEEP RESEARCH to
              collect a verified source ledger.
            </p>
          ) : (
            <div className="agent-panel__sources-body">
              {report.summary && <p className="agent-panel__research-summary">{report.summary}</p>}
              {sources.length === 0 ? (
                <p className="agent-panel__chat-empty">No sources recorded for this run.</p>
              ) : (
                <ul className="agent-panel__sources-list">
                  {sources.map((s) => (
                    <li key={s.id}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" title={s.url}>
                        s{s.id} · {s.title || s.url}
                      </a>
                      {s.status === 'failed' && <span className="agent-panel__src-failed"> (failed)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <footer className="agent-panel__footer">
        <div className="agent-panel__footer-actions">
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
            className="takecontrol takecontrol--panel"
            onClick={onTakeControl}
            aria-label="Take control — abort agent and switch to HUMAN mode"
            title="TAKE CONTROL — abort agent and return to HUMAN mode"
          >
            <span className="takecontrol__icon" aria-hidden>
              ◆
            </span>
            <span className="takecontrol__label">TAKE CONTROL</span>
          </button>
          <button
            type="button"
            className="agent-panel__deep"
            onClick={handleDeepResearch}
            disabled={mode !== 'AGENT' || agentRunning || task.trim().length === 0}
            title="Run Deep Research on the message input"
          >
            DEEP RESEARCH
          </button>
        </div>

        {attachments.length > 0 && (
          <div className="agent-panel__attachments" aria-label="Pending attachments">
            {attachments.map((a) => (
              <span key={a.id} className="agent-panel__attachment" title={a.name}>
                <span className="agent-panel__attachment-name">{a.name}</span>
                <button
                  type="button"
                  className="agent-panel__attachment-remove"
                  aria-label={`Remove attachment ${a.name}`}
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {attachError && (
          <p className="agent-panel__attach-error" role="alert">
            {attachError}
          </p>
        )}

        <div className="agent-panel__inputrow">
          <button
            type="button"
            className="agent-panel__iconbtn"
            onClick={handleAttach}
            aria-label="Attach a file"
            title="Attach a file (PDF, DOC, TXT, CSV, JSON…)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
            </svg>
          </button>
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
            className="agent-panel__iconbtn agent-panel__iconbtn--mic"
            aria-label="Voice input is not available yet"
            title="Voice input — not available yet"
            disabled
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" stroke-linecap="round" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3"></rect>
              <path d="M5 10a7 7 0 0 0 14 0M12 19v3"></path>
            </svg>
          </button>
          <button
            type="button"
            className="agent-panel__send"
            onClick={handleSubmit}
            disabled={mode !== 'AGENT' || agentRunning || task.trim().length === 0}
            aria-label="Send message to agent"
            title="Send (Enter)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="9 6 15 12 9 18"></polyline>
            </svg>
          </button>
        </div>
      </footer>
    </aside>
  );
}

function PanelTabButton({
  id,
  label,
  active,
  onSelect,
}: {
  id: PanelTab;
  label: string;
  active: boolean;
  onSelect: (t: PanelTab) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`agent-panel__tab ${active ? 'agent-panel__tab--active' : ''}`}
      onClick={() => onSelect(id)}
    >
      {label}
    </button>
  );
}

function AgentGreeting({ agentName }: { agentName: string }) {
  return (
    <div className="agent-bubble agent-bubble--greeting">
      <span className="agent-bubble__avatar" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="3" />
          <ellipse cx="12" cy="12" rx="9.5" ry="4" />
          <ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-60 12 12)" />
        </svg>
      </span>
      <span className="agent-bubble__head">
        <span className="agent-bubble__name">{agentName}</span>
        <span className="agent-bubble__time">
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </span>
      <span className="agent-bubble__text">
        Hello! I'm your HayDev Browser OS agent. Ask anything — I can browse, research,
        analyze, and execute tasks for you.
      </span>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const time = message.ts
    ? new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  if (message.role === 'user') {
    return (
      <div className={`user-bubble ${message.error ? 'user-bubble--error' : ''}`}>
        <span className="user-bubble__head">
          <span className="user-bubble__name">YOU</span>
          {time && <span className="user-bubble__time">{time}</span>}
        </span>
        <span className="user-bubble__text">{message.text}</span>
      </div>
    );
  }
  return (
    <div className={`agent-bubble ${message.error ? 'agent-bubble--error' : ''}`}>
      <span className="agent-bubble__head">
        <span className="agent-bubble__name">HAYDEV AGENT</span>
        {time && <span className="agent-bubble__time">{time}</span>}
      </span>
      <span className="agent-bubble__text">{message.text}</span>
    </div>
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
  if (mode === 'HUMAN') return 'Switch to AGENT mode to send messages…';
  if (running) return 'Agent is running… press STOP to abort.';
  return 'Type your message…';
}
