/**
 * One gauge renderer for the whole app: the FX dial's rings and a node's OPAC / SOFT / ROT dials are the same object.
 * 270° arc with the gap at 6 o'clock (0 at the lower left, clockwise through the top), halo + ink base, 11 ticks,
 * a SIGNAL fill, a notch at the value, and a black mono chip in the bottom gap (`GRAIN // 50`).
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

export const gaugePt =(ri: number, t: number, dr = 0): string => {
  const a = G_START + G_SPAN * t;
  return `${((ri + dr) * Math.cos(a)).toFixed(2)} ${((ri + dr) * Math.sin(a)).toFixed(2)}`;
};

export function gaugeArc(ri: number, t0: number, t1: number): string {
  if (t1 - t0 < 0.002) return '';
  return `M${gaugePt(ri, t0)}A${ri.toFixed(2)} ${ri.toFixed(2)} 0 ${(t1 - t0) * 270 > 180 ? 1 : 0} 1 ${gaugePt(ri, t1)}`;
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
  /** Value chip riding the arc at the current value (the label's value part: `50`, `045°`, `9 LV`). */
  val: SVGGElement;
  valBg: SVGRectElement;
  valText: SVGTextElement;
  valLabel: string;
  r: number;
  sp: number;
  label: string;
  t: number;
}

export function makeGauge(cls: string): GaugeParts {
  const p = (c: string): SVGPathElement => el('path', { class: c });
  const g = el('g', { class: `gring ${cls}` });
  const v: GaugeParts = {
    g, r: 0, sp: 0, label: '', t: -1,
    baseH: p('halo base'), baseI: p('ink base'), ticksH: p('halo gticks'), ticksI: p('ink gticks'),
    fillH: p('halo fill'), fillI: p('ink fill'), knobH: p('halo knob'), knobI: p('ink knob'),
    tag: el('g', { class: 'fx-tag' }), tagBg: el('rect', { class: 'tag-bg', height: 14, y: -7 }),
    tagText: el('text', { class: 'tag-text', 'text-anchor': 'middle', y: 3 }),
    val: el('g', { class: 'val' }), valBg: el('rect', { class: 'val-bg', height: 12, y: -6 }),
    valText: el('text', { class: 'val-text', 'text-anchor': 'middle', y: 3 }), valLabel: '',
  };
  v.tag.append(v.tagBg, v.tagText);
  v.val.append(v.valBg, v.valText);
  g.append(v.baseH, v.baseI, v.ticksH, v.ticksI, v.fillH, v.fillI, v.knobH, v.knobI, v.val, v.tag);
  return v;
}

/** Geometry for radius `r` with ring spacing `sp`: base arc, ticks, the chip in the bottom gap. Call when either changes. */
export function layoutGauge(v: GaugeParts, r: number, sp: number): void {
  v.r = r;
  v.sp = sp;
  const half = Math.min(4.5, sp * 0.3);
  const base = gaugeArc(r, 0, 1);
  v.baseH.setAttribute('d', base);
  v.baseI.setAttribute('d', base);
  let t = '';
  for (let k = 0; k <= 10; k++) {
    const h = half * (k % 5 ? 0.6 : 1);
    t += `M${gaugePt(r, k / 10, -h)}L${gaugePt(r, k / 10, h)}`;
  }
  v.ticksH.setAttribute('d', t);
  v.ticksI.setAttribute('d', t);
  const fs = Math.max(7.5, Math.min(9.5, sp * 0.36));
  v.g.style.setProperty('--fx-fs', `${fs}px`);
  v.tag.setAttribute('transform', `translate(0 ${r.toFixed(1)})`);
  v.t = -1;
  v.label = '';
  v.valLabel = '';
}

/** Value `t` (0…1; `off` hides the fill) and the chip text. Cheap when nothing changed. */
export function renderGauge(v: GaugeParts, t: number, off: boolean, label: string): void {
  const key = off ? -2 : Math.round(t * 5000) / 5000;
  if (key !== v.t) {
    v.t = key;
    const d = off ? '' : gaugeArc(v.r, 0, t);
    v.fillH.setAttribute('d', d);
    v.fillI.setAttribute('d', d);
    const k = `M${gaugePt(v.r, t, -v.sp * 0.38)}L${gaugePt(v.r, t, v.sp * 0.38)}`;
    v.knobH.setAttribute('d', k);
    v.knobI.setAttribute('d', k);
    v.g.classList.toggle('is-off', off);
    // The value chip sits on the arc at the value, so it slides round with the knob.
    const a = G_START + G_SPAN * t;
    v.val.setAttribute('transform', `translate(${(v.r * Math.cos(a)).toFixed(2)} ${(v.r * Math.sin(a)).toFixed(2)})`);
  }
  const value = off ? '' : label.slice(label.indexOf('//') + 2).trim();
  if (value !== v.valLabel) {
    v.valLabel = value;
    v.valText.textContent = value;
    v.val.style.display = value ? '' : 'none';
    const fs = (parseFloat(v.g.style.getPropertyValue('--fx-fs')) || 9) * 0.9;
    const w = Math.ceil(value.length * (fs * 0.62 + fs * 0.06) + 6);
    v.valBg.setAttribute('width', String(w));
    v.valBg.setAttribute('x', String(-w / 2));
  }
  if (label !== v.label) {
    v.label = label;
    v.tagText.textContent = label;
    const fs = parseFloat(v.g.style.getPropertyValue('--fx-fs')) || 9;
    const w = Math.ceil(label.length * (fs * 0.62 + fs * 0.06) + 10);
    v.tagBg.setAttribute('width', String(w));
    v.tagBg.setAttribute('x', String(-w / 2));
  }
}
