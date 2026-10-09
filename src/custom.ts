import { parseHex } from './color';
import { copyFx, FX_DEFAULT, parseFx, type FxState } from './fx';
import type { Preset } from './presets';
import { SHAPES } from './field';
import { parseCustomSize, parseWallpaper, type CustomSize, type WallpaperId } from './wallpaper';
import { copyPts, defaultSoft, MAX_NODES, MIN_NODES, R_MAX, R_MIN, SLOT_COUNT, slotSerial, type NodeSpec, type Shape } from './store';

/** The pre-v6 single CS-06 slot. Still read (once) to migrate into the library; never written or removed. */
export const CUSTOM_KEY = 'gh.custom.v1';
/** The save library: `{ v: 1, slots: (null | { nodes, fx, savedAt, thumb? })[SLOT_COUNT] }`. */
export const SLOTS_KEY = 'gh.slots.v1';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const isShape = (v: unknown): v is Shape => typeof v === 'string' && (SHAPES as string[]).includes(v);

/** True when a node's softness differs from its shape's default (only then is it stored). */
const hasCustomSoft = (n: NodeSpec): boolean => n.soft !== undefined && Math.abs(n.soft - defaultSoft(n.shape)) > 1e-4;

export function customPreset(nodes: NodeSpec[], fx?: FxState, slot = 0): Preset {
  return {
    id: slotSerial(slot).toLowerCase().replace('-', ''),
    serial: slotSerial(slot),
    name: 'CUSTOM',
    colors: nodes.map((n) => n.hex),
    positions: nodes.map((n) => [n.x, n.y]),
    radii: nodes.map((n) => n.r),
    shapes: nodes.map((n) => {
      const soft = hasCustomSoft(n) ? n.soft : undefined;
      const opac = n.opac !== undefined && n.opac < 0.9999 ? n.opac : undefined;
      if (n.shape && n.shape !== 'circle') return { shape: n.shape, rot: n.rot ?? 0, pts: copyPts(n.pts), soft, opac };
      return soft !== undefined || opac !== undefined ? { soft, opac } : undefined;
    }),
    ...(fx ? { fx: copyFx(fx) } : {}),
  };
}

/** Wire format for one node: rounded, defaults omitted. The one node schema: CS slots, share links and the JSON export all use it. */
export function serialise(n: NodeSpec): Record<string, unknown> {
  const o: Record<string, unknown> = { x: round4(n.x), y: round4(n.y), r: round4(n.r), hex: n.hex };
  if (n.shape && n.shape !== 'circle') o.shape = n.shape;
  if (n.rot && n.shape !== 'stroke') o.rot = round4(n.rot);
  if (hasCustomSoft(n)) o.soft = round4(n.soft as number);
  if (n.opac !== undefined && n.opac < 0.9999) o.opac = round4(n.opac);
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

/** A parsed document: nodes, plus the optional fx and (share links only) the wallpaper target. */
export interface Doc {
  nodes: NodeSpec[];
  fx?: FxState;
  wp?: WallpaperId;
  cs?: CustomSize;
}

/** The document as plain JSON-able data: `{v:2, nodes, fx, wp?, cs?}`. `wp` / `cs` ride along only for share links and JSON export. */
export function serialiseDoc(nodes: NodeSpec[], fx: FxState, target?: { wp: WallpaperId; cs: CustomSize }): Record<string, unknown> {
  return { v: 2, nodes: nodes.map(serialise), fx: copyFx(fx), ...(target ? { wp: target.wp, cs: { ...target.cs } } : {}) };
}

/** Validate untrusted JSON data into node specs (+ optional fx / wallpaper). Bad entries are skipped; fewer than 2 survivors → null. */
export function parseDoc(data: unknown): Doc | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { v?: unknown; nodes?: unknown; fx?: unknown; wp?: unknown; cs?: unknown };
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
    if (typeof n.opac === 'number' && Number.isFinite(n.opac)) spec.opac = clamp(n.opac, 0, 1);
    out.push(spec);
  }
  if (out.length < MIN_NODES) return null;
  const doc: Doc = { nodes: out };
  if (d.fx && typeof d.fx === 'object') doc.fx = parseFx(d.fx);
  if (d.wp !== undefined) doc.wp = parseWallpaper(d.wp);
  if (d.cs && typeof d.cs === 'object') doc.cs = parseCustomSize(d.cs);
  return doc;
}

