/**
 * Keeps a search box's results inside the part of the window that can be seen.
 * A phone's keyboard shrinks that part without resizing the page, so the room
 * under the panel's top edge is measured and given to it as
 * `--search-available-height`. Returns the way to stop.
 */
export function keepInView(panel: HTMLElement): () => void {
  const viewport = window.visualViewport;
  const fit = () => {
    const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const height = Math.max(0, Math.floor(bottom - panel.getBoundingClientRect().top - 12));
    panel.style.setProperty('--search-available-height', `${height}px`);
  };
  fit();
  viewport?.addEventListener('resize', fit);
  viewport?.addEventListener('scroll', fit);
  window.addEventListener('resize', fit);
  window.addEventListener('scroll', fit, { passive: true });
  return () => {
    viewport?.removeEventListener('resize', fit);
    viewport?.removeEventListener('scroll', fit);
    window.removeEventListener('resize', fit);
    window.removeEventListener('scroll', fit);
  };
}
