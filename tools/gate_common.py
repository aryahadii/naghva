"""Shared pieces of the enrichment gate: one artist's slice of the store,
platform names, and fetching pages with a cache.

The gate only reads. Its checks are in gate_record.py, gate_quotes.py,
gate_article.py and gate_models.py; gate.py runs them and prints a scorecard.
"""

import hashlib
import html
import json
import os
import re
import subprocess
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import datastore as ds

# The listen platforms and their hosts are the registry's `platforms`; the
# gate names them as the site does.
REGISTRY = ds.load_registry()
_LABELS = json.loads((ds.REPO / "site" / "src" / "strings" / "en.json").read_text(encoding="utf-8"))["platforms"]
PLATFORM_NAMES = [_LABELS.get(key, key) for key in REGISTRY["platforms"]]

# The closed list of source tiers in the source schema.
TIERS = tuple(ds.load_schemas()["source.schema.json"]["properties"]["tier"]["enum"])
AUDIO_KINDS = ("youtube video", "podcast episode", "interview", "video", "audio", "audio recording", "music video")
AUDIO_HOSTS = ("youtube.com", "youtu.be", "castbox.fm", "podcasts.apple.com", "aparat.com")


def tier_of(source):
    """A source's tier; one with none counts as other."""
    tier = source.meta.get("tier")
    return tier if tier in TIERS else "other"


def is_recording(source):
    """Whether a source is heard or watched, so its passages may be transcriptions."""
    if str(source.meta.get("kind") or "").strip().lower() in AUDIO_KINDS:
        return True
    return ds.host_allowed(ds.url_host(str(source.meta.get("url") or "")), AUDIO_HOSTS)

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CACHE = Path(os.environ.get("NAGHVA_GATE_CACHE", Path.home() / ".cache" / "naghva-gate"))
RENDER_SCRIPT = Path(__file__).resolve().parent / "gate_render.mjs"
NO_BROWSER = []  # set when the render script finds no Playwright


def platform_of(url):
    """The name of the listen platform a URL is on, or None."""
    key = ds.platform_of(url, REGISTRY)
    return _LABELS.get(key, key) if key else None


def kept(statements):
    """Statements a reader is shown: the preferred ones if any, else all but deprecated."""
    statements = [s for s in statements or [] if isinstance(s, dict)]
    preferred = [s for s in statements if s.get("rank") == "preferred"]
    return preferred or [s for s in statements if s.get("rank") != "deprecated"]


def statements(item, prop):
    return kept((item.data.get("statements") or {}).get(prop))


def item_value(statement):
    value = statement.get("value")
    return value.get("item") if isinstance(value, dict) else value


def url_value(statement):
    value = statement.get("value")
    return value.get("url") if isinstance(value, dict) else value


def name_of(item, language="en"):
    names = statements(item, "name")
    for s in names:
        value = s.get("value")
        if isinstance(value, dict) and value.get("language") == language:
            return value.get("text")
    for s in names:
        value = s.get("value")
        if isinstance(value, dict) and value.get("text"):
            return value["text"]
    return item.id


class Finding:
    """One thing the gate has to say. `level` is block, fix or note."""

    def __init__(self, level, check, text, items=()):
        self.level = level
        self.check = check
        self.text = text
        self.items = list(items)


class Reference:
    """One cited passage: where it is cited from, and what it cites."""

    def __init__(self, where, source, quote):
        self.where = where
        self.source = source
        self.quote = quote or ""


class Artist:
    """An artist's item, both articles, releases and every reference they carry."""

    def __init__(self, store, item):
        self.store = store
        self.item = item
        self.id = item.id
        self.name = name_of(item)
        self.articles = {
            lang: store.articles.get("%s.%s.md" % (item.id, lang)) for lang in ("en", "fa")
        }
        self.releases = [
            other for other in store.items.values()
            if other.data.get("type") == "release" and "merged into" not in other.data
            and any(item_value(s) == item.id for s in statements(other, "performer"))
        ]
        self.acts = [
            store.items[item_value(s)] for s in statements(item, "member of")
            if item_value(s) in store.items
        ]

    def article_references(self, language):
        article = self.articles.get(language)
        refs = (article.meta.get("references") or {}) if article else {}
        return {
            key: Reference("%s article [^%s]" % (language, key), ref.get("source"), ref.get("quote"))
            for key, ref in refs.items() if isinstance(ref, dict)
        }

    def item_references(self, item=None):
        item = item or self.item
        out = []
        for prop, sts in (item.data.get("statements") or {}).items():
            for s in sts or []:
                if not isinstance(s, dict) or s.get("rank") == "deprecated":
                    continue
                for ref in s.get("references") or []:
                    out.append(Reference("%s %s" % (item.id, prop), ref.get("source"), ref.get("quote")))
        return out

    def references(self, deep=False):
        """Every reference of the artist: articles and own item; releases too when `deep`."""
        out = list(self.article_references("en").values())
        out += list(self.article_references("fa").values())
        out += self.item_references()
        if deep:
            for release in self.releases:
                out += self.item_references(release)
        return out

    def cited_sources(self, deep=False):
        names = {r.source for r in self.references(deep) if r.source}
        return [self.store.sources[n] for n in sorted(names) if n in self.store.sources]

    def is_enriched(self):
        article = self.articles.get("en")
        return bool(statements(self.item, "life event")) or (
            article is not None and len(plain_text(article.body).split()) >= 300
        )


