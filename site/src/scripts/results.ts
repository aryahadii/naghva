import { searchPage, type SearchIndex } from '../lib/search';
import { trackSearchUse } from './analytics';
const root = document.querySelector<HTMLElement>('[data-search-page]')!;
const words = JSON.parse(root.dataset.words!);
const lang = document.documentElement.lang as 'en' | 'fa';
const form = document.getElementById('results-form') as HTMLFormElement;
const input = document.getElementById('results-query') as HTMLInputElement;
const status = document.getElementById('results-status')!;
const retry = document.getElementById('results-retry')!;
const list = document.getElementById('results-list')!;
const pages = document.getElementById('results-pages')!;
let index: SearchIndex | undefined;
let generation = 0;
const n = (v: number) => new Intl.NumberFormat(lang).format(v);
const at = (query: string, page: number) => `/${lang}/search/?${new URLSearchParams({ q: query, page: String(page) })}`;
async function render() {
  const current = ++generation;
  const params = new URLSearchParams(location.search);
  const query = params.get('q') ?? '';
  input.value = query;
  list.replaceChildren(); pages.replaceChildren(); retry.hidden = true;
  if (!query.trim()) { status.textContent = words.placeholder; return; }
  trackSearchUse('results');
  status.textContent = words.loading;
  try {
    if (!index) {
      const response = await fetch('/search.json');
      if (!response.ok) throw new Error(String(response.status));
      index = await response.json();
    }
    if (current !== generation) return;
    const result = searchPage(index!, query, lang, Number(params.get('page') ?? 1));
    status.textContent = result.total ? (result.total === 1 ? words.results.one : words.results.other.replace('{count}', n(result.total))) : words.empty.replace('{query}', query);
    for (const entry of result.entries) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `/${lang}${entry.h}`;
      const title = entry.n[lang] ?? entry.n[lang === 'en' ? 'fa' : 'en'];
      a.textContent = title?.text ?? entry.i;
      a.lang = title?.language ?? lang;
      a.dir = title?.language === 'fa' ? 'rtl' : 'ltr';
      const meta = document.createElement('p');
      meta.textContent = words.kinds[entry.k];
      li.append(a, meta); list.append(li);
    }
    if (result.pages > 1) {
      const make = (page: number, label: string) => {
        const a = document.createElement('a'); a.className = 'pill'; a.href = at(query, page); a.textContent = label;
        a.addEventListener('click', (event) => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); history.pushState(null, '', a.href); void render(); input.focus();
        }); pages.append(a);
      };
      if (result.page > 1) make(result.page - 1, words.previous);
      const label = document.createElement('span'); label.textContent = words.page.replace('{page}', n(result.page)).replace('{pages}', n(result.pages)); pages.append(label);
      if (result.page < result.pages) make(result.page + 1, words.next);
    }
  } catch {
    if (current !== generation) return;
    status.textContent = words.unavailable; retry.hidden = false;
  }
}
form.addEventListener('submit', (event) => { event.preventDefault(); history.pushState(null, '', at(input.value, 1)); void render(); });
retry.addEventListener('click', () => void render());
addEventListener('popstate', () => void render());
void render();
