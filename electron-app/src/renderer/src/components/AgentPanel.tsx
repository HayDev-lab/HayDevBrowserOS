import { attachmentErrorMessage } from '@shared/attachment-errors';
import { platformApi } from '../platform';
/**
 * AgentPanel — Matrix agent dock (concept 1:1).
 *
 * Structure:
 *   header    ● AGENT .................... HUMAN MODE / AGENT MODE
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
import { useI18n } from '../i18n';

export interface AgentPanelProps {
  mode: ControlMode;
  agentRunning: boolean;
  agentStatus: AgentStatusSnapshot | null;
  timeline: AgentTimelineEntry[];
  onRun: (command: string, opts?: { attachmentIds?: string[] }) => void;
  /** DEEP_RESEARCH profile run (PROMPT 9). */
  onResearch: (query: string, opts?: { attachmentIds?: string[] }) => void;
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
  const { t, lang } = useI18n();
  const [task, setTask] = useState('');
  const [tab, setTab] = useState<PanelTab>('conversation');
  const [hintOpen, setHintOpen] = useState(false);
  const [attachments, setAttachments] = useState<NewTabAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
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
    if (agentRunning || attaching) return;
    onRun(trimmed, attachments.length > 0 ? { attachmentIds: attachments.map((a) => a.id) } : undefined);
    setTask('');
    setAttachments([]);
  };

  const handleDeepResearch = () => {
    const trimmed = task.trim();
    if (trimmed.length === 0) return;
    if (mode !== 'AGENT') return;
    if (agentRunning || attaching) return;
    onResearch(trimmed, { attachmentIds: attachments.map(a => a.id) });
    setTask('');
    setAttachments([]);
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
    if (attaching) return;
    setAttachError(null);
    if (attachments.length >= 4) {
      setAttachError(t('agent.attachMax'));
      return;
    }
    setAttaching(true);
    try {
      const res = await platformApi.agent.pickAttachment('file');
      if (res.attachment) {
        setAttachments((prev) => [...prev, res.attachment as NewTabAttachment]);
      }
    } catch (error) {
      setAttachError(attachmentErrorMessage(error, lang, t('agent.attachFail')));
    } finally { setAttaching(false); }
  };

  const sources = researchReport?.sources ?? [];

  return (
    <aside
      className={`agent-panel agent-panel--${mode.toLowerCase()} ${
        agentRunning ? 'agent-panel--running' : ''
      }`}
      aria-label={t('agent.panelAria')}
    >
      <header className="agent-panel__header">
        <div className="agent-panel__title">
          <span className="agent-panel__title-mark" aria-hidden />
          <span>{t('agent.title')}</span>
        </div>
        <span
          className={`agent-panel__mode-badge agent-panel__mode-badge--${mode.toLowerCase()}`}
          aria-live="polite"
        >
          <span className="agent-panel__mode-badge-dot" aria-hidden />
          {mode === 'HUMAN' ? t('agent.modeHuman') : t('agent.modeAgent')}
        </span>
      </header>

      <div className={`agent-panel__hint ${hintOpen ? 'agent-panel__hint--open' : ''}`}>
        <button
          type="button"
          className="agent-panel__hint-btn"
          onClick={() => setHintOpen((v) => !v)}
          aria-expanded={hintOpen}
          title={mode === 'HUMAN' ? t('agent.humanHintTitle') : t('agent.agentHintTitle')}
        >
          <span>
            {mode === 'HUMAN' ? t('agent.humanHint') : t('agent.agentHint')}
          </span>
          <span className="agent-panel__hint-chevron" aria-hidden>
            {hintOpen ? '▴' : '▾'}
          </span>
        </button>
        {hintOpen && (
          <div className="agent-panel__hint-body">
            <p>{t('agent.hintBody')}</p>
            {mode === 'HUMAN' && (
              <button
                type="button"
                className="agent-panel__hint-switch"
                onClick={() => {
                  setHintOpen(false);
                  platformApi.control.setMode('AGENT');
                }}
              >
                {t('agent.hintSwitch')}
              </button>
            )}
          </div>
        )}
      </div>

      <nav className="agent-panel__tabs" role="tablist" aria-label={t('agent.tabsAria')}>
        <PanelTabButton id="conversation" label={t('agent.tabConversation')} active={tab === 'conversation'} onSelect={setTab} />
        <PanelTabButton id="tools" label={t('agent.tabTools')} active={tab === 'tools'} onSelect={setTab} />
        <PanelTabButton
          id="sources"
          label={sources.length > 0 ? t('agent.sourcesWithCount', { count: sources.length }) : t('agent.tabSources')}
          active={tab === 'sources'}
          onSelect={setTab}
        />
      </nav>

      {tab === 'conversation' && (
        <div className="agent-panel__chat" role="tabpanel" aria-label={t('agent.chatAria')}>
          <div className="agent-panel__chat-toolbar">
            <span className="agent-panel__chat-label">{t('agent.chatLabel')}</span>
            {chat.length > 0 && onClearChat && (
              <button
                type="button"
                className="agent-panel__chat-clear"
                onClick={onClearChat}
                aria-label={t('agent.clearAria')}
                title={t('agent.clearTip')}
              >
                ×
              </button>
            )}
          </div>
          <div className="agent-panel__chat-list">
            <AgentGreeting agentName={t('agent.agentName')} greeting={t('agent.greeting')} />
            {chat.map((m) => (
              <ChatBubble key={m.id} message={m} youLabel={t('agent.you')} agentName={t('agent.agentName')} />
            ))}
            {isAwaitingAnswer(chat, agentRunning) && (
              <div className="agent-bubble agent-bubble--pending">
                <span className="agent-bubble__role">{t('agent.title')}</span>
                <span className="agent-bubble__text">{t('agent.working')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'tools' && (
        <div className="agent-panel__tools" role="tabpanel" aria-label={t('agent.toolsAria')}>
          <div className="agent-panel__chat-toolbar">
            <span className="agent-panel__chat-label">{t('agent.toolsLabel')}</span>
            <span className="agent-panel__timeline-count">{timeline.length}</span>
          </div>
          {timeline.length === 0 ? (
            <p className="agent-panel__chat-empty">
              {mode === 'AGENT' ? t('agent.toolsEmptyAgent') : t('agent.toolsEmptyHuman')}
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
                  <span className="agent-panel__timeline-state">
                    {t(`agent.tl.${entry.state}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {researchActive && <ResearchPhaseView status={agentStatus} timeline={timeline} />}
        </div>
      )}

      {tab === 'sources' && (
        <div className="agent-panel__sources" role="tabpanel" aria-label={t('agent.sourcesAria')}>
          <div className="agent-panel__chat-toolbar">
            <span className="agent-panel__chat-label">{t('agent.sourcesLabel')}</span>
          </div>
          {!researchReport ? (
            <p className="agent-panel__chat-empty">{t('agent.sourcesEmpty')}</p>
          ) : (
            <div className="agent-panel__sources-body">
              {researchReport.summary && (
                <p className="agent-panel__research-summary">{researchReport.summary}</p>
              )}
              {researchReport.partial && <p role="status">{t('agent.researchPartial')}</p>}
              {researchReport.claims?.map((claim, index) => (
                <div key={index} className="agent-panel__research-claim">
                  <p>{claim.claim}</p>
                  {claim.quote && <blockquote>{claim.quote}</blockquote>}
                  {claim.verification === 'excerpt-present' && <small>{t('agent.excerptMatched')} · {claim.sourceIds.map(id => `s${id}`).join(', ')}</small>}
                </div>
              ))}
              {researchReport.conflicts?.map((conflict, index) => <p key={index}>{t('agent.researchConflict')}: {conflict.description}</p>)}
              {researchReport.unknowns?.map((unknown, index) => <p key={index}>{t('agent.researchUnknown')}: {unknown}</p>)}
              {sources.length === 0 ? (
                <p className="agent-panel__chat-empty">{t('agent.sourcesNone')}</p>
              ) : (
                <ul className="agent-panel__sources-list">
                  {sources.map((s) => (
                    <li key={s.id}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" title={s.url}>
                        s{s.id} · {s.title || s.url}
                      </a>
                      {s.status === 'failed' && (
                        <span className="agent-panel__src-failed"> {t('agent.sourceFailed')}</span>
                      )}
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
            disabled={!agentRunning && !attaching}
            aria-label={t('agent.stopAria')}
            title={t('agent.stopTip')}
          >
            {t('agent.stop')}
          </button>
          <button
            type="button"
            className="takecontrol takecontrol--panel"
            onClick={onTakeControl}
            aria-label={t('control.takeAria')}
            title={t('control.takeTip')}
          >
            <span className="takecontrol__icon" aria-hidden>
              ◆
            </span>
            <span className="takecontrol__label">{t('control.takeLabel')}</span>
          </button>
          <button
            type="button"
            className="agent-panel__deep"
            onClick={handleDeepResearch}
            disabled={mode !== 'AGENT' || agentRunning || attaching || task.trim().length === 0}
            title={t('agent.deepTip')}
          >
            {t('agent.deep')}
          </button>
        </div>

        {attachments.length > 0 && <p className="agent-panel__attachment-policy">{t('agent.attachmentPolicy')}</p>}
        {attachments.length > 0 && (
          <div className="agent-panel__attachments" aria-label={t('agent.pendingAttachmentsAria')}>
            {attachments.map((a) => (
              <span key={a.id} className="agent-panel__attachment" title={a.name}>
                <span className="agent-panel__attachment-name">{a.name}</span>
                <button
                  type="button"
                  className="agent-panel__attachment-remove"
                  aria-label={t('agent.removeAttachmentAria', { name: a.name })}
                  onClick={async () => { try { await platformApi.agent.releaseAttachment?.(a.id); setAttachments((prev) => prev.filter((x) => x.id !== a.id)); } catch (error) { setAttachError(attachmentErrorMessage(error, lang, t('agent.attachFail'))); } }}
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
            aria-label={t('agent.attachAria')}
            title={t('agent.attachTip')}
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
            placeholder={getTaskPlaceholder(mode, agentRunning, agentStatus, t)}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={mode !== 'AGENT' || agentRunning}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('agent.inputAria')}
          />
          <button
            type="button"
            className="agent-panel__iconbtn agent-panel__iconbtn--mic"
            aria-label={t('agent.micAria')}
            title={t('agent.micTip')}
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
            disabled={mode !== 'AGENT' || agentRunning || attaching || task.trim().length === 0}
            aria-label={t('agent.sendAria')}
            title={t('agent.sendTip')}
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

/**
 * RESEARCH phase strip — only mounted while a research run is active, so the
 * phase derivation stays in one place (was inlined with a null-check before).
 */
function ResearchPhaseView({
  status,
  timeline,
}: {
  status: AgentStatusSnapshot | null;
  timeline: AgentTimelineEntry[];
}) {
  const { t, lang } = useI18n();
  const researchPhase = researchPhaseFrom(status, timeline, true);
  if (!researchPhase) return null;
  return (
    <div className="agent-panel__research-phase" aria-live="polite">
      <span className="agent-panel__research-phase-label">{t('agent.researchLabel')}</span>
      <span className="agent-panel__research-phase-value" data-phase={researchPhase}>
        {t(`agent.phase.${researchPhase}`)}
      </span>
    </div>
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

function AgentGreeting({ agentName, greeting }: { agentName: string; greeting: string }) {
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
      <span className="agent-bubble__text">{greeting}</span>
    </div>
  );
}

function ChatBubble({
  message,
  youLabel,
  agentName,
}: {
  message: ChatMessage;
  youLabel: string;
  agentName: string;
}) {
  const time = message.ts
    ? new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  if (message.role === 'user') {
    return (
      <div className={`user-bubble ${message.error ? 'user-bubble--error' : ''}`}>
        <span className="user-bubble__head">
          <span className="user-bubble__name">{youLabel}</span>
          {time && <span className="user-bubble__time">{time}</span>}
        </span>
        <span className="user-bubble__text">{message.text}</span>
      </div>
    );
  }
  return (
    <div className={`agent-bubble ${message.error ? 'agent-bubble--error' : ''}`}>
      <span className="agent-bubble__head">
        <span className="agent-bubble__name">{agentName}</span>
        {time && <span className="agent-bubble__time">{time}</span>}
      </span>
      <span className="agent-bubble__text">{message.text}</span>
    </div>
  );
}

function getTaskPlaceholder(
  mode: ControlMode,
  running: boolean,
  status: AgentStatusSnapshot | null,
  t: (key: 'agent.placeholderIdle' | 'agent.placeholderHuman' | 'agent.placeholderRunning' | 'agent.placeholderNoProvider') => string
): string {
  if (status && !status.providerConfigured) {
    return t('agent.placeholderNoProvider');
  }
  if (mode === 'HUMAN') return t('agent.placeholderHuman');
  if (running) return t('agent.placeholderRunning');
  return t('agent.placeholderIdle');
}
