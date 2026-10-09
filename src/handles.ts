import { wheelUp } from './wheel';
import { gaugeHit, gaugeSpacing, layoutGauge, makeGauge, renderGauge, stackGap, type GaugeParts, type Sweep } from './gauge';
import { colorStateOf, createColorPage, layoutColorPage, renderColorPage, withAxis, type ColorAxis, type ColorPage, type ColorState } from './colorpage';
import type { Actions } from './actions';
import type { History } from './history';
import { BODY_Q, nodeQ, outlinePoints } from './field';
import { centroid, distToPolyline, pathLength, rdp, simplifyTo, type Pt } from './geom';
import { BoardMenu, NodeMenu } from './menu';
import { endPlace, placeNode } from './tools';
import {
  addNode,
  emit,
  MAX_NODES,
  nodeSerial,
  R_MAX,
  R_MIN,
  removeNodeAt,
  STROKE_RADIUS,
  tweenNodeTo,
  type NodeState,
  type Store,
} from './store';

const NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;

const ROT_STEP = (15 * Math.PI) / 180;

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
  gaugeParts: GaugeParts;
  gaugeOp: number;
  rotD: SVGGElement;
  rotP: GaugeParts;
  rotOp: number;
  lastRotR: number;
  lastRotA: number;
  opG: SVGGElement;
  opParts: GaugeParts;
  opOp: number;
  lastOpRi: number;
  lastOpac: number;
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
  /** COLOUR page (HUE / SAT / LUM gauges + core swatch) and its 0…1 page-flip progress (0 = default OPAC / SOFT / ROT). */
  cp: ColorPage;
  pg: number;
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

export function bracketPath(o: number, len: number): string {
  const i = o - len;
  return (
    `M${-o} ${-i}V${-o}H${-i}` +
    `M${i} ${-o}H${o}V${-i}` +
    `M${o} ${i}V${o}H${i}` +
    `M${-i} ${o}H${-o}V${i}`
  );
}

