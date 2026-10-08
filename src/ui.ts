import { GradientRenderer } from './gradient';
import type { Metrics } from './handles';
import { PRESETS } from './presets';
import { applyPreset, currentPreset, emit, nodeSerial, type Store } from './store';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export class UI {
  private presetButtons: HTMLButtonElement[] = [];
  private bars: HTMLElement[] = [];
  private statusTimer = 0;
  private exportCount = 0;

  private stateV = $('state-readout');
  private stateGlyph = $('state-glyph');
  private footSerial = $('foot-serial');
  private footDims = $('foot-dims');
  private nodeHint = $('node-hint');
  private nsId = $('ns-id');
  private nsX = $('ns-x');
  private nsY = $('ns-y');
  private nsR = $('ns-r');
  private nsHexV = $('ns-hex-v');
  private nsSwatch = $('ns-swatch');
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
  ) {
    this.buildPresets();
    this.buildBarcode();
    this.exportBtn.addEventListener('click', () => void this.exportPng());
    this.resetBtn.addEventListener('click', () => {
      applyPreset(store, store.presetIndex, now(), true);
      this.say('Reset to ' + currentPreset(store).serial);
    });
    store.listeners.add(() => this.sync());
    this.sync();
  }

  private buildPresets(): void {
    const host = $('presets');
    PRESETS.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.dataset.preset = p.id;
      b.setAttribute('role', 'radio');
      b.innerHTML =
        `<span class="chips" aria-hidden="true">${p.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>` +
        `<span class="preset-serial">${p.serial}</span>` +
        `<span class="preset-name">${p.name}</span>` +
        `<b class="preset-glyph">[>]</b>`;
      b.addEventListener('click', () => {
        if (this.store.presetIndex === i) return;
        applyPreset(this.store, i, this.now(), true);
      });
      host.appendChild(b);
      this.presetButtons.push(b);
    });
  }

  private buildBarcode(): void {
    const host = $('barcode');
    for (let i = 0; i < 9; i++) {
      const bar = document.createElement('i');
      host.appendChild(bar);
      this.bars.push(bar);
    }
  }

  /** Called on store events: things that change rarely. */
  sync(): void {
    const s = this.store;
    this.presetButtons.forEach((b, i) => {
      const on = i === s.presetIndex;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });
    setText(this.railPreset, String(s.presetIndex + 1).padStart(2, '0'));
    const active = this.activeNode();
    setText(this.railNode, active >= 0 ? String(active + 1).padStart(2, '0') : '——');
    this.nodeHint.hidden = active >= 0;
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
    if (s.drag.kind !== 'none') return s.drag.index;
    if (s.hover.kind !== 'idle') return s.hover.index;
    return s.selected ?? s.focused ?? -1;
  }

  /** Called every frame: live readouts. Cheap string compares keep DOM writes rare. */
  frame(): void {
    const s = this.store;
    const m = this.metrics;
    const active = this.activeNode();

    let state = 'IDLE';
    let glyph = '[—]';
    if (s.drag.kind === 'node') { state = `MOVE ${nodeSerial(s.drag.index)}`; glyph = '[✕]'; }
    else if (s.drag.kind === 'ring') { state = `RADIUS ${nodeSerial(s.drag.index)}`; glyph = '[○]'; }
    else if (s.hover.kind === 'node') { state = `NODE ${nodeSerial(s.hover.index)}`; glyph = '[+]'; }
    else if (s.hover.kind === 'ring') { state = `RING ${nodeSerial(s.hover.index)}`; glyph = '[○]'; }
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
      setText(this.nsHexV, n.hex.toUpperCase());
      this.nsSwatch.style.background = n.hex;
      const rn = String(active + 1).padStart(2, '0');
      setText(this.railNode, rn);
    } else {
      setText(this.nsId, '—');
      setText(this.nsX, '—');
      setText(this.nsY, '—');
      setText(this.nsR, '—');
      setText(this.nsHexV, '—');
      this.nsSwatch.style.background = 'transparent';
      setText(this.railNode, '——');
    }
    this.nodeHint.hidden = active >= 0;

    for (let i = 0; i < 9; i++) {
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
    const canvas = document.createElement('canvas');
    let renderer: GradientRenderer | null = null;
    try {
      renderer = new GradientRenderer(canvas, { preserveDrawingBuffer: true });
      renderer.resize(ew, eh, 1);
      const positions = new Float32Array(18);
      const radii = new Float32Array(9);
      const lab = new Float32Array(27);
      const min = Math.min(ew, eh);
      s.nodes.forEach((n, i) => {
        positions[i * 2] = n.x * ew;
        positions[i * 2 + 1] = n.y * eh;
        radii[i] = n.r * min;
        lab.set(n.labTo, i * 3);
      });
      // Same clock as the live field, so the export carries the warp you are looking at.
      renderer.render({ positions, radii, lab, time: s.reducedMotion ? 0.5 : this.now() / 1000, grain: 0.05 });
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('toBlob failed');

      const d = new Date();
      const stamp = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      const serial = currentPreset(s).serial.replace('-', '');
      this.exportCount += 1;
      const suffix = this.exportCount > 1 ? `-${this.exportCount}` : '';
      const name = `GH-${serial}-${stamp}${suffix}.png`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      setText(label, 'Exported');
      this.exportBtn.classList.add('is-done');
      this.say(`Exported ${name} · ${ew}×${eh}`);
    } catch {
      setText(label, 'Export failed');
      this.say('Export failed. Your browser blocked the canvas or the download.');
    } finally {
      renderer?.dispose();
      window.setTimeout(() => {
        setText(label, 'Export PNG');
        this.exportBtn.classList.remove('is-done');
        this.exportBtn.disabled = false;
      }, 1800);
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
