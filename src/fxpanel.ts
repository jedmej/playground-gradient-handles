import type { Actions } from './actions';
import { downloadBlob, renderOffscreen, stamp } from './exporter';
import { FX_IDS, fxActive, fxMaxPos, fxOptOn, fxPos, fxReadout, fxSpoken, type FxId, type FxOpt } from './fx';
import type { Metrics } from './handles';
import type { History } from './history';
import { Knob } from './knob';
import { currentPreset, type Store } from './store';
import { clampSide, CUSTOM_MAX, CUSTOM_MIN, DEFAULT_CUSTOM, wallpaperFilename, wallpaperSize, wallpaperTarget, type WallpaperId } from './wallpaper';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

const NAMES = Object.fromEntries(FX_IDS.map((id) => [id, id.toUpperCase()])) as Record<FxId, string>;

/** The FX section: twelve spec rows of knobs and option toggles, ALL OFF, the hint and the `data-fx` hook. */
export class FxPanel {
  private knobs = new Map<FxId, Knob>();
  private reads = new Map<FxId, HTMLElement>();
  private rows = new Map<FxId, HTMLElement>();
  private checks = new Map<FxId, HTMLInputElement>();
  private opts = [...document.querySelectorAll<HTMLButtonElement>('[data-fx-opt]')];
  private offBtn = document.querySelector<HTMLButtonElement>('[data-action="fx-off"]')!;
  private hint = $('fx-hint');
  private lastKey = '';

  constructor(
    private store: Store,
    private actions: Actions,
    private history: History,
  ) {
    for (const id of FX_IDS) {
      const root = document.querySelector<HTMLElement>(`[data-fx-knob="${id}"]`)!;
      this.reads.set(id, document.querySelector<HTMLElement>(`[data-fx-read="${id}"]`)!);
      this.rows.set(id, root.closest<HTMLElement>('.fx-row')!);
      const max = fxMaxPos(id);
      this.knobs.set(
        id,
        new Knob(root, max, {
          drag: (phase, pos) => {
            if (phase === 'start') this.history.begin();
            else if (phase === 'move') this.actions.fxSetPos(id, pos as number);
            else this.history.commit(`FX ${NAMES[id]}`);
          },
          goto: (pos) => this.actions.fxGoto(id, pos),
          toggle: () => this.actions.fxToggle(id),
        }),
      );
    }
    for (const id of FX_IDS) {
      const cb = document.querySelector<HTMLInputElement>(`[data-fx-check="${id}"]`)!;
      this.checks.set(id, cb);
      // One toggle = one undo step; sync() snaps `checked` back to the store either way.
      cb.addEventListener('change', () => {
        if (cb.checked !== this.store.fx[id] > 0) this.actions.fxToggle(id);
      });
    }
    for (const b of this.opts) {
      b.addEventListener('click', () => this.actions.fxOption(b.dataset.fxOpt as FxOpt));
    }
    this.offBtn.addEventListener('click', () => this.actions.fxOff());
    actions.fxListeners.add(() => this.sync());
    store.listeners.add(() => this.sync());
    this.sync();
  }

  sync(): void {
    const fx = this.store.fx;
    const key = JSON.stringify(fx);
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (const id of FX_IDS) {
      const text = fxReadout(id, fx);
      const spoken = fxSpoken(id, fx);
      this.knobs.get(id)!.render(fxPos(id, fx[id]), fx[id], spoken);
      const read = this.reads.get(id)!;
      setText(read, text);
      read.classList.toggle('dim', fx[id] <= 0);
      this.checks.get(id)!.checked = fx[id] > 0;
      // Option toggles stay clickable while their effect is off, just quieter.
      this.rows.get(id)!.classList.toggle('is-off', fx[id] <= 0);
    }
    for (const b of this.opts) {
      const on = fxOptOn(b.dataset.fxOpt as FxOpt, fx);
      b.setAttribute('aria-checked', String(on));
    }
    const active = fxActive(fx);
    setText(this.hint, active.length ? `— ${active.length} ON` : '— ALL OFF');
    this.offBtn.disabled = active.length === 0;
    const flag = active.join(',');
    const root = document.documentElement;
    if (root.dataset.fx !== flag) root.dataset.fx = document.body.dataset.fx = flag;
  }
}

/** The WALLPAPER section: target radios + the export button. Selecting a target is not an undo step. */
export class WallpaperPanel {
  private cells = [...document.querySelectorAll<HTMLButtonElement>('[data-wp]')];
  private dims = $('wp-dims');
  private btn = document.querySelector<HTMLButtonElement>('[data-action="export"]')!;
  private label = this.btn.querySelector<HTMLElement>('.btn-label')!;
  private count = 0;
  private customSeeded: boolean;
  private customRow = $('wp-custom');
  private wIn = $('wp-w') as HTMLInputElement;
  private hIn = $('wp-h') as HTMLInputElement;
  private range = $('wp-range');
  private lastKey = '';

