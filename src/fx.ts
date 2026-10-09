import { parseCustomSize, parseWallpaper, type CustomSize, type WallpaperId } from './wallpaper';

export type GrainSize = 'fine' | 'coarse';
export type DitherMode = 'bayer' | 'blue';
/** Scanline direction: horizontal lines, vertical lines, or both (a grid). */
export type ScanDir = 'h' | 'v' | 'b';
/** Cell size shared by HALFTONE and ASCII. */
export type CellSize = 'fine' | 'coarse';
/** GRADE flavour: contrast + saturation, warm / cool tint, or lifted-black fade. */
export type GradeMode = 'punch' | 'warm' | 'cool' | 'fade';
/** MAP flavour: posterize, or a duo / tritone built from the darkest / middle / lightest node colours. */
export type MapMode = 'post' | 'duo' | 'tri';
/** WARP noise scale: broad (0.85), house (1.7) or tight (3.4) swirls. */
export type WarpScale = 'lo' | 'mid' | 'hi';

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
  scanDir: ScanDir;
  /** 0–100 vignette amount. */
  vig: number;
  /** 0–100 halftone dot screen (45°). */
  halftone: number;
  halftoneSize: CellSize;
  /** 0–100 mosaic block size (2 → 40 CSS px). */
  pixel: number;
  /** 0–100 ASCII glyph-cell mix. */
  ascii: number;
  asciiSize: CellSize;
  /** 0–100: posterize = fewer levels (12 → 2); duo / tri = blend into the gradient map. */
  map: number;
  mapMode: MapMode;
  /** 0–100 bloom on the bright areas. */
  glow: number;
  /** 0–100 grade amount. */
  grade: number;
  gradeMode: GradeMode;
  /** 0 = the house warp (WARP_HOUSE); 1–100 = field warp strength, 1 flat … 50 house … 100 double. */
  warp: number;
  warpScale: WarpScale;
}

export type FxId =
  | 'grain' | 'dither' | 'chroma' | 'scan' | 'vig'
  | 'halftone' | 'pixel' | 'ascii' | 'map'
  | 'glow' | 'grade' | 'warp';
/** Fixed order: the `data-fx` attribute, the hint, the panel and the post pass all use it (the existing five first, so old attributes read the same). */
export const FX_IDS: readonly FxId[] = [
  'grain', 'dither', 'chroma', 'scan', 'vig',
  'halftone', 'pixel', 'ascii', 'map',
  'glow', 'grade', 'warp',
];

/** The FX dial's pages: five rings fit its bezel, so twelve effects flip between three pages of at most five. */
export const FX_PAGES: ReadonlyArray<{ name: string; ids: readonly FxId[] }> = [
  { name: 'STOCK', ids: ['grain', 'dither', 'chroma', 'scan', 'vig'] },
  { name: 'STYLE', ids: ['halftone', 'pixel', 'ascii', 'map'] },
  { name: 'LOOK', ids: ['glow', 'grade', 'warp'] },
];
export const fxPageOf = (id: FxId): number => FX_PAGES.findIndex((p) => p.ids.includes(id));

/** Field warp gain (× short side) at OFF and at knob 50: the constant the field shader always used. */
export const WARP_HOUSE = 0.17;
export const warpGain = (fx: FxState): number => (fx.warp <= 0 ? WARP_HOUSE : (WARP_HOUSE * (fx.warp - 1)) / 49);
export const warpFreq = (fx: FxState): number => (fx.warpScale === 'lo' ? 0.85 : fx.warpScale === 'hi' ? 3.4 : 1.7);

export const FX_DEFAULT: Readonly<FxState> = {
  grain: 0,
  grainSize: 'fine',
  dither: 0,
  ditherMode: 'bayer',
  chroma: 0,
  scan: 0,
  scanDir: 'h',
  vig: 0,
  halftone: 0,
  halftoneSize: 'fine',
  pixel: 0,
  ascii: 0,
  asciiSize: 'fine',
  map: 0,
  mapMode: 'post',
  glow: 0,
  grade: 0,
  gradeMode: 'punch',
  warp: 0,
  warpScale: 'mid',
};

export const copyFx = (fx: FxState): FxState => ({ ...fx });

