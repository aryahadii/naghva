import { strings } from './i18n';
import type { Lang } from './record';

/** The listening platforms the data policy allows, named by host. */
const HOSTS: [RegExp, keyof ReturnType<typeof strings>['platforms']][] = [
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)open\.spotify\.com$/, 'spotify'],
  [/(^|\.)soundcloud\.com$/, 'soundcloud'],
  [/(^|\.)bandcamp\.com$/, 'bandcamp'],
  [/(^|\.)music\.apple\.com$/, 'apple'],
  [/(^|\.)t\.me$/, 'telegram'],
];

export function platformKey(url: string): keyof ReturnType<typeof strings>['platforms'] | undefined {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const match = HOSTS.find(([pattern]) => pattern.test(host));
  return match?.[1];
}

export function platform(url: string, lang: Lang): string {
  const key = platformKey(url);
  return key ? strings(lang).platforms[key] : new URL(url).hostname.replace(/^www\./, '');
}
