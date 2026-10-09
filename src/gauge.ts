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
  v.valKey = '';
}

/** Value `t` (0…1; `off` hides the fill) and the chip text. Cheap when nothing changed. */
let valSeq = 0;
const key0 = (t: number): string => (Math.round(t * 5000) / 5000).toString();

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
  }
  // `NAME // value`: the chip in the bottom gap shows the name only; the value rides the arc on the knob's flag.
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
 * The value flag: a short band on the gauge's own arc that starts at the knob and runs along the arc, so knob and
 * flag read as one Marathon-style part (the knob bar stays clear, the flag hangs off it). It runs toward higher values
 * unless there is no room before the end of the sweep, then back. The number is set along it on a `textPath`; on the
 * lower half of the dial the path runs counter-clockwise so the text never reads upside down.
 */
function renderValue(v: GaugeParts, t: number, value: string): void {
  if (value !== v.valLabel) {
    v.valLabel = value;
    v.valTp.textContent = value;
    v.val.style.display = value ? '' : 'none';
  }
  if (!value) return;
  const fs = (parseFloat(v.g.style.getPropertyValue('--fx-fs')) || 9) * 0.9;
  const w = value.length * (fs * 0.62 + fs * 0.06) + 8;
  const vk = `${key0(t)}|${w.toFixed(1)}|${v.r.toFixed(1)}`;
  if (vk === v.valKey) return;
  v.valKey = vk;
  const r = Math.max(1, v.r);
  const a = G_START + G_SPAN * t;
  const span = Math.min(Math.PI * 0.9, w / r);
  const gap = 2.5 / r; // clear of the knob bar's stroke
  const fwd = (1 - t) * G_SPAN * r >= w + 3;
  const s0 = fwd ? a + gap : a - gap - span;
  const s1 = s0 + span;
  const flip = Math.sin((s0 + s1) / 2) > 0;
  const pt = (ang: number): string => `${(v.r * Math.cos(ang)).toFixed(2)} ${(v.r * Math.sin(ang)).toFixed(2)}`;
  const d = flip
    ? `M${pt(s1)}A${v.r.toFixed(2)} ${v.r.toFixed(2)} 0 0 0 ${pt(s0)}`
    : `M${pt(s0)}A${v.r.toFixed(2)} ${v.r.toFixed(2)} 0 0 1 ${pt(s1)}`;
  v.valBg.setAttribute('d', d);
  v.valPath.setAttribute('d', d);
  v.valBg.style.strokeWidth = `${Math.min(12, Math.max(8, v.sp * 0.5)).toFixed(1)}px`;
}
