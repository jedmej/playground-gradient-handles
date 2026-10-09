import type { Actions } from './actions';
import { parseHex } from './color';
import { library } from './custom';
import { downloadBlob, quickSize, renderOffscreen, stamp } from './exporter';
import type { Metrics } from './handles';
import type { History } from './history';
import { PRESETS, type Preset } from './presets';
import { currentPreset, CUSTOM_INDEX, emit, MAX_NODES, MIN_NODES, nodeSerial, SLOT_COUNT, slotSerial, type Shape, type Store } from './store';

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

  private hudCursor = $('hud-cursor');
  private hudMeter = $('hud-meter');
  private hudCount = $('hud-count');
  private hudCells: HTMLElement[] = [];
  private hudKey = '';
  private hudX = -1;
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
  /** Disarm callbacks of every two-press CLEAR button (the header one and one per library slot). */
  private disarmers = new Set<() => void>();
  private slotEls: { main: HTMLButtonElement; thumb: HTMLElement; clear: HTMLButtonElement }[] = [];
  private slotKeys: string[] = [];
  private drawBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-action=draw-mode]')];
  private shapeBtns = [...document.querySelectorAll<HTMLButtonElement>('.shape-btn')];
  private rotBtns = [...document.querySelectorAll<HTMLButtonElement>('.mini-rot')];
  private nsRot = $('ns-rot');
  private nsSoft = $('ns-soft');
  private nsLayer = $('ns-layer');
  private softSegs = [...document.querySelectorAll<HTMLElement>('#soft-bar i')];
  private softBtns = [...document.querySelectorAll<HTMLButtonElement>('.mini-soft[data-action^=soft]')];
  private flagBtns = [...document.querySelectorAll<HTMLButtonElement>('.mini-flag')];
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
      this.disarmAll();
      this.saveSlot();
    });
    this.bindArm(this.clearBtn, this.clearLabel, 'CLEAR', 'CLEAR?', () => `Press CLEAR again to delete ${slotSerial(this.store.presetIndex - CUSTOM_INDEX)}`, () => {
      this.actions.clearCustom();
      this.saveBtn.focus({ preventScroll: true });
    });
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
    for (const b of this.flagBtns) {
      b.addEventListener('click', () => {
        const i = actions.target;
        if (i < 0) return;
        if (b.dataset.action === 'lock') actions.toggleLock(i);
        else if (b.dataset.action === 'hide') actions.toggleHide(i);
        else actions.solo(i);
      });
    }
    store.listeners.add(() => this.sync());
    this.sync();
  }

  /** Two-press confirm: the first press arms the button (FLARE, `armedText`), Esc / blur / 3 s disarm, the second press confirms. */
  private bindArm(b: HTMLButtonElement, label: HTMLElement, idle: string, armedText: string, hint: () => string, confirm: () => void): void {
    let timer = 0;
    const disarm = (): void => {
      window.clearTimeout(timer);
      if (b.dataset.armed !== 'true') return;
      b.dataset.armed = 'false';
      b.classList.remove('is-armed');
      label.textContent = idle;
      b.removeAttribute('aria-label');
    };
    this.disarmers.add(disarm);
    b.addEventListener('click', () => {
      if (b.dataset.armed === 'true') {
        disarm();
        confirm();
        return;
      }
      b.dataset.armed = 'true';
      b.classList.add('is-armed');
      label.textContent = armedText;
      b.setAttribute('aria-label', 'Press again to confirm: ' + hint());
      this.say(hint());
      timer = window.setTimeout(disarm, 3000);
    });
    b.addEventListener('blur', disarm);
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && b.dataset.armed === 'true') {
        e.stopPropagation();
        disarm();
      }
    });
  }

  private disarmAll(): void {
    for (const d of this.disarmers) d();
  }

  /** SAVE into `slot` (default: the active one, else the first empty) and render its thumbnail. */
  private saveSlot(slot?: number): void {
    const i = this.actions.saveCustom(slot);
    if (i >= 0) void this.makeThumb(i);
  }

  /** Small PNG of the field as just saved, stored with the slot (best effort: a failure leaves the colour-chip fallback). */
  private async makeThumb(i: number): Promise<void> {
    const savedAt = library.savedAt(i);
    const m = this.metrics;
    const { w, h } = quickSize(m.w, m.h, 112);
    try {
      const res = await renderOffscreen(this.store, m, w, h, this.store.reducedMotion ? 0.5 : this.now() / 1000);
      if (!res.ok) return;
      const url = await new Promise<string>((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = () => no(r.error);
        r.readAsDataURL(res.blob);
      });
      library.setThumb(i, savedAt, url);
      this.refreshSlots();
    } catch {
      /* no thumbnail */
    }
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
    PRESETS.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.dataset.preset = PRESETS[i].id;
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
    this.buildSlots();
    this.refreshSlots();
  }

  /** The save library: CS-06 … CS-13 as a grid of thumbnail cards (load = the card, ↧ = save into it, × twice = clear it). */
  private buildSlots(): void {
    const host = $('slots');
    for (let k = 0; k < SLOT_COUNT; k++) {
      const serial = slotSerial(k);
      const cell = document.createElement('div');
      cell.className = 'slot';
      cell.dataset.slot = String(k);
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'slot-main';
      main.dataset.preset = serial.toLowerCase().replace('-', '');
      main.setAttribute('role', 'radio');
      main.innerHTML =
        `<span class="slot-thumb" aria-hidden="true"></span>` +
        `<span class="slot-cap"><span class="slot-serial">${serial}</span><em class="preset-mod" hidden>MOD</em></span>`;
      const idx = CUSTOM_INDEX + k;
      main.addEventListener('click', () => {
        const s = this.store;
        if (s.presetIndex === idx && !s.modified) return;
        this.actions.applyPresetAt(idx);
      });
      const acts = document.createElement('span');
      acts.className = 'slot-acts';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'mini slot-btn';
      save.dataset.action = 'slot-save';
      save.dataset.slot = String(k);
      save.title = `Save the current field into ${serial}`;
      save.setAttribute('aria-label', `Save the current field into ${serial}`);
      save.innerHTML = '<b>[↧]</b>';
      save.addEventListener('click', () => {
        this.disarmAll();
        this.saveSlot(k);
      });
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'mini mini-clear slot-btn';
      clear.dataset.action = 'slot-clear';
      clear.dataset.slot = String(k);
      clear.title = `Clear ${serial} (press twice)`;
      clear.setAttribute('aria-label', `Clear ${serial}`);
      clear.innerHTML = '<span class="mini-l">[×]</span>';
      this.bindArm(clear, clear.firstElementChild as HTMLElement, '[×]', '[×]?', () => `Press × again to delete ${serial}`, () => {
        this.actions.clearCustom(k);
        save.focus({ preventScroll: true });
      });
      acts.append(save, clear);
      cell.append(main, acts);
      host.appendChild(cell);
      this.presetButtons[idx] = main;
      this.slotEls.push({ main, thumb: main.firstElementChild as HTMLElement, clear });
      this.slotKeys.push('\0');
    }
  }

  /** Library cards: dashed + dimmed while empty; thumbnail (or, before it renders / for migrated sets, the colour chips) when filled. */
  private refreshSlots(): void {
    const slots = this.store.slots;
    this.slotEls.forEach((el, k) => {
      const p = slots[k];
      const thumb = p ? library.thumb(k) : null;
      const key = p ? `${p.colors.join()}|${thumb ? thumb.length : 0}|${library.savedAt(k)}` : '';
      if (key === this.slotKeys[k]) return;
      this.slotKeys[k] = key;
      el.main.classList.toggle('is-empty', !p);
      el.clear.hidden = !p;
      if (!p) this.disarmAll();
      const serial = slotSerial(k);
      const when = library.savedAt(k);
      const at = when ? new Date(when).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      el.main.title = p ? `${serial} · ${pad2(p.colors.length)} nodes${at ? ' · saved ' + at : ''}` : `${serial} — empty`;
      el.main.setAttribute('aria-label', p ? `${serial}, ${p.colors.length} nodes` : `${serial}, empty`);
      el.thumb.replaceChildren();
      el.thumb.style.background = '';
      if (thumb) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = thumb;
        el.thumb.appendChild(img);
      } else if (p) {
        const n = p.colors.length;
        el.thumb.style.background = `linear-gradient(to right, ${p.colors.map((c, i) => `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`).join(', ')})`;
      }
    });
    const active = this.store.presetIndex - CUSTOM_INDEX;
    this.clearBtn.hidden = !(active >= 0 && slots[active]);
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
    if (i < 0 || this.store.nodes[i].hex === hex || this.actions.isLocked(i)) return;
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
    const on = !!n && !n.lock;
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
      const dis = !n || stroke || n.lock;
      if (b.disabled !== dis) b.disabled = dis;
      b.setAttribute('aria-checked', String(!!n && !stroke && n.shape === b.dataset.shape));
    }
    this.shapeTag.hidden = !stroke;
    if (stroke) setText(this.shapeTag, `${n!.fill ? 'FILL' : n!.closed ? 'SHAPE' : 'STROKE'} · ${pad2(n!.pts.length)} PTS`);
    this.shapeGroup.closest('.shape-row')!.classList.toggle('is-stroke', stroke);
    const canRot = !!n && n.shape !== 'circle' && !stroke && !n.lock;
    for (const b of this.rotBtns) if (b.disabled === canRot) b.disabled = !canRot;
    for (const b of this.softBtns) {
      const dis = !n || n.lock || (b.dataset.action === 'soft-minus' ? n.soft <= 0.0001 : n.soft >= 0.9999);
      if (b.disabled !== dis) b.disabled = dis;
    }
    for (const b of this.opacBtns) {
      const dis = !n || n.lock || (b.dataset.action === 'opac-minus' ? n.opac <= 0.0001 : n.opac >= 0.9999);
      if (b.disabled !== dis) b.disabled = dis;
    }
    // STATE row: LOCK / HIDE / SOLO follow the edit target (what pressing them would do next is in the pressed state).
    for (const b of this.flagBtns) {
      const a = b.dataset.action;
      const on = !!n && (a === 'lock' ? n.lock : a === 'hide' ? n.hide : this.actions.isSolo(t));
      const dis = !n || (a === 'hide' && !n.hide && s.nodes.every((m, k) => k === t || m.hide)) || (a === 'solo' && s.nodes.length < 2);
      if (b.disabled !== dis) b.disabled = dis;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('is-on', on);
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
    this.refreshSlots();
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
    this.saveBtn.classList.toggle('is-dirty', s.modified || s.presetIndex < CUSTOM_INDEX);
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

    this.syncHud();

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

  /** HUD strip in the top bar: the node meter and the pointer cursor on the tick rail. */
  private syncHud(): void {
    const s = this.store;
    if (!this.hudCells.length) {
      for (let i = 0; i < MAX_NODES; i++) this.hudCells.push(this.hudMeter.appendChild(document.createElement('i')));
    }
    const sel = this.actions.target;
    const key = `${s.nodes.length}|${sel}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.hudCells.forEach((c, i) => {
        c.classList.toggle('is-on', i < s.nodes.length && i !== sel);
        c.classList.toggle('is-sel', i === sel);
      });
      this.hudCount.firstChild!.textContent = String(s.nodes.length).padStart(2, '0');
    }
    const p = this.pointer();
    const x = p.inside ? Math.min(1, Math.max(0, p.x / this.metrics.w)) : -1;
    if (Math.abs(x - this.hudX) > 0.0005) {
      this.hudX = x;
      this.hudCursor.classList.toggle('is-on', x >= 0);
      if (x >= 0) this.hudCursor.style.left = `${(x * 100).toFixed(2)}%`;
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
