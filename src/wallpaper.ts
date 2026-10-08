export type WallpaperId = 'phone' | 'laptop' | '4k' | 'ultra' | 'square' | 'custom';

export interface WallpaperTarget {
  id: WallpaperId;
  label: string;
  w: number;
  h: number;
}

export const WALLPAPERS: readonly WallpaperTarget[] = [
  { id: 'phone', label: 'PHONE', w: 1290, h: 2796 },
  { id: 'laptop', label: 'LAPTOP', w: 2560, h: 1600 },
  { id: '4k', label: '4K', w: 3840, h: 2160 },
  { id: 'ultra', label: 'ULTRA', w: 5120, h: 2160 },
  { id: 'square', label: 'SQUARE', w: 2048, h: 2048 },
];

export const CUSTOM_MIN = 16;
export const CUSTOM_MAX = 16384;

export interface CustomSize {
  w: number;
  h: number;
}

export const DEFAULT_CUSTOM: CustomSize = { w: 2560, h: 1440 };

/** Integer clamped to [CUSTOM_MIN, CUSTOM_MAX]; NaN falls back to `fallback`. */
export const clampSide = (v: number, fallback: number): number =>
  Number.isFinite(v) ? Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, Math.round(v))) : fallback;

/** Validates stored data like parseWallpaper: anything malformed becomes the default size. */
export function parseCustomSize(v: unknown): CustomSize {
  const o = (v && typeof v === 'object' ? v : {}) as { w?: unknown; h?: unknown };
  const side = (x: unknown, d: number) => (typeof x === 'number' ? clampSide(x, d) : d);
  return { w: side(o.w, DEFAULT_CUSTOM.w), h: side(o.h, DEFAULT_CUSTOM.h) };
}

export const DEFAULT_WALLPAPER: WallpaperId = '4k';

export const parseWallpaper = (v: unknown): WallpaperId =>
  v === 'custom' ? 'custom' : (WALLPAPERS.find((t) => t.id === v)?.id ?? DEFAULT_WALLPAPER);

export const wallpaperTarget = (id: WallpaperId, custom: CustomSize = DEFAULT_CUSTOM): WallpaperTarget =>
  id === 'custom'
    ? { id, label: 'CUSTOM', w: custom.w, h: custom.h }
    : (WALLPAPERS.find((t) => t.id === id) ?? WALLPAPERS[2]);

export const wallpaperSize = (t: WallpaperTarget): string => `${t.w}×${t.h}`;

/** GH-CS01-4K-3840x2160-2041[-n].png */
export function wallpaperFilename(serial: string, t: WallpaperTarget, stamp: string, n: number): string {
  return `GH-${serial}-${t.id.toUpperCase()}-${t.w}x${t.h}-${stamp}${n > 1 ? `-${n}` : ''}.png`;
}
