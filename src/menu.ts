import type { Actions } from './actions';
import { MAX_NODES, MIN_NODES, nodeSerial, type LayerMove, type Store } from './store';

interface Item {
  action: string;
  label: string;
  key: string;
}

const ITEMS: (Item | null)[] = [
  { action: 'layer-front', label: 'BRING TO FRONT', key: '⇧]' },
  { action: 'layer-up', label: 'MOVE UP', key: ']' },
  { action: 'layer-down', label: 'MOVE DOWN', key: '[' },
  { action: 'layer-back', label: 'SEND TO BACK', key: '⇧[' },
  null,
  { action: 'menu-lock', label: 'LOCK', key: 'L' },
  { action: 'menu-hide', label: 'HIDE', key: 'H' },
  { action: 'menu-solo', label: 'SOLO', key: '⇧H' },
  null,
  { action: 'menu-delete', label: 'DELETE', key: 'DEL' },
];

const MOVES: Record<string, LayerMove> = {
  'layer-front': 'front',
  'layer-up': 'up',
  'layer-down': 'down',
  'layer-back': 'back',
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Node context menu: a small VOID plate over the stage with the layer commands and DELETE. It follows
 * one node by uid, so any reorder / removal underneath it refreshes (or closes) it.
 */
export class NodeMenu {
  readonly el: HTMLDivElement;
  private head: HTMLElement;
  private buttons: HTMLButtonElement[] = [];
  private uid = -1;
  private openedAt = -Infinity;
  /** Clicks this soon after opening are the opening gesture itself: long for a touch hold, short for a right-click. */
  private guardMs = 450;
  /** True from a hold-open until shortly after that finger lifts. */
  private holding = false;

  constructor(
    private store: Store,
    private stage: HTMLElement,
    private actions: Actions,
    /** Put keyboard focus back on a node's reticle (after a keyboard-driven command). */
    private focusNode: (i: number) => void,
  ) {
    const el = document.createElement('div');
    el.className = 'node-menu';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', 'Node menu');
    el.dataset.testid = 'node-menu';
    el.hidden = true;
    this.head = document.createElement('div');
    this.head.className = 'menu-head';
    this.head.setAttribute('role', 'presentation');
    el.appendChild(this.head);
    for (const it of ITEMS) {
      if (!it) {
        const hr = document.createElement('div');
        hr.className = 'menu-sep';
        hr.setAttribute('role', 'separator');
        el.appendChild(hr);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item' + (it.action === 'menu-delete' ? ' is-danger' : '');
      b.setAttribute('role', 'menuitem');
      b.dataset.action = it.action;
      b.innerHTML = `<span class="mi-l">${it.label}</span><kbd>${it.key}</kbd>`;
      b.addEventListener('click', () => {
        // The finger / button that opened the menu is still coming up over it: that release is not a choice.
        if (this.holding || (performance.now() - this.openedAt < this.guardMs && !this.el.classList.contains('is-kb'))) return;
        this.activate(it.action);
      });
      el.appendChild(b);
      this.buttons.push(b);
    }
    this.el = el;
    stage.appendChild(el);

    // The menu is a child of the stage: keep its gestures away from the stage's pointer handling.
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick']) {
      el.addEventListener(t, (e) => e.stopPropagation());
    }
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener('wheel', (e) => {
      e.stopPropagation();
      this.close();
    }, { passive: true });
    el.addEventListener('keydown', (e) => this.onKey(e));

    window.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !el.contains(e.target as Node)) this.close();
    }, { capture: true });
    const release = (): void => {
      if (this.holding) window.setTimeout(() => (this.holding = false), 350);
    };
    window.addEventListener('pointerup', release, { capture: true });
    window.addEventListener('pointercancel', release, { capture: true });
    window.addEventListener('blur', () => this.close());
    window.addEventListener('scroll', () => this.close(), { passive: true });
    window.addEventListener('resize', () => this.close());
    store.listeners.add(() => this.refresh());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  private index(): number {
    return this.store.nodes.findIndex((n) => n.uid === this.uid);
  }

  /** Header text and enabled state follow the node's current layer. Closes if the node is gone. */
  private refresh(): void {
    if (!this.isOpen) return;
    const i = this.index();
    if (i < 0) {
      this.close();
      return;
    }
    const count = this.store.nodes.length;
    const n = this.store.nodes[i];
    // Lock / hide / solo read as what pressing them would do next.
    const labels: Record<string, string> = {
      'menu-lock': n.lock ? 'UNLOCK' : 'LOCK',
      'menu-hide': n.hide ? 'SHOW' : 'HIDE',
      'menu-solo': this.actions.isSolo(i) ? 'UNSOLO' : 'SOLO',
    };
    for (const b of this.buttons) {
      const want = labels[b.dataset.action!];
      const l = b.firstElementChild as HTMLElement;
      if (want && l.textContent !== want) l.textContent = want;
    }
    this.head.textContent = `${nodeSerial(i)} · LYR ${pad2(i + 1)}/${pad2(count)}`;
    const off: Record<string, boolean> = {
      'layer-front': i === count - 1,
      'layer-up': i === count - 1,
      'layer-down': i === 0,
      'layer-back': i === 0,
      'menu-hide': !n.hide && this.store.nodes.every((m, k) => k === i || m.hide),
      'menu-solo': count < 2,
      'menu-delete': count <= MIN_NODES,
    };
    for (const b of this.buttons) {
      const dis = !!off[b.dataset.action!];
      if (b.disabled !== dis) b.disabled = dis;
    }
  }

  /** Open at stage-local (x, y) for node `i`. Focus lands on the first enabled item. */
  open(i: number, x: number, y: number, viaKey = false, holding = false): void {
    const n = this.store.nodes[i];
    if (!n) return;
    this.holding = holding;
    this.guardMs = holding ? 450 : 120;
    this.uid = n.uid;
    this.openedAt = performance.now();
    this.el.classList.toggle('is-kb', viaKey);
    this.el.hidden = false;
    this.refresh();
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    const mw = this.el.offsetWidth;
    const mh = this.el.offsetHeight;
    let left = x + 2;
    let top = y + 2;
    if (left + mw > w - 4) left = x - mw - 2;
    if (top + mh > h - 4) top = y - mh - 2;
    left = Math.max(4, Math.min(left, w - mw - 4));
    top = Math.max(4, Math.min(top, h - mh - 4));
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
    this.enabled()[0]?.focus({ preventScroll: true });
    this.store.say(`${nodeSerial(this.index())} · MENU`);
  }

  close(restoreFocus = false): void {
    if (!this.isOpen) return;
    const i = this.index();
    this.el.hidden = true;
    this.el.classList.remove('is-kb');
    this.uid = -1;
    if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    if (restoreFocus && i >= 0) this.focusNode(i);
  }

  private enabled(): HTMLButtonElement[] {
    return this.buttons.filter((b) => !b.disabled);
  }

  private activate(action: string): void {
    const i = this.index();
    const viaKey = this.el.classList.contains('is-kb');
    this.close();
    if (i < 0) return;
    if (action === 'menu-delete') {
      this.actions.removeAt(i);
      return;
    }
    if (action === 'menu-lock' || action === 'menu-hide' || action === 'menu-solo') {
      if (action === 'menu-lock') this.actions.toggleLock(i);
      else if (action === 'menu-hide') this.actions.toggleHide(i);
      else this.actions.solo(i);
      if (viaKey) this.focusNode(i);
      return;
    }
    const move = MOVES[action];
    if (!move) return;
    this.actions.moveLayer(i, move);
    if (viaKey && this.store.selected !== null) this.focusNode(this.store.selected);
  }

  private onKey(e: KeyboardEvent): void {
    const items = this.enabled();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (k: number): void => {
      e.preventDefault();
      this.el.classList.add('is-kb');
      items[(k + items.length) % items.length]?.focus({ preventScroll: true });
    };
    switch (e.key) {
      case 'ArrowDown': go(at + 1); break;
      case 'ArrowUp': go(at < 0 ? items.length - 1 : at - 1); break;
      case 'Home': go(0); break;
      case 'End': go(items.length - 1); break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
        break;
      case 'Tab':
        this.close();
        break;
      default:
        // Layer / radius shortcuts keep working with the menu open (they act on the selected node).
        return;
    }
    e.stopPropagation();
  }
}

