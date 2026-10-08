const NS = 'http://www.w3.org/2000/svg';
const TICKS = 21;
/** 270° sweep, gap centred at 6 o'clock: 0 sits lower-left, max lower-right, clockwise through the top. */
const A0 = -135;
const SWEEP = 270;

const el = (name: string, attrs: Record<string, string | number> = {}): SVGElement => {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
};

/** Point at `deg` clockwise from 12 o'clock, radius r, in the knob's ±20 viewBox. */
const at = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [+(r * Math.sin(a)).toFixed(2), +(-r * Math.cos(a)).toFixed(2)];
};

export interface KnobHandlers {
  /** Pointer drag: `start` (open the undo gesture), `move` with the new position, `end` (commit it). */
  drag(phase: 'start' | 'move' | 'end', pos?: number): void;
  /** Wheel / keyboard: absolute target position; the owner coalesces bursts into one undo step. */
  goto(pos: number): void;
  /** Double-click / double-tap. */
  toggle(): void;
}

/**
 * Small SVG gauge in the SOFT-gauge language: 21 ticks over a 270° arc, a pointer notch, a centre crosshair.
 * It owns the pointer / wheel / keyboard gestures; the value itself lives in the store (`render` mirrors it).
 */
export class Knob {
  private ticks: SVGElement[] = [];
  private notch: SVGElement;
  private pos = 0;
  private lit = -1;
  private engagedTimer = 0;
  private drag: { id: number; x0: number; y0: number; pos0: number; t0: number; moved: boolean; second: boolean } | null = null;
  private wheelAcc = 0;
  private lastTap = 0;
  private lastType = 'mouse';

  constructor(
    readonly root: HTMLElement,
    private max: number,
    private h: KnobHandlers,
  ) {
    const svg = el('svg', { viewBox: '-20 -20 40 40', 'aria-hidden': 'true', focusable: 'false' });
    const [x0, y0] = at(A0, 19);
    const [x1, y1] = at(A0 + SWEEP, 19);
    svg.appendChild(el('path', { class: 'k-arc', d: `M${x0} ${y0}A19 19 0 1 1 ${x1} ${y1}` }));
    for (let k = 0; k < TICKS; k++) {
      const deg = A0 + (SWEEP * k) / (TICKS - 1);
      const [ax, ay] = at(deg, 12.5);
      const [bx, by] = at(deg, k % 5 === 0 ? 17.5 : 16);
      const t = el('line', { class: 'k-tick', x1: ax, y1: ay, x2: bx, y2: by });
      svg.appendChild(t);
      this.ticks.push(t);
    }
    this.notch = el('path', { class: 'k-notch', d: 'M0 -5.5V-10.5' });
    svg.appendChild(this.notch);
    svg.appendChild(el('path', { class: 'k-cross', d: 'M-1.6 0H1.6M0 -1.6V1.6' }));
    root.appendChild(svg);

    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onUp);
    root.addEventListener('dblclick', () => {
      if (this.lastType === 'mouse' || this.lastType === 'pen') this.h.toggle();
    });
    root.addEventListener('wheel', this.onWheel, { passive: false });
    root.addEventListener('keydown', this.onKey);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Mirror the store: `pos` in 0…max, plus the ARIA bits. */
  render(pos: number, raw: number, valueText: string): void {
    this.pos = pos;
    const lit = pos <= 0 ? 0 : Math.floor((pos / this.max) * (TICKS - 1) + 1e-6) + 1;
    if (lit !== this.lit) {
      this.lit = lit;
      this.ticks.forEach((t, k) => t.classList.toggle('is-on', k < lit));
    }
    this.notch.setAttribute('transform', `rotate(${A0 + (SWEEP * pos) / this.max})`);
    const r = this.root;
    if (r.getAttribute('aria-valuenow') !== String(raw)) r.setAttribute('aria-valuenow', String(raw));
    if (r.getAttribute('aria-valuetext') !== valueText) r.setAttribute('aria-valuetext', valueText);
    r.classList.toggle('is-off', pos <= 0);
  }

  /** FLARE for a moment after wheel / key adjustments, like the SOFT gauge's flash. */
  private flash(ms = 900): void {
    this.root.classList.add('is-engaged');
    window.clearTimeout(this.engagedTimer);
    if (!this.drag) this.engagedTimer = window.setTimeout(() => this.root.classList.remove('is-engaged'), ms);
  }

  private onDown = (e: PointerEvent): void => {
    this.lastType = e.pointerType;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.drag) return;
    e.preventDefault();
    this.root.focus({ preventScroll: true });
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      // pointer no longer active (synthetic events, iOS edge cases): the gesture still runs
    }
    const t0 = performance.now();
    // Second tap of a double-tap: this press lands within 380 ms of the previous tap's pointerup.
    const second = e.pointerType === 'touch' && this.lastTap > 0 && t0 - this.lastTap < 380;
    this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, pos0: this.pos, t0, moved: false, second };
    window.clearTimeout(this.engagedTimer);
    this.root.classList.add('is-engaged');
    this.h.drag('start');
  };

  private onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (Math.hypot(dx, dy) > 4) d.moved = true;
    // Up and right raise the value; the full range takes ≈ 160 px whatever the knob's step count.
    const perStep = 160 / this.max;
    const pos = Math.min(this.max, Math.max(0, Math.round(d.pos0 + (dx - dy) / perStep)));
    if (pos !== this.pos) this.h.drag('move', pos);
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    try {
      if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    this.root.classList.remove('is-engaged');
    this.h.drag('end');
    // Touch has no dblclick we can trust: two quick still taps toggle (gap: first up → second down).
    if (e.type === 'pointerup' && e.pointerType === 'touch' && !d.moved && performance.now() - d.t0 < 450) {
      if (d.second) {
        this.lastTap = 0;
        this.h.toggle();
      } else {
        this.lastTap = performance.now();
      }
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.drag) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dy = (e.deltaY || e.deltaX) * unit;
    if (dy === 0) return;
    // ~1 step per 12 px, wheel up = more; carry the remainder so slow trackpads still move.
    this.wheelAcc += -dy / 12;
    const steps = Math.trunc(this.wheelAcc);
    if (steps === 0) return;
    this.wheelAcc -= steps;
    this.flash();
    this.h.goto(this.pos + steps);
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const big = e.shiftKey ? 10 : 1;
    let to: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown': to = this.pos - big; break;
      case 'ArrowRight':
      case 'ArrowUp': to = this.pos + big; break;
      case 'PageUp': to = this.pos + 10; break;
      case 'PageDown': to = this.pos - 10; break;
      case 'Home': to = 0; break;
      case 'End': to = this.max; break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation(); // never reach the global handlers (nudge, layers, delete …)
    this.flash();
    this.h.goto(Math.min(this.max, Math.max(0, to)));
  };
}
