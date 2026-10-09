/**
 * Local usage counters for the footer and the rail: VISITS (page loads) and EXPORTS (PNG downloads). Kept in this
 * browser's `localStorage` (`gh.stats.v1`); nothing leaves the page. Any element with `data-stat="visits|exports"`
 * shows the count, zero-padded to four digits.
 */
export type StatId = 'visits' | 'exports';

const KEY = 'gh.stats.v1';

function load(): Record<StatId, number> {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Record<StatId, unknown>> | null;
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return { visits: n(o?.visits), exports: n(o?.exports) };
  } catch {
    return { visits: 0, exports: 0 };
  }
}

let stats = load();

const pad4 = (v: number): string => String(Math.min(v, 9999)).padStart(4, '0');

export function renderStats(): void {
  document.querySelectorAll<HTMLElement>('[data-stat]').forEach((el) => {
    const id = el.dataset.stat as StatId;
    if (id in stats) el.textContent = pad4(stats[id]);
  });
}

/** Count one more `id` (best effort: blocked storage just keeps the in-memory count for this session). */
export function bumpStat(id: StatId): void {
  stats = { ...load(), [id]: load()[id] + 1 };
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // not remembered
  }
  renderStats();
}