/**
 * Board menu: right-click on the artboard away from any node. The node menu's plate with ADD NODE [+] (the
 * double-click add at the click point, colour = the field under the point; mirror partners too when MIRROR is on) and DRAW.
 */
export class BoardMenu {
  readonly el: HTMLDivElement;
  /** A triangle marker at the click point while the menu is open: its tip is where ADD NODE will drop the node. */
  private mark: HTMLDivElement;
  private addBtn: HTMLButtonElement;
  private at = { x: 0, y: 0 };
  private openedAt = -Infinity;

  constructor(
    private store: Store,
    private stage: HTMLElement,
    private actions: Actions,
    /** Stage size, for turning the click point into normalised coordinates. */
    private size: () => { w: number; h: number },
  ) {
    const el = document.createElement('div');
    el.className = 'node-menu board-menu';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', 'Artboard menu');
    el.dataset.testid = 'board-menu';
    el.hidden = true;
    const head = document.createElement('div');
    head.className = 'menu-head';
    head.setAttribute('role', 'presentation');
    head.textContent = 'ARTBOARD';
    el.appendChild(head);
    const item = (action: string, label: string, key: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.setAttribute('role', 'menuitem');
      b.dataset.action = action;
      b.innerHTML = `<span class="mi-l">${label}</span><kbd>${key}</kbd>`;
      b.addEventListener('click', () => {
        if (performance.now() - this.openedAt < 120 && !el.classList.contains('is-kb')) return;
        this.activate(action);
      });
      el.appendChild(b);
      return b;
    };
    this.addBtn = item('board-add', 'ADD NODE', '[+]');
    item('board-draw', 'DRAW', '[D]');
    this.el = el;
    // A small SIGNAL triangle standing on the click point (its tip is the exact spot), clear of the menu below-right.
    const mark = document.createElement('div');
    mark.className = 'board-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.hidden = true;
    const tri = 'M0 0L-6 -10H6Z';
    mark.innerHTML = `<svg viewBox="-20 -20 40 40" width="40" height="40"><path class="halo" d="${tri}"/><path class="ink" d="${tri}"/></svg>`;
    this.mark = mark;
    stage.append(mark, el);
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick']) {
      el.addEventListener(t, (e) => e.stopPropagation());
    }
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener('wheel', (e) => {
      e.stopPropagation();
      this.close();
    }, { passive: true });
    el.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !el.contains(e.target as Node)) this.close();
    }, { capture: true });
    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Open at stage-local (x, y), the point ADD NODE will use. */
  open(x: number, y: number): void {
    this.at = { x, y };
    this.openedAt = performance.now();
    this.addBtn.disabled = this.store.nodes.length >= MAX_NODES;
    this.mark.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    this.mark.hidden = false;
    this.el.hidden = false;
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    const mw = this.el.offsetWidth;
    const mh = this.el.offsetHeight;
    let left = x + 2;
    let top = y + 2;
    if (left + mw > w - 4) left = x - mw - 2;
    if (top + mh > h - 4) top = y - mh - 2;
    this.el.style.left = `${Math.round(Math.max(4, Math.min(left, w - mw - 4)))}px`;
    this.el.style.top = `${Math.round(Math.max(4, Math.min(top, h - mh - 4)))}px`;
    [...this.el.querySelectorAll<HTMLButtonElement>('.menu-item')].find((b) => !b.disabled)?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.mark.hidden = true;
    this.el.classList.remove('is-kb');
    if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  private activate(action: string): void {
    this.close();
    if (action === 'board-add') {
      const { w, h } = this.size();
      this.actions.addAt(this.at.x / w, this.at.y / h, true);
    } else if (action === 'board-draw') {
      this.actions.setDraw(true);
    }
  }

  private onKey(e: KeyboardEvent): void {
    const items = [...this.el.querySelectorAll<HTMLButtonElement>('.menu-item')].filter((b) => !b.disabled);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (k: number): void => {
      e.preventDefault();
      this.el.classList.add('is-kb');
      items[(k + items.length) % items.length]?.focus({ preventScroll: true });
    };
    switch (e.key) {
      case 'ArrowDown': go(at + 1); break;
      case 'ArrowUp': go(at < 0 ? items.length - 1 : at - 1); break;
      case 'Escape':
        e.preventDefault();
        this.close();
        break;
      case 'Tab':
        this.close();
        break;
      default:
        return;
    }
    e.stopPropagation();
  }
}
