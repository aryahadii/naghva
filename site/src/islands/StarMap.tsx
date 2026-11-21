import { useEffect, useRef, useState } from 'preact/hooks';
import { makeSky, type SkyView } from '../lib/sky-canvas';
import { readSky, type SkyStar } from '../lib/sky-data';
import type { Sky } from '../lib/star-map';
import StarCard, { type CardWords } from './StarCard';
import StarSearch, { type SearchWords } from './StarSearch';

/**
 * The star map on the homepage. In the page it is a preview that plays by
 * itself and never takes a scroll; a click or a tap opens the same sky over
 * the whole window, with search, zoom and a card for the chosen star. The
 * address keeps the open map and its star (`?star=`), so Back closes it and a
 * link can open it on one artist.
 */

type Lang = 'en' | 'fa';
interface Words extends CardWords {
  open: string;
  mapLabel: string;
  keyboardHelp: string;
  close: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  random: string;
  search: SearchWords;
}
interface Props {
  lang: Lang;
  words: Words;
}

const stillness = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function StarMap({ lang, words }: Props) {
  const slot = useRef<HTMLDivElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const sky = useRef<SkyView | null>(null);
  const list = useRef<SkyStar[]>([]);
  const escaped = useRef(0);
  const fading = useRef<Animation | null>(null);
  /** Close events still to come from closing the dialog here, which are not the browser's doing. */
  const ours = useRef(0);
  /** Whether the reader has yet to choose anything in the open map. */
  const untouched = useRef(true);
  const [stars, setStars] = useState<SkyStar[]>([]);
  const [selected, setSelected] = useState(-1);
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);

  const indexOf = (key: string | null) => (key ? list.current.findIndex((star) => star.key === key) : -1);
  /** This page's address with the map open on a star, or on none. */
  const address = (index: number) => {
    const url = new URL(location.href);
    url.searchParams.delete('star');
    const rest = url.searchParams.toString();
    const star = index >= 0 ? `star=${encodeURIComponent(list.current[index].key)}` : 'star';
    url.search = rest ? `${rest}&${star}` : star;
    url.hash = '';
    return url;
  };
  const plain = () => {
    const url = new URL(location.href);
    url.searchParams.delete('star');
    return url;
  };

  function took(index: number) {
    untouched.current = false;
    setSelected(index);
    if (dialog.current?.open) history.replaceState(history.state, '', address(index));
  }
  function choose(index: number) {
    sky.current?.select(index, true, true);
    took(index);
  }

  function open(index: number, how: { push?: boolean; grow?: boolean } = {}) {
    const view = sky.current, box = dialog.current;
    if (!view || !box || box.open || !slot.current || !host.current) return;
    const from = slot.current.getBoundingClientRect();
    const root = document.documentElement;
    // The page keeps its width when its scrollbar goes.
    root.style.setProperty('--sky-scrollbar', `${innerWidth - root.clientWidth}px`);
    root.classList.add('sky-lock');
    host.current.append(view.element);
    // The sky is the first thing in the dialog that takes focus, so the keyboard starts on it.
    view.setMode('full');
    box.showModal();
    const grows = Boolean(how.grow) && !stillness();
    // The sky grows out of the page as the preview showed it, and then flies to its star.
    if (grows) view.select(index);
    view.layout({ top: bar.current?.offsetHeight ?? 0, bottom: tools.current?.offsetHeight ?? 0 });
    if (!grows) view.select(index, true, true);
    view.canvas.focus({ preventScroll: true });
    untouched.current = true;
    setSelected(index);
    setQuery('');
    if (how.push) history.pushState({ sky: 'pushed' }, '', address(index));
    else history.replaceState(history.state?.sky ? history.state : { sky: 'landed' }, '', address(index));
    root.classList.remove('sky-deep');
    if (grows) {
      // The map grows out of its place in the page.
      const to = box.getBoundingClientRect();
      box.dataset.opening = '';
      const growth = box.animate(
        {
          transform: [
            `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
            'none',
          ],
        },
        { duration: 420, easing: 'cubic-bezier(.2, .7, .2, 1)' },
      );
      growth.onfinish = growth.oncancel = () => {
        delete box.dataset.opening;
        if (box.open && untouched.current && index >= 0) view.select(index, true, true);
      };
    }
  }
  /** Put the sky back in the page. */
  function settle() {
    const view = sky.current, box = dialog.current;
    if (!view || !slot.current) return;
    slot.current.append(view.element);
    view.setMode('preview');
    if (box?.open) {
      ours.current++;
      box.close();
    }
    document.documentElement.classList.remove('sky-lock');
    setSelected(-1);
    setQuery('');
    expand.current?.focus({ preventScroll: true });
  }
  function shut() {
    const box = dialog.current;
    if (!box?.open || box.dataset.closing !== undefined) return;
    if (stillness()) {
      settle();
      return;
    }
    box.dataset.closing = '';
    const fade = box.animate({ opacity: [1, 0] }, { duration: 170, easing: 'ease-out', fill: 'forwards' });
    fading.current = fade;
    fade.onfinish = () => {
      settle();
      delete box.dataset.closing;
      fading.current = null;
      fade.cancel();
    };
  }
  /** Back closes the map, so closing it goes back when the map was opened from this page or from another of the site's. */
  function close() {
    const fromHere = document.referrer.startsWith(`${location.origin}/`) && history.length > 1;
    if (history.state?.sky === 'pushed' || (history.state?.sky === 'landed' && fromHere)) history.back();
    else {
      history.replaceState(null, '', plain());
      shut();
    }
  }
  /** Follow the address after Back or Forward. */
  function follow() {
    const params = new URLSearchParams(location.search);
    const box = dialog.current;
    if (!params.has('star')) shut();
    else if (box?.open) {
      // Forward during the closing fade keeps the map open.
      if (fading.current) {
        fading.current.onfinish = null;
        fading.current.cancel();
        fading.current = null;
        delete box.dataset.closing;
      }
      choose(indexOf(params.get('star')));
    }
    else open(indexOf(params.get('star')), { grow: true });
  }
  /** Escape leaves one thing at a time: the search, the star the reader chose, then the map. */
  function escape() {
    escaped.current = performance.now();
    if (query) setQuery('');
    else if (document.activeElement instanceof HTMLInputElement) sky.current?.canvas.focus({ preventScroll: true });
    else if (selected >= 0 && !untouched.current) choose(-1);
    else close();
  }

  const act = useRef({ open, took, follow });
  act.current = { open, took, follow };
  useEffect(() => {
    let live = true;
    let view: SkyView | null = null;
    fetch('/sky.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((file: Sky) => {
        if (!live || !slot.current) return;
        const all = readSky(file, lang);
        view = makeSky(all, {
          lang,
          label: words.mapLabel,
          describedBy: 'sky-keys',
          onSelect: (index) => act.current.took(index),
          onOpen: (index) => act.current.open(index >= 0 ? index : view!.featured(), { push: true, grow: true }),
        });
        if (!view) throw new Error('No canvas');
        list.current = all;
        sky.current = view;
        slot.current.append(view.element);
        view.layout();
        view.setCard(card.current);
        setStars(all);
        const params = new URLSearchParams(location.search);
        if (params.has('star')) act.current.open(indexOf(params.get('star')));
      })
      .catch(() => {
        if (live) setFailed(true);
      })
      .finally(() => document.documentElement.classList.remove('sky-deep'));
    const traverse = () => act.current.follow();
    addEventListener('popstate', traverse);
    return () => {
      live = false;
      removeEventListener('popstate', traverse);
      view?.dispose();
      sky.current = null;
    };
  }, [lang]);

  const star = selected >= 0 ? stars[selected] : undefined;
  return (
    <div class="sky-home needs-js" hidden={failed} data-ready={stars.length ? '' : undefined}>
      <div class="sky-slot" ref={slot} />
      <button
        type="button"
        class="sky-round sky-expand"
        ref={expand}
        disabled={!stars.length}
        aria-label={words.open}
        title={words.open}
        onClick={() => sky.current && open(sky.current.featured(), { push: true, grow: true })}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M12 3h5v5M8 17H3v-5M17 3l-5.5 5.5M3 17l5.5-5.5" /></svg>
      </button>
      <dialog
        class="sky-full"
        ref={dialog}
        aria-label={words.mapLabel}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          escape();
        }}
        onCancel={(event) => {
          // Some browsers ask to close even after the key was handled.
          event.preventDefault();
          if (performance.now() - escaped.current > 80) escape();
        }}
        onClose={() => {
          // The event comes a moment after the closing, when the map may be open again.
          if (ours.current) {
            ours.current--;
            return;
          }
          // The browser closed the dialog itself, as Android's Back can.
          if (!sky.current || !host.current?.contains(sky.current.element)) return;
          settle();
          if (history.state?.sky === 'pushed') history.back();
          else history.replaceState(null, '', plain());
        }}
      >
        <div class="sky-host" ref={host} />
        <div class="star-card" ref={card} aria-live="polite">
          {star && <StarCard key={star.key} star={star} stars={stars} lang={lang} words={words} />}
        </div>
        <div class="sky-bar" ref={bar}>
          <StarSearch
            stars={stars}
            lang={lang}
            words={words.search}
            query={query}
            onQuery={setQuery}
            onChoose={(index) => {
              choose(index);
              // The keyboard goes on to the sky, where the arrows move from star to star.
              sky.current?.canvas.focus({ preventScroll: true });
            }}
          />
          <button type="button" class="sky-round" aria-label={words.close} title={words.close} onClick={close}>
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4.5 4.5l11 11M15.5 4.5l-11 11" /></svg>
          </button>
        </div>
        <div class="sky-tools" ref={tools}>
          <button type="button" class="sky-round" aria-label={words.random} title={words.random} onClick={() => sky.current && choose(sky.current.next())}>
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M13.5 3H17v3.5M3 17 17 3M17 13.5V17h-3.5M12.5 12.5 17 17M3 3l4.5 4.5" /></svg>
          </button>
          <div class="sky-zoom">
            <div class="sky-pair">
              <button type="button" class="sky-round sky-out" aria-label={words.zoomOut} title={words.zoomOut} onClick={() => sky.current?.zoom(1 / 1.6)}>
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 10h12" /></svg>
              </button>
              <button type="button" class="sky-round sky-in" aria-label={words.zoomIn} title={words.zoomIn} onClick={() => sky.current?.zoom(1.6)}>
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 4v12M4 10h12" /></svg>
              </button>
            </div>
            <button type="button" class="sky-round sky-fit" aria-label={words.fit} title={words.fit} onClick={() => sky.current?.fit()}>
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M3 8V3h5m4 0h5v5m0 4v5h-5m-4 0H3v-5" /><circle class="dot" cx="10" cy="10" r="1.6" /></svg>
            </button>
          </div>
        </div>
        <p id="sky-keys" class="visually-hidden">{words.keyboardHelp}</p>
      </dialog>
    </div>
  );
}
