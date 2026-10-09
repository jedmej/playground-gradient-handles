import type { Actions } from './actions';
import { buildCode, type CodeTab } from './codeexport';
import { quickSize, renderOffscreen } from './exporter';
import type { Metrics } from './handles';
import { decodeShare, isShareHash, shareUrl } from './share';
import type { Store } from './store';

/** Same field-focus guard as the other global shortcuts (main.ts / actions.ts). */
const TYPING = 'input:not([type=color]):not([type=checkbox]), textarea, select, [contenteditable=""], [contenteditable="true"]';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Last-resort text copy for pages without the async clipboard API (plain http, old browsers). */
function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** Copy text; `text` may still be computing (Safari wants the clipboard write issued inside the gesture, so it takes a promise). */
async function copyText(text: Promise<string> | string): Promise<boolean> {
  const p = Promise.resolve(text);
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': p.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(await p);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    return legacyCopy(await p);
  } catch {
    return false;
  }
}

const TABS: { id: CodeTab; label: string; note: string; approx: boolean }[] = [
  { id: 'glsl', label: 'GLSL', note: 'The exact shaders the app runs, plus the uniform values for this field at the wallpaper size. FX are a separate post pass and are not included.', approx: false },
  { id: 'json', label: 'JSON', note: 'The document: nodes, FX and wallpaper target. The same schema as saved sets and share links.', approx: false },
  { id: 'css', label: 'CSS', note: 'Stacked radial-gradients over a base colour. Cannot do the OKLab blend, the warp, rotation or FX: a rough look-alike, not the same image.', approx: true },
  { id: 'svg', label: 'SVG', note: 'Radial-gradient ellipses with a blurred stroke layer. No OKLab blend, warp or FX: a rough look-alike, not the same image.', approx: true },
];

/**
 * Everything that leaves the app other than the PNG download: SHARE [U] (link in the clipboard), COPY [C] (PNG in the
 * clipboard), CODE [X] (GLSL / JSON / CSS / SVG panel) and restoring a document from the URL hash.
 */
export class Output {
  private shareBtn = $<HTMLButtonElement>('[data-action="share"]');
  private copyBtn = $<HTMLButtonElement>('[data-action="copy-png"]');
  private codeBtn = $<HTMLButtonElement>('[data-action="code-export"]');
  private busy = false;

  private dlg!: HTMLDialogElement;
  private tabBtns: HTMLButtonElement[] = [];
  private view!: HTMLElement;
  private note!: HTMLElement;
  private meta!: HTMLElement;
  private copyCode!: HTMLButtonElement;
  private tab: CodeTab = 'glsl';
  private opener: HTMLElement | null = null;

