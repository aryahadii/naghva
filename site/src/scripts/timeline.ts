/**
 * Timeline filters: by kind, by artist, and a jump to a year. The choice is
 * kept in the address (`?artist=golsa-h74&kind=release`), so an Artist
 * page can link to its own timeline and a filtered view can be shared.
 */

import { rememberTimelinePosition } from '../lib/timeline-position';

const form = document.querySelector<HTMLFormElement>('.timeline-filters');
const entries = [...document.querySelectorAll<HTMLElement>('.entry')];
const years = [...document.querySelectorAll<HTMLElement>('.year')];
const empty = document.querySelector<HTMLElement>('.timeline-empty');

if (form) {
  const chips = [...form.querySelectorAll<HTMLButtonElement>('.chip')];
  const artist = form.elements.namedItem('artist') as HTMLSelectElement;
  const year = form.elements.namedItem('year') as HTMLSelectElement;
  const params = new URLSearchParams(location.search);
  const wanted = params.get('kind')?.split(',');
  if (wanted) for (const chip of chips) chip.setAttribute('aria-pressed', String(wanted.includes(chip.dataset.kind!)));
  if ([...artist.options].some((o) => o.value === params.get('artist'))) artist.value = params.get('artist')!;

  const apply = () => {
    const kinds = new Set(chips.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.dataset.kind));
    const who = artist.value;
    for (const entry of entries) {
      entry.hidden = !kinds.has(entry.dataset.kind) || (who !== '' && !entry.dataset.artists!.split(' ').includes(who));
    }
    let shown = 0;
    for (const section of years) {
      const visible = section.querySelector('.entry:not([hidden])') !== null;
      section.hidden = !visible;
      if (visible) shown++;
    }
    for (const option of year.options) {
      option.disabled = !entries.some((e) => !e.hidden && e.dataset.years?.split(' ').includes(option.value));
    }
    if (year.selectedOptions[0]?.disabled) {
      year.value = entries.find((e) => !e.hidden)?.dataset.years?.split(' ')[0] ?? '';
    }
    if (empty) empty.hidden = shown > 0;

    const query = new URLSearchParams();
    if (who) query.set('artist', who);
    if (kinds.size < chips.length) query.set('kind', [...kinds].join(','));
    const search = query.size ? `?${query}` : '';
    history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
  };

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
      apply();
    });
  }
  artist.addEventListener('change', apply);
  year.addEventListener('change', () => {
    const entry = entries.find((e) => !e.hidden && e.dataset.years?.split(' ').includes(year.value));
    if (!entry) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    entry.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    history.replaceState(history.state, '', `${location.pathname}${location.search}#${entry.closest('.year')!.id}`);
  });

  // The year menu follows the reading position.
  const observer = new IntersectionObserver((seen) => {
    for (const s of seen) if (s.isIntersecting) {
      const first = s.target.querySelector<HTMLElement>('.entry:not([hidden])');
      if (first) year.value = first.dataset.years!.split(' ')[0];
    }
  }, { rootMargin: '-30% 0px -60% 0px' });
  for (const section of years) observer.observe(section);

  apply();

  // Resolve shared entry and legacy year anchors after filtering, so a hidden
  // earlier entry cannot displace the requested reading position.
  const reveal = () => {
    let target: HTMLElement | null = null;
    try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { return; }
    const entry = target?.matches('.year') ? target.querySelector<HTMLElement>('.entry:not([hidden])') : target;
    if (entry?.matches('.entry') && !entry.hidden) {
      entry.scrollIntoView({ block: 'start', behavior: 'instant' });
      rememberTimelinePosition();
    }
  };
  addEventListener('scroll', rememberTimelinePosition, { passive: true });
  addEventListener('hashchange', reveal);
  requestAnimationFrame(reveal);
}

export {};
