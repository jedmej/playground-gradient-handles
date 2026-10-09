import type { Actions } from './actions';
import { fieldHexAt } from './field';
import type { Metrics } from './handles';
import type { History } from './history';
import { nodeSerial, type NodeState, type Store } from './store';

/**
 * v6 precision tools: SNAP [G], MIRROR [Y] and the EYEDROPPER [I].
 * State is a module singleton (like `rememberFx`), so the pointer layer, actions and the toolbar share it without
 * widening the store. Only SNAP persists (`gh.tools.v1`); the symmetry mode and its pairs are per session.
 */
export type Mirror = 'off' | 'x' | 'y' | 'xy';
const MIRRORS: Mirror[] = ['off', 'x', 'y', 'xy'];
export const TOOLS_KEY = 'gh.tools.v1';
/** The rulers' graduation: 20 steps a side (`drawRulers`). Snapping and the faint grid use the same ticks. */
const GRID_N = 20;
/** A node's x / y snaps to another node's when they are this close (CSS px). */
const ALIGN_PX = 6;
/** A mirror partner is the unpaired node nearest to the mirrored position, within this share of the short side. */
const PAIR_TOL = 0.1;

/** One symmetry group: every member is the reference node flipped on x and / or y. */
interface Member {
  uid: number;
  fx: boolean;
  fy: boolean;
}

export const tools = {
  snap: false,
  mirror: 'off' as Mirror,
  /** uid -> its group (shared array). Nodes without a partner have no entry. */
  groups: new Map<number, Member[]>(),
  /** Guides of the drag in progress (0–1), shown only while an alignment is active. */
  guides: { x: null as number | null, y: null as number | null },
  /** True while the grid should show (a node drag with snapping effective). */
  gridOn: false,
};

try {
  const raw = localStorage.getItem(TOOLS_KEY);
  if (raw) tools.snap = !!(JSON.parse(raw) as { snap?: unknown }).snap;
} catch {
  /* blocked storage / bad JSON: snapping just starts off */
}

