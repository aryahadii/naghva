#!/usr/bin/env python3
"""Turn a data root into the one JSON file the website is built from.

    python3 tools/derive.py [--root data] [--out site/generated/record.json]

Validates the root first and stops on any error. Computes what
data/README.md ("What the site derives") leaves to the site: display names,
every relation from both ends, Gregorian ranges, resolved citations, the
articles split into sections, the timeline, page addresses and redirects.
The site reads only this file, never data/ itself.

Addresses are permanent. Every page and panel address the site has issued
is kept in site/addresses.json; derive adds new ones to it, and the record
keeps each old one leading to its item. Commit the file when it changes.
"""

import argparse
from contextlib import ExitStack, contextmanager
import fcntl
import hashlib
import json
import os
import re
import sys
import tempfile
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import datastore as ds  # noqa: E402
import validate  # noqa: E402
import stats  # noqa: E402

DEFAULT_OUT = ds.REPO / "site" / "generated" / "record.json"
DEFAULT_ADDRESSES = ds.REPO / "site" / "addresses.json"
LEGACY_TIMELINE = Path(__file__).with_name("legacy-timeline-anchors.json")
RETIRED_TIMELINE = Path(__file__).with_name("retired-timeline-fragments.json")
LANGUAGES = ("en", "fa")
ARTIST_TYPES = ("person", "act")
TAG_LENGTH = 3  # characters of the ID after the Q that end an address
SOURCE_KEYS = ("title", "url", "publisher", "author", "issued", "archive", "language", "kind")
ARABIC_SCRIPT = re.compile("[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")
CITATIONS = re.compile(r"\[\^([^\]\s]+)\]")


# --- Statements -----------------------------------------------------------------


def best(statements):
    """The statements a page shows first: the preferred ones, else every normal one."""
    preferred = [s for s in statements if s.get("rank") == "preferred"]
    return preferred or [s for s in statements if s.get("rank", "normal") == "normal"]


def name_values(data):
    return [
        dict(s["value"], rank=s.get("rank", "normal"))
        for s in data.get("statements", {}).get("name", [])
        if isinstance(s.get("value"), dict)
    ]


def display_name(data, language):
    """The preferred name in `language`, else its first; else the same in the other language.

    English without its own name reads a Latin-script one (a Dutch title, say) before Persian.
    """
    names = [n for n in name_values(data) if n["rank"] != "deprecated"]
    if language == "en" and not any(n["language"] == "en" for n in names):
        latin = [n for n in names if is_latin(n["text"])]
        if latin:
            chosen = next((n for n in latin if n["rank"] == "preferred"), latin[0])
            return {"text": chosen["text"], "language": chosen["language"]}
    for lang in (language,) + tuple(l for l in LANGUAGES if l != language):
        here = [n for n in names if n["language"] == lang]
        if here:
            chosen = next((n for n in here if n["rank"] == "preferred"), here[0])
            return {"text": chosen["text"], "language": chosen["language"]}
    if names:
        return {"text": names[0]["text"], "language": names[0]["language"]}
    return None


# --- Addresses -------------------------------------------------------------------


def is_latin(text):
    return not ARABIC_SCRIPT.search(text) and bool(latin_slug(text))


def latin_slug(text):
    """`Bâlzan` to `balzan`: accents dropped, lowercase letters and digits, hyphens between."""
    plain = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    plain = re.sub(r"['\u2019]", "", plain.lower())
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-")


def script_slug(text):
    """A Persian name for an address: its letters and digits as written, hyphens between."""
    letters = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"[\W_]+", "-", letters.lower()).strip("-")


def address_bases(data):
    """Every name that can start the item's address, the one in use first.

    The address uses the name in Latin script as a source spells it; with
    none, the Persian name, since names are never transliterated.
    """
    names = [n for n in name_values(data) if n["rank"] != "deprecated"]
    english = display_name(data, "en")
    latin = [n["text"] for n in names if is_latin(n["text"])]
    if english and is_latin(english["text"]):
        latin.remove(english["text"])
        latin.insert(0, english["text"])
    bases = [latin_slug(t) for t in latin]
    if not bases:
        persian = display_name(data, "fa")
        bases = [script_slug(persian["text"])] if persian else []
    return list(dict.fromkeys(b for b in bases if b))


