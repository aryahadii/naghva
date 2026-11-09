#!/usr/bin/env python3
"""Check a data root against the format in data/README.md.

    python3 tools/validate.py [--root data]

Exits 1 when anything is wrong. Warnings do not fail the run.
"""

import argparse
import datetime
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import datastore as ds  # noqa: E402

VALUE_KINDS = ("item", "text", "date", "url", "term")
SUSPICIOUS_YEAR = 1500  # a bare year below this with no calendar is probably Jalali


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, where, message):
        self.errors.append("%s: %s" % (where, message))

    def warn(self, where, message):
        self.warnings.append("%s: %s" % (where, message))


# --- Registry ------------------------------------------------------------------------


def check_registry(registry, report):
    where = "data/schema/properties.yaml"
    types = registry.get("types") or []
    props = registry.get("properties") or {}
    quals = registry.get("qualifiers") or {}
    terms = registry.get("terms") or {}

    spec_props, spec_quals = ds.spec_property_names()
    spec_props = [p for p in spec_props if p != "type"]
    _compare_names(where, "property", set(props), set(spec_props), report)
    _compare_names(where, "qualifier", set(quals), set(spec_quals), report)

    for name, spec in props.items():
        here = "%s: property `%s`" % (where, name)
        on = spec.get("used on")
        if on != "any" and not (isinstance(on, list) and on and set(on) <= set(types)):
            report.error(here, "`used on` must be `any` or a list of item types")
        _check_value_spec(here, spec, types, terms, name, report)
        for q in spec.get("qualifiers") or []:
            if q not in quals:
                report.error(here, "allows unknown qualifier `%s`" % q)
        for q in spec.get("requires") or []:
            if q not in (spec.get("qualifiers") or []):
                report.error(here, "requires `%s`, which it does not allow" % q)
        if spec.get("excerpt") and spec.get("value") != "text":
            report.error(here, "`excerpt` only applies to text values")
    for name, spec in quals.items():
        here = "%s: qualifier `%s`" % (where, name)
        _check_value_spec(here, spec, types, terms, name, report)


def _compare_names(where, what, registry_names, spec_names, report):
    for name in sorted(spec_names - registry_names):
        report.error(where, "%s `%s` is in the spec but not in the registry" % (what, name))
    for name in sorted(registry_names - spec_names):
        report.error(where, "%s `%s` is in the registry but not in the spec" % (what, name))


def _check_value_spec(here, spec, types, terms, name, report):
    kind = spec.get("value")
    if kind not in VALUE_KINDS:
        report.error(here, "`value` must be one of %s" % ", ".join(VALUE_KINDS))
        return
    if kind == "item":
        item_types = spec.get("item type")
        if not (isinstance(item_types, list) and item_types and set(item_types) <= set(types)):
            report.error(here, "an item value needs `item type`, a list of item types")
    elif "item type" in spec:
        report.error(here, "`item type` only applies to item values")
    if kind == "term" and not terms.get(name):
        report.error(here, "a term value needs a list under `terms`")
    if kind != "url" and "hosts" in spec:
        report.error(here, "`hosts` only applies to url values")


# --- Capture ------------------------------------------------------------------------------


def check_source(source, store, report):
    where = store.rel(source.path)
    meta = source.meta
    if not ds.SOURCE_NAME.match(source.name):
        report.error(where, "file name may use only lowercase letters, digits, '.', '_' and '-'")

    parent = meta.get("part of")
    if parent is not None:
        if parent == source.name:
            report.error(where, "`part of` points at itself")
        elif parent not in store.sources:
            report.error(where, "`part of` refers to unknown source %s" % parent)

    if "issued" in meta:
        _check_date(where + ": issued", meta["issued"], report)

    if meta.get("status") == "processed" and not source.quotes:
        report.warn(where, "processed but holds no blockquote, so nothing in it can be cited")


def check_source_urls(store, report):
    seen = {}
    for source in store.sources.values():
        url = source.meta.get("url")
        if not isinstance(url, str):
            continue
        key = url.rstrip("/")
        if key in seen:
            report.warn(store.rel(source.path), "same url as %s" % store.rel(seen[key].path))
        else:
            seen[key] = source


# --- Published ----------------------------------------------------------------------------


