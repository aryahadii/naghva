/** Recordings and events sit in one row each; the arrows appear only when the row overflows. */

const rtl = document.documentElement.dir === 'rtl';

function sync(list: HTMLElement) {
  const controls = document.querySelector<HTMLElement>(`[data-shelf="${list.id}"]`);
  const max = list.scrollWidth - list.clientWidth;
  const at = Math.abs(list.scrollLeft);
  list.classList.toggle('has-more', at < max - 2);
  if (!controls) return;
  controls.hidden = list.classList.contains('catalog-grid') || max < 2;
  const [back, forward] = controls.querySelectorAll('button');
  back.disabled = at < 2;
  forward.disabled = at > max - 2;
}

for (const list of document.querySelectorAll<HTMLElement>('.shelf')) {
  list.addEventListener('scroll', () => sync(list), { passive: true });
  new ResizeObserver(() => sync(list)).observe(list);
  sync(list);
}

for (const controls of document.querySelectorAll<HTMLElement>('.shelf-controls')) {
  controls.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-step]');
    const list = document.getElementById(controls.dataset.shelf!);
    if (!button || !list) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollBy({ left: Number(button.dataset.step) * list.clientWidth * 0.8 * (rtl ? -1 : 1), behavior: reduce ? 'auto' : 'smooth' });
  });
}

export {};