def address(item_id, base):
    tag = item_id[1:1 + TAG_LENGTH]
    return "%s-%s" % (base, tag) if base else tag


# --- Values ----------------------------------------------------------------------


def with_range(value):
    """A date value with its Gregorian [first day, last day] added; other values as they are."""
    if isinstance(value, dict) and "date" in value:
        start, end = ds.date_range(value["date"], value.get("calendar", ds.DEFAULT_CALENDAR))
        out = dict(value, range=[start.isoformat(), end.isoformat()])
        if "/" in value["date"]:
            out["endpoints"] = [with_range(dict(value, date=part)) for part in value["date"].split("/")]
        return out
    return value


def derive_statement(statement):
    out = {
        "value": with_range(statement["value"]),
        "rank": statement.get("rank", "normal"),
        "references": [dict(r) for r in statement["references"]],
    }
    if statement.get("editorial"):
        out["editorial"] = True
    if "qualifiers" in statement:
        out["qualifiers"] = {
            k: [with_range(v) for v in ds.as_list(vs)] for k, vs in statement["qualifiers"].items()
        }
    return out


def derive_source(meta):
    """What a citation shows of its source: title, link, publisher, date and so on."""
    out = {}
    for key in SOURCE_KEYS:
        if key in meta:
            value = meta[key]
            out[key] = with_range(value) if isinstance(value, dict) else str(value)
    return out


# --- Articles --------------------------------------------------------------------


def split_article(body):
    """(lead, [(heading, text)]): the text before the first `##` heading, then each section."""
    lead, sections, current = [], [], None
    for line in body.split("\n"):
        if line.startswith("## "):
            current = (line[3:].strip(), [])
            sections.append(current)
        elif current is None:
            lead.append(line)
        else:
            current[1].append(line)
    return "\n".join(lead).strip(), [(h, "\n".join(t).strip()) for h, t in sections]


def derive_article(article):
    """The lead, the `##` sections, and the cited references in the order a reader meets them."""
    refs = article.meta.get("references", {})
    order = list(dict.fromkeys(CITATIONS.findall(article.body)))
    lead, sections = split_article(article.body)
    anchors = {}
    out_sections = []
    for heading, text in sections:
        anchor = latin_slug(heading) if is_latin(heading) else script_slug(heading)
        anchors[anchor] = anchors.get(anchor, 0) + 1
        if anchors[anchor] > 1:
            anchor = "%s-%d" % (anchor, anchors[anchor])
        out_sections.append({"heading": heading, "anchor": anchor, "markdown": text})
    return {
        "lead": lead,
        "sections": out_sections,
        "notes": [dict(refs[key], key=key) for key in order],
    }


# --- The record --------------------------------------------------------------------


def no_addresses():
    return {"pages": {}, "panels": {}}


def issue(issued, kind, addr, item_id, merged):
    """Record that `addr` leads to `item_id`; an address once issued never passes to another item."""
    owner = issued[kind].get(addr)
    if owner is not None and merged.get(owner, owner) != item_id:
        raise ds.DataError("the address %s was issued to %s, so %s cannot have it" % (addr, owner, item_id))
    issued[kind][addr] = item_id


TRACK_NUMBER = re.compile(r"\btrack\s+(\d{1,3})(?=\s+(?:in|on|of)\b|$)", re.IGNORECASE)


