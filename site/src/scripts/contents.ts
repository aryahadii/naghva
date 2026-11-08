/** The contents follow your reading: the part on screen is marked, and on phones the bar keeps it in view. */

const subsections = [...document.querySelectorAll<HTMLDetailsElement>('.contents-subsections')];
const mobile = matchMedia('(max-width: 1100px)');
const sizeContents = () => { for (const details of subsections) details.open = !mobile.matches; };
mobile.addEventListener('change', sizeContents);
sizeContents();
for (const details of subsections) details.addEventListener('click', (event) => {
  if ((event.target as Element).closest('a') && mobile.matches) details.open = false;
});

document.addEventListener('click', (event) => {
  if (!mobile.matches) return;
  for (const details of subsections) if (!details.contains(event.target as Node)) details.open = false;
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !mobile.matches) return;
  const opened = subsections.find((details) => details.open);
  if (opened) { opened.open = false; opened.querySelector('summary')?.focus(); }
});

const top = [...document.querySelectorAll<HTMLAnchorElement>('.contents > ol > li > a')];
const sub = [...document.querySelectorAll<HTMLAnchorElement>('.contents ol ol a')];
const target = (a: HTMLAnchorElement) => document.getElementById(decodeURIComponent(a.hash.slice(1)));

function current(links: HTMLAnchorElement[]): HTMLAnchorElement | undefined {
  let found: HTMLAnchorElement | undefined;
  for (const link of links) {
    const el = target(link);
    if (el && el.getBoundingClientRect().top < 150) found = link;
  }
  return found;
}

function follow() {
  const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
  const main = atEnd ? top.at(-1) : current(top) ?? top[0];
  for (const link of top) {
    if (link !== main) { link.removeAttribute('aria-current'); continue; }
    if (link.hasAttribute('aria-current')) continue;
    link.setAttribute('aria-current', 'location');
    // On narrow screens the contents scroll sideways; keep the current part in view.
    const bar = link.closest('ol')!;
    if (bar.scrollWidth > bar.clientWidth) {
      const a = link.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      bar.scrollBy({ left: a.left + a.width / 2 - (b.left + b.width / 2), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }
  const inner = main?.parentElement?.querySelector('ol') ? current(sub) : undefined;
  for (const link of sub) link.toggleAttribute('data-current', link === inner);
}

let ticking = false;
addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { follow(); ticking = false; });
}, { passive: true });
addEventListener('resize', follow);
follow();

export {};
