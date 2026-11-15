"""Stage 1 of the gate: the record. Platforms, catalogue, sources.

Every check here is plain code. Checks that ask a platform for its own list
say so when the platform does not answer; they never pass silently.
"""

import base64
import os
import re
import urllib.parse
from collections import Counter

import datastore as ds
from gate_common import (
    PLATFORM_NAMES, REGISTRY, TIERS, Finding, http_json, is_recording, platform_of, statements, tier_of,
    url_value,
)

NOTES_DIR = ("capture", "notes")

# A listen link opens a release or a track. These shapes are profiles.
PROFILE_SHAPES = {
    "Apple Music": re.compile(r"/artist/"),
    "Spotify": re.compile(r"/(artist|user)/"),
    "YouTube": re.compile(r"youtube\.com/(channel/|c/|user/|@)[^/]+/?$"),
    "SoundCloud": re.compile(r"soundcloud\.com/[^/?#]+/?$"),
    "Bandcamp": re.compile(r"bandcamp\.com/?(music/?)?$"),
    "Telegram": re.compile(r"t\.me/(s/)?[^/?#]+/?$"),
}
# Reference-desk links on a Wikipedia page that are not sources to read.
NOT_SOURCES = (
    "wikipedia.org", "wikimedia.org", "wikidata.org", "viaf.org", "isni.org", "id.loc.gov",
    "worldcat.org", "d-nb.info", "bnf.fr", "idref.fr", "toolforge.org", "geohack", "doi.org",
    "mediawiki.org", "wikisource.org", "wikiquote.org", "creativecommons.org", "foundation.wikimedia",
)


def searched_platforms(store, artist_id):
    """Platforms a capture note says were searched and held no official account.

    The note is any file in capture/notes whose front matter has `about: <ID>`
    and `searched: {<platform>: <day>}`.
    """
    out = {}
    folder = store.root.joinpath(*NOTES_DIR)
    for path in sorted(folder.glob("*.md")) if folder.is_dir() else []:
        try:
            meta, _ = ds.read_markdown(path)
        except Exception:
            continue
        about = meta.get("about")
        if artist_id not in (about if isinstance(about, list) else [about]):
            continue
        for name, day in (meta.get("searched") or {}).items():
            for key, known in zip(REGISTRY["platforms"], PLATFORM_NAMES):
                if str(name).casefold() in (key.casefold(), known.casefold()):
                    out[known] = str(day)
    return out


def links_by_platform(item, prop):
    out = {}
    for s in statements(item, prop):
        url = url_value(s)
        name = platform_of(url) if isinstance(url, str) else None
        if name:
            out.setdefault(name, []).append(url)
    return out


def check_platforms(artist):
    findings = []
    profiles = links_by_platform(artist.item, "profile link")
    searched = searched_platforms(artist.store, artist.id)
    undeclared = [p for p in PLATFORM_NAMES if p not in profiles and p not in searched]
    if undeclared:
        findings.append(Finding(
            "block", "platforms",
            "No profile link and no recorded search for: %s" % ", ".join(undeclared),
        ))

    total = len(artist.releases)
    counts = {p: 0 for p in PLATFORM_NAMES}
    wrong_shape = []
    unlinked = []
    for release in artist.releases:
        links = links_by_platform(release, "listen link")
        if not links:
            unlinked.append("%s %s" % (release.id, _title(release)))
        for name, urls in links.items():
            counts[name] += 1
            for url in urls:
                if name in PROFILE_SHAPES and PROFILE_SHAPES[name].search(url):
                    wrong_shape.append("%s %s: %s" % (release.id, _title(release), url))
    if wrong_shape:
        findings.append(Finding(
            "block", "exact links", "Listen links that open a profile, not the release", wrong_shape,
        ))
    if unlinked:
        findings.append(Finding("fix", "listen links", "Releases with no listen link at all", unlinked))

    best = max(counts.values()) if total else 0
    for name in PLATFORM_NAMES:
        if name in profiles and name not in ("YouTube", "Telegram") and total >= 4:
            if counts[name] < 0.5 * total and best >= 0.8 * total:
                findings.append(Finding(
                    "fix", "platforms",
                    "%s has a profile but links on only %d of %d releases" % (name, counts[name], total),
                ))
    parts = []
    for name in PLATFORM_NAMES:
        if name in profiles:
            parts.append("%s %d/%d" % (name, counts[name], total))
        elif name in searched:
            parts.append("%s none (searched %s)" % (name, searched[name]))
        else:
            parts.append("%s not declared" % name)
    return " · ".join(parts), findings, {"profiles": profiles, "counts": counts, "releases": total}


