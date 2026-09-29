import { WifiOff } from 'lucide-react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { AppLockProvider } from './components/AppLock.tsx';
import { AppShell } from './components/AppShell.tsx';
import { Button, ErrorBanner, FullScreenSpinner } from './components/ui.tsx';
import { useAuth } from './lib/auth.tsx';
import { BookProvider, useBook } from './lib/book.tsx';
import { LoginPage, RecoverPage, RecoveryCodesScreen, SetupPage } from './pages/AuthPages.tsx';
import { BudgetEditPage } from './pages/BudgetEditPage.tsx';
import { BudgetPage } from './pages/BudgetPage.tsx';
import { CategoriesPage } from './pages/CategoriesPage.tsx';
import { DeletedPage } from './pages/DeletedPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { InvitePage } from './pages/InvitePage.tsx';
import { MembersPage } from './pages/MembersPage.tsx';
import { MorePage } from './pages/MorePage.tsx';
import { RecurringPage } from './pages/RecurringPage.tsx';
import { TransactionsPage } from './pages/TransactionsPage.tsx';

export function App() {
  const { status, recoveryCodes, dismissRecoveryCodes, retry } = useAuth();

  if (status === 'loading') return <FullScreenSpinner />;

  if (status === 'offline') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <WifiOff className="size-7 text-muted" strokeWidth={1.75} />
        <p className="font-medium">Can't reach the server</p>
        <p className="text-sm text-muted">Check your internet connection and try again.</p>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  }

  if (status === 'setup') {
    return (
      <Routes>
        <Route path="*" element={<SetupPage />} />
      </Routes>
    );
  }

  if (status === 'signedOut') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/recover" element={<RecoverPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (recoveryCodes) return <RecoveryCodesScreen codes={recoveryCodes} onDone={dismissRecoveryCodes} />;

  return (
    <AppLockProvider>
      <BookProvider>
        <Routes>
          <Route path="/invite/:token" element={<InvitePage />} />
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
