import { parseHex } from './color';
import type { Preset } from './presets';
import { MAX_NODES, MIN_NODES, R_MAX, R_MIN, type NodeSpec } from './store';

export const CUSTOM_KEY = 'gh.custom.v1';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function customPreset(nodes: NodeSpec[]): Preset {
  return {
    id: 'cs06',
    serial: 'CS-06',
    name: 'CUSTOM',
    colors: nodes.map((n) => n.hex),
    positions: nodes.map((n) => [n.x, n.y]),
    radii: nodes.map((n) => n.r),
  };
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
  if (d.v !== 1 || !Array.isArray(d.nodes)) return null;
  const out: NodeSpec[] = [];
  for (const item of d.nodes) {
    if (out.length >= MAX_NODES) break;
    if (!item || typeof item !== 'object') continue;
    const n = item as Record<string, unknown>;
    const hex = typeof n.hex === 'string' ? parseHex(n.hex) : null;
    if (!hex || typeof n.x !== 'number' || typeof n.y !== 'number' || typeof n.r !== 'number') continue;
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.r)) continue;
    out.push({ x: clamp(n.x, 0, 1), y: clamp(n.y, 0, 1), r: clamp(n.r, R_MIN, R_MAX), hex });
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

/** Returns the saved preset and whether it reached storage (false in private mode / quota errors). */
export function saveCustom(nodes: NodeSpec[]): { preset: Preset; persisted: boolean } {
  const preset = customPreset(nodes);
  let persisted = true;
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify({ v: 1, nodes, savedAt: Date.now() }));
  } catch {
    persisted = false;
  }
  return { preset, persisted };
}
