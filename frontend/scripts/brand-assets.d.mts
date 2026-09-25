export declare const BRAND_BACKGROUND: string;
export declare const SPLASH_SCREENS: ReadonlyArray<{ w: number; h: number; dpr: number }>;
export declare function splashFileName(screen: { w: number; h: number; dpr: number }): string;
export declare function splashLinkTags(): string;
export declare function generateBrandAssets(options?: {
  force?: boolean;
  log?: (message: string) => void;
}): Promise<{ skipped: boolean }>;
