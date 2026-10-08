import { CUSTOM_INDEX, defaultSoft, emit, reconcile, snapshotIdentified, type NodeSpec, type Store } from './store';

interface Snapshot {
  presetIndex: number;
  modified: boolean;
  nodes: NodeSpec[];
}

interface Entry {
  label: string;
  snap: Snapshot;
}

const CAP = 50;
const EPS = 1e-6;

function take(store: Store): Snapshot {
  return { presetIndex: store.presetIndex, modified: store.modified, nodes: snapshotIdentified(store) };
}

function same(a: Snapshot, b: Snapshot): boolean {
  if (a.nodes.length !== b.nodes.length) return false;
  return a.nodes.every((n, i) => {
    const m = b.nodes[i];
    return (
      Math.abs(n.x - m.x) < EPS && Math.abs(n.y - m.y) < EPS && Math.abs(n.r - m.r) < EPS &&
      n.hex === m.hex && n.uid === m.uid &&
      (n.shape ?? 'circle') === (m.shape ?? 'circle') &&
      Math.abs((n.rot ?? 0) - (m.rot ?? 0)) < EPS &&
      Math.abs((n.soft ?? defaultSoft(n.shape)) - (m.soft ?? defaultSoft(m.shape))) < EPS &&
      samePts(n.pts, m.pts)
    );
  });
}

function samePts(a: NodeSpec['pts'], b: NodeSpec['pts']): boolean {
  const la = a?.length ?? 0;
  if (la !== (b?.length ?? 0)) return false;
  for (let i = 0; i < la; i++) {
    if (Math.abs(a![i][0] - b![i][0]) >= EPS || Math.abs(a![i][1] - b![i][1]) >= EPS) return false;
  }
  return true;
}

/** Cheap snapshot stack: each entry is the state *before* an edit. */
export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private pending: Snapshot | null = null;

  constructor(
    private store: Store,
    private now: () => number,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Gesture start: remember the state, push nothing until `commit`. */
  begin(): void {
    this.pending = take(this.store);
  }

  /** Gesture abandoned: forget the remembered state without pushing anything. */
  cancel(): void {
    this.pending = null;
  }

  /** Gesture end: push the remembered state if anything changed (or `force`). */
  commit(label: string, force = false): void {
    const before = this.pending;
    this.pending = null;
    if (!before) return;
    if (!force && same(before, take(this.store))) return;
    this.push(label, before);
  }

  /** Discrete edit: call BEFORE mutating. Reuses a pending gesture snapshot if one is open. */
  mark(label: string): void {
    if (!this.pending) this.pending = take(this.store);
    this.commit(label, true);
  }

  private push(label: string, snap: Snapshot): void {
    this.undoStack.push({ label, snap });
    if (this.undoStack.length > CAP) this.undoStack.shift();
    this.redoStack = [];
    this.store.modified = true;
    emit(this.store);
  }

  private restore(snap: Snapshot): void {
    const s = this.store;
    const orphan = snap.presetIndex === CUSTOM_INDEX && !s.custom;
    s.presetIndex = orphan ? 0 : snap.presetIndex;
    s.modified = orphan || snap.modified;
    reconcile(s, snap.nodes, this.now(), true, 320);
    emit(s);
  }

  undo(): string | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push({ label: e.label, snap: take(this.store) });
    this.restore(e.snap);
    return e.label;
  }

  redo(): string | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push({ label: e.label, snap: take(this.store) });
    this.restore(e.snap);
    return e.label;
  }
}
