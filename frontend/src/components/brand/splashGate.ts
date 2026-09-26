import { STORAGE_KEYS } from '../../lib/storageKeys.ts';

/**
 * Inline <head> script, added to index.html by vite.config.ts (which also puts its hash in the
 * CSP). It runs before the first paint and does two things:
 *
 * - It marks <html data-splash="skip"> when the page comes back within the same session: an
 *   update applied while the app was in the background, iOS reopening a paused app, "Try again".
 *   The splash then only plays when the app starts; a new session (the app was closed) starts
 *   with an empty sessionStorage and a "navigate" load.
 * - In the iOS Home Screen app it lines the splash logo up with the launch image. iOS shows the
 *   launch image (apple-touch-startup-image) on the whole screen, logo centred, but lays the page
 *   out below the status bar, so a logo centred in the page sat half a status bar lower (31 pt on
 *   an iPhone 17 Pro, 23.5 on an iPhone 17e). It measures that gap (the screen's height minus the
 *   page's) into --splash-status-bar, and index.html moves the logo up by half of it. No status
 *   bar (an iPhone in landscape), no gap, nothing to do.
 */
export const SPLASH_GATE_SCRIPT =
  'try{' +
  "var d=document.documentElement,n=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];" +
  `if(sessionStorage.getItem('${STORAGE_KEYS.splashSeen}')||(n&&(n.type==='reload'||n.type==='back_forward'))){` +
  "d.setAttribute('data-splash','skip');" +
  "var m=document.querySelector('meta[name=\"theme-color\"]');if(m)m.setAttribute('content','#ffffff')" +
  '}else if(navigator.standalone){' +
  // The screen's height in the current orientation (iOS reports screen.width/height for portrait).
  'var s=screen,g=(innerWidth>innerHeight?Math.min(s.width,s.height):Math.max(s.width,s.height))-innerHeight;' +
  // A status bar is well under 100 pt; anything else (an iPad app in a window) is left alone.
  "if(g>0&&g<100)d.style.setProperty('--splash-status-bar',g+'px')" +
  '}}catch(e){}';