def check_item(item, store, registry, report):
    where = store.rel(item.path)
    data = item.data
    if item.path.name != data["id"] + ".yaml":
        report.error(where, "file name does not match id %s" % data["id"])
    if item.path.parent.name != data["type"]:
        report.error(where, "directory does not match type %s" % data["type"])

    if "merged into" in data:
        _check_merge(where, data, store, report)
        return

    props = registry["properties"]
    if "name" not in data["statements"]:
        report.warn(where, "has no `name` statement, so the site has nothing to show for it")
    for prop, statements in data["statements"].items():
        here = "%s: %s" % (where, prop)
        spec = props.get(prop)
        if spec is None:
            report.error(here, "unknown property; see data/schema/properties.yaml")
            continue
        if spec["used on"] != "any" and data["type"] not in spec["used on"]:
            report.error(here, "not used on a %s" % data["type"])
        for n, st in enumerate(statements, 1):
            _check_statement("%s[%d]" % (here, n), st, spec, prop, store, registry, report)


def _check_merge(where, data, store, report):
    target = store.items.get(data["merged into"])
    if target is None:
        report.error(where, "`merged into` refers to unknown item %s" % data["merged into"])
    elif "merged into" in target.data:
        report.error(where, "`merged into` points at %s, itself merged; point at the survivor" % target.id)
    elif target.data.get("type") != data["type"]:
        report.warn(where, "merged into a %s" % target.data.get("type"))


def _check_statement(where, st, spec, prop, store, registry, report):
    _check_value(where, st["value"], spec, prop, store, registry, report)
    if st.get("editorial") and prop != "name":
        report.error(where, "only a `name` can be an editorial display spelling")

    allowed = spec.get("qualifiers") or []
    present = st.get("qualifiers") or {}
    for q in spec.get("requires") or []:
        if not present.get(q):
            report.error(where, "needs a `%s` qualifier" % q)
    for q, values in present.items():
        here = "%s: qualifier %s" % (where, q)
        if q not in allowed:
            report.error(here, "not allowed on `%s`" % prop)
            continue
        qspec = registry["qualifiers"][q]
        for v in ds.as_list(values):
            _check_value(here, v, qspec, q, store, registry, report)

    for n, ref in enumerate(st["references"], 1):
        _check_reference("%s: reference %d" % (where, n), ref, store, report)
        if spec.get("excerpt") and ds.value_kind(st["value"]) == "text":
            _check_excerpt("%s: reference %d" % (where, n), st["value"]["text"], ref, store, report)


def _check_excerpt(where, text, ref, store, report):
    """An excerpt value repeats the source's words: it must sit in one of its blockquotes."""
    source = store.sources.get(ref["source"])
    if source is not None and not source.has_quote(text):
        report.error(where, "the value is not in any blockquote of %s; an excerpt keeps the source's words"
                     % store.rel(source.path))


def _check_reference(where, ref, store, report):
    quote = ds.normalize(ref["quote"])
    if not quote:
        report.error(where, "quote is only whitespace; copy the words from the source")
    source = store.sources.get(ref["source"])
    if source is None:
        report.error(where, "cites unknown source %s; register it under capture/sources" % ref["source"])
    else:
        status = source.meta.get("status")
        if status == "excluded":
            report.error(where, "cites %s, which is excluded" % ref["source"])
        elif status != "processed":
            report.error(where, "cites %s, whose status is %s; set it to processed" % (ref["source"], status))
        if quote and not source.has_quote(quote):
            report.error(where, "quote is not in any blockquote of %s" % store.rel(source.path))
    try:
        accessed = ds.iso_date(ref["accessed"])
    except ValueError:
        report.error(where, "`accessed` is not a real date: %s" % ref["accessed"])
    else:
        if accessed > datetime.date.today():
            report.error(where, "`accessed` is in the future: %s" % ref["accessed"])


def _check_value(where, value, spec, name, store, registry, report):
    expected = spec["value"]
    actual = ds.value_kind(value)
    if actual == "special":
        return
    if actual != expected:
        report.error(where, "expected a %s value, got %s" % (expected, actual or repr(value)))
        return
    if expected == "item":
        target = store.items.get(value)
        if target is None:
            report.error(where, "refers to unknown item %s" % value)
        elif "merged into" in target.data:
            report.error(where, "refers to %s, merged into %s" % (value, target.data["merged into"]))
        elif target.data.get("type") not in spec["item type"]:
            report.error(
                where,
                "%s is a %s; `%s` takes %s" % (value, target.data.get("type"), name, " or ".join(spec["item type"])),
            )
    elif expected == "term":
        if value not in (registry.get("terms") or {}).get(name, []):
            report.error(where, "`%s` is not in the term list for %s; add it to the registry first" % (value, name))
    elif expected == "url":
        hosts = spec.get("hosts")
        if hosts and not ds.host_allowed(ds.url_host(value), hosts):
            report.error(where, "host of %s is not allowed for `%s`" % (value, name))
    elif expected == "date":
        _check_date(where, value, report)


