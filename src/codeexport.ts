import { coreWeight, hexToRgb, labToHex, LAYER_K, sampleField, softTail } from './color';
import { serialiseDoc } from './custom';
import { CAPSULE_L, CAPSULE_T, ELLIPSE_RATIO, FieldBuffers, packField } from './field';
import { FRAG, VERT, WARP } from './gradient';
import { snapshotSpecs, type Dim, type NodeState, type Store } from './store';
import { wallpaperTarget } from './wallpaper';

/** The four tabs of CODE [X]. */
export type CodeTab = 'glsl' | 'json' | 'css' | 'svg';

/** Frozen time for the uniform dump: the same constant reduced-motion mode and the exporter's quick render use. */
const T0 = 0.5;

const n2 = (v: number): string => String(Math.round(v * 100) / 100);
const n4 = (v: number): string => String(Math.round(v * 1e4) / 1e4);

/** The wallpaper target as a canvas: node centres keep (x·W, y·H); every size uses the area-matched unit (see exporter.ts). */
function targetDim(store: Store, stage: Dim): Dim {
  const t = wallpaperTarget(store.wallpaper, store.wpCustom);
  return { w: t.w, h: t.h, min: stage.min * Math.sqrt((t.w * t.h) / (stage.w * stage.h)) };
}

// ----- GLSL ----------------------------------------------------------------------

const b64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** The shaders as shipped (gradient.ts, verbatim) plus the uniform values that reproduce the current field at the wallpaper target. */
export function buildGlsl(store: Store, stage: Dim): string {
  const d = targetDim(store, stage);
  const buf = new FieldBuffers();
  packField(store, d, buf, true);
  const arr = (a: Float32Array): string => `[${Array.from(a, n4).join(', ')}]`;
  const strokes = store.nodes.some((n) => n.shape === 'stroke');
  const uniforms = [
    `  u_res: [${d.w}, ${d.h}],`,
    `  u_css: [${d.w}, ${d.h}],`,
    `  u_scale: 1,`,
    `  u_count: ${buf.count},`,
    `  u_time: ${T0},`,
    `  u_grain: 0.05,`,
    `  u_min: ${n2(d.min)},`,
    `  u_warp: ${n2(d.min * WARP)},`,
    `  u_pos: ${arr(buf.positions)},`,
    `  u_rad: ${arr(buf.radii)},`,
    `  u_lab: ${arr(buf.lab)},`,
    `  u_shape: ${arr(buf.shape)},`,
    `  u_rot: ${arr(buf.rot)},`,
    `  u_npts: ${arr(buf.npts)},`,
    `  u_soft: ${arr(buf.soft)},`,
    `  u_opac: ${arr(buf.opac)},`,
    strokes
      ? `  u_pts: '${b64(buf.points)}', // base64 of the 64×16 RGBA8 stroke texture (NEAREST, CLAMP_TO_EDGE) on unit 0`
      : `  // u_pts: no strokes in this field; bind any 64×16 RGBA8 texture`,
  ].join('\n');
  return [
    `// GRADIENT HANDLES // GLSL // ${store.nodes.length} NODES // ${d.w}×${d.h}`,
    `// WebGL1 / GLSL ES 1.00. Draw one fullscreen triangle (a_pos on attribute 0: -1,-1  3,-1  -1,3) with both shaders.`,
    `// OKLab colours, up to 16 nodes. The FX stack (grain, dither, chroma, scan, vig) is a separate post pass and is not included.`,
    `// The warp is time-driven; u_time is frozen at ${T0} below. u_grain 0.05 is the exporter's value (0 = clean).`,
    ``,
    `// ===== vertex shader =====`,
    VERT.trim(),
    ``,
    `// ===== fragment shader =====`,
    FRAG.trim(),
    ``,
    `// ===== uniforms for this field (JS) =====`,
    `/*`,
    `const uniforms = {`,
    uniforms,
    `};`,
    `*/`,
    ``,
  ].join('\n');
}

// ----- JSON ----------------------------------------------------------------------

