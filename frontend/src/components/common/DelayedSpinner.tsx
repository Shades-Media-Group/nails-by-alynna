import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui';

/** Suspense fallback that only appears if loading takes noticeably long (no flash). */
export function DelayedSpinner({ delay = 350 }: { delay?: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);
  if (!visible) return null;
  return (
    <div className="fixed inset-0 grid place-items-center text-rose-500">
      <Spinner className="size-7" label="…" />
    </div>
  );
}
