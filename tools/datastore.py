"""Shared code for the data store tools: paths, loading, dates, schemas.

The format is defined in data/README.md. This module only reads.
"""

import calendar
import datetime
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

import yaml

REPO = Path(__file__).resolve().parent.parent
DEFAULT_ROOT = REPO / "data"
SCHEMA_DIR = REPO / "data" / "schema"
SPEC = REPO / "specs" / "data-framework.md"

ID_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz"
ID_LENGTH = 6
ITEM_PREFIX = "Q"
SOURCE_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]*$")

SPECIAL_VALUES = ("unknown value", "no value")
CALENDARS = ("gregorian", "jalali")
DEFAULT_CALENDAR = "gregorian"

SCHEMA_FILES = ("item.schema.json", "source.schema.json", "article.schema.json")

ARTICLE_NAME = re.compile(
    r"^(%s[%s]{%d})\.([a-z]{2,3}(?:-[A-Za-z0-9]{1,8})*)$" % (ITEM_PREFIX, ID_ALPHABET, ID_LENGTH)
)
CITATION = re.compile(r"\[\^([^\]\s]+)\]")


class DataError(Exception):
    """A problem that stops a tool from going on."""


# --- Records -----------------------------------------------------------------


class Source:
    """One capture file: its front matter, body and the quoted passages."""

    def __init__(self, path, meta, body):
        self.path = path
        self.name = path.stem
        self.meta = meta
        self.body = body
        self.quotes = [normalize(q) for q in blockquotes(body)]

    def has_quote(self, text):
        """Whether `text`, whitespace collapsed, sits inside one blockquote."""
        wanted = normalize(text)
        return bool(wanted) and any(wanted in q for q in self.quotes)


class Item:
    """One published item file."""

    def __init__(self, path, data):
        self.path = path
        self.data = data

    @property
    def id(self):
        return self.data.get("id") if isinstance(self.data, dict) else None


class Article:
    """One article file: its front matter, body and the keys it cites.

    `item` and `language` come from a file name of the form <ID>.<lang>.md,
    and are None when the name has another form.
    """

    def __init__(self, path, meta, body):
        self.path = path
        self.meta = meta
        self.body = body
        match = ARTICLE_NAME.match(path.name[:-len(".md")])
        self.item, self.language = match.groups() if match else (None, None)
        self.citations = CITATION.findall(body)


class Store:
    """Everything under <root>/capture/sources and <root>/published.

    `problems` lists files that could not be read or whose identity is
    missing or duplicated; those are left out of `sources` and `items`.
    """

    def __init__(self, root):
        self.root = Path(root)
        self.sources = {}
        self.items = {}
        self.articles = {}
        self.unrefined = {}
        self.problems = []

    def rel(self, path):
        return str(Path(path).relative_to(self.root.parent))


def load_store(root):
    root = Path(root)
    store = Store(root)
    for path in sorted((root / "capture" / "sources").glob("*.md")):
        try:
            meta, body = read_markdown(path)
        except Exception as exc:
            store.problems.append("%s: cannot read: %s" % (store.rel(path), _one_line(exc)))
            continue
        store.sources[path.stem] = Source(path, meta, body)
    for path in sorted((root / "published" / "items").glob("*/*.yaml")):
        try:
            data = load_yaml(path)
        except Exception as exc:
            store.problems.append("%s: cannot read: %s" % (store.rel(path), _one_line(exc)))
            continue
        item = Item(path, data)
        if not isinstance(data, dict) or not isinstance(item.id, str):
            store.problems.append("%s: not an item with an `id`" % store.rel(path))
            continue
        if item.id in store.items:
            store.problems.append(
                "%s: duplicate id %s, also in %s"
                % (store.rel(path), item.id, store.rel(store.items[item.id].path))
            )
            continue
        store.items[item.id] = item
    for path in sorted((root / "published" / "articles").glob("*.md")):
        try:
            meta, body = read_markdown(path)
        except Exception as exc:
            store.problems.append("%s: cannot read: %s" % (store.rel(path), _one_line(exc)))
            continue
        store.articles[path.name] = Article(path, meta, body)
    unrefined = root / "published" / "unrefined.yaml"
    if unrefined.exists():
        try:
            data = load_yaml(unrefined)
        except Exception as exc:
            store.problems.append("%s: cannot read: %s" % (store.rel(unrefined), _one_line(exc)))
        else:
            if data is None:
                data = {}
            if isinstance(data, dict):
                store.unrefined = data
            else:
                store.problems.append("%s: must map item IDs to names" % store.rel(unrefined))
    return store


