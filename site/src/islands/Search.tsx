import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ranked, type SearchEntry, type SearchIndex } from '../lib/search';
import { trackSearchUse } from '../scripts/analytics';

/**
 * Search over names in both scripts, answering as you type. Results are
 * links; arrow keys move through them and Enter opens one. The index is
 * fetched the first time the box is used. Under the homepage's box, a few
 * names to try fill it in.
 */

type Lang = 'en' | 'fa';
interface Text { text: string; language: string }
interface Words {
  label: string;
  placeholder: string;
  empty: string;
  unavailable: string;
  retry: string;
  loading: string;
  allResults: string;
  results: { one: string; other: string };
  kinds: { artist: string; release: string; person: string };
}
interface Props {
  lang: Lang;
  words: Words;
  hero?: boolean;
  /** A sentence of names to try, as text and names in order. */
  hints?: (string | Text)[];
}

let request: Promise<SearchIndex> | null = null;
const load = () =>
  (request ??= fetch('/search.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .catch((error) => {
      request = null;
      throw error;
    }));

const LIMIT = 8;

const digits = (lang: Lang, n: number) => new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-GB').format(n);
const shown = (n: SearchEntry['n'], lang: Lang): Text | null => n[lang] ?? n[lang === 'en' ? 'fa' : 'en'];
const attrs = (text: Text | null, lang: Lang): { lang?: string; dir?: 'rtl' | 'ltr' } =>
  text && text.language !== lang ? { lang: text.language, dir: text.language === 'fa' ? 'rtl' : 'ltr' } : {};

export default function Search({ lang, words, hero = false, hints }: Props) {
  const id = hero ? 'search-hero' : 'search';
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const warm = () => {
    setOpen(true);
    if (!index) load().then((i) => { setIndex(i); setFailed(false); }, () => setFailed(true));
  };

  const all = useMemo(() => index ? ranked(index, query, lang) : [], [index, query, lang]);
  const results = all.slice(0, LIMIT);
  const allHref = `/${lang}/search/?${new URLSearchParams({ q: query, page: '1' })}`;

  useEffect(() => setActive(0), [query]);
  useEffect(() => { if (query.trim()) trackSearchUse(hero ? 'home' : 'header'); }, [query, hero]);

  // “/” jumps to search from anywhere on the page, as on many sites.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const fill = (text: string) => {
    setQuery(text);
    input.current?.focus();
    setOpen(true);
  };

  const go = (entry: SearchEntry | undefined) => {
    if (entry) location.assign(`/${lang}${entry.h}`);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!results.length) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + results.length) % results.length);
      setOpen(true);
    } else if (event.key === 'Escape') {
      if (query) setQuery('');
      else input.current?.blur();
    }
  };

  const expanded = open && Boolean(query.trim());
  const count = all.length === 1 ? words.results.one : words.results.other.replace('{count}', digits(lang, all.length));

  useEffect(() => {
    const element = panel.current;
    if (!expanded || !element) return;
    // Mobile keyboards resize the visual viewport without resizing the page.
    const viewport = window.visualViewport;
    const fit = () => {
      const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const height = Math.max(0, Math.floor(bottom - element.getBoundingClientRect().top - 12));
      element.style.setProperty('--search-available-height', `${height}px`);
    };
    fit();
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, { passive: true });
    return () => {
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit);
    };
  }, [expanded]);

  return (
    <>
      <form
        role="search"
        class={hero ? 'search search-hero' : 'search'}
        action={`/${lang}/search/`}
        onSubmit={(event) => { event.preventDefault(); if (results[active]) go(results[active]); else location.assign(allHref); }}
      >
        <label class="visually-hidden" for={`${id}-input`}>{words.label}</label>
        <svg class="search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
        <input
          ref={input}
          id={`${id}-input`}
          type="text"
          name="q"
          inputMode="search"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={expanded && results[active] ? `${id}-option-${active}` : undefined}
          autocomplete="off"
          spellcheck={false}
          enterKeyHint="go"
          placeholder={words.placeholder}
          value={query}
          onInput={(event) => { setQuery((event.target as HTMLInputElement).value); setOpen(true); }}
          onFocus={warm}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        <div ref={panel} class="search-panel" hidden={!expanded}>
          <ul id={`${id}-list`} role="listbox" aria-label={words.label} onMouseDown={(event) => event.preventDefault()}>
            {results.map((entry, i) => {
              const name = shown(entry.n, lang);
              const alt = entry.n[lang === 'en' ? 'fa' : 'en'];
              const artist = entry.a && index ? shown(index.artists[entry.a], lang) : null;
              return (
                <li key={entry.i} id={`${id}-option-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)}>
                  <a href={`/${lang}${entry.h}`} tabIndex={-1}>
                    <span class="search-name" {...attrs(name, lang)}>{name?.text}</span>
                    {alt && alt.text !== name?.text && <span class="search-alt" {...attrs(alt, lang)}>{alt.text}</span>}
                    <span class="search-kind">
                      {words.kinds[entry.k]}
                      {artist && entry.k !== 'artist' && <> · <span {...attrs(artist, lang)}>{artist.text}</span></>}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
          {expanded && !results.length && (
            <p class="search-empty">{failed ? words.unavailable : index ? words.empty.replace('{query}', query.trim()) : words.loading}</p>
          )}
          {failed && <button type="button" class="pill" onMouseDown={(event) => event.preventDefault()} onClick={warm}>{words.retry}</button>}
          {index && <a class="search-all text-link" href={allHref} onMouseDown={(event) => event.preventDefault()}>{words.allResults} · {count}</a>}
        </div>
        <p class="visually-hidden" aria-live="polite">{expanded && index ? count : ''}</p>
      </form>
      {hints && (
        <p class="search-hints needs-js">
          {hints.map((part) =>
            typeof part === 'string' ? part : (
              <button type="button" {...attrs(part, lang)} onClick={() => fill(part.text)}>{part.text}</button>
            ),
          )}
        </p>
      )}
    </>
  );
}
