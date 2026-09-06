import { useTranslation } from 'react-i18next';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import TableSkeleton from './TableSkeleton';
import Pagination from './Pagination';

/**
 * The table every list screen uses.
 *
 * It owns the four states a remote list can be in — loading, error, empty,
 * populated — because every screen that reinvents them gets one of them wrong,
 * and the one they get wrong is usually "empty", which then looks identical to
 * "still loading" and makes the application feel broken.
 *
 * Wide tables scroll inside their own container rather than pushing the page
 * sideways: a horizontal scrollbar on the body is the fastest way to make a
 * layout feel broken, and it is worse in RTL where it appears on the other
 * side from where the user reaches for it.
 *
 * Columns are described, not rendered by the caller, so selection, sorting and
 * the empty state can be handled once here.
 */
export default function DataTable({
  columns,
  rows,
  loading,
  error,
  onRetry,
  keyField = 'id',
  onRowClick,
  emptyTitle,
  emptyHint,
  emptyAction,
  meta,
  onPageChange,
  onSort,
  sortBy,
  sortOrder,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  compact = false,
}) {
  const { t } = useTranslation();

  const allSelected =
    selectable && rows?.length > 0 && selectedIds.length === rows.length;

  const toggleAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? [] : rows.map((row) => row[keyField]));
  };

  const toggleOne = (id) => {
    if (!onSelectionChange) return;
    onSelectionChange(
      selectedIds.includes(id)
        ? selectedIds.filter((selected) => selected !== id)
        : [...selectedIds, id],
    );
  };

  if (loading) {
    return <TableSkeleton columns={columns.length + (selectable ? 1 : 0)} />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle ?? t('common.noResults')}
        hint={emptyHint ?? t('common.noResultsHint')}
        action={emptyAction}
      />
    );
  }

  return (
    <>
      <div className="table-responsive">
        <table
          className={`table align-middle mb-0 ${compact ? 'table-sm' : ''} ${
            onRowClick ? 'table-hover' : ''
          }`}
        >
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t('common.selectAll')}
                  />
                </th>
              )}
              {columns.map((column) => {
                const sortable = column.sortable && onSort;
                const isSorted = sortBy === column.key;
                return (
                  <th
                    key={column.key}
                    style={column.width ? { width: column.width } : undefined}
                    className={sortable ? 'user-select-none' : undefined}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 text-decoration-none text-body fw-semibold"
                        onClick={() =>
                          onSort(
                            column.key,
                            isSorted && sortOrder === 'asc' ? 'desc' : 'asc',
                          )
                        }
                      >
                        {column.header}
                        {isSorted && (
                          <i
                            className={`bi bi-caret-${
                              sortOrder === 'asc' ? 'up' : 'down'
                            }-fill ms-1 small`}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const id = row[keyField];
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                  className={selectedIds.includes(id) ? 'table-active' : undefined}
                >
                  {selectable && (
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={selectedIds.includes(id)}
                        onChange={() => toggleOne(id)}
                        aria-label={`select ${id}`}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.key} className={column.className}>
                      {column.render
                        ? column.render(row)
                        : (row[column.key] ?? (
                            <span className="text-body-tertiary">
                              {t('common.notSet')}
                            </span>
                          ))}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {meta && onPageChange && <Pagination meta={meta} onPageChange={onPageChange} />}
    </>
  );
}
