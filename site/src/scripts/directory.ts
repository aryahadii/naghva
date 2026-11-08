import { fold } from '../lib/search';
const input = document.getElementById('directory-query') as HTMLInputElement;
const cards = [...document.querySelectorAll<HTMLElement>('#directory-list > li')];
const count = document.getElementById('directory-count')!;
const empty = document.getElementById('directory-empty')!;
const clear = document.getElementById('directory-clear')!;
function update() {
  const q = fold(input.value).replace(/ /g, '');
  for (const card of cards) card.hidden = !card.dataset.names?.replace(/ /g, '').includes(q);
  const n = (v: number) => new Intl.NumberFormat(document.documentElement.lang).format(v);
  count.textContent = count.dataset.template!.replace('{shown}', n(cards.filter((c) => !c.hidden).length)).replace('{total}', n(cards.length));
  empty.hidden = cards.some((c) => !c.hidden);
  clear.hidden = input.value.length === 0;
}
input.addEventListener('input', update);
const reset = () => { input.value = ''; update(); input.focus(); };
document.getElementById('directory-reset')?.addEventListener('click', reset);
clear.addEventListener('click', reset);
update();
