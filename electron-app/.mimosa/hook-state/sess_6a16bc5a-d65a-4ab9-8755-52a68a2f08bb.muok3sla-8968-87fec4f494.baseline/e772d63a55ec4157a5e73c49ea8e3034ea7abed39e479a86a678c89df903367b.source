import type { DownloadItemState } from '@shared/browser-types';
import {
  formatBytes,
  formatPercent,
  getDownloadStateColorClass,
  isDownloadTerminal,
  isDownloadInProgress,
} from '../../store/ui-logic';

interface DownloadsPanelProps {
  open: boolean;
  downloads: DownloadItemState[];
  onClose: () => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
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
    <section className="panel panel--downloads" aria-label="Downloads panel">
      <header className="panel__header">
        <div className="panel__title">
          <span className="panel__title-mark" aria-hidden />
          <h2>DOWNLOADS</h2>
          <span className="panel__count">{downloads.length}</span>
        </div>
        <button
          type="button"
          className="panel__close"
          onClick={onClose}
          aria-label="Close downloads panel"
        >
          ×
        </button>
      </header>
      <div className="panel__body">
        {downloads.length === 0 ? (
          <p className="panel__empty">No downloads yet.</p>
        ) : (
          <ul className="panel__list">
            {downloads.map((dl) => {
              const pct = formatPercent(dl.receivedBytes, dl.totalBytes);
              return (
                <li key={dl.id} className="download-item">
                  <div className="download-item__main">
                    <div className="download-item__row">
                      <span className="download-item__filename" title={dl.filename}>
                        {dl.filename}
                      </span>
                      <span
                        className={`download-item__state ${getDownloadStateColorClass(dl.state)}`}
                      >
                        {dl.state}
                      </span>
                    </div>
                    <div className="download-item__meta">
                      {formatBytes(dl.receivedBytes)}
                      {dl.totalBytes > 0 && ` / ${formatBytes(dl.totalBytes)}`}
                      {isDownloadInProgress(dl.state) && dl.totalBytes > 0 && ` · ${pct}%`}
                    </div>
                    {isDownloadInProgress(dl.state) && (
                      <div
                        className="download-item__progress"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Download ${pct}% complete`}
                      >
                        <div
                          className="download-item__progress-bar"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                    {dl.error && (
                      <div className="download-item__error" role="alert">
                        {dl.error}
                      </div>
                    )}
                  </div>
                  <div className="download-item__actions">
                    {isDownloadInProgress(dl.state) && (
                      <button
                        type="button"
                        className="download-item__action download-item__action--cancel"
                        onClick={() => onCancel(dl.id)}
                        title="Cancel download"
                      >
                        Cancel
                      </button>
                    )}
                    {isDownloadTerminal(dl.state) && (
                      <button
                        type="button"
                        className="download-item__action download-item__action--remove"
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
    </section>
  );
}
