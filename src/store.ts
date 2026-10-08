import { hexToLab, type Lab } from './color';
import { copyFx, FX_DEFAULT, type FxState } from './fx';
import { PRESETS, type Preset } from './presets';
import { DEFAULT_CUSTOM, DEFAULT_WALLPAPER, type CustomSize, type WallpaperId } from './wallpaper';

export type Shape = 'circle' | 'ellipse' | 'box' | 'capsule' | 'stroke';
export type Tool = 'edit' | 'draw';
export type HoverKind = 'idle' | 'node' | 'ring' | 'body' | 'soft' | 'rot' | 'opac' | 'hue' | 'sat' | 'lum';
export type DragKind = 'none' | 'node' | 'ring' | 'soft' | 'rot' | 'opac' | 'hue' | 'sat' | 'lum';

export const MAX_NODES = 16;
export const MIN_NODES = 2;
/** Preset index of the user slot (CS-06). */
export const CUSTOM_INDEX = PRESETS.length;
export const DEFAULT_RADIUS = 0.28;
/** Reach of a freshly drawn stroke: wide and soft. */
export const STROKE_RADIUS = 0.16;
/** PAPER token: the pale glow a stroke gets when nothing was selected. */
export const PAPER_HEX = '#E9EAE4';
/** Softness (0–1) a node starts with: the classic look for primitives, a wide haze for strokes. */
export const DEFAULT_SOFT = 0.5;
export const STROKE_SOFT = 0.75;
export const defaultSoft = (shape: Shape | undefined): number => (shape === 'stroke' ? STROKE_SOFT : DEFAULT_SOFT);

export interface NodeState {
  /** Stable identity across re-indexing (views are keyed by it). */
  uid: number;
  /** Targets, normalised: x/y in stage units (0–1), r as a fraction of min(stage w, h). */
  x: number;
  y: number;
  r: number;
  /** Smoothed display values (same units). */
  dx: number;
  dy: number;
  dr: number;
  /** Softness 0–1 (target) and its smoothed display value. */
  soft: number;
  dsoft: number;
  /** Opacity 0–1 (default 1): scales the node's pull on the field, so it fades toward its neighbours. */
  opac: number;
  dopac: number;
  /** Colour tween in OKLab. Three distinct arrays; `lab` is what the shader sees. */
  lab: Lab;
  labFrom: Lab;
  labTo: Lab;
  /** Per-node tween clock (ms). */
  t0: number;
  dur: number;
  hex: string;
  /** Shape of the node's influence; rot in radians (display value `drot`, smoothed like dx). */
  shape: Shape;
  rot: number;
  drot: number;
  /** Strokes only: polyline offsets from (x, y) in short-side units. Empty for every other shape. */
  pts: [number, number][];
  /** Set on creation; the view plays its "acquire" animation once and clears it. */
  fresh: boolean;
}

/** The minimal, serialisable description of a node. */
export interface NodeSpec {
  /** Only present on history snapshots: lets a restore match nodes by identity. */
  uid?: number;
  x: number;
  y: number;
  r: number;
  hex: string;
  shape?: Shape;
  rot?: number;
  pts?: [number, number][];
  soft?: number;
  opac?: number;
}

export interface Dim {
  w: number;
  h: number;
  min: number;
}

export const R_MIN = 0.06;
export const R_MAX = 0.95;

export const EASE = (t: number): number => {
  // cubic-bezier(.4,0,.2,1) sampled closely enough for a colour tween.
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};

export interface Store {
  nodes: NodeState[];
  presetIndex: number;
  /** User preset (CS-06), if one has been saved. */
  custom: Preset | null;
  /** True once the active preset has been edited. */
  modified: boolean;
  selected: number | null;
  focused: number | null;
  /** Node whose ring was revealed by hovering its core; stays revealed while the pointer is near. */
  armed: number | null;
  hover: { kind: HoverKind; index: number };
  drag: { kind: DragKind; index: number };
  /** DRAW tool: `tool` is the mode, `drawing` is true between pointerdown and pointerup of a stroke. */
  tool: Tool;
  drawing: boolean;
  /** Colour for the next stroke (the node selected when draw mode was entered, else PAPER). */
  drawColor: string;
  /** Bearing arc angle in radians (display + target). */
  arcAngle: number;
  arcTarget: number;
  arcOpacity: number;
  coarse: boolean;
  reducedMotion: boolean;
  /** Post-process effects (part of undo history and of CS-06). */
  fx: FxState;
  /** Selected wallpaper export target (persisted, not composition: no undo). */
  wallpaper: WallpaperId;
  /** Last custom wallpaper size in px (persisted with the target, not undoable). */
  wpCustom: CustomSize;
  listeners: Set<() => void>;
  /** Status line hook; the UI installs it. */
  say: (text: string) => void;
  /** Abort a stroke in progress; the pointer layer installs it. */
  cancelDraw: () => void;
}

let uidSeq = 0;

