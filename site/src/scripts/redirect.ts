import { landingSearch } from '../lib/analytics';

let lang;
try { lang = localStorage.getItem('naghva-lang'); } catch { /* Language preference is optional. */ }
if (lang !== 'en' && lang !== 'fa') {
  lang = 'en';
  for (const preferred of navigator.languages || [navigator.language || '']) {
    const code = preferred.slice(0, 2).toLowerCase();
    if (code === 'fa' || code === 'en') { lang = code; break; }
  }
}
location.replace(`/${lang}/${landingSearch(location.search, document.referrer, location.origin)}${location.hash}`);
