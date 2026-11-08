/**
 * A citation shows its source and quote in place, so checking a source
 * doesn't lose your place. Without scripts it links to the Sources list.
 */

const pop = document.getElementById('cite-pop') as HTMLElement | null;

// A long Sources list shows its first few until the reader asks for the rest.
const list = document.getElementById('source-list');
const more = document.getElementById('source-more') as HTMLButtonElement | null;
const fold = (folded: boolean) => {
  if (!list || !more) return;
  list.classList.toggle('folded', folded);
  more.setAttribute('aria-expanded', String(!folded));
  more.textContent = folded ? more.dataset.more! : more.dataset.less!;
};
if (list && more && list.hasAttribute('data-folds')) {
  fold(true);
  more.addEventListener('click', () => {
    const folded = !list.classList.contains('folded');
    fold(folded);
    if (folded) list.scrollIntoView({ block: 'nearest' });
  });
  // A link into a folded source unfolds the list before the browser scrolls to it.
  document.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    const to = link && link.hash ? document.getElementById(decodeURIComponent(link.hash.slice(1))) : null;
    if (to?.closest('.source-extra')) fold(false);
  }, true);
}
let from: HTMLAnchorElement | null = null;
let dismissing: HTMLAnchorElement | null = null;

function fill(cite: HTMLAnchorElement) {
  if (!pop) return;
  const item = document.getElementById(decodeURIComponent(cite.hash.slice(1)));
  if (!item) return;
  const head = item.querySelector('div')!.cloneNode(true) as HTMLElement;
  head.querySelector('details')?.remove();
  const tag = Object.assign(document.createElement('span'), { className: 'tag', textContent: cite.getAttribute('aria-label') });
  const quotes = (cite.dataset.quote ?? '').split(' ').map((id) => document.getElementById(id)).filter((q): q is HTMLElement => Boolean(q));
  const copies = quotes.map((q) => {
    const copy = q.cloneNode(true) as HTMLElement;
    copy.removeAttribute('id');
    return copy;
  });
  const links = document.createElement('p');
  links.className = 'cite-links';
  const url = head.querySelector<HTMLAnchorElement>('a.source-title')?.href;
  if (url) links.append(Object.assign(document.createElement('a'), { className: 'text-link', href: url, target: '_blank', rel: 'noopener noreferrer', textContent: `${pop.dataset.open} ↗` }));
  links.append(Object.assign(document.createElement('a'), { className: 'text-link', href: `#${quotes[0]?.id ?? item.id}`, textContent: pop.dataset.inSources }));
  pop.replaceChildren(tag, head, ...copies, links);
}

function place(cite: HTMLElement) {
  if (!pop) return;
  const r = cite.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12);
  const below = r.bottom + 10 + h < innerHeight || r.top - 10 - h < 0;
  pop.style.left = `${left}px`;
  pop.style.top = `${below ? r.bottom + 10 : r.top - 10 - h}px`;
}

if (pop) {
  // Light-dismiss runs before click. Remember an already-open trigger so a
  // second pointer click closes it rather than immediately reopening it.
  document.addEventListener('pointerdown', (event) => {
    const cite = (event.target as Element).closest<HTMLAnchorElement>('a.cite');
    dismissing = cite === from && pop.matches(':popover-open') ? cite : null;
  }, true);
  document.addEventListener('click', (event) => {
    const cite = (event.target as Element).closest<HTMLAnchorElement>('a.cite');
    if (!cite) return;
    event.preventDefault();
    if ((pop.matches(':popover-open') && from === cite) || dismissing === cite) {
      dismissing = null;
      if (pop.matches(':popover-open')) pop.hidePopover();
      return;
    }
    dismissing = null;
    from = cite;
    // Inside an open dialog the popover must live in it, or the dialog makes it inert.
    const host = cite.closest('dialog') ?? document.body;
    if (pop.parentElement !== host) host.append(pop);
    fill(cite);
    if (!pop.matches(':popover-open')) pop.showPopover();
    place(cite);
    pop.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
  });
  pop.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'closed' && pop.contains(document.activeElement)) from?.focus({ preventScroll: true });
  });
  addEventListener('scroll', () => pop.matches(':popover-open') && from && place(from), { passive: true });
  addEventListener('resize', () => pop.matches(':popover-open') && pop.hidePopover());
  // Following a quote's address opens the source it sits in.
  const reveal = () => {
    const el = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (el?.closest('.source-extra') && list?.classList.contains('folded')) {
      fold(false);
      el.scrollIntoView({ block: 'center' });
    }
    const details = el?.closest('details');
    if (el && details && !details.open) {
      details.open = true;
      el.scrollIntoView({ block: 'center' });
    }
    if (pop.matches(':popover-open')) pop.hidePopover();
  };
  addEventListener('hashchange', reveal);
  reveal();
}

export {};
