import type { Bookmark } from '@shared/browser-types';

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
    <div className="panel">
      <div className="panel__header">
        <h2>Bookmarks</h2>
        <button onClick={onClose} aria-label="Close bookmarks panel">×</button>
      </div>
      <div className="panel__body">
        {bookmarks.length === 0 ? (
          <p className="panel__empty">No bookmarks yet.</p>
        ) : (
          <ul className="panel__list">
            {bookmarks.map((bm) => (
              <li key={bm.id} className="bookmark-item">
                <button
                  className="bookmark-item__main"
                  onClick={() => onOpenUrl(bm.url)}
                  title={bm.url}
                >
                  <span className="bookmark-item__title">{bm.title}</span>
                  <span className="bookmark-item__url">{bm.url}</span>
                </button>
                <button
                  className="bookmark-item__delete"
                  onClick={() => onDelete(bm.id)}
                  aria-label="Delete bookmark"
                  title="Delete bookmark"
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