/** The document: the CS-06 / share-link schema, plus the wallpaper target. Pairs of numbers stay on one line. */
export function buildJson(store: Store): string {
  const doc = serialiseDoc(snapshotSpecs(store), store.fx, { wp: store.wallpaper, cs: store.wpCustom });
  // Flat objects (a node, fx, the target size) go on one line; arrays of numbers (stroke points) stay compact.
  return (
    JSON.stringify(doc, null, 2)
      .replace(/\{\n\s+([^{}[\]]*?)\n\s+\}/g, (_m, body: string) => `{ ${body.replace(/\n\s+/g, ' ')} }`)
      .replace(/\[\s+(-?[\d.e-]+),\s+(-?[\d.e-]+)\s+\]/g, '[$1, $2]') + '\n'
  );
}

// ----- shared approximation helpers -------------------------------------------------

/** Radial profile in units of the node's reach q: 0 … Q_MAX. Alpha mirrors the shader's weight (core + tail), layered at LAYER_K. */
const Q_MAX = 2;
const Q_STOPS = [0, 0.3, 0.6, 0.9, 1.2, 1.6, 2];

function profile(n: NodeState): { at: number; a: number }[] {
  return Q_STOPS.map((q, i) => {
    const tail = softTail(n.soft) / (1 + q ** 4);
    const a = i === Q_STOPS.length - 1 ? 0 : Math.min(1, n.opac * (LAYER_K * coreWeight(q, n.soft) + tail));
    return { at: q / Q_MAX, a: Math.round(a * 100) / 100 };
  });
}

/** The far-field colour (every node at q = 3): what sits behind all the soft shapes. */
function baseHex(store: Store): string {
  return labToHex(sampleField(store.nodes.map((n) => ({ q: 3, lab: n.labTo, soft: n.soft, opac: n.opac }))));
}

interface Blob2D {
  /** Centre and half-extents in px at the target size (extent = reach of the profile, 2 × the node's q = 1 radius). */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Degrees, clockwise (only SVG can use it). */
  rot: number;
}

/** Reduce a node to ellipses (a stroke becomes up to 12 circles along its polyline). Boxes are circles; capsules ellipses. */
function blobs(n: NodeState, cx: number, cy: number, r: number, u: number): Blob2D[] {
  const R = r * Q_MAX;
  const deg = (n.rot * 180) / Math.PI;
  if (n.shape === 'stroke') {
    const k = Math.min(12, n.pts.length);
    const out: Blob2D[] = [];
    for (let i = 0; i < k; i++) {
      const p = n.pts[k === 1 ? 0 : Math.round((i * (n.pts.length - 1)) / (k - 1))];
      out.push({ cx: cx + p[0] * u, cy: cy + p[1] * u, rx: R, ry: R, rot: 0 });
    }
    return out;
  }
  if (n.shape === 'ellipse') return [{ cx, cy, rx: R, ry: R * ELLIPSE_RATIO, rot: deg }];
  if (n.shape === 'capsule') return [{ cx, cy, rx: (CAPSULE_L + CAPSULE_T * Q_MAX) * r, ry: CAPSULE_T * R, rot: deg }];
  return [{ cx, cy, rx: n.shape === 'box' ? R * 1.06 : R, ry: n.shape === 'box' ? R * 1.06 : R, rot: 0 }];
}

function layout(store: Store, stage: Dim): { d: Dim; items: { n: NodeState; blobs: Blob2D[]; hex: string }[] } {
  const d = targetDim(store, stage);
  const items = store.nodes.map((n) => ({
    n,
    // settled targets, like the exporter
    blobs: blobs(n, n.x * d.w, n.y * d.h, n.r * d.min, d.min),
    hex: n.hex,
  }));
  return { d, items };
}

const rgba = (hex: string, a: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
};

// ----- CSS -----------------------------------------------------------------------

