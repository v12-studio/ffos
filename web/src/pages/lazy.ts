import { lazy, type ComponentType } from 'react';

// Each screen is its own chunk, so opening the app only downloads the screen being shown.
// `preload()` fetches a chunk ahead of time (nav hover, idle time) without loading any data.

type Preloadable<P> = ComponentType<P> & { preload: () => Promise<unknown> };

function page<M, K extends keyof M>(load: () => Promise<M>, name: K): Preloadable<M[K] extends ComponentType<infer P> ? P : never> {
  let promise: Promise<M> | undefined;
  const preload = () => (promise ??= load().catch((err) => {
    promise = undefined; // let a later attempt retry (e.g. after a network blip)
    throw err;
  }));
  const Component = lazy(async () => ({ default: (await preload())[name] as ComponentType<any> }));
  return Object.assign(Component, { preload }) as never;
}

export const TransactionsPage = page(() => import('./TransactionsPage.tsx'), 'TransactionsPage');
export const DeletedPage = page(() => import('./DeletedPage.tsx'), 'DeletedPage');
export const BudgetPage = page(() => import('./BudgetPage.tsx'), 'BudgetPage');
export const BudgetEditPage = page(() => import('./BudgetEditPage.tsx'), 'BudgetEditPage');
export const MembersPage = page(() => import('./MembersPage.tsx'), 'MembersPage');
export const MorePage = page(() => import('./MorePage.tsx'), 'MorePage');
export const CategoriesPage = page(() => import('./CategoriesPage.tsx'), 'CategoriesPage');
export const RecurringPage = page(() => import('./RecurringPage.tsx'), 'RecurringPage');
export const InvitePage = page(() => import('./InvitePage.tsx'), 'InvitePage');
export const LoginPage = page(() => import('./AuthPages.tsx'), 'LoginPage');
export const RecoverPage = page(() => import('./AuthPages.tsx'), 'RecoverPage');
export const SetupPage = page(() => import('./AuthPages.tsx'), 'SetupPage');
export const RecoveryCodesScreen = page(() => import('./AuthPages.tsx'), 'RecoveryCodesScreen');
export const ResetLinkPage = page(() => import('./AuthPages.tsx'), 'ResetLinkPage');
export const ImportPage = page(() => import('./ImportPage.tsx'), 'ImportPage');
export const AccountsPage = page(() => import('./AccountsPage.tsx'), 'AccountsPage');
export const BalancesPage = page(() => import('./BalancesPage.tsx'), 'BalancesPage');
export const HelpPage = page(() => import('./HelpPage.tsx'), 'HelpPage');
export const ReportsPage = page(() => import('./ReportsPage.tsx'), 'ReportsPage');

/** Chunk preloaders for the tab-bar / sidebar destinations, keyed by path. */
export const preloadRoute: Record<string, () => Promise<unknown>> = {
  '/transactions': TransactionsPage.preload,
  '/budget': BudgetPage.preload,
  '/reports': ReportsPage.preload,
  '/members': MembersPage.preload,
  '/more': MorePage.preload,
};

/** After the first screen is up, fetch the main tabs' code in idle time so switching tabs never waits. */
export function preloadTabsWhenIdle() {
  const run = () => Object.values(preloadRoute).forEach((p) => void p().catch(() => undefined));
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2000);
}
