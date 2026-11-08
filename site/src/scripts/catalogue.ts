import { compareDates } from '../lib/catalogue';
import { fold } from '../lib/search';

const shelf = document.getElementById('catalog');
const expand = document.getElementById('catalog-expand') as HTMLButtonElement | null;
const tools = document.getElementById('catalog-tools');
const query = document.getElementById('catalog-query') as HTMLInputElement | null;
const sort = document.getElementById('catalog-sort') as HTMLSelectElement | null;
const count = document.getElementById('catalog-count');
const empty = document.getElementById('catalog-empty');
if (shelf && expand && tools && query && sort && count && empty) {
  const cards = [...shelf.children] as HTMLElement[];
  const update = () => {
    let shown = 0;
    for (const card of cards) {
      card.hidden = !card.dataset.names?.replace(/ /g, '').includes(fold(query.value).replace(/ /g, ''));
      if (!card.hidden) shown++;
    }
    cards.sort((a, b) => compareDates({ id: a.dataset.id!, date: a.dataset.date }, { id: b.dataset.id!, date: b.dataset.date }, sort.value === 'newest'));
    shelf.append(...cards);
    const n = (v: number) => new Intl.NumberFormat(document.documentElement.lang).format(v);
    count.textContent = count.dataset.template!.replace('{shown}', n(shown)).replace('{total}', n(cards.length));
    empty.hidden = shown > 0;
  };
  const reset = () => { query.value = ''; sort.value = 'newest'; update(); };
  expand.addEventListener('click', () => {
    const open = expand.getAttribute('aria-expanded') !== 'true';
    expand.setAttribute('aria-expanded', String(open));
    expand.textContent = open ? expand.dataset.collapse! : expand.dataset.expand!;
    shelf.classList.toggle('catalog-grid', open);
    tools.hidden = !open;
    document.querySelector<HTMLElement>('[data-shelf="catalog"]')?.toggleAttribute('hidden', open);
    if (open) { update(); query.focus(); }
    else { reset(); expand.focus(); }
  });
  query.addEventListener('input', update);
  sort.addEventListener('change', update);
  document.getElementById('catalog-reset')?.addEventListener('click', () => { reset(); query.focus(); });
}