def _title(release):
    for s in statements(release, "name"):
        value = s.get("value")
        if isinstance(value, dict) and value.get("text"):
            return value["text"]
    return ""


# --- Catalogue ------------------------------------------------------------------


def _apple_ids(url):
    """Album and track numbers in an Apple Music address."""
    parts = urllib.parse.urlsplit(url)
    ids = set(re.findall(r"/(?:album|song|music-video)/(?:[^/]+/)?(\d+)", parts.path))
    ids.update(urllib.parse.parse_qs(parts.query).get("i", []))
    return ids


def apple_catalogue(artist_url):
    match = re.search(r"/artist/(?:[^/]+/)?(\d+)", artist_url)
    if not match:
        return None
    data = http_json(
        "https://itunes.apple.com/lookup?id=%s&entity=album&limit=200" % match.group(1)
    )
    if not data or "results" not in data:
        return None
    return [
        {"id": str(r["collectionId"]), "title": r.get("collectionName", ""),
         "url": (r.get("collectionViewUrl") or "").split("?")[0], "date": (r.get("releaseDate") or "")[:10]}
        for r in data["results"] if r.get("wrapperType") == "collection"
    ]


def _spotify_token():
    client, secret = os.environ.get("SPOTIFY_CLIENT_ID"), os.environ.get("SPOTIFY_CLIENT_SECRET")
    if not (client and secret):
        return None
    basic = base64.b64encode(("%s:%s" % (client, secret)).encode()).decode()
    data = http_json(
        "https://accounts.spotify.com/api/token", data=b"grant_type=client_credentials",
        headers={"Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded"},
    )
    return data.get("access_token") if data else None


def spotify_catalogue(artist_url, token):
    match = re.search(r"/artist/([A-Za-z0-9]+)", artist_url)
    if not match:
        return None
    out, url = [], (
        "https://api.spotify.com/v1/artists/%s/albums?include_groups=album,single&limit=50" % match.group(1)
    )
    while url:
        page = http_json(url, headers={"Authorization": "Bearer " + token})
        if not page or "items" not in page:
            return None
        out += [
            {"id": a["id"], "title": a.get("name", ""), "date": a.get("release_date", ""),
             "url": "https://open.spotify.com/album/" + a["id"]}
            for a in page["items"]
        ]
        url = page.get("next")
    return out


def _spotify_album_ids(urls, token):
    """Album IDs behind Spotify links; a track link is resolved to its album."""
    ids, tracks = set(), []
    for url in urls:
        album = re.search(r"/album/([A-Za-z0-9]+)", url)
        track = re.search(r"/track/([A-Za-z0-9]+)", url)
        if album:
            ids.add(album.group(1))
        elif track:
            tracks.append(track.group(1))
    for start in range(0, len(tracks), 50):
        page = http_json(
            "https://api.spotify.com/v1/tracks?ids=" + ",".join(tracks[start:start + 50]),
            headers={"Authorization": "Bearer " + token},
        )
        for t in (page or {}).get("tracks") or []:
            if t and t.get("album"):
                ids.add(t["album"]["id"])
    return ids


def check_catalogue(artist, platforms_data, offline=False):
    """Compare the record with each platform's own list of albums and singles."""
    findings, parts = [], []
    if offline:
        return "not checked (offline)", findings, {}
    profiles = platforms_data["profiles"]
    release_links = {"Apple Music": [], "Spotify": []}
    for release in artist.releases:
        for name, urls in links_by_platform(release, "listen link").items():
            if name in release_links:
                release_links[name] += urls

    if "Apple Music" in profiles:
        listed, reached = {}, True
        for url in profiles["Apple Music"]:
            got = apple_catalogue(url)
            if got is None:
                reached = False
            for entry in got or []:
                listed[entry["id"]] = entry
        if not reached and not listed:
            parts.append("Apple Music did not answer")
            findings.append(Finding("note", "catalogue", "Apple Music's list could not be fetched"))
        else:
            have = set()
            for url in release_links["Apple Music"]:
                have |= _apple_ids(url)
            missing = [e for i, e in listed.items() if i not in have]
            parts.append("Apple Music lists %d, %d not in the record" % (len(listed), len(missing)))
            if missing:
                findings.append(Finding(
                    "fix", "catalogue", "On Apple Music under the artist's profile, not linked in the record",
                    ["%s (%s) %s" % (e["title"], e["date"], e["url"]) for e in sorted(missing, key=lambda e: e["date"])],
                ))

    if "Spotify" in profiles:
        token = _spotify_token()
        if token is None:
            parts.append("Spotify needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET")
        else:
            listed = {}
            for url in profiles["Spotify"]:
                for entry in spotify_catalogue(url, token) or []:
                    listed[entry["id"]] = entry
            have = _spotify_album_ids(release_links["Spotify"], token)
            missing = [e for i, e in listed.items() if i not in have]
            parts.append("Spotify lists %d, %d not in the record" % (len(listed), len(missing)))
            if missing:
                findings.append(Finding(
                    "fix", "catalogue", "On Spotify under the artist's profile, not linked in the record",
                    ["%s (%s) %s" % (e["title"], e["date"], e["url"]) for e in sorted(missing, key=lambda e: e["date"])],
                ))
    return " · ".join(parts) or "no platform with a list to compare", findings, {}


