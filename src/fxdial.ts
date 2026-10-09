import { wheelUp } from './wheel';
import type { Actions } from './actions';
import { FX_IDS, fxMaxPos, fxPos, fxSpoken, type FxId } from './fx';
import { bracketPath, ticksPath } from './handles';
import { gaugeHit, gaugeSpacing, layoutGauge, makeGauge, renderGauge, stackGap, sweepT, type GaugeParts } from './gauge';
import type { Metrics } from './handles';
import type { History } from './history';
import { emit, type Store } from './store';

const NS = 'http://www.w3.org/2000/svg';
const NAMES = Object.fromEntries(FX_IDS.map((id) => [id, id.toUpperCase()])) as Record<FxId, string>;
/** Wheel events right after a summon belong to the summoning gesture (trackpad inertia): they must not step a ring. */
const SETTLE_MS = 350;
/** Pointer this far (px) outside the outer ring, and idle this long, dismisses the dial. */
const AWAY_PX = 70;
/** A click opens the dial after this delay, so a double-click (add node) can cancel it. */
const OPEN_DELAY = 240;
const CLICK_MS = 320;
const CLICK_SLOP = 24;
const IDLE_MS = 1500;

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
};

interface RingView extends GaugeParts {
  id: FxId;
  key: string;
  /** REMOVE chip: a small FLARE square with an X, just right of the ring's label chip. */
  x: SVGGElement;
  /** Its centre's x offset from the dial centre (the y is the ring's radius). */
  xOff: number;
}

/** Side of the REMOVE square and the ADD chip, in px (the label chips are 14 tall). */
const BTN = 12;
const ADD = 14;

/**
 * Global FX dial: one concentric 270° gauge per enabled effect (SOFT-gauge language), summoned over the stage.
 * Every enabled effect gets a ring on the one dial; past five rings the spacing tightens so the stack still fits the stage.
 * It owns its pointer / wheel / key gestures in the capture phase while open, so nodes never see them.
 */
export class FxDial {
  private svg = el('svg', { class: 'fxdial', 'aria-label': 'FX dial', role: 'group' });
  private root = el('g');
  private views: RingView[] = [];
  private empty = el('g', { class: 'fxempty' });
  private emptyText = el('text', { 'text-anchor': 'middle' });
  private emptyBg!: SVGRectElement;
  private shown = new Set<FxId>();
  /** ADD chip under the outermost label; opens the effect menu (the node menu's plate). */
  private add = el('g', { class: 'fx-add' });
  private addY = 0;
  private menu: HTMLDivElement;
  private menuHead: HTMLDivElement;
  /** Pointer over a REMOVE square (its effect) or the ADD chip. */
  private btnHover: FxId | 'add' | null = null;
  /** The ring last stepped from the keyboard: kept (even at 0) until focus leaves it. */
  private keyed: FxId | null = null;
  open = false;
  private cx = 0;
  private cy = 0;
  private want = { x: 0, y: 0 };
  private sp = 24;
  private outer = 0;
  private extent = { x: 0, y: 0 };
  private hover: FxId | null = null;
  private drag: { id: FxId; pid: number; t: number } | null = null;
  private swallow = -1;
  private wheelAcc = 0;
  private wheelId: FxId | null = null;
  /** Ring being wheeled (until the burst settles). */
  private wheelActive: FxId | null = null;
  private openedAt = 0;
  private lastActive = 0;
  private ptr = { x: 0, y: 0, in: false, touch: false };
  private lastKey = '';
  private lastBox = '';
  private bezel = el('g', { class: 'fxbezel' });
  private bezH = el('circle', { class: 'halo ring-c' });
  private bezI = el('circle', { class: 'ink ring-c' });
  private bezTicksH = el('path', { class: 'halo ticks' });
  private bezTicksI = el('path', { class: 'ink ticks' });
  private bearings = ['000', '090', '180', '270'].map((t) => {
    const b = el('text', { class: 'bearing', 'text-anchor': 'middle' });
    b.textContent = t;
    return b;
  });
  private ret = el('g', { class: 'fxret' });
  private retH = el('path', { class: 'halo' });
  private retI = el('path', { class: 'ink' });
  private coreH = el('circle', { class: 'halo core', r: 3 });
  private coreI = el('circle', { class: 'ink core', r: 2 });
  /** Click-to-open: the press that may become a click, the last click (for double-click) and the pending open. */
  private cand: { pid: number; x: number; y: number; t: number } | null = null;
  private lastClick: { t: number; x: number; y: number } | null = null;
  private openTimer = 0;
  private hideTimer = 0;
  private offs: Array<() => void> = [];
  /** Open/close progress 0…1 (260 ms in, 200 ms out); every part takes a staggered share, so closing is the reverse. */
  private prog = 0;
  private tPrev = 0;

