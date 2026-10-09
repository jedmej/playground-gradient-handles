import type { Actions } from './actions';
import { renderOffscreen } from './exporter';
import { extractFromFile } from './extract';
import type { Metrics } from './handles';
import { copyFx, type FxState } from './fx';
import { HARMONIES, HARMONY_LABEL, makeRng, newSeed, randomSpecs, seedLabel, varyFx, varySpecs, type Harmony, type VaryAxes } from './generate';
import { makeNode, snapshotIdentified, type NodeSpec, type Store } from './store';

const TYPING = 'input:not([type=color]):not([type=checkbox]), textarea, select, [contenteditable=""], [contenteditable="true"]';
/** Mutation strength of the four thumbnails: gentle → bold. */
const STRENGTH = [0.8, 1.15, 1.5, 2];
/** Long side of a thumbnail render (px); the strip shows it at about half that. */
const THUMB = 240;
/** Which axes VARY changes (remembered per browser). */
const AXES_KEY = 'gh.vary.v1';
const AXES: Array<{ key: keyof VaryAxes; label: string }> = [
  { key: 'comp', label: 'COMPOSITION' },
  { key: 'color', label: 'COLOURS' },
  { key: 'fx', label: 'EFFECTS' },
];

function loadAxes(): VaryAxes {
  try {
    const o = JSON.parse(localStorage.getItem(AXES_KEY) ?? 'null') as Partial<VaryAxes> | null;
    if (o && typeof o === 'object') {
      const a = { comp: o.comp === true, color: o.color === true, fx: o.fx === true };
      if (a.comp || a.color || a.fx) return a;
    }
  } catch {
    // storage unavailable: defaults
  }
  return { comp: true, color: false, fx: false };
}

/** The concrete rules ANY spreads across RANDOM's four takes, so the strip shows four different harmonies. */
const ANY_SPREAD: Harmony[] = ['analog', 'compl', 'triad', 'split', 'mono'];

/**
 * Starting points and exploration: one strip over the stage with four thumbnails, in two modes. RANDOM [R]: four
 * fresh compositions under the harmony chosen by the chips in the strip head (ANY spreads four different rules).
 * VARY [V]: four takes on the current field, the axes chips choosing what may change. Plus palette extraction from an
 * image (file picker in the colour-set panel, or a drop on the stage).
 */
export class Explore {
  private strip: HTMLDivElement;
  private head: HTMLElement;
  private btns: HTMLButtonElement[] = [];
  private imgs: HTMLImageElement[] = [];
  private urls: string[] = [];
  private variants: Array<{ specs: NodeSpec[]; fx: FxState | null; rule?: Harmony; seed?: number }> = [];
  private mode: 'vary' | 'random' = 'vary';
  private axesEl!: HTMLElement;
  private harmEl!: HTMLElement;
  private harmBtns: HTMLButtonElement[] = [];
  private tags: HTMLElement[] = [];
  private axes = loadAxes();
  private axisBtns: HTMLButtonElement[] = [];
  private token = 0;
  private sig = '';
  private randomBtn = document.querySelector<HTMLButtonElement>('[data-action=randomize]')!;
  private varyBtn = document.querySelector<HTMLButtonElement>('[data-action=vary]')!;
  private dropDepth = 0;

