import type { Pt } from './geom';
import { STROKE_RADIUS } from './store';

/**
 * DRAW tray state: which tool the next drag makes, and how it looks (outline or fill, weight, star points / spikes).
 * A module singleton like `tools` (tools.ts), persisted per browser. Everything a drag makes is a stroke node: the
 * pencil keeps its sampled path, the shape tools write a handful of anchors (corners, or a smooth loop for the ellipse)
 * that can be edited point by point afterwards.
 */
export type DrawKind = 'pencil' | 'line' | 'rect' | 'ellipse' | 'tri' | 'star';
export const DRAW_KINDS: DrawKind[] = ['pencil', 'line', 'rect', 'ellipse', 'tri', 'star'];
export const DRAW_LABEL: Record<DrawKind, string> = {
  pencil: 'PENCIL',
  line: 'LINE',
  rect: 'RECT',
  ellipse: 'ELLIPSE',
  tri: 'TRIANGLE',
  star: 'STAR',
};
/** Closed tools can be filled; the pencil and the line are always outlines. */
export const canFill = (k: DrawKind): boolean => k !== 'pencil' && k !== 'line';

export const WEIGHT_MIN = 0.06;
export const WEIGHT_MAX = 0.4;
export const POINTS_MIN = 3;
export const POINTS_MAX = 12;
/** Spike depth above which a star stops reading as a polygon (0 = polygon, 0.9 = needle-thin arms). */
export const SPIKE_MAX = 0.9;

const KEY = 'gh.draw.v1';

export const draw = {
  kind: 'pencil' as DrawKind,
  fill: false,
  /** Reach of the new stroke (node r, fraction of the short side). */
  weight: STROKE_RADIUS,
  points: 5,
  spike: 0.5,
};

try {
  const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<typeof draw> | null;
  if (o && typeof o === 'object') {
    if (DRAW_KINDS.includes(o.kind as DrawKind)) draw.kind = o.kind as DrawKind;
    if (typeof o.fill === 'boolean') draw.fill = o.fill;
    if (typeof o.weight === 'number' && Number.isFinite(o.weight)) draw.weight = clamp(o.weight, WEIGHT_MIN, WEIGHT_MAX);
    if (typeof o.points === 'number' && Number.isFinite(o.points)) draw.points = Math.round(clamp(o.points, POINTS_MIN, POINTS_MAX));
    if (typeof o.spike === 'number' && Number.isFinite(o.spike)) draw.spike = clamp(o.spike, 0, SPIKE_MAX);
  }
} catch {
  /* blocked storage / bad JSON: defaults */
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const listeners = new Set<() => void>();
export function onDrawChange(fn: () => void): void {
  listeners.add(fn);
}

/** Change the tray state (clamped), remember it and tell the tray and any shape being dragged. */
export function setDraw(patch: Partial<typeof draw>): void {
  Object.assign(draw, patch);
  draw.weight = clamp(draw.weight, WEIGHT_MIN, WEIGHT_MAX);
  draw.points = Math.round(clamp(draw.points, POINTS_MIN, POINTS_MAX));
  draw.spike = clamp(draw.spike, 0, SPIKE_MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(draw));
  } catch {
    /* private mode: not remembered */
  }
  for (const fn of listeners) fn();
}

export interface ShapeGeom {
  /** Absolute anchors (stage px). */
  anchors: Pt[];
  closed: boolean;
  smooth: boolean;
  /** Centre the node sits on (stage px). */
  centre: Pt;
}

const SNAP45 = Math.PI / 4;
const SNAP15 = Math.PI / 12;

/**
 * The anchors a shape tool makes for a drag from `a` to `b`.
 * Box tools (RECT / ELLIPSE / TRIANGLE): `a`–`b` is the bounding box; ⇧ makes it square, ⌥ grows it from `a`.
 * LINE: `a` to `b`, ⇧ snaps to 45°. STAR: `a` is the centre and `b` the tip of the first arm — dragging round rotates it
 * (⇧ snaps to 15°); its points and spike depth come from the tray.
 */
export function shapeGeom(kind: Exclude<DrawKind, 'pencil'>, a: Pt, b: Pt, shift: boolean, alt: boolean): ShapeGeom {
  if (kind === 'line') {
    let [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    if (shift) {
      const ang = Math.round(Math.atan2(dy, dx) / SNAP45) * SNAP45;
      const len = Math.hypot(dx, dy);
      [dx, dy] = [Math.cos(ang) * len, Math.sin(ang) * len];
    }
    const e: Pt = [a[0] + dx, a[1] + dy];
    return { anchors: [[a[0], a[1]], e], closed: false, smooth: false, centre: [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2] };
  }
  if (kind === 'star') {
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (shift) ang = Math.round(ang / SNAP15) * SNAP15;
    const R = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = draw.points;
    const spiky = draw.spike > 0.01;
    const count = spiky ? n * 2 : n;
    const anchors: Pt[] = [];
    for (let k = 0; k < count; k++) {
      const r = spiky && k % 2 ? R * (1 - draw.spike) : R;
      const t = ang + (k * Math.PI * 2) / count;
      anchors.push([a[0] + Math.cos(t) * r, a[1] + Math.sin(t) * r]);
    }
    return { anchors, closed: true, smooth: false, centre: [a[0], a[1]] };
  }
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  if (shift) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * s;
    dy = Math.sign(dy || 1) * s;
  }
  const x0 = alt ? a[0] - dx : Math.min(a[0], a[0] + dx);
  const x1 = alt ? a[0] + dx : Math.max(a[0], a[0] + dx);
  const y0 = alt ? a[1] - dy : Math.min(a[1], a[1] + dy);
  const y1 = alt ? a[1] + dy : Math.max(a[1], a[1] + dy);
  const l = Math.min(x0, x1);
  const r = Math.max(x0, x1);
  const t = Math.min(y0, y1);
  const btm = Math.max(y0, y1);
  const cx = (l + r) / 2;
  const cy = (t + btm) / 2;
  if (kind === 'rect') return { anchors: [[l, t], [r, t], [r, btm], [l, btm]], closed: true, smooth: false, centre: [cx, cy] };
  if (kind === 'tri') return { anchors: [[cx, t], [r, btm], [l, btm]], closed: true, smooth: false, centre: [cx, (t + 2 * btm) / 3] };
  // Ellipse: eight anchors on the box's inscribed ellipse, joined by a smooth closed curve. Catmull–Rom through eight
  // points sags ~0.85 % inside a true ellipse between them; pushing the anchors out by half that splits the error.
  const rx = ((r - l) / 2) * 1.004;
  const ry = ((btm - t) / 2) * 1.004;
  const anchors: Pt[] = [];
  for (let k = 0; k < 8; k++) {
    const th = -Math.PI / 2 + (k * Math.PI) / 4;
    anchors.push([cx + Math.cos(th) * rx, cy + Math.sin(th) * ry]);
  }
  return { anchors, closed: true, smooth: true, centre: [cx, cy] };
}

/** Largest extent of a set of points (px): a shape smaller than a few px is a misclick, not a shape. */
export function extent(pts: Pt[]): number {
  let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
  for (const p of pts) {
    l = Math.min(l, p[0]);
    r = Math.max(r, p[0]);
    t = Math.min(t, p[1]);
    b = Math.max(b, p[1]);
  }
  return Math.max(r - l, b - t);
}