  constructor(
    private store: Store,
    private actions: Actions,
    private history: History,
    private stage: HTMLElement,
    private metrics: Metrics,
    private emptyAt: (x: number, y: number) => boolean,
    private busy: () => boolean,
  ) {
    this.svg.style.display = 'none';
    this.bezel.append(this.bezH, this.bezI, this.bezTicksH, this.bezTicksI, ...this.bearings);
    this.root.appendChild(this.bezel);
    for (const id of FX_IDS) this.views.push(this.makeView(id));
    // Empty state: the bezel alone plus a callout chip.
    this.emptyBg = el('rect', { class: 'tag-bg', height: 14, y: -7 });
    this.emptyText.setAttribute('class', 'tag-text');
    this.emptyText.setAttribute('y', '3');
    this.emptyText.textContent = 'FX // ALL OFF · CHECK AN EFFECT';
    this.empty.append(this.emptyBg, this.emptyText);
    this.root.appendChild(this.empty);
    this.add.append(
      el('rect', { class: 'tag-bg', width: ADD, height: ADD, x: -ADD / 2, y: -ADD / 2 }),
      el('path', { class: 'add-glyph', d: 'M-3.5 0H3.5M0 -3.5V3.5' }),
    );
    this.root.appendChild(this.add);
    this.menu = document.createElement('div');
    this.menu.className = 'node-menu fx-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'Add an effect');
    this.menu.dataset.testid = 'fx-menu';
    this.menu.hidden = true;
    this.menuHead = document.createElement('div');
    this.menuHead.className = 'menu-head';
    this.menuHead.setAttribute('role', 'presentation');
    this.menuHead.textContent = 'FX // ADD';
    this.menu.appendChild(this.menuHead);
    for (const id of FX_IDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.setAttribute('role', 'menuitem');
      b.dataset.fxAdd = id;
      b.innerHTML = `<span class="mi-l">${NAMES[id]}</span><kbd>+</kbd>`;
      b.addEventListener('click', () => this.addFx(id));
      this.menu.appendChild(b);
    }
    this.menu.addEventListener('keydown', (e) => this.onMenuKey(e));
    this.menu.addEventListener('contextmenu', (e) => e.preventDefault());
    this.ret.append(this.retH, this.retI, this.coreH, this.coreI);
    this.root.appendChild(this.ret);
    this.svg.appendChild(this.root);
    stage.appendChild(this.svg);
    stage.appendChild(this.menu);

    const w = window;
    w.addEventListener('pointerdown', this.onDown, { capture: true });
    w.addEventListener('pointermove', this.onMove, { capture: true });
    w.addEventListener('pointerup', this.onUp, { capture: true });
    w.addEventListener('pointercancel', this.onUp, { capture: true });
    w.addEventListener('wheel', this.onWheelCapture, { capture: true, passive: false });
    w.addEventListener('keydown', this.onKeyCapture, { capture: true });
    // Summon: registered after the handles' own wheel listener, which claims ⌥+wheel over a node (SOFT).
    stage.addEventListener('wheel', this.onSummon, { passive: false });
    const toggle = (): void => (this.open ? this.close() : this.openAtCursor());
    document.querySelectorAll<HTMLElement>('[data-action="fx-dial"]').forEach((b) => {
      b.addEventListener('click', toggle);
      this.offs.push(() => b.removeEventListener('click', toggle));
    });
    const sync = (): void => this.sync();
    actions.fxListeners.add(sync);
    store.listeners.add(sync);
    this.offs.push(() => (actions.fxListeners.delete(sync), store.listeners.delete(sync)));
  }

  // ----- construction ------------------------------------------------------------------

  private makeView(id: FxId): RingView {
    const gp = makeGauge('fxring', NAMES[id], BTN + 2); // keep the × square clear too
    const g = gp.g;
    g.setAttribute('data-fx-ring', id);
    g.setAttribute('role', 'slider');
    g.setAttribute('tabindex', '0');
    g.setAttribute('aria-label', `${NAMES[id]} ring`);
    g.setAttribute('aria-valuemin', '0');
    g.setAttribute('aria-valuemax', id === 'dither' ? '16' : '100');
    g.setAttribute('aria-valuenow', '0');
    g.setAttribute('aria-orientation', 'horizontal');
    g.style.display = 'none';
    g.style.setProperty('--i', String(this.views.length));
    const x = el('g', { class: 'fx-x' });
    x.append(
      el('rect', { width: BTN, height: BTN, x: -BTN / 2, y: -BTN / 2 }),
      el('path', { d: 'M-2.75 -2.75L2.75 2.75M2.75 -2.75L-2.75 2.75' }),
    );
    gp.tag.appendChild(x);
    const v: RingView = Object.assign(gp, { id, key: '', x, xOff: 0 });
    g.addEventListener('keydown', (e) => this.onRingKey(e, id));
    g.addEventListener('blur', () => {
      if (this.keyed !== id) return;
      this.keyed = null; // a ring keyed to 0 goes once focus leaves it
      this.sync();
    });
    this.root.appendChild(g);
    return v;
  }

