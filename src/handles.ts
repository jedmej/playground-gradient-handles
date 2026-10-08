import { emit, nodeSerial, R_MAX, R_MIN, type Store } from './store';

const NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;

export interface Metrics {
  left: number;
  top: number;
  w: number;
  h: number;
  min: number;
}

interface NodeView {
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
  readonly metrics: Metrics = { left: 0, top: 0, w: 1, h: 1, min: 1 };
  private views: NodeView[] = [];
  private arcG: SVGGElement;
  private arcHalo: SVGPathElement;
  private arcInk: SVGPathElement;
  private grid: SVGPathElement;
  private gridHalo: SVGPathElement;
  private dragOffset = { x: 0, y: 0 };
  private pointerId: number | null = null;
  private lastPointer = { x: 0, y: 0 };
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
  ) {
    this.gridHalo = el('path', { class: 'halo grid-cross' });
    this.grid = el('path', { class: 'ink grid-cross' });
    svg.append(this.gridHalo, this.grid);

    store.nodes.forEach((_, i) => {
      const g = el('g', {
        class: 'node',
        tabindex: 0,
        role: 'button',
        'data-node': i,
        'aria-label': nodeSerial(i),
      });
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
      const coreHalo = el('circle', { class: 'halo core', r: 3 });
      const coreInk = el('circle', { class: 'ink core', r: 3 });
      g.append(ring, focusHalo, focus, retHalo, retInk, coreHalo, coreInk);
      svg.appendChild(g);

      g.addEventListener('focus', () => this.onFocus(i));
      g.addEventListener('blur', () => this.onBlur(i));
      g.addEventListener('keydown', (e) => this.onKey(e, i));

      this.views.push({
        g, ring, ringHalo, ringInk, ticksHalo, ticksInk, bearings, retHalo, retInk, focus,
        bracket: 11, ringOp: 0, lastR: -1, lastBracket: -1, cls: '',
      });
    });

    this.arcG = el('g', { class: 'arc' });
    this.arcHalo = el('path', { class: 'halo arc-p' });
    this.arcInk = el('path', { class: 'ink arc-p' });
    this.arcG.append(this.arcHalo, this.arcInk);
    svg.appendChild(this.arcG);

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

    if (res.kind === 'node') {
      const p = this.px(res.index);
      this.dragOffset = { x: p.x - x, y: p.y - y };
      s.drag = { kind: 'node', index: res.index };
      s.hover = { kind: 'node', index: res.index };
      s.selected = res.index;
      s.armed = res.index;
      this.views[res.index].g.focus({ preventScroll: true });
    } else if (res.kind === 'ring') {
      s.drag = { kind: 'ring', index: res.index };
      s.hover = { kind: 'ring', index: res.index };
      s.selected = res.index;
      s.armed = res.index;
      this.aimArc(res.index, x, y);
      this.applyRadius(res.index, x, y);
    } else {
      s.selected = null;
      s.armed = null;
      s.hover = { kind: 'idle', index: -1 };
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    emit(s);
  };

  private onMove = (e: PointerEvent): void => {
    const s = this.store;
    const { x, y } = this.local(e);
    this.lastPointer = { x, y };
    this.pointerInside = true;

    if (s.drag.kind === 'node') {
      const n = s.nodes[s.drag.index];
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
    if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
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

  // ----- keyboard -----------------------------------------------------------

  private onFocus(i: number): void {
    const s = this.store;
    s.focused = i;
    s.selected = i;
    s.armed = i;
    emit(s);
  }

  private onBlur(i: number): void {
    const s = this.store;
    if (s.focused === i) s.focused = null;
    emit(s);
  }

  private onKey(e: KeyboardEvent, i: number): void {
    const s = this.store;
    const n = s.nodes[i];
    const m = this.metrics;
    const step = e.shiftKey ? 10 : 1;
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
      const bracketTarget = isDrag ? 9 : isRing ? 14 : isHover ? 13 : isSel || isFocus ? 14 : 11;
      v.bracket = approach(v.bracket, bracketTarget, 30, dt, snap);
      v.ringOp = approach(v.ringOp, this.revealed(i) ? 1 : 0, 22, dt, snap);

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
      const idx = arcNode >= 0 ? arcNode : (s.selected ?? 0);
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
    if (activeNode >= 0) {
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
