import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fill, num, type Strings } from '../lib/i18n';
import type { Lang } from '../lib/record';
import StarMapPicker from './StarMapPicker';
import type { TargetedMouseEvent } from 'preact';
import type { StarMapData } from '../lib/star-map';

type Words = Strings['starMap'];
type Props = { data: StarMapData; lang: Lang; words: Words };
const slots = [
  [21, 26],
  [70, 18],
  [82, 51],
  [67, 76],
  [24, 71],
];
const centre = [45, 45];
const size = slots.length;
type Mode = 'connections' | 'recordings';
type MapView = { id: string; mode: Mode; page: number };

function Star({ large = false }: { large?: boolean }) {
  return (
    <svg class={large ? 'star-symbol star-sun' : 'star-symbol'} viewBox="-20 -20 40 40" aria-hidden="true">
      {large && (
        <>
          <circle r="16" fill="none" stroke="currentColor" strokeWidth=".55" />
          <path
            d="M0-19 5-8 13-13 8-5 19 0 8 5 13 13 5 8 0 19-5 8-13 13-8 5-19 0-8-5-13-13-5-8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth=".8"
          />
        </>
      )}
      <path d="M0-14Q2-2 13 0Q2 2 0 14Q-2 2-13 0Q-2-2 0-14Z" fill="currentColor" />
      <circle r="2.2" fill="#fff5d5" />
    </svg>
  );
}

// A stationary engraved dial and faint background stars, independent of the data marks.
const ticks = Array.from({ length: 120 }, (_, i) => {
  const a = (i * Math.PI) / 60,
    x = Math.cos(a),
    y = Math.sin(a);
  const r = i % 10 === 0 ? 183 : i % 5 === 0 ? 187 : 191;
  return `M${(r * x).toFixed(1)} ${(r * y).toFixed(1)}L${(195 * x).toFixed(1)} ${(195 * y).toFixed(1)}`;
}).join('');
function SkyDial() {
  return (
    <svg class="sky-dial" viewBox="-340 -230 680 460" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="stardust" width="134" height="109" patternUnits="userSpaceOnUse">
          <path
            d="M11 28h.3m48 53h.5m42-66h.4m26 83h.1m-94-48h.1"
            stroke="#e4dfdb"
            strokeWidth="1.45"
            strokeLinecap="round"
            opacity=".56"
          />
        </pattern>
      </defs>
      <rect x="-600" y="-400" width="1200" height="800" fill="url(#stardust)" />
      <g transform="rotate(-18)" fill="none" stroke="currentColor" strokeWidth=".7">
        <circle r="196" />
        <circle r="181" />
        <path d={ticks} />
        <ellipse rx="275" ry="101" strokeDasharray="3 6" />
        <ellipse rx="122" ry="204" transform="rotate(48)" opacity=".55" />
        <path d="M-229 0H229M0-217V217" strokeDasharray="2 7" />
      </g>
    </svg>
  );
}

