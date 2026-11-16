/** Where readers write to us. */
export const CONTACT = 'contact@naghva.com';

/**
 * The suggestion form's pre-filled link, with the page question's value
 * replaced by `{page}`. It is the Persian form, used on both languages'
 * pages until an English one exists.
 */
const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSfU6IET4DHnjCe9RHL98BhHDeMk9Mz51OtDGsnifdsR4W8cFQ/viewform?usp=pp_url&entry.1342445263={page}';

/** The suggestion form, with the page the reader came from filled in when there is one. */
export function suggestUrl(page?: URL): string {
  return FORM.replace('{page}', page ? encodeURIComponent(page.href) : '');
}
