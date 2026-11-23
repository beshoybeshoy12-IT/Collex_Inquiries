import { useEffect, useRef, useState } from 'react';

/**
 * A dropdown that does not need Bootstrap's JavaScript.
 *
 * Same reasoning as `Modal`: Bootstrap's CSS gives the appearance, and its JS
 * bundle exists mostly to do what the handful of lines below do — at the cost
 * of shipping Popper and the rest of its plumbing for a menu.
 *
 * `dropdown-menu-end` aligns the panel to the trailing edge, which Bootstrap's
 * RTL build flips for us, so the menu opens inward in both directions rather
 * than off the side of the viewport.
 */
export default function Dropdown({
  label,
  icon,
  children,
  align = 'end',
  className = '',
  buttonClassName = 'btn btn-sm btn-outline-secondary dropdown-toggle',
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={`dropdown ${className}`} ref={containerRef}>
      <button
        className={buttonClassName}
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {icon && <i className={`bi bi-${icon} me-1`} aria-hidden="true" />}
        {label}
      </button>

      {open && (
        <ul
          className={`dropdown-menu dropdown-menu-${align} show`}
          role="menu"
          style={{
            position: 'absolute',
            insetInlineEnd: align === 'end' ? 0 : undefined,
            marginTop: '0.4rem',
            minWidth: '12rem',
          }}
          onClick={() => setOpen(false)}
        >
          {children}
        </ul>
      )}
    </div>
  );
}
