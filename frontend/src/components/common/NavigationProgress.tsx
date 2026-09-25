import { useEffect, useState } from 'react';
import { useNavigation } from 'react-router';
import { cx } from '@/lib/cx';

/**
 * Thin brand-pink bar at the top while the next screen loads (lazy code or data). It waits
 * 150 ms before showing, so fast navigations never flash it.
 */
export function NavigationProgress() {
  const busy = useNavigation().state !== 'idle';
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => setWaited(true), 150);
    return () => {
      window.clearTimeout(timer);
      setWaited(false);
    };
  }, [busy]);

  const visible = busy && waited;
  return (
    <div
      aria-hidden="true"
      className={cx(
        'pointer-events-none fixed inset-x-0 top-0 z-[70] h-[3px] overflow-hidden transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {visible ? <div className="h-full w-full origin-left animate-progress rounded-r-pill bg-rose-500" /> : null}
    </div>
  );
}
