/**
 * The "nothing here" state.
 *
 * Deliberately distinct from the loading skeleton and from the error state.
 * A list that renders identically whether it is loading, broken, or genuinely
 * empty is the single most common way an application feels unreliable — the
 * user cannot tell whether to wait, retry, or act.
 */
export default function EmptyState({ title, hint, action, icon = 'inbox' }) {
  return (
    <div className="text-center py-5 px-3">
      <i
        className={`bi bi-${icon} text-body-tertiary`}
        style={{ fontSize: '2.5rem' }}
        aria-hidden="true"
      />
      <p className="fw-semibold mt-3 mb-1">{title}</p>
      {hint && <p className="text-body-secondary small mb-3">{hint}</p>}
      {action}
    </div>
  );
}
