/**
 * The heading every page opens with.
 *
 * One component so the title, subtitle and action buttons sit in the same place
 * on every screen — the actions land on the trailing edge, which Bootstrap's
 * flex utilities flip correctly between Arabic and English.
 */
export default function PageHeader({ title, subtitle, actions, breadcrumb }) {
  return (
    <div className="page-header">
      <div className="min-vw-0">
        {breadcrumb && <div className="mb-1">{breadcrumb}</div>}
        <h1 className="truncate">{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="d-flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A labelled value, for the definition-list style used on detail screens. */
export function Field({ label, children, className = '' }) {
  return (
    <div className={`mb-2 ${className}`}>
      <div className="small text-body-secondary">{label}</div>
      <div className="fw-medium" style={{ wordBreak: 'break-word' }}>
        {children ?? <span className="text-body-tertiary">—</span>}
      </div>
    </div>
  );
}

/** A bordered panel with an optional heading and actions. */
export function Panel({ title, actions, children, className = '', bodyClassName = '' }) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-header bg-body d-flex align-items-center justify-content-between gap-2 py-2">
          <span className="fw-semibold small">{title}</span>
          {actions}
        </div>
      )}
      <div className={`card-body ${bodyClassName}`}>{children}</div>
    </div>
  );
}