# --- Sources --------------------------------------------------------------------


def url_key(url):
    """An address reduced so that two spellings of one page compare equal."""
    wayback = re.match(r"https?://web\.archive\.org/web/\d+[a-z_]*/(.+)$", url)
    if wayback:
        url = wayback.group(1)
        if not url.startswith("http"):
            url = "http://" + url
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    host = host[2:] if host.startswith("m.") else host
    path = urllib.parse.unquote(parts.path).rstrip("/").lower()
    query = parts.query if host in ("youtube.com",) else ""
    return host + path + ("?" + query if query else "")


def wikipedia_links(url):
    """External links of a Wikipedia article, or None when the API does not answer."""
    parts = urllib.parse.urlsplit(url)
    if not (parts.hostname or "").endswith("wikipedia.org") or not parts.path.startswith("/wiki/"):
        return None
    title = urllib.parse.unquote(parts.path[len("/wiki/"):])
    api = "https://%s/w/api.php?action=query&prop=extlinks&ellimit=500&format=json&titles=%s" % (
        parts.hostname, urllib.parse.quote(title),
    )
    data = http_json(api, headers={"User-Agent": "naghva-gate/1 (https://naghva.com)"})
    if not data:
        return None
    links = []
    for page in (data.get("query", {}).get("pages") or {}).values():
        links += [next(iter(l.values())) for l in page.get("extlinks") or []]
    return [("https:" + l if l.startswith("//") else l) for l in links]


def check_sources(artist, offline=False):
    findings = []
    sources = artist.cited_sources()
    groups = Counter(tier_of(source) for source in sources)
    independent = groups.get("journalism", 0) + groups.get("academic", 0)
    if artist.is_enriched() and (independent < 3 or not groups.get("own")):
        findings.append(Finding(
            "fix", "source depth",
            "An enriched page needs the artist's own pages and three independent sources; "
            "this one cites %d own and %d independent" % (groups.get("own", 0), independent),
        ))

    web = [s for s in sources if s.meta.get("url")]
    no_archive = [
        s.name for s in web
        if not s.meta.get("archive") and "web.archive.org" not in str(s.meta.get("url"))
    ]
    if no_archive:
        findings.append(Finding("note", "archive", "Cited web sources without an archive link", no_archive))

    unheard = [
        s.name for s in sources
        if is_recording(s) and s.quotes and not s.meta.get("heard")
    ]
    if unheard:
        findings.append(Finding(
            "note", "interviews",
            "Audio and video sources with quotes and no `heard` key saying who transcribed them", unheard,
        ))

    leads_line = ""
    if not offline:
        known = {url_key(str(s.meta["url"])) for s in artist.store.sources.values() if s.meta.get("url")}
        known |= {
            url_key(str(s.meta["archive"])) for s in artist.store.sources.values() if s.meta.get("archive")
        }
        pages = [s for s in sources if "wikipedia.org/wiki/" in str(s.meta.get("url"))]
        leads, unreachable = [], 0
        for page in pages:
            links = wikipedia_links(str(page.meta["url"]))
            if links is None:
                unreachable += 1
                continue
            for link in links:
                host = urllib.parse.urlsplit(link).hostname or ""
                if any(skip in host or skip in link for skip in NOT_SOURCES):
                    continue
                link = urllib.parse.unquote(link)
                if url_key(link) not in known and link not in leads:
                    leads.append(link)
        if leads:
            findings.append(Finding(
                "note", "sources found",
                "Linked from the artist's Wikipedia article and not in capture: leads to look "
                "through for sources, not a list to register one by one", leads,
            ))
        if pages:
            leads_line = " · Wikipedia links not in capture: %d" % len(leads)
            if unreachable:
                leads_line += " (%d of %d articles did not answer)" % (unreachable, len(pages))
        else:
            leads_line = " · no Wikipedia article cited"

    line = "%d cited: %s · archived %d/%d%s" % (
        len(sources), ", ".join("%d %s" % (groups[g], g) for g in TIERS if g in groups) or "none",
        len(web) - len(no_archive), len(web), leads_line,
    )
    return line, findings, {"groups": groups}
