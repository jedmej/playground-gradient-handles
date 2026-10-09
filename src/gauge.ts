/**
 * One gauge renderer for the whole app: the FX dial's rings and a node's OPAC / SOFT / ROT dials are the same object.
 * An arc that runs almost all the way round, its gap at 6 o'clock just wide enough for the name chip (0 at the lower
 * left, clockwise through the top), halo + ink base, 11 ticks, a SIGNAL fill, a notch at the value, a value arc on the
 * knob and a black mono name chip in the bottom gap (`GRAIN`).
 * Styles live under `.gring` in styles.css; state classes (`is-hover`, `is-drag`, `is-off`, `is-active`) are set by the owner.
 */
const NS = 'http://www.w3.org/2000/svg';

/** Screen angle (y down, clockwise positive) of value 0, and the sweep to value 1. */
export const G_START = (135 * Math.PI) / 180;
export const G_SPAN = (270 * Math.PI) / 180;
/**
 * The one spacing rule for gauge stacks, shared by the FX dial and the node gauges: ring spacing `sp` is sized so five
 * rings plus a bezel fit the stage (30 px on a big stage, shrinking on small ones), and ring `i` (innermost = 0) sits at
 * `r0 + i * sp` with `r0 = 1.5 * sp`.
 */
export function gaugeSpacing(w: number, h: number): { sp: number; r0: number } {
  const rmax = Math.max(40, Math.min(Math.min(w, h) / 2 - 4, 215));
  const sp = Math.max(9, Math.min(30, (rmax - 14) / 6.6));
  return { sp, r0: 1.5 * sp };
}

/**
 * The one hit rule for a gauge ring of radius `r`: the pointer at offset (dx, dy) from the centre is "on" it when it is
 * within half a ring spacing of the ring's centre line, at any angle (the bottom gap counts, so the ring does not let go
 * of the pointer there). Returns the radial distance to the ring (smaller = nearer) or null when off it.
 */
export function gaugeHit(r: number, dx: number, dy: number, sp: number): number | null {
  const e = Math.abs(Math.hypot(dx, dy) - r);
  return e <= sp / 2 ? e : null;
}

/** A gauge's sweep: screen angle of value 0 and the clockwise span to value 1 (the gap is centred at 6 o'clock). */
export interface Sweep {
  a0: number;
  span: number;
}
export const SWEEP_270: Readonly<Sweep> = { a0: G_START, span: G_SPAN };

export const gaugePt = (ri: number, t: number, dr = 0, sw: Sweep = SWEEP_270): string => {
  const a = sw.a0 + sw.span * t;
  return `${((ri + dr) * Math.cos(a)).toFixed(2)} ${((ri + dr) * Math.sin(a)).toFixed(2)}`;
};

export function gaugeArc(ri: number, t0: number, t1: number, sw: Sweep = SWEEP_270): string {
  if (t1 - t0 < 0.002) return '';
  return `M${gaugePt(ri, t0, 0, sw)}A${ri.toFixed(2)} ${ri.toFixed(2)} 0 ${(t1 - t0) * sw.span > Math.PI ? 1 : 0} 1 ${gaugePt(ri, t1, 0, sw)}`;
}

/**
 * Pointer angle (dx, dy from the centre) → 0…1 along sweep `sw`. In the gap the value sticks to the end it came from
 * (`prev`), and it never jumps across the gap mid-drag.
 */
export function sweepT(sw: Sweep, dx: number, dy: number, prev: number): number {
  const TAU = Math.PI * 2;
  const u = (((Math.atan2(dy, dx) - sw.a0) % TAU) + TAU) % TAU;
  let t = u / sw.span;
  if (t > 1) t = u > sw.span + (TAU - sw.span) / 2 ? 0 : 1;
  if (Math.abs(t - prev) > 0.6) t = prev > 0.5 ? 1 : 0;
  return t;
}

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
};

