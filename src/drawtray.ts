import type { Actions } from './actions';
import {
  canFill,
  DRAW_KINDS,
  DRAW_LABEL,
  draw,
  onDrawChange,
  POINTS_MAX,
  POINTS_MIN,
  setDraw,
  SPIKE_MAX,
  WEIGHT_MAX,
  WEIGHT_MIN,
  type DrawKind,
} from './drawtools';
import { strokePath } from './geom';
import type { Metrics } from './handles';
import type { History } from './history';
import { emit, nodeSerial, PAPER_HEX, type Store } from './store';

const TYPING = 'input:not([type=color]):not([type=checkbox]):not([type=range]), textarea, select, [contenteditable=""], [contenteditable="true"]';

const ICON: Record<DrawKind, string> = {
  pencil: '<path d="M3 13l.8-3.2L10.6 3l2.4 2.4-6.8 6.8z"/><path d="M9.2 4.4l2.4 2.4"/>',
  line: '<path d="M4 12L12 4"/><rect x="2" y="11" width="3" height="3"/><rect x="11" y="2" width="3" height="3"/>',
  rect: '<rect x="2.5" y="4" width="11" height="8"/>',
  ellipse: '<ellipse cx="8" cy="8" rx="5.5" ry="4.5"/>',
  tri: '<path d="M8 2.8l5.6 10H2.4z"/>',
  star: '<path d="M8 2l1.6 3.9 4.1.3-3.2 2.7 1 4.1L8 10.8l-3.5 2.2 1-4.1-3.2-2.7 4.1-.3z"/>',
};

const HINT: Record<DrawKind, string> = {
  pencil: 'DRAG A STROKE',
  line: 'DRAG · ⇧ 45°',
  rect: 'DRAG · ⇧ SQUARE · ⌥ FROM CENTRE',
  ellipse: 'DRAG · ⇧ CIRCLE · ⌥ FROM CENTRE',
  tri: 'DRAG · ⇧ EVEN · ⌥ FROM CENTRE',
  star: 'DRAG OUT FROM THE CENTRE, ROUND TO TURN · ↑↓ POINTS · ←→ SPIKE',
};

/** Gap between the tray and the stage edge it sits on (px; matches `.draw-tray` in styles.css). */
const TRAY_GAP = 8;
/** Tallest the weight preview may draw at true size, as a share of the stage height (beyond it, it scales down). */
const PREVIEW_MAX = 0.55;

/**
 * The DRAW tray: a plate over the foot of the stage (like the RANDOM / VARY strip). Left, the tools (pencil, line,
 * rect, ellipse, triangle, star — keys 1–6); right of a rule, the look: OUTLINE / FILL, WEIGHT, and for the star its
 * POINTS and SPIKE depth. Two modes:
 * - DRAW tool on: the controls set up the next shape.
 * - A drawn stroke selected (edit tool): the tray stays up and its controls edit that stroke (undoable); a tool
 *   button starts drawing again.
 */
export class DrawTray {
  private el = document.createElement('div');
  private head = document.createElement('div');
  private toolBtns = new Map<DrawKind, HTMLButtonElement>();
  private styleBtns: HTMLButtonElement[] = [];
  private weight!: HTMLInputElement;
  private weightOut!: HTMLOutputElement;
  private preview = document.createElement('div');
  private pvBar = document.createElement('div');
  private pvTag = document.createElement('span');
  private pointsOut!: HTMLOutputElement;
  private spike!: HTMLInputElement;
  private spikeOut!: HTMLOutputElement;
  private starFields: HTMLElement[] = [];
  private styleGroup!: HTMLElement;
  private key = '';
  /** A weight drag on the selected stroke is one undo step: open from the first input until the slider lets go. */
  private weightGesture = false;
  /** × on a selected stroke: the tray stays away for that stroke until something else is selected. */
  private dismissedUid: number | null = null;

