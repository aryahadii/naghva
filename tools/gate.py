#!/usr/bin/env python3
"""The enrichment gate: one scorecard per artist, saying whether the work is
ready for the owner to read.

    python3 tools/gate.py "Shahin Najafi"          one artist, by name or ID
    python3 tools/gate.py --changed origin/main    every artist this branch touches

It never accepts anything; the owner does. Three stages, cheapest first:

1. The record: every listen platform has a profile link or a recorded search,
   the platforms' own catalogue lists are compared with the record, and the
   sources are counted.
2. Quotes: each quoted passage is looked for on its source, and the years in
   a sentence must appear in the passages it cites.
3. The article: the measurable habits of specs/artist-writing.md, and the
   same footnotes in both languages.

What code can't judge goes to a verifier: an agent given tools/review/claims.md
or tools/review/article.md and the artist's folder under --out. It writes its
answers there as JSON, and the next run of the gate adds them to the scorecard.

The verdict is Blocked, Fix first or Ready for you. Exits 1 when an artist is
blocked.

A platform with no official account is recorded in a capture note, any file in
data/capture/notes/ whose front matter reads:

    about: <artist ID>
    searched: {Bandcamp: 2026-11-15, YouTube: 2026-11-15}
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import datastore as ds  # noqa: E402
import gate_article  # noqa: E402
import gate_quotes  # noqa: E402
import gate_record  # noqa: E402
from gate_common import Finding, changed_artists, find_artists  # noqa: E402

RUBRIC = ("story", "selection", "sentences", "record leakage", "this artist", "tone")
VERDICTS = ("supported", "partly", "not")
LEVELS = (("block", "Blocks a merge"), ("fix", "Fix first"), ("note", "For the reader"))


# --- The verifier's folder ----------------------------------------------------------


def write_claims(artist, claims, folder):
    """Every cited stretch of both articles beside the passages it cites."""
    out = {"artist": artist.id, "name": artist.name}
    for language, items in claims.items():
        refs = artist.article_references(language)
        rows = []
        for number, claim in enumerate(items, 1):
            passages = []
            for key in claim.keys:
                ref = refs.get(key)
                source = artist.store.sources.get(ref.source) if ref else None
                if source is None:
                    continue
                passages.append({
                    "key": key, "quote": ref.quote, "source": ref.source,
                    "title": source.meta.get("title"), "publisher": source.meta.get("publisher"),
                    "issued": str(source.meta.get("issued") or "") or None,
                })
            rows.append({"n": number, "section": claim.section, "text": claim.text, "passages": passages})
        out[language] = rows
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "claims.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


def read_reviews(folder, claims):
    """Findings and scorecard lines from the verifiers' JSON files in `folder`."""
    findings, lines = [], []
    files = sorted(folder.glob("claims.review*.json")) if folder.is_dir() else []
    votes, reasons, reviewers = {}, {}, 0
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as exc:
            findings.append(Finding("fix", "verifier", "%s is not JSON: %s" % (path.name, exc)))
            continue
        reviewers += 1
        for row in data.get("verdicts") or []:
            key = (row.get("language"), row.get("n"))
            if row.get("verdict") in VERDICTS:
                votes.setdefault(key, []).append(row["verdict"])
                if row.get("why"):
                    reasons.setdefault(key, []).append(row["why"])
    if reviewers:
        total = sum(len(v) for v in claims.values())
        rejected, doubted, partly = [], [], []
        for (language, number), cast in sorted(votes.items(), key=lambda kv: (str(kv[0][0]), kv[0][1] or 0)):
            items = claims.get(language) or []
            if not isinstance(number, int) or not 1 <= number <= len(items):
                continue
            text = "%s %d: “%s” — %s" % (
                language, number, gate_quotes._clip(items[number - 1].text, 160),
                " / ".join(reasons.get((language, number), [])),
            )
            if cast.count("not") == len(cast) and reviewers >= 2 and len(cast) >= 2:
                rejected.append(text)
            elif "not" in cast:
                doubted.append(text)
            elif "partly" in cast:
                partly.append(text)
        if rejected:
            findings.append(Finding("block", "claims", "Claims every verifier found unsupported", rejected))
        if doubted:
            findings.append(Finding("fix", "claims", "Claims a verifier found unsupported", doubted))
        if partly:
            findings.append(Finding("note", "claims", "Claims only partly supported by their passages", partly))
        judged = len({k for k in votes})
        lines.append(("Claims", "%d of %d judged by %d verifier%s · %d not supported · %d partly" % (
            judged, total, reviewers, "" if reviewers == 1 else "s", len(rejected) + len(doubted), len(partly),
        )))
        if judged < total:
            findings.append(Finding("fix", "verifier", "The verifier judged %d of %d claims" % (judged, total)))
    else:
        lines.append(("Claims", "verifier not run (tools/review/claims.md)"))

    files = sorted(folder.glob("article.review*.json")) if folder.is_dir() else []
    scores, low = {}, []
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as exc:
            findings.append(Finding("fix", "verifier", "%s is not JSON: %s" % (path.name, exc)))
            continue
        for language in ("en", "fa"):
            for question in RUBRIC:
                entry = (data.get(language) or {}).get(question) or {}
                score = entry.get("score")
                if not isinstance(score, int):
                    continue
                key = (language, question)
                scores[key] = min(scores.get(key, 4), score)
                for note in entry.get("notes") or []:
                    if score <= 2:
                        low.append("%s, %s (%d): “%s” — %s. Rewrite: %s" % (
                            language, question, score, gate_quotes._clip(str(note.get("sentence", "")), 160),
                            str(note.get("problem", "")).rstrip("."), note.get("rewrite", ""),
                        ))
    if scores:
        for language in ("en", "fa"):
            row = ["%s %s" % (q, scores.get((language, q), "–")) for q in RUBRIC]
            lines.append(("Rubric " + language, " · ".join(row)))
        weak = ["%s %s: %d" % (l, q, s) for (l, q), s in sorted(scores.items()) if s <= 2]
        if weak:
            findings.append(Finding("fix", "rubric", "Rubric scores of 1 or 2: " + ", ".join(weak), low))
    else:
        lines.append(("Rubric", "verifier not run (tools/review/article.md)"))
    return lines, findings, bool(reviewers) and bool(scores), votes


