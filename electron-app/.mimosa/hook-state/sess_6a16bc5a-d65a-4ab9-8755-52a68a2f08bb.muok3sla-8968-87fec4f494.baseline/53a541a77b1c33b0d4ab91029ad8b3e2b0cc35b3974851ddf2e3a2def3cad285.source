import type { Bookmark } from '@shared/browser-types';
import { formatRelativeTime } from '../../store/ui-logic';

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
  if (!open) return null;
  return (
    <section className="panel panel--bookmarks" aria-label="Bookmarks panel">
      <header className="panel__header">
        <div className="panel__title">
          <span className="panel__title-mark" aria-hidden />
          <h2>BOOKMARKS</h2>
          <span className="panel__count">{bookmarks.length}</span>
        </div>
        <button
          type="button"
          className="panel__close"
          onClick={onClose}
          aria-label="Close bookmarks panel"
        >
          ×
        </button>
      </header>
      <div className="panel__body">
        {bookmarks.length === 0 ? (
          <p className="panel__empty">No bookmarks yet.</p>
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
                    added {formatRelativeTime(bm.addedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className="list-item__delete"
                  onClick={() => onDelete(bm.id)}
                  aria-label={`Delete bookmark: ${bm.title}`}
                  title="Delete bookmark"
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
