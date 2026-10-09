import type { Actions } from './actions';
import { parseHex } from './color';
import { downloadBlob, renderOffscreen, stamp } from './exporter';
import type { Metrics } from './handles';
import type { History } from './history';
import { PRESETS, type Preset } from './presets';
import { currentPreset, CUSTOM_INDEX, emit, MAX_NODES, MIN_NODES, nodeSerial, type Shape, type Store } from './store';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

export class UI {
  private presetButtons: HTMLButtonElement[] = [];
  private bars: HTMLElement[] = [];
  private chips: HTMLButtonElement[] = [];
  private chipSel = -2;
  private chipHov = -1;
  private statusTimer = 0;
  private exportCount = 0;
  /** Colour-editing session: one undo step from first change until blur / commit / retarget. */
  private colorSession: number | null = null;
  private lastTargetUid = -1;
  private lastCount = -1;

  private stateV = $('state-readout');
  private stateGlyph = $('state-glyph');
  private footSerial = $('foot-serial');
  private footDims = $('foot-dims');
  private nodeHint = $('node-hint');
  private nsId = $('ns-id');
  private nsX = $('ns-x');
  private nsY = $('ns-y');
  private nsR = $('ns-r');
  private nsSwatch = $('ns-swatch');
  private colorInput = $<HTMLInputElement>('node-color');
  private hexInput = $<HTMLInputElement>('node-hex');
  private hexField = $('hex-field');
  private swatchBtn = $('swatch-btn');
  private palette = $('palette');
  private addBtn = $<HTMLButtonElement>('add-node');
  private removeBtn = $<HTMLButtonElement>('remove-node');
  private undoBtn = $<HTMLButtonElement>('undo');
  private saveBtn = document.querySelector<HTMLButtonElement>('[data-action=save-custom]')!;
  private clearBtn = document.querySelector<HTMLButtonElement>('[data-action=clear-custom]')!;
  private clearLabel = this.clearBtn.querySelector<HTMLElement>('.mini-l')!;
  private clearTimer = 0;
  private drawBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-action=draw-mode]')];
  private shapeBtns = [...document.querySelectorAll<HTMLButtonElement>('.shape-btn')];
  private rotBtns = [...document.querySelectorAll<HTMLButtonElement>('.mini-rot')];
  private nsRot = $('ns-rot');
  private nsSoft = $('ns-soft');
  private nsLayer = $('ns-layer');
  private softSegs = [...document.querySelectorAll<HTMLElement>('#soft-bar i')];
  private softBtns = [...document.querySelectorAll<HTMLButtonElement>('.mini-soft[data-action^=soft]')];
  private opacBtns = [...document.querySelectorAll<HTMLButtonElement>('.mini-soft[data-action^=opac]')];
  private nsOpac = $('ns-opac');
  private opacSegs = [...document.querySelectorAll<HTMLElement>('#opac-bar i')];
  private opacFill = -1;
  private softFill = -1;
  private shapeTag = $('shape-tag');
  private shapeGroup = $('shape-group');
  private eyebrowCount = $('eyebrow-count');
  private railCount = $('rail-count');
  private railNode = $('rail-node');
  private railPreset = $('rail-preset');
  private status = $('status');
  private exportBtn = $<HTMLButtonElement>('export');
  private resetBtn = $<HTMLButtonElement>('reset');

  constructor(
    private store: Store,
    private metrics: Metrics,
    private now: () => number,
    private pointer: () => { x: number; y: number; inside: boolean },
    private actions: Actions,
    private history: History,
  ) {
    store.say = (t) => this.say(t);
    this.buildPresets();
    // ⇧-click = quick 2048 px copy; a plain click is owned by WallpaperPanel (fxpanel.ts).
    this.exportBtn.addEventListener('click', (e) => {
      if (e.shiftKey) void this.exportPng();
    });
    this.resetBtn.addEventListener('click', () => actions.reset());
    this.undoBtn.addEventListener('click', () => actions.undo());
    this.addBtn.addEventListener('click', () => actions.addAuto());
    this.removeBtn.addEventListener('click', () => actions.removeSelected());
    this.saveBtn.addEventListener('click', () => {
      this.disarmClear();
      actions.saveCustom();
    });
    this.bindClear();
    this.bindColor();
    for (const b of this.drawBtns) b.addEventListener('click', () => actions.toggleDraw());
    for (const b of this.shapeBtns) {
      b.addEventListener('click', () => {
        const i = actions.target;
        if (i >= 0) actions.setShape(i, b.dataset.shape as Shape);
      });
    }
    for (const b of this.rotBtns) {
      b.addEventListener('click', () => {
        const i = actions.target;
        if (i >= 0) actions.rotate(i, (b.dataset.action === 'rot-minus' ? -1 : 1) * 15);
      });
    }
    for (const b of this.softBtns) {
      b.addEventListener('click', () => {
        const i = actions.target;
        if (i >= 0) actions.softBy(i, b.dataset.action === 'soft-minus' ? -0.1 : 0.1);
      });
    }
    for (const b of this.opacBtns) {
      b.addEventListener('click', () => {
        const i = actions.target;
        if (i >= 0) actions.opacBy(i, b.dataset.action === 'opac-minus' ? -0.1 : 0.1);
      });
    }
    store.listeners.add(() => this.sync());
    this.sync();
  }

  /** CLEAR [×] needs a second press within 3 s: first press arms it (FLARE, "CLEAR?"), Esc/blur/timeout disarm. */
  private bindClear(): void {
    const b = this.clearBtn;
    b.addEventListener('click', () => {
      if (b.dataset.armed === 'true') {
        this.disarmClear();
        this.actions.clearCustom();
        this.saveBtn.focus({ preventScroll: true });
        return;
      }
      b.dataset.armed = 'true';
      b.classList.add('is-armed');
      this.clearLabel.textContent = 'CLEAR?';
      b.setAttribute('aria-label', 'Press again to clear CS-06');
      this.say('Press CLEAR again to delete CS-06');
      this.clearTimer = window.setTimeout(() => this.disarmClear(), 3000);
    });
    b.addEventListener('blur', () => this.disarmClear());
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && b.dataset.armed === 'true') {
        e.stopPropagation();
        this.disarmClear();
      }
    });
  }

  private disarmClear(): void {
    const b = this.clearBtn;
    window.clearTimeout(this.clearTimer);
    if (b.dataset.armed !== 'true') return;
    b.dataset.armed = 'false';
    b.classList.remove('is-armed');
    this.clearLabel.textContent = 'CLEAR';
    b.removeAttribute('aria-label');
  }

  private presetHtml(p: Preset | null): string {
    const chips = p ? p.colors.map((c) => `<i style="background:${c}"></i>`).join('') : '';
    const name = p ? p.name : 'CUSTOM — EMPTY';
    return (
      `<span class="chips" aria-hidden="true">${chips}</span>` +
      `<span class="preset-serial">${p ? p.serial : 'CS-06'}</span>` +
      `<span class="preset-name"><span class="nm">${name}</span><em class="preset-mod" hidden>MOD</em></span>` +
      `<b class="preset-glyph">[>]</b>`
    );
  }

  private buildPresets(): void {
    const host = $('presets');
    const rows: (Preset | null)[] = [...PRESETS, this.store.custom];
    rows.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.dataset.preset = i === CUSTOM_INDEX ? 'cs06' : PRESETS[i].id;
      b.setAttribute('role', 'radio');
      b.innerHTML = this.presetHtml(p);
      b.addEventListener('click', () => {
        const s = this.store;
        if (s.presetIndex === i && !s.modified) return;
        this.actions.applyPresetAt(i);
      });
      host.appendChild(b);
      this.presetButtons.push(b);
    });
    this.refreshCustomRow();
  }

  private customKey = '\0';

  /** CS-06 row: empty/dimmed until a custom set has been saved; chips follow the saved colours. */
  private refreshCustomRow(): void {
    const c = this.store.custom;
    const key = c ? c.colors.join() : '';
    if (key === this.customKey) return;
    this.customKey = key;
    const b = this.presetButtons[CUSTOM_INDEX];
    b.innerHTML = this.presetHtml(c);
    b.classList.toggle('is-empty', !c);
    if (!c) this.disarmClear();
    this.clearBtn.hidden = !c;
  }

  private rebuildBarcode(): void {
    const host = $('barcode');
    const n = this.store.nodes.length;
    while (this.bars.length < n) {
      const bar = document.createElement('i');
      host.appendChild(bar);
      this.bars.push(bar);
    }
    while (this.bars.length > n) this.bars.pop()!.remove();
  }

  private rebuildPalette(): void {
    const s = this.store;
    while (this.chips.length < s.nodes.length) {
      const i = this.chips.length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn';
      b.dataset.chip = String(i);
      b.addEventListener('click', () => {
        const st = this.store;
        const idx = Number(b.dataset.chip);
        if (idx >= st.nodes.length) return;
        st.selected = idx;
        st.armed = idx;
        emit(st);
      });
      this.palette.appendChild(b);
      this.chips.push(b);
    }
    while (this.chips.length > s.nodes.length) this.chips.pop()!.remove();
    s.nodes.forEach((n, i) => {
      const b = this.chips[i];
      if (b.dataset.hex !== n.hex) {
        b.dataset.hex = n.hex;
        b.style.setProperty('--c', n.hex);
      }
      const label = `${nodeSerial(i)} ${n.hex}`;
      if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
    });
    this.chipSel = -2;
    this.chipHov = -2;
  }

  // ----- colour field ---------------------------------------------------------

  private endColorSession(): void {
    this.colorSession = null;
  }

  /** Apply a colour to the edit target, opening one undo step per session. */
  private commitColor(hex: string): void {
    const i = this.actions.target;
    if (i < 0 || this.store.nodes[i].hex === hex) return;
    if (this.colorSession !== this.store.nodes[i].uid) {
      this.actions.beginColor(i);
      this.colorSession = this.store.nodes[i].uid;
    }
    this.actions.setColor(i, hex);
  }

  private setInvalid(on: boolean): void {
    this.hexField.classList.toggle('is-invalid', on);
    this.hexInput.setAttribute('aria-invalid', String(on));
  }

  private revertHex(): void {
    const i = this.actions.target;
    this.hexInput.value = i >= 0 ? this.store.nodes[i].hex.slice(1) : '';
    this.setInvalid(false);
  }

  private bindColor(): void {
    const hex = this.hexInput;
    hex.addEventListener('input', () => {
      const raw = hex.value.trim();
      const parsed = raw.length === 0 ? null : parseHex(raw);
      const six = raw.replace(/^#/, '').length === 6;
      this.setInvalid(parsed === null);
      // Live-commit only complete 6-digit values so "fff" typed on the way to "ffee00" doesn't fire early.
      if (parsed && six) this.commitColor(parsed);
    });
    hex.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const parsed = parseHex(hex.value);
        if (parsed) {
          this.commitColor(parsed);
          hex.value = parsed.slice(1);
          this.setInvalid(false);
        } else {
          this.setInvalid(true);
        }
        this.endColorSession();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.revertHex();
        this.endColorSession();
        hex.blur();
      }
    });
    hex.addEventListener('blur', () => {
      const parsed = parseHex(hex.value);
      if (parsed) this.commitColor(parsed);
      this.revertHex();
      this.endColorSession();
    });
    this.colorInput.addEventListener('input', () => {
      const parsed = parseHex(this.colorInput.value);
      if (parsed) {
        this.commitColor(parsed);
        this.hexInput.value = parsed.slice(1);
        this.setInvalid(false);
      }
    });
    this.colorInput.addEventListener('change', () => this.endColorSession());
    this.colorInput.addEventListener('blur', () => this.endColorSession());
  }

  /** Mirror the edit target into the colour controls (never while the user is typing in them). */
  private syncColor(): void {
    const s = this.store;
    const i = this.actions.target;
    const n = i >= 0 ? s.nodes[i] : null;
    const uid = n ? n.uid : -1;
    if (uid !== this.lastTargetUid) {
      this.lastTargetUid = uid;
      this.endColorSession();
      this.setInvalid(false);
    }
    const on = !!n;
    for (const el of [this.colorInput, this.hexInput]) if (el.disabled === on) el.disabled = !on;
    this.swatchBtn.classList.toggle('is-disabled', !on);
    this.hexField.classList.toggle('is-disabled', !on);
    this.nsSwatch.style.background = n ? n.hex : 'transparent';
    if (document.activeElement !== this.hexInput) {
      const want = n ? n.hex.slice(1) : '';
      if (this.hexInput.value !== want) this.hexInput.value = want;
      if (this.hexField.classList.contains('is-invalid')) this.setInvalid(false);
    }
    if (n && document.activeElement !== this.colorInput) {
      const want = n.hex.toLowerCase();
      if (this.colorInput.value !== want) this.colorInput.value = want;
    }
  }

  /** Shape picker, rotation buttons and the DRAW toggles follow the edit target and the tool. */
  private syncShape(): void {
    const s = this.store;
    const t = this.actions.target;
    const n = t >= 0 ? s.nodes[t] : null;
    const stroke = n?.shape === 'stroke';
    for (const b of this.shapeBtns) {
      const dis = !n || stroke;
      if (b.disabled !== dis) b.disabled = dis;
      b.setAttribute('aria-checked', String(!!n && !stroke && n.shape === b.dataset.shape));
    }
    this.shapeTag.hidden = !stroke;
    if (stroke) setText(this.shapeTag, `STROKE · ${pad2(n!.pts.length)} PTS`);
    this.shapeGroup.closest('.shape-row')!.classList.toggle('is-stroke', stroke);
    const canRot = !!n && n.shape !== 'circle' && !stroke;
    for (const b of this.rotBtns) if (b.disabled === canRot) b.disabled = !canRot;
    for (const b of this.softBtns) {
      const dis = !n || (b.dataset.action === 'soft-minus' ? n.soft <= 0.0001 : n.soft >= 0.9999);
      if (b.disabled !== dis) b.disabled = dis;
    }
    for (const b of this.opacBtns) {
      const dis = !n || (b.dataset.action === 'opac-minus' ? n.opac <= 0.0001 : n.opac >= 0.9999);
      if (b.disabled !== dis) b.disabled = dis;
    }
    const draw = s.tool === 'draw';
    for (const b of this.drawBtns) {
      b.setAttribute('aria-pressed', String(draw));
      b.classList.toggle('is-on', draw);
      const l = b.querySelector<HTMLElement>('.mini-l');
      if (l) setText(l, draw ? 'DRAW ON' : 'DRAW');
    }
  }

  /** Called on store events: things that change rarely. */
  sync(): void {
    const s = this.store;
    this.refreshCustomRow();
    this.presetButtons.forEach((b, i) => {
      const on = i === s.presetIndex;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
      const mod = b.querySelector<HTMLElement>('.preset-mod');
      if (mod) mod.hidden = !(on && s.modified);
    });
    setText(this.railPreset, pad2(s.presetIndex + 1));
    const count = s.nodes.length;
    if (count !== this.lastCount) {
      this.lastCount = count;
      setText(this.eyebrowCount, pad2(count));
      setText(this.railCount, pad2(count));
      this.rebuildBarcode();
    }
    this.rebuildPalette();
    const active = this.activeNode();
    setText(this.railNode, active >= 0 ? pad2(active + 1) : '——');
    this.nodeHint.hidden = active >= 0;
    const target = this.actions.target;
    this.addBtn.disabled = count >= MAX_NODES;
    this.removeBtn.disabled = target < 0 || count <= MIN_NODES;
    this.undoBtn.disabled = !this.history.canUndo;
    this.saveBtn.classList.toggle('is-dirty', s.modified || s.presetIndex !== CUSTOM_INDEX);
    this.syncColor();
    this.syncShape();
    s.nodes.forEach((n, i) => {
      const g = document.querySelector<SVGGElement>(`[data-node="${i}"]`);
      g?.setAttribute(
        'aria-label',
        `${nodeSerial(i)}, x ${n.x.toFixed(2)}, y ${n.y.toFixed(2)}, radius ${Math.round(n.r * this.metrics.min)} pixels`,
      );
    });
  }

  private activeNode(): number {
    const s = this.store;
    const i = s.drag.kind !== 'none' ? s.drag.index : s.hover.kind !== 'idle' ? s.hover.index : (s.selected ?? s.focused ?? -1);
    return i < s.nodes.length ? i : -1;
  }

  /** Called every frame: live readouts. Cheap string compares keep DOM writes rare. */
  frame(): void {
    const s = this.store;
    const m = this.metrics;
    const active = this.activeNode();

    let state = 'IDLE';
    let glyph = '[—]';
    if (s.drawing) { state = 'DRAWING'; glyph = '[✎]'; }
    else if (s.tool === 'draw') { state = 'DRAW'; glyph = '[✎]'; }
    else if (s.drag.kind === 'node') { state = `MOVE ${nodeSerial(s.drag.index)}`; glyph = '[✕]'; }
    else if (s.drag.kind === 'ring') { state = `RADIUS ${nodeSerial(s.drag.index)}`; glyph = '[○]'; }
    else if (s.drag.kind === 'soft') { state = `SOFT ${nodeSerial(s.drag.index)}`; glyph = '[◐]'; }
    else if (s.drag.kind === 'opac') { state = `OPAC ${nodeSerial(s.drag.index)}`; glyph = '[◑]'; }
    else if (s.drag.kind === 'hue') { state = `HUE ${nodeSerial(s.drag.index)}`; glyph = '[◍]'; }
    else if (s.drag.kind === 'sat') { state = `SAT ${nodeSerial(s.drag.index)}`; glyph = '[◍]'; }
    else if (s.drag.kind === 'lum') { state = `LUM ${nodeSerial(s.drag.index)}`; glyph = '[◍]'; }
    else if (s.drag.kind === 'rot') { state = `ROT ${nodeSerial(s.drag.index)}`; glyph = '[↻]'; }
    else if (s.hover.kind === 'node') { state = `NODE ${nodeSerial(s.hover.index)}`; glyph = '[+]'; }
    else if (s.hover.kind === 'ring') { state = `RING ${nodeSerial(s.hover.index)}`; glyph = '[○]'; }
    else if (s.hover.kind === 'soft') { state = `SOFT ${nodeSerial(s.hover.index)}`; glyph = '[◐]'; }
    else if (s.hover.kind === 'opac') { state = `OPAC ${nodeSerial(s.hover.index)}`; glyph = '[◑]'; }
    else if (s.hover.kind === 'rot') { state = `ROT ${nodeSerial(s.hover.index)}`; glyph = '[↻]'; }
    else if (s.hover.kind === 'hue') { state = `HUE ${nodeSerial(s.hover.index)}`; glyph = '[◍]'; }
    else if (s.hover.kind === 'sat') { state = `SAT ${nodeSerial(s.hover.index)}`; glyph = '[◍]'; }
    else if (s.hover.kind === 'lum') { state = `LUM ${nodeSerial(s.hover.index)}`; glyph = '[◍]'; }
    else if (s.hover.kind === 'body') { state = `BODY ${nodeSerial(s.hover.index)}`; glyph = '[◇]'; }
    else if (s.selected !== null) { state = `SEL ${nodeSerial(s.selected)}`; glyph = '[▪]'; }
    setText(this.stateV, state);
    setText(this.stateGlyph, glyph);

    const root = document.documentElement;
    const hs = s.hover.kind;
    const ds = s.drag.kind;
    if (root.dataset.hoverState !== hs) {
      root.dataset.hoverState = hs;
      document.body.dataset.hoverState = hs;
    }
    if (root.dataset.tool !== s.tool) {
      root.dataset.tool = s.tool;
      document.body.dataset.tool = s.tool;
    }
    if (root.dataset.drag !== ds) {
      root.dataset.drag = ds;
      document.body.dataset.drag = ds;
    }

    setText(this.footDims, `${Math.round(m.w)}×${Math.round(m.h)} PX`);
    const ptr = this.pointer();
    if (ptr.inside) {
      const px = Math.min(1, Math.max(0, ptr.x / m.w));
      const py = Math.min(1, Math.max(0, ptr.y / m.h));
      setText(this.footSerial, `CUR // X ${px.toFixed(3)} Y ${py.toFixed(3)}`);
    } else {
      setText(this.footSerial, 'CUR // X —.——— Y —.———');
    }
    if (active >= 0) {
      const n = s.nodes[active];
      const rpx = Math.round(n.r * m.min);
      setText(this.nsId, nodeSerial(active));
      setText(this.nsX, n.x.toFixed(3));
      setText(this.nsY, n.y.toFixed(3));
      setText(this.nsR, `${rpx} PX`);
      setText(this.nsRot, `${String(Math.round(((n.rot * 180) / Math.PI) % 360)).padStart(3, '0')}°`);
      const pct = Math.round(n.soft * 100);
      setText(this.nsSoft, `${pct}%`);
      setText(this.nsOpac, `${Math.round(n.opac * 100)}%`);
      const ofill = Math.round(n.opac * 10);
      if (ofill !== this.opacFill) {
        this.opacFill = ofill;
        this.opacSegs.forEach((seg, k) => seg.classList.toggle('is-on', k < ofill));
      }
      setText(this.nsLayer, `LYR ${pad2(active + 1)}/${pad2(s.nodes.length)}`);
      const fill = Math.round(n.soft * 10);
      if (fill !== this.softFill) {
        this.softFill = fill;
        this.softSegs.forEach((seg, k) => seg.classList.toggle('is-on', k < fill));
      }
      const rn = String(active + 1).padStart(2, '0');
      setText(this.railNode, rn);
    } else {
      setText(this.nsId, '—');
      setText(this.nsX, '—');
      setText(this.nsY, '—');
      setText(this.nsR, '—');
      setText(this.nsRot, '—');
      setText(this.nsSoft, '—');
      setText(this.nsOpac, '—');
      if (this.opacFill !== 0) {
        this.opacFill = 0;
        for (const seg of this.opacSegs) seg.classList.remove('is-on');
      }
      setText(this.nsLayer, '—');
      if (this.softFill !== 0) {
        this.softFill = 0;
        for (const seg of this.softSegs) seg.classList.remove('is-on');
      }
      setText(this.railNode, '——');
    }
    this.nodeHint.hidden = active >= 0;

    // Mirror selection onto the palette strip and the test hooks.
    const sel = this.actions.target;
    if (sel !== this.chipSel) {
      this.chipSel = sel;
      this.chips.forEach((b, i) => {
        b.classList.toggle('is-selected', i === sel);
        b.setAttribute('aria-pressed', String(i === sel));
      });
    }
    // Reverse hint: the chip of the node under the board pointer gets a keyline.
    const hov = s.hover.kind !== 'idle' ? s.hover.index : -1;
    if (hov !== this.chipHov) {
      this.chipHov = hov;
      this.chips.forEach((b, i) => b.classList.toggle('is-board-hover', i === hov));
    }
    const count = String(s.nodes.length);
    const selected = sel >= 0 ? String(sel) : '';
    if (root.dataset.nodeCount !== count || root.dataset.selected !== selected) {
      root.dataset.nodeCount = document.body.dataset.nodeCount = count;
      root.dataset.selected = document.body.dataset.selected = selected;
    }
    this.removeBtn.disabled = sel < 0 || s.nodes.length <= MIN_NODES;
    this.undoBtn.disabled = !this.history.canUndo;

    for (let i = 0; i < s.nodes.length && i < this.bars.length; i++) {
      const len = `${Math.round(10 + s.nodes[i].dr * 36)}px`;
      const bar = this.bars[i];
      if (bar.style.getPropertyValue('--len') !== len) bar.style.setProperty('--len', len);
    }
  }

  private say(text: string): void {
    setText(this.status, text);
    this.status.classList.add('is-on');
    clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => this.status.classList.remove('is-on'), 2400);
  }

  private async exportPng(): Promise<void> {
    const s = this.store;
    const m = this.metrics;
    if (this.exportBtn.disabled) return;
    this.exportBtn.disabled = true;
    const label = this.exportBtn.querySelector('.btn-label') as HTMLElement;
    setText(label, 'Exporting…');

    const long = 2048;
    const aspect = m.w / m.h;
    const ew = aspect >= 1 ? long : Math.round(long * aspect);
    const eh = aspect >= 1 ? Math.round(long / aspect) : long;
    try {
      // Same clock as the live field, so the export carries the warp you are looking at.
      const res = await renderOffscreen(s, m, ew, eh, s.reducedMotion ? 0.5 : this.now() / 1000);
      if (!res.ok) throw new Error(res.reason);

      const serial = currentPreset(s).serial.replace('-', '');
      this.exportCount += 1;
      const suffix = this.exportCount > 1 ? `-${this.exportCount}` : '';
      const name = `GH-${serial}-${stamp()}${suffix}.png`;
      downloadBlob(res.blob, name);

      setText(label, 'Exported');
      this.exportBtn.classList.add('is-done');
      this.say(`Exported ${name} · ${ew}×${eh}`);
    } catch {
      setText(label, 'Export failed');
      this.say('Export failed. Your browser blocked the canvas or the download.');
    } finally {
      window.setTimeout(() => {
        setText(label, 'Export');
        this.exportBtn.classList.remove('is-done');
        this.exportBtn.disabled = false;
      }, 1500);
    }
    emit(s);
  }
}

