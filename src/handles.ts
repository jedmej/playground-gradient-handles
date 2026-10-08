import type { Actions } from './actions';
import type { History } from './history';
import { BODY_Q, nodeQ, outlinePoints } from './field';
import { centroid, distToPolyline, pathLength, rdp, simplifyTo, type Pt } from './geom';
import { NodeMenu } from './menu';
import {
  addNode,
  emit,
  MAX_NODES,
  nodeSerial,
  R_MAX,
  R_MIN,
  removeNodeAt,
  STROKE_RADIUS,
  type NodeState,
  type Store,
} from './store';

const NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;

/** SOFT gauge: a 270° arc, gap centred on 6 o'clock, 0 % at the lower left running clockwise to 100 % at the lower right. */
const G_START = (135 * Math.PI) / 180; // screen angle (y down, clockwise positive)
const G_SPAN = (270 * Math.PI) / 180;
/** The gauge is hidden below this ring radius (CSS px): too small to hold it. */
const G_MIN_R = 64;
const gaugeRi = (rPx: number): number => Math.min(Math.max(0.55 * rPx, 22), rPx - 18);
const gaugePt = (ri: number, t: number, dr = 0): string => {
  const a = G_START + G_SPAN * t;
  return `${((ri + dr) * Math.cos(a)).toFixed(2)} ${((ri + dr) * Math.sin(a)).toFixed(2)}`;
};
function gaugeArc(ri: number, t0: number, t1: number): string {
  if (t1 - t0 < 0.002) return '';
  return `M${gaugePt(ri, t0)}A${ri.toFixed(2)} ${ri.toFixed(2)} 0 ${(t1 - t0) * 270 > 180 ? 1 : 0} 1 ${gaugePt(ri, t1)}`;
}
function gaugeTicks(ri: number): string {
  let d = '';
  for (let k = 0; k <= 10; k++) {
    const len = k % 5 === 0 ? 4 : 2.5;
    d += `M${gaugePt(ri, k / 10, -len)}L${gaugePt(ri, k / 10, len)}`;
  }
  return d;
}

export interface Metrics {
  left: number;
  top: number;
  w: number;
  h: number;
  min: number;
}

export function createMetrics(): Metrics {
  return { left: 0, top: 0, w: 1, h: 1, min: 1 };
}

/** Touch long-press on a selected core → open the node menu. */
const HOLD_MS = 550;
const HOLD_SLOP = 6;
/** Double-tap window for adding a node (touch is more forgiving than a mouse double-click). */
const TAP_MS = 380;
const TAP_SLOP = 36;
const CLICK_MS = 320;
const CLICK_SLOP = 24;
const HOLD_R = 19;
const HOLD_C = TAU * HOLD_R;
/** Strokes: sample spacing while drawing, and the shortest path that still counts as a stroke (CSS px). */
const DRAW_STEP = 2;
const DRAW_MIN_LEN = 12;
const DRAW_LIVE_PTS = 64;

interface NodeView {
  uid: number;
  g: SVGGElement;
  outG: SVGGElement;
  outHalo: SVGPathElement;
  outInk: SVGPathElement;
  outKey: string;
  outPts: unknown;
  shape: string;
  npts: number;
  ring: SVGGElement;
  ringHalo: SVGCircleElement;
  ringInk: SVGCircleElement;
  ticksHalo: SVGPathElement;
  ticksInk: SVGPathElement;
  bearings: SVGTextElement[];
  gauge: SVGGElement;
  gaugeParts: { baseH: SVGPathElement; baseI: SVGPathElement; ticksH: SVGPathElement; ticksI: SVGPathElement; fillH: SVGPathElement; fillI: SVGPathElement; knobH: SVGPathElement; knobI: SVGPathElement; label: SVGTextElement };
  gaugeOp: number;
  lastRi: number;
  lastSoft: number;
  softAttr: string;
  layerAttr: string;
  retHalo: SVGPathElement;
  retInk: SVGPathElement;
  focus: SVGRectElement;
  holdHalo: SVGCircleElement;
  holdInk: SVGCircleElement;
  holding: boolean;
  bracket: number;
  ringOp: number;
  lastR: number;
  lastBracket: number;
  cls: string;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

function bracketPath(o: number, len: number): string {
  const i = o - len;
  return (
    `M${-o} ${-i}V${-o}H${-i}` +
    `M${i} ${-o}H${o}V${-i}` +
    `M${o} ${i}V${o}H${i}` +
    `M${-i} ${o}H${-o}V${i}`
  );
}

function ticksPath(r: number): string {
  let d = '';
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU;
    const len = k % 6 === 0 ? 9 : 4;
    const r0 = r + 3;
    const r1 = r0 + len;
    const c = Math.cos(a);
    const s = Math.sin(a);
    d += `M${(r0 * c).toFixed(2)} ${(r0 * s).toFixed(2)}L${(r1 * c).toFixed(2)} ${(r1 * s).toFixed(2)}`;
  }
  return d;
}

function arcPath(cx: number, cy: number, r: number, angle: number, span: number): string {
  const a0 = angle - span / 2;
  const a1 = angle + span / 2;
  return (
    `M${(cx + r * Math.cos(a0)).toFixed(2)} ${(cy + r * Math.sin(a0)).toFixed(2)}` +
    `A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${(cx + r * Math.cos(a1)).toFixed(2)} ${(cy + r * Math.sin(a1)).toFixed(2)}`
  );
}

function approach(current: number, target: number, k: number, dt: number, snap: boolean): number {
  if (snap) return target;
  return current + (target - current) * (1 - Math.exp(-k * dt));
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return from + d;
}

export class Handles {
  private views: NodeView[] = [];
  private arcG: SVGGElement;
  private arcHalo: SVGPathElement;
  private arcInk: SVGPathElement;
  private grid: SVGPathElement;
  private gridHalo: SVGPathElement;
  private dragOffset = { x: 0, y: 0 };
  private pointerId: number | null = null;
  private lastPointer = { x: 0, y: 0 };
  private hold: { start: number; x: number; y: number; uid: number } | null = null;
  /** Touch: the node the current first finger deselected on empty field (pinch may still want it). */
  private pinchRestore: { uid: number; t: number } | null = null;
  /** The stroke being drawn: the provisional node's uid and the raw sampled path (stage px). */
  private stroke: { uid: number; raw: Pt[] } | null = null;
  private guide: SVGGElement;
  private guideHalo: SVGPolylineElement;
  private guideInk: SVGPolylineElement;
  private lastTap: { t: number; x: number; y: number } | null = null;
  /** True while a pointer is over (or captured by) the stage. */
  pointerInside = false;
  private chipNodeText = '';
  private chipNodeW = 0;
  private chipRadiusText = '';
  private chipRadiusW = 0;
  /** SOFT drag: the last value, and whether the pointer is parked in (or just left) the bottom gap. */
  private softPrev = 0;
  private softGap = false;
  /** Wheel / pinch feedback: which node, what was changed, and until when the readout and bezel stay up. */
  private flash: { uid: number; kind: 'r' | 'soft'; until: number } | null = null;
  /** Touch pointers on the stage, and the two-finger pinch (reach of the selected node). */
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { uid: number; d0: number; r0: number } | null = null;
  private lastPointerType = 'mouse';
  private keyMenuAt = -Infinity;
  private menu: NodeMenu;