def _check_date(where, value, report):
    if not isinstance(value, dict) or "date" not in value:
        report.error(where, "a date is a map with `date` and an optional `calendar`")
        return
    calendar_name = value.get("calendar", ds.DEFAULT_CALENDAR)
    try:
        ds.date_range(value["date"], calendar_name)
    except ValueError as exc:
        report.error(where, str(exc))
        return
    if "calendar" not in value:
        year = value["date"][:4]
        if year.isdigit() and int(year) < SUSPICIOUS_YEAR:
            report.warn(where, "year %s with no calendar; if it is Jalali, say `calendar: jalali`" % year)


# --- Articles -------------------------------------------------------------------------------

ARTIST_TYPES = ("person", "act")

_FOOTNOTE_DEFINITION = re.compile(r"^ {0,3}\[\^[^\]]*\]:", re.MULTILINE)


def check_article(article, store, report):
    where = store.rel(article.path)
    if article.item is None:
        report.error(where, "file name must be <item ID>.<language tag>.md")
    else:
        target = store.items.get(article.item)
        if target is None:
            report.error(where, "is about unknown item %s" % article.item)
        elif "merged into" in target.data:
            report.error(where, "is about %s, merged into %s; rename it" % (article.item, target.data["merged into"]))
        elif target.data.get("type") not in ARTIST_TYPES:
            report.error(where, "is about a %s; an article is about a person or an act" % target.data.get("type"))

    references = article.meta["references"]
    for key, ref in references.items():
        _check_reference("%s: reference %s" % (where, key), ref, store, report)
    if _FOOTNOTE_DEFINITION.search(article.body):
        report.error(where, "defines a footnote in the text; references go in the front matter")
    if not article.citations:
        report.error(where, "cites nothing; follow each fact with [^key]")
    for key in sorted(set(article.citations) - set(references)):
        report.error(where, "cites [^%s], which is not under `references`" % key)
    for key in sorted(set(references) - set(article.citations)):
        report.warn(where, "reference %s is never cited" % key)


def check_unrefined(store, report):
    """Each artist awaiting refinement is an artist with an article."""
    where = store.rel(store.root / "published" / "unrefined.yaml")
    with_article = {article.item for article in store.articles.values()}
    for item_id, name in store.unrefined.items():
        if not isinstance(name, str):
            report.error(where, "%s: the name must be text" % item_id)
        if item_id not in store.items:
            report.error(where, "%s is not an item" % item_id)
        elif item_id not in with_article:
            report.error(where, "%s has no article, so no page to mark" % item_id)


# --- Main -------------------------------------------------------------------------------------------


def validate(root, report):
    registry = ds.load_registry()
    check_registry(registry, report)

    schemas = ds.load_schemas()
    item_schema = ds.schema_validator(schemas, "item.schema.json")
    source_schema = ds.schema_validator(schemas, "source.schema.json")
    article_schema = ds.schema_validator(schemas, "article.schema.json")

    store = ds.load_store(root)
    for problem in store.problems:
        report.errors.append(problem)

    for source in store.sources.values():
        if _schema_ok(source.path, source.meta, source_schema, store, report):
            check_source(source, store, report)
    check_source_urls(store, report)
    for item in store.items.values():
        if _schema_ok(item.path, item.data, item_schema, store, report):
            check_item(item, store, registry, report)

    for article in store.articles.values():
        if _schema_ok(article.path, article.meta, article_schema, store, report):
            check_article(article, store, report)
    check_unrefined(store, report)
    return store


def _schema_ok(path, data, validator, store, report):
    errors = ds.schema_errors(validator, data)
    for json_path, message in errors:
        report.error("%s: %s" % (store.rel(path), json_path), message)
    return not errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--root", default=str(ds.DEFAULT_ROOT), help="data root (default: data)")
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()

    report = Report()
    store = validate(root, report)
    for line in report.errors:
        print("error: " + line)
    for line in report.warnings:
        print("warning: " + line)
    print(
        "%s: %d sources, %d items, %d articles, %d errors, %d warnings"
        % (root.relative_to(ds.REPO) if root.is_relative_to(ds.REPO) else root,
           len(store.sources), len(store.items), len(store.articles), len(report.errors), len(report.warnings))
    )
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())
