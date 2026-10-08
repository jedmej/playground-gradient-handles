export type Lab = [number, number, number];

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function toSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

/** Accepts `#abc`, `abc`, `#aabbcc`, `aabbcc` (any case). Returns `#AABBCC` or null. */
export function parseHex(input: string): string | null {
  const h = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  if (h.length === 3) return `#${h.split('').map((c) => c + c).join('')}`.toUpperCase();
  if (h.length === 6) return `#${h}`.toUpperCase();
  return null;
}

export interface FieldSample {
  /** Normalised distance to the node (shape-aware, see `nodeQ` in field.ts). */
  q: number;
  lab: Lab;
  /** Softness 0–1. */
  soft: number;
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Falloff exponent of the core term: soft 0 → plateau with a crisp edge, 0.5 → gaussian, 1 → wide haze. */
export function softP(soft: number): number {
  return soft < 0.5 ? mix(8, 2, soft * 2) : mix(2, 1.15, (soft - 0.5) * 2);
}

/** Weight of the far inverse-distance tail. */
export function softTail(soft: number): number {
  return soft < 0.5 ? mix(0.004, 0.05, soft * 2) : mix(0.05, 0.14, (soft - 0.5) * 2);
}

/** Core term of a node's weight (no tail); also the layer opacity before LAYER_K. */
export function coreWeight(q: number, soft: number): number {
  return Math.exp(-1.5 * Math.pow(Math.max(q, 1e-4), softP(soft)));
}

/** Layers: how much of its own colour a node's core paints over everything beneath it. */
export const LAYER_K = 0.85;

/**
 * CPU twin of the shader's compositing (no domain warp). The normalised weighted OKLab average is the base;
 * then, back → front (array order), each node's core is mixed over it. Returns the OKLab colour.
 */
export function sampleField(nodes: FieldSample[]): Lab {
  const acc: Lab = [0, 0, 0];
  let wsum = 0;
  const cores: number[] = [];
  for (const n of nodes) {
    const q2 = n.q * n.q;
    const core = coreWeight(n.q, n.soft);
    cores.push(core);
    const w = core + softTail(n.soft) / (1 + q2 * q2);
    acc[0] += n.lab[0] * w;
    acc[1] += n.lab[1] * w;
    acc[2] += n.lab[2] * w;
    wsum += w;
  }
  if (!(wsum > 0)) return [0, 0, 0];
  const col: Lab = [acc[0] / wsum, acc[1] / wsum, acc[2] / wsum];
  nodes.forEach((n, i) => {
    const a = LAYER_K * cores[i];
    col[0] = mix(col[0], n.lab[0], a);
    col[1] = mix(col[1], n.lab[1], a);
    col[2] = mix(col[2], n.lab[2], a);
  });
  return col;
}

export function labToHex(lab: Lab): string {
  const [L, a, b] = lab;
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const to = (c: number) =>
    Math.round(toSrgb(c) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(bb)}`.toUpperCase();
}
