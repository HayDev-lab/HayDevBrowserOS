/**
 * ControlModule — HUMAN ↔ AGENT visual control surface.
 *
 * PROMPT 5: now wired to the real runtime via props (mode, agentRunning,
 * onSetMode, onTakeControl). The local `useControlState` hook from PROMPT 3
 * is still used for instant visual feedback (takeover latch), but the
 * actual mode transitions go through IPC to the AgentController.
 *
 * Visual language:
 *   HUMAN  — calm teal accent, stable outline button, no motion.
 *   AGENT  — amber accent, subtle ambient motion on the mode pill.
 *
 * TAKE CONTROL button visibility escalates:
 *   - hidden   (HUMAN, no activity)
 *   - subtle   (HUMAN, agent shutting down)
 *   - elevated (AGENT, idle)
 *   - critical (AGENT, running — strong glow + pulse; or takeover latched)
 */
import { useState, useCallback } from 'react';
import { useI18n } from '../i18n';
import {
  getControlModeAccent,
  getTakeControlVisibility,
  type ControlMode,
  type ControlState,
  type TakeControlVisibility,
} from '../store/ui-logic';

interface ControlModuleProps {
  mode: ControlMode;
  agentRunning: boolean;
  onSetMode: (mode: ControlMode) => void;
  onTakeControl: () => void;
  agentPanelOpen?: boolean;
  onToggleAgentPanel?: () => void;
  /** Optional compact mode for narrow windows. */
  compact?: boolean;
  /**
   * Slim toolbar mode (Matrix concept): just the HUMAN | AGENT pair —
   * the status pill and TAKE CONTROL live in the agent dock.
   */
  slim?: boolean;
}

export function ControlModule({
  mode,
  agentRunning,
  onSetMode,
  onTakeControl,
  agentPanelOpen = true,
  onToggleAgentPanel,
  compact = false,
  slim = false,
}: ControlModuleProps) {
  const { t } = useI18n();
  // Local takeover latch — set immediately on TAKE CONTROL for instant
  // visual feedback; cleared when the mode flips back to AGENT (user
  // explicitly switches back). The runtime AgentController also tracks
  // this, but the local latch ensures the UI reacts instantly.
  const [takeoverLatched, setTakeoverLatched] = useState(false);

  // Build a ControlState for the visibility helper.
  const controlState: ControlState = {
    mode,
    agentRunning,
    takeoverLatched,
  };
  const visibility = getTakeControlVisibility(controlState);

  const handleSwitchMode = useCallback(
    (nextMode: ControlMode) => {
      if (nextMode === 'AGENT' && nextMode === mode) {
        onToggleAgentPanel?.();
        return;
      }
      if (nextMode === mode) return;
      if (nextMode === 'AGENT') {
        // Clear the latch when switching to AGENT.
        setTakeoverLatched(false);
      }
      onSetMode(nextMode);
    },
    [mode, onSetMode, onToggleAgentPanel]
  );

  const handleTakeControl = useCallback(() => {
    setTakeoverLatched(true);
    onTakeControl();
  }, [onTakeControl]);

  // Clear the latch when the mode flips back to AGENT (the user
  // explicitly switched back, acknowledging the takeover).
  if (takeoverLatched && mode === 'AGENT') {
    setTakeoverLatched(false);
  }

  return (
    <div
      className={`control-module control-module--${mode.toLowerCase()} ${
        compact ? 'control-module--compact' : ''
      } ${slim ? 'control-module--slim' : ''}`}
      role="group"
      aria-label={t('control.groupAria')}
    >
      {!slim && (
        <div className="control-module__mode-pill" aria-live="polite">
          <span
            className={`control-module__mode-dot control-module__mode-dot--${mode.toLowerCase()}`}
            aria-hidden
          />
          <span
            className="control-module__mode-label"
            style={{ ['--nc-mode-accent' as string]: `var(${getControlModeAccent(mode)})` }}
          >
            {mode === 'HUMAN' ? t('control.human') : t('control.agent')}
          </span>
          {agentRunning && (
            <span className="control-module__agent-status" aria-label={t('control.active')}>
              {t('control.active')}
            </span>
          )}
        </div>
      )}

      {(!compact || slim) && (
        <div className="control-module__mode-switch" role="radiogroup" aria-label={t('control.switchAria')}>
          <ModeSwitchButton
            mode="HUMAN"
            active={mode === 'HUMAN'}
            disabled={mode === 'HUMAN'}
            label={t('control.human')}
            title={t('control.toHuman')}
            onClick={() => handleSwitchMode('HUMAN')}
          />
          <ModeSwitchButton
            mode="AGENT"
            active={mode === 'AGENT'}
            disabled={mode !== 'AGENT' && agentRunning}
            label={t('control.agent')}
            title={t('control.toAgent')}
            panelOpen={agentPanelOpen}
            panelTitle={t(agentPanelOpen ? 'control.closeAgentPanel' : 'control.openAgentPanel')}
            onClick={() => handleSwitchMode('AGENT')}
          />
        </div>
      )}

      {!slim && (
        <TakeControlButton
          visibility={visibility}
          label={t('control.takeLabel')}
          ariaLabel={t('control.takeAria')}
          title={t('control.takeTip')}
          onClick={handleTakeControl}
          compact={compact}
        />
      )}
    </div>
  );
}

interface ModeSwitchButtonProps {
  mode: ControlMode;
  active: boolean;
  disabled: boolean;
  label: string;
  title: string;
  panelOpen?: boolean;
  panelTitle?: string;
  onClick: () => void;
}

function ModeSwitchButton({ mode, active, disabled, label, title, panelOpen, panelTitle, onClick }: ModeSwitchButtonProps) {
  const effectiveTitle = mode === 'AGENT' && active
    ? (panelTitle ?? title)
    : title;
  return (
    <button
      type="button"
      className={`control-module__mode-btn control-module__mode-btn--${mode.toLowerCase()} ${
        active ? 'control-module__mode-btn--active' : ''
      }`}
      role="radio"
      aria-checked={active}
      aria-label={effectiveTitle}
      title={effectiveTitle}
      aria-expanded={mode === 'AGENT' ? panelOpen : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

interface TakeControlButtonProps {
  visibility: TakeControlVisibility;
  label: string;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  compact: boolean;
}

function TakeControlButton({ visibility, label, ariaLabel, title, onClick, compact }: TakeControlButtonProps) {
  if (visibility === 'hidden') {
    // Render a placeholder so layout doesn't shift when visibility escalates.
    return <div className="takecontrol takecontrol--placeholder" aria-hidden />;
  }
  return (
    <button
      type="button"
      className={`takecontrol takecontrol--${visibility} ${
        compact ? 'takecontrol--compact' : ''
      }`}
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
    >
      <span className="takecontrol__icon" aria-hidden>
        ◆
      </span>
      <span className="takecontrol__label">{label}</span>
    </button>
  );
}
