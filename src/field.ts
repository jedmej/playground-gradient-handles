import { labToHex, sampleField } from './color';
import { distToPolyline } from './geom';
import { MAX_NODES, type Dim, type NodeState, type Shape, type Store } from './store';

/** Fixed per-shape aspect (no UI for it). */
export const ELLIPSE_RATIO = 0.45; // minor / major
export const CAPSULE_T = 0.35; // thickness as a fraction of r
export const CAPSULE_L = 0.6; // half-length as a fraction of r
export const BOX_EXP = 6; // superellipse exponent → rounded square
/** Body hit radius, in units of q (ellipse / box / capsule). */
export const BODY_Q = 0.45;

export const MAX_PTS = 64;
/** Shader shape ids. */
export const SHAPE_ID: Record<Shape, number> = { circle: 0, ellipse: 1, box: 2, capsule: 3, stroke: 4 };
export const SHAPES: Shape[] = ['circle', 'ellipse', 'box', 'capsule', 'stroke'];

/** Stroke point texture packs x/y over [-0.5, 1.5] × the canvas CSS size. */
const PACK_LO = -0.5;
const PACK_SPAN = 2;

/**
 * Normalised distance of canvas point (px, py) to a node, in the node's own shape. Mirrors the shader
 * (no warp). Uses display values (dx/dy/dr/drot) unless `target` is set. `dim` is the canvas size in px.
 */
export function nodeQ(n: NodeState, px: number, py: number, dim: Dim, target = false): number {
  const cx = (target ? n.x : n.dx) * dim.w;
  const cy = (target ? n.y : n.dy) * dim.h;
  const r = Math.max(1e-3, (target ? n.r : n.dr) * dim.min);
  if (n.shape === 'stroke') return distToPolyline(n.pts, px, py, cx, cy, dim.min) / r;
  const rot = target ? n.rot : n.drot;
  const dx = px - cx;
  const dy = py - cy;
  if (n.shape === 'circle') return Math.hypot(dx, dy) / r;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const lx = c * dx + s * dy;
  const ly = -s * dx + c * dy;
  switch (n.shape) {
    case 'ellipse':
      return Math.hypot(lx, ly / ELLIPSE_RATIO) / r;
    case 'box': {
      const ax = Math.max(Math.abs(lx), 1e-4);
      const ay = Math.max(Math.abs(ly), 1e-4);
      return Math.pow(Math.pow(ax, BOX_EXP) + Math.pow(ay, BOX_EXP), 1 / BOX_EXP) / r;
    }
    default: {
      const L = CAPSULE_L * r;
      return Math.hypot(Math.max(Math.abs(lx) - L, 0), ly) / (CAPSULE_T * r);
    }
  }
}

/** Colour of the live field (no warp) at a normalised point. */
export function fieldHexAt(store: Store, nx: number, ny: number, dim: Dim): string {
  const px = nx * dim.w;
  const py = ny * dim.h;
  return labToHex(sampleField(store.nodes.map((n) => ({ q: nodeQ(n, px, py, dim), lab: n.lab, soft: n.dsoft }))));
}

/** Rotate local offset (x, y) by `rot` (y-down screen space, positive = clockwise). */
function rotated(x: number, y: number, rot: number): [number, number] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [x * c - y * s, x * s + y * c];
}

/**
 * Closed outline of a non-stroke shape at q = BODY_Q, relative to the node centre, in px.
 * Used by the handles overlay (hover/selected outline).
 */
export function outlinePoints(shape: Shape, rPx: number, rot: number): [number, number][] {
  const out: [number, number][] = [];
  const push = (x: number, y: number): void => {
    out.push(rotated(x, y, rot));
  };
  if (shape === 'ellipse') {
    const a = BODY_Q * rPx;
    const b = a * ELLIPSE_RATIO;
    for (let k = 0; k < 48; k++) {
      const t = (k / 48) * Math.PI * 2;
      push(a * Math.cos(t), b * Math.sin(t));
    }
  } else if (shape === 'box') {
    const a = BODY_Q * rPx;
    const e = 2 / BOX_EXP;
    for (let k = 0; k < 64; k++) {
      const t = (k / 64) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      push(a * Math.sign(c) * Math.pow(Math.abs(c), e), a * Math.sign(s) * Math.pow(Math.abs(s), e));
    }
  } else if (shape === 'capsule') {
    const R = BODY_Q * CAPSULE_T * rPx;
    const L = CAPSULE_L * rPx;
    for (let k = 0; k <= 16; k++) {
      const t = -Math.PI / 2 + (k / 16) * Math.PI;
      push(L + R * Math.cos(t), R * Math.sin(t));
    }
    for (let k = 0; k <= 16; k++) {
      const t = Math.PI / 2 + (k / 16) * Math.PI;
      push(-L + R * Math.cos(t), R * Math.sin(t));
    }
  }
  return out;
}

/** Everything the shader needs for one frame, as reusable typed arrays. */
export class FieldBuffers {
  readonly positions = new Float32Array(MAX_NODES * 2);
  readonly radii = new Float32Array(MAX_NODES);
  readonly lab = new Float32Array(MAX_NODES * 3);
  readonly shape = new Float32Array(MAX_NODES);
  readonly rot = new Float32Array(MAX_NODES);
  readonly npts = new Float32Array(MAX_NODES);
  readonly soft = new Float32Array(MAX_NODES);
  /** 64 × 16 RGBA8, row i = node i. */
  readonly points = new Uint8Array(MAX_PTS * MAX_NODES * 4);
  count = 0;
}

function pack16(unit: number): number {
  return Math.round(Math.min(1, Math.max(0, unit)) * 65535);
}

/**
 * Fill `buf` for a canvas of CSS size `dim`. Live frames read the smoothed display values; export
 * (`target = true`) reads the settled targets so the PNG matches where everything is going.
 */
export function packField(store: Store, dim: Dim, buf: FieldBuffers, target = false): void {
  const count = Math.min(MAX_NODES, store.nodes.length);
  buf.count = count;
  for (let i = 0; i < count; i++) {
    const n = store.nodes[i];
    const cx = (target ? n.x : n.dx) * dim.w;
    const cy = (target ? n.y : n.dy) * dim.h;
    buf.positions[i * 2] = cx;
    buf.positions[i * 2 + 1] = cy;
    buf.radii[i] = (target ? n.r : n.dr) * dim.min;
    buf.lab.set(target ? n.labTo : n.lab, i * 3);
    buf.shape[i] = SHAPE_ID[n.shape];
    buf.rot[i] = target ? n.rot : n.drot;
    buf.soft[i] = target ? n.soft : n.dsoft;
    const np = n.shape === 'stroke' ? Math.min(MAX_PTS, n.pts.length) : 0;
    buf.npts[i] = np;
    for (let k = 0; k < np; k++) {
      const x = cx + n.pts[k][0] * dim.min;
      const y = cy + n.pts[k][1] * dim.min;
      const vx = pack16((x / dim.w - PACK_LO) / PACK_SPAN);
      const vy = pack16((y / dim.h - PACK_LO) / PACK_SPAN);
      const o = (i * MAX_PTS + k) * 4;
      buf.points[o] = vx >> 8;
      buf.points[o + 1] = vx & 255;
      buf.points[o + 2] = vy >> 8;
      buf.points[o + 3] = vy & 255;
    }
  }
}
