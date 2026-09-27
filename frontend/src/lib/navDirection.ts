/**
 * Which way a tab switch goes, for the page transition (styles/index.css): "forward" to a tab
 * further along the bar, "back" to one before it. Set just before the navigation starts.
 */
export function setNavDirection(from: number, to: number): void {
  document.documentElement.dataset.navDir = to < from ? 'back' : 'forward';
}

/**
 * A view transition the browser skips (the page hidden, a second tap starting another one)
 * rejects its `ready` promise; the navigation itself still happens, so there is nothing to
 * report. Wraps startViewTransition once so those rejections don't reach the console.
 */
export function quietSkippedTransitions(): void {
  const start = document.startViewTransition?.bind(document);
  if (!start) return;
  document.startViewTransition = ((update?: ViewTransitionUpdateCallback) => {
    const transition = start(update);
    transition.ready.catch(() => undefined);
    return transition;
  }) as typeof document.startViewTransition;
}