export const sameFx = (a: FxState, b: FxState): boolean =>
  a.grain === b.grain && a.grainSize === b.grainSize && a.dither === b.dither && a.ditherMode === b.ditherMode &&
  a.chroma === b.chroma && a.scan === b.scan && a.scanDir === b.scanDir && a.vig === b.vig &&
  a.halftone === b.halftone && a.halftoneSize === b.halftoneSize && a.pixel === b.pixel &&
  a.ascii === b.ascii && a.asciiSize === b.asciiSize && a.map === b.map && a.mapMode === b.mapMode &&
  a.glow === b.glow && a.grade === b.grade && a.gradeMode === b.gradeMode && a.warp === b.warp && a.warpScale === b.warpScale;

export const fxActive = (fx: FxState): FxId[] => FX_IDS.filter((id) => fx[id] > 0);

/** True when the post pass has work: everything except WARP, which lives in the field shader. */
export const fxNeedsPost = (fx: FxState): boolean => FX_IDS.some((id) => id !== 'warp' && fx[id] > 0);

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
    scanDir: o.scanDir === 'v' || o.scanDir === 'b' ? o.scanDir : 'h',
    vig: pct(o.vig),
    halftone: pct(o.halftone),
    halftoneSize: o.halftoneSize === 'coarse' ? 'coarse' : 'fine',
    pixel: pct(o.pixel),
    ascii: pct(o.ascii),
    asciiSize: o.asciiSize === 'coarse' ? 'coarse' : 'fine',
    map: pct(o.map),
    mapMode: o.mapMode === 'duo' || o.mapMode === 'tri' ? o.mapMode : 'post',
    glow: pct(o.glow),
    grade: pct(o.grade),
    gradeMode: o.gradeMode === 'warm' || o.gradeMode === 'cool' || o.gradeMode === 'fade' ? o.gradeMode : 'punch',
    warp: pct(o.warp),
    warpScale: o.warpScale === 'lo' || o.warpScale === 'hi' ? o.warpScale : 'mid',
  };
}

// ----- knob positions --------------------------------------------------------

/** Dither runs OFF, 16, 15 … 2 levels: turning up means fewer levels, i.e. a stronger effect. */
export const fxMaxPos = (id: FxId): number => (id === 'dither' ? 15 : 100);
export const fxPos = (id: FxId, v: number): number => (id === 'dither' ? (v <= 0 ? 0 : 17 - v) : v);
export const fxFromPos = (id: FxId, p: number): number => (id === 'dither' ? (p <= 0 ? 0 : 17 - p) : p);

// ----- on-values -------------------------------------------------------------

/** What an effect jumps to when toggled on from 0 (until the user has had a value of their own). */
/** Half way round the knob: 50 for the 0–100 effects, dither knob position 8 of 15 = 9 levels. */
/** Warp's 50 is exactly the house strength, so switching it on changes nothing until it is turned. */
const ON_VALUES: Record<FxId, number> = {
  grain: 50, dither: 9, chroma: 50, scan: 50, vig: 50,
  halftone: 50, pixel: 40, ascii: 60, map: 60, glow: 50, grade: 50, warp: 50,
};
const lastOn: Partial<Record<FxId, number>> = {};

export function rememberFx(fx: FxState): void {
  for (const id of FX_IDS) if (fx[id] > 0) lastOn[id] = fx[id];
}

export const onValue = (id: FxId): number => lastOn[id] ?? ON_VALUES[id];

// ----- text ------------------------------------------------------------------

const pad = (n: number, len: number): string => String(n).padStart(len, '0');

export const fxReadout = (id: FxId, fx: FxState): string =>
  fx[id] <= 0 ? (id === 'warp' ? 'STD' : 'OFF') : id === 'dither' ? `${pad(fx.dither, 2)} LV` : pad(fx[id], 3);

// ----- options ------------------------------------------------------------------

/** Every `data-fx-opt` value: `<effect>-<choice>`. */
export type FxOpt =
  | 'grain-fine' | 'grain-coarse' | 'dither-bayer' | 'dither-blue' | 'scan-h' | 'scan-v' | 'scan-b'
  | 'halftone-fine' | 'halftone-coarse' | 'ascii-fine' | 'ascii-coarse'
  | 'grade-punch' | 'grade-warm' | 'grade-cool' | 'grade-fade'
  | 'map-post' | 'map-duo' | 'map-tri' | 'warp-lo' | 'warp-mid' | 'warp-hi';

