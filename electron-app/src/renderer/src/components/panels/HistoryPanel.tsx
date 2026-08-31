import type { HistoryEntry } from '@shared/browser-types';
import { formatRelativeTime } from '../../store/ui-logic';

interface HistoryPanelProps {
  open: boolean;
  history: HistoryEntry[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onOpenUrl: (url: string) => void;
}

export function HistoryPanel({
  open,
  history,
  onClose,
  onDelete,
  onClear,
  onOpenUrl,
}: HistoryPanelProps) {
  if (!open) return null;
  return (
    <section className="panel panel--history" aria-label="History panel">
      <header className="panel__header">
        <div className="panel__title">
          <span className="panel__title-mark" aria-hidden />
          <h2>HISTORY</h2>
          <span className="panel__count">{history.length}</span>
        </div>
        <div className="panel__actions">
          <button
            type="button"
            className="panel__action"
            onClick={onClear}
            disabled={history.length === 0}
            title="Clear all history"
          >
            Clear
          </button>
          <button
            type="button"
            className="panel__close"
            onClick={onClose}
            aria-label="Close history panel"
          >
            ×
          </button>
        </div>
      </header>
      <div className="panel__body">
        {history.length === 0 ? (
          <p className="panel__empty">No history entries.</p>
        ) : (
          <ul className="panel__list">
            {history.map((entry) => (
              <li key={entry.id} className="list-item list-item--history">
                <button
                  type="button"
                  className="list-item__main"
                  onClick={() => onOpenUrl(entry.url)}
                  title={entry.url}
                >
                  <span className="list-item__title">{entry.title}</span>
                  <span className="list-item__url">{entry.url}</span>
                  <span className="list-item__meta">
                    {formatRelativeTime(entry.visitedAt)} · ×{entry.visitCount}
                  </span>
                </button>
                <button
                  type="button"
                  className="list-item__delete"
                  onClick={() => onDelete(entry.id)}
                  aria-label={`Delete history entry: ${entry.title}`}
                  title="Delete entry"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