/** Stacked radial-gradients (front node first) over the far-field colour. Axis-aligned: CSS cannot rotate a gradient. */
export function buildCss(store: Store, stage: Dim): string {
  const { d, items } = layout(store, stage);
  const layers: string[] = [];
  for (const { n, blobs: bs, hex } of [...items].reverse()) {
    const stops = profile(n).map((s) => `${rgba(hex, s.a)} ${n2(s.at * 100)}%`).join(', ');
    for (const b of [...bs].reverse()) {
      // A 90°-ish rotation swaps the axes; anything else stays as drawn (unrotated).
      const swap = Math.abs(Math.sin((b.rot * Math.PI) / 180)) > 0.7071;
      const rx = swap ? b.ry : b.rx;
      const ry = swap ? b.rx : b.ry;
      const size = Math.abs(rx - ry) < 0.5 ? `circle ${Math.round(rx)}px` : `ellipse ${Math.round(rx)}px ${Math.round(ry)}px`;
      layers.push(`    radial-gradient(${size} at ${n2((b.cx / d.w) * 100)}% ${n2((b.cy / d.h) * 100)}%, ${stops})`);
    }
  }
  return [
    `/* GRADIENT HANDLES // CSS // ${store.nodes.length} NODES — an APPROXIMATION.`,
    `   Plain radial-gradients cannot do the OKLab blend, the domain warp, softness curves or FX, and cannot rotate;`,
    `   rotated shapes snap to the nearest axis, boxes become circles, strokes become a chain of circles.`,
    `   Sizes are px for a ${d.w}×${d.h} canvas (positions are %): scale the px values for any other size. */`,
    `.gradient {`,
    `  background-color: ${baseHex(store)};`,
    `  background-image:`,
    layers.join(',\n') + ';',
    `}`,
    ``,
  ].join('\n');
}

// ----- SVG -----------------------------------------------------------------------

/** One radialGradient per node (the profile), one ellipse per blob, strokes as a blurred polyline group. */
export function buildSvg(store: Store, stage: Dim): string {
  const { d, items } = layout(store, stage);
  const defs: string[] = [];
  const shapes: string[] = [];
  const strokes: string[] = [];
  items.forEach(({ n, blobs: bs, hex }, i) => {
    if (n.shape === 'stroke') {
      const cx = n.x * d.w;
      const cy = n.y * d.h;
      const pts = n.pts.map((p) => `${n2(cx + p[0] * d.min)},${n2(cy + p[1] * d.min)}`).join(' ');
      strokes.push(
        `    <polyline points="${pts}" fill="none" stroke="${hex}" stroke-opacity="${n2(n.opac * 0.8)}" stroke-width="${n2(n.r * d.min * 0.9)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
      return;
    }
    const id = `n${i + 1}`;
    defs.push(
      `    <radialGradient id="${id}">` +
        profile(n).map((s) => `<stop offset="${n2(s.at)}" stop-color="${hex}" stop-opacity="${s.a}"/>`).join('') +
        `</radialGradient>`,
    );
    for (const b of bs) {
      const rot = Math.abs(b.rot) > 0.01 ? ` transform="rotate(${n2(b.rot)} ${n2(b.cx)} ${n2(b.cy)})"` : '';
      shapes.push(`    <ellipse cx="${n2(b.cx)}" cy="${n2(b.cy)}" rx="${n2(b.rx)}" ry="${n2(b.ry)}" fill="url(#${id})"${rot}/>`);
    }
  });
  const blur = n2(d.min * 0.012);
  return [
    `<!-- GRADIENT HANDLES // SVG // ${store.nodes.length} NODES — an APPROXIMATION: plain radial gradients, no OKLab blend, warp, softness curves or FX.`,
    `     Strokes are blurred polylines (drop filter="url(#blur)" for crisp ones). -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.w} ${d.h}" width="${d.w}" height="${d.h}">`,
    `  <defs>`,
    ...defs,
    `    <filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur}"/></filter>`,
    `  </defs>`,
    `  <rect width="${d.w}" height="${d.h}" fill="${baseHex(store)}"/>`,
    ...shapes,
    ...(strokes.length ? [`  <g filter="url(#blur)">`, ...strokes, `  </g>`] : []),
    `</svg>`,
    ``,
  ].join('\n');
}

export function buildCode(tab: CodeTab, store: Store, stage: Dim): string {
  switch (tab) {
    case 'glsl': return buildGlsl(store, stage);
    case 'json': return buildJson(store);
    case 'css': return buildCss(store, stage);
    default: return buildSvg(store, stage);
  }
}
