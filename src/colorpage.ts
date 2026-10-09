/**
 * The COLOUR page of a node's bezel: HUE (outer), SAT, LUM (inner), the same 270° gauges as OPAC / SOFT / ROT
 * (gauge.ts) with the track painted in the colour it controls, and a swatch chip at the core.
 *
 * Colour model: OKLCH, with SAT = chroma as a fraction of the most chroma that fits sRGB at that lightness and hue
 * (so every SAT / LUM / HUE position is a real, in-gamut colour and "100" is always the most vivid one available).
 * The node stores only hex; `ColorState` is the unrounded L / s / h behind it, kept while the page is open so that
 * hex quantisation never nudges the dials and an achromatic colour (s = 0 or L at an end) keeps the hue you dialled.
 */
import { hexToOklch, maxChroma, oklchToHex } from './color';
import { gaugeArc, layoutGauge, makeGauge, renderGauge, type GaugeParts } from './gauge';

const NS = 'http://www.w3.org/2000/svg';
const SEGS = 90;

export interface ColorState {
  /** Lightness 0…1, saturation 0…1 (of the in-gamut maximum), hue 0…360°. */
  L: number;
  s: number;
  h: number;
  /** The hex this state was last written as; a different hex on the node means it was edited elsewhere. */
  hex: string;
  uid: number;
}

/** State for a node's current hex: reuse `prev` while the hex is the one it wrote, otherwise read it back from the hex. */
export function colorStateOf(uid: number, hex: string, prev: ColorState | null): ColorState {
  if (prev && prev.uid === uid && prev.hex === hex) return prev;
  const [L, C, h] = hexToOklch(hex);
  const same = prev && prev.uid === uid;
  const achro = C < 0.004;
  const cm = maxChroma(L, achro && same ? prev.h : h);
  return {
    uid, hex, L,
    h: achro ? (same ? prev.h : 0) : h,
    s: achro || cm < 1e-4 ? 0 : Math.min(1, C / cm),
  };
}

export type ColorAxis = 'hue' | 'sat' | 'lum';

/** Apply `v` (0…1 along the arc) to one axis; returns the new state with its hex. */
export function withAxis(st: ColorState, axis: ColorAxis, v: number): ColorState {
  const t = Math.min(1, Math.max(0, v));
  const L = axis === 'lum' ? t : st.L;
  const s = axis === 'sat' ? t : st.s;
  const h = axis === 'hue' ? Math.min(359.99, t * 360) : st.h;
  return { uid: st.uid, L, s, h, hex: oklchToHex(L, s * maxChroma(L, h), h) };
}

interface ColorGauge {
  p: GaugeParts;
  track: SVGGElement;
  segs: SVGPathElement[];
  key: string;
}

export interface ColorPage {
  hue: ColorGauge;
  sat: ColorGauge;
  lum: ColorGauge;
  /** Swatch chip at the core. */
  sw: SVGGElement;
  swHalo: SVGCircleElement;
  swInk: SVGCircleElement;
}

function makeColorGauge(cls: string): ColorGauge {
  const p = makeGauge(`gauge ccol ${cls}`, cls.toUpperCase());
  const track = document.createElementNS(NS, 'g');
  track.setAttribute('class', 'ctrack');
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke-linecap', 'butt');
  const under = document.createElementNS(NS, 'path');
  under.setAttribute('class', 'ctrack-under');
  track.appendChild(under);
  const segs: SVGPathElement[] = [];
  for (let k = 0; k < SEGS; k++) {
    const s = document.createElementNS(NS, 'path');
    segs.push(s);
    track.appendChild(s);
  }
  p.g.insertBefore(track, p.g.firstChild);
  return { p, track, segs, key: '' };
}

export function createColorPage(): ColorPage {
  const sw = document.createElementNS(NS, 'g');
  sw.setAttribute('class', 'csw');
  const mk = (cls: string): SVGCircleElement => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('r', '7');
    return c;
  };
  const swHalo = mk('halo csw-halo');
  const swInk = mk('ink csw-ink');
  sw.append(swHalo, swInk);
  sw.style.opacity = '0';
  return { hue: makeColorGauge('hue'), sat: makeColorGauge('sat'), lum: makeColorGauge('lum'), sw, swHalo, swInk };
}

/** Radii (hue outermost) and the track band width; call when the spacing changes. */
export function layoutColorPage(cp: ColorPage, rHue: number, rSat: number, rLum: number, sp: number): void {
  const band = Math.max(4, Math.min(7, sp * 0.24));
  for (const [g, r] of [[cp.hue, rHue], [cp.sat, rSat], [cp.lum, rLum]] as const) {
    layoutGauge(g.p, r, sp);
    g.track.setAttribute('stroke-width', band.toFixed(2));
    g.track.firstElementChild!.setAttribute('d', gaugeArc(r, 0, 1, g.p.sw));
    g.track.firstElementChild!.setAttribute('stroke-width', (band + 3).toFixed(2));
    g.segs.forEach((e, k) => e.setAttribute('d', gaugeArc(r, k / SEGS, Math.min(1, (k + 1.35) / SEGS), g.p.sw)));
    g.key = '';
  }
}

function paint(g: ColorGauge, key: string, at: (t: number) => string): void {
  if (key === g.key) return;
  g.key = key;
  g.segs.forEach((e, k) => e.setAttribute('stroke', at((k + 0.5) / SEGS)));
}

/** Paint the tracks and set the knobs / chips for state `st`. Cheap when nothing changed. `show` skips painting while hidden. */
export function renderColorPage(cp: ColorPage, st: ColorState, show: boolean): void {
  const { L, s, h } = st;
  const deg = Math.round(h) % 360;
  renderGauge(cp.hue.p, h / 360, false, `HUE // ${String(deg).padStart(3, '0')}°`);
  renderGauge(cp.sat.p, s, false, `SAT // ${Math.round(s * 100)}`);
  renderGauge(cp.lum.p, L, false, `LUM // ${Math.round(L * 100)}`);
  cp.swHalo.setAttribute('fill', st.hex);
  cp.swInk.setAttribute('fill', st.hex);
  if (!show) return;
  // HUE: the whole wheel at the current lightness, at least 75% saturated so it never goes grey with the colour.
  const Lh = Math.min(0.85, Math.max(0.45, L));
  const sh = Math.max(0.75, s);
  paint(cp.hue, `${Lh.toFixed(3)}|${sh.toFixed(3)}`, (t) => {
    const hh = t * 360;
    return oklchToHex(Lh, sh * maxChroma(Lh, hh), hh);
  });
  // SAT: grey → the fully saturated colour at this lightness and hue.
  const cm = maxChroma(L, h);
  paint(cp.sat, `${L.toFixed(3)}|${h.toFixed(1)}`, (t) => oklchToHex(L, t * cm, h));
  // LUM: black → white through this hue at this saturation.
  paint(cp.lum, `${s.toFixed(3)}|${h.toFixed(1)}`, (t) => oklchToHex(t, s * maxChroma(t, h), h));
}
