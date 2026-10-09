import type { Actions } from './actions';
import { renderOffscreen } from './exporter';
import { extractFromFile } from './extract';
import type { Metrics } from './handles';
import { HARMONIES, HARMONY_LABEL, makeRng, newSeed, seedLabel, varySpecs } from './generate';
import { makeNode, snapshotIdentified, type NodeSpec, type Store } from './store';

const TYPING = 'input:not([type=color]):not([type=checkbox]), textarea, select, [contenteditable=""], [contenteditable="true"]';
/** Mutation strength of the four thumbnails: gentle → bold. */
const STRENGTH = [0.8, 1.15, 1.5, 2];
/** Long side of a thumbnail render (px); the strip shows it at about half that. */
const THUMB = 240;

/**
 * Starting points and exploration: RANDOM [R] + its harmony chip, VARY [V] (a strip of four mutated copies over the
 * stage), and palette extraction from an image (file picker in the colour-set panel, or a drop on the stage).
 */
export class Explore {
  private strip: HTMLDivElement;
  private head: HTMLElement;
  private btns: HTMLButtonElement[] = [];
  private imgs: HTMLImageElement[] = [];
  private urls: string[] = [];
  private variants: NodeSpec[][] = [];
  private token = 0;
  private sig = '';
  private harmonyBtn = document.querySelector<HTMLButtonElement>('[data-action=harmony]')!;
  private varyBtn = document.querySelector<HTMLButtonElement>('[data-action=vary]')!;
  private dropDepth = 0;

  constructor(
    private store: Store,
    private actions: Actions,
    private stage: HTMLElement,
    private metrics: Metrics,
    private now: () => number,
  ) {
    document.querySelector<HTMLButtonElement>('[data-action=randomize]')!.addEventListener('click', () => this.random());
    this.varyBtn.addEventListener('click', () => (this.isOpen ? this.close() : void this.open()));
    this.harmonyBtn.addEventListener('click', (e) => this.cycleHarmony(e.shiftKey ? -1 : 1));
    this.syncHarmony();

    // ----- VARY strip (a child of the stage, like the node menu: it hides with the rest of the furniture in PREVIEW)
    const el = document.createElement('div');
    el.className = 'vary-strip';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Variations');
    el.dataset.testid = 'vary';
    el.hidden = true;
    this.head = document.createElement('div');
    this.head.className = 'vary-head';
    el.appendChild(this.head);
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
      const key = document.createElement('kbd');
      key.textContent = String(k + 1);
      b.append(img, tag, key);
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
      if (this.isOpen && !el.contains(e.target as Node) && e.target !== this.varyBtn && !this.varyBtn.contains(e.target as Node)) this.close();
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

  // ----- RANDOM ---------------------------------------------------------------

  private random(): void {
    this.close();
    this.actions.randomize();
  }

  private cycleHarmony(dir: number): void {
    const s = this.store;
    const at = HARMONIES.indexOf(s.harmony);
    s.harmony = HARMONIES[(at + dir + HARMONIES.length) % HARMONIES.length];
    this.syncHarmony();
    s.say(`HARMONY · ${HARMONY_LABEL[s.harmony]}`);
  }

  private syncHarmony(): void {
    const label = HARMONY_LABEL[this.store.harmony];
    this.harmonyBtn.dataset.harmony = this.store.harmony;
    this.harmonyBtn.setAttribute('aria-label', `Colour harmony for Random: ${label}. Press to change`);
    this.harmonyBtn.querySelector('b')!.textContent = `[${label}]`;
  }

  // ----- VARY -----------------------------------------------------------------

  private signature(): string {
    return JSON.stringify(snapshotIdentified(this.store).map((n) => [n.uid, n.x, n.y, n.r, n.hex, n.shape, n.rot, n.soft, n.opac, n.lock, n.hide, n.pts?.length]));
  }

  private revoke(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
  }

  /** Open the strip (or roll a new set when it is already open) and render the four thumbnails one after another. */
  async open(): Promise<void> {
    const s = this.store;
    if (s.drag.kind !== 'none' || s.drawing) return;
    this.sig = this.signature();
    const base = snapshotIdentified(s);
    if (base.every((n) => n.lock)) {
      s.say('VARY · EVERY NODE IS LOCKED');
      return;
    }
    const token = ++this.token;
    const seed = newSeed();
    this.variants = STRENGTH.map((k, j) => varySpecs(makeRng(seed + j * 7919), base, k));
    this.revoke();
    this.head.textContent = `VARIATIONS // 04 // SEED ${seedLabel(seed)} // 1–4 PICK · V ROLL · ESC`;
    for (const b of this.btns) b.classList.add('is-loading');
    this.strip.hidden = false;
    this.varyBtn.setAttribute('aria-pressed', 'true');
    this.varyBtn.classList.add('is-on');
    s.say('VARY · pick a variation');
    const m = this.metrics;
    const aspect = m.w / Math.max(1, m.h);
    const tw = aspect >= 1 ? THUMB : Math.max(16, Math.round(THUMB * aspect));
    const th = aspect >= 1 ? Math.max(16, Math.round(THUMB / aspect)) : THUMB;
    this.strip.style.setProperty('--vary-aspect', String(aspect));
    for (let j = 0; j < this.variants.length; j++) {
      // renderOffscreen reads the store's nodes (settled targets) and FX: hand it a copy carrying the variant.
      const copy: Store = { ...s, nodes: this.variants[j].map((sp) => makeNode(sp)) };
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
    this.varyBtn.setAttribute('aria-pressed', 'false');
    this.varyBtn.classList.remove('is-on');
    if (this.strip.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.revoke();
    for (const img of this.imgs) img.removeAttribute('src');
  }

  private pick(k: number): void {
    const specs = this.variants[k];
    if (!specs || this.btns[k].classList.contains('is-loading')) return;
    this.close();
    this.actions.adoptVariant(specs, k + 1);
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
      this.random();
    } else if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      void this.open();
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
