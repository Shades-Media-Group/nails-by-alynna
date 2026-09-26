import { STORAGE_KEYS } from '../../lib/storageKeys.ts';

/**
 * Inline <head> script, added to index.html by vite.config.ts (which also puts its hash in the
 * CSP). It runs before the first paint and marks <html data-splash="skip"> when the page comes
 * back within the same session: an update applied while the app was in the background, iOS
 * reopening a paused app, "Try again". The splash then only plays when the app starts; a new
 * session (the app was closed) starts with an empty sessionStorage and a "navigate" load.
 */
export const SPLASH_GATE_SCRIPT =
  'try{' +
  "var n=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];" +
  `if(sessionStorage.getItem('${STORAGE_KEYS.splashSeen}')||(n&&(n.type==='reload'||n.type==='back_forward'))){` +
  "document.documentElement.setAttribute('data-splash','skip');" +
  "var m=document.querySelector('meta[name=\"theme-color\"]');if(m)m.setAttribute('content','#ffffff')" +
  '}}catch(e){}';
