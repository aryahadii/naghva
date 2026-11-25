"""Stage 2 of the gate, in code: are the quoted passages really in their
sources, and do the years in a sentence appear in what it cites?

A reference is already known to sit in a capture blockquote (validate.py).
Here each one is looked for on the source itself: the live page, then its
archive copy, then the page as a browser draws it.
"""

import concurrent.futures
import random
import re
import urllib.parse

import gate_common
from gate_common import (
    Finding, is_recording, page_text, plain_text, rendered_text, squash, tier_of, words,
)

SHINGLE = 5
NEAR = 0.8
_CITES = re.compile(r"(?:\[\^[^\]\s]+\][ \t]*)+")
_KEY = re.compile(r"\[\^([^\]\s]+)\]")
_PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_YEAR = re.compile(r"(?<![\d.,/-])(?<!دههٔ )(?<!دهه )(1[2-4]\d\d|1[89]\d\d|20\d\d)(?![\d]|s\b)")


# --- Passages against their sources ---------------------------------------------


class PageMatcher:
    """One fetched text, prepared for looking passages up in it."""

    def __init__(self, text, address=""):
        self.address = squash(address)
        readable, _, raw = text.partition("\n\x00\n")
        self.squashed = squash(readable)
        self.raw = squash(raw) if raw else ""
        tokens = words(readable)
        self.shingles = {tuple(tokens[i:i + SHINGLE]) for i in range(len(tokens) - SHINGLE + 1)}
        self.words = len(tokens)

    def match(self, quote):
        wanted = squash(quote)
        if not wanted:
            return None
        if self.address and wanted in self.address:
            return "found"
        if wanted in self.squashed or (self.raw and wanted in self.raw):
            return "found"
        tokens = words(quote)
        grams = [tuple(tokens[i:i + SHINGLE]) for i in range(len(tokens) - SHINGLE + 1)]
        if grams and sum(g in self.shingles for g in grams) / len(grams) >= NEAR:
            return "near"
        return None


def recheck_source(source, quotes, browser=True, refresh=False):
    """Look every quote up in one source. Returns {quote: status} and the page's word count.

    Status is found, near (four fifths of its wording is there), missing,
    unreachable, audio (a recording, which this check cannot hear) or offline.

    A fetch counts as the source only when it holds at least one passage of
    the capture file. Sites answer scripts with a consent or challenge page;
    without this, every quote from such a site would read as missing.
    """
    url = source.meta.get("url")
    if not url:
        return {q: "offline" for q in quotes}, 0
    left, out, reached, size = set(quotes), {}, False, 0
    fetches = [lambda: page_text(str(url), refresh)]
    if source.meta.get("archive"):
        fetches.append(lambda: page_text(str(source.meta["archive"]), refresh))
    if browser:
        fetches.append(lambda: rendered_text(str(url), refresh))
    for fetch in fetches:
        if not left:
            break
        text = fetch()
        if not text:
            continue
        matcher = PageMatcher(text, str(url))
        if not any(matcher.match(q) for q in list(quotes) + source.quotes):
            continue
        reached = True
        size = max(size, matcher.words)
        for quote in list(left):
            status = matcher.match(quote)
            if status:
                out[quote] = status
                left.discard(quote)
    for quote in left:
        if is_recording(source):
            out[quote] = "audio"
        else:
            out[quote] = "missing" if reached else "unreachable"
    return out, size


def check_passages(artist, deep=False, browser=True, refresh=False, offline=False):
    refs = [r for r in artist.references(deep) if r.source in artist.store.sources and r.quote]
    by_source = {}
    for ref in refs:
        by_source.setdefault(ref.source, {}).setdefault(ref.quote, []).append(ref.where)
    if offline:
        return "not checked (offline)", [], {"status": {}}

    def work(name):
        return name, recheck_source(artist.store.sources[name], list(by_source[name]), browser, refresh)

    status, sizes = {}, {}
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        for name, (result, size) in pool.map(work, sorted(by_source)):
            sizes[name] = size
            for quote, state in result.items():
                status[(name, quote)] = state

    counts = {}
    for state in status.values():
        counts[state] = counts.get(state, 0) + 1
    total = len(status)
    findings = []

    def listing(state):
        return [
            "%s: “%s” (%s)" % (name, _clip(quote), by_source[name][quote][0])
            for (name, quote), s in sorted(status.items()) if s == state
        ]

    if counts.get("missing"):
        findings.append(Finding(
            "block", "passages", "Quoted passages that are not on their source", listing("missing"),
        ))
    if counts.get("near"):
        findings.append(Finding(
            "fix", "passages", "Quoted passages whose wording differs from the source", listing("near"),
        ))
    unreachable = sorted({name for (name, _), s in status.items() if s == "unreachable"})
    if unreachable:
        level = "fix" if counts["unreachable"] > 0.1 * total else "note"
        findings.append(Finding(
            level, "passages",
            "Sources that could not be read from here (no answer, or a page without any captured passage); "
            "run the gate from a machine that reaches them, or open them by hand",
            unreachable,
        ))
    thin = sorted(
        name for name, size in sizes.items()
        if size > 1500 and len(artist.store.sources[name].quotes) < 3
        and tier_of(artist.store.sources[name]) in ("journalism", "academic", "own")
        and "wikipedia.org" not in str(artist.store.sources[name].meta.get("url"))
    )
    if thin:
        findings.append(Finding(
            "note", "reading depth", "Long sources (over 1,500 words) with fewer than three passages kept", thin,
        ))
    order = ("found", "near", "missing", "unreachable", "audio", "offline")
    labels = {"near": "wording differs", "missing": "not on source", "unreachable": "unread", "audio": "audio, not heard here"}
    line = "%d passages: %s" % (
        total, " · ".join("%d %s" % (counts[s], labels.get(s, s)) for s in order if counts.get(s)) or "none",
    )
    if gate_common.NO_BROWSER:
        line += " · no browser: install Playwright in site/ or pass --no-browser"
    return line, findings, {"status": status, "counts": counts}


