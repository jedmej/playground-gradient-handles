import { clearCustom, saveCustom } from './custom';
import type { History } from './history';
import type { Metrics } from './handles';
import {
  addNode,
  applyPreset,
  CUSTOM_INDEX,
  DEFAULT_RADIUS,
  emit,
  fieldHexAt,
  getPreset,
  MAX_NODES,
  MIN_NODES,
  nodeSerial,
  removeNodeAt,
  snapshotSpecs,
  tweenNodeTo,
  type Store,
} from './store';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Every user edit goes through here, so history, status and index hygiene live in one place. */
export class Actions {
  private lastNudge = -Infinity;

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
    const { preset, persisted } = saveCustom(snapshotSpecs(s));
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
    if (this.store.drag.kind !== 'none') return;
    const label = this.history.undo();
    this.store.say(label ? `UNDO · ${label}` : 'NOTHING TO UNDO');
  }

  redo(): void {
    if (this.store.drag.kind !== 'none') return;
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && !e.altKey && this.target >= 0) {
        e.preventDefault();
        this.removeSelected();
      }
    });
  }
}