  constructor(
    private store: Store,
    private actions: Actions,
    private stage: HTMLElement,
    private metrics: Metrics,
    private now: () => number,
  ) {
    this.randomBtn.addEventListener('click', () => (this.isOpen && this.mode === 'random' ? this.close() : void this.open('random')));
    this.varyBtn.addEventListener('click', () => (this.isOpen && this.mode === 'vary' ? this.close() : void this.open('vary')));

    // ----- VARY strip (a child of the stage, like the node menu: it hides with the rest of the furniture in PREVIEW)
    const el = document.createElement('div');
    el.className = 'vary-strip';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Variations');
    el.dataset.testid = 'vary';
    el.hidden = true;
    const top = document.createElement('div');
    top.className = 'vary-top';
    this.head = document.createElement('div');
    this.head.className = 'vary-head';
    // VARY axes: any mix of composition, colours and effects (at least one stays checked). Changing them rolls again.
    const axes = document.createElement('div');
    axes.className = 'vary-axes';
    axes.setAttribute('role', 'group');
    axes.setAttribute('aria-label', 'What to vary');
    for (const a of AXES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vary-axis';
      b.dataset.varyAxis = a.key;
      b.innerHTML = `<i aria-hidden="true"></i>${a.label}`;
      b.addEventListener('click', () => this.toggleAxis(a.key));
      axes.appendChild(b);
      this.axisBtns.push(b);
    }
    // RANDOM harmony: one rule at a time (radio chips in the same style). Changing it rolls again.
    const harm = document.createElement('div');
    harm.className = 'vary-axes';
    harm.setAttribute('role', 'radiogroup');
    harm.setAttribute('aria-label', 'Colour harmony');
    for (const h of HARMONIES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vary-axis';
      b.setAttribute('role', 'radio');
      b.dataset.harmony = h;
      b.innerHTML = `<i aria-hidden="true"></i>${HARMONY_LABEL[h]}`;
      b.addEventListener('click', () => this.setHarmony(h));
      harm.appendChild(b);
      this.harmBtns.push(b);
    }
    this.axesEl = axes;
    this.harmEl = harm;
    top.append(this.head, axes, harm);
    el.appendChild(top);
    this.syncAxes();
    this.syncHarmony();
    const row = document.createElement('div');
    row.className = 'vary-row';
    for (let k = 0; k < STRENGTH.length; k++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vary-btn is-loading';
      b.dataset.action = 'vary-pick';
      b.dataset.vary = String(k);
      b.setAttribute('aria-label', `Adopt variation ${k + 1}`);
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      const tag = document.createElement('span');
      tag.className = 'vary-serial';
      tag.textContent = `V-${k + 1}`;
      this.tags.push(tag);
      b.append(img, tag); // the serial (R-1 / V-1) doubles as the 1–4 key hint
      b.addEventListener('click', () => this.pick(k));
      row.appendChild(b);
      this.btns.push(b);
      this.imgs.push(img);
    }
    el.appendChild(row);
    this.strip = el;
    stage.appendChild(el);
    // The strip is a child of the stage: keep its gestures away from the stage's pointer handling.
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick', 'wheel', 'contextmenu']) {
      el.addEventListener(t, (e) => e.stopPropagation());
    }
    window.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (this.isOpen && !el.contains(t) && !this.varyBtn.contains(t) && !this.randomBtn.contains(t)) this.close();
    }, { capture: true });
    // Any edit (or a different document) makes the thumbnails stale: close rather than show lies.
    store.listeners.add(() => {
      if (this.isOpen && this.signature() !== this.sig) this.close();
    });

    window.addEventListener('keydown', (e) => this.onKey(e), { capture: true });
    this.bindExtract();
  }

  get isOpen(): boolean {
    return !this.strip.hidden;
  }

  // ----- RANDOM harmony --------------------------------------------------------

  private setHarmony(h: Harmony): void {
    const s = this.store;
    if (s.harmony === h) return;
    s.harmony = h;
    this.syncHarmony();
    s.say(`HARMONY · ${HARMONY_LABEL[h]}`);
    if (this.isOpen && this.mode === 'random') void this.open('random');
  }

  private syncHarmony(): void {
    for (const b of this.harmBtns) {
      const on = b.dataset.harmony === this.store.harmony;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('is-on', on);
    }
  }

  // ----- VARY -----------------------------------------------------------------

  private signature(): string {
    return JSON.stringify([
      snapshotIdentified(this.store).map((n) => [n.uid, n.x, n.y, n.r, n.hex, n.shape, n.rot, n.soft, n.opac, n.lock, n.hide, n.pts?.length]),
      this.store.fx,
    ]);
  }

  /** Flip one axis (the last checked one cannot be cleared), remember it, and roll a fresh set when open. */
  private toggleAxis(key: keyof VaryAxes): void {
    const next = { ...this.axes, [key]: !this.axes[key] };
    if (!next.comp && !next.color && !next.fx) {
      this.store.say('VARY · KEEP AT LEAST ONE');
      return;
    }
    this.axes = next;
    try {
      localStorage.setItem(AXES_KEY, JSON.stringify(next));
    } catch {
      // not remembered this time
    }
    this.syncAxes();
    if (this.isOpen) void this.open();
  }

  private syncAxes(): void {
    this.axisBtns.forEach((b, i) => {
      const on = this.axes[AXES[i].key];
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('is-on', on);
    });
  }

  private revoke(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
  }

  /**
   * Open the strip in `mode` (or roll a new set when it is already open in it) and render the four thumbnails one after
   * another. RANDOM: four fresh compositions (locked nodes kept). VARY: four takes on the current field.
   */
  async open(mode: 'vary' | 'random' = this.mode): Promise<void> {
    const s = this.store;
    if (s.drag.kind !== 'none' || s.drawing) return;
    this.sig = this.signature();
    const base = snapshotIdentified(s);
    const label = mode === 'random' ? 'RANDOM' : 'VARY';
    if (base.every((n) => n.lock)) {
      s.say(`${label} · EVERY NODE IS LOCKED`);
      return;
    }
    this.mode = mode;
    const token = ++this.token;
    const seed = newSeed();
    if (mode === 'random') {
      const aspect = this.metrics.w / Math.max(1, this.metrics.h);
      // ANY: four different concrete rules, so the strip compares harmonies; a chosen rule: four takes on it.
      const start = Math.floor(makeRng(seed)() * ANY_SPREAD.length);
      this.variants = STRENGTH.map((_, j) => {
        const rule = s.harmony === 'any' ? ANY_SPREAD[(start + j) % ANY_SPREAD.length] : s.harmony;
        const sj = (seed + j * 7919) & 0xffff;
        const specs = randomSpecs(makeRng(sj), rule, base, aspect).map((sp) => ({ ...sp, uid: undefined }));
        return { specs, fx: null, rule, seed: sj };
      });
    } else {
      const ax = this.axes;
      this.variants = STRENGTH.map((k, j) => {
        const rng = makeRng(seed + j * 7919);
        return { specs: varySpecs(rng, base, k, ax), fx: ax.fx ? varyFx(rng, s.fx, k) : null };
      });
    }
    this.axesEl.hidden = mode !== 'vary';
    this.harmEl.hidden = mode !== 'random';
    this.strip.setAttribute('aria-label', mode === 'random' ? 'Random compositions' : 'Variations');
    this.variants.forEach((v, j) => {
      this.tags[j].textContent = mode === 'random' ? `R-${j + 1} · ${HARMONY_LABEL[v.rule!]}` : `V-${j + 1}`;
      this.btns[j].setAttribute('aria-label', `Adopt ${mode === 'random' ? 'random composition' : 'variation'} ${j + 1}`);
    });
    this.revoke();
    this.head.textContent = mode === 'random'
      ? `RANDOM // 04 // SEED ${seedLabel(seed)} // 1–4 PICK · R ROLL · ESC`
      : `VARIATIONS // 04 // SEED ${seedLabel(seed)} // 1–4 PICK · V ROLL · ESC`;
    for (const b of this.btns) b.classList.add('is-loading');
    this.strip.hidden = false;
    for (const [btn, m] of [[this.varyBtn, 'vary'], [this.randomBtn, 'random']] as const) {
      btn.setAttribute('aria-pressed', String(m === mode));
      btn.classList.toggle('is-on', m === mode);
    }
    s.say(mode === 'random' ? 'RANDOM · pick a composition' : 'VARY · pick a variation');
    const m = this.metrics;
    const aspect = m.w / Math.max(1, m.h);
    const tw = aspect >= 1 ? THUMB : Math.max(16, Math.round(THUMB * aspect));
    const th = aspect >= 1 ? Math.max(16, Math.round(THUMB / aspect)) : THUMB;
    this.strip.style.setProperty('--vary-aspect', String(aspect));
    for (let j = 0; j < this.variants.length; j++) {
      // renderOffscreen reads the store's nodes (settled targets) and FX: hand it a copy carrying the variant.
      const v = this.variants[j];
      const copy: Store = { ...s, nodes: v.specs.map((sp) => makeNode(sp)), fx: v.fx ?? s.fx };
      const res = await renderOffscreen(copy, m, tw, th, s.reducedMotion ? 0.5 : this.now() / 1000);
      if (token !== this.token) return; // closed or re-rolled meanwhile
      if (!res.ok) continue;
      const url = URL.createObjectURL(res.blob);
      this.urls.push(url);
      this.imgs[j].src = url;
      this.btns[j].classList.remove('is-loading');
      if (j === 0 && this.strip.contains(document.activeElement) === false) this.btns[0].focus({ preventScroll: true });
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.token++;
    this.strip.hidden = true;
    for (const btn of [this.varyBtn, this.randomBtn]) {
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('is-on');
    }
    if (this.strip.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.revoke();
    for (const img of this.imgs) img.removeAttribute('src');
  }

  private pick(k: number): void {
    const v = this.variants[k];
    if (!v || this.btns[k].classList.contains('is-loading')) return;
    const mode = this.mode;
    this.close();
    if (mode === 'random') this.actions.adoptRandom(v.specs, `RANDOM · ${HARMONY_LABEL[v.rule!]} · SEED ${seedLabel(v.seed!)}`);
    else this.actions.adoptVariant(v.specs, k + 1, v.fx ? copyFx(v.fx) : null);
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(TYPING) || t?.closest?.('[data-fx-knob], [data-fx-ring]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.isOpen && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (this.isOpen && /^[1-4]$/.test(e.key) && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      this.pick(Number(e.key) - 1);
      return;
    }
    if (e.repeat) return;
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      void this.open('random');
    } else if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      void this.open('vary');
    }
  }

  // ----- palette extraction --------------------------------------------------------

  private bindExtract(): void {
    const btn = document.querySelector<HTMLButtonElement>('[data-action=extract]')!;
    const input = document.getElementById('extract-file') as HTMLInputElement;
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = '';
      if (f) void this.extract(f);
    });
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const inPreview = (): boolean => !!this.stage.parentElement?.classList.contains('is-preview');
    this.stage.addEventListener('dragenter', (e) => {
      if (!hasFiles(e) || inPreview()) return;
      e.preventDefault();
      this.dropDepth++;
      this.stage.classList.add('is-drop');
    });
    this.stage.addEventListener('dragover', (e) => {
      if (!hasFiles(e) || inPreview()) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    this.stage.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      this.dropDepth = Math.max(0, this.dropDepth - 1);
      if (this.dropDepth === 0) this.stage.classList.remove('is-drop');
    });
    this.stage.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      this.dropDepth = 0;
      this.stage.classList.remove('is-drop');
      if (inPreview()) return;
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f) void this.extract(f);
      else this.store.say('EXTRACT · DROP AN IMAGE FILE');
    });
    // A file dropped beside the stage must not navigate the page to it.
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
  }

  private async extract(file: File): Promise<void> {
    const s = this.store;
    const k = s.nodes.filter((n) => !n.lock).length;
    if (k === 0) {
      s.say('EXTRACT · EVERY NODE IS LOCKED');
      return;
    }
    s.say('EXTRACT · reading image…');
    try {
      const hexes = await extractFromFile(file, k);
      if (hexes.length === 0) throw new Error('no pixels');
      this.close();
      this.actions.applyExtract(hexes);
    } catch {
      s.say('EXTRACT · could not read that image');
    }
  }
}
