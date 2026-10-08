import { parseWallpaper, type WallpaperId } from './wallpaper';

export type GrainSize = 'fine' | 'coarse';
export type DitherMode = 'bayer' | 'blue';

export interface FxState {
  /** 0–100 (0 = off). */
  grain: number;
  grainSize: GrainSize;
  /** 0 = off, else levels per channel 2–16. */
  dither: number;
  ditherMode: DitherMode;
  /** 0–100 chromatic aberration. */
  chroma: number;
  /** 0–100 scanline intensity. */
  scan: number;
  /** 0–100 vignette amount. */
  vig: number;
}

export type FxId = 'grain' | 'dither' | 'chroma' | 'scan' | 'vig';
/** Fixed order: the `data-fx` attribute, the hint and the post pass all use it. */
export const FX_IDS: readonly FxId[] = ['grain', 'dither', 'chroma', 'scan', 'vig'];

export const FX_DEFAULT: Readonly<FxState> = {
  grain: 0,
  grainSize: 'fine',
  dither: 0,
  ditherMode: 'bayer',
  chroma: 0,
  scan: 0,
  vig: 0,
};

export const copyFx = (fx: FxState): FxState => ({ ...fx });

export const sameFx = (a: FxState, b: FxState): boolean =>
  a.grain === b.grain && a.grainSize === b.grainSize && a.dither === b.dither && a.ditherMode === b.ditherMode &&
  a.chroma === b.chroma && a.scan === b.scan && a.vig === b.vig;

export const fxActive = (fx: FxState): FxId[] => FX_IDS.filter((id) => fx[id] > 0);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Validate untrusted JSON: every bad field falls back to its default, numbers are clamped and rounded. */
export function parseFx(v: unknown): FxState {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const pct = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? clamp(Math.round(x), 0, 100) : 0);
  let dither = 0;
  if (typeof o.dither === 'number' && Number.isFinite(o.dither)) {
    const r = Math.round(o.dither);
    dither = r <= 0 ? 0 : clamp(r, 2, 16);
  }
  return {
    grain: pct(o.grain),
    grainSize: o.grainSize === 'coarse' ? 'coarse' : 'fine',
    dither,
    ditherMode: o.ditherMode === 'blue' ? 'blue' : 'bayer',
    chroma: pct(o.chroma),
    scan: pct(o.scan),
    vig: pct(o.vig),
  };
}

// ----- knob positions --------------------------------------------------------

/** Dither runs OFF, 16, 15 … 2 levels: turning up means fewer levels, i.e. a stronger effect. */
export const fxMaxPos = (id: FxId): number => (id === 'dither' ? 15 : 100);
export const fxPos = (id: FxId, v: number): number => (id === 'dither' ? (v <= 0 ? 0 : 17 - v) : v);
export const fxFromPos = (id: FxId, p: number): number => (id === 'dither' ? (p <= 0 ? 0 : 17 - p) : p);

// ----- on-values -------------------------------------------------------------

/** What an effect jumps to when toggled on from 0 (until the user has had a value of their own). */
const ON_VALUES: Record<FxId, number> = { grain: 35, dither: 8, chroma: 40, scan: 45, vig: 40 };
const lastOn: Partial<Record<FxId, number>> = {};

export function rememberFx(fx: FxState): void {
  for (const id of FX_IDS) if (fx[id] > 0) lastOn[id] = fx[id];
}

export const onValue = (id: FxId): number => lastOn[id] ?? ON_VALUES[id];

// ----- text ------------------------------------------------------------------

const pad = (n: number, len: number): string => String(n).padStart(len, '0');

export const fxReadout = (id: FxId, fx: FxState): string =>
  fx[id] <= 0 ? 'OFF' : id === 'dither' ? `${pad(fx.dither, 2)} LV` : pad(fx[id], 3);

export function fxStatus(id: FxId, fx: FxState): string {
  const name = id.toUpperCase();
  if (fx[id] <= 0) return `${name} OFF`;
  if (id === 'grain') return `${name} ${fxReadout(id, fx)} · ${fx.grainSize.toUpperCase()}`;
  if (id === 'dither') return `${name} ${fxReadout(id, fx)} · ${fx.ditherMode.toUpperCase()}`;
  return `${name} ${fxReadout(id, fx)}`;
}

// ----- persistence -------------------------------------------------------------

export const FX_KEY = 'gh.fx.v1';

export function loadFxStorage(): { fx: FxState; wp: WallpaperId } | null {
  try {
    const raw = localStorage.getItem(FX_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { v?: unknown; fx?: unknown; wp?: unknown } | null;
    if (!d || typeof d !== 'object' || d.v !== 1) return null;
    return { fx: parseFx(d.fx), wp: parseWallpaper(d.wp) };
  } catch {
    return null;
  }
}

export function saveFxStorage(fx: FxState, wp: WallpaperId): boolean {
  try {
    localStorage.setItem(FX_KEY, JSON.stringify({ v: 1, fx, wp }));
    return true;
  } catch {
    return false;
  }
}

/** Debounced (~150 ms) auto-persist. Call the returned function every frame; it saves when fx or the target changed. */
export function createFxPersist(initFx: FxState, initWp: WallpaperId): (fx: FxState, wp: WallpaperId) => void {
  let savedFx = copyFx(initFx);
  let savedWp = initWp;
  let timer = 0;
  return (fx, wp) => {
    if (sameFx(fx, savedFx) && wp === savedWp) return;
    savedFx = copyFx(fx);
    savedWp = wp;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => saveFxStorage(savedFx, savedWp), 150);
  };
}