export const copyPts = (pts: [number, number][] | undefined): [number, number][] =>
  pts ? pts.map((p) => [p[0], p[1]]) : [];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function makeNode(spec: NodeSpec, fresh = false): NodeState {
  const { x, y, r, hex } = spec;
  const soft = Math.min(1, Math.max(0, spec.soft ?? defaultSoft(spec.shape)));
  if (spec.uid !== undefined) uidSeq = Math.max(uidSeq, spec.uid);
  return {
    uid: spec.uid ?? ++uidSeq,
    x, y, r,
    dx: x, dy: y, dr: r,
    soft,
    dsoft: soft,
    opac: clamp01(spec.opac ?? 1),
    dopac: clamp01(spec.opac ?? 1),
    lab: hexToLab(hex),
    labFrom: hexToLab(hex),
    labTo: hexToLab(hex),
    t0: 0,
    dur: 0,
    hex,
    shape: spec.shape ?? 'circle',
    rot: spec.rot ?? 0,
    drot: spec.rot ?? 0,
    pts: spec.shape === 'stroke' ? copyPts(spec.pts) : [],
    fresh,
  };
}

export function createStore(): Store {
  const preset = PRESETS[0];
  const nodes = presetSpecs(preset).map((s) => makeNode(s));
  return {
    nodes,
    presetIndex: 0,
    custom: null,
    modified: false,
    selected: null,
    focused: null,
    armed: null,
    hover: { kind: 'idle', index: -1 },
    drag: { kind: 'none', index: -1 },
    tool: 'edit',
    drawing: false,
    drawColor: PAPER_HEX,
    arcAngle: -Math.PI / 4,
    arcTarget: -Math.PI / 4,
    arcOpacity: 0,
    coarse: matchMedia('(pointer: coarse)').matches,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    fx: copyFx(FX_DEFAULT),
    wallpaper: DEFAULT_WALLPAPER,
    wpCustom: { ...DEFAULT_CUSTOM },
    listeners: new Set(),
    say: () => {},
    cancelDraw: () => {},
  };
}

export function emit(store: Store): void {
  for (const l of store.listeners) l();
}

export function presetSpecs(p: Preset): NodeSpec[] {
  return p.colors.map((hex, i) => {
    const spec: NodeSpec = { x: p.positions[i][0], y: p.positions[i][1], r: p.radii[i], hex };
    const ex = p.shapes?.[i];
    if (ex?.shape) {
      spec.shape = ex.shape;
      spec.rot = ex.rot ?? 0;
      if (ex.pts) spec.pts = copyPts(ex.pts);
    }
    if (ex?.soft !== undefined) spec.soft = ex.soft;
    if (ex?.opac !== undefined) spec.opac = ex.opac;
    return spec;
  });
}

export function getPreset(store: Store, index: number): Preset | null {
  return index === CUSTOM_INDEX ? store.custom : (PRESETS[index] ?? null);
}

export function currentPreset(store: Store): Preset {
  return getPreset(store, store.presetIndex) ?? PRESETS[0];
}

export function snapshotSpecs(store: Store): NodeSpec[] {
  return store.nodes.map((n) => ({ x: n.x, y: n.y, r: n.r, hex: n.hex, shape: n.shape, rot: n.rot, pts: copyPts(n.pts), soft: n.soft, opac: n.opac }));
}

/** Like `snapshotSpecs`, but carrying per-node identity (for undo/redo). */
export function snapshotIdentified(store: Store): NodeSpec[] {
  return store.nodes.map((n) => ({
    uid: n.uid, x: n.x, y: n.y, r: n.r, hex: n.hex, shape: n.shape, rot: n.rot, pts: copyPts(n.pts), soft: n.soft, opac: n.opac,
  }));
}

/** Start a colour tween on one node (does not touch any other node). */
export function tweenNodeTo(store: Store, n: NodeState, hex: string, now: number, ms: number): void {
  n.labFrom = [...n.lab] as Lab;
  n.labTo = hexToLab(hex);
  n.hex = hex;
  n.t0 = now;
  n.dur = store.reducedMotion ? 0 : ms;
  if (n.dur === 0) n.lab = [...n.labTo] as Lab;
}

/** Shape fields of a spec onto a live node; a spec without a shape means circle. */
function applyShape(n: NodeState, s: NodeSpec): void {
  n.shape = s.shape ?? 'circle';
  n.rot = s.rot ?? 0;
  n.pts = n.shape === 'stroke' ? copyPts(s.pts) : [];
  n.soft = Math.min(1, Math.max(0, s.soft ?? defaultSoft(n.shape)));
  n.opac = clamp01(s.opac ?? 1);
}

/** Drop every index that no longer points at a node. */
function clampRefs(store: Store): void {
  const len = store.nodes.length;
  if (store.selected !== null && store.selected >= len) store.selected = null;
  if (store.focused !== null && store.focused >= len) store.focused = null;
  if (store.armed !== null && store.armed >= len) store.armed = null;
  if (store.hover.index >= len) store.hover = { kind: 'idle', index: -1 };
  if (store.drag.index >= len) store.drag = { kind: 'none', index: -1 };
}