/** The option an effect carries, as its choice word (`fine`, `bayer`, `h` …), or null when it has none. */
export function fxChoice(id: FxId, fx: FxState): string | null {
  switch (id) {
    case 'grain': return fx.grainSize;
    case 'dither': return fx.ditherMode;
    case 'scan': return fx.scanDir;
    case 'halftone': return fx.halftoneSize;
    case 'ascii': return fx.asciiSize;
    case 'grade': return fx.gradeMode;
    case 'map': return fx.mapMode;
    case 'warp': return fx.warpScale;
    default: return null;
  }
}

export const fxOptId = (opt: FxOpt): FxId => opt.slice(0, opt.indexOf('-')) as FxId;
export const fxOptOn = (opt: FxOpt, fx: FxState): boolean => opt === `${fxOptId(opt)}-${fxChoice(fxOptId(opt), fx)}`;

/** A copy of `fx` with one option set. */
export function fxWithOption(fx: FxState, opt: FxOpt): FxState {
  const next = { ...fx };
  const v = opt.slice(opt.indexOf('-') + 1);
  switch (fxOptId(opt)) {
    case 'grain': next.grainSize = v as CellSize; break;
    case 'dither': next.ditherMode = v as DitherMode; break;
    case 'scan': next.scanDir = v as ScanDir; break;
    case 'halftone': next.halftoneSize = v as CellSize; break;
    case 'ascii': next.asciiSize = v as CellSize; break;
    case 'grade': next.gradeMode = v as GradeMode; break;
    case 'map': next.mapMode = v as MapMode; break;
    case 'warp': next.warpScale = v as WarpScale; break;
    default: break;
  }
  return next;
}

/** Screen-reader value text for a knob or ring. */
export function fxSpoken(id: FxId, fx: FxState): string {
  const c = fxChoice(id, fx);
  if (fx[id] <= 0) return id === 'warp' ? 'standard' : 'off';
  return id === 'dither' ? `${fx.dither} levels, ${c}` : c ? `${fx[id]}, ${c}` : String(fx[id]);
}

export function fxStatus(id: FxId, fx: FxState): string {
  const name = id.toUpperCase();
  const c = fxChoice(id, fx);
  const read = fxReadout(id, fx);
  if (fx[id] <= 0) return id === 'warp' ? `${name} ${read}` : `${name} OFF`;
  return c ? `${name} ${read} · ${c.toUpperCase()}` : `${name} ${read}`;
}

// ----- persistence -------------------------------------------------------------

export const FX_KEY = 'gh.fx.v1';

export function loadFxStorage(): { fx: FxState; wp: WallpaperId; cs: CustomSize } | null {
  try {
    const raw = localStorage.getItem(FX_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { v?: unknown; fx?: unknown; wp?: unknown; cs?: unknown } | null;
    if (!d || typeof d !== 'object' || d.v !== 1) return null;
    return { fx: parseFx(d.fx), wp: parseWallpaper(d.wp), cs: parseCustomSize(d.cs) };
  } catch {
    return null;
  }
}

export function saveFxStorage(fx: FxState, wp: WallpaperId, cs: CustomSize): boolean {
  try {
    localStorage.setItem(FX_KEY, JSON.stringify({ v: 1, fx, wp, cs }));
    return true;
  } catch {
    return false;
  }
}

/** Debounced (~150 ms) auto-persist. Call the returned function every frame; it saves when fx or the target changed. */
export function createFxPersist(
  initFx: FxState,
  initWp: WallpaperId,
  initCs: CustomSize,
): (fx: FxState, wp: WallpaperId, cs: CustomSize) => void {
  let savedFx = copyFx(initFx);
  let savedWp = initWp;
  let savedCs = { ...initCs };
  let timer = 0;
  return (fx, wp, cs) => {
    if (sameFx(fx, savedFx) && wp === savedWp && cs.w === savedCs.w && cs.h === savedCs.h) return;
    savedFx = copyFx(fx);
    savedWp = wp;
    savedCs = { ...cs };
    window.clearTimeout(timer);
    timer = window.setTimeout(() => saveFxStorage(savedFx, savedWp, savedCs), 150);
  };
}
