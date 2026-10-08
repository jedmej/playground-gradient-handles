import { clearCustom, saveCustom } from './custom';
import type { History } from './history';
import type { Metrics } from './handles';
import {
  addNode,
  applyPreset,
  CUSTOM_INDEX,
  DEFAULT_RADIUS,
  emit,
  getPreset,
  MAX_NODES,
  layerTarget,
  MIN_NODES,
  moveNodeTo,
  nodeSerial,
  PAPER_HEX,
  R_MAX,
  R_MIN,
  removeNodeAt,
  snapshotSpecs,
  tweenNodeTo,
  type LayerMove,
  type Shape,
  type Store,
} from './store';
import { fieldHexAt } from './field';
import { copyFx, FX_DEFAULT, fxActive, fxFromPos, fxMaxPos, fxPos, fxStatus, onValue, rememberFx, sameFx, type DitherMode, type FxId, type GrainSize } from './fx';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Every user edit goes through here, so history, status and index hygiene live in one place. */
export class Actions {
  private lastNudge = -Infinity;
  private lastRot = -Infinity;
  private lastRadius = -Infinity;
  private lastSoft = -Infinity;
  private lastFx = -Infinity;
  private lastFxId: FxId | null = null;
  /** FX panel subscribers: knob drags change the store without a full `emit`. */
  readonly fxListeners = new Set<() => void>();

  constructor(
    private store: Store,
    private history: History,
    private metrics: Metrics,
    private now: () => number,
  ) {}

  /** The node the panel edits: selection (or keyboard focus), never hover. */
  get target(): number {
    const s = this.store;
    const i = s.selected ?? s.focused;
    return i !== null && i < s.nodes.length ? i : -1;
  }

  addAt(nx: number, ny: number): boolean {
    const s = this.store;
    if (s.nodes.length >= MAX_NODES) {
      s.say(`NODE LIMIT ${MAX_NODES}`);
      return false;
    }
    const x = Math.min(1, Math.max(0, nx));
    const y = Math.min(1, Math.max(0, ny));
    const hex = fieldHexAt(s, x, y, this.metrics);
    this.history.mark('ADD NODE');
    const i = addNode(s, { x, y, r: DEFAULT_RADIUS, hex });
    s.selected = i;
    s.armed = i;
    s.hover = { kind: 'idle', index: -1 };
    emit(s);
    s.say(`Added ${nodeSerial(i)} · ${pad(s.nodes.length)} nodes`);
    return true;
  }

  /** Drop a node at the emptiest spot: farthest grid candidate from every existing node. */
  addAuto(): boolean {
    const s = this.store;
    const m = this.metrics;
    let best = { x: 0.5, y: 0.5, d: -1 };
    for (let a = 0; a < 9; a++) {
      for (let b = 0; b < 9; b++) {
        const x = (a + 0.5) / 9;
        const y = (b + 0.5) / 9;
        let d = Infinity;
        for (const n of s.nodes) d = Math.min(d, Math.hypot((x - n.x) * m.w, (y - n.y) * m.h));
        if (d > best.d) best = { x, y, d };
      }
    }
    return this.addAt(best.x, best.y);
  }

  removeAt(i: number): boolean {
    const s = this.store;
    if (i < 0 || i >= s.nodes.length) return false;
    if (s.nodes.length <= MIN_NODES) {
      s.say(`MIN ${MIN_NODES} NODES`);
      return false;
    }
    const serial = nodeSerial(i);
    this.history.mark(`REMOVE ${serial}`);
    removeNodeAt(s, i);
    emit(s);
    s.say(`Removed ${serial} · ${pad(s.nodes.length)} nodes`);
    return true;
  }

  removeSelected(): boolean {
    if (this.store.drag.kind !== 'none') return false;
    const i = this.target;
    return i >= 0 && this.removeAt(i);
  }

