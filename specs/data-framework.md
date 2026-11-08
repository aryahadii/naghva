# Data framework

Naghva keeps two layers and builds the website from the reviewed one:

1. **Capture.** Passages copied word for word from sources, with notes on
   what they show and what is still unresolved. The public repository
   keeps only the passages the record cites.
2. **Published.** Reviewed items and statements modelled on
   [Wikibase](https://www.mediawiki.org/wiki/Wikibase/DataModel/Primer),
   with sourced articles in Persian and English. Only reviewed claims reach
   the site.

The [data guide](../data/README.md) owns the format on disk. Nothing moves
from capture to the record without review.

## Published record

- **Item:** anything with its own identity: a person, act, release,
  organization, event or place. Its type is fixed, and its stable ID
  outlives every name it has.
- **Property:** an attribute or relationship with one meaning and one kind
  of value, such as `member of` or `release date`. Only the properties
  below are used.
- **Statement:** one claim about an item: a property and a value, which is
  another item or a literal such as a name, date or URL.
- **Qualifier:** a property that narrows a statement, such as a role, a
  start time or the name a source credits. Only the qualifiers below are
  used; none is a free-text note.
- **Reference:** the source behind a statement, with its verbatim quote and
  the date it was read.
- **Rank:** preferred, normal or deprecated, so that when sources disagree
  the alternatives are ranked, not deleted.

### Example

    Item:       Person P
    Property:   member of
    Value:      Act A
    Qualifiers: role = guitar; start time = 2004
    Reference:  source file; quote; read 2026-10-11
    Rank:       normal

### Properties

To record a new kind of fact, add its property here first.

| Property | Used on | Value |
| --- | --- | --- |
| `name` | any item | text, with its language |
| `legal name` | person | text, with its language |
| `birth date` | person | date |
| `birthplace` | person | place |
| `member of` | person | act |
| `formation date` | act | date |
| `based in` | act | place |
| `life event` | person, act | text, with its language |
| `release date` | release | date |
| `performer` | release, event | act or person |
| `contributor` | release | act or person |
| `published by` | release | organization |
| `listen link` | release | URL |
| `profile link` | person, act | official artist profile or channel URL |
| `event date` | event | date |
| `image` | person, act, event, place | URL |
| `cover art` | release | URL |
| `poster` | event | URL |
| `logo` | act, organization | URL |

| Qualifier | Used on | Value |
| --- | --- | --- |
| `role` | `member of`, `performer`, `contributor` | role term |
| `start time` | `member of` | date |
| `end time` | `member of` | date |
| `point in time` | `life event` | date |
| `place` | `life event` | place |
| `with` | `life event` | act, person or organization |
| `about` | `life event` | release |
| `credited as` | `member of`, `performer`, `contributor` | text, with its language |
| `credit` | `image`, `cover art`, `poster`, `logo` | text, with its language |
| `license` | `image`, `cover art`, `poster`, `logo` | URL |

A role term is a short lowercase English word, such as `guitar` or
`lyricist`. Reuse an existing term before adding a new one.

### Life events

A `life event` keeps one moment of an artist's story that no other property
holds: what happened and, when a source says so, why. Its value is an
excerpt of a captured passage: the words that tell that one moment, in the
source's own words and language. A passage that tells several moments
becomes several life events. Refining and translating them is the
article's work. Its qualifiers tie it to the rest of the record, so it
can appear on the timeline and on the pages of the people involved.

```text
Item:       Act Pallett
Property:   life event
Value:      یک روز از موسسه «محک» زنگ زدند گفتند که ما پنج‌شنبه اجرا داریم،
            به «دنگ شو» زنگ زده‌ایم، نیستند (fa)
Qualifiers: point in time = 2009; place = Tehran; with = Dang Show
Reference:  source file; quote; read 2026-11-06
```

A fact that has its own property, such as a membership or a release, is
stated there, not as a life event. The article chooses which life events
to tell; it never walks through them one by one.

### Rules

- One claim per statement, each with its own references. When sources
  disagree, each version is its own statement.
- "Unknown value" and "no value" are stated explicitly; a missing
  statement says nothing.
- `performer` is who is billed and who plays or sings. Writing, arranging
  and production go under `contributor`, so a writing credit never reads as
  a performance.
- A Solar Hijri date is stored as given; the site derives its Gregorian
  range.
- An editorial display spelling's reference supports the original name,
  not the spelling.
- Review is the fact-check; no checked flag is stored.

## Website

The site is built only from the published record. It resolves names,
relations, dates, citations and stable addresses, and adds no claims of its
own. Fix the record, never the generated site. The
[site guide](../site/README.md) owns building and deploying.
