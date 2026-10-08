import type { Actions } from './actions';
import { downloadBlob, renderOffscreen, stamp } from './exporter';
import { FX_IDS, fxActive, fxMaxPos, fxPos, fxReadout, type FxId } from './fx';
import type { Metrics } from './handles';
import type { History } from './history';
import { Knob } from './knob';
import { currentPreset, type Store } from './store';
import { wallpaperFilename, wallpaperSize, wallpaperTarget, type WallpaperId } from './wallpaper';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

const NAMES: Record<FxId, string> = { grain: 'GRAIN', dither: 'DITHER', chroma: 'CHROMA', scan: 'SCAN', vig: 'VIG' };

/** The FX section: four spec rows of knobs and option toggles, ALL OFF, the hint and the `data-fx` hook. */
export class FxPanel {
  private knobs = new Map<FxId, Knob>();
  private reads = new Map<FxId, HTMLElement>();
  private rows = new Map<FxId, HTMLElement>();
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
    for (const b of this.opts) {
      b.addEventListener('click', () => this.actions.fxOption(b.dataset.fxOpt as Parameters<Actions['fxOption']>[0]));
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
      const spoken =
        fx[id] <= 0 ? 'off'
        : id === 'dither' ? `${fx.dither} levels, ${fx.ditherMode}`
        : id === 'grain' ? `${fx.grain}, ${fx.grainSize}`
        : String(fx[id]);
      this.knobs.get(id)!.render(fxPos(id, fx[id]), fx[id], spoken);
      const read = this.reads.get(id)!;
      setText(read, text);
      read.classList.toggle('dim', fx[id] <= 0);
      // Option toggles stay clickable while their effect is off, just quieter.
      this.rows.get(id)!.classList.toggle('is-off', fx[id] <= 0);
    }
    for (const b of this.opts) {
      const on =
        b.dataset.fxOpt === `grain-${fx.grainSize}` || b.dataset.fxOpt === `dither-${fx.ditherMode}`;
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
  private btn = document.querySelector<HTMLButtonElement>('[data-action="export-wallpaper"]')!;
  private label = this.btn.querySelector<HTMLElement>('.btn-label')!;
  private count = 0;
  private lastWp: WallpaperId | null = null;

  constructor(
    private store: Store,
    private metrics: Metrics,
    private now: () => number,
  ) {
    for (const c of this.cells) {
      const t = wallpaperTarget(c.dataset.wp as WallpaperId);
      const glyph = c.querySelector<HTMLElement>('.wp-glyph');
      if (glyph) glyph.style.width = `${Math.round((14 * t.w) / t.h)}px`;
      c.addEventListener('click', () => {
        this.store.wallpaper = t.id;
        this.sync();
      });
      c.addEventListener('keydown', (e) => this.onRadioKey(e, c));
    }
    this.btn.addEventListener('click', () => void this.export());
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

  sync(): void {
    const wp = this.store.wallpaper;
    if (wp === this.lastWp) return;
    this.lastWp = wp;
    for (const c of this.cells) {
      const on = c.dataset.wp === wp;
      c.setAttribute('aria-checked', String(on));
      c.tabIndex = on ? 0 : -1;
    }
    setText(this.dims, wallpaperSize(wallpaperTarget(wp)));
  }

  private say(text: string): void {
    this.store.say(text);
  }

  private async export(): Promise<void> {
    if (this.btn.disabled) return;
    const s = this.store;
    const t = wallpaperTarget(s.wallpaper);
    const size = wallpaperSize(t);
    this.btn.disabled = true;
    setText(this.label, 'Rendering…');
    try {
      // Let the "Rendering…" label paint before the (synchronous) GPU work starts.
      await new Promise<void>((res) => requestAnimationFrame(() => setTimeout(res, 0)));
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
        setText(this.label, 'Export wallpaper');
        this.btn.classList.remove('is-done');
        this.btn.disabled = false;
      }, 1800);
    }
  }
}
