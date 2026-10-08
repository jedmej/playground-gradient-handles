import '@fontsource-variable/big-shoulders-display';
import '@fontsource-variable/martian-mono/wdth.css';
import '@fontsource/inter-tight/latin-500.css';
import '@fontsource/inter-tight/latin-600.css';
import './styles.css';

import { GradientRenderer } from './gradient';
import { Actions } from './actions';
import { loadCustom } from './custom';
import { createMetrics, Handles } from './handles';
import { History } from './history';
import { FieldBuffers, packField } from './field';
import { createStore, EASE } from './store';
import { drawRulers, UI } from './ui';

const store = createStore();
store.custom = loadCustom();
const stage = document.getElementById('stage') as HTMLElement;
const canvas = document.getElementById('field') as HTMLCanvasElement;
const svg = document.getElementById('handles') as unknown as SVGSVGElement;
const chipNode = document.getElementById('chip-node') as HTMLElement;
const chipRadius = document.getElementById('chip-radius') as HTMLElement;

const now = (): number => performance.now();
const metrics = createMetrics();
const history = new History(store, now);
const actions = new Actions(store, history, metrics, now);
const handles = new Handles(store, stage, svg, chipNode, chipRadius, metrics, actions, history);
const ui = new UI(store, handles.metrics, now, () => ({ ...handles.pointer, inside: handles.pointerInside }), actions, history);
actions.bindKeys();

let renderer: GradientRenderer | null = null;
try {
  renderer = new GradientRenderer(canvas);
} catch {
  stage.classList.add('no-webgl');
  document.getElementById('status')!.textContent = 'WebGL is unavailable in this browser. The field needs it.';
}

const buffers = new FieldBuffers();

const wordmark = document.querySelector('.wordmark') as HTMLElement;
const wordmarkText = wordmark.firstElementChild as HTMLElement;

/** Scale the rail wordmark so it exactly fills whatever length the rail leaves it. */
function fitWordmark(): void {
  const vertical = getComputedStyle(wordmark).writingMode.startsWith('vertical');
  wordmark.style.fontSize = '100px';
  const box = wordmark.getBoundingClientRect();
  const text = wordmarkText.getBoundingClientRect();
  if (!box.width || !box.height || !text.width || !text.height) return;
  const along = vertical ? box.height / text.height : box.width / text.width;
  const across = vertical ? box.width / text.width : box.height / text.height;
  const size = Math.max(20, Math.min(140, Math.floor(100 * Math.min(along, across)) - 1));
  wordmark.style.fontSize = `${size}px`;
}

function layout(): void {
  handles.updateMetrics();
  const m = handles.metrics;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer?.resize(m.w, m.h, dpr);
  drawRulers(m);
  fitWordmark();
}
document.fonts.ready.then(fitWordmark);

const ro = new ResizeObserver(() => layout());
ro.observe(stage);
window.addEventListener('resize', layout);
window.addEventListener('scroll', () => handles.updateMetrics(), { passive: true });
matchMedia('(pointer: coarse)').addEventListener('change', (e) => (store.coarse = e.matches));
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => (store.reducedMotion = e.matches));
layout();

let last = now();
function tick(): void {
  const t = now();
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;

  // Colour tween in OKLab, one clock per node.
  for (const n of store.nodes) {
    const k = n.dur > 0 ? EASE((t - n.t0) / n.dur) : 1;
    for (let c = 0; c < 3; c++) n.lab[c] = n.labFrom[c] + (n.labTo[c] - n.labFrom[c]) * k;
  }

  handles.frame(dt);

  packField(store, handles.metrics, buffers);
  renderer?.render({ ...buffers, time: store.reducedMotion ? 0.5 : t / 1000, grain: 0.04 });

  ui.frame();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
