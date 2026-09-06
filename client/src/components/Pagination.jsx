import { useTranslation } from 'react-i18next';

/**
 * Page navigation for a `{ page, limit, total, totalPages }` meta block.
 *
 * The window of page numbers is bounded: a result set of 400 pages must not
 * render 400 buttons. Five around the current page, with the first and last
 * always reachable, covers every way a person actually navigates a list.
 *
 * The chevrons are `chevron-inline-start/end` in spirit — Bootstrap RTL flips
 * them for us, which is why they are plain left/right icons rather than
 * something hand-rolled.
 */
export default function Pagination({ meta, onPageChange }) {
  const { t } = useTranslation();

  if (!meta || meta.totalPages <= 1) {
    return (
      <div className="d-flex justify-content-between align-items-center pt-3 small text-body-secondary">
        <span>
          {t('common.showing', {
            from: meta?.total ? 1 : 0,
            to: meta?.total ?? 0,
            total: meta?.total ?? 0,
          })}
        </span>
      </div>
    );
  }

  const { page, limit, total, totalPages, hasNext, hasPrev } = meta;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const pages = [];
  for (let index = start; index <= end; index++) pages.push(index);

  return (
    <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 pt-3">
      <span className="small text-body-secondary">
        {t('common.showing', { from, to, total })}
      </span>

      <nav aria-label="pagination">
        <ul className="pagination pagination-sm mb-0">
          <li className={`page-item ${hasPrev ? '' : 'disabled'}`}>
            <button
              type="button"
              className="page-link"
              onClick={() => onPageChange(page - 1)}
              disabled={!hasPrev}
              aria-label={t('common.previous')}
            >
              <i className="bi bi-chevron-left" aria-hidden="true" />
            </button>
          </li>

          {start > 1 && (
            <>
              <li className="page-item">
                <button type="button" className="page-link" onClick={() => onPageChange(1)}>
                  1
                </button>
              </li>
              {start > 2 && (
                <li className="page-item disabled">
                  <span className="page-link">…</span>
                </li>
              )}
            </>
          )}

          {pages.map((number) => (
            <li key={number} className={`page-item ${number === page ? 'active' : ''}`}>
              <button
                type="button"
                className="page-link"
                onClick={() => onPageChange(number)}
                aria-current={number === page ? 'page' : undefined}
              >
                {number}
              </button>
            </li>
          ))}

          {end < totalPages && (
            <>
              {end < totalPages - 1 && (
                <li className="page-item disabled">
                  <span className="page-link">…</span>
                </li>
              )}
              <li className="page-item">
                <button
                  type="button"
                  className="page-link"
                  onClick={() => onPageChange(totalPages)}
                >
                  {totalPages}
                </button>
              </li>
            </>
          )}

          <li className={`page-item ${hasNext ? '' : 'disabled'}`}>
            <button
              type="button"
              className="page-link"
              onClick={() => onPageChange(page + 1)}
              disabled={!hasNext}
              aria-label={t('common.next')}
            >
              <i className="bi bi-chevron-right" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
