// A year column shows its year and count on tap, click or keyboard focus; one at a time per chart.
for (const chart of document.querySelectorAll<HTMLElement>('.cols')) {
  const bars = [...chart.querySelectorAll<HTMLElement>('.col[data-tip]')];
  const show = (bar: HTMLElement | null) => bars.forEach((b) => b.classList.toggle('is-on', b === bar));
  for (const bar of bars) {
    bar.addEventListener('click', () => show(bar.classList.contains('is-on') ? null : bar));
    // Only keyboard focus opens a bubble here; a mouse or tap press is handled by the click.
    bar.addEventListener('focus', () => { if (bar.matches(':focus-visible')) show(bar); });
    bar.addEventListener('keydown', (e) => {
      const i = bars.indexOf(bar);
      const next = e.key === 'ArrowRight' ? bars[i + 1] : e.key === 'ArrowLeft' ? bars[i - 1] : e.key === 'Escape' ? null : undefined;
      if (next === undefined) return;
      e.preventDefault();
      if (next) next.focus(); else { show(null); bar.blur(); }
    });
  }
}
document.addEventListener('click', (e) => {
  if (!(e.target as Element).closest?.('.col[data-tip]')) document.querySelectorAll('.col.is-on').forEach((b) => b.classList.remove('is-on'));
});
