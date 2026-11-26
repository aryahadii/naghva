#!/usr/bin/env python3
"""Audit release identities and evidence without changing the catalog.

Run python tools/catalog_quality.py --json for the item-level review queue.
A shared platform identifier is a review candidate, not an instruction to merge.
"""
import argparse
from collections import Counter, defaultdict
import json
import unicodedata
from urllib.parse import parse_qs, urlsplit

import datastore as ds


def platform_identity(url):
    """Return a stable platform ID without conflating album, track or timestamp."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    path = parts.path.strip("/").split("/")
    query = parse_qs(parts.query)
    if host == "music.apple.com" and len(path) >= 3 and path[-1].isdigit():
        if path[1] == "album":
            track = query.get("i", [""])[0]
            if track and not track.isdigit():
                return None
            return ("apple", "track" if track else "album", track or path[-1])
        if path[1] == "song":
            return ("apple", "track", path[-1])
    if host == "open.spotify.com":
        if path and path[0].startswith("intl-"):
            path = path[1:]
        if len(path) == 3 and path[0] == "embed":
            path = path[1:]
        if len(path) == 2 and path[0] in ("album", "track") and path[1].isalnum():
            return ("spotify", *path)
    if host == "youtu.be" or host == "youtube.com" or host.endswith(".youtube.com"):
        track = (path[0] if host == "youtu.be" and len(path) == 1 else
                 path[1] if len(path) == 2 and path[0] in ("shorts", "live", "embed") else
                 query.get("v", [""])[0] if path == ["watch"] else "")
        if track:
            # An excerpt and a full recording within one video need not be the
            # same work. Keep offsets distinct, including fragment timestamps.
            offset = tuple((k, tuple(query[k])) for k in ("t", "start", "end", "time_continue") if k in query)
            return ("youtube", "video", track, offset, parts.fragment)
    return None


def track_parent(url):
    """Read the explicit Apple album/track relation carried by a track link."""
    parts = urlsplit(url)
    path = parts.path.strip("/").split("/")
    track = parse_qs(parts.query).get("i", [""])[0]
    if (parts.hostname == "music.apple.com" and len(path) >= 3 and
            path[1] == "album" and path[-1].isdigit() and track.isdigit()):
        return ("apple", "album", path[-1])


def selected(item, field):
    statements = item["statements"].get(field, [])
    return ([s for s in statements if s.get("rank") == "preferred"] or
            [s for s in statements if s.get("rank", "normal") == "normal"])


def values(item, field):
    return [s["value"] for s in selected(item, field)
            if s["value"] not in ds.SPECIAL_VALUES]


POSTING_LOCATORS = frozenset((
    "video publication date", "upload date", "video upload date", "youtube upload date",
))


YOUTUBE_POSTING_LOCATORS = frozenset((
    "native public upload date", "youtube publisher feed publication date",
    "date posted", "public upload date",
    "original film publication", "artist video publication date",
    "original video publication", "video publication",
))
YOUTUBE_CAPTURE_HOSTS = {"www.youtube.com", "youtube.com", "music.youtube.com", "youtu.be"}


def posting_only_evidence(statement):
    """Recognize explicit posting locators, not mixed or ambiguous evidence."""
    def is_posting(ref):
        locator = (ref.get("locator") or "").casefold().strip().removesuffix(", yyyymmdd")
        host = ref.get("source", "").split("-", 1)[0].casefold()
        return (locator in POSTING_LOCATORS or
                (host in YOUTUBE_CAPTURE_HOSTS and locator in YOUTUBE_POSTING_LOCATORS))

    refs = statement.get("references", [])
    return bool(refs) and all(is_posting(r) for r in refs)


def audit(store):
    releases = {k: i.data for k, i in store.items.items()
                if i.data["type"] == "release" and "statements" in i.data}
    identities, tracks = defaultdict(set), defaultdict(set)
    missing = {k: [] for k in ("release date", "release type", "listen link", "performer", "published by")}
    video_only, upload_dates, posting_dates = [], [], []
    same_artist_title = defaultdict(set)
    for item_id, item in releases.items():
        for field, queue in missing.items():
            if not values(item, field):
                queue.append(item_id)
        urls = values(item, "listen link")
        if urls and all(ds.platform_of(url, REGISTRY) == "youtube" for url in urls):
            video_only.append(item_id)
        for name in values(item, "name"):
            if isinstance(name, dict):
                # NFC-like script fold: ZWNJ, punctuation and Arabic keyboard
                # variants should not hide a candidate. This proves no identity.
                raw = name["text"].casefold().translate(str.maketrans("يك", "یک"))
                title = "".join(c for c in unicodedata.normalize("NFKD", raw) if c.isalnum())
                if title:
                    for performer in values(item, "performer"):
                        same_artist_title[(performer, title)].add(item_id)
        date_statements = [
            s for s in selected(item, "release date")
            if s["value"] not in ds.SPECIAL_VALUES
        ]
        if any(posting_only_evidence(s) for s in date_statements):
            upload_dates.append(item_id)
        if values(item, "platform posting date"):
            posting_dates.append(item_id)
        for url in urls:
            identity = platform_identity(url)
            if identity:
                identities[identity].add(item_id)
            parent = track_parent(url)
            if parent:
                tracks[parent].add(item_id)
    duplicate_groups = [
        {"identity": identity, "items": sorted(items)}
        for identity, items in sorted(identities.items(), key=lambda row: repr(row[0]))
        if len(items) > 1
    ]
    parent_groups = [
        {"identity": identity, "album_items": sorted(identities[identity]),
         "track_items": sorted(items - identities[identity])}
        for identity, items in sorted(tracks.items())
        if identities.get(identity) and items - identities[identity]
    ]
    return {
        "releases": len(releases),
        "missing": missing,
        "video_only": video_only,
        "upload_only_date_review": upload_dates,
        "platform_posting_dates": posting_dates,
        "same_artist_title_review": [
            {"performer": key[0], "normalized_title": key[1], "items": list(items)}
            for key, items in sorted((key, tuple(sorted(ids))) for key, ids in same_artist_title.items()
                                     if len(ids) > 1)
        ],
        "shared_platform_id_review": duplicate_groups,
        "explicit_apple_track_parent_review": parent_groups,
    }


REGISTRY = ds.load_registry()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=ds.DEFAULT_ROOT)
    parser.add_argument("--json", action="store_true", help="emit full item-level review queues")
    args = parser.parse_args()
    store = ds.load_store(args.root)
    if store.problems:
        parser.exit(1, "\n".join(store.problems) + "\n")
    result = audit(store)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"{result['releases']} active release rows")
        for field, ids in result["missing"].items():
            print(f"{field}: {len(ids)} without a concrete value")
        print(f"{len(result['video_only'])} video-platform-only rows (not necessarily clips)")
        print(f"{len(result['upload_only_date_review'])} records have a selected release date backed only by posting metadata")
        print(f"{len(result['platform_posting_dates'])} records have a distinct platform posting date")
        print(f"{len(result['same_artist_title_review'])} same-performer/title candidates (not necessarily duplicates)")
        groups = result["shared_platform_id_review"]
        print("Shared platform-ID groups, review before merging:", dict(Counter(g["identity"][0] for g in groups)))
        print(f"{len(result['explicit_apple_track_parent_review'])} Apple album IDs with separately modeled tracks")


if __name__ == "__main__":
    main()
