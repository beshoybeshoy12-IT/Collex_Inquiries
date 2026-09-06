import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

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
          className="position-fixed p-3"
          style={{
            // Logical properties, so the stack sits on the trailing edge in
            // both directions rather than always on the physical right.
            insetInlineEnd: 0,
            insetBlockStart: 0,
            zIndex: 1080,
            maxWidth: 'min(420px, 92vw)',
          }}
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast show mb-2 text-bg-${toast.tone} border-0`}
              role={toast.tone === 'danger' ? 'alert' : 'status'}
            >
              <div className="d-flex">
                <div className="toast-body">
                  {toast.title && <strong className="d-block">{toast.title}</strong>}
                  <span style={{ whiteSpace: 'pre-line' }}>{toast.message}</span>
                </div>
                <button
                  type="button"
                  className="btn-close btn-close-white m-2 m-auto"
                  onClick={() => dismiss(toast.id)}
                  aria-label="close"
                />
              </div>
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
