"""The Statistics page's numbers, counted from the site record that derive.py builds.

Only counting happens here: no claim is added. Dates stay as ISO days so the
page can sort them into the years of its own calendar.
"""

import datetime
import math
import random
import re
from collections import Counter, defaultdict

PLATFORMS = (
    ("Apple Music", re.compile(r"(^|\.)apple\.com$")),
    ("Spotify", re.compile(r"(^|\.)spotify\.com$")),
    ("SoundCloud", re.compile(r"(^|\.)soundcloud\.com$")),
    ("YouTube", re.compile(r"(^|\.)(youtube\.com|youtu\.be)$")),
    ("Bandcamp", re.compile(r"(^|\.)bandcamp\.com$")),
    ("Telegram", re.compile(r"^(t\.me|telegram\.me)$")),
    ("Radio Javan", re.compile(r"(^|\.)(radiojavan\.com|rj\.app)$")),
    ("Deezer", re.compile(r"(^|\.)deezer\.com$")),
    ("Tidal", re.compile(r"(^|\.)tidal\.com$")),
)
# Source tiers are free words in capture; these are the groups the page shows.
TIERS = {
    "own": "own", "primary": "own",
    "discography": "discography", "catalogue": "discography", "platform": "discography",
    "platform catalog": "discography", "streaming": "discography",
    "journalism": "journalism", "press": "journalism",
    "academic": "academic", "wikipedia": "wikipedia",
}
NETWORK_SEED = 1404


def kept(statements):
    """Statements a reader is shown: the preferred ones if any, else all but deprecated."""
    preferred = [s for s in statements if s["rank"] == "preferred"]
    return preferred or [s for s in statements if s["rank"] != "deprecated"]


def middle(span):
    a, b = (datetime.date.fromisoformat(d) for d in span)
    return (a + (b - a) / 2).isoformat()


def first_day(statements):
    """The earliest date stated, as the middle of its range: a year-only date then
    falls in the right year of either calendar."""
    days = [middle(s["value"]["range"]) for s in kept(statements)
            if isinstance(s["value"], dict) and "range" in s["value"]]
    return min(days) if days else None


def host(url):
    match = re.match(r"https?://([^/:?#]+)", url or "")
    return match.group(1).lower().removeprefix("www.").removeprefix("open.").removeprefix("music.") if match else ""


def platform(url):
    h = host(url)
    return next((name for name, pattern in PLATFORMS if pattern.search(h)), "Other")


def week_of(day):
    d = datetime.date.fromisoformat(str(day)[:10])
    return (d - datetime.timedelta(days=d.weekday())).isoformat()


def layout(nodes, edges, steps=300):
    """A force layout with a fixed seed, so the picture is the same from build to build."""
    if not nodes:
        return
    rng = random.Random(NETWORK_SEED)
    ids = [n["id"] for n in nodes]
    pos = {i: [rng.uniform(-1, 1), rng.uniform(-1, 1)] for i in ids}
    k = math.sqrt(4.0 / max(len(ids), 1))
    temp = 0.12
    for _ in range(steps):
        move = {i: [0.0, 0.0] for i in ids}
        for a in range(len(ids)):
            pa = pos[ids[a]]
            for b in range(a + 1, len(ids)):
                pb = pos[ids[b]]
                dx, dy = pa[0] - pb[0], pa[1] - pb[1]
                d2 = dx * dx + dy * dy or 1e-6
                f = k * k / d2
                move[ids[a]][0] += dx * f; move[ids[a]][1] += dy * f
                move[ids[b]][0] -= dx * f; move[ids[b]][1] -= dy * f
        for e in edges:
            pa, pb = pos[e["s"]], pos[e["t"]]
            dx, dy = pa[0] - pb[0], pa[1] - pb[1]
            d = math.sqrt(dx * dx + dy * dy) or 1e-6
            f = d / k * (1 + math.log(e["w"])) * 0.5
            move[e["s"]][0] -= dx * f; move[e["s"]][1] -= dy * f
            move[e["t"]][0] += dx * f; move[e["t"]][1] += dy * f
        for i in ids:
            p, m = pos[i], move[i]
            m[0] -= p[0] * 0.6; m[1] -= p[1] * 0.9  # gravity, flatter than tall
            d = math.sqrt(m[0] ** 2 + m[1] ** 2) or 1e-6
            step = min(d, temp)
            p[0] += m[0] / d * step; p[1] += m[1] / d * step
        temp *= 0.992
    xs = [p[0] for p in pos.values()]; ys = [p[1] for p in pos.values()]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    for n in nodes:
        n["x"] = round((pos[n["id"]][0] - x0) / ((x1 - x0) or 1), 4)
        n["y"] = round((pos[n["id"]][1] - y0) / ((y1 - y0) or 1), 4)