def component_positions(item, sources):
    """Where a track or segment sits in each whole: the number its reference's
    locator gives ("Spotify album track 7"), and the order of its quote among
    the quotes captured from that source, which follow the page's order."""
    positions = {}
    for prop in ds.COMPONENT_PROPERTIES:
        for s in best(item["statements"].get(prop, [])):
            for ref in s["references"]:
                position = {"source": ref["source"]}
                number = TRACK_NUMBER.search(ref.get("locator", ""))
                if number:
                    position["number"] = int(number.group(1))
                source = sources.get(ref["source"])
                quote = ds.normalize(ref.get("quote", ""))
                if source and quote and quote in source.quotes:
                    # The last occurrence: a title track's first is the page heading.
                    position["at"] = len(source.quotes) - 1 - source.quotes[::-1].index(quote)
                positions.setdefault(s["value"], position)
                break
    return positions


def derive(root, issued=None):
    """The site's record for a data root. Raises ds.DataError when the root does not validate.

    `issued` holds every address issued so far ({"pages": {address: item},
    "panels": {anchor: item}}); this record's addresses are added to it.
    """
    issued = no_addresses() if issued is None else issued
    root = Path(root).resolve()
    report = validate.Report()
    store = validate.validate(root, report)
    if report.errors:
        raise ds.DataError("data does not validate:\n" + "\n".join(report.errors))
    registry = ds.load_registry()

    live = {i: item.data for i, item in store.items.items() if "statements" in item.data}
    merged = {i: item.data["merged into"] for i, item in store.items.items() if "merged into" in item.data}

    items = {}
    for item_id, data in live.items():
        items[item_id] = {
            "id": item_id,
            "type": data["type"],
            "names": {lang: display_name(data, lang) for lang in LANGUAGES},
            "statements": {
                prop: [derive_statement(s) for s in statements]
                for prop, statements in data["statements"].items()
            },
            "incoming": [],
        }

    # Every relation from both ends: a person's `member of` also lists the person on the act.
    for item_id, item in items.items():
        for prop, statements in item["statements"].items():
            if registry["properties"][prop]["value"] != "item":
                continue
            for s in statements:
                target = s["value"]
                if target in items:
                    incoming = {"property": prop, "item": item_id, "rank": s["rank"]}
                    if "qualifiers" in s:
                        incoming["qualifiers"] = s["qualifiers"]
                    items[target]["incoming"].append(incoming)

    # A curated article gives an artist a page. Related credit-only people
    # and acts remain records without an empty standalone page.
    artists = sorted({
        article.item for article in store.articles.values()
        if article.item in items and items[article.item]["type"] in ARTIST_TYPES
    })

    pages, olds = {}, {}
    for item_id in artists:
        bases = address_bases(live[item_id]) or [""]
        page = address(item_id, bases[0])
        if page in pages:
            raise ds.DataError("%s and %s would share the address %s" % (pages[page], item_id, page))
        issue(issued, "pages", page, item_id, merged)
        pages[page] = item_id
        items[item_id]["page"] = page
        # Its ID, its other Latin names, and the IDs merged into it lead to the page too.
        aliases = [item_id] + [address(item_id, b) for b in bases[1:]]
        aliases += [m for m, into in merged.items() if into == item_id]
        for old in aliases:
            issue(issued, "pages", old, item_id, merged)
            olds[old] = item_id
    # So does every address it was ever given, whatever its names say now.
    for old, item_id in issued["pages"].items():
        item_id = merged.get(item_id, item_id)
        if not items.get(item_id, {}).get("page"):
            raise ds.DataError("issued artist address %s (%s) has no surviving page" % (old, item_id))
        olds[old] = item_id
    redirects = [
        {"from": "/%s/%s/" % (lang, old), "to": "/%s/%s/" % (lang, items[item_id]["page"])}
        for lang in LANGUAGES
        for old, item_id in olds.items()
        if old not in pages
    ]

    # A release's panel has an address within its artist's page. Old panel
    # addresses can't be redirected by the server, so the record lists them
    # all for the page to look up.
    for item_id, item in items.items():
        if item["type"] == "release":
            item["anchor"] = address(item_id, (address_bases(live[item_id]) or [""])[0])
            issue(issued, "panels", item["anchor"], item_id, merged)
    panels = {}
    # A release also answers at its ID, and at the IDs merged into it.
    for anchor, item_id in list(issued["panels"].items()) + [(i, i) for i in items] + list(merged.items()):
        item_id = merged.get(item_id, item_id)
        if items.get(item_id, {}).get("anchor"):
            panels[anchor] = item_id

    # Public destinations, unlike reserved names, must continue to resolve.
    # Keep routing history separate from contribution evidence.
    panel_hosts = {}
    for release_id, artist_id in issued.get("panelHosts", {}).items():
        release_id = merged.get(release_id, release_id)
        artist_id = merged.get(artist_id, artist_id)
        if items.get(artist_id, {}).get("page"):
            panel_hosts[release_id] = artist_id

    def current_host(release):
        credited = [items[s["value"]] for s in best(release["statements"].get("performer", []))
                    if s["value"] in items]
        direct = next((p["id"] for p in credited if p.get("page")), None)
        if direct:
            return direct
        return next((i["item"] for act in credited if act["type"] == "act"
                     for i in act["incoming"] if i["property"] == "member of"
                     and i["rank"] != "deprecated" and items[i["item"]].get("page")), None)

    public = issued.setdefault("publicPanels", {})
    for release in items.values():
        if release["type"] != "release":
            continue
        host = current_host(release) or panel_hosts.get(release["id"])
        if host:
            panel_hosts[release["id"]] = host
            for anchor, owner in panels.items():
                if owner == release["id"]:
                    public[anchor] = owner
    for anchor, owner in public.items():
        owner = merged.get(owner, owner)
        if items.get(owner, {}).get("type") != "release" or owner not in panel_hosts:
            raise ds.DataError("issued release address #%s (%s) has no surviving destination" % (anchor, owner))
    issued["panelHosts"] = panel_hosts

    # Which page shows each release, decided here once: `host` is the credited
    # artist whose page shows it now, and an artist's `releases` are those it
    # performs on plus those its page hosts. (A release without a credited
    # host is shown where it was before, by panelHosts.)
    for release in items.values():
        if release["type"] == "release":
            host = current_host(release)
            if host:
                release["host"] = host
    for artist_id in artists:
        artist = items[artist_id]
        ids = {i["item"] for i in artist["incoming"]
               if i["property"] == "performer" and items[i["item"]]["type"] == "release"
               and any(s["value"] == artist_id for s in best(items[i["item"]]["statements"].get("performer", [])))}
        ids |= {r["id"] for r in items.values() if r.get("host") == artist_id}
        artist["releases"] = sorted(ids)

    for item in items.values():
        positions = component_positions(item, store.sources)
        if positions:
            item["positions"] = positions

    sources = {}
    for item in items.values():
        for statements in item["statements"].values():
            for s in statements:
                for ref in s["references"]:
                    sources[ref["source"]] = None
    articles = {}
    for article in store.articles.values():
        if article.item in items:
            derived = derive_article(article)
            articles.setdefault(article.item, {})[article.language] = derived
            for note in derived["notes"]:
                sources[note["source"]] = None
    sources = {name: derive_source(store.sources[name].meta) for name in sorted(sources)}

    dated_entries = timeline(items)
    retired = retired_timeline_fragments(items, dated_entries, strict=root.resolve() == ds.DEFAULT_ROOT.resolve())
    return {
        "examples": root.name == "examples",
        "languages": list(LANGUAGES),
        "artists": artists,
        "items": items,
        "articles": articles,
        "sources": sources,
        "timeline": dated_entries,
        "timelineBookmarks": retired,
        "redirects": redirects,
        "panels": panels,
        "panelHosts": panel_hosts,
        "roles": ds.role_kinds(registry),
        "platforms": registry["platforms"],
        "stats": stats.stats(items, artists, sources,
                             {name: store.sources[name].meta.get("tier") for name in sources},
                             articles),
    }


