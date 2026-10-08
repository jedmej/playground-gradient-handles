import { hexToLab, labToHex, sampleField, type Lab } from './color';
import { PRESETS, type Preset } from './presets';

export type HoverKind = 'idle' | 'node' | 'ring';
export type DragKind = 'none' | 'node' | 'ring';

export const MAX_NODES = 16;
export const MIN_NODES = 2;
/** Preset index of the user slot (CS-06). */
export const CUSTOM_INDEX = PRESETS.length;
export const DEFAULT_RADIUS = 0.28;

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
  /** Colour tween in OKLab. Three distinct arrays; `lab` is what the shader sees. */
  lab: Lab;
  labFrom: Lab;
  labTo: Lab;
  /** Per-node tween clock (ms). */
  t0: number;
  dur: number;
  hex: string;
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
  /** Bearing arc angle in radians (display + target). */
  arcAngle: number;
  arcTarget: number;
  arcOpacity: number;
  coarse: boolean;
  reducedMotion: boolean;
  listeners: Set<() => void>;
  /** Status line hook; the UI installs it. */
  say: (text: string) => void;
}

let uidSeq = 0;

export function makeNode(spec: NodeSpec, fresh = false): NodeState {
  const { x, y, r, hex } = spec;
  if (spec.uid !== undefined) uidSeq = Math.max(uidSeq, spec.uid);
  return {
    uid: spec.uid ?? ++uidSeq,
    x, y, r,
    dx: x, dy: y, dr: r,
    lab: hexToLab(hex),
    labFrom: hexToLab(hex),
    labTo: hexToLab(hex),
    t0: 0,
    dur: 0,
    hex,
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
    arcAngle: -Math.PI / 4,
    arcTarget: -Math.PI / 4,
    arcOpacity: 0,
    coarse: matchMedia('(pointer: coarse)').matches,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    listeners: new Set(),
    say: () => {},
  };
}

export function emit(store: Store): void {
  for (const l of store.listeners) l();
}

export function presetSpecs(p: Preset): NodeSpec[] {
  return p.colors.map((hex, i) => ({ x: p.positions[i][0], y: p.positions[i][1], r: p.radii[i], hex }));
}

export function getPreset(store: Store, index: number): Preset | null {
  return index === CUSTOM_INDEX ? store.custom : (PRESETS[index] ?? null);
}

export function currentPreset(store: Store): Preset {
  return getPreset(store, store.presetIndex) ?? PRESETS[0];
}

export function snapshotSpecs(store: Store): NodeSpec[] {
  return store.nodes.map((n) => ({ x: n.x, y: n.y, r: n.r, hex: n.hex }));
}

/** Like `snapshotSpecs`, but carrying per-node identity (for undo/redo). */
export function snapshotIdentified(store: Store): NodeSpec[] {
  return store.nodes.map((n) => ({ uid: n.uid, x: n.x, y: n.y, r: n.r, hex: n.hex }));
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
  reconcile(store, presetSpecs(preset), now, withLayout, 620);
  emit(store);
  return true;
}

/** Colour of the live field (no warp) at a normalised point. */
export function fieldHexAt(store: Store, nx: number, ny: number, dim: Dim): string {
  const samples = store.nodes.map((n) => ({ x: n.dx * dim.w, y: n.dy * dim.h, r: n.dr * dim.min, lab: n.lab }));
  return labToHex(sampleField(samples, nx * dim.w, ny * dim.h));
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
