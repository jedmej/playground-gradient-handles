import { hexToLab, type Lab } from './color';
import { PRESETS, type Preset } from './presets';

export type HoverKind = 'idle' | 'node' | 'ring';
export type DragKind = 'none' | 'node' | 'ring';

export interface NodeState {
  /** Targets, normalised: x/y in stage units (0–1), r as a fraction of min(stage w, h). */
  x: number;
  y: number;
  r: number;
  /** Smoothed display values (same units). */
  dx: number;
  dy: number;
  dr: number;
  /** Colour tween in OKLab. */
  lab: Lab;
  labFrom: Lab;
  labTo: Lab;
  hex: string;
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
  /** Colour tween clock (ms). */
  tweenStart: number;
  tweenDuration: number;
  coarse: boolean;
  reducedMotion: boolean;
  listeners: Set<() => void>;
}

export function createStore(): Store {
  const preset = PRESETS[0];
  const nodes: NodeState[] = preset.colors.map((hex, i) => {
    const lab = hexToLab(hex);
    const [x, y] = preset.positions[i];
    const r = preset.radii[i];
    return { x, y, r, dx: x, dy: y, dr: r, lab, labFrom: lab, labTo: lab, hex };
  });
  return {
    nodes,
    presetIndex: 0,
    selected: null,
    focused: null,
    armed: null,
    hover: { kind: 'idle', index: -1 },
    drag: { kind: 'none', index: -1 },
    arcAngle: -Math.PI / 4,
    arcTarget: -Math.PI / 4,
    arcOpacity: 0,
    tweenStart: 0,
    tweenDuration: 0,
    coarse: matchMedia('(pointer: coarse)').matches,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    listeners: new Set(),
  };
}

export function emit(store: Store): void {
  for (const l of store.listeners) l();
}

export function currentPreset(store: Store): Preset {
  return PRESETS[store.presetIndex];
}

export function applyPreset(store: Store, index: number, now: number, withLayout: boolean): void {
  const preset = PRESETS[index];
  store.presetIndex = index;
  store.tweenStart = now;
  store.tweenDuration = store.reducedMotion ? 0 : 620;
  preset.colors.forEach((hex, i) => {
    const n = store.nodes[i];
    n.labFrom = n.lab;
    n.labTo = hexToLab(hex);
    n.hex = hex;
    if (withLayout) {
      const [x, y] = preset.positions[i];
      n.x = x;
      n.y = y;
      n.r = preset.radii[i];
    }
  });
  emit(store);
}

export function nodeSerial(i: number): string {
  return `N-${String(i + 1).padStart(2, '0')}`;
}
