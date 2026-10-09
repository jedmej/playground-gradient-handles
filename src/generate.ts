import { hexToOklch, maxChroma, oklchToHex } from './color';
import { FX_IDS, fxWithOption, onValue, parseFx, type FxId, type FxOpt, type FxState } from './fx';
import { copyPts, defaultSoft, MAX_NODES, MIN_NODES, R_MAX, R_MIN, type NodeSpec, type Shape } from './store';

/** Colour-harmony rule for RANDOM: every colour is an OKLCH point on a hue relation to one base hue. */
export type Harmony = 'any' | 'analog' | 'compl' | 'triad' | 'split' | 'mono';
export const HARMONIES: Harmony[] = ['any', 'analog', 'compl', 'triad', 'split', 'mono'];
export const HARMONY_LABEL: Record<Harmony, string> = {
  any: 'ANY',
  analog: 'ANALOG',
  compl: 'COMPL',
  triad: 'TRIAD',
  split: 'SPLIT',
  mono: 'MONO',
};

/** Seeded PRNG (mulberry32): the same 16-bit seed always yields the same composition. */
export function makeRng(seed: number): () => number {
  let a = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const newSeed = (): number => Math.floor(Math.random() * 0x10000);
/** `4F2A`: the seed as the status line shows it. */
export const seedLabel = (seed: number): string => (seed & 0xffff).toString(16).toUpperCase().padStart(4, '0');

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const wrap = (h: number): number => ((h % 360) + 360) % 360;
const jit = (rng: () => number, amp: number): number => (rng() * 2 - 1) * amp;

/** Hue (degrees) for one node under rule `rule`, around `base`. */
function hueFor(rule: Harmony, rng: () => number, base: number): number {
  switch (rule) {
    case 'analog': return wrap(base + jit(rng, 35));
    case 'compl': return wrap(base + (rng() < 0.5 ? 0 : 180) + jit(rng, 14));
    case 'triad': return wrap(base + 120 * Math.floor(rng() * 3) + jit(rng, 10));
    case 'split': return wrap(base + [0, 150, 210][Math.floor(rng() * 3)] + jit(rng, 8));
    case 'mono': return wrap(base + jit(rng, 5));
    default: return rng() * 360;
  }
}

/** A colour with a spread of lightness (some dark, some mid, some bright) and a share of the in-gamut chroma. */
function colourFor(rule: Harmony, rng: () => number, base: number): string {
  const h = hueFor(rule, rng, base);
  const band = rng();
  const L = band < 0.28 ? 0.1 + rng() * 0.18 : band < 0.72 ? 0.4 + rng() * 0.28 : 0.76 + rng() * 0.19;
  const share = rng() < 0.12 ? 0.08 : 0.25 + 0.75 * Math.pow(rng(), 0.8);
  return oklchToHex(L, maxChroma(L, h) * share, h);
}

/** Farthest-of-N candidate from every placed point (aspect-corrected), so nodes spread without a visible grid. */
function placeAway(rng: () => number, placed: [number, number][], aspect: number): [number, number] {
  let best: [number, number] = [0.05 + rng() * 0.9, 0.05 + rng() * 0.9];
  let bestD = -1;
  for (let k = 0; k < 18; k++) {
    const c: [number, number] = [0.05 + rng() * 0.9, 0.05 + rng() * 0.9];
    let d = Infinity;
    for (const p of placed) d = Math.min(d, Math.hypot((c[0] - p[0]) * aspect, c[1] - p[1]));
    if (placed.length === 0) d = 1;
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

const SHAPE_POOL: Shape[] = ['ellipse', 'box', 'capsule'];

/**
 * A fresh composition. Locked nodes of `existing` stay exactly where (and what) they are, at the same layer index;
 * everything else is regenerated. `aspect` = stage w / h (spacing is measured in stage px, not in 0–1 units).
 */
export function randomSpecs(rng: () => number, rule: Harmony, existing: NodeSpec[], aspect: number): NodeSpec[] {
  let lastLocked = -1;
  existing.forEach((n, i) => {
    if (n.lock) lastLocked = i;
  });
  const count = clamp(Math.max(5 + Math.floor(rng() * 6), lastLocked + 1), MIN_NODES, MAX_NODES);
  // One base hue for the whole set; a locked node's own hue wins so new colours sit with it.
  const anchor = existing.find((n) => n.lock && hexToOklch(n.hex)[1] > 0.02);
  const base = anchor ? hexToOklch(anchor.hex)[2] : rng() * 360;

  const placed: [number, number][] = [];
  for (let i = 0; i < count; i++) if (existing[i]?.lock) placed.push([existing[i].x, existing[i].y]);

  const out: NodeSpec[] = [];
  const free: number[] = [];
  for (let i = 0; i < count; i++) {
    const keep = existing[i];
    if (keep?.lock) {
      out.push({ ...keep, pts: copyPts(keep.pts) });
      continue;
    }
    const [x, y] = placeAway(rng, placed, aspect);
    placed.push([x, y]);
    const spec: NodeSpec = { x, y, r: 0, hex: colourFor(rule, rng, base) };
    let r = (0.24 + rng() * 0.22) * Math.pow(9 / count, 0.25);
    if (rng() < 0.18) {
      spec.shape = SHAPE_POOL[Math.floor(rng() * SHAPE_POOL.length)];
      spec.rot = Math.floor(rng() * 12) * (Math.PI / 12);
      r *= 1.1;
    }
    spec.r = clamp(r, R_MIN, R_MAX);
    spec.soft = rng() < 0.08 ? 0.08 + rng() * 0.14 : 0.35 + rng() * 0.4;
    if (rng() < 0.12) spec.opac = 0.55 + rng() * 0.3;
    out.push(spec);
    free.push(i);
  }
  // Big, hazy nodes belong at the back: reorder the regenerated slots by reach, largest first.
  const sorted = free.map((i) => out[i]).sort((a, b) => b.r - a.r);
  free.forEach((i, k) => (out[i] = sorted[k]));
  // A field of nothing but hidden (locked) nodes would be blank.
  if (out.every((n) => n.hide)) delete out[0].hide;
  return out;
}

/** What VARY may change: the arrangement and node properties, the colours, the FX. Any mix of the three. */
export interface VaryAxes {
  comp: boolean;
  color: boolean;
  fx: boolean;
}

/**
 * One VARY take over the same nodes, scaled by `k` (~0.8 gentle … 2 bold). Only the checked axes change:
 * - comp: position, reach, softness, opacity and rotation jitter, sometimes a mirrored layout;
 * - color: a shared hue turn, a reshuffle of colours between nodes, a light / dark swing, per-node hue / lightness /
 *   chroma jitter (OKLCH, always in gamut);
 * - fx: see `varyFx`.
 * Locked nodes are copied untouched. Specs keep their uid, so adopting one is an identity-matched restore.
 */
export function varySpecs(rng: () => number, nodes: NodeSpec[], k: number, axes: VaryAxes): NodeSpec[] {
  const p = (base: number): boolean => rng() < Math.min(0.95, base * k);
  const free = nodes.map((n, i) => (n.lock ? -1 : i)).filter((i) => i >= 0);
  const flipX = axes.comp && p(0.2);
  const flipY = axes.comp && p(0.15);
  const hueTurn = axes.color && p(0.35) ? jit(rng, 70 * k) : 0;
  const lightSwing = axes.color && p(0.25) ? jit(rng, 0.1 * k) : 0;
  const hexes = new Map<number, string>(free.map((i) => [i, nodes[i].hex]));
  if (axes.color && free.length > 1 && p(0.3)) {
    const order = [...free];
    const swaps = Math.max(1, Math.round(free.length * Math.min(1, 0.3 * k)));
    for (let t = 0; t < swaps; t++) {
      const a = Math.floor(rng() * order.length);
      const b = Math.floor(rng() * order.length);
      [order[a], order[b]] = [order[b], order[a]];
    }
    free.forEach((i, j) => hexes.set(i, nodes[order[j]].hex));
  }
  return nodes.map((n, i) => {
    const out: NodeSpec = { ...n, pts: copyPts(n.pts) };
    if (n.lock) return out;
    if (axes.comp) {
      const bx = flipX ? 1 - n.x : n.x;
      const by = flipY ? 1 - n.y : n.y;
      out.x = clamp(bx + jit(rng, 0.16 * k), 0.02, 0.98);
      out.y = clamp(by + jit(rng, 0.16 * k), 0.02, 0.98);
      out.r = clamp(n.r * Math.exp(jit(rng, 0.45 * k)), R_MIN, R_MAX);
      out.soft = clamp((n.soft ?? defaultSoft(n.shape)) + jit(rng, 0.25 * k), 0, 1);
      if (n.opac !== undefined && n.opac < 1) out.opac = clamp(n.opac + jit(rng, 0.2 * k), 0.15, 1);
      if (out.shape && out.shape !== 'circle' && out.shape !== 'stroke') out.rot = (n.rot ?? 0) + jit(rng, 0.5 * k);
    }
    if (axes.color) {
      const [L, C, h] = hexToOklch(hexes.get(i) ?? n.hex);
      const L2 = clamp(L + lightSwing + jit(rng, 0.1 * k), 0.04, 0.97);
      const h2 = wrap(h + hueTurn + jit(rng, 32 * k));
      const C2 = Math.min(C * Math.exp(jit(rng, 0.35 * k)), maxChroma(L2, h2));
      out.hex = oklchToHex(L2, C2, C < 0.01 ? h : h2);
    }
    return out;
  });
}

/** Every option choice per effect, for VARY's option flips. */
const FX_CHOICES: Partial<Record<FxId, FxOpt[]>> = {
  grain: ['grain-fine', 'grain-coarse'],
  dither: ['dither-bayer', 'dither-blue'],
  scan: ['scan-h', 'scan-v', 'scan-b'],
  halftone: ['halftone-fine', 'halftone-coarse'],
  ascii: ['ascii-fine', 'ascii-coarse'],
  grade: ['grade-punch', 'grade-warm', 'grade-cool', 'grade-fade'],
  map: ['map-post', 'map-duo', 'map-tri'],
  warp: ['warp-lo', 'warp-mid', 'warp-hi'],
};

/**
 * VARY's FX axis: active effects move their amount (±30·k, never to off), sometimes flip their option; sometimes one
 * more effect comes on at its usual value, and with three or more on, one may go off. Clamped by `parseFx`.
 */
export function varyFx(rng: () => number, fx: FxState, k: number): FxState {
  const p = (base: number): boolean => rng() < Math.min(0.95, base * k);
  let next: FxState = { ...fx };
  const on = FX_IDS.filter((id) => fx[id] > 0);
  for (const id of on) {
    if (id === 'dither') next.dither = clamp(Math.round(fx.dither + jit(rng, 4 * k)), 2, 16);
    else next[id] = clamp(Math.round(fx[id] + jit(rng, 30 * k)), 1, 100);
    const opts = FX_CHOICES[id];
    if (opts && p(0.25)) next = fxWithOption(next, opts[Math.floor(rng() * opts.length)]);
  }
  const off = FX_IDS.filter((id) => fx[id] <= 0 && id !== 'warp');
  if (off.length && (on.length === 0 || p(0.35))) {
    const id = off[Math.floor(rng() * off.length)];
    next[id] = onValue(id);
    const opts = FX_CHOICES[id];
    if (opts) next = fxWithOption(next, opts[Math.floor(rng() * opts.length)]);
  }
  if (on.length >= 3 && p(0.2)) next[on[Math.floor(rng() * on.length)]] = 0;
  return parseFx(next);
}