def timeline(items, legacy_anchors=None):
    """Every dated fact, earliest first: releases, formations, members joining and
    leaving, and life events dated by their point in time."""
    entries = []
    identities = set()
    if legacy_anchors is None:
        legacy_anchors = json.loads(LEGACY_TIMELINE.read_text(encoding="utf-8"))

    def add(kind, item_id, about, value, alternatives=None, text=None):
        if isinstance(value, dict) and "range" in value:
            def key(category):
                return json.dumps([category, item_id, sorted(set(about)),
                                   value.get("calendar", "gregorian"), value["date"]]
                                  + ([text["text"]] if text else []),
                                  ensure_ascii=False, separators=(",", ":"))
            def anchor_of(identity):
                return "entry-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]

            identity = key(kind)
            anchor = anchor_of(identity)
            # Only explicit migration entries keep a former fragment.
            date_key = value.get("calendar", "gregorian") + ":" + value["date"]
            legacy = legacy_anchors.get(kind, {}).get(item_id, {}).get(date_key)
            if legacy and legacy not in identities:
                anchor = legacy
            if anchor in identities:
                raise ds.DataError("duplicate timeline identity: %s" % identity)
            identities.add(anchor)
            entry = {"anchor": anchor, "kind": kind, "item": item_id, "about": list(dict.fromkeys(about)), "date": value}
            if alternatives:
                entry["alternatives"] = alternatives
            if text:
                entry["text"] = {"text": " ".join(text["text"].split()), "language": text["language"]}
            entries.append(entry)

    def dates(statements):
        ranked = sorted(statements, key=lambda s: s["rank"] != "preferred")
        values = [s["value"] for s in ranked if s["rank"] != "deprecated"
                  and isinstance(s["value"], dict) and "range" in s["value"]]
        unique = { (v.get("calendar", "gregorian"), v["date"]): v for v in values }
        return list(unique.values())

    for item_id, item in items.items():
        st = item["statements"]
        if item["type"] == "release":
            performers = [s["value"] for s in best(st.get("performer", [])) if s["value"] in items]
            values = dates(st.get("release date", []))
            if values:
                is_component = any(s["value"] in items for prop in ds.COMPONENT_PROPERTIES
                                   for s in best(st.get(prop, [])))
                add("component" if is_component else "release", item_id, performers, values[0], values[1:])
            for posting in dates(st.get("platform posting date", [])):
                add("posting", item_id, performers, posting)
        if item["type"] == "act":
            values = dates(st.get("formation date", []))
            if values:
                add("formation", item_id, [], values[0], values[1:])
        if item["type"] == "event":
            performers = [s["value"] for s in best(st.get("performer", [])) if s["value"] in items]
            values = dates(st.get("event date", []))
            if values:
                add("event", item_id, performers, values[0], values[1:])
        for s in best(st.get("member of", [])):
            if s["value"] not in items:
                continue
            qualifiers = s.get("qualifiers", {})
            for key, kind in (("start time", "joined"), ("end time", "left")):
                for value in qualifiers.get(key, [])[:1]:
                    add(kind, item_id, [s["value"]], value)
        for s in best(st.get("life event", [])):
            if s["value"] in ds.SPECIAL_VALUES:
                continue
            qualifiers = s.get("qualifiers", {})
            people = [v for v in qualifiers.get("with", []) if v in items]
            for value in qualifiers.get("point in time", [])[:1]:
                add("life", item_id, people, value, text=s["value"])
    # An interim deployment may have issued another fragment for the same fact.
    # Keep it as an address alias, without adding a second dated entry.
    registered_aliases = legacy_anchors.get("aliases", {})
    if not isinstance(registered_aliases, dict):
        raise ds.DataError("timeline aliases must be a map")
    dated_by_anchor = {entry["anchor"]: entry for entry in entries}
    for alias, destination in registered_aliases.items():
        if (not isinstance(alias, str) or not re.fullmatch(r"entry-[0-9a-f]{20}", alias)
                or not isinstance(destination, dict)
                or not isinstance(destination.get("item"), str)
                or not isinstance(destination.get("anchor"), str)):
            raise ds.DataError("invalid timeline alias")
        # The global registry also serves examples and filtered data roots.
        if destination["item"] not in items:
            continue
        entry = dated_by_anchor.get(destination["anchor"])
        if entry is None or entry["item"] != destination["item"]:
            raise ds.DataError("timeline alias has no matching dated entry: %s" % alias)
        if alias in identities:
            raise ds.DataError("duplicate timeline fragment: %s" % alias)
        identities.add(alias)
        entry.setdefault("aliases", []).append(alias)

    entries.sort(key=lambda e: (e["date"]["range"][0], e["date"]["range"][1], e["kind"], e["item"]))
    return entries


