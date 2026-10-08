import type { Actions } from './actions';
import type { History } from './history';
import { emit, MIN_NODES, nodeSerial, R_MAX, R_MIN, type NodeState, type Store } from './store';

const NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;

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

/** Touch long-press → remove node. */
const HOLD_MS = 550;
const HOLD_SLOP = 6;
/** Double-tap window for adding a node (touch is more forgiving than a mouse double-click). */
const TAP_MS = 380;
const TAP_SLOP = 36;
const CLICK_MS = 320;
const CLICK_SLOP = 24;
const HOLD_R = 19;
const HOLD_C = TAU * HOLD_R;

interface NodeView {
  uid: number;
  g: SVGGElement;
  ring: SVGGElement;
  ringHalo: SVGCircleElement;
  ringInk: SVGCircleElement;
  ticksHalo: SVGPathElement;
  ticksInk: SVGPathElement;
  bearings: SVGTextElement[];
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
  private lastTap: { t: number; x: number; y: number } | null = null;
  /** True while a pointer is over (or captured by) the stage. */
  pointerInside = false;
  private chipNodeText = '';
  private chipNodeW = 0;
  private chipRadiusText = '';
  private chipRadiusW = 0;

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

    this.syncViews();
    store.listeners.add(() => this.syncViews());

    // Focus ring only after keyboard interaction, never after a pointer grab that moved focus.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === '[' || e.key === ']') svg.classList.add('kb');
    });
    window.addEventListener('pointerdown', () => svg.classList.remove('kb'), { capture: true });

    stage.addEventListener('pointerdown', this.onDown);
    stage.addEventListener('pointermove', this.onMove);
    stage.addEventListener('pointerup', this.onUp);
    stage.addEventListener('pointercancel', this.onUp);
    stage.addEventListener('pointerleave', this.onLeave);
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
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

    const focusHalo = el('rect', { class: 'halo focus-rect', x: -21, y: -21, width: 42, height: 42 });
    const focus = el('rect', { class: 'ink focus-rect', x: -21, y: -21, width: 42, height: 42 });
    const retHalo = el('path', { class: 'halo ret' });
    const retInk = el('path', { class: 'ink ret' });
    const holdAttrs = { r: HOLD_R, visibility: 'hidden', transform: 'rotate(-90)', 'stroke-dasharray': `0 ${HOLD_C}` };
    const holdHalo = el('circle', { class: 'halo hold-arc', ...holdAttrs });
    const holdInk = el('circle', { class: 'ink hold-arc', ...holdAttrs });
    const coreHalo = el('circle', { class: 'halo core', r: 3 });
    const coreInk = el('circle', { class: 'ink core', r: 3 });
    g.append(ring, focusHalo, focus, holdHalo, holdInk, retHalo, retInk, coreHalo, coreInk);

    const view: NodeView = {
      uid: n.uid, g, ring, ringHalo, ringInk, ticksHalo, ticksInk, bearings, retHalo, retInk, focus,
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
    byUid.forEach((v) => v.g.remove());
    // Keep DOM order == array order (Tab order). Walk backwards so each view lands before its successor.
    let ref: Node = this.arcG;
    for (let i = next.length - 1; i >= 0; i--) {
      const g = next[i].g;
      if (g.nextSibling !== ref) this.svg.insertBefore(g, ref);
      ref = g;
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

  private revealed(i: number): boolean {
    const s = this.store;
    return (
      s.armed === i ||
      s.selected === i ||
      s.focused === i ||
      (s.hover.kind !== 'idle' && s.hover.index === i) ||
      (s.drag.kind !== 'none' && s.drag.index === i)
    );
  }

  /** Grab-zone priority: node core → revealed ring band → nothing. Nearest wins. */
  private pick(x: number, y: number): { kind: 'node' | 'ring' | 'none'; index: number } {
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
    return { kind: 'none', index: -1 };
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
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const s = this.store;
    if (s.drag.kind !== 'none') return;
    if (e.pointerType === 'touch') s.coarse = true;
    this.updateMetrics();
    const { x, y } = this.local(e);
    this.lastPointer = { x, y };
    const res = this.pick(x, y);
    this.pointerId = e.pointerId;
    this.stage.setPointerCapture(e.pointerId);
    e.preventDefault();

    const wasSelected = s.selected;
    if (res.kind === 'node') {
      const p = this.px(res.index);
      this.dragOffset = { x: p.x - x, y: p.y - y };
      this.history.begin();
      s.drag = { kind: 'node', index: res.index };
      s.hover = { kind: 'node', index: res.index };
      s.selected = res.index;
      s.armed = res.index;
      this.views[res.index].g.focus({ preventScroll: true });
      this.lastTap = null;
      // Touch: first tap selects; pressing and holding an already-selected core removes it.
      if (e.pointerType === 'touch' && wasSelected === res.index) {
        this.hold = { start: performance.now(), x, y, uid: s.nodes[res.index].uid };
      }
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
    this.lastPointer = { x, y };
    this.pointerInside = true;

    if (this.hold && Math.hypot(x - this.hold.x, y - this.hold.y) > HOLD_SLOP) this.hold = null;

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
    if (e.pointerType === 'touch') return;
    this.hoverAt(x, y);
  };

  private hoverAt(x: number, y: number): void {
    const s = this.store;
    const res = this.pick(x, y);
    const prev = s.hover;
    if (res.kind === 'node') {
      s.hover = { kind: 'node', index: res.index };
      s.armed = res.index;
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
    if (this.pointerId !== e.pointerId) return;
    this.pointerId = null;
    this.hold = null;
    if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
    if (s.drag.kind !== 'none' && s.drag.index < s.nodes.length) {
      const label = `${s.drag.kind === 'ring' ? 'RADIUS' : 'MOVE'} ${nodeSerial(s.drag.index)}`;
      this.history.commit(label);
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
    if (s.drag.kind !== 'none') return;
    this.pointerInside = false;
    s.hover = { kind: 'idle', index: -1 };
    if (s.armed !== s.selected && s.armed !== s.focused) s.armed = null;
    emit(s);
  };

  /** Long-press completed: remove the held node (at MIN_NODES it only reports the limit; the drag carries on). */
  private fireHold(): void {
    const s = this.store;
    const h = this.hold;
    this.hold = null;
    if (!h) return;
    const i = s.nodes.findIndex((n) => n.uid === h.uid);
    if (i < 0) return;
    if (s.nodes.length <= MIN_NODES) {
      s.say(`MIN ${MIN_NODES} NODES`);
      return;
    }
    if (this.pointerId !== null && this.stage.hasPointerCapture(this.pointerId)) {
      this.stage.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    this.pointerInside = false;
    // The gesture's opening snapshot becomes the "remove" undo step.
    s.drag = { kind: 'none', index: -1 };
    this.actions.removeAt(i);
  }

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
    const mutating = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '[', ']'].includes(e.key);
    if (mutating) this.actions.nudge(i);
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': n.x = Math.max(0, n.x - step / m.w); break;
      case 'ArrowRight': n.x = Math.min(1, n.x + step / m.w); break;
      case 'ArrowUp': n.y = Math.max(0, n.y - step / m.h); break;
      case 'ArrowDown': n.y = Math.min(1, n.y + step / m.h); break;
      case '[': n.r = Math.max(R_MIN, n.r - (step * 4) / m.min); break;
      case ']': n.r = Math.min(R_MAX, n.r + (step * 4) / m.min); break;
      case 'Escape': (e.currentTarget as SVGGElement).blur(); s.selected = null; break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      emit(s);
    }
  }

  // ----- per-frame ----------------------------------------------------------

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

      const isHover = s.hover.kind === 'node' && s.hover.index === i;
      const isDrag = s.drag.kind === 'node' && s.drag.index === i;
      const isRing = engagedRing === i;
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
        (isDrag ? ' is-drag' : '') +
        (isRing ? ' is-ring' : '') +
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

    // Radius readout rides the arc while dragging.
    if (s.drag.kind === 'ring') {
      const p = this.px(s.drag.index);
      const text = `R ${Math.round(p.r)}PX`;
      if (text !== this.chipRadiusText) {
        this.chipRadiusText = text;
        this.chipRadius.textContent = text;
        this.chipRadiusW = this.chipRadius.offsetWidth;
      }
      const rr = p.r + 28;
      let cx = p.x + Math.cos(s.arcAngle) * rr;
      let cy = p.y + Math.sin(s.arcAngle) * rr;
      const hw = this.chipRadiusW / 2 + 4;
      cx = Math.min(m.w - hw, Math.max(hw, cx));
      cy = Math.min(m.h - 14, Math.max(14, cy));
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
