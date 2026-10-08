export type Pt = [number, number];

/** Squared distance from (px,py) to segment a→b. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  const t = l2 > 1e-12 ? Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby) / l2)) : 0;
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return dx * dx + dy * dy;
}

/**
 * Minimum distance from (px,py) to a polyline. Point k sits at (ox + pts[k][0]·scale, oy + pts[k][1]·scale),
 * so offset-style strokes can be tested without allocating.
 */
export function distToPolyline(pts: Pt[], px: number, py: number, ox = 0, oy = 0, scale = 1): number {
  if (pts.length === 0) return Infinity;
  let ax = ox + pts[0][0] * scale;
  let ay = oy + pts[0][1] * scale;
  let best = (px - ax) * (px - ax) + (py - ay) * (py - ay);
  for (let k = 1; k < pts.length; k++) {
    const bx = ox + pts[k][0] * scale;
    const by = oy + pts[k][1] * scale;
    best = Math.min(best, segDist2(px, py, ax, ay, bx, by));
    ax = bx;
    ay = by;
  }
  return Math.sqrt(best);
}

/** Ramer–Douglas–Peucker, iterative (strokes can be long). Endpoints are always kept. */
export function rdp(points: Pt[], eps: number): Pt[] {
  const n = points.length;
  if (n < 3) return points.map((p) => [p[0], p[1]]);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const e2 = eps * eps;
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = lo + 1; k < hi; k++) {
      const d = segDist2(points[k][0], points[k][1], points[lo][0], points[lo][1], points[hi][0], points[hi][1]);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > e2 && at > 0) {
      keep[at] = 1;
      stack.push([lo, at], [at, hi]);
    }
  }
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push([points[k][0], points[k][1]]);
  return out;
}

/** RDP at `eps` px, loosening ×1.5 until at most `max` points remain. */
export function simplifyTo(points: Pt[], max = 64, eps = 1.5): Pt[] {
  let e = eps;
  let out = rdp(points, e);
  while (out.length > max) {
    e *= 1.5;
    out = rdp(points, e);
  }
  return out;
}

export function pathLength(points: Pt[]): number {
  let len = 0;
  for (let k = 1; k < points.length; k++) len += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
  return len;
}

/** Arc-length weighted midpoint average. Degenerate (zero-length) paths fall back to the plain mean. */
export function centroid(points: Pt[]): Pt {
  let sx = 0;
  let sy = 0;
  let sl = 0;
  for (let k = 1; k < points.length; k++) {
    const l = Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
    sx += ((points[k][0] + points[k - 1][0]) / 2) * l;
    sy += ((points[k][1] + points[k - 1][1]) / 2) * l;
    sl += l;
  }
  if (sl > 1e-9) return [sx / sl, sy / sl];
  if (!points.length) return [0, 0];
  const mx = points.reduce((a, p) => a + p[0], 0) / points.length;
  const my = points.reduce((a, p) => a + p[1], 0) / points.length;
  return [mx, my];
}
