import {
  artistPages,
  best,
  contributors,
  href,
  nameOf,
  otherName,
  performers,
  url,
  type Item,
  type Lang,
  type SiteRecord,
} from './record';

export interface MapArtist {
  id: string;
  name: string;
  alternate: string;
  href: string;
  group: boolean;
  connections: Connection[];
  recordings: number[];
}
export interface Connection {
  artist: string;
  membership?: 'member' | 'groupOf' | 'formerMember' | 'formerGroup';
  recording?: number;
}
export interface MapRecording {
  name: string;
  href: string | null;
}
export interface StarMapData {
  artists: MapArtist[];
  recordings: MapRecording[];
}

/** Only artist pages become destinations. Edges require an explicit credit or membership. */
export function buildStarMap(record: SiteRecord, lang: Lang): StarMapData {
  const pages = artistPages(record);
  const links = new Map(pages.map((item) => [item.id, new Map<string, Connection>()]));
  const credits = new Map(pages.map((item) => [item.id, new Set<number>()]));
  const recordings: MapRecording[] = [];
  function connect(from: string, to: string, evidence: Partial<Connection>) {
    const neighbours = links.get(from);
    if (from === to || !neighbours || !links.has(to)) return;
    neighbours.set(to, { ...evidence, ...neighbours.get(to), artist: to });
  }
  for (const item of pages) {
    for (const statement of best(item.statements['member of'])) {
      if (typeof statement.value !== 'string') continue;
      const former = Boolean(statement.qualifiers?.['end time']?.length);
      connect(item.id, statement.value, { membership: former ? 'formerGroup' : 'groupOf' });
      connect(statement.value, item.id, { membership: former ? 'formerMember' : 'member' });
    }
  }
  for (const item of Object.values(record.items)) {
    if (item.type !== 'release') continue;
    const credited = [
      ...new Set(
        [...performers(record, item), ...contributors(record, item)]
          .map((person) => person.id)
          .filter((id) => links.has(id)),
      ),
    ];
    if (!credited.length) continue;
    const recording = recordings.push({ name: nameOf(item, lang).text, href: href(record, lang, item) }) - 1;
    for (const id of credited) {
      credits.get(id)!.add(recording);
      for (const neighbour of credited) connect(id, neighbour, { recording });
    }
  }
  const name = (item: Item) => nameOf(item, lang).text;
  const compare = new Intl.Collator(lang, { numeric: true }).compare;
  const artists = pages
    .map((item) => ({
      id: item.id,
      name: name(item),
      alternate: otherName(item, lang)?.text ?? '',
      href: url(lang, item.page),
      group: item.type === 'act',
      connections: [...links.get(item.id)!.values()].sort((a, b) =>
        compare(name(record.items[a.artist]), name(record.items[b.artist])),
      ),
      recordings: [...credits.get(item.id)!].sort((a, b) => compare(recordings[a].name, recordings[b].name)),
    }))
    .sort((a, b) => compare(a.name, b.name));
  return { artists, recordings };
}