def _one_line(exc):
    if isinstance(exc, yaml.MarkedYAMLError) and exc.problem_mark is not None:
        return yaml_problem(exc)
    return " ".join(str(exc).split())


def yaml_problem(exc, line_offset=0):
    """A YAML error as `problem (line N)`, N counted in the file."""
    line = exc.problem_mark.line + 1 + line_offset
    return "%s (line %d)" % (" ".join(str(exc.problem).split()), line)


# --- Markdown ------------------------------------------------------------------


def read_markdown(path):
    """(front matter, body) of a capture or article file. Raises on missing front matter."""
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        raise DataError("no front matter: the file must start with a `---` line")
    for n in range(1, len(lines)):
        if lines[n].strip() == "---":
            try:
                meta = parse_yaml("\n".join(lines[1:n])) or {}
            except yaml.MarkedYAMLError as exc:
                raise DataError("front matter: " + yaml_problem(exc, line_offset=1))
            if not isinstance(meta, dict):
                raise DataError("front matter is not a map of keys to values")
            return _stringify_dates(meta, None), "\n".join(lines[n + 1:])
    raise DataError("front matter is not closed by a second `---` line")


_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_QUOTE_LINE = re.compile(r"^ {0,3}>(.*)$")


def blockquotes(body):
    """The passages quoted in a Markdown body.

    A passage is a run of lines that each start with `>`, after up to three
    spaces as Markdown allows. Lines inside a fenced code block (``` or ~~~)
    are code, not quotes, even when they start with `>`. A line without `>`
    is never part of a quote, not even directly after one: Markdown would
    read it as a continuation, but here it is the researcher talking.
    """
    quotes, current, fence = [], [], None
    for line in body.split("\n"):
        fence_match = _FENCE.match(line)
        if fence is not None:
            if (
                fence_match
                and fence_match.group(1)[0] == fence[0]
                and len(fence_match.group(1)) >= len(fence)
                and not fence_match.group(2).strip()
            ):
                fence = None
            continue
        if fence_match and not (fence_match.group(1)[0] == "`" and "`" in fence_match.group(2)):
            fence = fence_match.group(1)
            if current:
                quotes.append("\n".join(current))
                current = []
            continue
        quote_match = _QUOTE_LINE.match(line)
        if quote_match:
            current.append(quote_match.group(1).strip())
        elif current:
            quotes.append("\n".join(current))
            current = []
    if current:
        quotes.append("\n".join(current))
    return quotes


def normalize(text):
    return " ".join(text.split())


# --- YAML ----------------------------------------------------------------------


class _Loader(yaml.SafeLoader):
    """A SafeLoader that refuses a mapping with the same key twice.

    PyYAML keeps the last of two equal keys and drops the first without a
    word, which would silently lose every statement under a repeated
    property.
    """

    def construct_mapping(self, node, deep=False):
        seen = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            try:
                hash(key)
            except TypeError:
                continue  # SafeLoader reports an unhashable key itself
            if key in seen:
                raise yaml.constructor.ConstructorError(
                    "while reading a mapping", node.start_mark,
                    "found the key %r twice" % (key,), key_node.start_mark,
                )
            seen.add(key)
        return super().construct_mapping(node, deep)


def parse_yaml(stream):
    """yaml.safe_load, except that a repeated key is an error."""
    return yaml.load(stream, Loader=_Loader)


def load_yaml(path):
    """Read one YAML file and give dates back as strings.

    PyYAML turns an unquoted `2004-11-17` into a date object. Under the keys
    that hold dates it is turned back into the text it was, so that the
    schemas see strings. Everything else is left as parsed.
    """
    with open(path, encoding="utf-8") as fh:
        data = parse_yaml(fh)
    return _stringify_dates(data, None)


_DATE_KEYS = {"date", "accessed"}


