import type { Actions } from './actions';
import { library } from './custom';
import { quickSize, renderOffscreen } from './exporter';
import { extractFromFile } from './extract';
import type { Metrics } from './handles';
import { copyFx, type FxState } from './fx';
import { HARMONIES, HARMONY_LABEL, makeRng, newSeed, randomSpecs, seedLabel, varyFx, varySpecs, type Harmony, type VaryAxes } from './generate';
import { emit, makeNode, snapshotIdentified, type NodeSpec, type Store } from './store';

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

const VIEW_KEY = 'gh.vary.view.v1';
/** VIEW is on unless the user has switched it off (remembered). */
function loadView(): boolean {
  try {
    return localStorage.getItem(VIEW_KEY) !== '0';
  } catch {
    return true;
  }
}

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
  /**
   * The last set shown per mode, kept while the strip is closed so reopening (hover or click) shows the same four;
   * only an explicit roll (ROLL button, R / V while open, a chip change) or an edit of the field replaces it.
   */
  private cache: Record<'vary' | 'random', { variants: Explore['variants']; srcs: (string | null)[]; seed: number; sig: string } | null> = {
    vary: null,
    random: null,
  };
  private rollBtn!: HTMLButtonElement;
  /** VIEW: while on, hovering a thumbnail shows that take full size over the artboard (`full`), until hover away. */
  private viewBtn!: HTMLButtonElement;
  private viewOn = loadView();
  private full!: HTMLImageElement;
  /** Full-size render per take (keyed by the take itself) and the stage size it was made for. */
  private fullCache = new WeakMap<object, { size: string; url: string }>();
  private fullToken = 0;
  private fullHideTimer = 0;
  private variants: Array<{ specs: NodeSpec[]; fx: FxState | null; rule?: Harmony; seed?: number }> = [];
  private mode: 'vary' | 'random' = 'vary';
  private axesEl!: HTMLElement;
  private harmEl!: HTMLElement;
  private harmBtns: HTMLButtonElement[] = [];
  private tags: HTMLElement[] = [];
  private lockBtns: HTMLButtonElement[] = [];
  private saveBtns: HTMLButtonElement[] = [];
  /** Takes already saved to the library (their SAVE chip stays lit). */
  private saved = new WeakSet<object>();
  /**
   * Thumbnails the user locked (padlock, top-right), per mode: a locked take survives every roll, chip change and
   * reopen, keeping its slot and its rendered image, until it is unlocked.
   */
  private kept: Record<'vary' | 'random', Array<{ v: Explore['variants'][number]; url: string } | null>> = {
    vary: [null, null, null, null],
    random: [null, null, null, null],
  };
  private axes = loadAxes();
  private axisBtns: HTMLButtonElement[] = [];
  private token = 0;
  private sig = '';
  private randomBtn = document.querySelector<HTMLButtonElement>('[data-action=randomize]')!;
  private varyBtn = document.querySelector<HTMLButtonElement>('[data-action=vary]')!;
  private dropDepth = 0;
  /** Opened by a click / key (stays until dismissed) rather than a hover peek. */
  private pinned = false;
  private peekTimer = 0;

  constructor(
    private store: Store,
    private actions: Actions,
    private stage: HTMLElement,
    private metrics: Metrics,
    private now: () => number,
  ) {
    // Hover peeks the strip (it goes again once the pointer has left both the button and the strip); a click pins it
    // until a click off it, Esc or a second click on the same button. R / V open it pinned.
    for (const [btn, mode] of [[this.randomBtn, 'random'], [this.varyBtn, 'vary']] as const) {
      btn.addEventListener('click', () => {
        if (this.isOpen && this.mode === mode && this.pinned) this.close();
        else this.pin(mode);
      });
      btn.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse' || (this.pinned && this.isOpen)) return;
        window.clearTimeout(this.peekTimer);
        if (!this.isOpen || this.mode !== mode) void this.open(mode);
      });
      btn.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse') this.schedulePeekClose();
      });
    }

    // ----- VARY strip (a child of the stage, like the node menu: it hides with the rest of the furniture in PREVIEW)
    const el = document.createElement('div');
    el.className = 'vary-strip';
    el.dataset.stageUi = ''; // a panel over the artboard: its events never reach the board (FX dial, eyedropper)
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Variations');
    el.dataset.testid = 'vary';
    el.hidden = true;
    const top = document.createElement('div');
    top.className = 'vary-top';
    const headRow = document.createElement('div');
    headRow.className = 'vary-headrow';
    this.head = document.createElement('div');
    this.head.className = 'vary-head';
    // ROLL: a new set of four (locked takes stay). Same as R / V while the strip is open.
    this.rollBtn = document.createElement('button');
    this.rollBtn.type = 'button';
    this.rollBtn.className = 'mini vary-roll';
    this.rollBtn.dataset.action = 'vary-roll';
    this.rollBtn.innerHTML = '<span class="mini-l">ROLL</span> <b>[R]</b>';
    this.rollBtn.addEventListener('click', () => {
      this.pinned = true;
      void this.open(this.mode, true);
    });
    // VIEW [◉]: an eye toggle beside ROLL; on, a hovered thumbnail fills the artboard as a preview.
    this.viewBtn = document.createElement('button');
    this.viewBtn.type = 'button';
    this.viewBtn.className = 'mini vary-view';
    this.viewBtn.dataset.action = 'vary-view';
    this.viewBtn.title = 'View: hover a take to see it full size on the artboard';
    this.viewBtn.innerHTML =
      '<svg viewBox="0 0 14 10" width="14" height="10" aria-hidden="true"><path class="eye-lid" d="M1 5L4 1.5H10L13 5L10 8.5H4Z"/>' +
      '<rect class="eye-pupil" x="5.5" y="3.5" width="3" height="3"/></svg><span class="mini-l">VIEW</span>';
    this.viewBtn.addEventListener('click', () => {
      this.pinned = true;
      this.viewOn = !this.viewOn;
      try {
        localStorage.setItem(VIEW_KEY, this.viewOn ? '1' : '0');
      } catch {
        // not remembered
      }
      this.syncView();
      if (!this.viewOn) this.hideFull();
    });
    headRow.append(this.head, this.viewBtn, this.rollBtn);
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
    top.append(headRow, axes, harm);
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
      b.addEventListener('pointerenter', () => void this.showFull(k));
      b.addEventListener('pointerleave', () => this.hideFull(true));
      b.addEventListener('focus', () => void this.showFull(k));
      b.addEventListener('blur', () => this.hideFull(true));
      // Padlock over the thumbnail's top-right corner (a sibling, not inside the pick button).
      const lock = document.createElement('button');
      lock.type = 'button';
      lock.className = 'vary-lock';
      lock.dataset.varyLock = String(k);
      lock.setAttribute('aria-pressed', 'false');
      lock.setAttribute('aria-label', `Keep take ${k + 1} across rolls`);
      lock.title = 'Lock: keep this take when rolling again';
      // Square-cut padlock in the spec-sheet line: open shackle (raised, right leg clear of the body) by default,
      // closed when locked. Outlined body with a keyhole slot; CSS swaps open / closed and fills it when locked.
      lock.innerHTML =
        '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">' +
        '<path class="lk-open" d="M3.5 6V2H8.5V3.5"/><path class="lk-shut" d="M3.5 6V3H8.5V6"/>' +
        '<rect class="lk-bd" x="2" y="6" width="8" height="5"/><rect class="lk-key" x="5.5" y="7.6" width="1" height="1.8"/></svg>';
      lock.addEventListener('click', () => this.toggleKeep(k));
      // SAVE (top-left): straight into the first empty library slot, without adopting the take.
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'vary-save';
      save.dataset.varySave = String(k);
      save.setAttribute('aria-label', `Save take ${k + 1} to the library`);
      save.title = 'Save this take to your sets (first empty slot)';
      save.innerHTML =
        // Square-cut floppy: clipped-corner body, shutter on top, label block below.
        '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path class="sv-body" d="M1.5 1.5H8.5L10.5 3.5V10.5H1.5Z"/>' +
        '<rect class="sv-shutter" x="3.5" y="1.5" width="4" height="2.5"/><rect class="sv-label" x="3.5" y="6.5" width="5" height="4"/></svg>';
      save.addEventListener('click', () => void this.saveTake(k));
      const cell = document.createElement('div');
      cell.className = 'vary-cell';
      cell.append(b, save, lock);
      this.saveBtns.push(save);
      row.appendChild(cell);
      this.lockBtns.push(lock);
      this.btns.push(b);
      this.imgs.push(img);
    }
    el.appendChild(row);
    this.strip = el;
    // The full-size preview: an image over the whole stage (above the canvas and handles, below the strip), inert.
    this.full = document.createElement('img');
    this.full.className = 'vary-full';
    this.full.alt = '';
    this.full.hidden = true;
    stage.append(this.full, el);
    this.syncView();
    el.addEventListener('pointerenter', () => window.clearTimeout(this.peekTimer));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.schedulePeekClose();
    });
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
    this.pinned = true;
    const s = this.store;
    if (s.harmony === h) return;
    s.harmony = h;
    this.syncHarmony();
    s.say(`HARMONY · ${HARMONY_LABEL[h]}`);
    if (this.isOpen && this.mode === 'random') void this.open('random', true);
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
    this.pinned = true;
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
    if (this.isOpen) void this.open(this.mode, true);
  }

  private syncAxes(): void {
    this.axisBtns.forEach((b, i) => {
      const on = this.axes[AXES[i].key];
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('is-on', on);
    });
  }

  /** Release thumbnail images, except the ones a lock is holding (in either mode). */
  /** Release a mode's cached thumbnails, except the ones a lock is holding (in either mode). */
  private revoke(mode: 'vary' | 'random'): void {
    const c = this.cache[mode];
    if (!c) return;
    const keptTakes = new Set([...this.kept.vary, ...this.kept.random].map((k) => k?.v));
    for (const v of c.variants) {
      const f = this.fullCache.get(v);
      if (f && !keptTakes.has(v)) {
        URL.revokeObjectURL(f.url);
        this.fullCache.delete(v);
      }
    }
    const held = new Set([...this.kept.vary, ...this.kept.random].map((k) => k?.url));
    for (const u of c.srcs) if (u && !held.has(u)) URL.revokeObjectURL(u);
    this.cache[mode] = null;
  }

  /** Lock / unlock take `k` of the current mode. Only a rendered take can be locked. */
  private toggleKeep(k: number): void {
    this.pinned = true; // working inside the strip keeps it
    const slot = this.kept[this.mode];
    if (slot[k]) slot[k] = null;
    else {
      const v = this.variants[k];
      const url = this.imgs[k].getAttribute('src');
      if (!v || !url || this.btns[k].classList.contains('is-loading')) return;
      slot[k] = { v, url };
    }
    this.syncLocks();
    this.store.say(`${this.mode === 'random' ? 'R' : 'V'}-${k + 1} · ${slot[k] ? 'LOCKED' : 'UNLOCKED'}`);
  }

  /** SAVE chip: write take `k` to the library (first empty slot) and give the slot its own small thumbnail. */
  private async saveTake(k: number): Promise<void> {
    this.pinned = true;
    const v = this.variants[k];
    if (!v || this.btns[k].classList.contains('is-loading')) return;
    const tag = this.tags[k].textContent ?? '';
    const i = this.actions.saveTake(v.specs, v.fx, tag.split(' · ')[0]);
    if (i < 0) return;
    this.saved.add(v);
    this.syncLocks();
    try {
      const s = this.store;
      const m = this.metrics;
      const { w, h } = quickSize(m.w, m.h, 112);
      const copy: Store = { ...s, nodes: v.specs.map((sp) => makeNode(sp)), fx: v.fx ?? s.fx };
      const res = await renderOffscreen(copy, m, w, h, s.reducedMotion ? 0.5 : this.now() / 1000);
      if (!res.ok) return;
      const url = await new Promise<string>((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = () => no(r.error);
        r.readAsDataURL(res.blob);
      });
      library.setThumb(i, library.savedAt(i), url);
      emit(s);
    } catch {
      // the slot keeps its colour-chip fallback
    }
  }

  private syncLocks(): void {
    this.saveBtns.forEach((b, k) => {
      const v = this.variants[k];
      const on = !!v && this.saved.has(v);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    this.lockBtns.forEach((b, k) => {
      const on = !!this.kept[this.mode][k];
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('is-on', on);
    });
  }

  /**
   * Show the strip in `mode`. Without `roll` it shows that mode's last set (if the field has not changed since); with
   * `roll`, or when there is none, it generates four new takes (locked ones stay) and renders them one after another.
   * RANDOM: fresh compositions (locked nodes kept). VARY: takes on the current field.
   */
  async open(mode: 'vary' | 'random' = this.mode, roll = false): Promise<void> {
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
    const cached = this.cache[mode];
    const reuse = !roll && !!cached && cached.sig === this.sig;
    const seed = reuse ? cached!.seed : newSeed();
    if (reuse) this.variants = cached!.variants;
    else if (mode === 'random') {
      const aspect = this.metrics.w / Math.max(1, this.metrics.h);
      // ANY: four different concrete rules, so the strip compares harmonies; a chosen rule: four takes on it.
      const start = Math.floor(makeRng(seed)() * ANY_SPREAD.length);
      this.variants = STRENGTH.map((_, j) => {
        const keep = this.kept.random[j];
        if (keep) return keep.v;
        const rule = s.harmony === 'any' ? ANY_SPREAD[(start + j) % ANY_SPREAD.length] : s.harmony;
        const sj = (seed + j * 7919) & 0xffff;
        const specs = randomSpecs(makeRng(sj), rule, base, aspect).map((sp) => ({ ...sp, uid: undefined }));
        return { specs, fx: null, rule, seed: sj };
      });
    } else {
      const ax = this.axes;
      this.variants = STRENGTH.map((k, j) => {
        const keep = this.kept.vary[j];
        if (keep) return keep.v;
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
    if (!reuse) {
      this.revoke(mode);
      this.cache[mode] = {
        variants: this.variants,
        srcs: this.variants.map((_, j) => this.kept[mode][j]?.url ?? null),
        seed,
        sig: this.sig,
      };
    }
    const cache = this.cache[mode]!;
    this.syncLocks();
    this.head.textContent = `${mode === 'random' ? 'RANDOM' : 'VARIATIONS'} // 04 // SEED ${seedLabel(seed)} // 1–4 PICK · ESC`;
    this.rollBtn.querySelector('b')!.textContent = mode === 'random' ? '[R]' : '[V]';
    this.rollBtn.title = `New set of four (${mode === 'random' ? 'R' : 'V'}); locked takes stay`;
    this.btns.forEach((b, j) => {
      const src = this.kept[mode][j]?.url ?? cache.srcs[j];
      b.classList.toggle('is-loading', !src);
      if (src) this.imgs[j].src = src;
      else this.imgs[j].removeAttribute('src');
    });
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
      if (this.kept[mode][j] || cache.srcs[j]) continue; // a locked or already rendered take keeps its image
      // renderOffscreen reads the store's nodes (settled targets) and FX: hand it a copy carrying the variant.
      const v = this.variants[j];
      const copy: Store = { ...s, nodes: v.specs.map((sp) => makeNode(sp)), fx: v.fx ?? s.fx };
      const res = await renderOffscreen(copy, m, tw, th, s.reducedMotion ? 0.5 : this.now() / 1000);
      if (token !== this.token) return; // closed or re-rolled meanwhile
      if (!res.ok) continue;
      const url = URL.createObjectURL(res.blob);
      cache.srcs[j] = url;
      this.imgs[j].src = url;
      this.btns[j].classList.remove('is-loading');
      if (j === 0 && this.strip.contains(document.activeElement) === false) this.btns[0].focus({ preventScroll: true });
    }
  }

  /** Open (or switch to) `mode` and keep it until dismissed. */
  private pin(mode: 'vary' | 'random'): void {
    window.clearTimeout(this.peekTimer);
    this.pinned = true;
    if (!this.isOpen || this.mode !== mode) void this.open(mode);
  }

  /** A peek closes a moment after the pointer has left both its button and the strip (the grace bridges the gap). */
  private schedulePeekClose(): void {
    if (this.pinned) return;
    window.clearTimeout(this.peekTimer);
    this.peekTimer = window.setTimeout(() => {
      const over = this.strip.matches(':hover') || this.varyBtn.matches(':hover') || this.randomBtn.matches(':hover');
      if (!this.pinned && !over) this.close();
    }, 260);
  }

  private syncView(): void {
    this.viewBtn.setAttribute('aria-pressed', String(this.viewOn));
    this.viewBtn.classList.toggle('is-on', this.viewOn);
  }

  /** VIEW: render take `k` at the stage's own size (cached) and lay it over the artboard while it is hovered. */
  private async showFull(k: number): Promise<void> {
    if (!this.viewOn || !this.isOpen) return;
    const v = this.variants[k];
    if (!v) return;
    window.clearTimeout(this.fullHideTimer); // moving onto the next take: keep the current preview up until it swaps
    const token = ++this.fullToken;
    const m = this.metrics;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(16, Math.round(m.w * dpr));
    const H = Math.max(16, Math.round(m.h * dpr));
    const size = `${W}x${H}`;
    const hit = this.fullCache.get(v);
    let url = hit && hit.size === size ? hit.url : undefined;
    if (!url) {
      if (hit) URL.revokeObjectURL(hit.url);
      const s = this.store;
      const copy: Store = { ...s, nodes: v.specs.map((sp) => makeNode(sp)), fx: v.fx ?? s.fx };
      const res = await renderOffscreen(copy, m, W, H, s.reducedMotion ? 0.5 : this.now() / 1000);
      if (!res.ok) return;
      url = URL.createObjectURL(res.blob);
      this.fullCache.set(v, { size, url });
    }
    if (token !== this.fullToken || !this.isOpen) return; // hovered away (or another take) meanwhile
    this.full.src = url;
    this.full.hidden = false;
  }

  /**
   * Drop the full preview. `soon`: after leaving a thumbnail, wait 200 ms first, so crossing the gap to the next take
   * does not flash the real field in between (entering a take cancels it and swaps straight over).
   */
  private hideFull(soon = false): void {
    window.clearTimeout(this.fullHideTimer);
    if (soon) {
      this.fullHideTimer = window.setTimeout(() => this.hideFull(), 200);
      return;
    }
    this.fullToken++;
    this.full.hidden = true;
  }

  close(): void {
    this.hideFull();
    window.clearTimeout(this.peekTimer);
    this.pinned = false;
    if (!this.isOpen) return;
    this.token++;
    this.strip.hidden = true;
    for (const btn of [this.varyBtn, this.randomBtn]) {
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('is-on');
    }
    if (this.strip.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    // The set stays cached (images included) for the next open; an edit to the field or a roll replaces it.
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
    // R / V: open that strip (showing its last set); pressed again while it is open, roll a new set.
    const mode = e.key === 'r' || e.key === 'R' ? 'random' : e.key === 'v' || e.key === 'V' ? 'vary' : null;
    if (!mode) return;
    e.preventDefault();
    const again = this.isOpen && this.mode === mode;
    this.pinned = true;
    void this.open(mode, again);
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
