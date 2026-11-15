import { strings } from './i18n';
import { loadRecord, type Lang } from './record';

export type PlatformKey = keyof ReturnType<typeof strings>['platforms'];

const hostAllowed = (host: string, hosts: string[]) => hosts.some((h) => host === h || host.endsWith(`.${h}`));

/** The listening platform a URL is on, by the registry's `platforms` table. */
export function platformKey(url: string): PlatformKey | undefined {
  const host = new URL(url).hostname.toLowerCase();
  const match = Object.entries(loadRecord().platforms).find(([, hosts]) => hostAllowed(host, hosts));
  return match?.[0] as PlatformKey | undefined;
}

export function platform(url: string, lang: Lang): string {
  const key = platformKey(url);
  return key ? strings(lang).platforms[key] : new URL(url).hostname.replace(/^www\./, '');
}