  constructor(
    private store: Store,
    private actions: Actions,
    private metrics: Metrics,
    private now: () => number,
    private isPreview: () => boolean,
  ) {
    this.buildDialog();
    this.shareBtn.addEventListener('click', () => void this.share());
    this.copyBtn.addEventListener('click', () => void this.copyPng());
    this.codeBtn.addEventListener('click', () => this.openCode());
    // Shortcuts. In preview main.ts' capture listener swallows the key before it gets here; the check is belt and braces.
    window.addEventListener('keydown', (e) => {
      if (this.dlg.open) return this.dialogKey(e);
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || this.isPreview()) return;
      const k = e.key.toLowerCase();
      if (k !== 'u' && k !== 'c' && k !== 'x') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(TYPING) || t?.closest?.('[data-fx-knob], [data-fx-ring]')) return;
      e.preventDefault();
      if (k === 'u') void this.share();
      else if (k === 'c') void this.copyPng();
      else this.openCode();
    }, { capture: true });
    window.addEventListener('hashchange', () => void this.loadHash());
    void this.loadHash();
  }

  private say(text: string): void {
    this.store.say(text);
  }

  private flashTimers = new Map<HTMLButtonElement, number>();

  /** Toolbar button label for a moment (`done` = the green is-done state, like Export's), then back to its idle label. */
  private flash(btn: HTMLButtonElement, text: string, done: boolean): void {
    const label = btn.querySelector<HTMLElement>('.btn-label')!;
    const idle = (btn.dataset.idle ??= label.textContent ?? '');
    window.clearTimeout(this.flashTimers.get(btn));
    setText(label, text);
    btn.classList.toggle('is-done', done);
    if (text === 'Copying…') return; // the caller flashes again when it settles
    this.flashTimers.set(
      btn,
      window.setTimeout(() => {
        setText(label, idle);
        btn.classList.remove('is-done');
      }, 1500),
    );
  }

  // ----- share link ------------------------------------------------------------------

  /** A valid `#g1…` hash becomes one undo step (LINK) and is then removed from the address bar; an invalid one is ignored. */
  private async loadHash(): Promise<void> {
    const hash = location.hash;
    if (!isShareHash(hash)) return;
    const doc = await decodeShare(hash);
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* sandboxed frame: leave the hash */
    }
    if (!doc) {
      this.say('SHARE LINK NOT RECOGNISED — IGNORED');
      return;
    }
    this.actions.applyDoc(doc, 'LINK');
    this.say(`LINK LOADED · ${String(doc.nodes.length).padStart(2, '0')} NODES · UNDO TO GO BACK`);
  }

  private async share(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      let url = '';
      const ok = await copyText(shareUrl(this.store).then((u) => (url = u)));
      if (ok) {
        this.flash(this.shareBtn, 'Copied', true);
        this.say(url.length > 8000 ? `LINK COPIED · LONG (${Math.round(url.length / 1000)} KB): SOME APPS CUT IT OFF` : 'LINK COPIED');
      } else {
        this.say('COULD NOT COPY THE LINK — CLIPBOARD BLOCKED');
      }
    } catch {
      this.say('COULD NOT BUILD THE LINK');
    } finally {
      this.busy = false;
    }
  }

  // ----- copy PNG --------------------------------------------------------------------

  /** Quick-export render (2048 px long side, FX included) straight into the clipboard. */
  private async copyPng(): Promise<void> {
    if (this.copyBtn.disabled) return;
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      this.say('COPY PNG NEEDS A BROWSER WITH IMAGE CLIPBOARD SUPPORT (AND HTTPS) — USE EXPORT');
      return;
    }
    const { w, h } = quickSize(this.metrics.w, this.metrics.h);
    this.copyBtn.disabled = true;
    this.flash(this.copyBtn, 'Copying…', false);
    // The clipboard write must start inside the gesture, so it gets the *promise* of the blob (what Safari requires).
    const blob = renderOffscreen(this.store, this.metrics, w, h, this.store.reducedMotion ? 0.5 : this.now() / 1000).then((r) => {
      if (!r.ok) throw new Error(r.reason);
      return r.blob;
    });
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.flash(this.copyBtn, 'Copied', true);
      this.say(`PNG COPIED · ${w}×${h}`);
    } catch {
      this.flash(this.copyBtn, 'Copy failed', false);
      this.say('Copy failed. The clipboard refused the image (permission, or the render could not be made).');
    } finally {
      this.copyBtn.disabled = false;
    }
  }

  // ----- code export -----------------------------------------------------------------

  private buildDialog(): void {
    const dlg = document.createElement('dialog');
    dlg.className = 'code-dlg';
    dlg.setAttribute('aria-labelledby', 'code-title');
    dlg.innerHTML =
      `<div class="code-head"><h2 id="code-title">CODE EXPORT <span class="dim">// GRADIENT HANDLES</span></h2>` +
      `<button type="button" class="mini code-close" data-action="code-close" aria-label="Close"><span class="mini-l">CLOSE</span> <b>[×]</b></button></div>` +
      `<div class="code-tabs" role="tablist" aria-label="Format">` +
      TABS.map((t) => `<button type="button" class="code-tab" role="tab" id="code-tab-${t.id}" data-code-tab="${t.id}" aria-controls="code-panel">${t.label}</button>`).join('') +
      `</div>` +
      `<p class="code-note" id="code-note"></p>` +
      `<div class="code-panel" id="code-panel" role="tabpanel"><pre class="code-view" tabindex="0" aria-label="Code"><code></code></pre></div>` +
      `<div class="code-foot"><span class="code-meta dim" id="code-meta"></span>` +
      `<button type="button" class="mini code-copy" data-action="code-copy"><span class="mini-l">COPY</span> <b>[⧉]</b></button></div>`;
    document.body.appendChild(dlg);
    this.dlg = dlg;
    this.tabBtns = [...dlg.querySelectorAll<HTMLButtonElement>('.code-tab')];
    this.view = dlg.querySelector('code') as HTMLElement;
    this.note = dlg.querySelector('#code-note') as HTMLElement;
    this.meta = dlg.querySelector('#code-meta') as HTMLElement;
    this.copyCode = dlg.querySelector('.code-copy') as HTMLButtonElement;
    for (const b of this.tabBtns) b.addEventListener('click', () => this.setTab(b.dataset.codeTab as CodeTab));
    dlg.querySelector('.code-close')!.addEventListener('click', () => this.closeCode());
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) this.closeCode(); // the backdrop
    });
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.closeCode();
    });
    this.copyCode.addEventListener('click', () => void this.copyCurrent());
  }

  private text = '';

  private setTab(tab: CodeTab, focus = false): void {
    this.tab = tab;
    const info = TABS.find((t) => t.id === tab)!;
    this.tabBtns.forEach((b) => {
      const on = b.dataset.codeTab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    this.dlg.querySelector('.code-panel')!.setAttribute('aria-labelledby', `code-tab-${tab}`);
    this.note.classList.toggle('is-approx', info.approx);
    this.note.textContent = (info.approx ? 'APPROXIMATION — ' : '') + info.note;
    try {
      this.text = buildCode(tab, this.store, this.metrics);
    } catch {
      this.text = '// could not build this export';
    }
    this.view.textContent = this.text;
    this.view.parentElement!.scrollTop = 0;
    const lines = this.text.split('\n').length - 1;
    setText(this.meta, `${lines} LINES · ${(new Blob([this.text]).size / 1024).toFixed(1)} KB`);
    this.copyCode.querySelector<HTMLElement>('.mini-l')!.textContent = 'COPY ' + info.label;
  }

  private openCode(): void {
    if (this.dlg.open || this.isPreview()) return;
    if (this.store.drag.kind !== 'none' || this.store.drawing) return;
    this.opener = document.activeElement as HTMLElement | null;
    this.setTab(this.tab);
    this.dlg.showModal();
    this.tabBtns.find((b) => b.dataset.codeTab === this.tab)?.focus();
  }

  private closeCode(): void {
    if (!this.dlg.open) return;
    this.dlg.close();
    const o = this.opener && document.contains(this.opener) ? this.opener : this.codeBtn;
    o.focus({ preventScroll: true });
    this.opener = null;
  }

  private async copyCurrent(): Promise<void> {
    const ok = await copyText(this.text);
    const l = this.copyCode.querySelector<HTMLElement>('.mini-l')!;
    const label = 'COPY ' + TABS.find((t) => t.id === this.tab)!.label;
    l.textContent = ok ? 'COPIED' : 'COPY FAILED';
    window.setTimeout(() => (l.textContent = label), 1500);
  }

  /** While the panel is open it owns the keyboard: Esc closes, Tab is trapped, ←/→ switch tabs, nothing leaks to the editor. */
  private dialogKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.closeCode();
      return;
    }
    if (e.key === 'Tab') {
      e.stopImmediatePropagation();
      const f = [...this.dlg.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')].filter((el) => el.tabIndex >= 0);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i < 0 || i === f.length - 1 ? 0 : i + 1;
      e.preventDefault();
      f[next].focus();
      return;
    }
    const onTab = (e.target as HTMLElement | null)?.closest?.('.code-tab');
    if (onTab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      const n = TABS.length;
      const cur = TABS.findIndex((t) => t.id === this.tab);
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (cur + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
      this.setTab(TABS[to].id, true);
    }
    e.stopImmediatePropagation(); // browser defaults (copy, scroll, Enter on a button) still run
  }
}
