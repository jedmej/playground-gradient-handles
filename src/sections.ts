/**
 * Collapsible spec-panel sections. Every `.spec-section[data-sec]` keeps its ruled header; its title becomes a toggle
 * (chevron at the row's end: up open, down collapsed) and everything under the header is wrapped in one body that
 * hides when collapsed.
 * Header actions (SAVE, ALL OFF) stay usable either way. Collapsed sections are remembered per browser.
 */
const KEY = 'gh.sections.v1';

function load(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function save(closed: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...closed]));
  } catch {
    /* private mode: not remembered */
  }
}

export function initSections(root: HTMLElement): void {
  const closed = load();
  for (const sec of root.querySelectorAll<HTMLElement>('.spec-section[data-sec]')) {
    const id = sec.dataset.sec!;
    const head = sec.querySelector<HTMLElement>(':scope > .label-row');
    const h2 = head?.querySelector('h2');
    if (!head || !h2) continue;

    // Body: every node after the header, moved (not cloned) so ids and listeners stay intact.
    const body = document.createElement('div');
    body.className = 'sec-body';
    body.id = `sec-${id}`;
    while (head.nextSibling) body.appendChild(head.nextSibling);
    sec.appendChild(body);

    // Toggle: the title's own content moves inside a button (live hint spans like #node-hint keep updating).
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sec-toggle';
    btn.setAttribute('aria-controls', body.id);
    // State pip: a small square, hollow collapsed / filled open (the vary-axis checkbox square).
    const pip = document.createElement('i');
    pip.className = 'sec-pip';
    pip.setAttribute('aria-hidden', 'true');
    btn.appendChild(pip);
    while (h2.firstChild) btn.appendChild(h2.firstChild);
    h2.appendChild(btn);
    // Chevron at the row's far right, after any header actions (a click on it toggles via the row).
    const chev = document.createElement('span');
    chev.className = 'sec-chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.innerHTML = '<svg viewBox="0 0 10 6" width="10" height="6"><path d="M1 1l4 4 4-4"/></svg>';
    head.appendChild(chev);

    const set = (open: boolean): void => {
      btn.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
      sec.classList.toggle('is-collapsed', !open);
    };
    set(!closed.has(id));
    // The whole ruled header row toggles, not just the words; its own actions (SAVE, ALL OFF) keep their clicks.
    head.classList.add('sec-head');
    head.addEventListener('click', (e) => {
      const t = e.target as Element;
      if (t.closest('.sec-toggle, .label-actions, button, input, a')) return;
      btn.click();
    });
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      set(open);
      if (open) closed.delete(id);
      else closed.add(id);
      save(closed);
    });
  }
}
