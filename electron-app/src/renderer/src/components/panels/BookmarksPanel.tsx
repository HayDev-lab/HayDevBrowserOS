import type { Bookmark } from '@shared/browser-types';
import { useI18n } from '../../i18n';
import { formatRelativeTime, type RelativeTimeLabels } from '../../store/ui-logic';

interface BookmarksPanelProps {
  open: boolean;
  bookmarks: Bookmark[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onOpenUrl: (url: string) => void;
}

export function BookmarksPanel({
  open,
  bookmarks,
  onClose,
  onDelete,
  onOpenUrl,
}: BookmarksPanelProps) {
  const { t } = useI18n();
  if (!open) return null;
  const rel: Partial<RelativeTimeLabels> = {
    justNow: t('rel.justNow'),
    mAgo: t('rel.mAgo'),
    hAgo: t('rel.hAgo'),
    dAgo: t('rel.dAgo'),
  };
  return (
    <section className="panel panel--bookmarks" aria-label={t('panel.bookmarksName')}>
      <header className="panel__header">
        <div className="panel__title">
          <span className="panel__title-mark" aria-hidden />
          <h2>{t('panel.bookmarks')}</h2>
          <span className="panel__count">{bookmarks.length}</span>
        </div>
        <button
          type="button"
          className="panel__close"
          onClick={onClose}
          aria-label={t('panel.closeAria', { name: t('panel.bookmarksName') })}
        >
          ×
        </button>
      </header>
      <div className="panel__body">
        {bookmarks.length === 0 ? (
          <p className="panel__empty">{t('panel.bookmarksEmpty')}</p>
        ) : (
          <ul className="panel__list">
            {bookmarks.map((bm) => (
              <li key={bm.id} className="list-item list-item--bookmark">
                <button
                  type="button"
                  className="list-item__main"
                  onClick={() => onOpenUrl(bm.url)}
                  title={bm.url}
                >
                  <span className="list-item__title">{bm.title}</span>
                  <span className="list-item__url">{bm.url}</span>
                  <span className="list-item__meta">
                    {t('panel.added', { time: formatRelativeTime(bm.addedAt, Date.now(), rel) })}
                  </span>
                </button>
                <button
                  type="button"
                  className="list-item__delete"
                  onClick={() => onDelete(bm.id)}
                  aria-label={t('panel.deleteBookmarkAria', { title: bm.title })}
                  title={t('panel.deleteBookmarkTip')}
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
