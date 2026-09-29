import { AlertTriangle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Button } from './ui.tsx';

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  /** Label for the confirming button (default "Confirm"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for removing or deleting things. */
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

/** In-app replacement for `window.confirm`: `if (await confirm({ title })) …`. */
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState((current) => {
          current?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );

  const close = useCallback((ok: boolean) => {
    setState((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!state) return;
    // Capture phase, so Escape closes only this dialog and not a sheet underneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close(false);
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [state, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4" role="alertdialog" aria-modal aria-labelledby="confirm-title" aria-describedby="confirm-message">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => close(false)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl">
            <div className="flex gap-3">
              {state.danger && (
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-negative/10 text-negative" aria-hidden>
                  <AlertTriangle className="size-5" />
                </span>
              )}
              <div className="min-w-0">
                <h2 id="confirm-title" className="text-base font-semibold">
                  {state.title}
                </h2>
                {state.message && (
                  <div id="confirm-message" className="mt-1 text-sm text-muted">
                    {state.message}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {/* Focus starts on Cancel so a stray Enter never confirms. */}
              <Button variant="secondary" autoFocus onClick={() => close(false)}>
                {state.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                className={state.danger ? 'bg-negative! text-white! hover:bg-negative/90!' : ''}
                onClick={() => close(true)}
              >
                {state.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