def _stringify_dates(node, key):
    if isinstance(node, dict):
        return {k: _stringify_dates(v, k) for k, v in node.items()}
    if isinstance(node, list):
        return [_stringify_dates(v, key) for v in node]
    if key in _DATE_KEYS:
        if isinstance(node, datetime.datetime):
            return node.date().isoformat()
        if isinstance(node, datetime.date):
            return node.isoformat()
        if isinstance(node, int) and not isinstance(node, bool):
            return "%04d" % node
    return node


# --- Registry and spec ----------------------------------------------------------


def load_registry():
    with open(SCHEMA_DIR / "properties.yaml", encoding="utf-8") as fh:
        return parse_yaml(fh)


def spec_property_names():
    """The backticked names in the spec's property and qualifier tables."""
    properties, qualifiers = [], []
    target = None
    with open(SPEC, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("| Property |"):
                target = properties
            elif line.startswith("| Qualifier |"):
                target = qualifiers
            match = re.match(r"^\| `([^`]+)` \|", line)
            if match and target is not None:
                target.append(match.group(1))
    return properties, qualifiers


# --- Schemas ------------------------------------------------------------------------


def load_schemas():
    schemas = {}
    for name in SCHEMA_FILES:
        with open(SCHEMA_DIR / name, encoding="utf-8") as fh:
            schemas[name] = json.load(fh)
    return schemas


def schema_validator(schemas, name):
    """A Draft 2020-12 validator for one schema file."""
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource

    registry = Registry().with_resources(
        (n, Resource.from_contents(s)) for n, s in schemas.items()
    )
    return Draft202012Validator(schemas[name], registry=registry)


def schema_errors(validator, data):
    """Schema errors as (json path, message), one per failing place."""
    found = []
    for err in validator.iter_errors(data):
        found.append((err.json_path, _describe(err)))
    return sorted(set(found))


def _describe(err):
    """A readable message for one schema error."""
    if err.validator == "oneOf" and not err.path and "merged into" in err.schema.get("properties", {}):
        return "an item has either `statements` or `merged into`, not both and not neither"
    while err.context:
        err = max(err.context, key=lambda e: (len(e.absolute_path), -len(e.message)))
    if err.validator == "pattern" and err.schema.get("description"):
        return "%r is not %s" % (err.instance, err.schema["description"])
    if len(err.message) > 200:
        return "does not satisfy `%s` (%s)" % (err.validator, json.dumps(err.validator_value)[:80])
    return err.message


# --- Dates ------------------------------------------------------------------------------

_EDTF_ONE = re.compile(
    r"^(?P<year>[0-9]{4}|[0-9]{3}X)(?:-(?P<month>[0-9]{2})(?:-(?P<day>[0-9]{2}))?)?(?P<qual>[~?%])?$"
)


def date_range(text, calendar_name=DEFAULT_CALENDAR):
    """The Gregorian (first day, last day) a date string covers.

    Raises ValueError when the text is not in the supported EDTF subset or
    names a day that does not exist in the calendar.
    """
    if calendar_name not in CALENDARS:
        raise ValueError("unknown calendar %r" % calendar_name)
    parts = text.split("/")
    if len(parts) > 2 or not all(parts):
        raise ValueError("not a date or an interval: %r" % text)
    ranges = [_one_range(part, calendar_name) for part in parts]
    start, end = ranges[0][0], ranges[-1][1]
    if start > end:
        raise ValueError("interval ends before it starts: %r" % text)
    return start, end


def _one_range(text, calendar_name):
    match = _EDTF_ONE.match(text)
    if not match:
        raise ValueError("not a date: %r" % text)
    year, month, day = match.group("year"), match.group("month"), match.group("day")
    to_date = jalali_to_gregorian if calendar_name == "jalali" else _gregorian
    if year.endswith("X"):
        if month:
            raise ValueError("a decade takes no month: %r" % text)
        first = int(year[:3]) * 10
        return _year_range(first, calendar_name)[0], _year_range(first + 9, calendar_name)[1]
    y = int(year)
    if month is None:
        return _year_range(y, calendar_name)
    m = int(month)
    if not 1 <= m <= 12:
        raise ValueError("month out of range: %r" % text)
    if day is None:
        return to_date(y, m, 1), to_date(y, m, _month_length(y, m, calendar_name))
    d = int(day)
    if not 1 <= d <= _month_length(y, m, calendar_name):
        raise ValueError("day out of range: %r" % text)
    return to_date(y, m, d), to_date(y, m, d)


def _year_range(y, calendar_name):
    if calendar_name == "jalali":
        return jalali_to_gregorian(y, 1, 1), jalali_to_gregorian(y, 12, _month_length(y, 12, "jalali"))
    return _gregorian(y, 1, 1), _gregorian(y, 12, 31)


def _month_length(y, m, calendar_name):
    if calendar_name == "jalali":
        return jalali_month_length(y, m)
    return calendar.monthrange(y, m)[1]


def _gregorian(y, m, d):
    try:
        return datetime.date(y, m, d)
    except ValueError as exc:
        raise ValueError("%04d-%02d-%02d: %s" % (y, m, d, exc))


def iso_date(text):
    """A YYYY-MM-DD string as a date, or ValueError."""
    return datetime.date.fromisoformat(text)


# Jalali (Solar Hijri) calendar, after the algorithm in jalaali-js, which
# follows the astronomical breaks rather than a fixed 33-year cycle.

_JALALI_BREAKS = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
    2192, 2262, 2324, 2394, 2456, 3178,
]


