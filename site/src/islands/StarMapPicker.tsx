import { useMemo, useRef, useState } from 'preact/hooks';
import type { Strings } from '../lib/i18n';
import { fold } from '../lib/search';
import type { MapArtist } from '../lib/star-map';

export default function StarMapPicker({
  artists,
  words,
  onChoose,
}: {
  artists: MapArtist[];
  words: Strings['starMap'];
  onChoose: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const matches = useMemo(() => {
    if (!open) return [];
    const needle = fold(query);
    return artists.filter((a) => !needle || fold(a.name + ' ' + a.alternate).includes(needle));
  }, [open, query, artists]);

  return (
    <>
      <button
        class="atlas-find"
        ref={trigger}
        onClick={() => {
          setOpen(true);
          setQuery('');
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
          trigger.current?.focus();
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
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <ul>
          {matches.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => {
                  onChoose(a.id);
                  dialog.current?.close();
                }}
              >
                <bdi>{a.name}</bdi>{' '}
                <small>
                  <bdi>{a.alternate}</bdi>
                </small>
              </button>
            </li>
          ))}
        </ul>
        {open && !matches.length && <p role="status">{words.empty}</p>}
      </dialog>
    </>
  );
}
