export interface SplashScreen {
  w: number;
  h: number;
  dpr: number;
}
export interface LaunchScreen extends SplashScreen {
  orientation: 'portrait' | 'landscape';
}
export interface Size {
  width: number;
  height: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export declare const BRAND_BACKGROUND: string;
export declare const SPLASH_SCREENS: ReadonlyArray<SplashScreen>;
export declare const LAUNCH_SCREENS: ReadonlyArray<LaunchScreen>;
export declare function launchScreenSize(screen: LaunchScreen): Size;
export declare function splashFileName(screen: LaunchScreen): string;
export declare function splashLinkTags(): string;
export declare const SPLASH_LOGO: { width: number; maxWidth: number; maxHeight: number };
export declare function splashLogoRect(screen: Size, box: Box): { x: number; y: number } & Size;
export declare function generateBrandAssets(options?: {
  force?: boolean;
  log?: (message: string) => void;
}): Promise<{ skipped: boolean }>;