function persist(): void {
  try {
    localStorage.setItem(TOOLS_KEY, JSON.stringify({ v: 1, snap: tools.snap }));
  } catch {
    /* private mode: not remembered */
  }
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Strokes move as one rigid node and are not mirrored (their points would have to flip): they never pair. */
const pairable = (n: NodeState): boolean => n.shape !== 'stroke';

function flips(mode: Mirror): { fx: boolean; fy: boolean }[] {
  return mode === 'x' ? [{ fx: true, fy: false }]
    : mode === 'y' ? [{ fx: false, fy: true }]
    : mode === 'xy' ? [{ fx: true, fy: false }, { fx: false, fy: true }, { fx: true, fy: true }]
    : [];
}

/** (Re)build the symmetry groups from the current layout: pair by nearest mirrored position. */
export function pairNodes(store: Store, m: Metrics): void {
  tools.groups.clear();
  const kinds = flips(tools.mirror);
  if (!kinds.length) return;
  const used = new Set<number>();
  const tol = PAIR_TOL * m.min;
  for (const a of store.nodes) {
    if (used.has(a.uid) || !pairable(a)) continue;
    used.add(a.uid);
    const group: Member[] = [{ uid: a.uid, fx: false, fy: false }];
    for (const k of kinds) {
      const tx = (k.fx ? 1 - a.x : a.x) * m.w;
      const ty = (k.fy ? 1 - a.y : a.y) * m.h;
      let best: NodeState | null = null;
      let bd = tol;
      for (const b of store.nodes) {
        if (used.has(b.uid) || !pairable(b)) continue;
        const d = Math.hypot(b.x * m.w - tx, b.y * m.h - ty);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) {
        used.add(best.uid);
        group.push({ uid: best.uid, fx: k.fx, fy: k.fy });
      }
    }
    if (group.length > 1) for (const g of group) tools.groups.set(g.uid, group);
  }
}

export function cycleMirror(store: Store, m: Metrics): Mirror {
  tools.mirror = MIRRORS[(MIRRORS.indexOf(tools.mirror) + 1) % MIRRORS.length];
  pairNodes(store, m);
  return tools.mirror;
}

/** Move node `n` to (nx, ny) (0–1) with snapping (`invert`: ⌘/Ctrl held; null: never), dragging its mirror partners along. */
export function placeNode(store: Store, m: Metrics, n: NodeState, nx: number, ny: number, invert: boolean | null): void {
  const group = tools.groups.get(n.uid);
  const live = (group ?? []).filter((g) => store.nodes.some((o) => o.uid === g.uid));
  const moving = new Set(live.map((g) => g.uid).concat(n.uid));
  let x = clamp01(nx);
  let y = clamp01(ny);
  const on = invert !== null && tools.snap !== invert; // null = no snapping (keyboard nudges)
  tools.gridOn = on;
  tools.guides.x = tools.guides.y = null;
  if (on) {
    const others = store.nodes.filter((o) => !moving.has(o.uid));
    const axis = (v: number, len: number, pick: (o: NodeState) => number): { v: number; guide: number | null } => {
      let best: number | null = null;
      let bd = ALIGN_PX / len;
      for (const o of others) {
        const d = Math.abs(pick(o) - v);
        if (d <= bd) { bd = d; best = pick(o); }
      }
      return best !== null ? { v: best, guide: best } : { v: Math.round(v * GRID_N) / GRID_N, guide: null };
    };
    const ax = axis(x, m.w, (o) => o.x);
    const ay = axis(y, m.h, (o) => o.y);
    x = ax.v;
    y = ay.v;
    tools.guides.x = ax.guide;
    tools.guides.y = ay.guide;
  }
  n.x = x;
  n.y = y;
  const me = live.find((g) => g.uid === n.uid);
  for (const g of live) {
    if (g.uid === n.uid) continue;
    const o = store.nodes.find((q) => q.uid === g.uid);
    if (!o) continue;
    o.x = clamp01(me && me.fx !== g.fx ? 1 - x : x);
    o.y = clamp01(me && me.fy !== g.fy ? 1 - y : y);
  }
}

/** End of a drag: hide the grid and guides. */
export function endPlace(): void {
  tools.gridOn = false;
  tools.guides.x = tools.guides.y = null;
}

/** Partner positions for a node added at (x, y) while symmetry is on (the reference itself excluded). */
export function mirrorSpots(x: number, y: number): { x: number; y: number; fx: boolean; fy: boolean }[] {
  const out: { x: number; y: number; fx: boolean; fy: boolean }[] = [];
  for (const k of flips(tools.mirror)) {
    const px = k.fx ? 1 - x : x;
    const py = k.fy ? 1 - y : y;
    if (Math.abs(px - x) < 1e-4 && Math.abs(py - y) < 1e-4) continue; // on the axis: no distinct partner
    out.push({ x: px, y: py, fx: k.fx, fy: k.fy });
  }
  return out;
}

/** Register a freshly added symmetry group (reference first). */
export function addGroup(members: Member[]): void {
  if (members.length < 2) return;
  for (const g of members) tools.groups.set(g.uid, members);
}

// ----- overlay (grid, alignment guides, mirror axes) --------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';
const mk = (tag: string, attrs: Record<string, string> = {}): SVGElement => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

/** SVG furniture under the nodes. Lives in the handles layer, so preview hides it and export never sees it. */
export class ToolsOverlay {
  private g = mk('g', { class: 'tools-layer', 'pointer-events': 'none' });
  private gridMinor = mk('path', { class: 'tl-grid tl-minor' });
  private gridMajor = mk('path', { class: 'tl-grid tl-major' });
  private guideHalo = mk('path', { class: 'tl-halo' });
  private guideInk = mk('path', { class: 'tl-guide' });
  private axisHalo = mk('path', { class: 'tl-halo' });
  private axisInk = mk('path', { class: 'tl-axis' });
  private key = '';

  constructor(
    svg: SVGSVGElement,
    private metrics: Metrics,
  ) {
    this.g.append(this.gridMinor, this.gridMajor, this.axisHalo, this.axisInk, this.guideHalo, this.guideInk);
    svg.insertBefore(this.g, svg.firstChild);
  }

  frame(): void {
    const m = this.metrics;
    const key = `${m.w}x${m.h}`;
    if (key !== this.key) {
      this.key = key;
      let minor = '';
      let major = '';
      for (let k = 0; k <= GRID_N; k++) {
        const x = +((k / GRID_N) * m.w).toFixed(1);
        const y = +((k / GRID_N) * m.h).toFixed(1);
        const seg = `M${x} 0V${m.h}M0 ${y}H${m.w}`;
        if (k % 5 === 0) major += seg;
        else minor += seg;
      }
      this.gridMinor.setAttribute('d', minor);
      this.gridMajor.setAttribute('d', major);
    }
    this.g.classList.toggle('grid-on', tools.gridOn);
    const gd = (tools.guides.x !== null ? `M${(tools.guides.x * m.w).toFixed(1)} 0V${m.h}` : '') +
      (tools.guides.y !== null ? `M0 ${(tools.guides.y * m.h).toFixed(1)}H${m.w}` : '');
    this.guideInk.setAttribute('d', gd);
    this.guideHalo.setAttribute('d', gd);
    const ad = (tools.mirror === 'x' || tools.mirror === 'xy' ? `M${(m.w / 2).toFixed(1)} 0V${m.h}` : '') +
      (tools.mirror === 'y' || tools.mirror === 'xy' ? `M0 ${(m.h / 2).toFixed(1)}H${m.w}` : '');
    this.axisInk.setAttribute('d', ad);
    this.axisHalo.setAttribute('d', ad);
  }
}

// ----- controller: toolbar buttons, keys, eyedropper ---------------------------------------------------------

const TYPING = 'input:not([type=color]):not([type=checkbox]), textarea, select, [contenteditable=""], [contenteditable="true"]';

interface ScreenEyeDropper {
  open(): Promise<{ sRGBHex: string }>;
}

export class ToolsUI {
  private snapBtn = document.querySelector<HTMLButtonElement>('[data-action=snap]')!;
  private mirrorBtn = document.querySelector<HTMLButtonElement>('[data-action=mirror]')!;
  private mirrorMode = this.mirrorBtn.querySelector<HTMLElement>('.tool-mode')!;
  private pickBtn = document.querySelector<HTMLButtonElement>('[data-action=eyedropper]')!;
  private loupe = document.createElement('div');
  private armed = false;
  private pickAt = { x: 0, y: 0 };
  private lastSync = '';

  constructor(
    private store: Store,
    private actions: Actions,
    private history: History,
    private stage: HTMLElement,
    private metrics: Metrics,
    private isPreview: () => boolean,
  ) {
    this.loupe.className = 'chip chip-loupe mono';
    this.loupe.setAttribute('aria-hidden', 'true');
    this.loupe.innerHTML = '<i></i><span></span>';
    stage.appendChild(this.loupe);

    this.snapBtn.addEventListener('click', () => this.toggleSnap());
    this.mirrorBtn.addEventListener('click', () => this.cycle());
    this.pickBtn.addEventListener('click', (e) => (e.shiftKey ? this.screenPick() : this.arm(!this.armed)));

    // Armed: the stage belongs to the eyedropper. Capture-phase, so the pointer layer never sees these events.
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
      window.addEventListener(
        type,
        (e) => {
          if (!this.armed || !(e.target instanceof Node) || !stage.contains(e.target)) return;
          e.stopImmediatePropagation();
          if (e.cancelable && type !== 'pointermove' && type !== 'wheel') e.preventDefault();
          if (type === 'pointermove' || type === 'pointerdown') {
            const p = e as PointerEvent;
            this.pickAt = { x: p.clientX - this.metrics.left, y: p.clientY - this.metrics.top };
          }
          if (type === 'pointerdown' && (e as PointerEvent).button === 0) this.commit();
        },
        { capture: true, passive: false },
      );
    }
    stage.addEventListener('pointerleave', () => this.loupe.classList.remove('is-on'));

    window.addEventListener(
      'keydown',
      (e) => {
        const t = e.target as HTMLElement | null;
        if (e.key === 'Escape' && this.armed) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.arm(false);
          this.store.say('PICK CANCELLED');
          return;
        }
        if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        if (t?.closest?.(TYPING) || t?.closest?.('[data-fx-knob], [data-fx-ring]') || this.isPreview()) return;
        const k = e.key.toLowerCase();
        if (k === 'g') {
          e.preventDefault();
          this.toggleSnap();
        } else if (k === 'y') {
          e.preventDefault();
          this.cycle();
        } else if (k === 'i') {
          e.preventDefault();
          if (e.shiftKey) this.screenPick();
          else this.arm(!this.armed);
        }
      },
      { capture: true },
    );
    this.sync();
  }

  private toggleSnap(): void {
    tools.snap = !tools.snap;
    persist();
    this.store.say(`SNAP ${tools.snap ? 'ON · GRID 1/20 + ALIGN · ⌘ INVERTS' : 'OFF'}`);
    this.sync();
  }

  private cycle(): void {
    if (this.store.drag.kind !== 'none' || this.store.drawing) return;
    const mode = cycleMirror(this.store, this.metrics);
    const paired = new Set([...tools.groups.values()]).size;
    this.store.say(mode === 'off' ? 'MIRROR OFF' : `MIRROR ${mode.toUpperCase()} · ${String(paired).padStart(2, '0')} PAIRED`);
    this.sync();
  }

  private arm(on: boolean): void {
    if (on === this.armed) return;
    if (on) {
      if (this.isPreview() || this.store.drawing || this.store.drag.kind !== 'none') return;
      if (this.actions.target < 0) {
        this.store.say('SELECT A NODE TO PICK FOR');
        return;
      }
      if (this.store.tool === 'draw') this.actions.setDraw(false);
      this.store.say('PICK · CLICK THE FIELD · ESC CANCELS');
    }
    this.armed = on;
    this.stage.classList.toggle('is-eyedrop', on);
    if (!on) this.loupe.classList.remove('is-on');
    this.sync();
  }

  private apply(hex: string): void {
    const i = this.actions.target;
    if (i < 0) return;
    this.history.mark(`PICK ${nodeSerial(i)}`);
    this.actions.setColor(i, hex);
    this.store.say(`${nodeSerial(i)} · PICK ${hex.toUpperCase()}`);
  }

  private commit(): void {
    const m = this.metrics;
    const hex = fieldHexAt(this.store, this.pickAt.x / m.w, this.pickAt.y / m.h, m);
    this.arm(false);
    this.apply(hex);
  }

  /** ⇧I: the browser's own picker, from anywhere on screen (Chromium only). */
  private screenPick(): void {
    const Ctor = (window as unknown as { EyeDropper?: new () => ScreenEyeDropper }).EyeDropper;
    if (!Ctor) {
      this.arm(!this.armed);
      return;
    }
    if (this.actions.target < 0) {
      this.store.say('SELECT A NODE TO PICK FOR');
      return;
    }
    this.arm(false);
    new Ctor()
      .open()
      .then((r) => this.apply(r.sRGBHex.toLowerCase()))
      .catch(() => {
        /* dismissed */
      });
  }

  /** Per frame: reflect state on the buttons and <html>, and keep the loupe under the pointer. */
  frame(): void {
    if (this.armed) {
      const m = this.metrics;
      const { x, y } = this.pickAt;
      const hex = fieldHexAt(this.store, x / m.w, y / m.h, m);
      (this.loupe.firstElementChild as HTMLElement).style.background = hex;
      (this.loupe.lastElementChild as HTMLElement).textContent = hex.toUpperCase();
      const flipX = x + 70 > m.w;
      const flipY = y + 44 > m.h;
      this.loupe.style.transform = `translate(${(flipX ? x - 80 : x + 16).toFixed(1)}px, ${(flipY ? y - 32 : y + 16).toFixed(1)}px)`;
      this.loupe.classList.add('is-on');
    }
    const key = `${this.actions.target >= 0}|${this.isPreview()}`;
    if (key !== this.lastSync) this.sync();
    if (this.armed && (this.actions.target < 0 || this.isPreview())) this.arm(false);
  }

  private sync(): void {
    const root = document.documentElement;
    root.dataset.snap = tools.snap ? 'on' : 'off';
    root.dataset.mirror = tools.mirror;
    this.snapBtn.setAttribute('aria-pressed', String(tools.snap));
    this.mirrorBtn.setAttribute('aria-pressed', String(tools.mirror !== 'off'));
    this.mirrorMode.textContent = tools.mirror.toUpperCase();
    this.pickBtn.setAttribute('aria-pressed', String(this.armed));
    const has = this.actions.target >= 0;
    this.pickBtn.disabled = !has && !this.armed;
    this.lastSync = `${has}|${this.isPreview()}`;
  }
}
