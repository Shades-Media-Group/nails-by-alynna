import { useSyncExternalStore } from 'react';

/**
 * Captures Chromium's `beforeinstallprompt` as early as possible (imported by main.tsx), so the
 * /app page can show a real "Install" button whenever the browser offers one.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface InstallState {
  canPrompt: boolean;
  installed: boolean;
}
let snapshot: InstallState = { canPrompt: false, installed: false };
function getSnapshot(): InstallState {
  const next = { canPrompt: deferred !== null, installed };
  if (next.canPrompt !== snapshot.canPrompt || next.installed !== snapshot.installed) snapshot = next;
  return snapshot;
}

export function useInstallPrompt() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const prompt = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferred) return 'unavailable';
    const event = deferred;
    deferred = null;
    emit();
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === 'accepted') {
      installed = true;
      emit();
    }
    return choice.outcome;
  };
  return { ...state, prompt };
}
