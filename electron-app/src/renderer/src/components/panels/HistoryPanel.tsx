import type { HistoryEntry } from '@shared/browser-types';

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
    <div className="panel">
      <div className="panel__header">
        <h2>History</h2>
        <div className="panel__actions">
          <button onClick={onClear} title="Clear all history">Clear all</button>
          <button onClick={onClose} aria-label="Close history panel">×</button>
        </div>
      </div>
      <div className="panel__body">
        {history.length === 0 ? (
          <p className="panel__empty">No history yet.</p>
        ) : (
          <ul className="panel__list">
            {history.map((entry) => (
              <li key={entry.id} className="history-item">
                <button
                  className="history-item__main"
                  onClick={() => onOpenUrl(entry.url)}
                  title={entry.url}
                >
                  <span className="history-item__title">{entry.title}</span>
                  <span className="history-item__url">{entry.url}</span>
                </button>
                <span className="history-item__count" title="Visit count">
                  ×{entry.visitCount}
                </span>
                <button
                  className="history-item__delete"
                  onClick={() => onDelete(entry.id)}
                  aria-label="Delete entry"
                  title="Delete entry"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
