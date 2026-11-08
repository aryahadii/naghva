import { Citations, type CitedSource } from './citations';
import { yearOf } from './dates';
import { dateHtml, esc, nameHtml, plainText, summary } from './html';
import { fill, list, num, other, strings } from './i18n';
import { COVER_WIDTHS, imageOf, PHOTO_WIDTHS, type LinkedImage } from './images';
import { renderArticle } from './markdown';
import { platform } from './platforms';
import {
  best, recordingArtists, datesDisagree, href, isDate, isText, nameOf, otherName, panelReleasesOf, releaseDates, releasesOf, url,
  type Article, type DateValue, type Item, type Lang, type SiteRecord, type Statement, type Text, type Reference,
} from './record';

/** Everything an Artist page shows, worked out before any of it is rendered. */

export interface Fact { label: string; html: string }
export interface ListenLink { href: string; label: string; references: Reference[]; citations: string }
/** An image with its caption: who made it, its license, and its sources. */
export interface ImageView { image: LinkedImage; caption: string }
export interface ReleaseView {
  item: Item;
  anchor: string;
  title: Text;
  cover: ImageView | null;
  other: Text | null;
  date: string | null;
  year: string | null;
  with: string | null;
  facts: Fact[];
  listen: ListenLink[];
}
export interface SectionView { heading: string; anchor: string; html: string }
export interface EventView { item: Item; date: string | null; evidence: string }
export interface ArtistView {
  name: Text;
  other: Text | null;
  /** HTML: “Artist · Tehran”. */
  kicker: string;
  photo: (ImageView & { width: number; height: number }) | null;
  facts: Fact[];
  lead: string | null;
  sections: SectionView[];
  /** Set when the article is only written in the other language. */
  articleElsewhere: Lang | null;
  releases: ReleaseView[];
  releasePanels: ReleaseView[];
  events: EventView[];
  sources: CitedSource[];
  description: string;
  /** This page's section anchors and their twins on the other language's page. */
  twins: { [anchor: string]: string };
}

// Ids the page itself uses, which a Life & work heading must not take.
const RESERVED = new Set([
  'overview', 'recordings', 'life', 'events', 'sources', 'article', 'contents', 'content',
  'contents-title', 'catalog', 'catalog-tools', 'catalog-query', 'catalog-sort', 'catalog-count',
  'catalog-reset', 'catalog-empty', 'catalog-expand', 'event-list', 'cite-pop', 'release-dialog', 'photo-dialog',
]);
const RESERVED_FORMS = /^(source-\d+|q\d+|search-.*|.*-title)$/;

/** Life & work's section anchors, kept clear of the page's other ids and of each other. */
function sectionAnchors(article: Article | undefined, panels: Set<string>): string[] {
  const used = new Set<string>();
  return (article?.sections ?? []).map((s) => {
    let anchor = RESERVED.has(s.anchor) || RESERVED_FORMS.test(s.anchor) || panels.has(s.anchor) ? `${s.anchor}-section` : s.anchor;
    while (used.has(anchor)) anchor += '-';
    used.add(anchor);
    return anchor;
  });
}

/** An image's caption: “Photo: name”, or where it came from, then its license and citations. */
function captioned(lang: Lang, image: LinkedImage | null, kind: 'photo' | 'cover', cites: Citations): ImageView | null {
  if (!image) return null;
  const t = strings(lang).image;
  const who = image.credit
    ? fill(esc(t[kind]), { name: nameHtml(image.credit, lang) })
    : esc(kind === 'photo' ? t.photoSource : t.coverSource);
  const license = image.license ? ` · <a class="text-link" href="${esc(image.license)}" rel="license noopener" target="_blank">${esc(t.license)}</a>` : '';
  return { image, caption: who + license + cites.run(image.references) };
}

const live = (statements: Statement[] | undefined) => (statements ?? []).filter((s) => s.rank !== 'deprecated');

function roles(lang: Lang, statement: Statement | undefined): string {
  const words = strings(lang).roles as { [role: string]: string };
  const terms = (statement?.qualifiers?.role ?? []).map((r) => words[r as string] ?? String(r));
  return terms.length ? ` <span class="role">(${esc(list(lang, terms))})</span>` : '';
}

/** The statement on `from` that points at `to` through `property`, for its qualifiers and references. */
function statementTo(from: Item, property: string, to: string): Statement | undefined {
  return live(from.statements[property]).find((s) => s.value === to);
}

/**
 * `photoSize` is the photo's own width and height, which the page looks up
 * first; without it the page goes without the photo.
 */
