import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { App } from './App.tsx';
import { ConfirmProvider } from './components/Confirm.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { ApiError } from './lib/api.ts';
import { AuthProvider } from './lib/auth.tsx';
import { persistQueries, restoreQueries } from './lib/persist.ts';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Keep screens you've visited in memory (and in the persisted cache) so going back is instant.
      gcTime: 24 * 3600_000,
      // Don't retry permission / not-found errors; do retry flaky network.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

// Paint from the last session's data immediately; queries refetch in the background.
restoreQueries(queryClient);
persistQueries(queryClient);

// HashRouter: GitHub Pages can't rewrite deep links to index.html.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
