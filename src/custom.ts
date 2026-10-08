import { parseHex } from './color';
import type { Preset } from './presets';
import { SHAPES } from './field';
import { copyPts, defaultSoft, MAX_NODES, MIN_NODES, R_MAX, R_MIN, type NodeSpec, type Shape } from './store';

export const CUSTOM_KEY = 'gh.custom.v1';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const isShape = (v: unknown): v is Shape => typeof v === 'string' && (SHAPES as string[]).includes(v);

/** True when a node's softness differs from its shape's default (only then is it stored). */
const hasCustomSoft = (n: NodeSpec): boolean => n.soft !== undefined && Math.abs(n.soft - defaultSoft(n.shape)) > 1e-4;

export function customPreset(nodes: NodeSpec[]): Preset {
  return {
    id: 'cs06',
    serial: 'CS-06',
    name: 'CUSTOM',
    colors: nodes.map((n) => n.hex),
    positions: nodes.map((n) => [n.x, n.y]),
    radii: nodes.map((n) => n.r),
    shapes: nodes.map((n) => {
      const soft = hasCustomSoft(n) ? n.soft : undefined;
      if (n.shape && n.shape !== 'circle') return { shape: n.shape, rot: n.rot ?? 0, pts: copyPts(n.pts), soft };
      return soft !== undefined ? { soft } : undefined;
    }),
  };
}

/** Wire format for one node: rounded, defaults omitted. */
function serialise(n: NodeSpec): Record<string, unknown> {
  const o: Record<string, unknown> = { x: round4(n.x), y: round4(n.y), r: round4(n.r), hex: n.hex };
  if (n.shape && n.shape !== 'circle') o.shape = n.shape;
  if (n.rot && n.shape !== 'stroke') o.rot = round4(n.rot);
  if (hasCustomSoft(n)) o.soft = round4(n.soft as number);
  if (n.shape === 'stroke') o.pts = (n.pts ?? []).map((p) => [round4(p[0]), round4(p[1])]);
  return o;
}

/** 2–64 finite pairs, each offset clamped to ±2; anything else is not a stroke. */
function parsePts(v: unknown): [number, number][] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > 64) return null;
  const out: [number, number][] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number') return null;
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    out.push([clamp(p[0], -2, 2), clamp(p[1], -2, 2)]);
  }
  return out;
}

/** Validate untrusted JSON into node specs. Bad entries are skipped; fewer than 2 survivors → null. */
function parse(raw: string | null): NodeSpec[] | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as { v?: unknown; nodes?: unknown };
  if ((d.v !== 1 && d.v !== 2) || !Array.isArray(d.nodes)) return null;
  const out: NodeSpec[] = [];
  for (const item of d.nodes) {
    if (out.length >= MAX_NODES) break;
    if (!item || typeof item !== 'object') continue;
    const n = item as Record<string, unknown>;
    const hex = typeof n.hex === 'string' ? parseHex(n.hex) : null;
    if (!hex || typeof n.x !== 'number' || typeof n.y !== 'number' || typeof n.r !== 'number') continue;
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.r)) continue;
    const spec: NodeSpec = { x: clamp(n.x, 0, 1), y: clamp(n.y, 0, 1), r: clamp(n.r, R_MIN, R_MAX), hex };
    if (d.v === 2) {
      const shape: Shape = isShape(n.shape) ? n.shape : 'circle';
      if (shape === 'stroke') {
        const pts = parsePts(n.pts);
        if (!pts) continue; // a stroke without a usable polyline is meaningless
        spec.shape = 'stroke';
        spec.pts = pts;
      } else if (shape !== 'circle') {
        spec.shape = shape;
        spec.rot = typeof n.rot === 'number' && Number.isFinite(n.rot) ? n.rot : 0;
      }
    }
    if (typeof n.soft === 'number' && Number.isFinite(n.soft)) spec.soft = clamp(n.soft, 0, 1);
    out.push(spec);
  }
  return out.length >= MIN_NODES ? out : null;
}

export function loadCustom(): Preset | null {
  try {
    const nodes = parse(localStorage.getItem(CUSTOM_KEY));
    return nodes ? customPreset(nodes) : null;
  } catch {
    return null;
  }
}

/** Forget the saved CS-06 set. Returns false if storage refused (the in-memory set is cleared anyway). */
export function clearCustom(): boolean {
  try {
    localStorage.removeItem(CUSTOM_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Returns the saved preset and whether it reached storage (false in private mode / quota errors). */
export function saveCustom(nodes: NodeSpec[]): { preset: Preset; persisted: boolean } {
  const preset = customPreset(nodes);
  let persisted = true;
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify({ v: 2, nodes: nodes.map(serialise), savedAt: Date.now() }));
  } catch {
    persisted = false;
  }
  return { preset, persisted };
}
