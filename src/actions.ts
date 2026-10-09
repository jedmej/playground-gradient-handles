import { library, type Doc } from './custom';
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
  reconcile,
  snapshotIdentified,
  type NodeSpec,
  PAPER_HEX,
  R_MAX,
  R_MIN,
  removeNodeAt,
  SLOT_COUNT,
  slotSerial,
  snapshotSpecs,
  tweenNodeTo,
  type LayerMove,
  type Shape,
  type Store,
} from './store';
import { fieldHexAt } from './field';
import { addGroup, mirrorSpots, pairNodes, tools } from './tools';
import { copyFx, FX_IDS, fxActive, fxFromPos, fxMaxPos, fxOptId, fxPos, fxStatus, fxWithOption, onValue, rememberFx, sameFx, type FxId, type FxOpt, type FxState } from './fx';
import { HARMONY_LABEL, makeRng, newSeed, randomSpecs, seedLabel } from './generate';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Every user edit goes through here, so history, status and index hygiene live in one place. */
export class Actions {
  private lastNudge = -Infinity;
  private lastRot = -Infinity;
  private lastOpac = -Infinity;
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

  /** `mirror`: with symmetry on (tools.ts), also drop the partner node(s); one undo step, MAX_NODES respected. */
  addAt(nx: number, ny: number, mirror = false): boolean {
    const s = this.store;
    if (s.nodes.length >= MAX_NODES) {
      s.say(`NODE LIMIT ${MAX_NODES}`);
      return false;
    }
    const x = Math.min(1, Math.max(0, nx));
    const y = Math.min(1, Math.max(0, ny));
    const hex = fieldHexAt(s, x, y, this.metrics);
    const spots = mirror ? mirrorSpots(x, y).slice(0, MAX_NODES - s.nodes.length - 1) : [];
    const partnerHex = spots.map((p) => fieldHexAt(s, p.x, p.y, this.metrics));
    this.history.mark('ADD NODE');
    const i = addNode(s, { x, y, r: DEFAULT_RADIUS, hex });
    if (spots.length) {
      const group = [{ uid: s.nodes[i].uid, fx: false, fy: false }];
      spots.forEach((p, k) => {
        const j = addNode(s, { x: p.x, y: p.y, r: DEFAULT_RADIUS, hex: partnerHex[k] });
        group.push({ uid: s.nodes[j].uid, fx: p.fx, fy: p.fy });
      });
      addGroup(group);
    }
    s.selected = i;
    s.armed = i;
    s.hover = { kind: 'idle', index: -1 };
    emit(s);
    s.say(`Added ${nodeSerial(i)}${spots.length ? ` + ${spots.length} MIRROR` : ''} · ${pad(s.nodes.length)} nodes`);
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

  /** Is node `i` locked? Says so on the status line, so every guarded edit explains why nothing happened. */
  isLocked(i: number): boolean {
    const n = this.store.nodes[i];
    if (!n?.lock) return false;
    this.store.say(`${nodeSerial(i)} · LOCKED · L to unlock`);
    return true;
  }

  /** Open an undo step for a colour-editing session (call once per session, before the first change). */
  beginColor(i: number): void {
    this.history.mark(`COLOUR ${nodeSerial(i)}`);
  }

  setColor(i: number, hex: string): void {
    const s = this.store;
    const n = s.nodes[i];
    if (!n || n.hex === hex || this.isLocked(i)) return;
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
    if (!n || this.isLocked(i)) return;
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
    if (!n || this.isLocked(i)) return;
    const t = this.now();
    if (t - this.lastSoft > 700) this.history.mark(`SOFT ${nodeSerial(i)}`);
    this.lastSoft = t;
    n.soft = Math.min(1, Math.max(0, Math.round((n.soft + delta) * 1e4) / 1e4));
    s.modified = true;
    emit(s);
  }

  /** Opacity from wheel / buttons: `delta` is added and clamped to 0–1. Bursts coalesce into one `OPAC` step. */
  opacBy(i: number, delta: number): void {
    const s = this.store;
    const n = s.nodes[i];
    if (!n || this.isLocked(i)) return;
    const t = this.now();
    if (t - this.lastOpac > 700) this.history.mark(`OPAC ${nodeSerial(i)}`);
    this.lastOpac = t;
    n.opac = Math.min(1, Math.max(0, Math.round((n.opac + delta) * 1e4) / 1e4));
    s.modified = true;
    emit(s);
  }

  private lastColorBurst = -Infinity;

  /** Wheel burst on a COLOUR-page gauge: one undo step (`HUE N-02`, `SAT …`, `LUM …`) per burst. Call before mutating. */
  colorBurst(i: number, axis: string): void {
    const t = this.now();
    if (t - this.lastColorBurst > 700) this.history.mark(`${axis.toUpperCase()} ${nodeSerial(i)}`);
    this.lastColorBurst = t;
    this.store.modified = true;
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

  /** Double-click / double-tap / the FX checkbox: OFF ↔ last non-zero value (or the on-value). */
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

  fxOption(opt: FxOpt): void {
    const s = this.store;
    const next = fxWithOption(s.fx, opt);
    if (sameFx(next, s.fx)) return;
    const id = fxOptId(opt);
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
    // Every amount goes to 0 (WARP back to the house look); the option choices stay.
    const next = copyFx(s.fx);
    for (const id of FX_IDS) next[id] = 0;
    s.fx = next;
    this.fxChanged(null);
    s.say('FX OFF');
  }


  // ----- GENERATE: lock / hide / solo, RANDOM, VARY, EXTRACT ------------------------------

  private soloPrev: Map<number, boolean> | null = null;

  /** LOCK ↔ UNLOCK node `i`: it stays selectable but no edit, RANDOM, VARY or EXTRACT touches it. One undo step. */
  toggleLock(i: number): void {
    const s = this.store;
    const n = s.nodes[i];
    if (!n || s.drag.kind !== 'none' || s.drawing) return;
    const serial = nodeSerial(i);
    this.history.mark(`${n.lock ? 'UNLOCK' : 'LOCK'} ${serial}`);
    n.lock = !n.lock;
    s.modified = true;
    emit(s);
    s.say(`${serial} · ${n.lock ? 'LOCKED' : 'UNLOCKED'}`);
  }

  private visibleCount(): number {
    return this.store.nodes.filter((n) => !n.hide).length;
  }

  /** HIDE ↔ SHOW node `i`: hidden nodes leave the field (and the export); the last visible node cannot be hidden. */
  toggleHide(i: number): void {
    const s = this.store;
    const n = s.nodes[i];
    if (!n || s.drag.kind !== 'none' || s.drawing) return;
    const serial = nodeSerial(i);
    if (!n.hide && this.visibleCount() <= 1) {
      s.say('KEEP ONE NODE VISIBLE');
      return;
    }
    this.history.mark(`${n.hide ? 'SHOW' : 'HIDE'} ${serial}`);
    n.hide = !n.hide;
    s.modified = true;
    emit(s);
    s.say(`${serial} · ${n.hide ? 'HIDDEN' : 'SHOWN'}`);
  }

  /** Is node `i` the only visible one? */
  isSolo(i: number): boolean {
    const nodes = this.store.nodes;
    return nodes.length > 1 && !!nodes[i] && !nodes[i].hide && nodes.every((n, k) => k === i || n.hide);
  }

  /** SOLO node `i` (hide every other node); again to bring back what was hidden before. One undo step. */
  solo(i: number): void {
    const s = this.store;
    const n = s.nodes[i];
    if (!n || s.nodes.length < 2 || s.drag.kind !== 'none' || s.drawing) return;
    const serial = nodeSerial(i);
    if (this.isSolo(i)) {
      this.history.mark(`UNSOLO ${serial}`);
      const prev = this.soloPrev;
      for (const m of s.nodes) m.hide = prev?.get(m.uid) ?? false;
      this.soloPrev = null;
      s.modified = true;
      emit(s);
      s.say(`${serial} · SOLO OFF`);
      return;
    }
    this.history.mark(`SOLO ${serial}`);
    this.soloPrev = new Map(s.nodes.map((m) => [m.uid, m.hide]));
    s.nodes.forEach((m, k) => (m.hide = k !== i));
    s.modified = true;
    emit(s);
    s.say(`${serial} · SOLO`);
  }

  /** Glide the live nodes to `specs` (index-matched, colours tween ~600 ms like a preset switch). One undo step. */
  private adopt(label: string, specs: NodeSpec[]): void {
    const s = this.store;
    this.history.mark(label);
    reconcile(s, specs, this.now(), true, 600);
    s.modified = true;
    if (tools.mirror !== 'off') pairNodes(s, this.metrics); // new layout: pair again
    emit(s);
  }

  /** RANDOM [R]: a new composition under the chosen harmony rule. Locked nodes stay as they are. */
  randomize(): void {
    const s = this.store;
    if (s.drag.kind !== 'none' || s.drawing) return;
    const seed = newSeed();
    const aspect = this.metrics.w / Math.max(1, this.metrics.h);
    const specs = randomSpecs(makeRng(seed), s.harmony, snapshotIdentified(s), aspect);
    this.adopt('RANDOM', specs.map((sp) => ({ ...sp, uid: undefined })));
    s.say(`RANDOM · ${HARMONY_LABEL[s.harmony]} · SEED ${seedLabel(seed)}`);
  }

  /** Adopt one VARY thumbnail's specs (identified, so every node keeps its identity). One undo step `VARY`. */
  adoptVariant(specs: NodeSpec[], n: number, fx: FxState | null = null): void {
    const s = this.store;
    if (s.drag.kind !== 'none' || s.drawing) return;
    // FX first, so the one `VARY` undo step (marked in adopt) covers both. The mark snapshots before either change.
    this.history.mark('VARY');
    if (fx) s.fx = copyFx(fx);
    reconcile(s, specs, this.now(), true, 600);
    s.modified = true;
    if (tools.mirror !== 'off') pairNodes(s, this.metrics);
    emit(s);
    if (fx) this.fxChanged(null);
    s.say(`VARY · V-${n}`);
  }

  /** EXTRACT: recolour every unlocked node from `hexes` (dark → light, assigned top → bottom). One undo step. */
  applyExtract(hexes: string[]): void {
    const s = this.store;
    const free = s.nodes.map((_, i) => i).filter((i) => !s.nodes[i].lock);
    if (free.length === 0) {
      s.say('EXTRACT · EVERY NODE IS LOCKED');
      return;
    }
    if (hexes.length === 0) return;
    // Lightest at the top of the stage: node order by y (then x) takes the colours light → dark.
    const order = [...free].sort((a, b) => s.nodes[a].y - s.nodes[b].y || s.nodes[a].x - s.nodes[b].x);
    const light = [...hexes].reverse();
    this.history.mark('EXTRACT');
    const t = this.now();
    order.forEach((ni, k) => tweenNodeTo(s, s.nodes[ni], light[k % light.length], t, 600));
    s.modified = true;
    emit(s);
    s.say(`EXTRACT · ${pad(order.length)} COLOURS`);
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
    if (!n || n.shape === 'stroke' || shape === 'stroke' || n.shape === shape || this.isLocked(i)) return;
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
    if (!n || n.shape === 'circle' || n.shape === 'stroke' || this.isLocked(i)) return;
    const t = this.now();
    if (t - this.lastRot > 700) this.history.mark(`ROT ${nodeSerial(i)}`);
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
      s.say(`${slotSerial(Math.max(0, index - CUSTOM_INDEX))} is empty — press ↧ to save into it`);
      return;
    }
    this.history.mark(`PRESET ${p.serial}`);
    applyPreset(s, index, this.now(), true);
    if (tools.mirror !== 'off') pairNodes(s, this.metrics); // new layout: pair again
    s.say(`${p.serial} ${p.name}`);
  }

  reset(): void {
    const s = this.store;
    const p = getPreset(s, s.presetIndex);
    if (!p) return;
    this.history.mark('RESET');
    applyPreset(s, s.presetIndex, this.now(), true);
    if (tools.mirror !== 'off') pairNodes(s, this.metrics);
    s.say('Reset to ' + p.serial);
  }

  /** The slot SAVE targets: the active one, else the first empty one, else -1 (library full). */
  saveTarget(): number {
    const s = this.store;
    if (s.presetIndex >= CUSTOM_INDEX) return s.presetIndex - CUSTOM_INDEX;
    return s.slots.findIndex((p) => !p);
  }

  /** Store the field in slot `i` (default: `saveTarget()`). Returns the slot written, or -1. */
  saveCustom(i = this.saveTarget()): number {
    const s = this.store;
    if (i < 0 || i >= SLOT_COUNT) {
      s.say('LIBRARY FULL — pick a slot to overwrite (↧)');
      return -1;
    }
    const { preset, persisted } = library.save(i, snapshotSpecs(s), s.fx);
    s.slots[i] = preset;
    if (i === 0) s.custom = preset;
    s.presetIndex = CUSTOM_INDEX + i;
    s.modified = false;
    emit(s);
    s.say(`Saved ${slotSerial(i)} · ${pad(s.nodes.length)} nodes` + (persisted ? '' : ' (this session only: storage full or blocked)'));
    return i;
  }

  /** Delete the saved set in slot `i` (default: the active slot). The field itself is left alone; if it was active it becomes CS-01 + MOD. */
  clearCustom(i = this.store.presetIndex - CUSTOM_INDEX): void {
    const s = this.store;
    if (i < 0 || i >= SLOT_COUNT || !s.slots[i]) return;
    const ok = library.clear(i);
    s.slots[i] = null;
    if (i === 0) s.custom = null;
    if (s.presetIndex === CUSTOM_INDEX + i) {
      s.presetIndex = 0;
      s.modified = true;
    }
    emit(s);
    s.say(ok ? `${slotSerial(i)} cleared` : `${slotSerial(i)} cleared (storage unavailable)`);
  }

  /** Load a parsed document (share link): one undo step. Wallpaper target is not undoable, like the panel's. */
  applyDoc(doc: Doc, label: string): void {
    const s = this.store;
    this.history.mark(label);
    if (doc.fx) {
      s.fx = copyFx(doc.fx);
      rememberFx(s.fx);
    }
    if (doc.wp) s.wallpaper = doc.wp;
    if (doc.cs) s.wpCustom = { ...doc.cs };
    s.selected = s.focused = s.armed = null;
    reconcile(s, doc.nodes, this.now(), true, 320);
    s.modified = true;
    if (tools.mirror !== 'off') pairNodes(s, this.metrics); // new layout: pair again
    emit(s);
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
      const typing = !!t?.closest?.('input:not([type=color]):not([type=checkbox]), textarea, select, [contenteditable=""], [contenteditable="true"]');
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      // An FX knob owns its keys (arrows, PageUp/Down, Home/End); the node shortcuts must not fire from it either.
      if (!mod && t?.closest?.('[data-fx-knob], [data-fx-ring]')) return;
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
        if ((k === 'l' || k === 'L') && !e.repeat && !e.shiftKey && this.target >= 0) {
          e.preventDefault();
          this.toggleLock(this.target);
          return;
        }
        if ((k === 'h' || k === 'H') && !e.repeat && this.target >= 0) {
          e.preventDefault();
          if (e.shiftKey) this.solo(this.target);
          else this.toggleHide(this.target);
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
