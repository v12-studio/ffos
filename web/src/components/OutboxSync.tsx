import { useQueryClient } from '@tanstack/react-query';
import { CloudOff, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { flushOutbox, useOutbox } from '../lib/offline.ts';
import { useToast } from './Toast.tsx';

/**
 * Sends entries saved offline as soon as the connection is back (on load, when the browser
 * reports it's online, and every 30s while any are waiting), and shows how many are waiting.
 */
export function OutboxSync() {
  const items = useOutbox();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const pending = items.length;

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const { sent, failed } = await flushOutbox();
      if (sent) {
        queryClient.invalidateQueries({ queryKey: ['book'] });
        toast({ message: `Synced ${sent} entr${sent === 1 ? 'y' : 'ies'} saved offline`, duration: 3000 });
      }
      if (failed.length) {
        toast({ message: `${failed.length} offline entr${failed.length === 1 ? 'y was' : 'ies were'} rejected: ${failed[0]!.message}` });
      }
    } finally {
      setSyncing(false);
    }
  }, [queryClient, toast]);

  useEffect(() => {
    if (!pending) return;
    if (navigator.onLine) void sync();
    const onOnline = () => void sync();
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => navigator.onLine && void sync(), 30_000);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
    // Re-arm only when the queue goes from empty to non-empty (or back).
  }, [pending > 0, sync]);

  if (!pending) return null;
  return (
    <div role="status" className="mb-5 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
      <CloudOff className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {pending} entr{pending === 1 ? 'y' : 'ies'} saved on this device, waiting to sync
      </span>
      <button
        onClick={() => void sync()}
        disabled={syncing}
        className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 font-medium hover:bg-warning/10 disabled:opacity-60"
      >
        <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />
        {syncing ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  );
}
