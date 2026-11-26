/**
 * A release opens in a dialog over the Artist page. The dialog follows the
 * address: following a release's #address opens it, Back closes it, and a
 * shared link opens the page with the release showing.
 */

const dialog = document.getElementById('release-dialog') as HTMLDialogElement | null;
let opener: HTMLElement | null = null;
let activePanel: string | null = null;
let explicitDestination = false;
let opened = false; // opened by a click on this page, so closing can go Back

function panelFor(hash: string): HTMLElement | null {
  if (!hash) return null;
  const el = document.getElementById(decodeURIComponent(hash.slice(1)));
  return el?.classList.contains('release-panel') ? el : null;
}

function show(panel: HTMLElement) {
  if (!dialog) return;
  activePanel = panel.id;
  const copy = panel.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.className = 'release-open';
  for (const el of copy.querySelectorAll('[id]')) el.id = `dialog-${el.id}`;
  dialog.setAttribute('aria-labelledby', `dialog-${panel.id}-title`);
  dialog.replaceChildren(copy);
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  copy.querySelector<HTMLElement>('[data-close]')?.focus({ preventScroll: true });
}

function sync() {
  const panel = panelFor(location.hash);
  if (panel) {
    show(panel);
    explicitDestination = false; // a hop to another panel; closing returns to the card
  } else if (dialog?.open) {
    dialog.close();
    // Source navigation keeps its explicit destination. Ordinary closing and
    // Back return to the control that opened this release.
    const target = explicitDestination && location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
    else restoreFocus();
    explicitDestination = false;
    opened = false;
  }
  if (!panel) follow();
}

/** An address from before a release was renamed or moved to another page: find where it is now. */
async function follow() {
  const name = decodeURIComponent(location.hash.slice(1));
  if (!name || document.getElementById(name)) return;
  try {
    const moved: { [anchor: string]: string } = await (await fetch('/panels.json')).json();
    if (!moved[name] || name !== decodeURIComponent(location.hash.slice(1))) return;
    const target = new URL(`/${document.documentElement.lang}${moved[name]}`, location.href);
    target.search = location.search;
    if (target.pathname !== location.pathname) location.replace(target);
    else if (target.hash !== location.hash) {
      history.replaceState(history.state, '', target.hash);
      sync();
    }
  } catch {
    // Without the list the page stays as it is, at its top.
  }
}

/** The card that opens a panel; a track folded into its album has none, so its album's. */
function cardFor(anchor: string | null): HTMLAnchorElement | undefined {
  const cards = [...document.querySelectorAll<HTMLAnchorElement>('[data-release]')].filter((card) => !card.closest('[hidden]'));
  const own = cards.find((card) => decodeURIComponent(card.hash.slice(1)) === anchor);
  if (own || !anchor) return own;
  const album = [...document.querySelectorAll<HTMLAnchorElement>('.release-panel .release-facts a[href^="#"]')]
    .find((link) => decodeURIComponent(link.hash.slice(1)) === anchor)?.closest('.release-panel')?.id;
  return cards.find((card) => decodeURIComponent(card.hash.slice(1)) === album);
}

function restoreFocus() {
  const matching = cardFor(activePanel);
  const target = opener?.isConnected && (opener as HTMLAnchorElement).hash && decodeURIComponent((opener as HTMLAnchorElement).hash.slice(1)) === activePanel && !opener.closest('[hidden]') ? opener : matching ?? document.getElementById('recordings-title');
  if (target) {
    if (!target.matches('a, button, input')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    const box = target.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight || box.left < 0 || box.right > innerWidth) target.scrollIntoView({ block: 'center', inline: 'center' });
  }
}

function close() {
  if (opened) {
    opened = false;
    history.back();
  } else {
    history.replaceState(history.state, '', location.pathname + location.search);
    dialog?.close();
    restoreFocus();
  }
}

if (dialog) {
  document.addEventListener('click', (event) => {
    const card = (event.target as Element).closest('[data-release]');
    if (card && event instanceof MouseEvent && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      opened = true;
      opener = card as HTMLElement;
    }
  });
  dialog.addEventListener('click', (event) => {
    const target = event.target as Element;
    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (link?.hash && !link.matches('.cite, [data-close]')) explicitDestination = true;
    if (target.closest('[data-close]')) {
      event.preventDefault();
      close();
    } else if (target === dialog) {
      // A click on the backdrop, outside the dialog's box.
      const box = dialog.getBoundingClientRect();
      const { clientX: x, clientY: y } = event as MouseEvent;
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) close();
    }
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  // Closing is handled by close()/sync(). A queued native close event must
  // never edit the URL: a later click may already be opening another panel.
  addEventListener('hashchange', sync);
  sync();
}

export {};
