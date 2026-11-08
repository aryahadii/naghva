# Data store

This directory is Naghva's data store: everything the project knows, kept as
plain text in this repository. The model it follows is the
[Data framework](../specs/data-framework.md); this file says how that model is
written down on disk, so that people, agents and tools agree on every byte.

```text
data/
├── README.md         this file
├── AGENTS.md         rules for agents editing data/
├── schema/           machine-readable format: property registry, JSON Schemas
├── capture/          evidence, loosely structured (Markdown)
│   ├── sources/      one file per source found, with its quotes and notes
│   └── notes/        anything else a researcher wants to keep
├── published/        the record the website serves, Wikibase-shaped (YAML)
│   ├── items/        one file per item, in a directory per type
│   └── articles/     an artist's life and work in prose, per language
└── examples/         a small fictional capture and record
```

Two layers, as the framework describes:

- **Capture** is evidence. One Markdown file per source, with a few lines of
  metadata and a free body of verbatim quotes and notes. Many people and
  agents write here at once; the only check is that the metadata parses.
- **Published** is the record. Wikibase-style items and statements, and an
  article per artist, every claim backed by a quote that exists in
  capture. It is the only thing the website reads, and it changes only
  through a reviewed pull request.

## Decisions

- **Plain text in git.** Markdown and YAML only, UTF-8, LF line endings.
  Every change is a reviewable diff; history is the audit trail; there is no
  database to run. Snapshots of sources are not stored; an archive link is.
- **Markdown for capture, YAML for published.** Capture is where quotes and
  notes pile up, and Markdown asks nothing of the writer. The record is
  structured and reviewed, and YAML holds structure while staying readable,
  with Persian quotes in place.
- **One file per record.** One source per file, one item per file. Parallel
  branches do not collide, and a diff names exactly what changed.
- **People name capture files, randomness names items.** A capture file is
  named after its URL, so finding and citing it needs no lookup. An item's ID
  is `Q` plus six random characters, because it will outlive every name the
  item has and will end up in URLs, and two branches can mint IDs at the same
  time without a counter.
- **Evidence is the gate.** A reference may quote only words that sit in a
  blockquote of the capture file it cites, and the validator checks that. The
  reviewer checks the rest: that the quote is really in the source and really
  supports the claim.
- **Review is the fact-check.** There is no checked flag. Merging a change
  into `published/` is the check, and git history says who made it.
- **The spec stays the authority.** The property tables in
  [data-framework.md](../specs/data-framework.md) define the vocabulary.
  `schema/properties.yaml` is their machine-readable copy, and the validator
  fails when the two lists of names drift apart.
- **Validation in CI.** Every pull request runs `tools/validate.py`. A record
  that does not validate is not data yet.

## Capture

### Sources: `capture/sources/<name>.md`

A source is anything that might be worth reading for the record: a web page,
a Telegram channel or post, an Instagram account or post, a YouTube channel
or video, a book, a paper. It is registered as soon as it is found, before
anyone reads it, so the directory is also the research backlog.

The file name is the source's handle in the record. Use lowercase letters,
digits, `.`, `_` and `-`, and derive it from the URL when there is one:
`t.me-badnama_example.md`, `t.me-badnama_example-42.md`,
`example.com-magazine-badnama-interview.md`. Renaming a file means updating
every reference to it, and the validator will say which.

```markdown
---
url: https://t.me/badnama_example
title: بادنما
kind: telegram channel
language: fa
tier: own
about: [Badnama, بادنما]
status: processed
---

Band's own channel. Credits are in the pinned post; posts before 2015 are
missing.

> کانال رسمی گروه بادنما

Channel description, read 2026-10-11.
```

The front matter is YAML between two `---` lines. These keys are understood;
any other key is allowed and ignored.

