import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { keepInView } from '../lib/panel-room';
import { fold, score } from '../lib/search';
import { scriptOf, type SkyStar } from '../lib/sky-data';

/**
 * The search box over the full star map. It answers with stars, in either
 * script, and choosing one flies the sky to it.
 */

type Lang = 'en' | 'fa';
/** What a star is, in the words the search uses. */
export const kindOf = (star: SkyStar, words: SearchWords) =>
  star.kind === 'recording' ? words.kinds.release : star.page || star.group ? words.kinds.artist : words.kinds.person;

export interface SearchWords {
  label: string;
  placeholder: string;
  empty: string;
  kinds: { artist: string; release: string; person: string };
}
interface Props {
  stars: SkyStar[];
  lang: Lang;
  words: SearchWords;
  query: string;
  onQuery: (query: string) => void;
  onChoose: (index: number) => void;
}

const LIMIT = 8;
// Artists with pages come first among equal matches, then other artists, then recordings.
const order = (star: SkyStar) => (star.page ? 0 : star.kind === 'artist' ? 1 : 2);
const attrs = (text: string, lang: Lang): { lang?: Lang; dir?: 'rtl' | 'ltr' } => {
  const script = scriptOf(text);
  return script === lang ? {} : { lang: script, dir: script === 'fa' ? 'rtl' : 'ltr' };
};

export default function StarSearch({ stars, lang, words, query, onQuery, onChoose }: Props) {
  const [used, setUsed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Folding every name takes a moment, so it waits for the box's first use.
  const index = useMemo(
    () => (used ? stars.map((star, at) => ({ at, star, names: [fold(star.name), fold(star.alternate)] })) : []),
    [stars, used],
  );
  const results = useMemo(() => {
    const needle = fold(query);
    if (!needle) return [];
    return index
      .map((entry) => ({
        entry,
        rank: entry.names.includes(needle) ? 4 : Math.max(...entry.names.map((name) => score(needle, name))),
      }))
      .filter((match) => match.rank > 0)
      .sort((a, b) =>
        b.rank - a.rank || order(a.entry.star) - order(b.entry.star) ||
        a.entry.star.name.length - b.entry.star.name.length || a.entry.at - b.entry.at)
      .slice(0, LIMIT)
      .map((match) => match.entry);
  }, [index, query]);

  useEffect(() => setActive(0), [query]);
  const expanded = open && Boolean(query.trim());
  useEffect(() => {
    if (expanded && panel.current) return keepInView(panel.current);
  }, [expanded]);

  const choose = (at: number | undefined) => {
    if (at === undefined) return;
    onQuery('');
    input.current?.blur();
    onChoose(at);
  };
  const kind = (star: SkyStar) => kindOf(star, words);

  return (
    <form
      role="search"
      class="search sky-search"
      onSubmit={(event) => {
        event.preventDefault();
        choose(results[active]?.at);
      }}
    >
      <label class="visually-hidden" for="sky-search-input">{words.label}</label>
      <svg class="search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
      <input
        ref={input}
        id="sky-search-input"
        type="text"
        inputMode="search"
        role="combobox"
        aria-expanded={expanded}
        aria-controls="sky-search-list"
        aria-autocomplete="list"
        aria-activedescendant={expanded && results[active] ? `sky-search-option-${active}` : undefined}
        autocomplete="off"
        spellcheck={false}
        enterKeyHint="go"
        placeholder={words.placeholder}
        value={query}
        onInput={(event) => {
          onQuery((event.target as HTMLInputElement).value);
          setOpen(true);
        }}
        onFocus={() => {
          setUsed(true);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || !results.length) return;
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setActive((a) => (a + step + results.length) % results.length);
          setOpen(true);
        }}
      />
      <div ref={panel} class="search-panel" hidden={!expanded}>
        <ul id="sky-search-list" role="listbox" aria-label={words.label} onMouseDown={(event) => event.preventDefault()}>
          {results.map(({ at, star }, i) => (
            <li key={star.key} id={`sky-search-option-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)}>
              <button type="button" class="search-option" tabIndex={-1} onClick={() => choose(at)}>
                <span class="search-name" {...attrs(star.name, lang)}>{star.name}</span>
                {star.alternate && <span class="search-alt" {...attrs(star.alternate, lang)}>{star.alternate}</span>}
                <span class="search-kind">
                  <i class={`star-mark ${star.kind}`} aria-hidden="true" />
                  <span class="visually-hidden">{kind(star)}</span>
                </span>
                {star.by && <span class="search-by" {...attrs(star.by, lang)}>{star.by}</span>}
              </button>
            </li>
          ))}
        </ul>
        {expanded && !results.length && <p class="search-empty">{words.empty.replace('{query}', query.trim())}</p>}
      </div>
    </form>
  );
}
