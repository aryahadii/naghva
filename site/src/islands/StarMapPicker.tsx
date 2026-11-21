import { useMemo, useRef, useState } from 'preact/hooks';
import type { Strings } from '../lib/i18n';
import { fold, PAGE_SIZE, score } from '../lib/search';
import type { SkyStar } from '../lib/star-map';

interface Props {
  stars: SkyStar[];
  words: Strings['starMap'];
  onChoose: (id: string) => void;
}

type Kind = 'all' | SkyStar['kind'];

export default function StarMapPicker({ stars, words, onChoose }: Props) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const results = useRef<HTMLUListElement>(null);

  const index = useMemo(() => {
    if (!open) return [];
    const { compare } = new Intl.Collator(document.documentElement.lang, { numeric: true });
    return stars
      .map((star) => ({ star, name: fold(star.name), alternate: fold(star.alternate) }))
      .sort((a, b) => compare(a.star.name, b.star.name));
  }, [open, stars]);
  const matches = useMemo(() => {
    const needle = fold(query);
    const entries = index.filter(({ star }) => kind === 'all' || star.kind === kind);
    if (!needle) return entries;
    return entries
      .map((entry) => ({
        entry,
        rank:
          entry.name === needle || entry.alternate === needle
            ? 4
            : Math.max(score(needle, entry.name), score(needle, entry.alternate)),
      }))
      .filter((match) => match.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .map((match) => match.entry);
  }, [index, kind, query]);
  const names = useMemo(() => new Map(index.map(({ star }) => [star.id, star.name])), [index]);

  function resetResults() {
    setLimit(PAGE_SIZE);
    if (results.current) results.current.scrollTop = 0;
  }

  function choose(id: string) {
    dialog.current?.close();
    onChoose(id);
  }

  const kinds = [
    { id: 'all', label: words.all },
    { id: 'artist', label: words.artists },
    { id: 'recording', label: words.recordings },
  ] as const;

  return (
    <>
      <button
        class="atlas-find"
        ref={trigger}
        aria-haspopup="dialog"
        onClick={() => {
          setQuery('');
          setKind('all');
          resetResults();
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8" cy="8" r="5.75" />
          <path d="m12.5 12.5 4.8 4.8" />
        </svg>
        {words.choose}
      </button>
      <dialog
        class="atlas-picker"
        ref={dialog}
        aria-labelledby="atlas-picker-title"
        onClose={() => {
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <div class="picker-heading">
          <h2 id="atlas-picker-title">{words.choose}</h2>
          <button aria-label={words.close} onClick={() => dialog.current?.close()}>
            ×
          </button>
        </div>
        <input
          type="search"
          autoFocus
          value={query}
          aria-label={words.placeholder}
          placeholder={words.placeholder}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            resetResults();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && matches.length) {
              event.preventDefault();
              results.current?.querySelector('button')?.focus();
            }
            if (event.key === 'Enter' && matches.length && !event.isComposing) {
              event.preventDefault();
              choose(matches[0].star.id);
            }
          }}
        />
        <div class="atlas-modes" role="group" aria-label={words.view}>
          {kinds.map((option) => (
            <button
              key={option.id}
              aria-pressed={option.id === kind}
              onClick={() => {
                setKind(option.id);
                resetResults();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <ul ref={results}>
          {matches.slice(0, limit).map(({ star }) => {
            const artist = star.kind === 'recording' && names.get(star.connections[0]);
            return (
              <li key={star.id}>
                <button onClick={() => choose(star.id)}>
                  <span>
                    <bdi>{star.name}</bdi>
                    {star.alternate && (
                      <>
                        {' '}
                        · <bdi>{star.alternate}</bdi>
                      </>
                    )}
                  </span>
                  <small>
                    {words[star.kind]}
                    {artist && (
                      <>
                        {' '}
                        · <bdi>{artist}</bdi>
                      </>
                    )}
                  </small>
                </button>
              </li>
            );
          })}
          {matches.length > limit && (
            <li>
              <button
                onClick={() => {
                  const firstNew = limit;
                  setLimit(limit + PAGE_SIZE);
                  requestAnimationFrame(() =>
                    results.current?.children[firstNew]?.querySelector('button')?.focus(),
                  );
                }}
              >
                {words.more}
              </button>
            </li>
          )}
        </ul>
        {open && !matches.length && <p role="status">{words.empty}</p>}
      </dialog>
    </>
  );
}
