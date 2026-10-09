import '@fontsource-variable/big-shoulders-display';
import '@fontsource-variable/martian-mono/wdth.css';
import '@fontsource/inter-tight/latin-500.css';
import '@fontsource/inter-tight/latin-600.css';
import './styles.css';

import { blueNoise } from './bluenoise';
import { createFxPersist, loadFxStorage, rememberFx } from './fx';
import { FxDial } from './fxdial';
import { FxPanel, WallpaperPanel } from './fxpanel';
import { GradientRenderer } from './gradient';
import { Actions } from './actions';
import { library } from './custom';
import { createMetrics, Handles } from './handles';
import { History } from './history';
import { FieldBuffers, packField } from './field';
import { Output } from './output';
import { createStore, EASE } from './store';
import { drawRulers, UI } from './ui';
import { wallpaperTarget } from './wallpaper';

const store = createStore();
store.slots = library.load();
store.custom = store.slots[0];
const savedFx = loadFxStorage();
if (savedFx) {
  store.fx = savedFx.fx;
  store.wallpaper = savedFx.wp;
  store.wpCustom = savedFx.cs;
}
rememberFx(store.fx);
const persistFx = createFxPersist(store.fx, store.wallpaper, store.wpCustom);
// ~60 ms of one-off work (deterministic, cached for every context incl. the export one).
blueNoise();
const stage = document.getElementById('stage') as HTMLElement;
const canvas = document.getElementById('field') as HTMLCanvasElement;
const svg = document.getElementById('handles') as unknown as SVGSVGElement;
const chipNode = document.getElementById('chip-node') as HTMLElement;
const chipRadius = document.getElementById('chip-radius') as HTMLElement;

// ----- PREVIEW [P]: bare wallpaper. `.is-preview` on the stage frame hides the furniture (CSS); these window-capture
// listeners are registered before any other component's, so while it is on the stage never sees a pointer / wheel
// event and no edit key reaches the handlers (the stage stays inert).
const previewFrame = stage.parentElement as HTMLElement;
const previewBtn = document.querySelector<HTMLButtonElement>('[data-action="preview"]')!;
const isPreview = (): boolean => previewFrame.classList.contains('is-preview');
const TYPING = 'input:not([type=color]):not([type=checkbox]), textarea, select, [contenteditable=""], [contenteditable="true"]';
function setPreview(on: boolean): void {
  if (on === isPreview()) return;
  if (on && (store.drag.kind !== 'none' || store.drawing)) return;
  if (on) {
    fxDial.close();
    if (store.tool === 'draw') actions.setDraw(false);
    const a = document.activeElement as HTMLElement | null;
    if (a && stage.contains(a)) a.blur();
  }
  previewFrame.classList.toggle('is-preview', on);
  document.querySelector('.stage-col')?.classList.toggle('is-preview', on); // hides toolbar groups + shortcut strip
  previewBtn.setAttribute('aria-pressed', String(on));
}
previewBtn.addEventListener('click', () => setPreview(!isPreview()));
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerover', 'pointerout', 'click', 'dblclick', 'contextmenu', 'wheel']) {
  window.addEventListener(
    type,
    (e) => {
      if (!isPreview() || !(e.target instanceof Node) || !stage.contains(e.target)) return;
      e.stopImmediatePropagation();
      if (e.cancelable && type !== 'pointermove') e.preventDefault();
    },
    { capture: true, passive: false },
  );
}
window.addEventListener(
  'keydown',
  (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(TYPING)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod && !e.altKey && !e.repeat && (e.key === 'p' || e.key === 'P' || (e.key === 'Escape' && isPreview()))) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setPreview(e.key === 'Escape' ? false : !isPreview());
      return;
    }
    if (!isPreview()) return;
    // Anything that could mutate the composition is swallowed; Tab, and Enter / Space on a button, stay usable.
    if (e.key === 'Tab' || e.key === 'F5' || e.key.startsWith('F') && e.key.length > 1) return;
    if ((e.key === 'Enter' || e.key === ' ') && t?.closest?.('button, a, [role="button"]') && !stage.contains(t)) return;
    if (mod && !/^[zy]$/i.test(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  },
  { capture: true },
);

