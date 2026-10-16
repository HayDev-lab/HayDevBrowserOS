import type { HistoryEntry } from '@shared/browser-types';
import { useI18n } from '../../i18n';
import { formatRelativeTime, type RelativeTimeLabels } from '../../store/ui-logic';

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
  const { t } = useI18n();
  if (!open) return null;
  const rel: Partial<RelativeTimeLabels> = {
    justNow: t('rel.justNow'),
    mAgo: t('rel.mAgo'),
    hAgo: t('rel.hAgo'),
    dAgo: t('rel.dAgo'),
  };
  return (
    <section className="panel panel--history" aria-label={t('panel.historyName')}>
      <header className="panel__header">
        <div className="panel__title">
          <span className="panel__title-mark" aria-hidden />
          <h2>{t('panel.history')}</h2>
          <span className="panel__count">{history.length}</span>
        </div>
        <div className="panel__actions">
          <button
            type="button"
            className="panel__action"
            onClick={onClear}
            disabled={history.length === 0}
            title={t('panel.clearTip')}
          >
            {t('panel.clear')}
          </button>
          <button
            type="button"
            className="panel__close"
            onClick={onClose}
            aria-label={t('panel.closeAria', { name: t('panel.historyName') })}
          >
            ×
          </button>
        </div>
      </header>
      <div className="panel__body">
        {history.length === 0 ? (
          <p className="panel__empty">{t('panel.historyEmpty')}</p>
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
                    {formatRelativeTime(entry.visitedAt, Date.now(), rel)} · ×{entry.visitCount}
                  </span>
                </button>
                <button
                  type="button"
                  className="list-item__delete"
                  onClick={() => onDelete(entry.id)}
                  aria-label={t('panel.deleteHistoryAria', { title: entry.title })}
                  title={t('panel.deleteTip')}
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