| Key | Required | Value |
| --- | --- | --- |
| `title` | yes | the source's own title, or a short label when it has none |
| `status` | yes | `found`, `processed` or `excluded` |
| `url` | no | the canonical `http(s)` URL; absent only for offline sources |
| `kind` | no | the medium; see the suggested list below |
| `language` | no | BCP 47 tag of the content: `fa`, `en`, `mul` for mixed |
| `tier` | no | reliability class; see the suggested list below |
| `author` | no | person or persons credited |
| `publisher` | no | site, outlet, channel or label that carries it |
| `issued` | no | publication date, a [date value](#dates) |
| `part of` | no | the capture file of the source that contains this one |
| `about` | no | who or what it is about, in plain words or item IDs |
| `archive` | no | URL of an archived copy, such as the Wayback Machine |
| `reason` | if excluded | why it is not to be cited |

**Status** is the lifecycle:

- `found`: registered, nobody has gone through it yet.
- `processed`: someone has read it and copied whatever matters, which may
  be nothing. Only a processed source can be cited.
- `excluded`: not to be cited, with a `reason`, so nobody evaluates it twice.
  The validator rejects references to it.

**Kinds**, suggested: `web page`, `telegram channel`, `telegram post`,
`instagram account`, `instagram post`, `youtube channel`, `youtube video`,
`podcast episode`, `print article`, `book`, `paper`. A channel, account or
site is one source; each post, video or page quoted from it is its own file
with `part of` pointing at the container, because a reference cites the
specific post or page.

**Tiers**, suggested, after the preference order in
[Data Policies](../specs/data-policies.md#sources): `own` (the artist's or
label's own pages, accounts and channels), `discography` (Discogs,
MusicBrainz), `journalism`, `academic`, `wikipedia`, `other`.

The body is free Markdown, with one convention that matters: **a passage
copied from the source goes in a blockquote**, word for word, in the source's
language, one passage per blockquote, followed by a line saying where it was
(a post number, a timestamp, a page) and when it was read. Only lines that
start with `>` count as quoted, and never lines inside a fenced code block;
everything else is the researcher talking: observations, candidate claims,
open questions, what still needs a second source. When the evidence is an
image or audio, write down what is said or shown as exactly as possible, in a
blockquote, and say so on the line after.

### Notes: `capture/notes/`

Anything that is not a source: a worklist for an act, a list of suspected
duplicates, a question for the owner. Free Markdown, never cited, never
checked.

Keep related research together. Reuse an existing subject note, with sections
for its releases, relationships and open questions; split it when that helps
reading. Another spelling or incoming record does not need another file.
Match subjects through explicit identities and evidence, and keep uncertain
matches visible. Check the other captured findings before calling evidence
missing. Findings tied to one source belong beside that source's passages.

## Published

### Items: `published/items/<type>/<ID>.yaml`

An item is anything with its own identity: a person, act, release,
organization, event or place. One file per item, in the directory of its
type, named by its ID: `published/items/act/Q7k3m9x.yaml`.

```yaml
id: Q7k3m9x
type: act
statements:
  name:
    - value:
        text: بادنما
        language: fa
      rank: preferred
      references:
        - source: t.me-badnama_example
          quote: |-
            کانال رسمی گروه بادنما
          accessed: 2026-10-11
  formation date:
    - value:
        date: "1383"
        calendar: jalali
      references:
        - source: example.com-magazine-badnama-interview
          quote: |-
            گروه بادنما سال ۱۳۸۳ در تهران شکل گرفت.
          accessed: 2026-10-12
    - value:
        date: "2005"
      rank: deprecated
      references:
        - source: example.org-music-tehran-rock-roundup
          quote: |-
            Badnama formed in 2005
          accessed: 2026-10-12
  based in:
    - value: Q3nv8ks
      references:
        - source: example.com-magazine-badnama-interview
          quote: |-
            گروه بادنما سال ۱۳۸۳ در تهران شکل گرفت.
          accessed: 2026-10-12
```

| Field | Required | Value |
| --- | --- | --- |
| `id` | yes | item ID, equal to the file name |
| `type` | yes | `person`, `act`, `release`, `organization`, `event` or `place`, equal to the directory |
| `statements` | unless merged | map from property to a list of statements |
| `merged into` | no | the item this one was folded into; see [Merging](#merging-items) |

`type` is the one property from the framework's table that is not written as
a statement: it is structural, is never sourced, and decides where the file
lives. There is no field for notes; what a researcher wants to say goes in
capture.

### IDs

An item ID is `Q` followed by six characters from this alphabet, which omits
the confusable `0 1 i l o u`:

```text
2 3 4 5 6 7 8 9 a b c d e f g h j k m n p q r s t v w x y z
```

`tools/newid.py` prints a fresh, unused one. An ID is never reused, even after
its item is deleted or merged.

### Statements

A statement is one claim: the item (the file it is in), a property (the key
it is listed under) and a value, with references and a rank. Statements of
the same property are listed together, one entry each, so that disagreeing
sources become sibling entries rather than one edited line.

| Field | Required | Value |
| --- | --- | --- |
| `value` | yes | a [value](#values) of the kind the property expects |
| `qualifiers` | no | map from qualifier to a value, or to a list of values |
| `references` | yes | at least one [reference](#references) |
| `rank` | no | `preferred`, `normal` (default) or `deprecated` |

Only the properties in `schema/properties.yaml` may be used, each only on the
item types and with the qualifiers the registry allows. To record a new kind
of fact, add the property to the spec first, then to the registry.

### Values

The property decides which kind of value a statement takes.

| Kind | Written as | Example |
| --- | --- | --- |
| item | the item's ID | `Q3nv8ks` |
| text | map: `text`, `language` | `{text: Badnama, language: en}` |
| date | map: `date`, optional `calendar` | `{date: "1383-02", calendar: jalali}` |
| url | the URL | `https://www.youtube.com/watch?v=…` |
| term | a short lowercase English word from the registry's term list | `guitar` |

Two special values exist for any kind, spelled exactly like this:
`unknown value` (sources say there is one, but not what it is) and
`no value` (sources say there is none). A missing statement says nothing.

Text values carry the language of the spelling: `fa` for Persian script, `en`
for a Latin spelling as it appears in English-language sources, otherwise the
source's language. Attested names and explicitly marked editorial display
spellings follow the [name policy](../specs/data-policies.md#names-and-language).

### Dates

A date is written as its source gives it, in the source's calendar, at the
source's precision, using the
[EDTF](https://www.loc.gov/standards/datetime/) subset below.

| Form | Meaning |
| --- | --- |
| `2004`, `2004-11`, `2004-11-17` | year, month, day precision |
| `2004~`, `2004-11~` | approximate (circa); any precision |
| `2004?` | uncertain; `2004%` approximate and uncertain |
| `200X` | the decade |
| `2004/2006` | an interval between two dates of any form above |

`calendar` is `gregorian` (the default) or `jalali` (Solar Hijri). A Jalali
date is stored as given; the site derives the Gregorian range. A bare year
below 1500 without a calendar is almost always a Jalali year, and the
validator says so.

Quote the `date` string: `date: "2004"`, not `date: 2004`, which YAML reads
as a number. A full day such as `accessed: 2026-10-11` is safe bare.

### References

Each reference is one captured source, the verbatim quote that supports the
claim, and the date the source was opened.

| Field | Required | Value |
| --- | --- | --- |
| `source` | yes | the capture file's name without `.md`; it must exist and be `processed` |
| `quote` | yes | verbatim text that appears inside a blockquote of that file; use a `\|-` block scalar |
| `accessed` | yes | the day the source was opened, `YYYY-MM-DD` |
| `locator` | no | where in the source: a page, a timestamp, a post number |

The validator matches the quote against the capture file's blockquotes with
whitespace collapsed, so line breaks do not matter but every word does. A
reference cannot cite words that were never captured.

### Images

`image`, `cover art`, `poster` and `logo` take the address of the image file
on the page that published it, such as an album's artwork on its Apple Music
page. The registry lists the hosts allowed; Telegram's and Instagram's file
addresses expire, so they are not among them. The reference cites that page
and quotes what identifies it there, such as its title, and the reviewer
opens the page to compare the image. `credit` is who made the image, spelled
as the source credits them, and `license` is the address of its free
license, when it has one.

```yaml
  cover art:
    - value: https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/ef/artwork.jpg/1200x1200bb.jpg
      references:
        - source: music.apple.com-us-album-nameless-street-123
          quote: |-
            Nameless Street by Badnama on Apple Music
          accessed: 2026-10-18
```

### Credits

`performer` is who a release is billed to and who plays or sings on it.
Writing, arranging and production go under `contributor`, which always
carries a `role`, so a writing credit never reads as a performance. A
person who wrote and sang a song has one statement of each.

```yaml
  performer:
    - value: Q5fd2cn
      qualifiers:
        role: guitar
      references: …
  contributor:
    - value: Q5fd2cn
      qualifiers:
        role: [composer, lyricist]
      references:
        - source: badnama-example.bandcamp.com-album-nameless-street
          quote: |-
            Words and music by Nima Rad
          accessed: 2026-10-12
```

### Life events

A `life event` keeps one moment of a person's or act's story in the source's
own words and language: its text is an excerpt of a captured passage, and the
validator checks that the words sit in a blockquote of every source its
references cite. A passage that tells several moments becomes several life
events. `point in time`, `place`, `with` and `about` tie the moment to the
rest of the record; one with a `point in time` appears on the timeline.

```yaml
  life event:
    - value:
        text: |-
          اولین اجرای ما سال ۱۳۸۴ در زیرزمین خانهٔ یکی از دوستان در تهران بود،
          چون جای دیگری به ما اجازه نمی‌دادند.
        language: fa
      qualifiers:
        point in time:
          date: "1384"
          calendar: jalali
        place: Q3nv8ks
      references:
        - source: example.com-magazine-badnama-interview
          quote: |-
            اولین اجرای ما سال ۱۳۸۴ در زیرزمین خانهٔ یکی از دوستان در تهران بود،
            چون جای دیگری به ما اجازه نمی‌دادند.
          accessed: 2026-10-12
```

The article tells the story; it chooses among the life events and translates
them, as [Artist writing](../specs/artist-writing.md) describes.

### Merging items

When two items turn out to be the same, keep the one with more history, move
every statement and every incoming reference to it, and reduce the other to a
pointer:

```yaml
id: Q9pw4tm
type: act
merged into: Q7k3m9x
```

A merged item has no statements and nothing may point at it. Its ID lives on
so the site can redirect old links.

### Articles: `published/articles/<ID>.<lang>.md`

An article tells an artist's life and work in prose, for their page, as
[Artist writing](../specs/artist-writing.md) describes: one file per language,
named after the item's ID and a language tag, such as
`published/articles/Q7k3m9x.fa.md`. It is written only from captured
passages and cites them as a statement does: the front matter lists its
references under short keys, and the text cites one with `[^key]` after the
words it supports.

```markdown
---
references:
  formed:
    source: example.com-magazine-badnama-interview
    quote: |-
      گروه بادنما سال ۱۳۸۳ در تهران شکل گرفت.
    accessed: 2026-10-12
---

Badnama formed in Tehran in 1383 of the Solar Hijri calendar.[^formed]

## Nameless Street

…
```

A reference has the fields and checks of a statement's
[references](#references); a key is lowercase letters and digits joined by
hyphens. Every key is cited and every citation has a key. The text before
the first heading is the lead; each `##` heading starts a section. A person or
act with a curated article has an artist page. Related people and acts without
articles remain part of the record and appear through their relationships.

### YAML conventions

- Two-space indentation, no tabs, one record per file, file ends with a
  newline.
- Keys in the order the tables above list them; statements in the registry's
  property order. Diffs stay readable.
- Quote anything YAML would otherwise reinterpret: years and partial dates,
  and the words `yes`, `no`, `on`, `off`, `null`.
- Multi-line text, and any quote containing `:` or `#`, goes in a `|-` block
  scalar.
- Comments are allowed and ignored by tools; they are not data.

### What the site derives

The record stores what sources say and nothing else. When the website is
built it derives, from `published/` and the capture front matter:

- the name to display per language: the preferred name in that language,
  otherwise the first listed;
- every relation seen from both ends, so a person's `member of` also appears
  as the act's members;
- a Gregorian range for every date, covering its precision, for sorting;
- resolved citations: the source's title, URL, publisher and issue date
  beside each quote;
- the timeline: every dated release, formation, membership change and life
  event, earliest first;
- listings per type, and redirects for merged IDs.

## Tools

Python 3 scripts under `tools/`, needing only `pyyaml` and `jsonschema`.

| Command | Does |
| --- | --- |
| `tools/newid.py` | print a fresh item ID |
| `tools/validate.py` | check `data/` against the schemas, the registry and the cross-file rules; exit 1 on any error |

Each accepts `--root <dir>` to work on another root with the same layout,
which is how `data/examples` is validated.

The validator checks, beyond the JSON Schemas: capture front matter and item
files parse, with no key given twice; `part of` points at a capture file; no
two capture files share a URL; item file names and directories match IDs and
types; IDs are unique; every property, qualifier and term is in the registry
and used where the registry allows; every `contributor` has a role, and a life
event's words sit in its sources' blockquotes; item references exist and have
an allowed type; dates parse and Jalali dates are real dates; language tags
are well-formed; references cite existing, processed capture files and quote
words found in their blockquotes; listen links and images use an allowed host;
merged items are empty and unreferenced; articles are named after a person or
act and a language, and their citations and references match; and the
registry's names match the spec's tables.

## Workflow

Changes to the record follow the
[publication workflow](../specs/publication-workflow.md): one artist's entry
per pull request by default, reviewed by someone other than its author, and
merged only on the owner's word. Capture can be committed before curation.

## Examples

Accepted examples, including their linked records:

- Golsa: [Persian](published/articles/Qh745pn.fa.md) and
  [English](published/articles/Qh745pn.en.md). Theatre, songwriting, a multi-track
  collection and recurring collaborations connect the narrative.
- Sanam Maroufkhani: [Persian](published/articles/Qa84h2k.fa.md) and
  [English](published/articles/Qa84h2k.en.md). Interviews, performance videos,
  programmes and reporting deepen a thinner initial catalogue-based profile.

They show how deep research reaches the record and the page, not fixed
headings, word counts or recording quotas. For how an article reads, follow
[Artist writing](../specs/artist-writing.md) and its example.

`examples/` holds a fictional band, a member, a release, a label, a place, a
handful of sources of every kind and status, and the record and articles
curated from them. Every name, URL and quote in it is invented to show the
format; none of it is data, and the website never reads it.
