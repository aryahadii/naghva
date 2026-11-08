# Website

Naghva's website: a static site generated from the
[published record](../data/README.md), in Persian and English. The
[vision](../specs/vision.md) says what it is for and the
[design spec](../specs/design.md) what its pages are.

Every page arrives as complete HTML, so search engines and readers get all of
it without running any code. Interaction is added on top only where it makes a
page easier to use, and the page still works without it. Every page works on
mobile and desktop.

## Stack

- **Python prepares the data.** `tools/derive.py` validates `data/`, loads it
  with `tools/datastore.py`, and computes what the data store
  [leaves to the site](../data/README.md#what-the-site-derives): display
  names, both ends of every relation, Gregorian ranges, resolved citations,
  addresses and redirects. It writes `site/generated/record.json`, which is
  not committed. Python stays the only reader of the data format, so the site
  and the validator cannot disagree.
- **[Astro](https://astro.build) makes the pages.** It reads that file and
  writes static HTML, one tree per language, plus the search index. Its
  components run at build time and send no JavaScript.
- **Behaviour is TypeScript**, loaded only by the pages that use it. Behaviour
  over HTML that is already there (a dialog, a scrolling row, the contents,
  the timeline's filters) is a plain script; search, which draws its own
  results, is a [Preact](https://preactjs.com) island.
- **Styles are plain CSS**, with the design tokens as custom properties.
  Fonts are served from the site itself. The Persian fonts on naghva.com,
  Farhang2 and IRANSansX, are licensed to the owner and are not in this
  repository: `scripts/fetch-fonts.mjs` downloads them before a build when
  `NAGHVA_FONTS_URL` is set, and otherwise puts the free
  [Vazirmatn](https://github.com/rastikerdar/vazirmatn) in their place, so
  anyone can build the site.
- **GitHub Actions** validates and builds pull requests. On `main`, in a
  repository with Cloudflare configured, it deploys the checked production
  build.

## Pages

| Page | English | Persian |
| --- | --- | --- |
| Home | `/en/` | `/fa/` |
| Artist | `/en/sanam-maroufkhani-a84/` | `/fa/sanam-maroufkhani-a84/` |
| Timeline | `/en/timeline/` | `/fa/timeline/` |

An artist's address is the same in both languages: their name in Latin
script as a source spells it, in lowercase letters and digits joined by
hyphens, then a short tag, the first three characters of their ID after the
`Q`. The tag keeps namesakes apart, and an address never changes when a
namesake arrives. An artist no source spells in Latin script uses the
Persian name instead. Editorial display spellings follow the
[name policy](../specs/data-policies.md#names). Every artist
also answers at their full ID (`/en/Qa84h2k/`), and old names and merged
items redirect permanently, so no link breaks. `site/addresses.json` lists
every page and panel address ever issued: `npm run derive` adds new ones,
CI fails until the list is committed, and an old address always leads to
its item, by redirect for a page and by a lookup in `/panels.json` for a
panel.
`/` opens the language the visitor used last, otherwise their browser's, and
links both.

`/fa/` is right to left. The interface is translated; the data is not. Each
name carries its own `lang` and `dir`, so mixed scripts stay in order.

### Artist page

One per artist with a curated article: header, contents, infobox, lead,
Recordings, Life & work, Events, Sources. Recordings and events are part of
the HTML, not loaded afterwards.

- The contents follow your reading, with Life & work's own headings under
  it; on phones they are a bar at the top.
- Recordings and Events scroll sideways, by swipe or by arrows.
- A release opens in a panel over the page with its cover, date, label,
  performers, writing and production credits, listen links and sources.
  Releases have no pages of their own: the panel has an address within the
  Artist page (`#mirror-for-the-sun-atj`), so it can
  be shared and Back closes it. Its contents are part of the page's HTML, so
  search engines read them, and without JavaScript they open in place.
- A citation number stands for a source and shows that source and the
  quote it rests on in place, so checking a source doesn't lose your place.
  The Sources list keeps every quote under its source.
- The photo opens full size.
- The language switch opens the same page, at the same section, in the other
  language.

### Homepage

The title and the search bar sit in the night sky of a painted garden, then
the latest releases follow in one row, newest first, ending on the way to the
Timeline. A few names under the search bar fill it in. Search answers as
you type, over names in both scripts, and folds Persian spelling variants
(`ي`/`ی`, `ك`/`ک`, zero-width non-joiners, digits). Results are links, and
the keyboard moves through them.

### Timeline

Everything the record dates, earliest first: releases, formations, members
joining and leaving, events, and life events with a point in time. A life
event is shown in its source's own words and language; the Artist page tells
it in the page's. Years are Jalali on the Persian page and
Gregorian on the English one, and each year has its own anchor. Readers can
filter by kind, jump to a year, and narrow the timeline to one artist; each
Artist page links to its own.

### On every page

- Search sits in the header, except on the homepage, where it sits under the title.
- Moving between pages carries shared pieces across, such as an artist's
  name from a card into the page title, in browsers with cross-document view
  transitions; elsewhere it is an ordinary page load.
- Links are fetched ahead when they come into view or are hovered, so the
  next page opens at once.
- Motion follows the reader's reduced-motion setting.

## Images

Naghva shows its own copies of photographs and covers, so a page doesn't
depend on a publisher keeping an image up or unchanged. The record keeps each
image's source address, credit and licence; the files themselves are not in
this repository.

- **Originals** sit in a private Cloudflare R2 bucket, `naghva-media`, as
  `originals/<sha256>.<ext>`. The bucket has no public address, and the
  site's Worker has no binding to it.
- **`media.json`** lists every image the record uses: its source address, the
  original's hash, size and width and height, and the widths the site shows
  it at. When a host keeps a larger copy under a related address (Apple
  Music, Spotify, SoundCloud, Bandcamp, YouTube), the largest is kept, and
  `from` says where it came from.
- **Copies** are made at build time in `public/media/` as
  `<hash>-<width>.webp`, whole and never enlarged, and served with the site
  as static files, cached for a year.

`scripts/media.mjs` does the work:

| Command | Who runs it | Key |
| --- | --- | --- |
| `npm run media:add` | whoever adds images to the record | none |
| `npm run media:upload` | the owner, after `media:add` | R2 write key |
| `npm run media:fetch` | every build (part of `npm run build`) | R2 read key |
| `npm run media:build` | every build (part of `npm run build`) | none |

`media:add` downloads each image the record uses that `media.json` lacks,
keeps the original in `media-cache/` and adds it to `media.json`; it drops the
entries of images the record no longer uses. `media:upload` puts the missing
originals in the bucket and deletes the ones `media.json` no longer lists, so
taking an image down is: remove it from the record, `media:add`,
`media:upload`, commit. Keys go in `site/.env` (never committed):
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and
`R2_BUCKET` if it isn't `naghva-media`.

In CI, only builds of `main` get the read-only key (the `R2_READ_*`
secrets), and keep the originals in the Actions cache, so a build reads from
R2 only when `media.json` changes. Once Cloudflare deploys are on,
`NAGHVA_MEDIA_REQUIRED=1` makes a `main` build fail rather than ship an
image without its own copy. Every other build, such as a pull request from a
fork, shows images from their publishers, and the page tries the publisher
too if an own copy fails to load. The build reads each image's width and
height from `media.json` so the page keeps its place while it loads. Each
image is credited under it with its source. A release without cover art
shows its name in an illuminated frame; an artist without a photo has none.

The miniature art and logos stay in the repository. `npm run art:motifs`
cuts the footer's three motifs out of the design's original PNG.

## Search engines

- Each page has a title and description in its language, a canonical
  address, and `hreflang` links to its twin in the other language.
- Structured data in JSON-LD: `MusicGroup` or `Person` for an artist, with
  names in both scripts, photo, members, and its releases as `MusicAlbum`
  with their covers; breadcrumbs.
- Open Graph tags; the share image is an artist's photo, otherwise the
  Naghva imprint.
- A sitemap of both languages, and `robots.txt`.

## Layout

```text
tools/derive.py           data/ to site/generated/record.json
tools/test_derive.py
site/
├── astro.config.ts
├── addresses.json        every address issued, so none ever breaks
├── wrangler.jsonc        Cloudflare: serve dist/ as static files
├── integrations/         derive again on data edits; write _redirects
├── scripts/              check-output.mjs: the built site's checks
├── public/               favicon, _headers
└── src/
    ├── pages/            index (/), [lang]/index, [lang]/[artist],
    │                     [lang]/timeline, 404, search.json, panels.json,
    │                     robots.txt
    ├── layouts/          Page.astro: head, search-engine tags, fonts,
    │                     header, footer
    ├── components/       build-time pieces: Contents, Infobox, Cover,
    │                     ReleaseCard, ReleasePanel, SourceList
    ├── islands/          Search
    ├── scripts/          page (language switch, transitions), contents,
    │                     shelf, panel, photo, citations, timeline
    ├── styles/           tokens.css, base.css, shelf.css, a file per page
    ├── lib/              the record and what pages make of it: artist,
    │                     citations, dates, images, markdown, search, JSON-LD
    ├── strings/          interface text: en.json, fa.json
    └── assets/           miniature art, resized at build; fonts, fetched
                          by scripts/fetch-fonts.mjs and not committed
```

Logos come from `assets/brand/`.

## Working on it

In `site/`, use a Python 3 environment with `pyyaml` and `jsonschema`, and the
Node version in [.node-version](.node-version). If the Python dependencies are
missing, create a virtual environment outside the checkout and install them
there. Activate that environment before npm commands, which call `python3`.
Run `npm ci` on setup or when the package lock changes.

- `npm run dev` derives the record and starts Astro; editing `data/` derives
  it again.
- `npm run dev:examples` does the same from `data/examples`, with a banner
  saying the data is fictional.
- `npm run build` writes the site to `site/dist/`; `npm run preview` serves
  it.
- `npm run build:examples` writes the fictional site to `site/dist-examples/`.
- `npm run test:browser` tests the built production site in Chromium. Install
  the browser once with `npx playwright install chromium`.

Every pull request runs the derive tests, `astro check`, the build, and a
check of the output: every page has its title, description, canonical address
and twin, no id is used twice, and no internal link or anchor is broken.

The [site workflow](../.github/workflows/site.yml) runs data validation, tests,
type checks, production and example builds, and browser tests. It preserves the
checked production artifact before building examples. On `main`, when the
repository has a `CLOUDFLARE_ACCOUNT_ID` variable, it skips builds
whose commit is no longer current, deploys with `npm run deploy`, and verifies
that both public domains serve the artifact's commit SHA from `/build.json`.
Deployment requires the
repository's Cloudflare credentials. `SITE_URL` holds the published address for
canonical links and the sitemap; CI also requires a full commit SHA in
`NAGHVA_BUILD_SHA` or `GITHUB_SHA`. Local builds identify themselves as `local`.

## Analytics

Session replay and the consent panel are disabled. Visiting the site removes
the retired replay integration's saved choice and tab identity. Only the
minimal cookieless events below remain; keep project session recording off
until the owner explicitly decides otherwise.

PostHog uses the public project configuration in `PUBLIC_POSTHOG_KEY` and
`PUBLIC_POSTHOG_HOST`. Copy `.env.example` to `.env.local` for local builds;
the production workflow reads GitHub repository variables with those same
names. Use the EU project's ingestion host from Project settings. These are
build-time values: changing them requires rebuilding the static site. An empty
value disables analytics. Never put a personal API key in either variable.
In PostHog's Project > Web analytics settings, enable cookieless tracking before
releasing a configured build; otherwise PostHog discards these events.

Tracking runs only on `naghva.com` and `naqva.com`, never on local/preview origins
or fictional example pages, and respects Do Not Track and Global Privacy Control.
The SDK uses `cookieless_mode: 'always'` and no person profiles. Replay, autocapture,
surveys, heatmaps, error collection and performance collection are disabled.
PostHog adds no cookies or local/session storage; the site's existing language
preference still uses local storage.

| Event | Meaning | Additional properties |
| --- | --- | --- |
| `$pageview` | A localized page load, or Back/Forward cache restore | language, page type, path, referring domain |
| `artist_viewed` | An artist page view | artist ID |
| `listen_clicked` | A listening link opened, including from a release dialog | release ID, platform, artist ID when on an artist page |
| `search_used` | First non-empty use of each search surface per document | home, header or results surface |
| `language_switched` | Language switch activated | destination language |

The final payload filter permits only these events and their explicit properties,
plus the SDK's cookieless protocol and coarse browser/device dimensions. Page URLs
come from their generated canonical path; query strings, fragments, referrer paths,
search text, person updates, and link destination URLs are excluded. Attribution
keeps referral origins plus allowlisted `utm_source` and `utm_medium` categories
(see `src/lib/analytics.ts`). Free-form campaign names, terms, content and ad click
IDs are discarded. The root language redirect forwards only that sanitized
attribution, and its temporary referral hint is removed from the localized URL.

[Cookieless tracking](https://posthog.com/tutorials/cookieless-tracking) estimates
visitors with a server-side daily hash of the IP, user agent and hostname. It
cannot reliably measure returning users across days; shared networks can merge
visitors, while changing networks can split them. GeoIP and IP-based bot detection
are unavailable, so traffic-source reporting does not include a country map.
The network request still reaches PostHog with an IP and user agent to derive that
hash. The payload retains `$raw_user_agent` only for cookieless events because
PostHog requires it as a hash input and removes it after hashing; cookieless is
not a claim that no personal data is processed.

Use PostHog Web Analytics for traffic and referral sources, and Product Analytics
for event counts or an `artist_viewed` → `listen_clicked` funnel. Browser tests
intercept the SDK's real outgoing payloads locally; they never ingest test traffic.
