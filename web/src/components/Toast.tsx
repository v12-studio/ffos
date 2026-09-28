import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ToastOptions {
  message: string;
  action?: { label: string; onClick: () => void | Promise<void> };
  /** ms before it disappears (default 6s, long enough to reach Undo). */
  duration?: number;
}

interface ToastState extends ToastOptions {
  id: number;
}

const ToastContext = createContext<(t: ToastOptions) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

/** One toast at a time, above the bottom tab bar; a new toast replaces the current one. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((t: ToastOptions) => {
    setBusy(false);
    setToast({ ...t, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), toast.duration ?? 6000);
    return () => clearTimeout(timer.current);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 lg:bottom-6">
        {toast && (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl bg-primary py-2.5 pr-2 pl-4 text-sm text-primary-fg shadow-lg"
          >
            <span className="min-w-0 flex-1">{toast.message}</span>
            {toast.action && (
              <button
                disabled={busy}
                onClick={async () => {
                  const { id } = toast;
                  setBusy(true);
                  try {
                    await toast.action!.onClick();
                    // Close this toast, unless the action already showed a newer one.
                    setToast((current) => (current?.id === id ? null : current));
                  } finally {
                    setBusy(false);
                  }
                }}
                className="min-h-9 shrink-0 rounded-lg px-3 font-semibold hover:bg-primary-fg/10 disabled:opacity-60"
              >
                {busy ? 'Working…' : toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