export interface GaugeParts {
  g: SVGGElement;
  baseH: SVGPathElement;
  baseI: SVGPathElement;
  ticksH: SVGPathElement;
  ticksI: SVGPathElement;
  fillH: SVGPathElement;
  fillI: SVGPathElement;
  knobH: SVGPathElement;
  knobI: SVGPathElement;
  tag: SVGGElement;
  tagBg: SVGRectElement;
  tagText: SVGTextElement;
  /**
   * Value arc: a short curved band on the gauge's own arc, centred on the current value, with the value written along
   * it (the label's value part: `50`, `045°`, `9 LV`). It slides round with the knob, like the size ring's bearing arc.
   */
  val: SVGGElement;
  valBg: SVGPathElement;
  valPath: SVGPathElement;
  valText: SVGTextElement;
  valTp: SVGTextPathElement;
  valLabel: string;
  /** Last value / text width / radius the band was built for (it is rebuilt only when one changes). */
  valKey: string;
  r: number;
  sp: number;
  label: string;
  t: number;
  /** Name in the bottom chip (`OPAC`, `GRAIN`); fixed per gauge, it sizes the gap. */
  name: string;
  /** Extra px kept clear on each side of the chip (the FX dial's × square). */
  pad: number;
  /** This gauge's sweep: the arc runs almost all the way round, stopping just short of its name chip. */
  sw: Sweep;
}

export function makeGauge(cls: string, name = '', pad = 0): GaugeParts {
  const p = (c: string): SVGPathElement => el('path', { class: c });
  const g = el('g', { class: `gring ${cls}` });
  const v: GaugeParts = {
    g, r: 0, sp: 0, label: '', t: -1, name, pad, sw: { ...SWEEP_270 },
    baseH: p('halo base'), baseI: p('ink base'), ticksH: p('halo gticks'), ticksI: p('ink gticks'),
    fillH: p('halo fill'), fillI: p('ink fill'), knobH: p('halo knob'), knobI: p('ink knob'),
    tag: el('g', { class: 'fx-tag' }), tagBg: el('rect', { class: 'tag-bg', height: 14, y: -7 }),
    tagText: el('text', { class: 'tag-text', 'text-anchor': 'middle', y: 3 }),
    val: el('g', { class: 'val' }), valBg: el('path', { class: 'val-bg' }),
    valPath: el('path', { id: `gval-${++valSeq}`, fill: 'none', stroke: 'none' }),
    valText: el('text', { class: 'val-text', 'text-anchor': 'middle', 'dominant-baseline': 'central' }),
    valTp: el('textPath', { startOffset: '50%' }), valLabel: '', valKey: '',
  };
  v.valTp.setAttribute('href', `#gval-${valSeq}`);
  v.valText.appendChild(v.valTp);
  v.tag.append(v.tagBg, v.tagText);
  v.val.append(v.valPath, v.valBg, v.valText);
  g.append(v.baseH, v.baseI, v.ticksH, v.ticksI, v.fillH, v.fillI, v.knobH, v.knobI, v.val, v.tag);
  return v;
}

/** Geometry for radius `r` with ring spacing `sp`: base arc, ticks, the chip in the bottom gap. Call when either changes. */
export function layoutGauge(v: GaugeParts, r: number, sp: number): void {
  v.r = r;
  v.sp = sp;
  const half = Math.min(4.5, sp * 0.3);
  const fs = Math.max(7.5, Math.min(9.5, sp * 0.36));
  // Sweep: the arc runs round to a little short of the name chip in the bottom gap (chip half-width + pad + 14 px, so
  // the 0 / max ends, their knob and value arc stay clear of the name), leaving a short name an almost full circle.
  // Never less than 270° of travel, never past 340°.
  const chipHalf = v.name ? Math.ceil(v.name.length * (fs * 0.62 + fs * 0.06) + 10) / 2 : r * 0.7;
  const clear = Math.min(r * 0.99, chipHalf + v.pad + 14);
  const gap = Math.min(Math.PI / 2, Math.max((20 * Math.PI) / 180, 2 * Math.asin(clear / Math.max(1, r))));
  v.sw = { a0: Math.PI / 2 + gap / 2, span: Math.PI * 2 - gap };
  const sw = v.sw;
  const base = gaugeArc(r, 0, 1, sw);
  v.baseH.setAttribute('d', base);
  v.baseI.setAttribute('d', base);
  let t = '';
  for (let k = 0; k <= 10; k++) {
    const h = half * (k % 5 ? 0.6 : 1);
    t += `M${gaugePt(r, k / 10, -h, sw)}L${gaugePt(r, k / 10, h, sw)}`;
  }
  v.ticksH.setAttribute('d', t);
  v.ticksI.setAttribute('d', t);
  v.g.style.setProperty('--fx-fs', `${fs}px`);
  v.tag.setAttribute('transform', `translate(0 ${r.toFixed(1)})`);
  v.t = -1;
  v.label = '';
  v.valLabel = '';
  v.valKey = '';
}