def find_artists(store, wanted):
    """Items with an article, matched by ID or by a name in either language."""
    with_article = {a.item for a in store.articles.values() if a.item in store.items}
    out = []
    for word in wanted:
        hit = None
        if word in with_article:
            hit = store.items[word]
        else:
            folded = word.casefold()
            for item_id in sorted(with_article):
                names = [
                    (s.get("value") or {}).get("text", "") for s in statements(store.items[item_id], "name")
                    if isinstance(s.get("value"), dict)
                ]
                if any(folded == n.casefold() for n in names):
                    hit = store.items[item_id]
                    break
        if hit is None:
            raise ds.DataError("no artist with an article matches %r" % word)
        out.append(Artist(store, hit))
    return out


def changed_artists(store, base):
    """Artists a branch touches, compared with `base`: their article, item or a release."""
    out = subprocess.run(
        ["git", "-C", str(ds.REPO), "diff", "--name-only", "%s...HEAD" % base, "--", "data/published"],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    with_article = {a.item for a in store.articles.values() if a.item in store.items}
    touched = set()
    for path in out:
        stem = Path(path).name.split(".")[0]
        if stem in with_article:
            touched.add(stem)
        item = store.items.get(stem)
        if item is not None and item.data.get("type") == "release":
            touched.update(
                item_value(s) for s in statements(item, "performer") if item_value(s) in with_article
            )
    return [Artist(store, store.items[i]) for i in sorted(touched)]


# --- Text ----------------------------------------------------------------------

_CITE = re.compile(r"\[\^[^\]\s]+\]")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")


def plain_text(markdown):
    """Article prose without headings, citations or link targets."""
    lines = [line for line in markdown.split("\n") if not line.startswith("#")]
    text = _CITE.sub("", "\n".join(lines))
    return _LINK.sub(r"\1", text)


def squash(text):
    """Text reduced to its letters and digits, so layout and typography don't matter."""
    text = unicodedata.normalize("NFKC", text)
    for a, b in (("‌", ""), ("‍", ""), ("ي", "ی"), ("ك", "ک"), ("ۀ", "ه"), ("ة", "ه")):
        text = text.replace(a, b)
    return re.sub(r"[\W_]+", "", text).lower()


def words(text):
    text = unicodedata.normalize("NFKC", text).replace("‌", "").replace("ي", "ی").replace("ك", "ک")
    return re.findall(r"\w+", text.lower())


# --- Fetching ------------------------------------------------------------------


def _cache_path(kind, url):
    return CACHE / kind / (hashlib.sha256(url.encode()).hexdigest()[:24] + ".txt")


def _cached(kind, url, make, refresh):
    path = _cache_path(kind, url)
    if path.exists() and not refresh:
        text = path.read_text(encoding="utf-8")
        if text:
            return text
    text = make()
    if text:
        # A failure is not kept, so the next run tries the page again.
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return text


def pdf_text(raw):
    """The text of a PDF, by pdftotext; None when the tool is missing or fails."""
    try:
        run = subprocess.run(["pdftotext", "-", "-"], input=raw, capture_output=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return run.stdout.decode("utf-8", "replace") if run.returncode == 0 else None


def http_get(url, timeout=25, headers=None):
    """The body of `url` as text, or None when it can't be had. A PDF comes back as its text."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(30_000_000)
            charset = response.headers.get_content_charset() or "utf-8"
    except (urllib.error.URLError, OSError, ValueError):
        return None
    if raw[:5] == b"%PDF-":
        text = pdf_text(raw)
        return "<pre>%s</pre>" % html.escape(text) if text else None
    try:
        return raw.decode(charset, "replace")
    except LookupError:
        return raw.decode("utf-8", "replace")


def http_json(url, timeout=25, headers=None, data=None):
    request = urllib.request.Request(
        url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError, ValueError):
        return None


def html_text(markup):
    markup = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", markup)
    # JSON-LD and page state often hold the text of pages drawn by scripts.
    return html.unescape(re.sub(r"(?s)<[^>]+>", " ", markup))


def page_text(url, refresh=False):
    """The readable text of a page, fetched plainly. None when unreachable."""

    def make():
        target = url
        if platform_of(url) == "Telegram" and re.search(r"/\d+/?$", urllib.parse.urlsplit(url).path):
            target = url.split("?")[0] + "?embed=1&mode=tme"
        body = http_get(target)
        if body is None or len(body) < 500:
            return None
        # Keep script contents too: they are matched only as a second chance.
        return html_text(body) + "\n\x00\n" + html.unescape(body)

    return _cached("plain", url, make, refresh)


def rendered_text(url, refresh=False):
    """The text a browser shows for a page. None when no browser or no page."""

    def make():
        try:
            run = subprocess.run(
                ["node", str(RENDER_SCRIPT), url], capture_output=True, text=True, timeout=90,
                cwd=str(ds.REPO / "site"),
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        if run.returncode == 2:
            NO_BROWSER.append(url)
        return run.stdout if run.returncode == 0 and len(run.stdout) > 200 else None

    return _cached("rendered", url, make, refresh)
