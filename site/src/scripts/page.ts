/**
 * On every page: the language switch opens the other language at the same
 * place, and an artist's name travels from the link into the page it opens.
 */

import { currentTimelineEntry } from '../lib/timeline-position';

const language = document.querySelector<HTMLAnchorElement>('a.language');
language?.addEventListener('click', () => {
  const target = new URL(language.href);
  target.hash = '';
  // Filters in the address, such as the timeline's, carry over.
  target.search = location.search;
  // The part of the page being read: an open panel, else the contents' current entry.
  const open = location.hash && document.querySelector('dialog[open]') ? location.hash : '';
  const reading = document.querySelector<HTMLAnchorElement>('.contents a[data-current]') ?? document.querySelector<HTMLAnchorElement>('.contents a[aria-current]');
  const timeline = document.querySelector('.timeline');
  const entry = timeline ? currentTimelineEntry() : undefined;
  const current = timeline ? (entry ? `#${entry.id}` : '') : open || reading?.hash || '';
  if (current && current !== '#overview') {
    const twins: { [anchor: string]: string } = JSON.parse(language.dataset.twins ?? '{}');
    const anchor = decodeURIComponent(current.slice(1));
    target.hash = twins[anchor] ?? anchor;
  }
  language.href = target.href;
});

// Cross-document view transitions: name the element that should morph into the next page's title.
let clicked: HTMLElement | null = null;
document.addEventListener('click', (event) => {
  const link = (event.target as Element).closest?.<HTMLElement>('a[href]');
  clicked = link?.matches('[data-vt="artist-name"]') ? link : link?.querySelector<HTMLElement>('[data-vt="artist-name"]') ?? null;
});
addEventListener('pageswap', (event) => {
  const swap = event as Event & { viewTransition?: unknown };
  if (swap.viewTransition && clicked) clicked.style.viewTransitionName = 'artist-name';
});
addEventListener('pageshow', () => {
  if (clicked) clicked.style.viewTransitionName = '';
});

export {};