export function artistView(
  record: SiteRecord, artist: Item, lang: Lang, photoSize: { width: number; height: number } | null = null,
): ArtistView {
  const t = strings(lang);
  const cites = new Citations(record, lang);
  const self = url(lang, artist.page);
  const link = (item: Item) => {
    const to = href(record, lang, item);
    return to === self ? null : to;
  };
  const name = (item: Item) => nameHtml(nameOf(item, lang), lang, link(item));
  const releases = releasesOf(record, artist);
  const panelReleases = panelReleasesOf(record, artist);

  // The photo comes first on the page, so its sources are numbered first.
  const photoImage = photoSize && imageOf(artist, 'image', PHOTO_WIDTHS);
  const photo = photoImage ? { ...captioned(lang, photoImage, 'photo', cites)!, ...photoSize } : null;

  // Infobox: what the record states about the artist, each fact with its sources.
  const facts: Fact[] = [];
  const add = (label: string, html: string | null) => html && facts.push({ label, html });
  const items = (statements: Statement[]) =>
    statements.map((s) => record.items[s.value as string]).filter((x): x is Item => Boolean(x));

  const based = best(artist.statements['based in']);
  const profiles = live(artist.statements['profile link']);
  add(t.artist.profiles, profiles.length ? profiles.map((s) =>
    `<a class="text-link" href="${esc(String(s.value))}" rel="noopener" target="_blank">${esc(platform(String(s.value), lang))}</a>${cites.run(s.references)}`
  ).join('<br>') : null);
  add(t.artist.based, based.length ? list(lang, items(based).map(name)) + cites.run(based.flatMap((s) => s.references)) : null);
  if (artist.type === 'person') {
    const legal = best(artist.statements['legal name']).filter((s) => isText(s.value));
    add(t.artist.legalName, legal.length ? legal.map((s) => nameHtml(s.value as Text, lang)).join(', ') + cites.run(legal.flatMap((s) => s.references)) : null);
    const born = best(artist.statements['birth date']).filter((s) => isDate(s.value));
    add(t.artist.born, born[0] ? dateHtml(born[0].value as DateValue, lang) + cites.run(born[0].references) : null);
    const place = best(artist.statements.birthplace);
    add(t.artist.birthplace, place.length ? list(lang, items(place).map(name)) + cites.run(place.flatMap((s) => s.references)) : null);
    const acts = best(artist.statements['member of']);
    add(t.artist.memberOf, acts.length ? list(lang, items(acts).map((act) => name(act) + roles(lang, statementTo(artist, 'member of', act.id)))) + cites.run(acts.flatMap((s) => s.references)) : null);
  } else {
    const formed = live(artist.statements['formation date']).filter((s) => isDate(s.value));
    add(t.artist.formed, formed.length ? formed.map((s) => dateHtml(s.value as DateValue, lang) + cites.run(s.references)).join('<br>') : null);
    const members = artist.incoming
      .filter((i) => i.property === 'member of' && i.rank !== 'deprecated')
      .map((i) => record.items[i.item])
      .filter((x): x is Item => Boolean(x))
      .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i);
    const member = (person: Item) => {
      const s = statementTo(person, 'member of', artist.id);
      return name(person) + roles(lang, s) + cites.run(s?.references ?? []);
    };
    const left = (person: Item) => Boolean(statementTo(person, 'member of', artist.id)?.qualifiers?.['end time']?.length);
    const current = members.filter((p) => !left(p));
    const former = members.filter(left);
    add(t.artist.members, current.length ? current.map(member).join('<br>') : null);
    add(t.artist.formerMembers, former.length ? former.map(member).join('<br>') : null);
  }
  const years = releases.flatMap(releaseDates).map((d) => yearOf(d, lang));
  if (years.length) {
    const [first, last] = [Math.min(...years), Math.max(...years)];
    add(t.artist.onRecord, first === last ? num(lang, first) : `${num(lang, first)}–${num(lang, last)}`);
  }
  const labels = [...new Set(releases.flatMap((r) => best(r.statements['published by']).map((s) => s.value as string)))]
    .map((id) => record.items[id])
    .filter((x): x is Item => Boolean(x));
  add(t.artist.labels, labels.length ? list(lang, labels.map(name)) : null);

  // The article in this page's language; if there is only the other one, the page says so.
  const articles = record.articles[artist.id] ?? {};
  const article = articles[lang];
  const elsewhere = !article && articles[other(lang)] ? other(lang) : null;
  const lead = article?.lead ? renderArticle(article.lead, lang, article.notes, cites) : null;
  const panels = new Set(panelReleases.map((r) => r.anchor ?? r.id));
  const anchors = sectionAnchors(article, panels);
  const sections = (article?.sections ?? []).map((s, i) => (
    { heading: s.heading, anchor: anchors[i], html: renderArticle(s.markdown, lang, article!.notes, cites) }
  ));

  // Recordings: each release's panel, with its own sources numbered after the article's.
  const releaseViews: ReleaseView[] = panelReleases.map((r) => {
    const cover = captioned(lang, imageOf(r, 'cover art', COVER_WIDTHS), 'cover', cites);
    const dates = live(r.statements['release date']).filter((s) => isDate(s.value));
    const values = releaseDates(r);
    const date = values.length ? values.map((d) => dateHtml(d, lang)).join(' / ') : null;
    const performers = best(r.statements.performer);
    const billed = recordingArtists(record, r);
    const others = billed.filter((p) => p.id !== artist.id);
    const labels = best(r.statements['published by']);
    const factsOf: Fact[] = [];
    if (dates.length) factsOf.push({ label: t.release.released, html: dates.map((s) =>
      dateHtml(s.value as DateValue, lang) + cites.run(s.references)
    ).join('<br>') + (datesDisagree(values) ? `<br><span class="note">${esc(t.release.dateDisagreement)}</span>` : '') });
    if (labels.length) factsOf.push({ label: t.release.label, html: list(lang, items(labels).map(name)) + cites.run(labels.flatMap((s) => s.references)) });
    // Performers and writing or production credits are separate claims, so they get separate rows.
    for (const [label, statements] of [[t.release.performers, performers], [t.release.contributors, best(r.statements.contributor)]] as const) {
      if (!statements.length) continue;
      const people = [...new Map(items(statements).map((p) => [p.id, p])).values()];
      const credited = people.map((item) => {
        const own = statements.filter((s) => s.value === item.id);
        const role = [...new Set(own.flatMap((s) => s.qualifiers?.role ?? []))];
        return name(item) + roles(lang, { ...own[0], qualifiers: { role } });
      });
      factsOf.push({ label, html: list(lang, credited) + cites.run(statements.flatMap((s) => s.references)) });
    }
    const destinations = new Map<string, Reference[]>();
    for (const s of live(r.statements['listen link'])) {
      const href = String(s.value);
      const refs = destinations.get(href) ?? [];
      for (const ref of s.references) {
        if (!refs.some((r) => r.source === ref.source && r.quote === ref.quote && r.locator === ref.locator && r.accessed === ref.accessed)) refs.push(ref);
      }
      destinations.set(href, refs);
    }
    const listen = [...destinations].map(([href, references]) => ({
      href, references, label: platform(href, lang), citations: cites.run(references),
    }));
    return {
      item: r,
      anchor: r.anchor ?? r.id,
      title: nameOf(r, lang),
      other: otherName(r, lang),
      cover,
      date,
      year: values.length ? [...new Set(values.map((d) => num(lang, yearOf(d, lang))))].join(' / ') : null,
      with: others.length ? fill(billed.some((p) => p.id === artist.id) ? t.artist.with : t.artist.creditedTo,
        { names: list(lang, others.map((p) => nameHtml(nameOf(p, lang), lang))) }) : null,
      facts: factsOf,
      listen,
    };
  });

  const events = artist.incoming
    .filter((i) => record.items[i.item]?.type === 'event' && i.rank !== 'deprecated')
    .map((i) => record.items[i.item])
    .filter((e) => best(e.statements.performer).some((s) => s.value === artist.id))
    .filter((e, i, all) => all.findIndex((v) => v.id === e.id) === i)
    .sort((a, b) => {
      const start = (e: Item) => live(e.statements['event date']).map((s) => s.value).filter(isDate)
        .map((d) => d.range[0]).sort()[0] ?? '9999';
      return start(a).localeCompare(start(b));
    })
    .map((item) => {
      const dates = live(item.statements['event date']).filter((s) => isDate(s.value));
      return { item, date: dates.length ? dates.map((s) => dateHtml(s.value as DateValue, lang)).join(' / ') : null,
        evidence: cites.run([...best(item.statements.name), ...dates, ...best(item.statements.performer)].flatMap((s) => s.references)) };
    });

  const twins: { [anchor: string]: string } = {};
  const twin = articles[other(lang)];
  if (article && twin && twin.sections.length === sections.length) {
    const theirs = sectionAnchors(twin, panels);
    sections.forEach((s, i) => { twins[s.anchor] = theirs[i]; });
  }

  const based0 = items(based)[0];
  return {
    name: nameOf(artist, lang),
    other: otherName(artist, lang),
    kicker: based0 ? `${esc(t.artist.kicker)} · ${nameHtml(nameOf(based0, lang), lang)}` : esc(t.artist.kicker),
    photo,
    facts,
    lead,
    sections,
    articleElsewhere: elsewhere,
    releases: releaseViews.filter((view) => releases.some((release) => release.id === view.item.id)),
    releasePanels: releaseViews,
    events,
    sources: cites.list(),
    description: article?.lead ? summary(plainText(article.lead)) : fill(t.artist.description, { name: nameOf(artist, lang).text }),
    twins,
  };
}