  /** Open an undo step for a colour-editing session (call once per session, before the first change). */
  beginColor(i: number): void {
    this.history.mark(`COLOUR ${nodeSerial(i)}`);
  }

  setColor(i: number, hex: string): void {
    const s = this.store;
    const n = s.nodes[i];
    if (!n || n.hex === hex) return;
    tweenNodeTo(s, n, hex, this.now(), 240);
    s.modified = true;
    emit(s);
  }

  /** Keyboard nudges coalesce: one undo step per burst. Call before mutating. */
  nudge(i: number): void {
    const t = this.now();
    if (t - this.lastNudge > 700) this.history.mark(`NUDGE ${nodeSerial(i)}`);
    this.lastNudge = t;
    this.store.modified = true;
  }

  /** Radius from keys / wheel / pinch: `fn` computes the new radius (fraction of the short side). Bursts coalesce. */
  resize(i: number, next: (r: number) => number): void {
    const s = this.store;
    const n = s.nodes[i];
    if (!n) return;
    const t = this.now();
    if (t - this.lastRadius > 700) this.history.mark(`RADIUS ${nodeSerial(i)}`);
    this.lastRadius = t;
    n.r = Math.min(R_MAX, Math.max(R_MIN, next(n.r)));
    s.modified = true;
  }

  /** Softness from wheel / buttons: `delta` is added and clamped to 0–1. Bursts coalesce into one `SOFT` step. */
  softBy(i: number, delta: number): void {
    const s = this.store;
    const n = s.nodes[i];
    if (!n) return;
    const t = this.now();
    if (t - this.lastSoft > 700) this.history.mark(`SOFT ${nodeSerial(i)}`);
    this.lastSoft = t;
    n.soft = Math.min(1, Math.max(0, Math.round((n.soft + delta) * 1e4) / 1e4));
    s.modified = true;
    emit(s);
  }

  // ----- FX -----------------------------------------------------------------------------

  private fxChanged(id: FxId | null): void {
    const s = this.store;
    rememberFx(s.fx);
    for (const l of this.fxListeners) l();
    if (id) s.say(fxStatus(id, s.fx));
  }

  /** Raw set during a drag (the gesture's own begin/commit owns the undo step). Position units, see fxPos. */
  fxSetPos(id: FxId, pos: number): void {
    const next = fxFromPos(id, Math.min(fxMaxPos(id), Math.max(0, Math.round(pos))));
    if (this.store.fx[id] === next) return;
    this.store.fx[id] = next;
    this.fxChanged(id);
  }

  /** Wheel / keyboard: absolute position, bursts on the same knob coalesce into one `FX …` undo step. */
  fxGoto(id: FxId, pos: number): void {
    const s = this.store;
    const clamped = Math.min(fxMaxPos(id), Math.max(0, Math.round(pos)));
    if (fxFromPos(id, clamped) === s.fx[id]) return;
    const t = this.now();
    if (t - this.lastFx > 700 || this.lastFxId !== id) this.history.mark(`FX ${id.toUpperCase()}`);
    this.lastFx = t;
    this.lastFxId = id;
    this.fxSetPos(id, clamped);
  }

  fxNudge(id: FxId, steps: number): void {
    this.fxGoto(id, fxPos(id, this.store.fx[id]) + steps);
  }

  /** Double-click / double-tap: OFF ↔ last non-zero value (or the on-value). */
  fxToggle(id: FxId): void {
    const s = this.store;
    this.history.mark(`FX ${id.toUpperCase()}`);
    this.lastFxId = null;
    if (s.fx[id] > 0) {
      rememberFx(s.fx);
      s.fx[id] = 0;
    } else {
      s.fx[id] = onValue(id);
    }
    this.fxChanged(id);
  }

