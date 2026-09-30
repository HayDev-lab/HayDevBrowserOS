import { describe, it, expect } from 'vitest';
import {
  authorizeToolCall,
  canStartAgentRun,
  switchToAgent,
  takeControl,
  clearTakeoverLatch,
  markAgentRunStarted,
  markAgentRunEnded,
  resetControlAuthorization,
  DEFAULT_CONTROL_AUTHORIZATION,
  type ControlAuthorizationState,
} from '../src/main/browser/agent/pure/control-authorization';
import type { ToolName } from '@shared/agent-types';

const ALL_TOOLS: ToolName[] = [
  'browser.navigate',
  'browser.read',
  'tabs.list',
  'tabs.open',
  'tabs.activate',
  'tabs.close',
  'page.click',
  'page.type',
  'page.scroll',
  'agent.stop',
];

describe('control-authorization / HUMAN mode', () => {
  const human: ControlAuthorizationState = {
    mode: 'HUMAN',
    takeoverLatched: false,
    agentRunActive: false,
  };

  it('denies all browser tools in HUMAN mode', () => {
    const browserTools = ALL_TOOLS.filter((t) => t !== 'agent.stop');
    for (const tool of browserTools) {
      const decision = authorizeToolCall(human, tool);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toBe('human_mode_denies_browser_tools');
      }
    }
  });

  it('allows agent.stop in HUMAN mode', () => {
    const decision = authorizeToolCall(human, 'agent.stop');
    expect(decision.allowed).toBe(true);
  });
});

describe('control-authorization / AGENT mode', () => {
  const agent: ControlAuthorizationState = {
    mode: 'AGENT',
    takeoverLatched: false,
    agentRunActive: true,
  };

  it('allows all V1 tools in AGENT mode', () => {
    for (const tool of ALL_TOOLS) {
      const decision = authorizeToolCall(agent, tool);
      expect(decision.allowed).toBe(true);
    }
  });
});

describe('control-authorization / takeover latch', () => {
  it('denies all tools when takeover is latched', () => {
    const latched: ControlAuthorizationState = {
      mode: 'HUMAN',
      takeoverLatched: true,
      agentRunActive: false,
    };
    for (const tool of ALL_TOOLS) {
      const decision = authorizeToolCall(latched, tool);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toBe('takeover_latched');
      }
    }
  });

  it('denies even agent.stop when latched', () => {
    const latched: ControlAuthorizationState = {
      mode: 'HUMAN',
      takeoverLatched: true,
      agentRunActive: false,
    };
    expect(authorizeToolCall(latched, 'agent.stop').allowed).toBe(false);
  });
});

describe('control-authorization / TAKE CONTROL', () => {
  it('takeControl transitions to HUMAN + latches takeover', () => {
    const agent: ControlAuthorizationState = {
      mode: 'AGENT',
      takeoverLatched: false,
      agentRunActive: true,
    };
    const after = takeControl(agent, 'user_request');
    expect(after.mode).toBe('HUMAN');
    expect(after.takeoverLatched).toBe(true);
    expect(after.agentRunActive).toBe(false);
  });

  it('takeControl is unconditional (works from any state)', () => {
    const running: ControlAuthorizationState = {
      mode: 'AGENT',
      takeoverLatched: false,
      agentRunActive: true,
    };
    expect(takeControl(running).mode).toBe('HUMAN');

    const idle: ControlAuthorizationState = {
      mode: 'AGENT',
      takeoverLatched: false,
      agentRunActive: false,
    };
    expect(takeControl(idle).mode).toBe('HUMAN');
  });

  it('clearTakeoverLatch unlatches without changing mode', () => {
    const latched: ControlAuthorizationState = {
      mode: 'HUMAN',
      takeoverLatched: true,
      agentRunActive: false,
    };
    const after = clearTakeoverLatch(latched);
    expect(after.takeoverLatched).toBe(false);
    expect(after.mode).toBe('HUMAN');
  });

  it('after takeover + clear, switching to AGENT is allowed', () => {
    const agent1: ControlAuthorizationState = {
      mode: 'AGENT',
      takeoverLatched: false,
      agentRunActive: true,
    };
    const afterTakeover = takeControl(agent1);
    const afterClear = clearTakeoverLatch(afterTakeover);
    const afterSwitch = switchToAgent(afterClear);
    expect(afterSwitch.mode).toBe('AGENT');
    expect(afterSwitch.takeoverLatched).toBe(false);
  });
});