/** Value `t` (0…1; `off` hides the fill) and the chip text. Cheap when nothing changed. */
let valSeq = 0;
const key0 = (t: number): string => (Math.round(t * 5000) / 5000).toString();

export function renderGauge(v: GaugeParts, t: number, off: boolean, label: string): void {
  const key = off ? -2 : Math.round(t * 5000) / 5000;
  if (key !== v.t) {
    v.t = key;
    const d = off ? '' : gaugeArc(v.r, 0, t, v.sw);
    v.fillH.setAttribute('d', d);
    v.fillI.setAttribute('d', d);
    const k = `M${gaugePt(v.r, t, -v.sp * 0.38, v.sw)}L${gaugePt(v.r, t, v.sp * 0.38, v.sw)}`;
    v.knobH.setAttribute('d', k);
    v.knobI.setAttribute('d', k);
    v.g.classList.toggle('is-off', off);
  }
  // `NAME // value`: the chip in the bottom gap shows the name only; the value rides the arc (renderValue).
  const cut = label.indexOf('//');
  const name = cut < 0 ? label : label.slice(0, cut).trim();
  if (name !== v.label) {
    v.label = name;
    v.tagText.textContent = name;
    const fs = parseFloat(v.g.style.getPropertyValue('--fx-fs')) || 9;
    const w = Math.ceil(name.length * (fs * 0.62 + fs * 0.06) + 10);
    v.tagBg.setAttribute('width', String(w));
    v.tagBg.setAttribute('x', String(-w / 2));
  }
  renderValue(v, t, off || cut < 0 ? '' : label.slice(cut + 2).trim());
}

/**
 * The value arc: a short curved band on the gauge's own arc, centred on the current value, with the number set along
 * it on a `textPath`. On the lower half of the dial the path runs counter-clockwise so the text never reads upside down.
 */
function renderValue(v: GaugeParts, t: number, value: string): void {
  if (value !== v.valLabel) {
    v.valLabel = value;
    v.valTp.textContent = value;
    v.val.style.display = value ? '' : 'none';
  }
  if (!value) return;
  const fs = (parseFloat(v.g.style.getPropertyValue('--fx-fs')) || 9) * 0.9;
  const w = value.length * (fs * 0.62 + fs * 0.06) + 10;
  const vk = `${key0(t)}|${w.toFixed(1)}|${v.r.toFixed(1)}`;
  if (vk === v.valKey) return;
  v.valKey = vk;
  const half = Math.min(Math.PI * 0.45, w / 2 / Math.max(1, v.r));
  // Centred on the value, but kept inside the sweep so near either end it never runs into the name chip.
  const a = Math.min(v.sw.a0 + v.sw.span - half, Math.max(v.sw.a0 + half, v.sw.a0 + v.sw.span * t));
  const flip = Math.sin(a) > 0;
  const a0 = flip ? a + half : a - half;
  const a1 = flip ? a - half : a + half;
  const pt = (ang: number): string => `${(v.r * Math.cos(ang)).toFixed(2)} ${(v.r * Math.sin(ang)).toFixed(2)}`;
  const d = `M${pt(a0)}A${v.r.toFixed(2)} ${v.r.toFixed(2)} 0 0 ${flip ? 0 : 1} ${pt(a1)}`;
  v.valBg.setAttribute('d', d);
  v.valPath.setAttribute('d', d);
  v.valBg.style.strokeWidth = `${Math.min(13, Math.max(8, v.sp * 0.75)).toFixed(1)}px`;
}