/** Same, from a JSON string. */
export function parseDocText(raw: string | null): Doc | null {
  if (!raw) return null;
  try {
    return parseDoc(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ----- save library (CS-06 … CS-13) -----------------------------------------------

interface SlotRecord {
  /** `serialiseDoc` output (no wallpaper target). */
  doc: Record<string, unknown>;
  savedAt: number;
  /** Small PNG data URL of the field at save time (optional: slots saved before it existed, or when it failed). */
  thumb?: string;
}

/**
 * The persisted library. `store.slots` holds the derived presets (the rest of the app only ever sees those);
 * this keeps the raw records, thumbnails and the storage round-trip.
 */
class SlotLibrary {
  private rec: (SlotRecord | null)[] = Array.from({ length: SLOT_COUNT }, () => null);

  /** Read storage (migrating a pre-v6 CS-06 into slot 0 the first time). Returns the derived presets. */
  load(): (Preset | null)[] {
    try {
      const raw = localStorage.getItem(SLOTS_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { v?: unknown; slots?: unknown } | null;
        if (d && d.v === 1 && Array.isArray(d.slots)) {
          for (let i = 0; i < SLOT_COUNT; i++) {
            const r = d.slots[i] as Partial<SlotRecord> | null | undefined;
            if (!r || typeof r !== 'object' || !parseDoc(r.doc)) continue;
            this.rec[i] = {
              doc: r.doc as Record<string, unknown>,
              savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0,
              thumb: typeof r.thumb === 'string' && r.thumb.startsWith('data:image/') ? r.thumb : undefined,
            };
          }
        }
      } else {
        // First run of the library: carry the single v5 CS-06 over. The old key stays untouched (rollback-safe).
        const old = localStorage.getItem(CUSTOM_KEY);
        const doc = parseDocText(old);
        if (doc) {
          const o = JSON.parse(old as string) as { savedAt?: unknown };
          this.rec[0] = { doc: serialiseDoc(doc.nodes, doc.fx ?? FX_DEFAULT), savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0 };
          if (!doc.fx) delete this.rec[0].doc.fx;
          this.persist();
        }
      }
    } catch {
      /* unreadable storage: start with an empty library */
    }
    return this.rec.map((_, i) => this.preset(i));
  }

  preset(i: number): Preset | null {
    const r = this.rec[i];
    const doc = r ? parseDoc(r.doc) : null;
    return doc ? customPreset(doc.nodes, doc.fx, i) : null;
  }

  thumb(i: number): string | null {
    return this.rec[i]?.thumb ?? null;
  }

  savedAt(i: number): number {
    return this.rec[i]?.savedAt ?? 0;
  }

  /** Store the field in slot `i`. `persisted` is false in private mode / over quota (the slot lives for this session). */
  save(i: number, nodes: NodeSpec[], fx: FxState): { preset: Preset; persisted: boolean } {
    const doc = serialiseDoc(nodes, fx);
    this.rec[i] = { doc, savedAt: Date.now() };
    return { preset: customPreset(nodes, fx, i), persisted: this.persist() };
  }

  /** Attach the thumbnail once it has rendered (only if the slot has not been replaced meanwhile). */
  setThumb(i: number, savedAt: number, thumb: string): void {
    const r = this.rec[i];
    if (!r || r.savedAt !== savedAt) return;
    r.thumb = thumb;
    this.persist();
  }

  clear(i: number): boolean {
    this.rec[i] = null;
    return this.persist();
  }

  private persist(): boolean {
    const write = (thumbs: boolean): void =>
      localStorage.setItem(
        SLOTS_KEY,
        JSON.stringify({ v: 1, slots: this.rec.map((r) => (r ? { doc: r.doc, savedAt: r.savedAt, ...(thumbs && r.thumb ? { thumb: r.thumb } : {}) } : null)) }),
      );
    try {
      write(true);
      return true;
    } catch {
      try {
        write(false); // quota: the thumbnails are the bulk, the sets matter more
        return true;
      } catch {
        return false;
      }
    }
  }
}

export const library = new SlotLibrary();