describe('control-authorization / subsequent tools after takeover', () => {
  it('all tools are denied after TAKE CONTROL', () => {
    let state: ControlAuthorizationState = {
      mode: 'AGENT',
      takeoverLatched: false,
      agentRunActive: true,
    };
    state = takeControl(state, 'user_request');
    for (const tool of ALL_TOOLS) {
      expect(authorizeToolCall(state, tool).allowed).toBe(false);
    }
  });
});

describe('control-authorization / canStartAgentRun', () => {
  it('returns true for AGENT + no run + no latch', () => {
    expect(canStartAgentRun({
      mode: 'AGENT',
      takeoverLatched: false,
      agentRunActive: false,
    })).toBe(true);
  });

  it('returns false for HUMAN mode', () => {
    expect(canStartAgentRun({
      mode: 'HUMAN',
      takeoverLatched: false,
      agentRunActive: false,
    })).toBe(false);
  });

  it('returns false when run is active', () => {
    expect(canStartAgentRun({
      mode: 'AGENT',
      takeoverLatched: false,
      agentRunActive: true,
    })).toBe(false);
  });

  it('returns false when takeover is latched', () => {
    expect(canStartAgentRun({
      mode: 'HUMAN',
      takeoverLatched: true,
      agentRunActive: false,
    })).toBe(false);
  });
});

describe('control-authorization / switchToAgent', () => {
  it('transitions HUMAN → AGENT', () => {
    const after = switchToAgent(DEFAULT_CONTROL_AUTHORIZATION);
    expect(after.mode).toBe('AGENT');
  });

  it('refuses if a run is active', () => {
    const running: ControlAuthorizationState = {
      mode: 'HUMAN',
      takeoverLatched: false,
      agentRunActive: true,
    };
    const after = switchToAgent(running);
    expect(after).toBe(running); // unchanged
  });

  it('is a no-op when already AGENT', () => {
    const agent: ControlAuthorizationState = {
      mode: 'AGENT',
      takeoverLatched: false,
      agentRunActive: false,
    };
    expect(switchToAgent(agent)).toBe(agent);
  });
});

describe('control-authorization / run lifecycle', () => {
  it('markAgentRunStarted sets agentRunActive=true', () => {
    const agent: ControlAuthorizationState = {
      mode: 'AGENT',
      takeoverLatched: false,
      agentRunActive: false,
    };
    const after = markAgentRunStarted(agent);
    expect(after.agentRunActive).toBe(true);
  });

  it('markAgentRunStarted refuses in HUMAN mode', () => {
    const after = markAgentRunStarted(DEFAULT_CONTROL_AUTHORIZATION);
    expect(after).toBe(DEFAULT_CONTROL_AUTHORIZATION);
  });

  it('markAgentRunEnded sets agentRunActive=false', () => {
    const running: ControlAuthorizationState = {
      mode: 'AGENT',
      takeoverLatched: false,
      agentRunActive: true,
    };
    const after = markAgentRunEnded(running);
    expect(after.agentRunActive).toBe(false);
  });

  it('markAgentRunEnded is a no-op when not running', () => {
    const idle: ControlAuthorizationState = {
      mode: 'AGENT',
      takeoverLatched: false,
      agentRunActive: false,
    };
    expect(markAgentRunEnded(idle)).toBe(idle);
  });
});

describe('control-authorization / reset', () => {
  it('returns to default HUMAN state', () => {
    const after = resetControlAuthorization();
    expect(after).toEqual(DEFAULT_CONTROL_AUTHORIZATION);
  });
});

describe('control-authorization / browser state preservation', () => {
  it('takeControl does NOT touch browser state — only authorization flags', () => {
    // The authorization state machine has no concept of tabs, sessions, or
    // pages. It only tracks mode + takeover + agentRunActive. This test
    // documents that contract: the authorization layer CANNOT destroy
    // browser state because it has no reference to it.
    const state: ControlAuthorizationState = {
      mode: 'AGENT',
      takeoverLatched: false,
      agentRunActive: true,
    };
    const after = takeControl(state);
    // The only fields that changed are authorization-related.
    expect(after.mode).toBe('HUMAN');
    expect(after.takeoverLatched).toBe(true);
    expect(after.agentRunActive).toBe(false);
    // No tab destruction, no session clear, no page reload — those concepts
    // don't exist in this module.
  });
});