def _clip(text, length=110):
    text = " ".join(text.split())
    return text if len(text) <= length else text[:length - 1] + "…"


# --- Claims: the prose a citation carries ----------------------------------------


class Claim:
    """A stretch of an article and the footnotes that follow it."""

    def __init__(self, text, keys, section):
        self.text = " ".join(text.split())
        self.keys = keys
        self.section = section


def claims_of(body):
    """Split an article into claims, and list prose that no footnote follows."""
    claims, uncited, section = [], [], ""
    for block in re.split(r"\n\s*\n", body):
        block = block.strip()
        if not block:
            continue
        if block.startswith("#"):
            section = block.lstrip("#").strip()
            continue
        position = 0
        for match in _CITES.finditer(block):
            text = plain_text(block[position:match.start()]).strip()
            if text:
                claims.append(Claim(text, _KEY.findall(match.group(0)), section))
            elif claims:
                claims[-1].keys += _KEY.findall(match.group(0))
            position = match.end()
        tail = plain_text(block[position:]).strip(" .،؛:»”\"")
        if len(tail.split()) > 6:
            uncited.append(_clip(tail, 140))
    return claims, uncited


def years_in(text):
    return {int(y) for y in _YEAR.findall(text.translate(_PERSIAN_DIGITS))}


def _allowed_years(evidence):
    """Years the evidence gives, with the other calendar's reading of each."""
    text = evidence.translate(_PERSIAN_DIGITS)
    found = set(years_in(text))
    # Persian sources often write a Solar Hijri year with two digits.
    found |= {1300 + int(y) for y in re.findall(r"(?<![\d])([3-9]\d)(?![\d])", text)}
    out = set()
    for y in found:
        out |= {y, y + 621, y + 622, y - 621, y - 622}
    return out


def check_years(artist):
    """Years in an article that none of the stretch's cited passages give.

    Returns the claims of each language and the strays as {(language, n): (row,
    where)}; `where` is "source" when the cited source's capture gives the year
    in another passage, else "nowhere". gate.py turns them into findings once it
    knows what the verifier said about each claim.
    """
    findings, claims_by_language, strays = [], {}, {}
    for language in ("en", "fa"):
        article = artist.articles.get(language)
        if article is None:
            continue
        refs = artist.article_references(language)
        claims, uncited = claims_of(article.body)
        claims_by_language[language] = claims
        for number, claim in enumerate(claims, 1):
            evidence, files = [], []
            for key in claim.keys:
                ref = refs.get(key)
                if ref is None:
                    continue
                source = artist.store.sources.get(ref.source)
                evidence.append(ref.quote)
                if source is not None:
                    evidence += [str(source.meta.get(k) or "") for k in ("issued", "title", "url")]
                    files.append(source.body)
            missing = sorted(years_in(claim.text) - _allowed_years(" ".join(evidence)))
            if not missing:
                continue
            row = "%s %d, %s: %s — “%s”" % (
                language, number, ", ".join(map(str, missing)),
                " ".join("[^%s]" % k for k in claim.keys), _clip(claim.text),
            )
            where = "source" if set(missing) <= _allowed_years(" ".join(files)) else "nowhere"
            strays[(language, number)] = (row, where)
        if uncited:
            findings.append(Finding(
                "fix", "uncited", "Prose in the %s article with no footnote after it" % language, uncited,
            ))
    total = sum(len(c) for c in claims_by_language.values())
    nowhere = sum(1 for _, where in strays.values() if where == "nowhere")
    line = "%d cited stretches · %d with a year their sources don't give" % (total, nowhere)
    return line, findings, {"claims": claims_by_language, "strays": strays}


def year_findings(strays, votes):
    """Findings for stray years, given the verifier's votes per (language, n)."""
    unsettled, accepted, misplaced = [], [], []
    for key, (row, where) in sorted(strays.items()):
        cast = votes.get(key) or []
        if where == "source":
            misplaced.append(row)
        elif cast and all(v == "supported" for v in cast):
            accepted.append(row)
        else:
            unsettled.append(row)
    out = []
    if unsettled:
        out.append(Finding(
            "fix", "years",
            "Years that the cited sources don't give; correct them, cite where they come from, "
            "or let the verifier confirm them", unsettled,
        ))
    if misplaced:
        out.append(Finding(
            "note", "years", "Years given by the cited source, but not by the cited passage", misplaced,
        ))
    if accepted:
        out.append(Finding(
            "note", "years", "Years not written in the passages that the verifier accepted", accepted,
        ))
    return out


def spot_audit(artist, claims, count=5, seed=None):
    """A few random claims with their passages and a link that opens the source there."""
    refs = artist.article_references("en")
    pool = [c for c in claims if any(k in refs for k in c.keys)]
    rng = random.Random(seed)
    out = []
    for claim in rng.sample(pool, min(count, len(pool))):
        lines = ["- “%s”" % _clip(claim.text, 240)]
        for key in claim.keys:
            ref = refs.get(key)
            source = artist.store.sources.get(ref.source) if ref else None
            if source is None:
                continue
            url = str(source.meta.get("url") or "")
            first = " ".join(ref.quote.split()[:8])
            link = url + "#:~:text=" + urllib.parse.quote(first) if url else ref.source
            lines.append("    - passage: “%s” ([source](%s))" % (_clip(ref.quote, 240), link))
        out.append("\n".join(lines))
    return out
