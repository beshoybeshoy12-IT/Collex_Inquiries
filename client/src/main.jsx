import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n first: it sets `lang` and `dir` on <html> and loads the matching
// Bootstrap build before React renders, so the first paint is already in the
// right direction. A page that renders left-to-right and then flips is
// visibly broken for the moment it takes.
import './i18n';

import 'bootstrap-icons/font/bootstrap-icons.css';
import './assets/styles/app.css';

import App from './app/App';
import { AuthProvider } from './app/AuthContext';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';

/**
 * Server state lives in React Query; local UI state lives in components.
 *
 * There is no global store, deliberately. Almost everything on these screens
 * is server state — cases, customers, investigators — and putting that in a
 * client store means writing cache invalidation by hand and getting it wrong.
 * What genuinely is client state (which modal is open, which row is selected)
 * belongs to the component that owns it.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Coordinators keep this open all day and switch windows constantly;
      // refetching on every focus would put a query storm on the API for data
      // that has usually not changed.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Retrying a 401, 403 or 404 cannot succeed — the answer will not
        // change — and it delays showing the user what went wrong.
        const status = error?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      // A failed mutation is shown to the user, who decides whether to retry.
      // Retrying automatically would double-submit anything not idempotent.
      retry: false,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
