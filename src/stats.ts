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

/**
 * The REV plate: `[data-build="version|sha|date|env"]` get the build stamp vite.config.ts injects, so each deploy
 * shows its own commit and date (version `6.1.0` → `06.1`; date as `YY.MM.DD`).
 */
export function renderBuild(): void {
  const [maj, min] = __BUILD_VERSION__.split('.');
  const d = new Date(__BUILD_DATE__);
  const two = (n: number): string => String(n).padStart(2, '0');
  const values: Record<string, string> = {
    version: `${two(Number(maj) || 0)}.${Number(min) || 0}`,
    sha: __BUILD_SHA__.toUpperCase(),
    date: `${two(d.getUTCFullYear() % 100)}.${two(d.getUTCMonth() + 1)}.${two(d.getUTCDate())}`,
    env: import.meta.env.DEV ? 'DEV' : 'LIVE',
  };
  document.querySelectorAll<HTMLElement>('[data-build]').forEach((el) => {
    const v = values[el.dataset.build!];
    if (v) el.textContent = v;
  });
}
