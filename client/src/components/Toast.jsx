import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import i18n from '../i18n';

const TONE_ICON = {
  success: 'check-circle-fill',
  danger: 'exclamation-octagon-fill',
  warning: 'exclamation-triangle-fill',
  info: 'info-circle-fill',
};

/**
 * Transient feedback.
 *
 * Two rules that make the difference between useful and irritating:
 *
 *  - A SUCCESS TOAST DISMISSES ITSELF; AN ERROR DOES NOT. Somebody who missed
 *    "saved" loses nothing, while somebody who missed "assignment failed:
 *    investigator is at capacity" has lost the only explanation they were
 *    going to get.
 *
 *  - Toasts are never the only place an error appears. Anything the user must
 *    act on is also rendered in place, next to the thing that failed.
 *
 * Positioned with `inset-inline-end`, so it sits on the correct side in both
 * Arabic and English rather than being pinned to the physical right.
 */

const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast) => {
      const id = nextId++;
      const entry = { id, tone: 'success', ...toast };
      setToasts((current) => [...current, entry]);

      // Errors stay until dismissed; everything else clears itself.
      if (entry.tone !== 'danger') {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), entry.duration ?? 4000),
        );
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      push,
      dismiss,
      success: (message, title) => push({ tone: 'success', message, title }),
      error: (messageOrError, title) =>
        push({
          tone: 'danger',
          title,
          message:
            typeof messageOrError === 'string'
              ? messageOrError
              : (messageOrError?.friendlyMessage ?? String(messageOrError)),
        }),
      info: (message, title) => push({ tone: 'info', message, title }),
      warning: (message, title) => push({ tone: 'warning', message, title }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          className="position-fixed p-3 d-flex flex-column gap-2"
          style={{
            // Logical properties, so the stack sits on the trailing edge in
            // both directions rather than always on the physical right.
            insetInlineEnd: 0,
            // Below the header, not over it: the stack sits on the same corner
            // as the account menu, and even empty its padding covered the top
            // of that button — clicks there "sometimes" did nothing.
            insetBlockStart: 'var(--ci-header-height, 64px)',
            zIndex: 1080,
            width: 'min(380px, 92vw)',
            // The stack itself never takes a click; only the toasts in it do.
            pointerEvents: 'none',
          }}
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`ci-toast ci-toast-${toast.tone}`}
              style={{ pointerEvents: 'auto' }}
              role={toast.tone === 'danger' ? 'alert' : 'status'}
            >
              <span className="ci-toast__icon" aria-hidden="true">
                <i className={`bi bi-${TONE_ICON[toast.tone] ?? 'info-circle-fill'}`} />
              </span>
              <div className="ci-toast__text">
                {toast.title && <strong className="ci-toast__title">{toast.title}</strong>}
                <span className="ci-toast__message">{toast.message}</span>
              </div>
              <button
                type="button"
                className="ci-toast__close"
                onClick={() => dismiss(toast.id)}
                aria-label={i18n.t('common.close', 'Close')}
                title={i18n.t('common.close', 'Close')}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
              {/* How long until it closes itself. Errors stay, so no bar. */}
              {toast.tone !== 'danger' && (
                <span
                  className="ci-toast__timer"
                  style={{ animationDuration: `${toast.duration ?? 4000}ms` }}
                  aria-hidden="true"
                />
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
