/** The artist's photo opens full size over the page. Without this script its link opens the image itself. */

const dialog = document.getElementById('photo-dialog') as HTMLDialogElement | null;
const link = document.querySelector<HTMLAnchorElement>('a[data-photo]');
if (dialog && link) {
  const img = dialog.querySelector('img')!;
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!img.getAttribute('src')) img.src = link.href;
    dialog.showModal();
  });
  // A click anywhere but the close button's bar closes it too.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target === img) dialog.close();
  });
}