export default function StarMap({ data, lang, words }: Props) {
  const artists = useMemo(() => new Map(data.artists.map((a) => [a.id, a])), [data]);
  // Open with a connected constellation in either language, including in the example archive.
  const initial = useMemo(
    () =>
      [...data.artists].sort(
        (a, b) => b.connections.length - a.connections.length || a.id.localeCompare(b.id),
      )[0],
    [data],
  );
  const defaultView = (target: typeof initial): MapView => ({
    id: target.id,
    mode: target.connections.length ? 'connections' : 'recordings',
    page: 0,
  });
  const [view, setView] = useState(() => defaultView(initial));
  const { id, mode, page } = view;
  const artist = artists.get(id)!;
  const centreLink = useRef<HTMLAnchorElement>(null);

  function navigate(next: MapView) {
    const address = new URL(location.href);
    address.searchParams.set('artist', next.id);
    address.searchParams.set('view', next.mode);
    if (next.page) address.searchParams.set('page', String(next.page + 1));
    else address.searchParams.delete('page');
    if (next.id === id) history.replaceState(null, '', address);
    else history.pushState(null, '', address);
    setView(next);
  }
  const travel = (next: string) => navigate(defaultView(artists.get(next)!));
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(location.search);
      const target = artists.get(params.get('artist') ?? '') ?? initial;
      const next = defaultView(target);
      const requested = params.get('view');
      if (requested === 'recordings' || requested === 'connections') next.mode = requested;
      const last = Math.max(0, Math.ceil(target[next.mode].length / size) - 1);
      const number = Number(params.get('page'));
      next.page = Number.isInteger(number) ? Math.min(last, Math.max(0, number - 1)) : 0;
      setView(next);
    };
    sync();
    addEventListener('popstate', sync);
    return () => removeEventListener('popstate', sync);
  }, [artists, initial]);

  const connected = mode === 'connections';
  const entries = connected
    ? artist.connections.map((link) => {
        const other = artists.get(link.artist)!;
        const recording = link.recording === undefined ? null : data.recordings[link.recording];
        const relation = link.membership ? words[link.membership] : words.shared;
        return { name: other.name, id: other.id, href: other.href, key: other.id, relation, recording };
      })
    : artist.recordings.map((i) => {
        const recording = data.recordings[i];
        return {
          name: recording.name,
          id: '',
          key: String(i),
          href: recording.href,
          relation: words.credit,
          recording: null,
        };
      });
  const start = page * size;
  const visible = entries.slice(start, start + size);
  // Keep labels in separate regions, but give each artist a recognizable chart.
  const positions = useMemo(
    () =>
      slots.map(([x, y], i) => {
        const seed = id.charCodeAt(i % id.length) + page;
        return [x + (seed % 7) - 3, y + (seed % 9) - 4];
      }),
    [id, page],
  );
  function follow(event: TargetedMouseEvent<HTMLAnchorElement>, next: string) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    travel(next);
    if (event.detail === 0) requestAnimationFrame(() => centreLink.current?.focus());
  }
  const arrow = lang === 'fa' ? '←' : '→';

  return (
    <section class="atlas" aria-label={words.mapLabel}>
      <div class="atlas-toolbar needs-js">
        <StarMapPicker artists={data.artists} words={words} onChoose={travel} />
        <div class="atlas-modes" role="group" aria-label={words.view}>
          {(['connections', 'recordings'] as const).map((key) => (
            <button
              key={key}
              aria-pressed={mode === key}
              onClick={() => navigate({ id, mode: key, page: 0 })}
            >
              {words[key]}
            </button>
          ))}
        </div>
      </div>
      <div class="atlas-body">
        <div class={connected ? 'sky' : 'sky sky-recordings'}>
          <div class="sky-chart">
            <SkyDial />
            <p class="sky-hint">{connected ? words.help : words.listenHelp}</p>
            <svg
              key={id + mode + page}
              class="sky-lines"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {visible.map((_, i) => (
                <line key={i} x1={centre[0]} y1={centre[1]} x2={positions[i][0]} y2={positions[i][1]} />
              ))}
            </svg>
            <a
              ref={centreLink}
              class="sky-node sky-centre"
              style={{ left: centre[0] + '%', top: centre[1] + '%' }}
              href={artist.href}
            >
              <Star large />
              <bdi>{artist.name}</bdi>
            </a>
            {visible.map((entry, i) => {
              const content = (
                <>
                  <Star />
                  <bdi>{entry.name}</bdi>
                </>
              );
              const props = {
                class: entry.href ? 'sky-node satellite' : 'sky-node satellite unlinked',
                style: { left: positions[i][0] + '%', top: positions[i][1] + '%' },
              };
              if (entry.id)
                return (
                  <a
                    {...props}
                    key={entry.key}
                    href={entry.href!}
                    onClick={(event) => follow(event, entry.id)}
                  >
                    {content}
                  </a>
                );
              return entry.href ? (
                <a {...props} key={entry.key} href={entry.href}>
                  {content}
                </a>
              ) : (
                <span {...props} key={entry.key}>
                  {content}
                </span>
              );
            })}
          </div>
          <div class="sky-controls">
            {data.artists.length > 1 && (
              <button
                class="sky-surprise needs-js"
                onClick={() => {
                  const at = data.artists.indexOf(artist);
                  travel(
                    data.artists[
                      (at + 1 + Math.floor(Math.random() * (data.artists.length - 1))) % data.artists.length
                    ].id,
                  );
                }}
              >
                <span aria-hidden="true">✧</span> {words.surprise}
              </button>
            )}
            {entries.length > size && (
              <div class="atlas-pagination needs-js">
                <span aria-live="polite">
                  {fill(words.range, {
                    from: num(lang, start + 1),
                    to: num(lang, start + visible.length),
                    total: num(lang, entries.length),
                  })}
                </span>
                <button
                  disabled={!page}
                  aria-label={words.prev}
                  onClick={() => navigate({ ...view, page: page - 1 })}
                >
                  {lang === 'fa' ? '›' : '‹'}
                </button>
                <button
                  disabled={start + size >= entries.length}
                  aria-label={words.next}
                  onClick={() => navigate({ ...view, page: page + 1 })}
                >
                  {lang === 'fa' ? '‹' : '›'}
                </button>
              </div>
            )}
          </div>
        </div>
        <aside class="atlas-panel">
          <div class="atlas-identity" aria-live="polite" aria-atomic="true">
            <p class="atlas-kind">
              <span aria-hidden="true">✦</span> {artist.group ? words.group : words.person}
            </p>
            <h2>
              <bdi>{artist.name}</bdi>
            </h2>
            {artist.alternate && (
              <p class="atlas-alternate">
                <bdi>{artist.alternate}</bdi>
              </p>
            )}
          </div>
          <a class="atlas-profile" href={artist.href}>
            {words.profile} <span aria-hidden="true">{arrow}</span>
          </a>
          <div class="atlas-list-title">
            <h3>{connected ? words.connectionsHeading : words.recordingsHeading}</h3>
            <span>{num(lang, entries.length)}</span>
          </div>
          <ul class="atlas-list">
            {visible.map((entry) => (
              <li key={entry.key}>
                <span class="list-star" aria-hidden="true">
                  ✧
                </span>
                <div>
                  {entry.id ? (
                    <a href={entry.href!} onClick={(event) => follow(event, entry.id)}>
                      <bdi>{entry.name}</bdi>
                    </a>
                  ) : entry.href ? (
                    <a href={entry.href}>
                      <bdi>{entry.name}</bdi>
                    </a>
                  ) : (
                    <>
                      <bdi>{entry.name}</bdi>
                      <small>{words.noPanel}</small>
                    </>
                  )}
                  {entry.id && (
                    <small>
                      {entry.relation}
                      {entry.recording && (
                        <>
                          {' '}
                          ·{' '}
                          {entry.recording.href ? (
                            <a href={entry.recording.href}>
                              <bdi>{entry.recording.name}</bdi>
                            </a>
                          ) : (
                            <bdi>{entry.recording.name}</bdi>
                          )}
                        </>
                      )}
                    </small>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!entries.length && (
            <p class="atlas-empty">{connected ? words.noConnections : words.noRecordings}</p>
          )}
        </aside>
      </div>
    </section>
  );
}