  // ----- open / close ------------------------------------------------------------------

  /** Open centred on a stage point (null = stage centre). */
  openAt(x: number | null, y: number | null, focus = false): void {
    const s = this.store;
    if (s.drawing || s.drag.kind !== 'none') return;
    this.metrics.left = this.stage.getBoundingClientRect().left;
    this.want = { x: x ?? this.metrics.w / 2, y: y ?? this.metrics.h / 2 };
    const was = this.open;
    this.open = true;
    if (!was) this.shown = new Set(FX_IDS.filter((id) => s.fx[id] > 0));
    this.openedAt = this.lastActive = performance.now();
    this.svg.style.display = '';
    this.svg.classList.add('is-open');
    this.tPrev = performance.now();
    this.stage.classList.add('fx-open');
    if (!was) {
      s.hover = { kind: 'idle', index: -1 };
      s.armed = s.selected ?? s.focused;
      emit(s);
      s.say('FX DIAL · DRAG OR SCROLL A RING · ESC CLOSES');
    }
    this.lastKey = '';
    this.sync(true);
    this.animate(); // apply the current progress before the first paint (no full-strength flash)
    if (focus) {
      const first = this.views.find((v) => this.shown.has(v.id));
      first?.g.focus({ preventScroll: true });
    }
  }

  /** Remove the dial and every listener (HMR dispose). */
  destroy(): void {
    this.close();
    const w = window;
    w.removeEventListener('pointerdown', this.onDown, { capture: true });
    w.removeEventListener('pointermove', this.onMove, { capture: true });
    w.removeEventListener('pointerup', this.onUp, { capture: true });
    w.removeEventListener('pointercancel', this.onUp, { capture: true });
    w.removeEventListener('wheel', this.onWheelCapture, { capture: true });
    w.removeEventListener('keydown', this.onKeyCapture, { capture: true });
    this.stage.removeEventListener('wheel', this.onSummon);
    this.offs.forEach((f) => f());
    this.svg.remove();
  }

  /** F / the foot button: at the cursor while it is over the stage, else the stage centre. */
  private openAtCursor(): void {
    const p = this.ptr;
    if (p.in && !p.touch) this.openAt(p.x, p.y, true);
    else this.openAt(null, null, true);
  }