  constructor(
    private store: Store,
    private metrics: Metrics,
    private now: () => number,
  ) {
    // Seeded = a custom size already exists (selected, or differs from the default); else seed from the current preset.
    this.customSeeded = store.wallpaper === 'custom' || store.wpCustom.w !== DEFAULT_CUSTOM.w || store.wpCustom.h !== DEFAULT_CUSTOM.h;
    for (const c of this.cells) {
      const t = wallpaperTarget(c.dataset.wp as WallpaperId, this.store.wpCustom);
      const glyph = c.querySelector<HTMLElement>('.wp-glyph');
      if (glyph) glyph.style.width = `${Math.round((14 * t.w) / t.h)}px`;
      c.addEventListener('click', () => {
        if (t.id === 'custom' && this.store.wallpaper !== 'custom' && !this.customSeeded) {
          // First time: start from the preset that was selected.
          const cur = wallpaperTarget(this.store.wallpaper, this.store.wpCustom);
          this.store.wpCustom = { w: cur.w, h: cur.h };
        }
        this.customSeeded = true;
        this.store.wallpaper = t.id;
        this.sync();
      });
      c.addEventListener('keydown', (e) => this.onRadioKey(e, c));
    }
    for (const el of [this.wIn, this.hIn]) {
      el.addEventListener('input', () => {
        el.value = el.value.replace(/\D/g, '');
        el.classList.toggle('is-bad', !this.valid(el.value));
        this.range.classList.toggle('is-bad', !this.valid(this.wIn.value) || !this.valid(this.hIn.value));
      });
      el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          this.commitCustom();
          el.blur();
        } else if (e.key === 'Escape') {
          this.lastKey = '';
          this.sync();
          el.blur();
        }
      });
      el.addEventListener('blur', () => this.commitCustom());
      el.addEventListener('focus', () => el.select());
    }
    $('wp-swap').addEventListener('click', () => {
      this.commitCustom();
      const c = this.store.wpCustom;
      this.store.wpCustom = { w: c.h, h: c.w };
      this.sync();
    });
    // One EXPORT button: a plain click renders the wallpaper target here; ⇧-click is the quick 2048 px copy (ui.ts).
    this.btn.addEventListener('click', (e) => {
      if (!e.shiftKey) void this.export();
    });
    store.listeners.add(() => this.sync());
    this.sync();
  }

  /** Radiogroup arrows: move and select, like a native radio set. */
  private onRadioKey(e: KeyboardEvent, from: HTMLButtonElement): void {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const i = (this.cells.indexOf(from) + dir + this.cells.length) % this.cells.length;
    this.cells[i].focus();
    this.cells[i].click();
  }

  private valid(v: string): boolean {
    const n = Number(v);
    return v !== '' && Number.isInteger(n) && n >= CUSTOM_MIN && n <= CUSTOM_MAX;
  }

  /** Enter / blur: clamp to 16..16384 (empty keeps the old side), store, and let tick() re-fit the artboard. */
  private commitCustom(): void {
    const c = this.store.wpCustom;
    const w = clampSide(parseInt(this.wIn.value, 10), c.w);
    const h = clampSide(parseInt(this.hIn.value, 10), c.h);
    if (w !== c.w || h !== c.h) this.store.wpCustom = { w, h };
    this.lastKey = '';
    this.sync();
  }

  sync(): void {
    const wp = this.store.wallpaper;
    const c = this.store.wpCustom;
    const key = `${wp}|${c.w}|${c.h}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (const el of this.cells) {
      const on = el.dataset.wp === wp;
      el.setAttribute('aria-checked', String(on));
      el.tabIndex = on ? 0 : -1;
    }
    const g = this.cells.find((e) => e.dataset.wp === 'custom')?.querySelector<HTMLElement>('.wp-glyph');
    if (g) g.style.width = `${Math.round(Math.min(26, Math.max(5, (14 * c.w) / c.h)))}px`;
    this.customRow.hidden = wp !== 'custom';
    if (document.activeElement !== this.wIn) this.wIn.value = String(c.w);
    if (document.activeElement !== this.hIn) this.hIn.value = String(c.h);
    this.wIn.classList.remove('is-bad');
    this.hIn.classList.remove('is-bad');
    this.range.classList.remove('is-bad');
    const size = wallpaperSize(wallpaperTarget(wp, c));
    setText(this.dims, size);
    this.btn.title = `Export ${size} PNG (E; ⇧ for a quick 2048 px copy)`;
  }

  private say(text: string): void {
    this.store.say(text);
  }

  private async export(): Promise<void> {
    if (this.btn.disabled) return;
    const s = this.store;
    const t = wallpaperTarget(s.wallpaper, s.wpCustom);
    const size = wallpaperSize(t);
    this.btn.disabled = true;
    setText(this.label, 'Rendering…');
    try {
      // Let the "Rendering…" label paint before the (synchronous) GPU work starts.
      // (rAF never fires in a hidden tab, so a timer races it: the button must never hang on "Rendering…".)
      await new Promise<void>((res) => {
        const t = window.setTimeout(res, 120);
        requestAnimationFrame(() => setTimeout(() => (window.clearTimeout(t), res()), 0));
      });
      const res = await renderOffscreen(s, this.metrics, t.w, t.h, s.reducedMotion ? 0.5 : this.now() / 1000);
      if (res.ok) {
        const name = wallpaperFilename(currentPreset(s).serial.replace('-', ''), t, stamp(), ++this.count);
        downloadBlob(res.blob, name);
        this.btn.classList.add('is-done');
        setText(this.label, 'Exported');
        this.say(`Exported ${name} · ${size}`);
      } else if (res.reason === 'limit') {
        setText(this.label, 'Too large');
        this.say(`WALLPAPER ${size} IS TOO LARGE FOR THIS GPU (MAX ${res.max} PX). PICK A SMALLER TARGET.`);
      } else if (res.reason === 'context') {
        setText(this.label, 'Too large');
        this.say(`WEBGL COULD NOT ALLOCATE ${size}. PICK A SMALLER TARGET.`);
      } else {
        setText(this.label, 'Export failed');
        this.say('Export failed. Your browser blocked the canvas or the download.');
      }
    } catch {
      setText(this.label, 'Export failed');
      this.say('Export failed. Your browser blocked the canvas or the download.');
    } finally {
      window.setTimeout(() => {
        setText(this.label, 'Export');
        this.btn.classList.remove('is-done');
        this.btn.disabled = false;
      }, 1500);
    }
  }
}
