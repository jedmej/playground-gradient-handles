export type WallpaperId = 'phone' | 'laptop' | '4k' | 'ultra' | 'square';

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

export const DEFAULT_WALLPAPER: WallpaperId = '4k';

export const parseWallpaper = (v: unknown): WallpaperId =>
  WALLPAPERS.find((t) => t.id === v)?.id ?? DEFAULT_WALLPAPER;

export const wallpaperTarget = (id: WallpaperId): WallpaperTarget =>
  WALLPAPERS.find((t) => t.id === id) ?? WALLPAPERS[2];

export const wallpaperSize = (t: WallpaperTarget): string => `${t.w}×${t.h}`;

/** GH-CS01-4K-3840x2160-2041[-n].png */
export function wallpaperFilename(serial: string, t: WallpaperTarget, stamp: string, n: number): string {
  return `GH-${serial}-${t.id.toUpperCase()}-${t.w}x${t.h}-${stamp}${n > 1 ? `-${n}` : ''}.png`;
}