# --- One artist -------------------------------------------------------------------


def run(artist, args):
    lines, findings = [], []

    line, found, platforms = gate_record.check_platforms(artist)
    lines.append(("Platforms", line))
    findings += found
    line, found, _ = gate_record.check_catalogue(artist, platforms, args.offline)
    lines.append(("Catalogue", line))
    findings += found
    line, found, _ = gate_record.check_sources(artist, args.offline)
    lines.append(("Sources", line))
    findings += found

    line, found, _ = gate_quotes.check_passages(
        artist, args.deep, not args.no_browser, args.refresh, args.offline
    )
    lines.append(("Passages", line))
    findings += found
    line, found, years = gate_quotes.check_years(artist)
    lines.append(("Years", line))
    findings += found

    line, found, _ = gate_article.check_article(artist)
    lines.append(("Article", line))
    findings += found

    folder = Path(args.out) / artist.id
    claims = years["claims"]
    write_claims(artist, claims, folder)
    review_lines, found, reviewed, votes = read_reviews(folder, claims)
    lines += review_lines
    findings += found
    findings += gate_quotes.year_findings(years["strays"], votes)

    levels = {f.level for f in findings}
    if "block" in levels:
        verdict = "BLOCKED"
    elif "fix" in levels:
        verdict = "FIX FIRST"
    elif not reviewed:
        verdict = "CODE CHECKS PASSED, VERIFIER NOT RUN"
    else:
        verdict = "READY FOR YOU"

    card = ["## %s (%s): %s" % (artist.name, artist.id, verdict), "", "```text"]
    card += ["%-10s %s" % (label, text) for label, text in lines]
    card += ["```", ""]
    for level, title in LEVELS:
        chosen = [f for f in findings if f.level == level]
        if not chosen:
            continue
        card.append("### %s" % title)
        card.append("")
        for finding in chosen:
            card.append("- **%s.** %s" % (finding.check.capitalize(), finding.text))
            shown = finding.items if args.all else finding.items[:args.limit]
            card += ["    - %s" % item for item in shown]
            if len(finding.items) > len(shown):
                card.append("    - … and %d more (--all shows them)" % (len(finding.items) - len(shown)))
        card.append("")
    audit = gate_quotes.spot_audit(artist, claims.get("en") or [], seed=args.seed)
    if audit:
        card += ["### Spot audit", "", "Five claims picked at random, each with what it cites.", ""]
        card += audit + [""]
    text = "\n".join(card)
    (folder / "scorecard.md").write_text(text, encoding="utf-8")
    return verdict, text


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("artists", nargs="*", help="artist IDs or names")
    parser.add_argument("--changed", metavar="BASE", help="artists this branch touches, against BASE")
    parser.add_argument("--root", default=str(ds.DEFAULT_ROOT))
    parser.add_argument("--out", default=str(ds.REPO / ".gate"), help="where scorecards and reviews are kept")
    parser.add_argument("--offline", action="store_true", help="skip every check that needs the network")
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser for scripted pages")
    parser.add_argument("--deep", action="store_true", help="re-check the passages of every release too")
    parser.add_argument("--refresh", action="store_true", help="fetch pages again instead of using the cache")
    parser.add_argument("--all", action="store_true", help="list every item of every finding")
    parser.add_argument("--limit", type=int, default=12, help="items listed per finding (default 12)")
    parser.add_argument("--seed", type=int, help="fix the spot audit's random choice")
    args = parser.parse_args(argv)

    store = ds.load_store(args.root)
    try:
        artists = find_artists(store, args.artists)
        if args.changed:
            known = {a.id for a in artists}
            artists += [a for a in changed_artists(store, args.changed) if a.id not in known]
    except ds.DataError as exc:
        print(exc, file=sys.stderr)
        return 2
    if not artists:
        print("no artist to check: name one, or pass --changed BASE", file=sys.stderr)
        return 2

    blocked = False
    for artist in artists:
        verdict, text = run(artist, args)
        blocked = blocked or verdict == "BLOCKED"
        print(text)
    print("Scorecards and the verifier's folders are in %s" % args.out)
    return 1 if blocked else 0


if __name__ == "__main__":
    sys.exit(main())