// EXPORT [E]: same as clicking the toolbar button (wallpaper target size); ⇧E = the quick 2048 px copy.
window.addEventListener('keydown', (e) => {
  if ((e.key !== 'e' && e.key !== 'E') || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.(TYPING) || t?.closest?.('[data-fx-knob], [data-fx-ring]')) return;
  e.preventDefault();
  document.getElementById('export')?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: e.shiftKey }));
});

const now = (): number => performance.now();
const metrics = createMetrics();
const history = new History(store, now);
const actions = new Actions(store, history, metrics, now);
const handles = new Handles(store, stage, svg, chipNode, chipRadius, metrics, actions, history);
const ui = new UI(store, handles.metrics, now, () => ({ ...handles.pointer, inside: handles.pointerInside }), actions, history);
actions.bindKeys();
new FxPanel(store, actions, history);
new WallpaperPanel(store, handles.metrics, now);
new Output(store, actions, handles.metrics, now, isPreview);
const fxDial = new FxDial(store, actions, history, stage, handles.metrics, (x, y) => handles.emptyAt(x, y), () => handles.busy());

import.meta.hot?.dispose(() => fxDial.destroy());

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

const frame = stage.parentElement as HTMLElement;
// The artboard area sits between the toolbar and the shortcut strip; it is the box the artboard is fitted into.
const stageArea = frame.parentElement as HTMLElement;
const toolbarEl = document.getElementById('toolbar') as HTMLElement;
const MOBILE = matchMedia('(max-width: 959px)');
let fitWp = store.wallpaper;
let fitCw = store.wpCustom.w;
let fitCh = store.wpCustom.h;

/**
 * WYSIWYG framing: the stage takes the selected wallpaper's aspect, fitted (contain) inside the stage column and
 * centred. Rulers / foot share the frame's grid, so exact px tracks keep them aligned. Everything else (canvas,
 * handles, hit-testing, readouts, FX) already derives from the stage's measured box in layout().
 * Desktop: the column's own box bounds it. Stacked mobile: the column's height follows the stage, so only its
 * width counts and the height is capped to ~68 % of the viewport (a phone target stays on screen).
 */
function fitStage(): void {
  const cs = getComputedStyle(stageArea);
  const root = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--foot-row')) || 22;
  const availW = stageArea.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 18;
  const availH = MOBILE.matches
    ? Math.max(240, window.innerHeight * 0.68) - 18 - root
    : stageArea.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 18 - root;
  const t = wallpaperTarget(store.wallpaper, store.wpCustom);
  const k = Math.min(availW / t.w, availH / t.h);
  if (!(k > 0)) return;
  frame.style.setProperty('--sw', `${Math.max(60, Math.floor(t.w * k))}px`);
  frame.style.setProperty('--sh', `${Math.max(60, Math.floor(t.h * k))}px`);
  frame.classList.add('is-fit');
}

function layout(): void {
  fitStage();
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
ro.observe(stageArea); // changes when the toolbar wraps / unwraps, the strip re-flows, or the panel collapses
ro.observe(toolbarEl);
window.addEventListener('resize', layout);
window.addEventListener('scroll', () => handles.updateMetrics(), { passive: true });
matchMedia('(pointer: coarse)').addEventListener('change', (e) => (store.coarse = e.matches));
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => (store.reducedMotion = e.matches));
layout();

