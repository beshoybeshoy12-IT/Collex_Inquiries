import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * A modal, without pulling in Bootstrap's JavaScript.
 *
 * Bootstrap's CSS is enough for the appearance; its JS bundle exists mostly to
 * do what the twenty lines below do, and importing it means shipping jQuery-era
 * plumbing plus Popper for one dialog.
 *
 * What it does handle, because a dialog that skips these is genuinely
 * unusable:
 *
 *  - Escape closes it.
 *  - Focus moves into the dialog on open and returns to the trigger on close,
 *    so a keyboard user is not dropped at the top of the page.
 *  - Focus is trapped while it is open — Tab out of the last control wraps to
 *    the first rather than wandering into the page behind.
 *  - The body stops scrolling underneath.
 *  - A click on the backdrop closes, a click inside does not.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = '',
  closeOnBackdrop = true,
  busy = false,
}) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    // Focus the first control, or the dialog itself when it has none.
    const focusable = () =>
      dialogRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      ) ?? [];

    const first = focusable()[0];
    (first ?? dialogRef.current)?.focus?.();

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) {
        event.stopPropagation();
        onClose?.();
        return;
      }

      if (event.key !== 'Tab') return;

      const items = [...focusable()];
      if (items.length === 0) return;

      const firstItem = items[0];
      const lastItem = items[items.length - 1];

      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose, busy]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal d-block"
      style={{ background: 'rgba(0,0,0,.5)' }}
      role="presentation"
      onMouseDown={(event) => {
        // `mousedown` on the backdrop, not `click`: a click fires when a drag
        // that started inside the dialog ends outside it, which would close a
        // dialog the user was selecting text in.
        if (closeOnBackdrop && !busy && event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div className={`modal-dialog modal-dialog-centered ${size}`} role="document">
        <div
          className="modal-content"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : undefined}
          tabIndex={-1}
        >
          <div className="modal-header">
            <h5 className="modal-title">{title}</h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              disabled={busy}
              aria-label={t('common.close')}
            />
          </div>

          <div className="modal-body">{children}</div>

          {footer && <div className="modal-footer">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A yes/no dialog.
 *
 * `danger` is the default tone because virtually every confirmation in this
 * application is about something destructive — cancelling a case, deleting
 * evidence, disabling an account. A confirmation that looks routine gets
 * clicked through.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  tone = 'danger',
  busy = false,
}) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? t('common.confirm')}
      busy={busy}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onClose}
            disabled={busy}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`btn btn-${tone}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && (
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
            )}
            {confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <p className="mb-0" style={{ whiteSpace: 'pre-line' }}>
        {message}
      </p>
    </Modal>
  );
}