export function ticksPath(r: number): string {
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
  /** Gauge stack radii (innermost first), from the same spacing rule as the FX dial; refreshed in `updateMetrics`. */
  private gr = { sp: 30, opac: 45, soft: 75, rot: 105 };
  private pointerId: number | null = null;
  /** uid of the node whose palette chip is hovered/focused in the side panel (null = none). */
  private panelUid: number | null = null;
  private lastPointer = { x: 0, y: 0 };
  private hold: { start: number; x: number; y: number; uid: number } | null = null;
  /** The one node whose bezel shows the COLOUR page (uid), and the unrounded colour behind its hex (see colorpage.ts). */
  private colorUid: number | null = null;
  private colorSt: ColorState | null = null;
  /** A press on a core that has not moved yet: released in place it is a click (toggles the COLOUR page). */
  private coreDown: { uid: number; x: number; y: number; moved: boolean } | null = null;
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
  /** Wheel burst: the zone it started in, so one scroll drives one control. */
  private wheelLock: { uid: number; kind: 'rot' | 'soft' | 'opac' | 'hue' | 'sat' | 'lum' | 'node'; t: number } | null = null;
  private wheelHideTimer = 0;
  /** Node whose control the wheel is driving, until ~700 ms after the last tick (drives `ui-focus`). */
  private wheelFocus: { uid: number; until: number; kind: string } | null = null;
  /** Wheel / pinch feedback: which node, what was changed, and until when the readout and bezel stay up. */
  private flash: { uid: number; kind: 'r' | 'soft' | 'rot' | 'opac' | 'hue' | 'sat' | 'lum'; until: number } | null = null;
  /** Touch pointers on the stage, and the two-finger pinch (reach of the selected node). */
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { uid: number; d0: number; r0: number } | null = null;
  private lastPointerType = 'mouse';
  private keyMenuAt = -Infinity;
  private menu: NodeMenu;
  private boardMenu: BoardMenu;

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
    this.wirePalette();
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
    this.boardMenu = new BoardMenu(store, stage, actions, () => ({ w: this.metrics.w, h: this.metrics.h }));

    stage.addEventListener('pointerdown', this.onDown);
    stage.addEventListener('pointermove', this.onMove);
    stage.addEventListener('pointerup', this.onUp);
    stage.addEventListener('pointercancel', this.onUp);
    stage.addEventListener('pointerleave', this.onLeave);
    // The browser's own menu is suppressed on the canvas only; a hit node gets the layer menu instead.
    stage.addEventListener('contextmenu', this.onContextMenu);
    // Non-passive: over a node the wheel / pinch must never scroll or zoom the page.
    stage.addEventListener('wheel', this.onWheel, { passive: false });
    // Esc and undo / redo end a wheel burst's focus at once.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && /^[zy]$/i.test(e.key))) this.wheelFocus = null;
    }, true);
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

    // OPAC / SOFT / ROT: the FX dial's gauge, on fixed radii packed round the core (see gauge.ts).
    const gp = makeGauge('gauge soft', 'SOFT');
    const op = makeGauge('gauge opac', 'OPAC');
    const rp = makeGauge('gauge rot', 'ROT');
    // Both pages share one bottom gap: every ring ends on the same bearing, sized by the ring that needs the most room.
    const half = this.gaugeHalf(op, gp, rp);
    layoutGauge(gp, this.gr.soft, this.gr.sp, half);
    layoutGauge(op, this.gr.opac, this.gr.sp, half);
    layoutGauge(rp, this.gr.rot, this.gr.sp, half);
    const gauge = gp.g;
    const opG = op.g;
    const rotD = rp.g;
    const cp = createColorPage();
    layoutColorPage(cp, this.gr.rot, this.gr.soft, this.gr.opac, this.gr.sp, half);
    for (const c of [cp.lum, cp.sat, cp.hue]) c.p.g.style.opacity = '0';
    ring.append(opG, gauge, rotD, cp.lum.p.g, cp.sat.p.g, cp.hue.p.g);

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
    // LOCK glyph: a small padlock off the reticle's top-right corner (shown by `.is-locked`).
    const lockG = el('g', { class: 'lock-g', transform: 'translate(17 -17)' });
    const lockD = 'M-2.5 0V-2.2a2.5 2.5 0 0 1 5 0V0';
    lockG.append(
      el('path', { class: 'halo lock-sh', d: lockD }), el('rect', { class: 'halo lock-bd', x: -3.5, y: 0, width: 7, height: 5.5 }),
      el('path', { class: 'ink lock-sh', d: lockD }), el('rect', { class: 'ink lock-bd', x: -3.5, y: 0, width: 7, height: 5.5 }),
    );
    g.append(ring, outG, focusHalo, focus, holdHalo, holdInk, retHalo, retInk, cp.sw, coreHalo, coreInk, lockG);

    const view: NodeView = {
      outG, outHalo, outInk, outKey: '', outPts: null, shape: '', npts: -1,
      uid: n.uid, g, ring, ringHalo, ringInk, ticksHalo, ticksInk, bearings, retHalo, retInk, focus,
      gauge, gaugeParts: gp, gaugeOp: 0, rotD, rotP: rp, rotOp: 0, lastRotR: -1, lastRotA: -9, opG, opParts: op, opOp: 0, lastOpRi: -1, lastOpac: -1, lastRi: -1, lastSoft: -1, softAttr: '', layerAttr: '',
      holdHalo, holdInk, holding: false, cp, pg: 0,
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
    const { sp, r0 } = gaugeSpacing(m.w, m.h);
    if (Math.abs(sp - this.gr.sp) > 0.01) {
      this.gr = { sp, opac: r0, soft: r0 + sp, rot: r0 + 2 * sp };
      for (const v of this.views) {
        const half = this.gaugeHalf(v.opParts, v.gaugeParts, v.rotP);
        layoutGauge(v.opParts, this.gr.opac, sp, half);
        layoutGauge(v.gaugeParts, this.gr.soft, sp, half);
        layoutGauge(v.rotP, this.gr.rot, sp, half);
        layoutColorPage(v.cp, this.gr.rot, this.gr.soft, this.gr.opac, sp, half);
      }
    }
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

  /** How far from the centre a node still counts as "under the pointer": its size ring or its outermost gauge, whichever is larger. */
  private reachR(i: number, ringR: number): number {
    if (this.store.tool !== 'edit') return ringR;
    return Math.max(ringR, (this.rotShown(i) || this.onColor(i) ? this.gr.rot : this.gr.soft) + 12);
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
  private flashing(i: number): { kind: 'r' | 'soft' | 'rot' | 'opac' | 'hue' | 'sat' | 'lum' } | null {
    const f = this.flash;
    if (!f || performance.now() > f.until) return null;
    return this.store.nodes[i]?.uid === f.uid ? f : null;
  }

  /** Panel-driven hover: set from the palette chips. Real board hover, a drag or an open FX dial win. */
  /** Delegated listeners on the palette strip: chip hover/focus lights the matching node. Mouse/pen/keyboard only. */
  private wirePalette(): void {
    const pal = document.getElementById('palette');
    if (!pal) return;
    const idx = (e: Event): number => {
      const b = (e.target as Element | null)?.closest?.('.chip-btn') as HTMLElement | null;
      return b ? Number(b.dataset.chip) : -1;
    };
    const on = (e: Event): void => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      const i = idx(e);
      if (i >= 0) this.setPanelHover(i);
    };
    const off = (e: Event): void => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      if (idx(e) >= 0) this.setPanelHover(null);
    };
    pal.addEventListener('pointerover', on);
    pal.addEventListener('pointerout', off);
    pal.addEventListener('focusin', (e) => {
      const b = e.target as HTMLElement;
      if (b.matches?.(':focus-visible')) on(e);
    });
    pal.addEventListener('focusout', off);
    pal.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setPanelHover(null);
    });
  }

  setPanelHover(i: number | null): void {
    const n = i === null ? undefined : this.store.nodes[i];
    this.panelUid = n ? n.uid : null;
  }

  /** Index of the node highlighted from the panel, or -1 when it is stale or overridden. */
  private panelHoverIndex(): number {
    const s = this.store;
    if (this.panelUid === null || s.drag.kind !== 'none' || s.hover.kind !== 'idle') return -1;
    if (document.querySelector('.fxdial.is-open, .fx-dial.is-open, [data-fxdial="open"]')) return -1;
    return s.nodes.findIndex((n) => n.uid === this.panelUid);
  }

  private revealed(i: number): boolean {
    const s = this.store;
    return (
      this.panelHoverIndex() === i ||
      s.armed === i ||
      this.flashing(i) !== null ||
      s.selected === i ||
      s.focused === i ||
      (s.hover.kind !== 'idle' && s.hover.index === i) ||
      (s.drag.kind !== 'none' && s.drag.index === i)
    );
  }

  /** Are node `i`'s gauges on screen (and so grabbable)? Edit tool only: they sit at fixed radii, whatever the node's size. */
  private gaugeShown(i: number): boolean {
    return this.store.tool === 'edit' && !this.store.nodes[i]?.lock;
  }

  /** Something is active (a selected / focused node or stroke, an open node menu, a stroke being drawn): the next empty click only clears it. */
  busy(): boolean {
    const s = this.store;
    return s.selected !== null || s.focused !== null || s.drawing || this.menu.isOpen || this.colorUid !== null;
  }

  /** Is node `i` on the COLOUR page (edit tool only)? */
  private onColor(i: number): boolean {
    const n = this.store.nodes[i];
    return !!n && this.colorUid === n.uid && this.store.tool === 'edit' && !n.lock;
  }

  /** The unrounded colour of node `i`, kept across edits (see colorpage.ts). */
  private colorOf(i: number): ColorState {
    const n = this.store.nodes[i];
    this.colorSt = colorStateOf(n.uid, n.hex, this.colorSt);
    return this.colorSt;
  }

  /** Put node `i` on the COLOUR page (or back to the default one with `on = false`); only one node is ever on it. */
  private setColorPage(i: number, on: boolean): void {
    const n = this.store.nodes[i];
    if (!n) return;
    if (on && this.actions.isLocked(i)) return;
    if (on) {
      this.colorUid = n.uid;
      this.colorOf(i);
    } else if (this.colorUid === n.uid) this.colorUid = null;
  }

  /** Write one axis of node `i`'s colour (0…1 along its gauge) live: no tween, so the canvas follows the pointer. */
  private setAxis(i: number, axis: ColorAxis, v: number): void {
    const s = this.store;
    const n = s.nodes[i];
    if (!n) return;
    const next = withAxis(this.colorOf(i), axis, v);
    this.colorSt = next;
    if (n.hex !== next.hex) tweenNodeTo(s, n, next.hex, performance.now(), 0);
    s.modified = true;
    emit(s);
  }

  /** Is the board empty at stage point (x, y)? Edit tool only; the core, gauge, ring band and body all count as a node. */
  emptyAt(x: number, y: number): boolean {
    if (this.store.tool !== 'edit' || this.store.drawing) return false;
    this.updateMetrics();
    return this.pick(x, y).kind === 'none';
  }

  /** Is node `i`'s ROT handle on screen? Same gate as SOFT, and only where rotation shows (not circles or strokes). */
  private rotShown(i: number): boolean {
    const sh = this.store.nodes[i].shape;
    return this.gaugeShown(i) && sh !== 'circle' && sh !== 'stroke';
  }

  /** Grab-zone priority: core → ROT dial / OPAC / SOFT gauges → revealed ring band → shape/stroke body → nothing. Nearest wins. */
  private pick(x: number, y: number): { kind: 'node' | 'soft' | 'rot' | 'opac' | 'hue' | 'sat' | 'lum' | 'ring' | 'body' | 'none'; index: number } {
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

    // Gauge rings, outermost first: the FX dial's own hit rule (half a ring spacing either side, any angle, the bottom gap included).
    // A node on the COLOUR page offers HUE / SAT / LUM on the same three radii instead of ROT / SOFT / OPAC.
    const arcs = [['rot', this.gr.rot], ['hue', this.gr.rot], ['soft', this.gr.soft], ['sat', this.gr.soft], ['opac', this.gr.opac], ['lum', this.gr.opac]] as const;
    for (const [kind, ri] of arcs) {
      let bi = -1;
      let bd = Infinity;
      const colorKind = kind === 'hue' || kind === 'sat' || kind === 'lum';
      for (let i = 0; i < this.store.nodes.length; i++) {
        if (!this.revealed(i) || this.onColor(i) !== colorKind) continue;
        if (!(kind === 'rot' ? this.rotShown(i) : this.gaugeShown(i))) continue;
        const p = this.px(i);
        const d = gaugeHit(ri, x - p.x, y - p.y, this.gr.sp);
        if (d !== null && d < bd) {
          bi = i;
          bd = d;
        }
      }
      if (bi >= 0) return { kind, index: bi };
    }

    let bestR = -1;
    let bestRD = Infinity;
    for (let i = 0; i < this.store.nodes.length; i++) {
      // Only circles show the dotted size ring; other shapes resize by scroll / pinch / keys.
      if (!this.revealed(i) || this.store.nodes[i].shape !== 'circle' || this.store.nodes[i].lock) continue;
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
    this.coreDown = null;

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
    if (res.index >= 0 && s.nodes[res.index]?.lock) {
      // LOCK: the node can be selected (and, on touch, held for its menu) but never grabbed.
      const li = res.index;
      s.selected = li;
      s.armed = li;
      this.lastTap = null;
      this.views[li].g.focus({ preventScroll: true });
      if (e.pointerType === 'touch' && wasSelected === li) this.hold = { start: performance.now(), x, y, uid: s.nodes[li].uid };
      this.actions.isLocked(li);
      emit(s);
      return;
    }
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
      // Released in place this press is a click on the core: it flips the COLOUR page (see onUp).
      this.coreDown = { uid: s.nodes[res.index].uid, x, y, moved: false };
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
    } else if (res.kind === 'opac') {
      this.history.begin();
      s.drag = { kind: 'opac', index: res.index };
      s.hover = { kind: 'opac', index: res.index };
      s.selected = res.index;
      s.armed = res.index;
      this.lastTap = null;
      this.softPrev = s.nodes[res.index].opac;
      this.softGap = false;
      this.applyOpac(res.index, x, y);
    } else if (res.kind === 'rot') {
      this.history.begin();
      s.drag = { kind: 'rot', index: res.index };
      s.hover = { kind: 'rot', index: res.index };
      s.selected = res.index;
      s.armed = res.index;
      this.lastTap = null;
      this.softPrev = s.nodes[res.index].rot / TAU;
      this.softGap = false;
      this.applyRot(res.index, x, y, e.shiftKey);
    } else if (res.kind === 'hue' || res.kind === 'sat' || res.kind === 'lum') {
      this.history.begin();
      s.drag = { kind: res.kind, index: res.index };
      s.hover = { kind: res.kind, index: res.index };
      s.selected = res.index;
      s.armed = res.index;
      this.lastTap = null;
      const st = this.colorOf(res.index);
      this.softPrev = res.kind === 'hue' ? st.h / 360 : res.kind === 'sat' ? st.s : st.L;
      this.softGap = false;
      this.applyColor(res.index, res.kind, x, y);
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
        this.actions.addAt(x / this.metrics.w, y / this.metrics.h, true);
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
    // Past a few px the core press is a drag, not a click.
    const cd = this.coreDown;
    if (cd && Math.hypot(x - cd.x, y - cd.y) > (e.pointerType === 'touch' ? 8 : 4)) cd.moved = true;

    if (s.drawing) {
      if (e.pointerId === this.pointerId) this.extendStroke(e);
      return;
    }
    if (s.drag.kind === 'node') {
      const n = s.nodes[s.drag.index];
      if (!n) return;
      // SNAP / MIRROR (tools.ts): ⌘/Ctrl inverts snapping for this drag; partners follow the primary node.
      placeNode(s, this.metrics, n, (x + this.dragOffset.x) / this.metrics.w, (y + this.dragOffset.y) / this.metrics.h, e.metaKey || e.ctrlKey);
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
    if (s.drag.kind === 'hue' || s.drag.kind === 'sat' || s.drag.kind === 'lum') {
      this.applyColor(s.drag.index, s.drag.kind, x, y);
      return;
    }
    if (this.stage.classList.contains('wheel-hide') && (e.movementX || e.movementY)) this.stage.classList.remove('wheel-hide');
    if (s.drag.kind === 'opac') {
      this.applyOpac(s.drag.index, x, y);
      return;
    }
    if (s.drag.kind === 'rot') {
      this.applyRot(s.drag.index, x, y, e.shiftKey);
      return;
    }
    if (e.pointerType === 'touch') return;
    this.hoverAt(x, y);
  };

  /**
   * One half-gap for a node's whole gauge stack (OPAC / SOFT / ROT and, on the same radii, LUM / SAT / HUE): the
   * largest any of them needs (`stackGap`), so all six end on the same bearing. The COLOUR page's names are the same
   * length class, so its gauges are measured through their default-page twins.
   */
  private gaugeHalf(op: GaugeParts, soft: GaugeParts, rot: GaugeParts): number {
    const g = this.gr;
    return stackGap([[op, g.opac], [soft, g.soft], [rot, g.rot]], g.sp);
  }

  /**
   * Pointer offset → 0–1 along a gauge's own sweep. In the bottom gap the value sticks to the end it came from, and
   * leaving the gap on the far side holds that end until the pointer comes back round (no snap across the gap).
   */
  private arcT(sw: Sweep, dx: number, dy: number): number {
    const u = (((Math.atan2(dy, dx) - sw.a0) % TAU) + TAU) % TAU;
    let t: number;
    if (u > sw.span) {
      t = this.softPrev > 0.5 ? 1 : 0;
      this.softGap = true;
    } else {
      t = u / sw.span;
      if (this.softGap && Math.abs(t - this.softPrev) > 0.5) t = this.softPrev;
      else this.softGap = false;
    }
    this.softPrev = t;
    return t;
  }

  /** Pointer angle around the node → 0–1 along the 270° arc. In the bottom gap the value sticks to the end it came from. */
  private applySoft(i: number, x: number, y: number): void {
    const n = this.store.nodes[i];
    if (!n) return;
    const p = this.px(i);
    const t = this.arcT(this.views[i].gaugeParts.sw, x - p.x, y - p.y);
    n.soft = Math.round(t * 1000) / 1000;
  }

  /** Same mapping as SOFT (270° arc, gap holds the end it came from) for the OPAC gauge. */
  private applyOpac(i: number, x: number, y: number): void {
    const n = this.store.nodes[i];
    if (!n) return;
    const p = this.px(i);
    const t = this.arcT(this.views[i].opParts.sw, x - p.x, y - p.y);
    n.opac = Math.round(t * 1000) / 1000;
    this.store.modified = true;
  }

  /** HUE / SAT / LUM drag: the same 270° arc mapping as SOFT (the gap holds the end the value came from). */
  private applyColor(i: number, axis: ColorAxis, x: number, y: number): void {
    if (!this.store.nodes[i]) return;
    const p = this.px(i);
    const t = this.arcT(this.views[i].cp[axis].p.sw, x - p.x, y - p.y);
    this.setAxis(i, axis, t);
  }

  /** ROT is the same 270° arc as SOFT: 0–360° mapped along it, the gap holding the end it came from (⇧ snaps to 15°). */
  private applyRot(i: number, x: number, y: number, snap: boolean): void {
    const n = this.store.nodes[i];
    if (!n) return;
    const p = this.px(i);
    const t = this.arcT(this.views[i].rotP.sw, x - p.x, y - p.y);
    let a = Math.min(t, 0.9999) * TAU;
    if (snap) a = Math.round(a / ROT_STEP) * ROT_STEP;
    n.rot = ((a % TAU) + TAU) % TAU;
    this.store.modified = true;
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
    } else if (res.kind === 'opac') {
      s.hover = { kind: 'opac', index: res.index };
    } else if (res.kind === 'rot') {
      s.hover = { kind: 'rot', index: res.index };
    } else if (res.kind === 'hue' || res.kind === 'sat' || res.kind === 'lum') {
      s.hover = { kind: res.kind, index: res.index };
    } else if (res.kind === 'ring') {
      s.hover = { kind: 'ring', index: res.index };
      this.aimArc(res.index, x, y);
    } else {
      s.hover = { kind: 'idle', index: -1 };
    }
    if (s.armed !== null && s.armed !== s.selected && s.armed !== s.focused) {
      const p = this.px(s.armed);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > this.reachR(s.armed, p.r) + this.hitSizes().band * 1.6) s.armed = null;
    }
    // Moving onto a different control ends a wheel burst at once: its dim focus, zone lock and FLARE flash would
    // otherwise hold the old dial for up to 900 ms after the pointer has already moved on.
    const wf = this.wheelFocus;
    const fl = this.flash;
    if (wf || this.wheelLock || fl) {
      const h = s.hover;
      const kind = h.kind === 'soft' || h.kind === 'rot' || h.kind === 'opac' || h.kind === 'hue' || h.kind === 'sat' || h.kind === 'lum' ? h.kind : 'ring';
      const uid = h.index >= 0 ? s.nodes[h.index]?.uid : undefined;
      const ref = wf
        ?? (this.wheelLock ? { uid: this.wheelLock.uid, kind: this.wheelLock.kind === 'node' ? 'ring' : this.wheelLock.kind } : null)
        ?? { uid: fl!.uid, kind: fl!.kind === 'r' ? 'ring' : fl!.kind };
      if (h.kind === 'idle' || uid !== ref.uid || kind !== ref.kind) {
        this.wheelFocus = null;
        this.wheelLock = null;
        this.flash = null;
      }
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
    const click = this.coreDown;
    this.coreDown = null;
    if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
    if (click && !click.moved && e.type === 'pointerup' && s.drag.kind === 'node' && s.tool === 'edit') {
      // A click on the core (no drag): flip that node's bezel between the default page and COLOUR.
      const ci = s.nodes.findIndex((n) => n.uid === click.uid);
      if (ci >= 0) this.setColorPage(ci, !this.onColor(ci));
    }
    if (s.drawing) {
      if (e.type === 'pointercancel') this.cancelStroke('STROKE CANCELLED');
      else this.finishStroke();
    } else if (s.drag.kind !== 'none' && s.drag.index < s.nodes.length) {
      this.history.commit(this.dragLabel());
    } else {
      this.history.commit('');
    }
    endPlace();
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
    return `${kind === 'ring' ? 'RADIUS' : kind === 'soft' ? 'SOFT' : kind === 'rot' ? 'ROT' : kind === 'opac' ? 'OPAC' : kind === 'hue' ? 'HUE' : kind === 'sat' ? 'SAT' : kind === 'lum' ? 'LUM' : 'MOVE'} ${nodeSerial(index)}`;
  }

  /** Long-press completed: end the drag (it moved at most a few px) and open the node menu beside the node. */
  private fireHold(): void {
    const s = this.store;
    const h = this.hold;
    this.hold = null;
    this.coreDown = null;
    if (!h) return;
    const i = s.nodes.findIndex((n) => n.uid === h.uid);
    if (i < 0) return;
    if (this.pointerId !== null && this.stage.hasPointerCapture(this.pointerId)) {
      this.stage.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    this.pointerInside = false;
    if (s.drag.kind !== 'none') this.history.commit(this.dragLabel());
    endPlace();
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
    if (this.pinch || s.tool !== 'edit' || s.selected === null || s.selected >= s.nodes.length || s.nodes[s.selected].lock) return;
    const d0 = this.pinchDistance();
    if (d0 < 12) return;
    if (s.drag.kind !== 'none') {
      this.history.commit(this.dragLabel());
      s.drag = { kind: 'none', index: -1 };
      endPlace();
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
    // A burst keeps the zone it started in, so resizing a ring never flips onto a gauge mid-scroll.
    const now = performance.now();
    const wl = this.wheelLock;
    if (wl && now - wl.t < 400) {
      const li = s.nodes.findIndex((nn) => nn.uid === wl.uid);
      if (li >= 0 && !e.ctrlKey) {
        i = li;
        hit.kind = wl.kind;
      }
    }
    if (i < 0) {
      // Between the gauge, ring and core of a node the pointer is still "on" it: hovered or armed, within reach.
      const c = s.hover.kind !== 'idle' ? s.hover.index : (s.armed ?? -1);
      if (c >= 0 && c < s.nodes.length) {
        const p = this.px(c);
        if (Math.hypot(x - p.x, y - p.y) <= this.reachR(c, p.r) + this.hitSizes().band * 1.6) i = c;
      }
    }
    if (i < 0) return;
    e.preventDefault();
    s.armed = i;
    if (s.nodes[i].lock) {
      this.actions.isLocked(i);
      return;
    }
    const zone0 = hit.kind;
    const colorZone = zone0 === 'hue' || zone0 === 'sat' || zone0 === 'lum';
    const zone = e.ctrlKey ? 'r' : (e.shiftKey || e.altKey) && !colorZone ? 'soft' : zone0;
    this.wheelFocus = { uid: s.nodes[i].uid, until: performance.now() + 700, kind: zone === 'soft' || zone === 'rot' || zone === 'opac' || zone === 'hue' || zone === 'sat' || zone === 'lum' ? zone : 'ring' };
    const onGauge = zone === 'rot' || zone === 'soft' || zone === 'opac' || zone === 'hue' || zone === 'sat' || zone === 'lum';
    this.wheelLock = { uid: s.nodes[i].uid, kind: onGauge ? zone : 'node', t: now };
    if (onGauge || (!e.ctrlKey && (e.shiftKey || e.altKey))) {
      // The cursor steps aside while a gauge is being wheeled, like the FX dial.
      this.stage.classList.add('wheel-hide');
      window.clearTimeout(this.wheelHideTimer);
      this.wheelHideTimer = window.setTimeout(() => this.stage.classList.remove('wheel-hide'), 700);
    }
    if (zone === 'hue' || zone === 'sat' || zone === 'lum') {
      // COLOUR page: ~25° of hue / ~10% of SAT or LUM per 100-unit notch, one `HUE` / `SAT` / `LUM` undo step per burst.
      const d = wheelUp(e, true);
      if (d === 0) return;
      this.flash = { uid: s.nodes[i].uid, kind: zone, until: performance.now() + 900 };
      this.actions.colorBurst(i, zone);
      const st = this.colorOf(i);
      if (zone === 'hue') this.setAxis(i, 'hue', Math.min(1, Math.max(0, st.h / 360 + d * 0.25 / 360)));
      else this.setAxis(i, zone, Math.min(1, Math.max(0, (zone === 'sat' ? st.s : st.L) + d * 0.001)));
    } else if (zone === 'rot') {
      // Over the ROT dial the wheel turns the node: ~4° per 100-unit notch, one `ROT` undo step per burst.
      const d = wheelUp(e, true);
      if (d === 0) return;
      this.flash = { uid: s.nodes[i].uid, kind: 'rot', until: performance.now() + 900 };
      this.actions.rotate(i, d * 0.04);
    } else if (zone === 'opac') {
      const d = wheelUp(e, true);
      if (d === 0) return;
      this.flash = { uid: s.nodes[i].uid, kind: 'opac', until: performance.now() + 900 };
      this.actions.opacBy(i, d * 0.0012);
    } else if (zone === 'soft' || (!e.ctrlKey && (e.shiftKey || e.altKey))) {
      // Shift+wheel arrives as deltaX in Chromium on macOS.
      const d = wheelUp(e, true);
      if (d === 0) return;
      this.flash = { uid: s.nodes[i].uid, kind: 'soft', until: performance.now() + 900 };
      this.actions.softBy(i, d * 0.0012);
    } else {
      const dy = wheelUp(e) * (e.ctrlKey ? 3 : 1);
      if (dy === 0) return;
      this.flash = { uid: s.nodes[i].uid, kind: 'r', until: performance.now() + 900 };
      const k = Math.exp(dy * 0.0015);
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
      this.boardMenu.close();
      return;
    }
    this.updateMetrics();
    const x = e.clientX - this.metrics.left;
    const y = e.clientY - this.metrics.top;
    const hit = this.pick(x, y);
    if (hit.index < 0) {
      // Off every node: the artboard's own menu (ADD NODE HERE · DRAW).
      this.menu.close();
      if (s.selected !== null) {
        s.selected = null;
        emit(s);
      }
      this.boardMenu.open(x, y);
      return;
    }
    this.boardMenu.close();
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
    if (mutating && this.actions.isLocked(i)) {
      e.preventDefault();
      return;
    }
    if (mutating) this.actions.nudge(i);
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': n.x = Math.max(0, n.x - step / m.w); break;
      case 'ArrowRight': n.x = Math.min(1, n.x + step / m.w); break;
      case 'ArrowUp': n.y = Math.max(0, n.y - step / m.h); break;
      case 'ArrowDown': n.y = Math.min(1, n.y + step / m.h); break;
      // Enter flips the COLOUR page, like a click on the core.
      case 'Enter':
        if (s.tool !== 'edit') { handled = false; break; }
        this.setColorPage(i, !this.onColor(i));
        break;
      // In draw mode Esc only leaves the tool (the global handler); deselect needs a second press.
      case 'Escape':
        if (s.tool === 'draw') { handled = false; break; }
        // Esc on the COLOUR page returns to the default one first; a second press deselects.
        if (this.onColor(i)) { this.setColorPage(i, false); break; }
        (e.currentTarget as SVGGElement).blur();
        s.selected = null;
        break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      if (mutating) placeNode(s, m, n, n.x, n.y, null); // mirror partners follow a nudge; no snapping
      emit(s);
    }
  }

  // ----- per-frame ----------------------------------------------------------

  /** Dashed path of a stroke node (ellipse / box / capsule draw no outline: the field shows their shape); rebuilt only when its inputs change. */
  private updateOutline(v: NodeView, n: NodeState, rPx: number): void {
    const op = n.shape !== 'stroke' ? 0 : Math.min(1, v.ringOp * 2);
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
    const panelIdx = this.panelHoverIndex();
    const hintArc = s.coarse && engagedRing < 0 && s.selected !== null && s.drag.kind === 'none' && s.nodes[s.selected]?.shape === 'circle';

    // The COLOUR page lasts while its node stays selected in the edit tool: Esc, a click off, delete, a tool change all end it.
    if (this.colorUid !== null) {
      const ci = s.nodes.findIndex((nn) => nn.uid === this.colorUid);
      if (ci < 0 || s.selected !== ci || s.tool !== 'edit') this.colorUid = null;
    }

    // Focus: while any dial / gauge / ring is being dragged or wheeled, the rest of the artboard UI dims (CSS keys off `ui-focus`).
    let focusIdx = -1;
    let focusKind = '';
    if (['soft', 'rot', 'opac', 'hue', 'sat', 'lum', 'ring'].includes(s.drag.kind) && s.drag.index < s.nodes.length) {
      focusIdx = s.drag.index;
      focusKind = s.drag.kind;
    } else if (s.drag.kind === 'node' && s.drag.index < s.nodes.length && (!this.coreDown || this.coreDown.moved)) {
      // Moving a node (past the click slop, so a plain click on the core never flashes the dim).
      focusIdx = s.drag.index;
      focusKind = 'node';
    } else if (this.wheelFocus) {
      const wi = performance.now() <= this.wheelFocus.until ? s.nodes.findIndex((nn) => nn.uid === this.wheelFocus!.uid) : -1;
      if (wi >= 0) {
        focusIdx = wi;
        focusKind = this.wheelFocus.kind;
      } else this.wheelFocus = null;
    }
    // The FX dial owns `ui-focus` while it is adjusted (`fx-focus`): never clear it from here.
    this.stage.classList.toggle('ui-focus', focusIdx >= 0 || this.stage.classList.contains('fx-focus'));
    // Engaged: while a node is hovered or selected in the edit tool (its bezel is the thing being played with), the
    // other nodes step back (CSS `.node-engaged`); the hovered one wins over the selection. The FX dial does the same
    // for every node while it is open (`.fx-open`).
    const hovIdx = s.hover.kind !== 'idle' && s.hover.index >= 0 && s.hover.index < s.nodes.length ? s.hover.index : -1;
    const selIdx = s.selected !== null && s.selected < s.nodes.length ? s.selected : -1;
    const engagedIdx = s.tool === 'edit' && !s.drawing ? (hovIdx >= 0 ? hovIdx : selIdx) : -1;
    this.stage.classList.toggle('node-engaged', engagedIdx >= 0);

    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      const v = this.views[i];
      n.dx = approach(n.dx, n.x, 28, dt, snap);
      n.dy = approach(n.dy, n.y, 28, dt, snap);
      n.dr = approach(n.dr, n.r, 28, dt, snap);
      n.dsoft = approach(n.dsoft, n.soft, 28, dt, snap);
      n.dopac = approach(n.dopac, n.opac, 28, dt, snap);
      n.drot = approach(n.drot, shortestAngle(n.drot, n.rot), 28, dt, snap);

      const isHover = (s.hover.kind === 'node' && s.hover.index === i) || panelIdx === i;
      const isBody = s.hover.kind === 'body' && s.hover.index === i;
      const isDrag = s.drag.kind === 'node' && s.drag.index === i;
      const isRing = engagedRing === i;
      const isSoftHover = s.hover.kind === 'soft' && s.hover.index === i && s.drag.kind === 'none';
      const isSoftDrag = s.drag.kind === 'soft' && s.drag.index === i;
      const isSoftFlash = this.flashing(i)?.kind === 'soft';
      const isRotHover = s.hover.kind === 'rot' && s.hover.index === i && s.drag.kind === 'none';
      const isRotDrag = s.drag.kind === 'rot' && s.drag.index === i;
      const isRotFlash = this.flashing(i)?.kind === 'rot';
      const isOpacHover = s.hover.kind === 'opac' && s.hover.index === i && s.drag.kind === 'none';
      const isOpacDrag = s.drag.kind === 'opac' && s.drag.index === i;
      const isOpacFlash = this.flashing(i)?.kind === 'opac';
      const isHueHover = s.hover.kind === 'hue' && s.hover.index === i && s.drag.kind === 'none';
      const isSatHover = s.hover.kind === 'sat' && s.hover.index === i && s.drag.kind === 'none';
      const isLumHover = s.hover.kind === 'lum' && s.hover.index === i && s.drag.kind === 'none';
      const fk = this.flashing(i)?.kind;
      const isHueDrag = (s.drag.kind === 'hue' && s.drag.index === i) || fk === 'hue';
      const isSatDrag = (s.drag.kind === 'sat' && s.drag.index === i) || fk === 'sat';
      const isLumDrag = (s.drag.kind === 'lum' && s.drag.index === i) || fk === 'lum';
      const isSel = s.selected === i;
      const isFocus = s.focused === i;
      const isHold = holdIndex === i && holdP > 0.12;
      const bracketTarget = isDrag ? 9 : isRing ? 14 : isHover ? 13 : isSel || isFocus ? 14 : 11;
      v.bracket = isHold ? 14 - 8 * holdP : approach(v.bracket, bracketTarget, 30, dt, snap);
      // Bezel progress 0…1 runs linearly in time (open 260 ms, close 200 ms) and every part derives its own
      // staggered, eased share of it, so closing is the exact reverse and a re-open mid-close turns round smoothly.
      const wantOpen = this.revealed(i);
      v.ringOp = snap ? (wantOpen ? 1 : 0) : Math.min(1, Math.max(0, v.ringOp + (wantOpen ? dt / 0.26 : -dt / 0.2)));
      const P = v.ringOp;
      const part = (k: number): number => {
        const t = Math.min(1, Math.max(0, (P - 0.1 * k) / 0.5));
        return 1 - (1 - t) * (1 - t) * (1 - t);
      };
      // Brackets close in from 2× on open and swing out and back on close (no pop at the ends).
      const bOff = wantOpen ? 11 * (1 - part(0)) : 8 * 4 * P * (1 - P);

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
      // OPAC, SOFT, ROT: the FX dial's gauges at fixed radii (innermost first), each riding the bezel's staggered fade.
      {
        const edit = s.tool === 'edit' && !n.lock ? 1 : 0;
        // Page flip: pg runs linearly 0 → 1 (COLOUR) in 0.36 s and back. The first half collapses the default gauges
        // outermost-first (the open stagger reversed), the second grows HUE / SAT / LUM in innermost-first, like opening.
        const wantColor = this.onColor(i);
        v.pg = snap ? (wantColor ? 1 : 0) : Math.min(1, Math.max(0, v.pg + (wantColor ? dt : -dt) / 0.36));
        const ez = (q: number): number => {
          const c = Math.min(1, Math.max(0, q));
          return 1 - (1 - c) * (1 - c) * (1 - c);
        };
        const cOut = Math.min(1, v.pg * 2);
        const cIn = Math.max(0, v.pg * 2 - 1);
        const dflt = (k: number): number => 1 - ez((cOut - 0.1 * (4 - k)) / 0.6);
        const colr = (k: number): number => ez((cIn - 0.1 * (k - 2)) / 0.6);
        const rotOk = edit && n.shape !== 'circle' && n.shape !== 'stroke' ? 1 : 0;
        v.opOp = approach(v.opOp, edit, 22, dt, snap);
        v.gaugeOp = approach(v.gaugeOp, edit, 22, dt, snap);
        v.rotOp = approach(v.rotOp, rotOk, 22, dt, snap);
        const fo = (a: number): string => (a < 0.005 ? '0' : a.toFixed(3));
        v.opG.style.opacity = fo(v.opOp * part(2) * dflt(2));
        v.gauge.style.opacity = fo(v.gaugeOp * part(3) * dflt(3));
        v.rotD.style.opacity = fo(v.rotOp * part(4) * dflt(4));
        v.cp.lum.p.g.style.opacity = fo(edit * part(2) * colr(2));
        v.cp.sat.p.g.style.opacity = fo(edit * part(3) * colr(3));
        v.cp.hue.p.g.style.opacity = fo(edit * part(4) * colr(4));
        v.cp.sw.style.opacity = fo(edit * part(1) * colr(1));
        if (v.pg > 0.005 && this.colorUid === n.uid) {
          renderColorPage(v.cp, this.colorOf(i), true);
        } else if (v.pg > 0.005 && this.colorSt && this.colorSt.uid === n.uid) {
          renderColorPage(v.cp, this.colorSt, true);
        }
        v.cp.hue.p.g.classList.toggle('is-hover', isHueHover);
        v.cp.hue.p.g.classList.toggle('is-drag', isHueDrag);
        v.cp.sat.p.g.classList.toggle('is-hover', isSatHover);
        v.cp.sat.p.g.classList.toggle('is-drag', isSatDrag);
        v.cp.lum.p.g.classList.toggle('is-hover', isLumHover);
        v.cp.lum.p.g.classList.toggle('is-drag', isLumDrag);
        if (v.opOp >= 0.005) renderGauge(v.opParts, n.dopac, false, `OPAC // ${Math.round(n.dopac * 100)}`);
        if (v.gaugeOp >= 0.005) renderGauge(v.gaugeParts, n.dsoft, false, `SOFT // ${Math.round(n.dsoft * 100)}`);
        if (v.rotOp >= 0.005) {
          const ang = (((n.drot % TAU) + TAU) % TAU) / TAU;
          const deg = Math.round((n.rot * 180) / Math.PI) % 360;
          renderGauge(v.rotP, ang, false, `ROT // ${String(deg).padStart(3, '0')}°`);
        }
        v.opParts.g.classList.toggle('is-hover', isOpacHover);
        v.opParts.g.classList.toggle('is-drag', isOpacDrag || isOpacFlash);
        v.gaugeParts.g.classList.toggle('is-hover', isSoftHover);
        v.gaugeParts.g.classList.toggle('is-drag', isSoftDrag || isSoftFlash);
        v.rotP.g.classList.toggle('is-hover', isRotHover);
        v.rotP.g.classList.toggle('is-drag', isRotDrag || isRotFlash);
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
      if (Math.abs(v.bracket + bOff - v.lastBracket) > 0.01) {
        v.lastBracket = v.bracket + bOff;
        const d = bracketPath(v.bracket + bOff, 6);
        v.retHalo.setAttribute('d', d);
        v.retInk.setAttribute('d', d);
      }
      const op = part(0);
      v.ring.style.opacity = op < 0.005 ? '0' : op.toFixed(3);
      v.ring.setAttribute('transform', `scale(${(0.86 + 0.14 * op).toFixed(4)})`);
      v.ring.style.setProperty('--pb', part(1).toFixed(3));

      const cls0 = focusIdx === i;
      const cls =
        'node' +
        (isHover ? ' is-hover' : '') +
        (isBody ? ' is-body' : '') +
        (isDrag ? ' is-drag' : '') +
        (isRing ? ' is-ring' : '') +
        (isSoftHover ? ' is-soft-hover' : '') +
        (isSoftDrag ? ' is-soft-drag' : '') +
        (isSoftFlash ? ' is-soft-flash' : '') +
        (isRotHover ? ' is-rot-hover' : '') +
        (isRotDrag ? ' is-rot-drag' : '') +
        (isRotFlash ? ' is-rot-flash' : '') +
        (isOpacHover ? ' is-opac-hover' : '') +
        (isOpacDrag ? ' is-opac-drag' : '') +
        (isOpacFlash ? ' is-opac-flash' : '') +
        (v.pg > 0.005 ? ' is-colour' : '') +
        (cls0 ? ` is-focus focus-${focusKind}` : '') +
        (engagedIdx === i ? ' is-engaged' : '') +
        (n.shape !== 'circle' ? ' no-ring' : '') +
        (n.lock ? ' is-locked' : '') +
        (n.hide ? ' is-hidden' : '') +
        (isSel ? ' is-selected' : '') +
        (isHold ? ' is-hold' : '') +
        (s.drag.kind === 'ring' && s.drag.index === i ? ' is-ring-drag' : '');
      if (cls !== v.cls) {
        v.cls = cls;
        v.g.setAttribute('class', cls);
        v.g.dataset.lock = String(n.lock);
        v.g.dataset.hide = String(n.hide);
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
    // SOFT / ROT / OPAC read out on their own gauge chips; this floating chip is for the size ring only.
    if (s.drag.kind === 'ring') {
      chip = { text: `R ${Math.round(this.px(s.drag.index).r)}PX`, ...atRing(s.drag.index, s.arcAngle) };
    } else if (fl && fi >= 0 && fl.kind === 'r') {
      chip = { text: `R ${Math.round(this.px(fi).r)}PX`, ...atRing(fi, -Math.PI / 4) };
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
      this.chipRadius.classList.toggle('is-focus', focusIdx >= 0);
    } else {
      this.chipRadius.classList.remove('is-on', 'is-focus');
    }

    // Serial / coordinate readout near the active node.
    if (activeNode >= 0 && activeNode < s.nodes.length) {
      const n = s.nodes[activeNode];
      const text = `${nodeSerial(activeNode)} // X ${n.x.toFixed(3)} Y ${n.y.toFixed(3)}${n.lock ? ' · LOCK' : ''}${n.hide ? ' · HIDE' : ''}`;
      if (text !== this.chipNodeText) {
        this.chipNodeText = text;
        this.chipNode.textContent = text;
        this.chipNodeW = this.chipNode.offsetWidth;
      }
      const p = this.px(activeNode);
      // Clear of the gauge stack: the tag's corner sits just outside the outermost gauge's radius.
      const gr = s.tool === 'edit' ? (n.shape === 'circle' || n.shape === 'stroke' ? this.gr.soft : this.gr.rot) + 14 : 22;
      const off = Math.round(gr * 0.7071);
      const flipX = p.x + off + this.chipNodeW > m.w - 4;
      const flipY = p.y + off + 20 > m.h - 4;
      const cx = flipX ? p.x - off - this.chipNodeW : p.x + off;
      const cy = flipY ? p.y - off - 18 : p.y + off;
      this.chipNode.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
      this.chipNode.classList.add('is-on');
      // The coordinate tag steps back while a control is adjusted, but it is the live readout while the node moves.
      this.chipNode.classList.toggle('is-focus', s.drag.kind === 'node' && this.stage.classList.contains('ui-focus'));
      this.chipNode.classList.toggle('is-engaged', s.drag.kind === 'node');
    } else {
      this.chipNode.classList.remove('is-on');
    }
  }

  get pointer(): { x: number; y: number } {
    return this.lastPointer;
  }
}