// ----- PANEL [\]: collapse the right spec column. The class lives on <html> (set pre-paint by the inline script in
// index.html); the CSS transition animates the grid track, the ResizeObserver above re-fits during it, and a final
// layout() on transitionend guarantees the canvas ends crisp at the settled size.
const specEl = document.getElementById('spec') as HTMLElement;
const panelBtn = document.getElementById('panel-toggle') as HTMLButtonElement;
const panelOff = (): boolean => document.documentElement.classList.contains('panel-off');
function syncPanel(): void {
  const off = panelOff();
  specEl.toggleAttribute('inert', off);
  panelBtn.setAttribute('aria-expanded', String(!off));
  panelBtn.title = off ? 'Show panel (\\)' : 'Hide panel (\\)';
  (panelBtn.lastElementChild as HTMLElement).textContent = off ? '[«]' : '[»]';
}
function setPanel(open: boolean): void {
  if (open === !panelOff()) return;
  document.documentElement.classList.toggle('panel-off', !open);
  if (!open && specEl.contains(document.activeElement)) panelBtn.focus();
  try {
    localStorage.setItem('gh.panel.v1', open ? '1' : '0');
  } catch {
    /* private mode / blocked storage: the state just is not remembered */
  }
  syncPanel();
  if (store.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) layout();
}
syncPanel();
panelBtn.addEventListener('click', () => setPanel(panelOff()));
document.body.addEventListener('transitionend', (e) => {
  if (e.target === document.body && e.propertyName === 'grid-template-columns') layout();
});
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Backslash' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.(TYPING) || t?.closest?.('[data-fx-knob], [data-fx-ring]') || isPreview() || MOBILE.matches) return;
  e.preventDefault();
  setPanel(panelOff());
});

// ----- THEME [M]: light / dark. data-theme on <html> is set pre-paint by the inline script in index.html (stored choice,
// else the OS preference). With no stored choice the page keeps following the OS; a click or M stores it.
const themeBtn = document.getElementById('theme-toggle') as HTMLButtonElement;
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const isDark = (): boolean => document.documentElement.dataset.theme === 'dark';
function syncTheme(): void {
  const dark = isDark();
  themeBtn.setAttribute('aria-pressed', String(dark));
  themeBtn.title = dark ? 'Dark mode on: switch to light (M)' : 'Dark mode off: switch to dark (M)';
  (themeBtn.lastElementChild as HTMLElement).textContent = dark ? '[◑]' : '[◐]';
}
function applyTheme(dark: boolean): void {
  const root = document.documentElement;
  const swap = (): void => {
    root.dataset.theme = dark ? 'dark' : 'light';
    syncTheme();
  };
  // Per-element transitions are off for the swap; one View Transition crossfades the page. No API / reduced motion: instant.
  root.classList.add('theme-switching');
  const done = (): void => void requestAnimationFrame(() => root.classList.remove('theme-switching'));
  const animate = !(store.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (animate && typeof document.startViewTransition === 'function') {
    const vt = document.startViewTransition(swap);
    vt.ready.catch(() => {}); // a rapid second toggle skips the first transition: not an error
    vt.finished.then(done, done);
  } else {
    swap();
    done();
  }
}
function setTheme(dark: boolean): void {
  applyTheme(dark);
  try {
    localStorage.setItem('gh.theme.v1', dark ? 'dark' : 'light');
  } catch {
    /* private mode / blocked storage: the choice just is not remembered */
  }
}
syncTheme();
themeBtn.addEventListener('click', () => setTheme(!isDark()));
darkQuery.addEventListener('change', (e) => {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('gh.theme.v1');
  } catch {
    /* ignore */
  }
  if (stored !== 'dark' && stored !== 'light') applyTheme(e.matches);
});
window.addEventListener('keydown', (e) => {
  if ((e.key !== 'm' && e.key !== 'M') || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.(TYPING) || t?.closest?.('[data-fx-knob], [data-fx-ring]')) return;
  e.preventDefault();
  setTheme(!isDark());
});

let last = now();
function tick(): void {
  const t = now();
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  if (store.wallpaper !== fitWp || store.wpCustom.w !== fitCw || store.wpCustom.h !== fitCh) {
    fitWp = store.wallpaper;
    fitCw = store.wpCustom.w;
    fitCh = store.wpCustom.h;
    layout();
  }

  // Colour tween in OKLab, one clock per node.
  for (const n of store.nodes) {
    const k = n.dur > 0 ? EASE((t - n.t0) / n.dur) : 1;
    for (let c = 0; c < 3; c++) n.lab[c] = n.labFrom[c] + (n.labTo[c] - n.labFrom[c]) * k;
  }

  handles.frame(dt);

  packField(store, handles.metrics, buffers);
  renderer?.render({ ...buffers, time: store.reducedMotion ? 0.5 : t / 1000, grain: 0.04 }, store.fx);
  persistFx(store.fx, store.wallpaper, store.wpCustom);

  ui.frame();
  fxDial.frame();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
