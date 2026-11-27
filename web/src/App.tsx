import { WifiOff } from 'lucide-react';
import { Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { AppLockProvider } from './components/AppLock.tsx';
import { AppShell } from './components/AppShell.tsx';
import { Button, ErrorBanner, FullScreenSpinner } from './components/ui.tsx';
import { useAuth } from './lib/auth.tsx';
import { BookProvider, useBook } from './lib/book.tsx';
// Overview is where the app opens, so it ships in the main bundle; every other screen loads on demand.
import { HomePage } from './pages/HomePage.tsx';
import {
  AccountsPage,
  BalancesPage,
  BudgetEditPage,
  BudgetPage,
  CategoriesPage,
  DeletedPage,
  HelpPage,
  ImportPage,
  InvitePage,
  LoginPage,
  MembersPage,
  MorePage,
  RecoverPage,
  RecoveryCodesScreen,
  RecurringPage,
  ReportsPage,
  ResetLinkPage,
  SetupPage,
  TransactionsPage,
} from './pages/lazy.ts';

/** Full-screen loading while a signed-out screen's code downloads. */
const Lazy = ({ children }: { children: ReactNode }) => <Suspense fallback={<FullScreenSpinner />}>{children}</Suspense>;

export function App() {
  const { status, recoveryCodes, dismissRecoveryCodes, retry } = useAuth();

  if (status === 'loading') return <FullScreenSpinner />;

  if (status === 'offline') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <WifiOff className="size-7 text-muted" strokeWidth={1.75} />
        <p className="font-medium">Can't reach the server</p>
        <p className="text-label text-muted">Check your internet connection and try again.</p>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  }

  if (status === 'setup') {
    return (
      <Routes>
        <Route path="*" element={<Lazy><SetupPage /></Lazy>} />
      </Routes>
    );
  }

  if (status === 'signedOut') {
    return (
      <Lazy>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/recover" element={<RecoverPage />} />
          <Route path="/reset/:token" element={<ResetLinkPage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Lazy>
    );
  }

  if (recoveryCodes) {
    return (
      <Lazy>
        <RecoveryCodesScreen codes={recoveryCodes} onDone={dismissRecoveryCodes} />
      </Lazy>
    );
  }

  return (
    <AppLockProvider>
      <BookProvider>
        <Routes>
          <Route path="/invite/:token" element={<Lazy><InvitePage /></Lazy>} />
          <Route path="/reset/:token" element={<Lazy><ResetLinkPage /></Lazy>} />
          <Route element={<BookGate />}>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
              <Route path="transactions" element={<TransactionsPage />} />
              <Route path="transactions/deleted" element={<DeletedPage />} />
              <Route path="budget" element={<BudgetPage />} />
              <Route path="budget/:month/edit" element={<BudgetEditPage />} />
              <Route path="members" element={<MembersPage />} />
              <Route path="more" element={<MorePage />} />
              <Route path="categories" element={<CategoriesPage />} />
              <Route path="recurring" element={<RecurringPage />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="users" element={<AccountsPage />} />
              <Route path="accounts" element={<BalancesPage />} />
              <Route path="help" element={<HelpPage />} />
              <Route path="reports" element={<ReportsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BookProvider>
    </AppLockProvider>
  );
}

/** Waits for the book list so every in-app screen can assume a current book. */
function BookGate() {
  const { book, isLoading, error } = useBook();
  if (isLoading) return <FullScreenSpinner />;
  if (!book) {
    return (
      <div className="mx-auto max-w-sm p-6 pt-20">
        <ErrorBanner error={error ?? new Error('No books found for your account.')} />
      </div>
    );
  }
  return <Outlet />;
}