def _jalali_calendar(jy):
    """(leap offset, Gregorian year of Nowruz, March day of Nowruz)."""
    if not _JALALI_BREAKS[0] <= jy < _JALALI_BREAKS[-1]:
        raise ValueError("Jalali year out of range: %d" % jy)
    gy = jy + 621
    leap_j = -14
    jp = _JALALI_BREAKS[0]
    jump = 0
    for jm in _JALALI_BREAKS[1:]:
        jump = jm - jp
        if jy < jm:
            break
        leap_j += (jump // 33) * 8 + (jump % 33) // 4
        jp = jm
    n = jy - jp
    leap_j += (n // 33) * 8 + ((n % 33) + 3) // 4
    if jump % 33 == 4 and jump - n == 4:
        leap_j += 1
    leap_g = gy // 4 - ((gy // 100 + 1) * 3) // 4 - 150
    march = 20 + leap_j - leap_g
    if jump - n < 6:
        n = n - jump + ((jump + 4) // 33) * 33
    leap = (n + 1) % 33 - 1
    leap = 4 if leap == -1 else leap % 4
    return leap, gy, march


def jalali_is_leap(jy):
    return _jalali_calendar(jy)[0] == 0


def jalali_month_length(jy, jm):
    if not 1 <= jm <= 12:
        raise ValueError("Jalali month out of range: %d" % jm)
    if jm <= 6:
        return 31
    if jm <= 11:
        return 30
    return 30 if jalali_is_leap(jy) else 29


def jalali_to_gregorian(jy, jm, jd):
    if not 1 <= jd <= jalali_month_length(jy, jm):
        raise ValueError("Jalali day out of range: %d-%02d-%02d" % (jy, jm, jd))
    _, gy, march = _jalali_calendar(jy)
    nowruz = datetime.date(gy, 3, march)
    offset = (jm - 1) * 31 - (jm // 7) * (jm - 7) + jd - 1
    return nowruz + datetime.timedelta(days=offset)


# --- Values ------------------------------------------------------------------------------


def value_kind(value):
    """Which kind of value this is by its shape, or None when it is none."""
    if isinstance(value, str):
        if value in SPECIAL_VALUES:
            return "special"
        if re.match(r"^%s[%s]{%d}$" % (ITEM_PREFIX, ID_ALPHABET, ID_LENGTH), value):
            return "item"
        if re.match(r"^https?://", value):
            return "url"
        if re.match(r"^[a-z]+( [a-z]+)*$", value):
            return "term"
        return None
    if isinstance(value, dict):
        if set(value) == {"text", "language"}:
            return "text"
        if set(value) <= {"date", "calendar"} and "date" in value:
            return "date"
    return None


def as_list(value):
    return value if isinstance(value, list) else [value]


def url_host(url):
    """The lowercased host of an http(s) URL, or "" when it has none.

    Parsed properly, so user information or a port before the host
    (`https://youtube.com:443@evil.example/`) cannot pass for the host.
    """
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    if parts.scheme not in ("http", "https"):
        return ""
    return parts.hostname or ""


def host_allowed(host, allowed):
    return any(host == a or host.endswith("." + a) for a in allowed)
