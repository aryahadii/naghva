import { useEffect, useMemo, useState } from 'preact/hooks';
import { num, type Strings } from '../lib/i18n';
import type { Lang } from '../lib/record';
import type { SkyStar } from '../lib/star-map';
import SkyCanvas from './SkyCanvas';
import StarMapPicker from './StarMapPicker';

type Words = Strings['starMap'];
type Props = { lang: Lang; words: Words; artistCount: number; recordingCount: number };

function StarLinks({
  title,
  stars,
  onChoose,
  words,
  lang,
}: {
  title: string;
  stars: SkyStar[];
  onChoose: (id: string) => void;
  words: Words;
  lang: Lang;
}) {
  const [limit, setLimit] = useState(8);
  if (!stars.length) return null;
  return (
    <section class="sky-links">
      <h3>
        {title} <span>{num(lang, stars.length)}</span>
      </h3>
      <ul>
        {stars.slice(0, limit).map((star) => (
          <li key={star.id}>
            <button onClick={() => onChoose(star.id)}>
              <span class={`star-mark ${star.kind}`} aria-hidden="true" />
              <bdi>{star.name}</bdi>
            </button>
          </li>
        ))}
      </ul>
      {stars.length > limit && (
        <button class="more-stars" onClick={() => setLimit(limit + 25)}>
          {words.more}
        </button>
      )}
    </section>
  );
}

export default function StarMap({ lang, words, artistCount, recordingCount }: Props) {
  const [stars, setStars] = useState<SkyStar[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    const catalogue: SkyStar[] = JSON.parse(document.getElementById('sky-catalogue')!.textContent!);
    setStars(catalogue);
    const readSelection = () => {
      const params = new URLSearchParams(location.search);
      const id = params.get('star') ?? params.get('artist');
      setSelectedId(catalogue.find((star) => star.id === id)?.id ?? null);
      setResetKey((value) => value + 1);
    };
    readSelection();
    addEventListener('popstate', readSelection);
    return () => removeEventListener('popstate', readSelection);
  }, []);

  const index = useMemo(() => new Map(stars.map((star) => [star.id, star])), [stars]);
  const selected = selectedId ? index.get(selectedId) : null;
  const connected = useMemo(
    () =>
      selected?.connections.map((id) => index.get(id)!).sort((a, b) => a.name.localeCompare(b.name, lang)) ??
      [],
    [index, selected, lang],
  );
  // Offer a few artist pages from distant parts of the same sky as entry points.
  const starters = useMemo(() => {
    const candidates = stars.filter((star) => star.kind === 'artist' && star.href);
    const chosen: SkyStar[] = [];
    for (const [x, y] of [
      [0.25, 0.3],
      [0.75, 0.25],
      [0.3, 0.7],
      [0.7, 0.7],
    ]) {
      const nearest = candidates.reduce<SkyStar | undefined>((best, star) => {
        if (chosen.includes(star)) return best;
        return !best || Math.hypot(x - star.x, y - star.y) < Math.hypot(x - best.x, y - best.y) ? star : best;
      }, undefined);
      if (nearest) chosen.push(nearest);
    }
    return chosen;
  }, [stars]);

  function choose(id: string | null) {
    const address = new URL(location.href);
    address.hash = '';
    for (const key of ['artist', 'page', 'view', 'star']) address.searchParams.delete(key);
    if (id) address.searchParams.set('star', id);
    if (address.href !== location.href) history.pushState(null, '', address);
    setSelectedId(id);
    if (!id) setResetKey((value) => value + 1);
  }

  return (
    <section class="atlas" aria-label={words.mapLabel}>
      <div class="atlas-toolbar">
        <div class="sky-legend">
          <span>
            <i class="star-mark artist" aria-hidden="true" />
            <strong>{num(lang, artistCount)}</strong> {words.artists}
          </span>
          <span>
            <i class="star-mark recording" aria-hidden="true" />
            <strong>{num(lang, recordingCount)}</strong> {words.recordings}
          </span>
        </div>
        {stars.length > 0 && <StarMapPicker stars={stars} words={words} onChoose={choose} />}
      </div>
      <div class="global-sky">
        {stars.length > 0 ? (
          <SkyCanvas
            stars={stars}
            selected={selectedId}
            resetKey={resetKey}
            onSelect={choose}
            lang={lang}
            words={words}
          />
        ) : (
          <div class="sky-viewport sky-loading">
            <span>{words.loading}</span>
          </div>
        )}
        {selected && (
          <a class="sky-selection-link" href="#star-details">
            <i class={`star-mark ${selected.kind}`} aria-hidden="true" />
            <bdi>{selected.name}</bdi>
            <span aria-hidden="true">↓</span>
          </a>
        )}
      </div>
      <p class="atlas-help">{words.help}</p>
      <div id="star-details" class="sky-inspector" aria-live="polite" aria-atomic="false">
        {selected ? (
          <div key={selected.id}>
            <div class="inspector-heading">
              <div>
                <p class="star-kind">
                  <i class={`star-mark ${selected.kind}`} aria-hidden="true" />
                  {words[selected.kind]}
                </p>
                <h2>
                  <bdi>{selected.name}</bdi>
                </h2>
                {selected.alternate && (
                  <p class="star-alternate">
                    <bdi>{selected.alternate}</bdi>
                  </p>
                )}
              </div>
              <button
                class="clear-star"
                onClick={() => choose(null)}
                aria-label={words.clear}
                title={words.clear}
              >
                ×
              </button>
            </div>
            {selected.href && (
              <a class="star-destination" href={selected.href}>
                {selected.kind === 'artist' ? words.profile : words.openRecording}{' '}
                <span aria-hidden="true">{lang === 'fa' ? '←' : '→'}</span>
              </a>
            )}
            {!connected.length && <p>{words.isolate}</p>}
            <StarLinks
              stars={connected.filter((s) => s.kind === 'artist')}
              title={selected.kind === 'recording' ? words.credits : words.memberships}
              words={words}
              lang={lang}
              onChoose={choose}
            />
            <StarLinks
              stars={connected.filter((s) => s.kind === 'recording')}
              title={words.works}
              words={words}
              lang={lang}
              onChoose={choose}
            />
          </div>
        ) : (
          starters.length > 0 && (
            <div class="sky-starters">
              <h2>{words.start}</h2>
              <ul>
                {starters.map((star) => (
                  <li key={star.id}>
                    <button onClick={() => choose(star.id)}>
                      <span aria-hidden="true">✧</span> <bdi>{star.name}</bdi>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
      </div>
    </section>
  );
}