  fxOption(opt: 'grain-fine' | 'grain-coarse' | 'dither-bayer' | 'dither-blue'): void {
    const s = this.store;
    const next = { ...s.fx };
    if (opt.startsWith('grain')) next.grainSize = opt.slice(6) as GrainSize;
    else next.ditherMode = opt.slice(7) as DitherMode;
    if (sameFx(next, s.fx)) return;
    const id: FxId = opt.startsWith('grain') ? 'grain' : 'dither';
    this.history.mark(`FX ${id.toUpperCase()}`);
    this.lastFxId = null;
    s.fx = next;
    this.fxChanged(id);
  }

  fxOff(): void {
    const s = this.store;
    if (fxActive(s.fx).length === 0) return;
    rememberFx(s.fx);
    this.history.mark('FX OFF');
    this.lastFxId = null;
    s.fx = copyFx({ ...FX_DEFAULT, grainSize: s.fx.grainSize, ditherMode: s.fx.ditherMode });
    this.fxChanged(null);
    s.say('FX OFF');
  }

  /** Move node `i` through the layer stack. One undo step; the same node stays selected. */
  moveLayer(i: number, move: LayerMove): boolean {
    const s = this.store;
    if (i < 0 || i >= s.nodes.length || s.drag.kind !== 'none' || s.drawing) return false;
    const to = layerTarget(i, s.nodes.length, move);
    const serial = nodeSerial(i);
    if (to === i) {
      s.say(`${serial} · ALREADY ${move === 'front' || move === 'up' ? 'FRONT' : 'BACK'}`);
      return false;
    }
    this.history.mark(`LAYER ${serial}`);
    moveNodeTo(s, i, to);
    s.modified = true;
    emit(s);
    s.say(`${serial} → LYR ${pad(to + 1)}/${pad(s.nodes.length)}`);
    return true;
  }

  /** Strokes cannot become shapes (and vice versa): the picker is for the four primitives. */
  setShape(i: number, shape: Shape): void {
    const s = this.store;
    const n = s.nodes[i];
    if (!n || n.shape === 'stroke' || shape === 'stroke' || n.shape === shape) return;
    this.history.mark(`SHAPE ${nodeSerial(i)}`);
    n.shape = shape;
    s.modified = true;
    emit(s);
    s.say(`${nodeSerial(i)} · ${shape.toUpperCase()}`);
  }

  /** Rotate by `deg` degrees; bursts coalesce into one undo step like arrow nudges. */
  rotate(i: number, deg: number): void {
    const s = this.store;
    const n = s.nodes[i];
    if (!n || n.shape === 'circle' || n.shape === 'stroke') return;
    const t = this.now();
    if (t - this.lastRot > 700) this.history.mark(`ROTATE ${nodeSerial(i)}`);
    this.lastRot = t;
    const TAU = Math.PI * 2;
    n.rot = (((n.rot + (deg * Math.PI) / 180) % TAU) + TAU) % TAU;
    s.modified = true;
    emit(s);
  }

  /** Enter / leave the DRAW tool. A stroke in progress is abandoned on exit. */
  setDraw(on: boolean): void {
    const s = this.store;
    if (on === (s.tool === 'draw')) return;
    if (!on && s.drawing) s.cancelDraw();
    s.tool = on ? 'draw' : 'edit';
    s.hover = { kind: 'idle', index: -1 };
    if (on) {
      const sel = this.target;
      s.drawColor = sel >= 0 ? s.nodes[sel].hex : PAPER_HEX;
      s.armed = null;
      s.say('DRAW ON · drag on the field');
    }
    emit(s);
  }

  toggleDraw(): void {
    if (this.store.drawing) return;
    this.setDraw(this.store.tool !== 'draw');
  }

  applyPresetAt(index: number): void {
    const s = this.store;
    const p = getPreset(s, index);
    if (!p) {
      s.say('CS-06 is empty — press SAVE');
      return;
    }
    this.history.mark(`PRESET ${p.serial}`);
    applyPreset(s, index, this.now(), true);
    s.say(`${p.serial} ${p.name}`);
  }

