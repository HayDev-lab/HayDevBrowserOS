import { platformApi } from '../platform';
/**
 * MemoryPrompt — "remember this?" confirmation chip in the agent rail.
 *
 * The agent proposed a fact about the user (memory.save tool); nothing is
 * stored until the user confirms here.
 */
import { useEffect, useState, useCallback } from 'react';
import type { MemorySavePrompt } from '@shared/memory-types';

export function useMemoryPrompt(): {
  prompt: MemorySavePrompt | null;
  resolve: (save: boolean) => Promise<void>;
} {
  const [prompt, setPrompt] = useState<MemorySavePrompt | null>(null);

  useEffect(() => {
    void platformApi.memory
      .current()
      .then(setPrompt)
      .catch(() => {});
    const off = platformApi.on('memory:prompt:update', (data) => {
      const update = data as
        | { kind: 'set'; prompt: MemorySavePrompt }
        | { kind: 'clear' };
      setPrompt(update.kind === 'set' ? update.prompt : null);
    });
    return () => {
      off?.();
    };
  }, []);

  const resolve = useCallback(
    async (save: boolean) => {
      if (!prompt) return;
      setPrompt(null);
      try {
        await platformApi.memory.resolve({ promptId: prompt.id, save });
      } catch {
        // Prompt state is already cleared locally; the push reconciles.
      }
    },
    [prompt]
  );

  return { prompt, resolve };
}

export function MemoryPrompt() {
  const { prompt, resolve } = useMemoryPrompt();
  if (!prompt) return null;

  return (
    <aside
      className="memory-prompt"
      role="alertdialog"
      aria-label="Remember a fact about you"
    >
      <div className="memory-prompt__head">
        <span className="memory-prompt__title">REMEMBER THIS?</span>
        <button
          type="button"
          className="memory-prompt__close"
          onClick={() => void resolve(false)}
          aria-label="Dismiss"
          title="Skip"
        >
          ×
        </button>
      </div>
      <p className="memory-prompt__fact">{prompt.fact}</p>
      <div className="memory-prompt__actions">
        <button
          type="button"
          className="memory-prompt__btn memory-prompt__btn--save"
          onClick={() => void resolve(true)}
          title="Store this fact for future agent runs"
        >
          Remember
        </button>
        <button
          type="button"
          className="memory-prompt__btn"
          onClick={() => void resolve(false)}
        >
          Skip
        </button>
      </div>
    </aside>
  );
}