  constructor(
    private store: Store,
    private stage: HTMLElement,
    private svg: SVGSVGElement,
    private chipNode: HTMLElement,
    private chipRadius: HTMLElement,
    readonly metrics: Metrics,
    private actions: Actions,
    private history: History,
  ) {
    this.gridHalo = el('path', { class: 'halo grid-cross' });
    this.grid = el('path', { class: 'ink grid-cross' });
    svg.append(this.gridHalo, this.grid);

    this.arcG = el('g', { class: 'arc' });
    this.arcHalo = el('path', { class: 'halo arc-p' });
    this.arcInk = el('path', { class: 'ink arc-p' });
    this.arcG.append(this.arcHalo, this.arcInk);
    svg.appendChild(this.arcG);

    // Live guide while drawing: thin ink over a halo, hidden otherwise.
    this.guideHalo = el('polyline', { class: 'halo' });
    this.guideInk = el('polyline', { class: 'ink' });
    this.guide = el('g', { id: 'draw-guide', visibility: 'hidden' });
    this.guide.append(this.guideHalo, this.guideInk);
    svg.appendChild(this.guide);
    store.cancelDraw = () => this.cancelStroke();

    this.syncViews();
    store.listeners.add(() => this.syncViews());

    // Focus ring only after keyboard interaction, never after a pointer grab that moved focus.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.code === 'BracketLeft' || e.code === 'BracketRight') {
        svg.classList.add('kb');
      }
    });
    window.addEventListener('pointerdown', () => svg.classList.remove('kb'), { capture: true });

    this.menu = new NodeMenu(store, stage, actions, (i) => this.views[i]?.g.focus({ preventScroll: true }));

    stage.addEventListener('pointerdown', this.onDown);
    stage.addEventListener('pointermove', this.onMove);
    stage.addEventListener('pointerup', this.onUp);
    stage.addEventListener('pointercancel', this.onUp);
    stage.addEventListener('pointerleave', this.onLeave);
    // The browser's own menu is suppressed on the canvas only; a hit node gets the layer menu instead.
    stage.addEventListener('contextmenu', this.onContextMenu);
    // Non-passive: over a node the wheel / pinch must never scroll or zoom the page.
    stage.addEventListener('wheel', this.onWheel, { passive: false });
  }

  // ----- views --------------------------------------------------------------

  private createView(n: NodeState): NodeView {
    const g = el('g', { class: 'node', tabindex: 0, role: 'button' });
    const ring = el('g', { class: 'ring' });
    const ringHalo = el('circle', { class: 'halo ring-c' });
    const ringInk = el('circle', { class: 'ink ring-c' });
    const ticksHalo = el('path', { class: 'halo ticks' });
    const ticksInk = el('path', { class: 'ink ticks' });
    ring.append(ringHalo, ringInk, ticksHalo, ticksInk);
    // Bearing labels at the cardinals: 000 is up, clockwise like a compass rose.
    const bearings = ['000', '090', '180', '270'].map((label) => {
      const t = el('text', { class: 'bearing', 'text-anchor': 'middle' });
      t.textContent = label;
      ring.appendChild(t);
      return t;
    });

    // SOFT gauge: lives in the ring group, so it appears and fades with the bezel.
    const gauge = el('g', { class: 'gauge' });
    const gp = {
      baseH: el('path', { class: 'halo g-base' }),
      baseI: el('path', { class: 'ink g-base' }),
      ticksH: el('path', { class: 'halo g-ticks' }),
      ticksI: el('path', { class: 'ink g-ticks' }),
      fillH: el('path', { class: 'halo g-fill' }),
      fillI: el('path', { class: 'ink g-fill' }),
      knobH: el('path', { class: 'halo g-knob' }),
      knobI: el('path', { class: 'ink g-knob' }),
      label: el('text', { class: 'soft-label', 'text-anchor': 'middle' }),
    };
    gauge.append(gp.baseH, gp.baseI, gp.ticksH, gp.ticksI, gp.fillH, gp.fillI, gp.knobH, gp.knobI, gp.label);
    ring.appendChild(gauge);

    const focusHalo = el('rect', { class: 'halo focus-rect', x: -21, y: -21, width: 42, height: 42 });
    const focus = el('rect', { class: 'ink focus-rect', x: -21, y: -21, width: 42, height: 42 });
    const retHalo = el('path', { class: 'halo ret' });
    const retInk = el('path', { class: 'ink ret' });
    const holdAttrs = { r: HOLD_R, visibility: 'hidden', transform: 'rotate(-90)', 'stroke-dasharray': `0 ${HOLD_C}` };
    const holdHalo = el('circle', { class: 'halo hold-arc', ...holdAttrs });
    const holdInk = el('circle', { class: 'ink hold-arc', ...holdAttrs });
    const coreHalo = el('circle', { class: 'halo core', r: 3 });
    const coreInk = el('circle', { class: 'ink core', r: 3 });
    // Core outline of a non-circle node (dashed dual stroke, like the bezel).
    const outG = el('g', { class: 'outline' });
    const outHalo = el('path', { class: 'halo out-p' });
    const outInk = el('path', { class: 'ink out-p' });
    outG.append(outHalo, outInk);
    outG.style.opacity = '0';
    g.append(ring, outG, focusHalo, focus, holdHalo, holdInk, retHalo, retInk, coreHalo, coreInk);

    const view: NodeView = {
      outG, outHalo, outInk, outKey: '', outPts: null, shape: '', npts: -1,
      uid: n.uid, g, ring, ringHalo, ringInk, ticksHalo, ticksInk, bearings, retHalo, retInk, focus,
      gauge, gaugeParts: gp, gaugeOp: 0, lastRi: -1, lastSoft: -1, softAttr: '', layerAttr: '',
      holdHalo, holdInk, holding: false,
      // Fresh nodes "acquire": brackets start wide and settle, the ring eases in.
      bracket: n.fresh && !this.store.reducedMotion ? 22 : 11,
      ringOp: 0, lastR: -1, lastBracket: -1, cls: '',
    };
    n.fresh = false;
    // Listeners resolve the index at event time: indices shift whenever a node is added or removed.
    g.addEventListener('focus', () => this.onFocus(this.views.indexOf(view)));
    g.addEventListener('blur', () => this.onBlur(this.views.indexOf(view)));
    g.addEventListener('keydown', (e) => this.onKey(e, this.views.indexOf(view)));
    return view;
  }

  /** Make the `<g>` views match `store.nodes` (same order, same count, fresh `data-node` indices). */
  syncViews(): void {
    const nodes = this.store.nodes;
    if (this.views.length === nodes.length && this.views.every((v, i) => v.uid === nodes[i].uid)) return;
    const byUid = new Map(this.views.map((v) => [v.uid, v]));
    const next = nodes.map((n) => {
      const v = byUid.get(n.uid);
      if (v) byUid.delete(n.uid);
      return v ?? this.createView(n);
    });
    // Assign first: removing a focused <g> fires blur → emit → syncViews re-entrantly.
    this.views = next;
    const active = document.activeElement as SVGElement | null;
    byUid.forEach((v) => v.g.remove());
    // Keep DOM order == array order (Tab order). Walk backwards so each view lands before its successor.
    let ref: Node = this.arcG;
    for (let i = next.length - 1; i >= 0; i--) {
      const g = next[i].g;
      if (g.nextSibling !== ref) this.svg.insertBefore(g, ref);
      ref = g;
    }
    // Re-inserting a focused <g> (a layer move) drops its focus: give it back so the keyboard carries on.
    if (active && active !== document.activeElement && next.some((v) => v.g === active)) {
      active.focus({ preventScroll: true });
    }
    next.forEach((v, i) => {
      v.g.setAttribute('data-node', String(i));
      v.g.setAttribute('aria-label', nodeSerial(i));
    });
  }

  // ----- geometry -----------------------------------------------------------

  updateMetrics(): void {
    const r = this.stage.getBoundingClientRect();
    const m = this.metrics;
    m.left = r.left;
    m.top = r.top;
    m.w = Math.max(1, r.width);
    m.h = Math.max(1, r.height);
    m.min = Math.min(m.w, m.h);
    this.svg.setAttribute('viewBox', `0 0 ${m.w} ${m.h}`);
    this.svg.setAttribute('width', String(m.w));
    this.svg.setAttribute('height', String(m.h));
    let d = '';
    for (let i = 1; i < 4; i++) {
      for (let j = 1; j < 4; j++) {
        const x = (m.w * i) / 4;
        const y = (m.h * j) / 4;
        d += `M${x - 4} ${y}H${x + 4}M${x} ${y - 4}V${y + 4}`;
      }
    }
    this.grid.setAttribute('d', d);
    this.gridHalo.setAttribute('d', d);
  }

  private hitSizes(): { core: number; band: number } {
    return this.store.coarse ? { core: 22, band: 18 } : { core: 12, band: 10 };
  }

  private px(i: number): { x: number; y: number; r: number } {
    const n = this.store.nodes[i];
    const m = this.metrics;
    return { x: n.dx * m.w, y: n.dy * m.h, r: n.dr * m.min };
  }

  /** The wheel / pinch feedback for node `i`, while it is still on screen. */
  private flashing(i: number): { kind: 'r' | 'soft' } | null {
    const f = this.flash;
    if (!f || performance.now() > f.until) return null;
    return this.store.nodes[i]?.uid === f.uid ? f : null;
  }

  private revealed(i: number): boolean {
    const s = this.store;
    return (
      s.armed === i ||
      this.flashing(i) !== null ||
      s.selected === i ||
      s.focused === i ||
      (s.hover.kind !== 'idle' && s.hover.index === i) ||
      (s.drag.kind !== 'none' && s.drag.index === i)
    );
  }

  /** Is node `i`'s SOFT gauge on screen (and so grabbable)? Edit tool only, and only on a big enough ring. */
  private gaugeShown(i: number): boolean {
    return this.store.tool === 'edit' && this.px(i).r >= G_MIN_R;
  }

  /** Grab-zone priority: core → SOFT gauge → revealed ring band → shape/stroke body → nothing. Nearest wins. */
  private pick(x: number, y: number): { kind: 'node' | 'soft' | 'ring' | 'body' | 'none'; index: number } {
    const { core, band } = this.hitSizes();
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.store.nodes.length; i++) {
      const p = this.px(i);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= core && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best >= 0) return { kind: 'node', index: best };

    // SOFT gauge: a ±7 px (±11 coarse) band around the arc, on its visible 270° only.
    const gb = this.store.coarse ? 11 : 7;
    let bestS = -1;
    let bestSD = Infinity;
    for (let i = 0; i < this.store.nodes.length; i++) {
      if (!this.revealed(i) || !this.gaugeShown(i)) continue;
      const p = this.px(i);
      const ri = gaugeRi(p.r);
      const d = Math.abs(Math.hypot(x - p.x, y - p.y) - ri);
      if (d > gb || d >= bestSD) continue;
      const u = (((Math.atan2(y - p.y, x - p.x) - G_START) % TAU) + TAU) % TAU;
      const tol = gb / ri;
      if (u <= G_SPAN + tol || u >= TAU - tol) {
        bestS = i;
        bestSD = d;
      }
    }
    if (bestS >= 0) return { kind: 'soft', index: bestS };

    let bestR = -1;
    let bestRD = Infinity;
    for (let i = 0; i < this.store.nodes.length; i++) {
      if (!this.revealed(i)) continue;
      const p = this.px(i);
      const d = Math.abs(Math.hypot(x - p.x, y - p.y) - p.r);
      if (d <= band && d < bestRD) {
        bestR = i;
        bestRD = d;
      }
    }
    if (bestR >= 0) return { kind: 'ring', index: bestR };

    // Body: strokes by distance to the polyline, other shapes by q ≤ BODY_Q. Circles have no body.
    const m = this.metrics;
    let bestB = -1;
    let bestBD = Infinity;
    for (let i = 0; i < this.store.nodes.length; i++) {
      const n = this.store.nodes[i];
      if (n.shape === 'circle') continue;
      const p = this.px(i);
      let score: number;
      if (n.shape === 'stroke') {
        const d = distToPolyline(n.pts, x, y, p.x, p.y, m.min);
        if (d > Math.max(this.store.coarse ? 24 : 16, BODY_Q * p.r)) continue;
        score = d;
      } else {
        const q = nodeQ(n, x, y, m);
        if (q > BODY_Q) continue;
        score = q * p.r;
      }
      if (score < bestBD) {
        bestB = i;
        bestBD = score;
      }
    }
    if (bestB >= 0) return { kind: 'body', index: bestB };
    return { kind: 'none', index: -1 };
  }

  // ----- draw ---------------------------------------------------------------

  private strokeIndex(): number {
    const st = this.stroke;
    return st ? this.store.nodes.findIndex((n) => n.uid === st.uid) : -1;
  }

  /** Write an absolute polyline (stage px) into a stroke node: centroid → x/y, offsets → pts. */
  private setPolyline(n: NodeState, abs: Pt[]): void {
    const m = this.metrics;
    const c = centroid(abs);
    n.x = n.dx = c[0] / m.w;
    n.y = n.dy = c[1] / m.h;
    n.pts = abs.map((p) => [(p[0] - c[0]) / m.min, (p[1] - c[1]) / m.min]);
  }

  private drawGuide(raw: Pt[] | null): void {
    if (!raw) {
      this.guide.setAttribute('visibility', 'hidden');
      return;
    }
    const pts = raw.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    this.guideHalo.setAttribute('points', pts);
    this.guideInk.setAttribute('points', pts);
    this.guide.setAttribute('visibility', 'visible');
  }

  private startStroke(x: number, y: number): boolean {
    const s = this.store;
    if (s.nodes.length >= MAX_NODES) {
      s.say(`NODE LIMIT ${MAX_NODES}`);
      return false;
    }
    const m = this.metrics;
    this.history.begin();
    const i = addNode(s, { x: x / m.w, y: y / m.h, r: STROKE_RADIUS, hex: s.drawColor, shape: 'stroke', pts: [[0, 0]] });
    this.stroke = { uid: s.nodes[i].uid, raw: [[x, y]] };
    s.drawing = true;
    s.hover = { kind: 'idle', index: -1 };
    this.drawGuide(this.stroke.raw);
    emit(s);
    return true;
  }

  private extendStroke(e: PointerEvent): void {
    const st = this.stroke;
    const i = this.strokeIndex();
    if (!st || i < 0) return;
    const m = this.metrics;
    const evs = e.getCoalescedEvents?.() ?? [];
    let grew = false;
    for (const ev of evs.length ? evs : [e]) {
      const x = Math.min(m.w, Math.max(0, ev.clientX - m.left));
      const y = Math.min(m.h, Math.max(0, ev.clientY - m.top));
      const last = st.raw[st.raw.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < DRAW_STEP) continue;
      st.raw.push([x, y]);
      grew = true;
    }
    if (!grew) return;
    // Bound the work per move: long strokes are pre-thinned losslessly-ish, then previewed at ≤ 64 points.
    if (st.raw.length > 512) st.raw = rdp(st.raw, 1);
    const live = st.raw.length > DRAW_LIVE_PTS ? simplifyTo(st.raw, DRAW_LIVE_PTS) : st.raw;
    this.setPolyline(this.store.nodes[i], live);
    this.drawGuide(st.raw);
    this.store.say(`DRAW · ${String(live.length).padStart(2, '0')} PTS`);
  }

  /** Remove the provisional node and forget the gesture (no undo step). */
  private cancelStroke(message?: string): void {
    const s = this.store;
    const i = this.strokeIndex();
    this.stroke = null;
    this.drawGuide(null);
    this.history.cancel();
    if (this.pointerId !== null && this.stage.hasPointerCapture(this.pointerId)) {
      this.stage.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    if (s.drawing && i >= 0) removeNodeAt(s, i);
    s.drawing = false;
    if (message) s.say(message);
    emit(s);
  }

  private finishStroke(): void {
    const s = this.store;
    const st = this.stroke;
    const i = this.strokeIndex();
    if (!st || i < 0) {
      this.cancelStroke();
      return;
    }
    if (pathLength(st.raw) < DRAW_MIN_LEN) {
      this.cancelStroke('STROKE TOO SHORT');
      return;
    }
    const n = s.nodes[i];
    this.setPolyline(n, simplifyTo(st.raw, DRAW_LIVE_PTS));
    this.stroke = null;
    this.drawGuide(null);
    s.drawing = false;
    s.selected = i;
    s.armed = i;
    this.history.commit(`DRAW ${nodeSerial(i)}`, true);
    // One stroke per activation: back to editing, where the stroke is now a grabbable body.
    this.actions.setDraw(false);
    s.say(`Drew ${nodeSerial(i)} · ${String(n.pts.length).padStart(2, '0')} pts`);
  }

  private local(e: PointerEvent): { x: number; y: number } {
    return { x: e.clientX - this.metrics.left, y: e.clientY - this.metrics.top };
  }

  private aimArc(i: number, x: number, y: number): void {
    const p = this.px(i);
    const s = this.store;
    const target = Math.atan2(y - p.y, x - p.x);
    if (s.arcOpacity < 0.05) s.arcAngle = target;
    s.arcTarget = target;
  }

  // ----- pointer ------------------------------------------------------------

  private onDown = (e: PointerEvent): void => {
    this.lastPointerType = e.pointerType;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // macOS: Ctrl+click is a right click; let the contextmenu event have it.
    if (e.ctrlKey && e.pointerType === 'mouse' && /Mac/.test(navigator.platform)) return;
    const s = this.store;
    this.updateMetrics();
    const { x, y } = this.local(e);
    if (e.pointerType === 'touch') {
      s.coarse = true;
      this.touches.set(e.pointerId, { x, y });
      // A second finger ends whatever the first was doing; with a node selected it becomes a pinch on its reach.
      if (this.touches.size >= 2) {
        this.beginPinch(e);
        return;
      }
    }
    if (s.drag.kind !== 'none') return;
    this.lastPointer = { x, y };

    // DRAW tool: nothing is hit-tested; a primary press starts a stroke.
    if (s.tool === 'draw') {
      e.preventDefault();
      if (!e.isPrimary || s.drawing) return;
      this.lastTap = null;
      if (!this.startStroke(x, y)) return;
      this.pointerId = e.pointerId;
      this.stage.setPointerCapture(e.pointerId);
      return;
    }

    const res = this.pick(x, y);
    this.pointerId = e.pointerId;
    this.stage.setPointerCapture(e.pointerId);
    e.preventDefault();

    const wasSelected = s.selected;
    if (res.kind === 'body') {
      // Grab the shape/stroke anywhere on its body: the same move drag as the core, with the grab offset kept.
      const p = this.px(res.index);
      this.dragOffset = { x: p.x - x, y: p.y - y };
      this.history.begin();
      s.drag = { kind: 'node', index: res.index };
      s.hover = { kind: 'body', index: res.index };
      s.selected = res.index;
      s.armed = res.index;
      this.views[res.index].g.focus({ preventScroll: true });
      this.lastTap = null;
    } else if (res.kind === 'node') {
      const p = this.px(res.index);
      this.dragOffset = { x: p.x - x, y: p.y - y };
      this.history.begin();
      s.drag = { kind: 'node', index: res.index };
      s.hover = { kind: 'node', index: res.index };
      s.selected = res.index;
      s.armed = res.index;
      this.views[res.index].g.focus({ preventScroll: true });
      this.lastTap = null;
      // Touch: first tap selects; pressing and holding an already-selected core opens the node menu.
      if (e.pointerType === 'touch' && wasSelected === res.index) {
        this.hold = { start: performance.now(), x, y, uid: s.nodes[res.index].uid };
      }
    } else if (res.kind === 'soft') {
      this.history.begin();
      s.drag = { kind: 'soft', index: res.index };
      s.hover = { kind: 'soft', index: res.index };
      s.selected = res.index;
      s.armed = res.index;
      this.lastTap = null;
      this.softPrev = s.nodes[res.index].soft;
      this.softGap = false;
      this.applySoft(res.index, x, y);
    } else if (res.kind === 'ring') {
      this.history.begin();
      s.drag = { kind: 'ring', index: res.index };
      s.hover = { kind: 'ring', index: res.index };
      s.selected = res.index;
      s.armed = res.index;
      this.lastTap = null;
      this.aimArc(res.index, x, y);
      this.applyRadius(res.index, x, y);
    } else {
      // Touch: remember what this finger deselected, so a second finger landing right after can still pinch it.
      const prevSel = s.selected !== null ? s.nodes[s.selected] : undefined;
      this.pinchRestore = e.pointerType === 'touch' && prevSel ? { uid: prevSel.uid, t: performance.now() } : null;
      s.selected = null;
      s.armed = null;
      s.hover = { kind: 'idle', index: -1 };
      (document.activeElement as HTMLElement | null)?.blur?.();
      // Double-click / double-tap on empty field drops a node (manual detection so touch behaves too).
      const t = performance.now();
      const prev = this.lastTap;
      const touch = e.pointerType === 'touch';
      const win = touch ? TAP_MS : CLICK_MS;
      const slop = touch ? TAP_SLOP : CLICK_SLOP;
      if (prev && t - prev.t < win && Math.hypot(x - prev.x, y - prev.y) < slop) {
        this.lastTap = null;
        this.actions.addAt(x / this.metrics.w, y / this.metrics.h);
      } else {
        this.lastTap = { t, x, y };
      }
    }
    emit(s);
  };

  private onMove = (e: PointerEvent): void => {
    const s = this.store;
    const { x, y } = this.local(e);
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x, y });
      if (this.pinch) {
        this.updatePinch();
        return;
      }
    }
    this.lastPointer = { x, y };
    this.pointerInside = true;

    if (this.hold && Math.hypot(x - this.hold.x, y - this.hold.y) > HOLD_SLOP) this.hold = null;

    if (s.drawing) {
      if (e.pointerId === this.pointerId) this.extendStroke(e);
      return;
    }
    if (s.drag.kind === 'node') {
      const n = s.nodes[s.drag.index];
      if (!n) return;
      n.x = Math.min(1, Math.max(0, (x + this.dragOffset.x) / this.metrics.w));
      n.y = Math.min(1, Math.max(0, (y + this.dragOffset.y) / this.metrics.h));
      return;
    }
    if (s.drag.kind === 'ring') {
      this.aimArc(s.drag.index, x, y);
      this.applyRadius(s.drag.index, x, y);
      return;
    }
    if (s.drag.kind === 'soft') {
      this.applySoft(s.drag.index, x, y);
      return;
    }
    if (e.pointerType === 'touch') return;
    this.hoverAt(x, y);
  };

  /** Pointer angle around the node → 0–1 along the 270° arc. In the bottom gap the value sticks to the end it came from. */
  private applySoft(i: number, x: number, y: number): void {
    const n = this.store.nodes[i];
    if (!n) return;
    const p = this.px(i);
    const u = (((Math.atan2(y - p.y, x - p.x) - G_START) % TAU) + TAU) % TAU;
    let t: number;
    if (u > G_SPAN) {
      t = this.softPrev > 0.5 ? 1 : 0;
      this.softGap = true;
    } else {
      t = u / G_SPAN;
      // Leaving the gap on the far side would snap across it: hold the old end until the pointer comes back round.
      if (this.softGap && Math.abs(t - this.softPrev) > 0.5) t = this.softPrev;
      else this.softGap = false;
    }
    this.softPrev = t;
    n.soft = Math.round(t * 1000) / 1000;
  }

  private hoverAt(x: number, y: number): void {
    const s = this.store;
    if (s.tool === 'draw') {
      // Crosshair everywhere: nodes and rings are not hit-tested while drawing.
      if (s.hover.kind !== 'idle') {
        s.hover = { kind: 'idle', index: -1 };
        emit(s);
      }
      return;
    }
    const res = this.pick(x, y);
    const prev = s.hover;
    if (res.kind === 'node') {
      s.hover = { kind: 'node', index: res.index };
      s.armed = res.index;
    } else if (res.kind === 'body') {
      s.hover = { kind: 'body', index: res.index };
      s.armed = res.index;
    } else if (res.kind === 'soft') {
      s.hover = { kind: 'soft', index: res.index };
    } else if (res.kind === 'ring') {
      s.hover = { kind: 'ring', index: res.index };
      this.aimArc(res.index, x, y);
    } else {
      s.hover = { kind: 'idle', index: -1 };
    }
    if (s.armed !== null && s.armed !== s.selected && s.armed !== s.focused) {
      const p = this.px(s.armed);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > p.r + this.hitSizes().band * 1.6) s.armed = null;
    }
    if (prev.kind !== s.hover.kind || prev.index !== s.hover.index) emit(s);
  }

  private applyRadius(i: number, x: number, y: number): void {
    const n = this.store.nodes[i];
    const m = this.metrics;
    const d = Math.hypot(x - n.x * m.w, y - n.y * m.h);
    n.r = Math.min(R_MAX, Math.max(R_MIN, d / m.min));
  }

  private onUp = (e: PointerEvent): void => {
    const s = this.store;
    if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
    if (this.pinch) {
      if (this.touches.size < 2) this.endPinch();
      if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
      return;
    }
    if (this.pointerId !== e.pointerId) return;
    this.pointerId = null;
    this.hold = null;
    if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
    if (s.drawing) {
      if (e.type === 'pointercancel') this.cancelStroke('STROKE CANCELLED');
      else this.finishStroke();
    } else if (s.drag.kind !== 'none' && s.drag.index < s.nodes.length) {
      this.history.commit(this.dragLabel());
    } else {
      this.history.commit('');
    }
    s.drag = { kind: 'none', index: -1 };
    if (e.pointerType === 'touch') {
      s.hover = { kind: 'idle', index: -1 };
      this.pointerInside = false;
      emit(s);
    } else {
      const { x, y } = this.local(e);
      s.hover = { kind: 'idle', index: -1 };
      this.hoverAt(x, y);
      emit(s);
    }
  };

  private onLeave = (): void => {
    const s = this.store;
    if (s.drag.kind !== 'none' || s.drawing) return;
    this.pointerInside = false;
    s.hover = { kind: 'idle', index: -1 };
    if (s.armed !== s.selected && s.armed !== s.focused) s.armed = null;
    emit(s);
  };

  /** Undo label of the drag in progress. */
  private dragLabel(): string {
    const { kind, index } = this.store.drag;
    return `${kind === 'ring' ? 'RADIUS' : kind === 'soft' ? 'SOFT' : 'MOVE'} ${nodeSerial(index)}`;
  }

  /** Long-press completed: end the drag (it moved at most a few px) and open the node menu beside the node. */
  private fireHold(): void {
    const s = this.store;
    const h = this.hold;
    this.hold = null;
    if (!h) return;
    const i = s.nodes.findIndex((n) => n.uid === h.uid);
    if (i < 0) return;
    if (this.pointerId !== null && this.stage.hasPointerCapture(this.pointerId)) {
      this.stage.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    this.pointerInside = false;
    if (s.drag.kind !== 'none') this.history.commit(this.dragLabel());
    s.drag = { kind: 'none', index: -1 };
    s.hover = { kind: 'idle', index: -1 };
    emit(s);
    const p = this.px(i);
    this.menu.open(i, p.x + 30, p.y - 14, false, true);
  }

  // ----- pinch (touch) ------------------------------------------------------

  private pinchDistance(): number {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  /** Second finger down: abandon the single-finger gesture; with a node selected, start scaling its reach. */
  private beginPinch(e: PointerEvent): void {
    const s = this.store;
    this.hold = null;
    if (s.drawing) {
      this.cancelStroke('STROKE CANCELLED');
      return;
    }
    // Both fingers rarely land on the core: if the first one only deselected the node (empty field), restore it.
    const pr = this.pinchRestore;
    this.pinchRestore = null;
    if (s.selected === null && pr && performance.now() - pr.t < 400) {
      const ri = s.nodes.findIndex((n) => n.uid === pr.uid);
      if (ri >= 0) s.selected = ri;
    }
    if (this.pinch || s.tool !== 'edit' || s.selected === null || s.selected >= s.nodes.length) return;
    const d0 = this.pinchDistance();
    if (d0 < 12) return;
    if (s.drag.kind !== 'none') {
      this.history.commit(this.dragLabel());
      s.drag = { kind: 'none', index: -1 };
    }
    this.pointerId = null;
    this.lastTap = null;
    const n = s.nodes[s.selected];
    this.pinch = { uid: n.uid, d0, r0: n.r };
    this.history.begin();
    this.stage.setPointerCapture(e.pointerId);
    emit(s);
  }

  private updatePinch(): void {
    const p = this.pinch;
    if (!p) return;
    const s = this.store;
    const i = s.nodes.findIndex((n) => n.uid === p.uid);
    const d = this.pinchDistance();
    if (i < 0 || d <= 0) return;
    s.nodes[i].r = Math.min(R_MAX, Math.max(R_MIN, p.r0 * (d / p.d0)));
    s.modified = true;
    s.armed = i;
    this.flash = { uid: p.uid, kind: 'r', until: performance.now() + 700 };
  }

  private endPinch(): void {
    const s = this.store;
    const p = this.pinch;
    this.pinch = null;
    const i = p ? s.nodes.findIndex((n) => n.uid === p.uid) : -1;
    this.history.commit(i >= 0 ? `RADIUS ${nodeSerial(i)}` : '');
    s.hover = { kind: 'idle', index: -1 };
    this.pointerInside = false;
    emit(s);
  }

  // ----- wheel / trackpad ---------------------------------------------------

  /**
   * Wheel over a node: resize its reach (plain / two-finger scroll, ctrl = trackpad pinch ×3) or, with ⇧ / ⌥,
   * its softness. Over empty field the page keeps its scroll and zoom.
   */
  private onWheel = (e: WheelEvent): void => {
    const s = this.store;
    this.menu.close();
    if (s.tool !== 'edit' || s.drawing || s.drag.kind !== 'none' || this.pinch) return;
    this.updateMetrics();
    const x = e.clientX - this.metrics.left;
    const y = e.clientY - this.metrics.top;
    const hit = this.pick(x, y);
    let i = hit.index;
    if (i < 0) {
      // Between the gauge, ring and core of a node the pointer is still "on" it: hovered or armed, within reach.
      const c = s.hover.kind !== 'idle' ? s.hover.index : (s.armed ?? -1);
      if (c >= 0 && c < s.nodes.length) {
        const p = this.px(c);
        if (Math.hypot(x - p.x, y - p.y) <= p.r + this.hitSizes().band * 1.6) i = c;
      }
    }
    if (i < 0) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    s.armed = i;
    if (!e.ctrlKey && (e.shiftKey || e.altKey)) {
      // Shift+wheel arrives as deltaX in Chromium on macOS.
      const d = (e.deltaY || e.deltaX) * unit;
      if (d === 0) return;
      this.flash = { uid: s.nodes[i].uid, kind: 'soft', until: performance.now() + 900 };
      this.actions.softBy(i, -d * 0.0012);
    } else {
      const dy = e.deltaY * unit * (e.ctrlKey ? 3 : 1);
      if (dy === 0) return;
      this.flash = { uid: s.nodes[i].uid, kind: 'r', until: performance.now() + 900 };
      const k = Math.exp(-dy * 0.0015);
      this.actions.resize(i, (r) => r * k);
    }
  };

  // ----- context menu ---------------------------------------------------------

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const s = this.store;
    // The ContextMenu key already opened it from keydown; touch has TAP + HOLD instead.
    if (performance.now() - this.keyMenuAt < 400 || this.lastPointerType === 'touch') return;
    if (s.tool !== 'edit' || s.drawing || s.drag.kind !== 'none') {
      this.menu.close();
      return;
    }
    this.updateMetrics();
    const x = e.clientX - this.metrics.left;
    const y = e.clientY - this.metrics.top;
    const hit = this.pick(x, y);
    if (hit.index < 0) {
      this.menu.close();
      return;
    }
    s.selected = hit.index;
    s.armed = hit.index;
    emit(s);
    this.menu.open(hit.index, x, y);
  };

  // ----- keyboard -----------------------------------------------------------

  private onFocus(i: number): void {
    if (i < 0) return;
    const s = this.store;
    s.focused = i;
    s.selected = i;
    s.armed = i;
    emit(s);
  }

  private onBlur(i: number): void {
    const s = this.store;
    if (i >= 0 && s.focused === i) s.focused = null;
    emit(s);
  }

  private onKey(e: KeyboardEvent, i: number): void {
    const s = this.store;
    const n = s.nodes[i];
    if (!n) return;
    const m = this.metrics;
    const step = e.shiftKey ? 10 : 1;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      if (s.tool !== 'edit') return;
      e.preventDefault();
      const p = this.px(i);
      this.keyMenuAt = performance.now();
      this.menu.open(i, p.x + 16, p.y + 16, true);
      return;
    }
    const mutating = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key);
    if (mutating) this.actions.nudge(i);
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': n.x = Math.max(0, n.x - step / m.w); break;
      case 'ArrowRight': n.x = Math.min(1, n.x + step / m.w); break;
      case 'ArrowUp': n.y = Math.max(0, n.y - step / m.h); break;
      case 'ArrowDown': n.y = Math.min(1, n.y + step / m.h); break;
      // In draw mode Esc only leaves the tool (the global handler); deselect needs a second press.
      case 'Escape':
        if (s.tool === 'draw') { handled = false; break; }
        (e.currentTarget as SVGGElement).blur();
        s.selected = null;
        break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      emit(s);
    }
  }

  // ----- per-frame ----------------------------------------------------------

  /** Dashed core outline for non-circle nodes; the path is rebuilt only when its inputs change. */
  private updateOutline(v: NodeView, n: NodeState, rPx: number): void {
    const op = n.shape === 'circle' ? 0 : v.ringOp;
    v.outG.style.opacity = op < 0.005 ? '0' : op.toFixed(3);
    if (op < 0.005) return;
    const min = this.metrics.min;
    const key = n.shape === 'stroke' ? `s|${min.toFixed(1)}` : `${n.shape}|${rPx.toFixed(1)}|${n.drot.toFixed(3)}`;
    if (key === v.outKey && (n.shape !== 'stroke' || v.outPts === n.pts)) return;
    v.outKey = key;
    v.outPts = n.pts;
    let d = '';
    if (n.shape === 'stroke') {
      d = n.pts.map((p, k) => `${k ? 'L' : 'M'}${(p[0] * min).toFixed(1)} ${(p[1] * min).toFixed(1)}`).join('');
    } else {
      d = outlinePoints(n.shape, rPx, n.drot).map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + 'Z';
    }
    v.outHalo.setAttribute('d', d);
    v.outInk.setAttribute('d', d);
  }

  frame(dt: number): void {
    const s = this.store;
    const m = this.metrics;
    const snap = s.reducedMotion;
    this.syncViews();

    // Long-press clock.
    let holdIndex = -1;
    let holdP = 0;
    if (this.hold) {
      holdP = (performance.now() - this.hold.start) / HOLD_MS;
      if (holdP >= 1) {
        this.fireHold();
        holdP = 0;
      } else {
        const h = this.hold;
        holdIndex = s.nodes.findIndex((n) => n.uid === h.uid);
      }
    }

    const engagedRing = s.drag.kind === 'ring' ? s.drag.index : s.hover.kind === 'ring' ? s.hover.index : -1;
    const activeNode = s.drag.kind !== 'none' ? s.drag.index : s.hover.kind !== 'idle' ? s.hover.index : (s.selected ?? s.focused ?? -1);
    const hintArc = s.coarse && engagedRing < 0 && s.selected !== null && s.drag.kind === 'none';

    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      const v = this.views[i];
      n.dx = approach(n.dx, n.x, 28, dt, snap);
      n.dy = approach(n.dy, n.y, 28, dt, snap);
      n.dr = approach(n.dr, n.r, 28, dt, snap);
      n.dsoft = approach(n.dsoft, n.soft, 28, dt, snap);
      n.drot = approach(n.drot, shortestAngle(n.drot, n.rot), 28, dt, snap);

      const isHover = s.hover.kind === 'node' && s.hover.index === i;
      const isBody = s.hover.kind === 'body' && s.hover.index === i;
      const isDrag = s.drag.kind === 'node' && s.drag.index === i;
      const isRing = engagedRing === i;
      const isSoftHover = s.hover.kind === 'soft' && s.hover.index === i && s.drag.kind === 'none';
      const isSoftDrag = s.drag.kind === 'soft' && s.drag.index === i;
      const isSoftFlash = this.flashing(i)?.kind === 'soft';
      const isSel = s.selected === i;
      const isFocus = s.focused === i;
      const isHold = holdIndex === i && holdP > 0.12;
      const bracketTarget = isDrag ? 9 : isRing ? 14 : isHover ? 13 : isSel || isFocus ? 14 : 11;
      v.bracket = isHold ? 14 - 8 * holdP : approach(v.bracket, bracketTarget, 30, dt, snap);
      v.ringOp = approach(v.ringOp, this.revealed(i) ? 1 : 0, 22, dt, snap);

      if (isHold !== v.holding) {
        v.holding = isHold;
        const vis = isHold ? 'visible' : 'hidden';
        v.holdHalo.setAttribute('visibility', vis);
        v.holdInk.setAttribute('visibility', vis);
      }
      if (isHold) {
        const dash = `${(HOLD_C * Math.min(1, holdP)).toFixed(1)} ${HOLD_C.toFixed(1)}`;
        v.holdHalo.setAttribute('stroke-dasharray', dash);
        v.holdInk.setAttribute('stroke-dasharray', dash);
      }

      const x = n.dx * m.w;
      const y = n.dy * m.h;
      const r = n.dr * m.min;
      v.g.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      v.g.dataset.x = (m.left + x).toFixed(1);
      v.g.dataset.y = (m.top + y).toFixed(1);
      v.g.dataset.radius = r.toFixed(1);
      const softAttr = String(Math.round(n.soft * 100));
      if (softAttr !== v.softAttr) {
        v.softAttr = softAttr;
        v.g.dataset.soft = softAttr;
      }
      const layerAttr = String(i + 1);
      if (layerAttr !== v.layerAttr) {
        v.layerAttr = layerAttr;
        v.g.dataset.layer = layerAttr;
      }
      if (v.shape !== n.shape) {
        v.shape = n.shape;
        v.g.dataset.shape = n.shape;
      }
      const npts = n.shape === 'stroke' ? n.pts.length : 0;
      if (v.npts !== npts) {
        v.npts = npts;
        if (npts) v.g.dataset.pts = String(npts);
        else delete v.g.dataset.pts;
      }
      this.updateOutline(v, n, r);

      if (Math.abs(r - v.lastR) > 0.05) {
        v.lastR = r;
        v.ringHalo.setAttribute('r', r.toFixed(2));
        v.ringInk.setAttribute('r', r.toFixed(2));
        const t = ticksPath(r);
        v.ticksHalo.setAttribute('d', t);
        v.ticksInk.setAttribute('d', t);
        const lr = r + 23;
        const at = (el: SVGTextElement, x: number, y: number) => {
          el.setAttribute('x', x.toFixed(1));
          el.setAttribute('y', y.toFixed(1));
        };
        at(v.bearings[0], 0, -lr + 3);
        at(v.bearings[1], lr + 1, 3);
        at(v.bearings[2], 0, lr + 4);
        at(v.bearings[3], -lr - 1, 3);
      }
      // SOFT gauge: hidden on small rings and in draw mode; otherwise it rides the bezel's own fade.
      {
        const gp = v.gaugeParts;
        const want = s.tool === 'edit' && r >= G_MIN_R ? 1 : 0;
        v.gaugeOp = approach(v.gaugeOp, want, 22, dt, snap);
        v.gauge.style.opacity = v.gaugeOp < 0.005 ? '0' : v.gaugeOp.toFixed(3);
        if (v.gaugeOp >= 0.005 && r >= G_MIN_R - 8) {
          const ri = gaugeRi(r);
          if (Math.abs(ri - v.lastRi) > 0.05) {
            v.lastRi = ri;
            const base = gaugeArc(ri, 0, 1);
            gp.baseH.setAttribute('d', base);
            gp.baseI.setAttribute('d', base);
            const t = gaugeTicks(ri);
            gp.ticksH.setAttribute('d', t);
            gp.ticksI.setAttribute('d', t);
            gp.label.setAttribute('y', (ri * 0.8 + 3).toFixed(1));
            v.lastSoft = -1;
          }
          if (Math.abs(n.dsoft - v.lastSoft) > 0.0004) {
            v.lastSoft = n.dsoft;
            const fill = gaugeArc(ri, 0, n.dsoft);
            gp.fillH.setAttribute('d', fill);
            gp.fillI.setAttribute('d', fill);
            const knob = `M${gaugePt(ri, n.dsoft, -7)}L${gaugePt(ri, n.dsoft, 7)}`;
            gp.knobH.setAttribute('d', knob);
            gp.knobI.setAttribute('d', knob);
            gp.label.textContent = `SOFT ${Math.round(n.dsoft * 100)}`;
          }
        }
      }
      // Hide bearing labels that would fall outside the stage instead of letting them clip.
      {
        const lr = r + 23;
        const pad = 12;
        const pts: Array<[number, number]> = [[x, y - lr], [x + lr, y], [x, y + lr], [x - lr, y]];
        pts.forEach(([bx, by], k) => {
          const inside = bx > pad + 10 && bx < m.w - pad - 10 && by > pad && by < m.h - pad;
          const want = inside ? 'visible' : 'hidden';
          if (v.bearings[k].getAttribute('visibility') !== want) v.bearings[k].setAttribute('visibility', want);
        });
      }
      if (Math.abs(v.bracket - v.lastBracket) > 0.01) {
        v.lastBracket = v.bracket;
        const d = bracketPath(v.bracket, 6);
        v.retHalo.setAttribute('d', d);
        v.retInk.setAttribute('d', d);
      }
      const op = v.ringOp;
      v.ring.style.opacity = op < 0.005 ? '0' : op.toFixed(3);
      v.ring.setAttribute('transform', `scale(${(0.94 + 0.06 * op).toFixed(4)})`);

      const cls =
        'node' +
        (isHover ? ' is-hover' : '') +
        (isBody ? ' is-body' : '') +
        (isDrag ? ' is-drag' : '') +
        (isRing ? ' is-ring' : '') +
        (isSoftHover ? ' is-soft-hover' : '') +
        (isSoftDrag ? ' is-soft-drag' : '') +
        (isSoftFlash ? ' is-soft-flash' : '') +
        (isSel ? ' is-selected' : '') +
        (isHold ? ' is-hold' : '') +
        (s.drag.kind === 'ring' && s.drag.index === i ? ' is-ring-drag' : '');
      if (cls !== v.cls) {
        v.cls = cls;
        v.g.setAttribute('class', cls);
      }
    }

    // Bearing arc: one for the whole field.
    const arcTargetOp = engagedRing >= 0 ? 1 : hintArc ? 0.45 : 0;
    s.arcOpacity = approach(s.arcOpacity, arcTargetOp, 26, dt, snap);
    if (hintArc && engagedRing < 0) s.arcTarget = -Math.PI / 4;
    s.arcAngle = approach(s.arcAngle, shortestAngle(s.arcAngle, s.arcTarget), 24, dt, snap);
    const arcNode = engagedRing >= 0 ? engagedRing : hintArc ? s.selected! : -1;
    if (arcNode >= 0 || s.arcOpacity > 0.005) {
      const idx = Math.min(s.nodes.length - 1, arcNode >= 0 ? arcNode : (s.selected ?? 0));
      const p = this.px(idx);
      const span = (40 * Math.PI) / 180;
      const d = arcPath(p.x, p.y, p.r + 9, s.arcAngle, span);
      this.arcHalo.setAttribute('d', d);
      this.arcInk.setAttribute('d', d);
    }
    this.arcG.style.opacity = s.arcOpacity < 0.005 ? '0' : s.arcOpacity.toFixed(3);
    this.arcG.setAttribute('class', 'arc' + (s.drag.kind === 'ring' ? ' is-engaged' : ''));

    // Value readout (FLARE chip): `R 184PX` on the arc while dragging the ring, `SOFT 62%` at the gauge knob while
    // dragging that, and either one for a moment after a wheel / pinch.
    let chip: { text: string; x: number; y: number } | null = null;
    const fl = this.flash && performance.now() <= this.flash.until ? this.flash : null;
    const fi = fl ? s.nodes.findIndex((n) => n.uid === fl.uid) : -1;
    const atRing = (i: number, angle: number): { x: number; y: number } => {
      const p = this.px(i);
      return { x: p.x + Math.cos(angle) * (p.r + 28), y: p.y + Math.sin(angle) * (p.r + 28) };
    };
    const atKnob = (i: number): { x: number; y: number } => {
      const p = this.px(i);
      const a = G_START + G_SPAN * s.nodes[i].dsoft;
      const rr = Math.min(p.r + 22, gaugeRi(p.r) + 26);
      return { x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr };
    };
    if (s.drag.kind === 'ring') {
      chip = { text: `R ${Math.round(this.px(s.drag.index).r)}PX`, ...atRing(s.drag.index, s.arcAngle) };
    } else if (s.drag.kind === 'soft') {
      chip = { text: `SOFT ${Math.round(s.nodes[s.drag.index].soft * 100)}%`, ...atKnob(s.drag.index) };
    } else if (fl && fi >= 0) {
      chip = fl.kind === 'soft'
        ? { text: `SOFT ${Math.round(s.nodes[fi].soft * 100)}%`, ...atKnob(fi) }
        : { text: `R ${Math.round(this.px(fi).r)}PX`, ...atRing(fi, -Math.PI / 4) };
    }
    if (chip) {
      if (chip.text !== this.chipRadiusText) {
        this.chipRadiusText = chip.text;
        this.chipRadius.textContent = chip.text;
        this.chipRadiusW = this.chipRadius.offsetWidth;
      }
      const hw = this.chipRadiusW / 2 + 4;
      const cx = Math.min(m.w - hw, Math.max(hw, chip.x));
      const cy = Math.min(m.h - 14, Math.max(14, chip.y));
      this.chipRadius.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px) translate(-50%, -50%)`;
      this.chipRadius.classList.add('is-on');
    } else {
      this.chipRadius.classList.remove('is-on');
    }

    // Serial / coordinate readout near the active node.
    if (activeNode >= 0 && activeNode < s.nodes.length) {
      const n = s.nodes[activeNode];
      const text = `${nodeSerial(activeNode)} // X ${n.x.toFixed(3)} Y ${n.y.toFixed(3)}`;
      if (text !== this.chipNodeText) {
        this.chipNodeText = text;
        this.chipNode.textContent = text;
        this.chipNodeW = this.chipNode.offsetWidth;
      }
      const p = this.px(activeNode);
      const off = 16;
      const flipX = p.x + off + this.chipNodeW > m.w - 4;
      const flipY = p.y + off + 20 > m.h - 4;
      const cx = flipX ? p.x - off - this.chipNodeW : p.x + off;
      const cy = flipY ? p.y - off - 18 : p.y + off;
      this.chipNode.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
      this.chipNode.classList.add('is-on');
      this.chipNode.classList.toggle('is-engaged', s.drag.kind === 'node');
    } else {
      this.chipNode.classList.remove('is-on');
    }
  }

  get pointer(): { x: number; y: number } {
    return this.lastPointer;
  }
}