  reset(): void {
    const s = this.store;
    const p = getPreset(s, s.presetIndex);
    if (!p) return;
    this.history.mark('RESET');
    applyPreset(s, s.presetIndex, this.now(), true);
    s.say('Reset to ' + p.serial);
  }

  saveCustom(): void {
    const s = this.store;
    const { preset, persisted } = saveCustom(snapshotSpecs(s), s.fx);
    s.custom = preset;
    s.presetIndex = CUSTOM_INDEX;
    s.modified = false;
    emit(s);
    s.say(`Saved CS-06 · ${pad(s.nodes.length)} nodes` + (persisted ? '' : ' (this session only)'));
  }

  /** Delete the saved CS-06 set. The field itself is left alone; if CS-06 was active it becomes CS-01 + MOD. */
  clearCustom(): void {
    const s = this.store;
    if (!s.custom) return;
    const ok = clearCustom();
    s.custom = null;
    if (s.presetIndex === CUSTOM_INDEX) {
      s.presetIndex = 0;
      s.modified = true;
    }
    emit(s);
    s.say(ok ? 'CS-06 cleared' : 'CS-06 cleared (storage unavailable)');
  }

  undo(): void {
    if (this.store.drag.kind !== 'none' || this.store.drawing) return;
    const label = this.history.undo();
    this.store.say(label ? `UNDO · ${label}` : 'NOTHING TO UNDO');
  }

  redo(): void {
    if (this.store.drag.kind !== 'none' || this.store.drawing) return;
    const label = this.history.redo();
    this.store.say(label ? `REDO · ${label}` : 'NOTHING TO REDO');
  }

  /** Global shortcuts: Delete/Backspace remove, ⌘/Ctrl+Z undo (⇧ redo). Text fields keep their own behaviour. */
  bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t?.closest?.('input:not([type=color]), textarea, select, [contenteditable=""], [contenteditable="true"]');
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      // An FX knob owns its keys (arrows, PageUp/Down, Home/End); the node shortcuts must not fire from it either.
      if (!mod && t?.closest?.('[data-fx-knob]')) return;
      if (mod && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }
      if (!mod && !e.altKey) {
        const k = e.key;
        if ((k === 'd' || k === 'D') && !e.repeat) {
          e.preventDefault();
          this.toggleDraw();
          return;
        }
        if (k === 'Escape' && this.store.tool === 'draw') {
          // Exit draw mode first; the usual deselect only happens on the next Esc.
          e.preventDefault();
          this.setDraw(false);
          return;
        }
        if ((k === ',' || k === '.' || k === '<' || k === '>') && this.target >= 0) {
          e.preventDefault();
          this.rotate(this.target, (k === ',' || k === '<' ? -1 : 1) * (e.shiftKey ? 45 : 15));
          return;
        }
        // Layers: ] up, [ down, ⇧] front, ⇧[ back. Matched on the physical key so layouts and Shift behave.
        if ((e.code === 'BracketRight' || e.code === 'BracketLeft') && this.target >= 0) {
          e.preventDefault();
          const up = e.code === 'BracketRight';
          this.moveLayer(this.target, e.shiftKey ? (up ? 'front' : 'back') : up ? 'up' : 'down');
          return;
        }
        // Radius: − / = (+ and the numpad too), 4 px a press, ⇧ ×4.
        const dir =
          k === '-' || k === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract' ? -1
          : k === '=' || k === '+' || e.code === 'Equal' || e.code === 'NumpadAdd' ? 1
          : 0;
        if (dir !== 0 && this.target >= 0 && this.store.drag.kind === 'none') {
          e.preventDefault();
          const px = (e.shiftKey ? 16 : 4) / this.metrics.min;
          this.resize(this.target, (r) => r + dir * px);
          return;
        }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && !e.altKey && this.target >= 0) {
        e.preventDefault();
        this.removeSelected();
      }
    });
  }
}
