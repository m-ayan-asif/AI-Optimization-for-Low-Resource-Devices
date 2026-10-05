import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudOff, UploadCloud } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

// Shows when the device is offline or has on-device screenings waiting, and uploads them as soon as it can.
export default function OfflineStatus() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (typeof indexedDB === 'undefined') return undefined;
    let cancelled = false;
    async function refresh({ sync = true } = {}) {
      try {
        const outbox = await import('../../ondevice/outbox');
        if (sync && navigator.onLine && isAuthenticated) await outbox.syncOutbox();
        const n = await outbox.pendingCount();
        if (!cancelled) setPending(n);
      } catch {
        // IndexedDB unavailable (private mode): nothing is queued on this device
      }
    }
    const goOnline = () => {
      setOnline(true);
      refresh();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // A screening was saved: update the count only. The screening page uploads it itself; syncing here could send
    // the same record twice.
    const recount = () => refresh({ sync: false });
    window.addEventListener('skinsense-outbox-changed', recount);
    refresh();
    const timer = setInterval(() => refresh(), 60000);
    return () => {
      cancelled = true;
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('skinsense-outbox-changed', recount);
      clearInterval(timer);
    };
  }, [isAuthenticated]);

  if (online && pending === 0) return null;
  return (
    <div className="bg-wash border-b border-line" role="status">
      <div className="max-w-6xl mx-auto px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-ink-800">
        {!online && (
          <span className="flex items-center gap-1.5">
            <CloudOff size={14} /> {t('offline.banner')}
          </span>
        )}
        {pending > 0 && (
          <span className="flex items-center gap-1.5 font-semibold">
            <UploadCloud size={14} /> {t('offline.pending', { count: pending })}
          </span>
        )}
      </div>
    </div>
  );
}