def network(items, artists):
    """Artists with a page and anyone credited beside three of them, linked by shared releases."""
    shared = Counter()
    credits = defaultdict(set)
    for item in items.values():
        if item["type"] != "release":
            continue
        st = item["statements"]
        names = {s["value"] for p in ("performer", "contributor") for s in kept(st.get(p, []))
                 if s["value"] in items and items[s["value"]]["type"] in ("person", "act")}
        for n in names:
            credits[n].add(item["id"])
        names = sorted(names)
        for a in range(len(names)):
            for b in range(a + 1, len(names)):
                shared[(names[a], names[b])] += 1
    pages = set(artists)
    neighbours = defaultdict(set)
    for a, b in shared:
        neighbours[a].add(b); neighbours[b].add(a)
    keep = pages | {n for n, near in neighbours.items() if len(near & pages) >= 3}
    edges = [{"s": a, "t": b, "w": w} for (a, b), w in sorted(shared.items()) if a in keep and b in keep]
    adj = defaultdict(set)
    for e in edges:
        adj[e["s"]].add(e["t"]); adj[e["t"]].add(e["s"])
    seen, best = set(), []
    for start in sorted(adj):
        if start in seen:
            continue
        group, stack = [], [start]
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x); group.append(x); stack.extend(adj[x] - seen)
        if len(group) > len(best):
            best = group
    best = set(best)
    edges = [e for e in edges if e["s"] in best]
    degree = Counter()
    for e in edges:
        degree[e["s"]] += 1; degree[e["t"]] += 1
    nodes = [{"id": i, "page": i in pages, "deg": degree[i]} for i in sorted(best)]
    layout(nodes, edges)
    return {"nodes": nodes, "edges": edges, "connected": sum(1 for n in nodes if n["page"]),
            "artists": len(pages), "linkedArtists": sum(1 for a in pages if a in adj)}


def pace(references, weeks=26):
    if not references:
        return []
    last = datetime.date.fromisoformat(max(references))
    first = last - datetime.timedelta(weeks=weeks - 1)
    days = [first + datetime.timedelta(weeks=i) for i in range(weeks)]
    rows = [[d.isoformat(), references.get(d.isoformat(), 0)] for d in days]
    while rows and rows[0][1] == 0:
        rows.pop(0)
    return rows


def country_of(items, place):
    """The country a place lies in: follow `country` up until a place has none."""
    seen = set()
    while place in items and place not in seen:
        seen.add(place)
        up = [s["value"] for s in kept(items[place]["statements"].get("country", []))
              if isinstance(s["value"], str) and s["value"] in items]
        if not up:
            return place
        place = up[0]
    return place


def bases(items, artists):
    """Where the artists live now, inside Iran or abroad, and the years those who left Iran left.

    The current base is the preferred one, else the one with no end time that started
    last, else the one that ended last. Earlier bases count for leaving even though a
    reader is shown only the preferred one. An artist who left has an Iran base and lives abroad now; the year they
    left is when their last Iran base ended, or else when their first base abroad began.
    """
    iran = next((i for i, item in items.items() if item["type"] == "place" and any(
        isinstance(s["value"], dict) and s["value"].get("text") in ("Iran", "ایران")
        for s in item["statements"].get("name", []))), None)

    def when(s, key):
        days = [middle(v["range"]) for v in s.get("qualifiers", {}).get(key, []) if isinstance(v, dict) and "range" in v]
        return days[0] if days else None

    inside = abroad = 0
    countries = Counter()
    left = []
    for a in artists:
        found = [s for s in items[a]["statements"].get("based in", [])
                 if s["rank"] != "deprecated" and isinstance(s["value"], str) and s["value"] in items]
        if not found:
            continue
        rows = [(when(s, "start time"), when(s, "end time"), country_of(items, s["value"]), s["rank"]) for s in found]
        current = [r for r in rows if r[3] == "preferred"] or [r for r in rows if not r[1]] or rows
        now = max(current, key=lambda r: (r[0] or "", r[1] or ""))
        if now[2] == iran:
            inside += 1
        else:
            abroad += 1
            countries[now[2]] += 1
        was_home = [r for r in rows if r[2] == iran]
        if was_home and now[2] != iran:
            # Leaving is when the last Iran base ended, or else when the first base abroad began.
            ends = [r[1] for r in was_home if r[1]]
            starts = [r[0] for r in rows if r[2] != iran and r[0]]
            out = max(ends) if ends else min(starts) if starts else None
            if out:
                left.append(out)
    return {"inside": inside, "abroad": abroad, "countries": [[c, n] for c, n in countries.most_common()],
            "left": sorted(left)}


