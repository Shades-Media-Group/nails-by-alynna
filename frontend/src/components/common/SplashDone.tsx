import { useEffect } from 'react';
import { hideSplash } from '@/components/brand/splash';

/** Rendered inside the first committed screen: that's when the splash may leave. */
export function SplashDone() {
  useEffect(() => hideSplash(), []);
  return null;
}