/**
 * Make the live nodes match `target`: survivors tween to their new colour (and glide to their
 * new position when `withLayout`), extras are appended, surplus nodes are dropped from the tail.
 */
export function reconcile(store: Store, target: NodeSpec[], now: number, withLayout: boolean, ms: number): void {
  const specs = target.slice(0, MAX_NODES);
  if (specs.length > 0 && specs.every((sp) => sp.uid !== undefined)) {
    reconcileByUid(store, specs, now, withLayout, ms);
    return;
  }
  const keep = Math.min(specs.length, store.nodes.length);
  for (let i = 0; i < keep; i++) {
    const n = store.nodes[i];
    const s = specs[i];
    tweenNodeTo(store, n, s.hex, now, ms);
    if (withLayout) {
      n.x = s.x;
      n.y = s.y;
      n.r = s.r;
      applyShape(n, s);
    }
  }
  for (let i = keep; i < specs.length; i++) store.nodes.push(makeNode({ ...specs[i], uid: undefined }, true));
  if (store.nodes.length > specs.length) store.nodes.length = specs.length;
  clampRefs(store);
}

/** Identity-matched restore: survivors stay put, missing nodes return at their original index. */
function reconcileByUid(store: Store, specs: NodeSpec[], now: number, withLayout: boolean, ms: number): void {
  const byUid = new Map(store.nodes.map((n) => [n.uid, n]));
  const uidAt = (i: number | null): number | null => (i === null ? null : (store.nodes[i]?.uid ?? null));
  const sel = uidAt(store.selected);
  const foc = uidAt(store.focused);
  const arm = uidAt(store.armed);
  const next = specs.map((sp) => {
    const n = byUid.get(sp.uid as number);
    if (!n) return makeNode(sp, true);
    tweenNodeTo(store, n, sp.hex, now, ms);
    if (withLayout) {
      n.x = sp.x;
      n.y = sp.y;
      n.r = sp.r;
      applyShape(n, sp);
    }
    return n;
  });
  store.nodes = next;
  const find = (u: number | null): number | null => {
    if (u === null) return null;
    const i = next.findIndex((n) => n.uid === u);
    return i < 0 ? null : i;
  };
  store.selected = find(sel);
  store.focused = find(foc);
  store.armed = find(arm);
  store.hover = { kind: 'idle', index: -1 };
  store.drag = { kind: 'none', index: -1 };
  clampRefs(store);
}

export function applyPreset(store: Store, index: number, now: number, withLayout: boolean): boolean {
  const preset = getPreset(store, index);
  if (!preset) return false;
  store.presetIndex = index;
  store.modified = false;
  if (preset.fx) store.fx = copyFx(preset.fx);
  reconcile(store, presetSpecs(preset), now, withLayout, 620);
  emit(store);
  return true;
}

/** Append a node. Returns its index. */
export function addNode(store: Store, spec: NodeSpec): number {
  store.nodes.push(makeNode(spec, true));
  return store.nodes.length - 1;
}

/** Remove node `i` and keep every surviving index reference pointing at the same node. */
export function removeNodeAt(store: Store, i: number): void {
  store.nodes.splice(i, 1);
  const shift = (v: number | null): number | null => (v === null || v === i ? null : v > i ? v - 1 : v);
  store.selected = shift(store.selected);
  store.focused = shift(store.focused);
  store.armed = shift(store.armed);
  store.hover = { kind: 'idle', index: -1 };
  store.drag = { kind: 'none', index: -1 };
}

export function nodeSerial(i: number): string {
  return `N-${String(i + 1).padStart(2, '0')}`;
}

/** Layer moves: index 0 is the back, the last index the front. */
export type LayerMove = 'front' | 'up' | 'down' | 'back';

export function layerTarget(i: number, count: number, move: LayerMove): number {
  switch (move) {
    case 'front': return count - 1;
    case 'up': return Math.min(count - 1, i + 1);
    case 'down': return Math.max(0, i - 1);
    default: return 0;
  }
}

/** Reorder `store.nodes` (layer order) and keep selected / focused / armed on the same nodes by identity. */
export function moveNodeTo(store: Store, from: number, to: number): void {
  if (from === to || from < 0 || from >= store.nodes.length) return;
  const uidAt = (i: number | null): number | null => (i === null ? null : (store.nodes[i]?.uid ?? null));
  const sel = uidAt(store.selected);
  const foc = uidAt(store.focused);
  const arm = uidAt(store.armed);
  const [n] = store.nodes.splice(from, 1);
  store.nodes.splice(to, 0, n);
  const find = (u: number | null): number | null => {
    if (u === null) return null;
    const i = store.nodes.findIndex((m) => m.uid === u);
    return i < 0 ? null : i;
  };
  store.selected = find(sel);
  store.focused = find(foc);
  store.armed = find(arm);
  store.hover = { kind: 'idle', index: -1 };
  store.drag = { kind: 'none', index: -1 };
}
