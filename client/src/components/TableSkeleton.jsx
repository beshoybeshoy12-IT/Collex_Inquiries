/**
 * A loading placeholder shaped like the table it replaces.
 *
 * Matching the real layout keeps the page from jumping when the data lands,
 * which is the whole point of a skeleton over a spinner.
 */
export default function TableSkeleton({ columns = 5, rows = 6 }) {
  return (
    <div className="table-responsive" aria-busy="true" aria-live="polite">
      <table className="table align-middle mb-0">
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: columns }).map((__, columnIndex) => (
                <td key={columnIndex}>
                  <span
                    className="placeholder col-12 rounded"
                    style={{ height: '0.9rem', display: 'block' }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="visually-hidden">Loading</span>
    </div>
  );
}