/** Rulers that encode the stage's 0–1 coordinate system. */
export function drawRulers(m: Metrics): void {
  const rx = document.getElementById('ruler-x') as unknown as SVGSVGElement;
  const ry = document.getElementById('ruler-y') as unknown as SVGSVGElement;
  const H = 18;
  const build = (len: number, horizontal: boolean): string => {
    let d = '';
    let labels = '';
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      const p = +(t * len).toFixed(1);
      const major = k % 5 === 0;
      const l = major ? 7 : k % 5 === 0 ? 5 : 3;
      d += horizontal ? `M${p} ${H}V${H - l}` : `M${H} ${p}H${H - l}`;
      if (major && !(k === 0 && !horizontal)) {
        const txt = t === 0 ? '0' : t === 1 ? '1' : `.${Math.round(t * 100)}`;
        // Inset the end labels so they clear the registration marks at the frame corners.
        const anchor = k === 20 ? 'end' : k === 0 ? 'start' : 'middle';
        const dx = k === 20 ? -10 : k === 0 ? 10 : 0;
        labels += horizontal
          ? `<text x="${p + dx}" y="8" text-anchor="${anchor}">${txt}</text>`
          : `<text transform="translate(7 ${p + dx}) rotate(-90)" text-anchor="${anchor === 'end' ? 'start' : anchor === 'start' ? 'end' : 'middle'}">${txt}</text>`;
      }
    }
    return `<path d="${d}"/>${labels}`;
  };
  rx.setAttribute('viewBox', `0 0 ${m.w} ${H}`);
  rx.setAttribute('width', String(m.w));
  rx.setAttribute('height', String(H));
  rx.innerHTML = build(m.w, true);
  ry.setAttribute('viewBox', `0 0 ${H} ${m.h}`);
  ry.setAttribute('width', String(H));
  ry.setAttribute('height', String(m.h));
  ry.innerHTML = build(m.h, false);
}