def retired_timeline_fragments(items, entries, registered=None, *, strict=True):
    """Old addresses whose dated claim was withdrawn lead to the item, not a year."""
    if registered is None:
        registered = json.loads(RETIRED_TIMELINE.read_text(encoding="utf-8"))
    if not isinstance(registered, dict):
        raise ds.DataError("retired timeline fragments must be a map")
    active = {e["anchor"] for e in entries} | {a for e in entries for a in e.get("aliases", [])}
    result = {}
    for fragment, item_id in registered.items():
        if (not isinstance(fragment, str) or not re.fullmatch(r"entry-[0-9a-f]{20}", fragment)
                or not isinstance(item_id, str) or not re.fullmatch(r"Q[2-9a-hj-km-np-tv-z]{6}", item_id)):
            raise ds.DataError("invalid retired timeline fragment")
        if fragment in active:
            raise ds.DataError("retired timeline fragment is still a dated address: %s" % fragment)
        if item_id not in items:
            if strict:
                raise ds.DataError("retired timeline fragment target is missing: %s" % item_id)
            # Examples and deliberately filtered roots do not contain this catalog.
            continue
        if items[item_id]["type"] != "release":
            raise ds.DataError("retired timeline fragment must target a release: %s" % fragment)
        result[fragment] = item_id
    return result


