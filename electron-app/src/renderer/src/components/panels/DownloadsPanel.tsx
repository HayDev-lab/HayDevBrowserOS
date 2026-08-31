import type { DownloadItemState } from '@shared/browser-types';

interface DownloadsPanelProps {
  open: boolean;
  downloads: DownloadItemState[];
  onClose: () => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function DownloadsPanel({
  open,
  downloads,
  onClose,
  onCancel,
  onRemove,
}: DownloadsPanelProps) {
  if (!open) return null;
  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Downloads</h2>
        <button onClick={onClose} aria-label="Close downloads panel">×</button>
      </div>
      <div className="panel__body">
        {downloads.length === 0 ? (
          <p className="panel__empty">No downloads yet.</p>
        ) : (
          <ul className="panel__list">
            {downloads.map((dl) => {
              const pct =
                dl.totalBytes > 0
                  ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100))
                  : 0;
              return (
                <li key={dl.id} className="download-item">
                  <div className="download-item__main">
                    <span className="download-item__filename">{dl.filename}</span>
                    <span className="download-item__meta">
                      {formatBytes(dl.receivedBytes)}
                      {dl.totalBytes > 0 && ` / ${formatBytes(dl.totalBytes)}`}
                      {' · '}
                      <span className={`download-item__state download-item__state--${dl.state}`}>
                        {dl.state}
                      </span>
                    </span>
                    {(dl.state === 'pending' || dl.state === 'progressing') && (
                      <div className="download-item__progress">
                        <div
                          className="download-item__progress-bar"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                    {dl.error && (
                      <span className="download-item__error">{dl.error}</span>
                    )}
                  </div>
                  <div className="download-item__actions">
                    {(dl.state === 'pending' || dl.state === 'progressing') && (
                      <button
                        onClick={() => onCancel(dl.id)}
                        title="Cancel download"
                      >
                        Cancel
                      </button>
                    )}
                    {(dl.state === 'completed' ||
                      dl.state === 'cancelled' ||
                      dl.state === 'interrupted') && (
                      <button
                        onClick={() => onRemove(dl.id)}
                        title="Remove from list"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
