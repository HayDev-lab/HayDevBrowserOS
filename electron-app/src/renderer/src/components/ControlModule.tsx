/**
 * ControlModule — HUMAN ↔ AGENT visual control surface.
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
 *
 * NO IPC. NO Agent Runtime. State is local-deterministic via useControlState().
 * PROMPT 5 will wire the actual AgentController; this UI shell is the
 * foundation.
 */
import { useControlState } from '../store/control-store';
import { getControlModeLabel, getControlModeAccent } from '../store/ui-logic';
import type { ControlMode, TakeControlVisibility } from '../store/ui-logic';

interface ControlModuleProps {
  /** Optional callback when TAKE CONTROL is pressed (in addition to the local state update). */
  onTakeControl?: () => void;
  /** Optional callback when mode is switched (e.g. to focus the AgentPanel). */
  onModeChange?: (mode: ControlMode) => void;
  /** Compact mode for narrow windows. */
  compact?: boolean;
}

export function ControlModule({
  onTakeControl,
  onModeChange,
  compact = false,
}: ControlModuleProps) {
  const ctrl = useControlState();
  const visibility = ctrl.takeControlVisibility;

  const handleSwitchMode = (mode: ControlMode) => {
    if (mode === 'AGENT') {
      ctrl.activateAgent();
    } else {
      ctrl.takeControl();
    }
    onModeChange?.(mode);
  };

  const handleTakeControl = () => {
    ctrl.takeControl();
    onTakeControl?.();
  };

  return (
    <div
      className={`control-module control-module--${ctrl.mode.toLowerCase()} ${
        compact ? 'control-module--compact' : ''
      }`}
      role="group"
      aria-label="Agent control mode"
    >
      <div className="control-module__mode-pill" aria-live="polite">
        <span
          className={`control-module__mode-dot control-module__mode-dot--${ctrl.mode.toLowerCase()}`}
          aria-hidden
        />
        <span
          className="control-module__mode-label"
          style={{ ['--nc-mode-accent' as string]: `var(${getControlModeAccent(ctrl.mode)})` }}
        >
          {getControlModeLabel(ctrl.mode)}
        </span>
        {ctrl.agentRunning && (
          <span
            className="control-module__agent-status"
            aria-label="Agent task running"
          >
            ACTIVE
          </span>
        )}
      </div>

      {!compact && (
        <div className="control-module__mode-switch" role="radiogroup" aria-label="Control mode selector">
          <ModeSwitchButton
            mode="HUMAN"
            active={ctrl.mode === 'HUMAN'}
            disabled={!ctrl.canTransitionTo('HUMAN') && ctrl.mode !== 'HUMAN'}
            onClick={() => handleSwitchMode('HUMAN')}
          />
          <ModeSwitchButton
            mode="AGENT"
            active={ctrl.mode === 'AGENT'}
            disabled={!ctrl.canTransitionTo('AGENT') && ctrl.mode !== 'AGENT'}
            onClick={() => handleSwitchMode('AGENT')}
          />
        </div>
      )}

      <TakeControlButton
        visibility={visibility}
        onClick={handleTakeControl}
        compact={compact}
      />
    </div>
  );
}

interface ModeSwitchButtonProps {
  mode: ControlMode;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}

function ModeSwitchButton({ mode, active, disabled, onClick }: ModeSwitchButtonProps) {
  return (
    <button
      type="button"
      className={`control-module__mode-btn control-module__mode-btn--${mode.toLowerCase()} ${
        active ? 'control-module__mode-btn--active' : ''
      }`}
      role="radio"
      aria-checked={active}
      aria-label={`Switch to ${mode} mode`}
      title={`Switch to ${mode} mode`}
      disabled={disabled}
      onClick={onClick}
    >
      {mode}
    </button>
  );
}

interface TakeControlButtonProps {
  visibility: TakeControlVisibility;
  onClick: () => void;
  compact: boolean;
}

function TakeControlButton({ visibility, onClick, compact }: TakeControlButtonProps) {
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
      aria-label="Take control — abort agent and switch to HUMAN mode"
      title="TAKE CONTROL — abort agent task and return to HUMAN mode"
    >
      <span className="takecontrol__icon" aria-hidden>
        ◆
      </span>
      <span className="takecontrol__label">TAKE CONTROL</span>
    </button>
  );
}
