import { url, type Lang } from './record';

/**
 * The suggestion form in each language: its pre-filled link with the page
 * question's value replaced by `{page}`. An empty one sends readers to the
 * Contribute page instead. Until an English form exists, both use the Persian.
 */
const PERSIAN_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSfU6IET4DHnjCe9RHL98BhHDeMk9Mz51OtDGsnifdsR4W8cFQ/viewform?usp=pp_url&entry.1342445263={page}';
const FORMS: Record<Lang, string> = {
  en: PERSIAN_FORM,
  fa: PERSIAN_FORM,
};

/** The form itself, with no page filled in, or the contact address until it exists. */
export function formUrl(lang: Lang): string {
  return FORMS[lang] ? FORMS[lang].replace('{page}', '') : 'mailto:contact@naghva.com';
}

/** Where a reader goes to suggest an edit, with the page they came from filled in. */
export function suggestUrl(lang: Lang, page?: URL): string {
  const form = FORMS[lang];
  if (!form) return `${url(lang, 'contribute')}#form`;
  return form.replace('{page}', page ? encodeURIComponent(page.href) : '');
}