  /** Wheel burst: the system cursor steps aside (like the node ring) until the next move or a short idle. */
  private hideCursor(): void {
    this.stage.classList.add('fx-hide');
    this.focusUi(true);
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.stage.classList.remove('fx-hide');
      this.wheelActive = null;
      this.sync();
      if (!this.drag) this.focusUi(false);
    }, 700);
  }

  /** The rest of the artboard UI dims to 20 % while this dial is being adjusted (see `.ui-focus` in styles.css). */
  private focusUi(on: boolean): void {
    this.stage.classList.toggle('ui-focus', on);
    this.stage.classList.toggle('fx-focus', on);
    this.svg.classList.toggle('is-focus', on);
  }

  close(): void {
    window.clearTimeout(this.openTimer);
    window.clearTimeout(this.hideTimer);
    if (!this.open) return;
    if (this.drag) {
      this.history.commit(`FX ${NAMES[this.drag.id]}`);
      this.drag = null;
    }
    this.open = false;
    this.hover = null;
    this.btnHover = null;
    this.closeMenu();
    // Logically closed at once (not grabbable); the svg plays the open sequence backwards, then hides in frame().
    this.svg.classList.remove('is-open');
    this.tPrev = performance.now();
    if (this.store.reducedMotion || this.prog <= 0) {
      this.prog = 0;
      this.svg.style.display = 'none';
    }
    this.stage.classList.remove('fx-open', 'fx-ring', 'fx-grab', 'fx-hide');
    this.wheelActive = null;
    this.focusUi(false);
    const a = document.activeElement as HTMLElement | null;
    if (a && this.svg.contains(a)) a.blur();
  }

  // ----- layout and render ---------------------------------------------------------------

  private layout(): void {
    const m = this.metrics;
    const ids = FX_IDS.filter((id) => this.shown.has(id));
    const n = ids.length;
    // Up to five rings use the node gauges' spacing (so adding one never rescales the others). Past five the stack may use
    // the stage's whole short side and tightens just enough for all of them plus the bezel: outer bezel ≈ (n + 1.55)·sp + 3.
    let { sp } = gaugeSpacing(m.w, m.h);
    if (n > 5) sp = Math.min(sp, Math.max(9, (Math.max(40, Math.min(m.w, m.h) / 2 - 4) - 14) / (n + 1.6)));
    this.sp = sp;
    ids.forEach((id, i) => (this.views.find((v) => v.id === id)!.r = 1.5 * sp + i * sp));
    this.outer = n ? 1.5 * sp + (n - 1) * sp + sp / 2 : 1.9 * sp;
    const bz = n ? this.outer + 0.55 * sp + 3 : 2.4 * sp;
    this.extent = n
      ? { x: bz + 14, y: bz + 14 }
      : { x: Math.min(m.w / 2 - 4, Math.max(bz + 14, 108)), y: bz + 50 };
    const ex = Math.min(this.extent.x + 2, m.w / 2);
    const ey = Math.min(this.extent.y + 2, m.h / 2);
    this.cx = Math.min(m.w - ex, Math.max(ex, this.want.x));
    this.cy = Math.min(m.h - ey, Math.max(ey, this.want.y));
    this.svg.setAttribute('width', String(m.w));
    this.svg.setAttribute('height', String(m.h));
    this.root.setAttribute('transform', `translate(${this.cx.toFixed(1)} ${this.cy.toFixed(1)})`);
    this.empty.style.display = n ? 'none' : '';
    // Outer bezel: dashed ring, ticks outside it, bearings just inside (like a node).
    for (const c of [this.bezH, this.bezI]) c.setAttribute('r', bz.toFixed(1));
    const tk = ticksPath(bz);
    this.bezTicksH.setAttribute('d', tk);
    this.bezTicksI.setAttribute('d', tk);
    const q = sp >= 14;
    const bpos: Array<[number, number]> = [[0, -bz + 9], [bz - 10, 3], [0, bz - 3], [-bz + 10, 3]];
    this.bearings.forEach((t, k) => {
      t.setAttribute('x', bpos[k][0].toFixed(1));
      t.setAttribute('y', bpos[k][1].toFixed(1));
      t.setAttribute('visibility', q && !(k === 2 && n) ? 'visible' : 'hidden'); // 180 gives way to the ADD chip
    });
    // Centre reticle at the click point.
    const o = Math.max(5, Math.min(11, 1.5 * sp - sp / 2 - 3));
    const rd = bracketPath(o, Math.min(6, o * 0.55));
    this.retH.setAttribute('d', rd);
    this.retI.setAttribute('d', rd);
    this.svg.style.setProperty('--ret-o', `${o}px`);
    const fs = Math.max(7.5, Math.min(9.5, sp * 0.36));
    this.svg.style.setProperty('--fx-fs', `${fs}px`);
    this.setTag(this.emptyBg, this.emptyText, 'FX // ALL OFF · ADD AN EFFECT', bz + 22);
    // ADD sits one spacing below the outermost label chip (or under the empty-state chip), hidden once all twelve are on.
    this.addY = n ? 1.5 * sp + n * sp : bz + 40;
    this.add.setAttribute('transform', `translate(0 ${this.addY.toFixed(1)})`);
    this.add.style.display = n < FX_IDS.length ? '' : 'none';
    if (n >= FX_IDS.length) this.closeMenu();
    // One bottom gap for the whole stack, sized by the ring that needs the most room, so every ring ends on one bearing.
    const half = stackGap(this.views.filter((v) => this.shown.has(v.id)).map((v) => [v, v.r] as [GaugeParts, number]), sp);
    for (const v of this.views) {
      const on = this.shown.has(v.id);
      v.g.style.display = on ? '' : 'none';
      if (!on) continue;
      layoutGauge(v, v.r, sp, half);
      v.key = '';
    }
  }

  /** Black mono chip, sized to its text (Martian Mono ≈ 0.62 em per glyph + tracking). */
  private setTag(bg: SVGRectElement, text: SVGTextElement, label: string, y: number | null): number {
    text.textContent = label;
    const fs = parseFloat(this.svg.style.getPropertyValue('--fx-fs')) || 9;
    const w = Math.ceil(label.length * (fs * 0.62 + fs * 0.06) + 10);
    bg.setAttribute('width', String(w));
    bg.setAttribute('x', String(-w / 2));
    if (y !== null) {
      bg.setAttribute('transform', `translate(0 ${y})`);
      text.setAttribute('transform', `translate(0 ${y})`);
    }
    return w;
  }

  private text(id: FxId): string {
    const v = this.store.fx[id];
    return `${NAMES[id]} // ${v <= 0 ? (id === 'warp' ? 'STD' : 'OFF') : id === 'dither' ? `${v} LV` : v}`;
  }

  /**
   * Mirror the store: one ring per effect that is on, refresh values. A ring taken to 0 stays only while it is still in
   * hand (dragged, wheeled or keyboard-focused), so it never vanishes under the pointer; it goes on release.
   */
  private sync(force = false): void {
    if (!this.open) return;
    const fx = this.store.fx;
    const held = (id: FxId): boolean => id === this.drag?.id || id === this.wheelActive || id === this.keyed;
    const next = new Set(FX_IDS.filter((id) => fx[id] > 0 || (this.shown.has(id) && held(id))));
    const changed = next.size !== this.shown.size || [...next].some((id) => !this.shown.has(id));
    this.shown = next;
    const box = `${this.metrics.w}x${this.metrics.h}`;
    if (changed || force || box !== this.lastBox) {
      this.lastBox = box;
      this.layout();
    }
    const key = JSON.stringify(fx) + this.hover + (this.drag?.id ?? '') + (this.wheelActive ?? '');
    if (key === this.lastKey && !force) return;
    this.lastKey = key;
    for (const v of this.views) {
      if (!this.shown.has(v.id)) continue;
      const max = fxMaxPos(v.id);
      const t = fxPos(v.id, fx[v.id]) / max;
      const off = fx[v.id] <= 0;
      renderGauge(v, t, off, this.text(v.id));
      const w = Number(v.tagBg.getAttribute('width')) || 0;
      v.xOff = w / 2 + 2 + BTN / 2;
      v.x.setAttribute('transform', `translate(${v.xOff.toFixed(1)} 0)`);
      v.x.classList.toggle('is-hover', this.btnHover === v.id);
      v.g.setAttribute('aria-valuenow', String(fx[v.id]));
      v.g.setAttribute('aria-valuetext', fxSpoken(v.id, fx));
      v.g.classList.toggle('is-hover', this.hover === v.id);
      v.g.classList.toggle('is-drag', this.drag?.id === v.id);
      v.g.classList.toggle('is-active', (this.drag?.id ?? this.wheelActive) === v.id);
    }
    this.svg.classList.toggle('has-hover', this.hover !== null);
    this.add.classList.toggle('is-hover', this.btnHover === 'add' || !this.menu.hidden);
  }

  private animate(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.tPrev) / 1000);
    this.tPrev = now;
    const want = this.open ? 1 : 0;
    if (this.prog === want) return;
    const rm = this.store.reducedMotion;
    this.prog = rm ? want : Math.min(1, Math.max(0, this.prog + (want ? dt / 0.26 : -dt / 0.2)));
    const P = this.prog;
    const part = (k: number): number => {
      const t = Math.min(1, Math.max(0, (P - 0.1 * k) / 0.5));
      return 1 - (1 - t) * (1 - t) * (1 - t);
    };
    const b = part(0);
    this.bezel.style.opacity = b.toFixed(3);
    this.bezel.style.transform = `scale(${(0.9 + 0.1 * b).toFixed(4)})`;
    this.empty.style.opacity = b.toFixed(3);
    this.add.style.opacity = b.toFixed(3);
    this.ret.style.opacity = b.toFixed(3);
    this.ret.style.transform = `scale(${(1 + (1 - b)).toFixed(4)})`;
    let k = 1;
    for (const v of this.views) {
      if (!this.shown.has(v.id)) continue;
      const a = part(k++);
      v.g.style.setProperty('--pa', a.toFixed(3));
      v.g.style.transform = `scale(${(0.7 + 0.3 * a).toFixed(4)})`;
    }
    if (P <= 0 && !this.open) this.svg.style.display = 'none';
  }

  /** Per-frame: follow stage resizes, and the idle auto-dismiss. */
  frame(): void {
    this.animate();
    if (!this.open) {
      // Safety net: a closed dial never leaves the cursor hidden.
      if (this.stage.classList.contains('fx-hide')) this.stage.classList.remove('fx-hide');
      return;
    }
    const box = `${this.metrics.w}x${this.metrics.h}`;
    if (box !== this.lastBox) this.sync(true);
    const focused = this.svg.contains(document.activeElement) && (document.activeElement as HTMLElement).matches(':focus-visible');
    if (this.drag || focused || !this.menu.hidden || !this.ptr.in || this.ptr.touch) return;
    const dist = Math.hypot(this.ptr.x - this.cx, this.ptr.y - this.cy);
    if (dist > Math.max(this.extent.x, this.extent.y) + AWAY_PX && performance.now() - this.lastActive > IDLE_MS) this.close();
  }

  // ----- hit testing and value mapping ----------------------------------------------------

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.stage.getBoundingClientRect();
    this.metrics.left = r.left;
    this.metrics.top = r.top;
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Radial band hit test: the ring whose centre line is within half a spacing of the pointer. */
  private ringAt(x: number, y: number): FxId | null {
    let best: FxId | null = null;
    let bd = Infinity;
    for (const v of this.views) {
      if (!this.shown.has(v.id)) continue;
      const e = gaugeHit(v.r, x - this.cx, y - this.cy, this.sp);
      if (e !== null && e < bd) (bd = e, (best = v.id));
    }
    return best;
  }

  /** REMOVE square or ADD chip under the pointer (checked before the rings: both sit inside a ring's band). */
  private btnAt(x: number, y: number): FxId | 'add' | null {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const pad = this.ptr.touch ? 6 : 2;
    if (this.add.style.display !== 'none' && Math.abs(dx) <= ADD / 2 + pad && Math.abs(dy - this.addY) <= ADD / 2 + pad) return 'add';
    for (const v of this.views) {
      if (!this.shown.has(v.id) || this.store.fx[v.id] <= 0) continue;
      if (Math.abs(dx - v.xOff) <= BTN / 2 + pad && Math.abs(dy - v.r) <= BTN / 2 + pad) return v.id;
    }
    return null;
  }

  private setBtnHover(b: FxId | 'add' | null): void {
    if (b === this.btnHover) return;
    this.btnHover = b;
    this.stage.classList.toggle('fx-btn', b !== null);
    this.sync(true);
  }

  // ----- ADD menu ------------------------------------------------------------------------

  /** The node menu's plate, listing the effects that are off; one press turns one on (as its panel checkbox would). */
  private openMenu(viaKey = false): void {
    let first: HTMLButtonElement | null = null;
    for (const b of this.menu.querySelectorAll<HTMLButtonElement>('[data-fx-add]')) {
      const on = this.store.fx[b.dataset.fxAdd as FxId] > 0;
      b.hidden = on;
      if (!on && !first) first = b;
    }
    if (!first) return;
    this.menu.classList.toggle('is-kb', viaKey);
    this.menu.hidden = false;
    const m = this.metrics;
    const mw = this.menu.offsetWidth;
    const mh = this.menu.offsetHeight;
    // Like a right-click: from the ADD chip's right edge, down (flipping left / up when it would leave the stage).
    const ax = this.cx + ADD / 2 + 4;
    const ay = this.cy + this.addY - ADD / 2;
    let left = ax;
    let top = ay;
    if (left + mw > m.w - 4) left = this.cx - ADD / 2 - 4 - mw;
    if (top + mh > m.h - 4) top = this.cy + this.addY + ADD / 2 - mh;
    left = Math.max(4, Math.min(left, m.w - mw - 4));
    top = Math.max(4, Math.min(top, m.h - mh - 4));
    this.menu.style.left = `${Math.round(left)}px`;
    this.menu.style.top = `${Math.round(top)}px`;
    if (viaKey) first.focus({ preventScroll: true });
    this.lastActive = performance.now();
    this.sync(true);
  }

  private closeMenu(): void {
    if (this.menu.hidden) return;
    const had = this.menu.contains(document.activeElement);
    this.menu.hidden = true;
    this.menu.classList.remove('is-kb');
    if (had) (document.activeElement as HTMLElement).blur();
    this.sync(true);
  }

  private addFx(id: FxId): void {
    const viaKey = this.menu.classList.contains('is-kb');
    this.closeMenu();
    if (this.store.fx[id] <= 0) this.actions.fxToggle(id);
    this.lastActive = performance.now();
    if (viaKey) this.views.find((v) => v.id === id)?.g.focus({ preventScroll: true });
  }

  private removeFx(id: FxId): void {
    if (this.store.fx[id] > 0) this.actions.fxToggle(id);
    if (this.keyed === id) this.keyed = null;
    this.btnHover = null;
    this.stage.classList.remove('fx-btn');
    this.lastActive = performance.now();
    this.sync(true);
  }

  private onMenuKey(e: KeyboardEvent): void {
    const items = [...this.menu.querySelectorAll<HTMLButtonElement>('[data-fx-add]')].filter((b) => !b.hidden);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    let to = -1;
    if (e.key === 'ArrowDown') to = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') to = (at - 1 + items.length) % items.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = items.length - 1;
    else if (e.key === 'Tab') {
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    this.menu.classList.add('is-kb');
    items[to]?.focus({ preventScroll: true });
  }

  /** Angle round the dial → 0…1 along that ring's sweep; the gap snaps to the nearer end, never wraps mid-drag. */
  private angleT(id: FxId, x: number, y: number, prev: number): number {
    const v = this.views.find((w) => w.id === id)!;
    return sweepT(v.sw, x - this.cx, y - this.cy, prev);
  }

  private setFromPointer(x: number, y: number): void {
    const d = this.drag!;
    d.t = this.angleT(d.id, x, y, d.t);
    this.actions.fxSetPos(d.id, Math.round(d.t * fxMaxPos(d.id)));
  }

  private setHover(id: FxId | null): void {
    if (id === this.hover) return;
    this.hover = id;
    this.stage.classList.toggle('fx-ring', id !== null);
    this.sync();
  }

  /** On the artboard itself: inside the stage but not on a panel floating over it (`[data-stage-ui]`: the RANDOM / VARY
   * strip, the node and artboard menus), whose presses, moves and wheel belong to that panel alone. */
  private inStage(e: Event): boolean {
    const t = e.target;
    if (!(t instanceof Node) || !this.stage.contains(t)) return false;
    return !(t instanceof Element && t.closest('[data-stage-ui]'));
  }

  // ----- gestures (capture phase) -------------------------------------------------------------

  private onDown = (e: PointerEvent): void => {
    if (this.open && e.target instanceof Node && this.menu.contains(e.target)) {
      e.stopPropagation(); // a press on the ADD menu is the menu's own (its click adds); the board never sees it
      this.lastActive = performance.now();
      return;
    }
    if (!this.inStage(e)) return; // the panel keeps working (and live-updating the dial) while it is open
    const touch = e.pointerType === 'touch';
    const primary = e.isPrimary && (touch || e.button === 0);
    const { x, y } = this.local(e);
    const now = performance.now();
    window.clearTimeout(this.openTimer); // any new press cancels a pending open (double-click = add node)
    if (this.cand && this.cand.pid !== e.pointerId) this.cand = null; // a second finger ends a tap
    const lc = this.lastClick;
    const dbl = !!lc && now - lc.t < (touch ? 380 : CLICK_MS) && Math.hypot(x - lc.x, y - lc.y) < (touch ? 36 : CLICK_SLOP);
    if (dbl) this.lastClick = null;
    if (!this.open) {
      this.cand = null;
      if (!dbl && primary && this.emptyAt(x, y)) {
        // Decided now, before the board's own press handler deselects: with something active this click only clears
        // it (and is remembered, so a quick second click still reads as a double-click); the next one opens the dial.
        if (this.busy()) this.lastClick = { t: now, x, y };
        else this.cand = { pid: e.pointerId, x, y, t: now };
      }
      return;
    }
    if (!primary) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    this.lastActive = now;
    this.ptr = { x, y, in: true, touch };
    const btn = this.drag ? null : this.btnAt(x, y);
    const menuWasOpen = !this.menu.hidden;
    if (menuWasOpen) this.closeMenu();
    if (btn) {
      e.stopPropagation();
      e.preventDefault();
      this.swallow = e.pointerId; // its release is not a board click either
      if (btn === 'add') {
        if (!menuWasOpen) this.openMenu();
      } else this.removeFx(btn);
      return;
    }
    if (menuWasOpen) {
      // A press off the menu only closes it; the dial stays up.
      e.stopPropagation();
      e.preventDefault();
      this.swallow = e.pointerId;
      return;
    }
    const id = this.ringAt(x, y);
    if (id && !this.drag) {
      e.stopPropagation();
      e.preventDefault();
      this.history.begin();
      this.drag = { id, pid: e.pointerId, t: fxPos(id, this.store.fx[id]) / fxMaxPos(id) };
      this.hover = id;
      try {
        this.stage.setPointerCapture(e.pointerId);
      } catch {
        // synthetic or inactive pointer: the gesture still runs
      }
      this.stage.classList.add('fx-grab');
      this.focusUi(true);
      this.setFromPointer(x, y);
      this.sync(true);
      return;
    }
    // Anywhere else (centre, gap, empty board, a node) a press closes the dial and passes through, so deselect and
    // node behaviour are unchanged. Remember the click so a quick second one still reads as a double-click.
    this.lastClick = { t: now, x, y };
    this.close();
  };

  private onMove = (e: PointerEvent): void => {
    if (this.cand && e.pointerId === this.cand.pid) {
      const q = this.local(e);
      if (Math.hypot(q.x - this.cand.x, q.y - this.cand.y) > (e.pointerType === 'touch' ? 12 : 5)) this.cand = null;
    }
    if (!this.open) {
      if (this.inStage(e)) this.ptr = { ...this.local(e), in: true, touch: e.pointerType === 'touch' };
      else this.ptr.in = false;
      return;
    }
    const d = this.drag;
    if (d && e.pointerId === d.pid) {
      e.stopPropagation();
      const { x, y } = this.local(e);
      this.lastActive = performance.now();
      this.setFromPointer(x, y);
      return;
    }
    if (!this.inStage(e)) {
      this.ptr.in = false;
      this.setHover(null);
      return;
    }
    if (this.stage.classList.contains('fx-hide') && (e.movementX || e.movementY)) {
      this.stage.classList.remove('fx-hide');
      window.clearTimeout(this.hideTimer);
      this.wheelActive = null;
      this.sync();
      if (!this.drag) this.focusUi(false);
    }
    e.stopPropagation(); // nodes do not hover while the dial is up
    const { x, y } = this.local(e);
    this.ptr = { x, y, in: true, touch: e.pointerType === 'touch' };
    const btn = this.btnAt(x, y);
    const id = btn ? null : this.ringAt(x, y);
    if (btn || id || Math.hypot(x - this.cx, y - this.cy) <= this.outer + 8) this.lastActive = performance.now();
    this.setBtnHover(btn);
    this.setHover(id);
  };

  private onUp = (e: PointerEvent): void => {
    const c = this.cand;
    if (c && c.pid === e.pointerId) {
      this.cand = null;
      const q = this.local(e);
      if (e.type === 'pointerup' && Math.hypot(q.x - c.x, q.y - c.y) <= (e.pointerType === 'touch' ? 12 : 5)) {
        this.lastClick = { t: performance.now(), x: c.x, y: c.y };
        window.clearTimeout(this.openTimer);
        this.openTimer = window.setTimeout(() => this.openAt(c.x, c.y), OPEN_DELAY);
      }
      return;
    }
    if (e.pointerId === this.swallow) {
      this.swallow = -1;
      e.stopPropagation();
      return;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.pid) return;
    e.stopPropagation();
    this.drag = null;
    try {
      if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    this.stage.classList.remove('fx-grab');
    const q = this.local(e);
    this.ptr = { x: q.x, y: q.y, in: this.inStage(e), touch: e.pointerType === 'touch' };
    this.setHover(this.ptr.in ? this.ringAt(q.x, q.y) : null);
    this.focusUi(this.stage.classList.contains('fx-hide'));
    this.history.commit(`FX ${NAMES[d.id]}`);
    this.sync(true);
  };

  /** Open: the wheel belongs to the dial, with or without ⌥. Nodes never resize underneath it. */
  private onWheelCapture = (e: WheelEvent): void => {
    if (!this.open || !this.inStage(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (this.drag || e.ctrlKey) return;
    const now = performance.now();
    this.lastActive = now;
    const { x, y } = this.local(e);
    const id = this.ringAt(x, y);
    if (id !== this.wheelId) {
      this.wheelId = id;
      this.wheelAcc = 0;
    }
    if (!id || now - this.openedAt < SETTLE_MS) return;
    const dy = wheelUp(e, true);
    if (dy === 0) return;
    // Same feel as the panel knobs: ~1 step per 12 px, wheel up = more, remainder carried.
    this.wheelAcc += dy / 12;
    const steps = Math.trunc(this.wheelAcc);
    if (steps === 0) return;
    this.wheelAcc -= steps;
    this.wheelActive = id;
    this.hideCursor();
    this.actions.fxGoto(id, fxPos(id, this.store.fx[id]) + steps);
  };

  /** ⌥ + scroll on empty field (over a node it still tunes SOFT; the handles claim those events first). */
  private onSummon = (e: WheelEvent): void => {
    if (this.open || e.defaultPrevented || !e.altKey || e.ctrlKey) return;
    if (this.store.drawing || this.store.drag.kind !== 'none') return;
    e.preventDefault();
    const { x, y } = this.local(e);
    this.openAt(x, y);
  };

  private onKeyCapture = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.open) {
      e.preventDefault();
      e.stopPropagation();
      if (!this.menu.hidden) {
        const kb = this.menu.classList.contains('is-kb');
        this.closeMenu();
        if (kb) this.views.find((v) => this.shown.has(v.id))?.g.focus({ preventScroll: true });
      } else this.close();
      return;
    }
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input:not([type=color]):not([type=checkbox]), textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.open) this.close();
      else this.openAtCursor();
    }
  };

  private onRingKey(e: KeyboardEvent, id: FxId): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const pos = fxPos(id, this.store.fx[id]);
    const max = fxMaxPos(id);
    const big = e.shiftKey ? 10 : 1;
    let to: number;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown': to = pos - big; break;
      case 'ArrowRight':
      case 'ArrowUp': to = pos + big; break;
      case 'PageUp': to = pos + 10; break;
      case 'PageDown': to = pos - 10; break;
      case 'Home': to = 0; break;
      case 'End': to = max; break;
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        e.stopPropagation();
        const next = this.views.find((v) => v.id !== id && this.shown.has(v.id) && this.store.fx[v.id] > 0);
        this.removeFx(id);
        next?.g.focus({ preventScroll: true });
        return;
      }
      case '+':
      case '=':
        e.preventDefault();
        e.stopPropagation();
        this.openMenu(true);
        return;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.lastActive = performance.now();
    this.keyed = id;
    this.actions.fxGoto(id, Math.min(max, Math.max(0, to)));
  }
}