def stats(items, artists, sources, tiers, articles=None):
    """Everything the Statistics page draws. `tiers` maps a cited source to its tier word;
    `articles` are the derived articles, whose notes cite sources too."""
    releases = [i for i in items.values() if i["type"] == "release"]
    pages = [items[a] for a in artists]

    release_days = [first_day(r["statements"].get("release date", [])) for r in releases]

    performed = defaultdict(list)
    for r, day in zip(releases, release_days):
        if day:
            for s in kept(r["statements"].get("performer", [])):
                performed[s["value"]].append(day)
    starts = [min(performed[a]) for a in artists if performed.get(a)]

    on = Counter()
    linked = 0
    for r in releases:
        names = {platform(s["value"]) for s in kept(r["statements"].get("listen link", []))
                 if isinstance(s["value"], str)}
        linked += bool(names)
        on.update(names)

    labels = Counter(s["value"] for r in releases for s in kept(r["statements"].get("published by", [])))
    labelled = sum(1 for r in releases if kept(r["statements"].get("published by", [])))

    def has(item, *props):
        return any(kept(item["statements"].get(p, [])) for p in props)

    people = [a for a in pages if a["type"] == "person"]
    references = Counter()
    first_read = {}
    for item in items.values():
        for statements in item["statements"].values():
            for s in statements:
                for ref in s["references"]:
                    if ref.get("accessed"):
                        references[week_of(ref["accessed"])] += 1
                        day = str(ref["accessed"])[:10]
                        if day < first_read.get(ref["source"], "9999"):
                            first_read[ref["source"]] = day
    # A source cited only in an article was gathered too: its notes carry when it was read.
    for by_language in (articles or {}).values():
        for article in by_language.values():
            for note in article["notes"]:
                if note.get("accessed"):
                    day = str(note["accessed"])[:10]
                    if day < first_read.get(note["source"], "9999"):
                        first_read[note["source"]] = day
    gathered = Counter(week_of(day) for day in first_read.values())

    languages = Counter()
    for meta in sources.values():
        lang = meta.get("language")
        languages[lang if lang in ("en", "fa", "mul") else "other"] += 1
    kinds = Counter(TIERS.get(str(tiers.get(name) or "").strip().lower(), "other") for name in sources)

    return {
        "totals": {
            "artists": len(pages),
            "releases": len(releases),
            "people": sum(1 for i in items.values() if i["type"] == "person"),
            "events": sum(1 for i in items.values() if i["type"] == "event"),
            "sources": len(sources),
            "references": sum(references.values()),
        },
        "releases": {"days": sorted(d for d in release_days if d), "total": len(releases)},
        "starts": {"days": sorted(starts), "total": len(pages)},
        "based": {"known": sum(1 for a in pages if has(a, "based in")), "total": len(pages), **bases(items, artists)},
        "gender": {"known": 0, "total": len(people)},
        "listen": {"total": len(releases), "linked": linked,
                   "platforms": [[name, n] for name, n in on.most_common() if name != "Other"]},
        "labels": {"total": len(releases), "known": labelled,
                   "top": [[label, n] for label, n in labels.most_common(6)]},
        "network": network(items, artists),
        "completeness": {
            "artists": [
                ["photo", sum(has(a, "image") for a in pages), len(pages)],
                ["official link", sum(has(a, "profile link") for a in pages), len(pages)],
                ["born or formed", sum(has(a, "birth date", "formation date") for a in pages), len(pages)],
                ["based in", sum(has(a, "based in") for a in pages), len(pages)],
                ["life events", sum(has(a, "life event") for a in pages), len(pages)],
            ],
            "releases": [
                ["date", sum(1 for d in release_days if d), len(releases)],
                ["cover", sum(has(r, "cover art") for r in releases), len(releases)],
                ["listen link", linked, len(releases)],
                ["credits", sum(has(r, "contributor") for r in releases), len(releases)],
                ["label", labelled, len(releases)],
            ],
        },
        "sources": {
            "langs": [[k, languages[k]] for k in ("en", "fa", "mul", "other")],
            "kinds": [[k, kinds[k]] for k in ("own", "discography", "journalism", "academic", "wikipedia", "other")],
        },
        # Sources by the week the record first cites them as read: the last half year,
        # so a stray old access date does not stretch the axis.
        "pace": pace(gathered),
    }
