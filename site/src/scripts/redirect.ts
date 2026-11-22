import { landingSearch } from '../lib/analytics';

// Only a visitor who has already picked a language is sent on. First visits,
// and search engines, see the chooser, so `/` stays a page of its own.
const search = landingSearch(location.search, document.referrer, location.origin);
let lang;
try { lang = localStorage.getItem('naghva-lang'); } catch { /* Language preference is optional. */ }
if (lang === 'en' || lang === 'fa') {
  location.replace(`/${lang}/${search}${location.hash}`);
} else if (search) {
  // The language links carry the visit's attribution, as the redirect does.
  // Module scripts run once the page is parsed, so the links exist.
  for (const link of document.querySelectorAll<HTMLAnchorElement>('.languages a')) link.search = search;
}
