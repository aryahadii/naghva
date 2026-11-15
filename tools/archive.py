#!/usr/bin/env python3
"""Give processed web sources an archive link from the Wayback Machine.

    python3 tools/archive.py [--root data] [--limit N] [--save] [--dry-run]

For each processed source with a `url` and no `archive`, asks the Wayback
Machine for its closest snapshot and writes `archive:` into the source's
front matter, right after `url:`. With --save, a source with no snapshot is
sent to Save Page Now first. Sources are taken in file-name order, so a run
cut short can simply be started again.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import datastore as ds  # noqa: E402

AVAILABLE = "https://archive.org/wayback/available?url="
CDX = "https://web.archive.org/cdx/search/cdx?output=json&filter=statuscode:200&limit=-1&url="
SAVE = "https://web.archive.org/save/"
USER_AGENT = "naghva-archive/1 (+https://naghva.com)"


def needs_archive(source):
    meta = source.meta
    return meta.get("status") == "processed" and isinstance(meta.get("url"), str) and not meta.get("archive")


def _get(url, timeout=60):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", "replace"), response.geturl()


def closest_snapshot(url):
    """The address of the Wayback Machine's closest snapshot of `url`, or None."""
    body, _ = _get(AVAILABLE + urllib.parse.quote(url, safe=""))
    closest = (json.loads(body).get("archived_snapshots") or {}).get("closest") or {}
    if closest.get("available") and str(closest.get("status", "200")).startswith("2"):
        return closest["url"].replace("http://", "https://", 1)
    # The availability API often answers empty for pages that have snapshots;
    # the CDX index is slower but complete.
    rows = json.loads(_get(CDX + urllib.parse.quote(url, safe=""))[0] or "[]")
    if len(rows) > 1:
        header, last = rows[0], rows[-1]
        return "https://web.archive.org/web/%s/%s" % (last[header.index("timestamp")], last[header.index("original")])
    return None


def save(url):
    """Ask Save Page Now for a fresh snapshot; the address it lands on, or None."""
    try:
        _, landed = _get(SAVE + url, timeout=180)
    except urllib.error.HTTPError:
        return None
    return landed if "/web/" in landed else None


def add_archive_line(path, archive):
    """Write `archive:` after the `url:` line of the front matter, keeping the rest as it is."""
    lines = path.read_text(encoding="utf-8").split("\n")
    end = next(n for n in range(1, len(lines)) if lines[n].strip() == "---")
    line = "archive: %s" % json.dumps(archive)
    blank = next((n for n in range(1, end) if lines[n].startswith("archive:")), None)
    if blank is not None:  # `archive:` with no value
        lines[blank] = line
    else:
        at = next((n for n in range(1, end) if lines[n].startswith("url:")), end - 1)
        lines.insert(at + 1, line)
    path.write_text("\n".join(lines), encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--root", default=str(ds.DEFAULT_ROOT), help="data root (default: data)")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many sources")
    parser.add_argument("--save", action="store_true", help="send sources with no snapshot to Save Page Now")
    parser.add_argument("--dry-run", action="store_true", help="print what would be written, write nothing")
    parser.add_argument("--pause", type=float, default=1.0, help="seconds between requests (default 1)")
    args = parser.parse_args(argv)

    store = ds.load_store(Path(args.root).resolve())
    todo = [s for s in store.sources.values() if needs_archive(s)]
    if args.limit:
        todo = todo[:args.limit]
    found = saved = missing = 0
    for source in todo:
        url = source.meta["url"]
        try:
            archive = closest_snapshot(url)
            if archive is None and args.save:
                archive = save(url)
                saved += archive is not None
        except (OSError, ValueError) as exc:  # network errors included
            print("skip %s: %s" % (source.name, exc), file=sys.stderr)
            archive = None
        if archive is None:
            missing += 1
            print("none %s" % url)
        else:
            found += 1
            print("ok   %s -> %s" % (source.name, archive))
            if not args.dry_run:
                add_archive_line(source.path, archive)
        time.sleep(args.pause)
    print("%d archived (%d newly saved), %d without a snapshot, of %d" % (found, saved, missing, len(todo)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
