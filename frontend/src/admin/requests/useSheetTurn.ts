import { useEffect, useEffectEvent, useSyncExternalStore } from 'react';
import { isSplashGone, onSplashGone } from '@/components/brand/splash';
import { sheetInFront, subscribeSheetQueue } from '@/lib/sheetQueue';

/** The pause between one sheet sliding away and the next coming up. */
const BEAT_MS = 350;

/**
 * For a sheet that opens by itself, not from a tap: calls `onTurn` once no other dialog is open
 * (and the splash is gone), so two sheets never stack. While `request` is set it waits; when
 * the dialog on screen closes, this one comes up a beat later. `request` null = not waiting.
 *
 * Sheets that must come first (turning on notifications) wait in the shared queue
 * (lib/sheetQueue.ts), also while they are still deciding: this waits for them as well.
 */
export function useSheetTurn(request: string | null, onTurn: () => void): void {
  const splashGone = useSyncExternalStore(onSplashGone, isSplashGone, isSplashGone);
  const take = useEffectEvent(onTurn);

  useEffect(() => {
    if (request === null || !splashGone) return;
    let timer = 0;
    const busy = () => document.querySelector('dialog[open]') !== null || sheetInFront() !== null;
    const check = () => {
      if (busy()) {
        window.clearTimeout(timer);
        timer = 0;
      } else if (!timer) {
        timer = window.setTimeout(() => {
          timer = 0;
          if (busy()) return;
          observer.disconnect();
          stopQueue();
          take();
        }, BEAT_MS);
      }
    };
    // Dialogs open and close through their `open` attribute; one can also leave the page open.
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    // A sheet ahead in the queue may also leave without ever opening.
    const stopQueue = subscribeSheetQueue(check);
    check();
    return () => {
      observer.disconnect();
      stopQueue();
      window.clearTimeout(timer);
    };
  }, [request, splashGone]);
}