@contextmanager
def output_locks(paths):
    """Hold stable sibling lock files across each read/derive/write transaction.

    Never unlink a lock file: a waiting process may already have opened its inode.
    Sorting resolved paths also makes invocations sharing only one output safe.
    """
    with ExitStack() as stack:
        for path in sorted({Path(p).resolve() for p in paths if p is not None}):
            path.parent.mkdir(parents=True, exist_ok=True)
            lock = stack.enter_context(path.with_name(path.name + ".derive.lock").open("a"))
            fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def atomic_json(path, value, **options):
    """Publish complete JSON, retaining the previous file if writing fails."""
    path = Path(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix="." + path.name + ".", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, **options)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(path.stat().st_mode & 0o777 if path.exists() else 0o644)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--root", default=str(ds.DEFAULT_ROOT), help="data root (default: data)")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="where to write the record")
    parser.add_argument(
        "--addresses",
        help="the list of every address issued, kept up to date "
        "(default: site/addresses.json for the data root, none for any other root)",
    )
    args = parser.parse_args(argv)
    ledger = Path(args.addresses) if args.addresses else None
    if ledger is None and Path(args.root).resolve() == ds.DEFAULT_ROOT.resolve():
        ledger = DEFAULT_ADDRESSES
    out = Path(args.out).resolve()
    ledger = ledger.resolve() if ledger else None
    try:
        with output_locks([out, ledger]):
            issued = json.loads(ledger.read_text(encoding="utf-8")) if ledger and ledger.exists() else no_addresses()
            before = sum(len(v) for v in issued.values())
            record = derive(args.root, issued)
            # Reserve addresses first: a failed record write may leave extra
            # reservations, but can never expose an unreserved public address.
            if ledger:
                atomic_json(ledger, issued, indent=2, sort_keys=True)
            atomic_json(out, record, separators=(",", ":"))
    except (ds.DataError, OSError, ValueError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 1
    print("%s: %d artists, %d items, %d timeline entries" % (out, len(record["artists"]), len(record["items"]), len(record["timeline"])))
    if ledger:
        added = sum(len(v) for v in issued.values()) - before
        if added:
            print("%s: %d new addresses; commit it so they keep working" % (ledger, added))
    return 0


if __name__ == "__main__":
    sys.exit(main())