  constructor(
    private store: Store,
    private actions: Actions,
    private history: History,
    stage: HTMLElement,
    private metrics: Metrics,
    private isPreview: () => boolean,
  ) {
    const el = this.el;
    el.className = 'draw-tray';
    el.dataset.stageUi = '';
    el.dataset.testid = 'draw-tray';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Draw tools');
    el.hidden = true;

    const headRow = document.createElement('div');
    headRow.className = 'vary-headrow';
    this.head.className = 'vary-head';
    // ×: leave the tray. Drawing: DRAW off (as Esc). Editing a stroke: hide the tray, keep the selection.
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mini dt-close';
    close.dataset.action = 'draw-tray-close';
    close.setAttribute('aria-label', 'Close draw tools');
    close.title = 'Close (Esc while drawing)';
    close.innerHTML = '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6"/></svg>';
    close.addEventListener('click', () => this.dismiss());
    headRow.append(this.head, close);

    const row = document.createElement('div');
    row.className = 'dt-row';

    const toolsG = document.createElement('div');
    toolsG.className = 'dt-tools';
    toolsG.setAttribute('role', 'radiogroup');
    toolsG.setAttribute('aria-label', 'Tool');
    DRAW_KINDS.forEach((k, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dt-tool';
      b.dataset.drawKind = k;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `${DRAW_LABEL[k]} (${i + 1})`);
      b.title = `${DRAW_LABEL[k].charAt(0)}${DRAW_LABEL[k].slice(1).toLowerCase()} (${i + 1})`;
      b.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${ICON[k]}</svg><b>${i + 1}</b>`;
      b.addEventListener('click', () => this.pickTool(k));
      toolsG.append(b);
      this.toolBtns.set(k, b);
    });

    const sep = document.createElement('span');
    sep.className = 'dt-sep';
    sep.setAttribute('aria-hidden', 'true');

    const props = document.createElement('div');
    props.className = 'dt-props';

    // OUTLINE / FILL: a two-way segment (closed shapes only).
    this.styleGroup = document.createElement('div');
    this.styleGroup.className = 'dt-seg';
    this.styleGroup.setAttribute('role', 'radiogroup');
    this.styleGroup.setAttribute('aria-label', 'Style');
    for (const [label, fill] of [['OUTLINE', false], ['FILL', true]] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.drawFill = String(fill);
      b.innerHTML = `<i aria-hidden="true" class="${fill ? 'is-fill' : ''}"></i>${label}`;
      b.addEventListener('click', () => this.setFill(fill));
      this.styleGroup.append(b);
      this.styleBtns.push(b);
    }

    // WEIGHT: a slider, and over it while it is touched a true-size preview of the reach (VOID plate, soft bar).
    const wf = this.field('WEIGHT', 'dt-weight');
    this.weight = this.range(WEIGHT_MIN, WEIGHT_MAX, 0.005, 'Weight');
    this.weight.addEventListener('input', () => this.setWeight(Number(this.weight.value)));
    this.weight.addEventListener('change', () => this.endWeight());
    this.weightOut = document.createElement('output');
    this.preview.className = 'dt-preview';
    this.preview.setAttribute('aria-hidden', 'true');
    this.pvBar.className = 'dt-pv-bar';
    this.pvTag.className = 'dt-pv-tag';
    this.preview.append(this.pvBar, this.pvTag);
    wf.append(this.weight, this.weightOut, this.preview);
    this.weight.addEventListener('pointerdown', () => {
      wf.classList.add('is-adjusting');
      const up = (): void => {
        wf.classList.remove('is-adjusting');
        this.endWeight();
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
    this.weight.addEventListener('blur', () => this.endWeight());

    const pf = this.field('POINTS', 'dt-star');
    const minus = this.step('−', 'Fewer points', -1);
    const plus = this.step('+', 'More points', 1);
    this.pointsOut = document.createElement('output');
    pf.append(minus, this.pointsOut, plus);
    pf.addEventListener('wheel', (e) => {
      e.preventDefault();
      setDraw({ points: draw.points + (e.deltaY < 0 ? 1 : -1) });
    }, { passive: false });

    const sf = this.field('SPIKE', 'dt-star');
    this.spike = this.range(0, SPIKE_MAX, 0.01, 'Spike depth');
    this.spike.addEventListener('input', () => setDraw({ spike: Number(this.spike.value) }));
    this.spikeOut = document.createElement('output');
    sf.append(this.spike, this.spikeOut);
    this.starFields = [pf, sf];

    props.append(this.styleGroup, wf, pf, sf);
    row.append(toolsG, sep, props);
    el.append(headRow, row);
    stage.appendChild(el);

    // A child of the stage: keep its gestures away from the board.
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick', 'wheel', 'contextmenu']) {
      el.addEventListener(t, (e) => e.stopPropagation());
    }

    window.addEventListener('keydown', (e) => this.onKey(e), { capture: true });
    store.listeners.add(() => this.sync());
    onDrawChange(() => this.sync());
    this.sync();
  }

  /** The selected drawn stroke the tray is editing (edit tool), or −1. */
  private editing(): number {
    const s = this.store;
    if (s.tool !== 'edit' || s.drawing) return -1;
    const i = this.actions.target;
    return i >= 0 && s.nodes[i].shape === 'stroke' ? i : -1;
  }

  private dismiss(): void {
    const s = this.store;
    if (s.drawing) return;
    if (s.tool === 'draw') {
      this.actions.setDraw(false);
      s.say('DRAW OFF');
      return;
    }
    const i = this.editing();
    if (i >= 0) {
      this.dismissedUid = s.nodes[i].uid;
      this.sync();
    }
  }

  private pickTool(k: DrawKind): void {
    setDraw({ kind: k });
    if (this.store.tool !== 'draw') this.actions.setDraw(true);
  }

  private setFill(fill: boolean): void {
    const i = this.editing();
    if (i < 0) {
      setDraw({ fill });
      return;
    }
    const s = this.store;
    const n = s.nodes[i];
    if (!n.closed || n.fill === fill || n.lock) return;
    this.history.mark(`${fill ? 'FILL' : 'OUTLINE'} ${nodeSerial(i)}`);
    n.fill = fill;
    s.say(`${nodeSerial(i)} · ${fill ? 'FILL' : 'OUTLINE'}`);
    emit(s);
  }

  private setWeight(v: number): void {
    const i = this.editing();
    if (i < 0) {
      setDraw({ weight: v });
      return;
    }
    const s = this.store;
    const n = s.nodes[i];
    if (n.lock) return;
    if (!this.weightGesture) {
      this.history.begin();
      this.weightGesture = true;
    }
    n.r = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, v));
    s.modified = true;
    emit(s);
  }

  private endWeight(): void {
    if (!this.weightGesture) return;
    this.weightGesture = false;
    const i = this.editing();
    this.history.commit(i >= 0 ? `WEIGHT ${nodeSerial(i)}` : 'WEIGHT');
  }

  private field(label: string, cls: string): HTMLElement {
    const f = document.createElement('div');
    f.className = `dt-field ${cls}`;
    const l = document.createElement('span');
    l.className = 'dt-label';
    l.textContent = label;
    f.append(l);
    return f;
  }

  private range(min: number, max: number, step: number, label: string): HTMLInputElement {
    const r = document.createElement('input');
    r.type = 'range';
    r.min = String(min);
    r.max = String(max);
    r.step = String(step);
    r.setAttribute('aria-label', label);
    return r;
  }

  private step(text: string, label: string, d: number): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dt-step';
    b.textContent = text;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => setDraw({ points: draw.points + d }));
    return b;
  }

  private onKey(e: KeyboardEvent): void {
    if (this.store.tool !== 'draw' || this.isPreview() || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(TYPING)) return;
    // The RANDOM / VARY strip owns 1–4 while it is open.
    const stripOpen = !!document.querySelector('.vary-strip:not([hidden])');
    if (/^[1-6]$/.test(e.key) && !e.repeat && !stripOpen) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setDraw({ kind: DRAW_KINDS[Number(e.key) - 1] });
      return;
    }
    if (draw.kind === 'star' && e.key.startsWith('Arrow') && !(t instanceof HTMLInputElement)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') setDraw({ points: draw.points + (e.key === 'ArrowUp' ? 1 : -1) });
      else setDraw({ spike: draw.spike + (e.key === 'ArrowRight' ? 0.05 : -0.05) * (e.shiftKey ? 2 : 1) });
      this.store.say(`STAR · ${draw.points} PTS · SPIKE ${Math.round(draw.spike * 100)}`);
    }
  }

  /** Per frame: cheap when nothing changed (wheel / pinch on the selected stroke, a resize, PREVIEW, the strip). */
  frame(): void {
    this.sync();
    this.place();
  }

  /**
   * Keep the tray off the stroke it is about: the selected one, or the one being drawn. At the foot of the stage by
   * default; at the head when the stroke runs under the foot spot and the head spot covers less of it.
   */
  private place(): void {
    if (this.el.hidden) {
      this.el.classList.remove('is-top');
      return;
    }
    const s = this.store;
    const m = this.metrics;
    const ei = this.editing();
    const n = ei >= 0 ? s.nodes[ei] : s.drawing ? s.nodes[s.nodes.length - 1] : null;
    let top = false;
    if (n && n.shape === 'stroke' && n.pts.length) {
      // The stroke's box on the stage, with a little room for its glow and the anchor squares.
      const pad = 12;
      const cx = n.dx * m.w;
      const cy = n.dy * m.h;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of strokePath(n.pts, n)) {
        const x = cx + p[0] * m.min;
        const y = cy + p[1] * m.min;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      x0 -= pad;
      x1 += pad;
      y0 -= pad;
      y1 += pad;
      const w = this.el.offsetWidth;
      const h = this.el.offsetHeight;
      const l = (m.w - w) / 2;
      const ox = Math.max(0, Math.min(x1, l + w) - Math.max(x0, l));
      const cover = (t: number): number => ox * Math.max(0, Math.min(y1, t + h) - Math.max(y0, t));
      const below = cover(m.h - TRAY_GAP - h);
      top = below > 0 && cover(TRAY_GAP) < below;
    }
    if (this.el.classList.contains('is-top') !== top) this.el.classList.toggle('is-top', top);
  }

  private sync(): void {
    const s = this.store;
    const ei = this.editing();
    const stripOpen = !!document.querySelector('.vary-strip:not([hidden])');
    // A dismissed stroke stays dismissed only while it is the selection; drawing again brings the tray back.
    const eu = ei >= 0 ? s.nodes[ei].uid : null;
    if (this.dismissedUid !== null && (s.tool === 'draw' || eu !== this.dismissedUid)) this.dismissedUid = null;
    const on = (s.tool === 'draw' || (ei >= 0 && eu !== this.dismissedUid)) && !this.isPreview() && !stripOpen;
    const n = ei >= 0 ? s.nodes[ei] : null;
    const weight = n ? n.r : draw.weight;
    const hex = n ? n.hex : s.tool === 'draw' ? s.drawColor : PAPER_HEX;
    const key = on
      ? `${ei}|${n?.uid}|${n?.closed}|${n?.fill}|${n?.lock}|${n?.pts.length}|${s.tool}|${draw.kind}|${draw.fill}|${weight}|${draw.points}|${draw.spike}|${hex}|${this.metrics.min}|${this.metrics.h}`
      : 'off';
    if (key === this.key) return;
    this.key = key;
    if (this.el.hidden === on) this.el.hidden = !on;
    if (!on) return;
    const k = draw.kind;
    if (n) {
      const what = n.fill ? 'FILL' : n.closed ? 'SHAPE' : 'STROKE';
      this.head.textContent = `${nodeSerial(ei)} // ${what} · ${String(n.pts.length).padStart(2, '0')} PTS // ${n.lock ? 'LOCKED' : 'EDITING THIS SHAPE · PICK A TOOL TO DRAW'}`;
    } else {
      this.head.textContent = `DRAW // ${DRAW_LABEL[k]} // ${HINT[k]} · ESC`;
    }
    this.el.classList.toggle('is-editing', !!n);
    for (const [kind, b] of this.toolBtns) {
      const checked = !n && kind === k;
      b.setAttribute('aria-checked', String(checked));
      b.classList.toggle('is-on', checked);
    }
    const fillable = n ? n.closed && !n.lock : canFill(k);
    const filled = n ? n.fill : draw.fill;
    this.styleGroup.classList.toggle('is-off', !fillable);
    for (const b of this.styleBtns) {
      const fill = b.dataset.drawFill === 'true';
      const checked = fillable || n ? fill === filled : !fill;
      b.setAttribute('aria-checked', String(checked));
      b.classList.toggle('is-on', checked);
      b.disabled = !fillable;
    }
    this.weight.disabled = !!n?.lock;
    if (document.activeElement !== this.weight || !this.weightGesture) this.weight.value = String(weight);
    const px = weight * this.metrics.min;
    this.weightOut.textContent = `${Math.round(px)} PX`;
    this.layoutPreview(px, hex);
    this.pointsOut.textContent = String(draw.points).padStart(2, '0');
    if (document.activeElement !== this.spike) this.spike.value = String(draw.spike);
    this.spikeOut.textContent = draw.spike <= 0.01 ? 'POLY' : String(Math.round(draw.spike * 100)).padStart(2, '0');
    for (const f of this.starFields) f.hidden = !!n || k !== 'star';
    const [minus, , plus] = [...this.starFields[0].querySelectorAll('button, output')] as HTMLButtonElement[];
    minus.disabled = draw.points <= POINTS_MIN;
    plus.disabled = draw.points >= POINTS_MAX;
  }

  /**
   * The weight preview: a soft bar in the stroke's colour whose glow spans the reach either side of its spine (2 × r),
   * at true size when it fits over the stage, else scaled (the tag says so). Dashed rules mark the reach.
   */
  private layoutPreview(px: number, hex: string): void {
    const full = px * 2;
    const max = Math.max(40, this.metrics.h * PREVIEW_MAX);
    const scale = full > max ? max / full : 1;
    const h = full * scale;
    this.preview.style.setProperty('--pv-h', `${h.toFixed(1)}px`);
    this.preview.style.setProperty('--pv-c', hex);
    this.pvTag.textContent = `${Math.round(px)} PX${scale < 1 ? ` · 1:${(1 / scale).toFixed(1)}` : ''}`;
  }
}
