"""The published record and article checks of tools/validate.py."""

import shutil
import tempfile
import unittest
from pathlib import Path

import yaml

import datastore as ds
import validate

EXAMPLES = ds.REPO / "data" / "examples"

BAND, NIMA, RELEASE, LABEL, PLACE, MERGED = "Q7k3m9x", "Q5fd2cn", "Qd8mk4r", "Qp6tv3h", "Q3nv8ks", "Q9pw4tm"
SARA, VENUE = "Qzzzzz2", "Qzzzzz3"

SARA_NAME = {
    "value": {"text": "سارا کوهی", "language": "fa"},
    "references": [{
        "source": "t.me-badnama_example-42",
        "quote": "سارا کوهی: خواننده و کیبورد",
        "accessed": "2026-10-11",
    }],
}


class ValidateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "examples"
        shutil.copytree(EXAMPLES, self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def run_validator(self):
        report = validate.Report()
        validate.validate(self.root, report)
        return report

    def write_item(self, item_id, kind, statements):
        path = self.root / "published" / "items" / kind / (item_id + ".yaml")
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {"id": item_id, "type": kind, "statements": statements}
        path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")

    def add_performer(self, item_id, statement):
        path = self.root / "published" / "items" / "release" / (RELEASE + ".yaml")
        data = ds.load_yaml(path)
        data["statements"]["performer"].append(dict(statement, value=item_id))
        path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")

    def edit(self, relative, old, new):
        path = self.root / relative
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text)
        path.write_text(text.replace(old, new), encoding="utf-8")

    def assertOnlyError(self, report, *fragments):
        self.assertEqual(len(report.errors), len(fragments), report.errors)
        for line, fragment in zip(sorted(report.errors), fragments):
            self.assertIn(fragment, line)

    def test_examples_are_clean(self):
        report = self.run_validator()
        self.assertEqual(report.errors, [])
        self.assertEqual(report.warnings, [])

    def test_person_does_not_need_a_preselected_artist_relationship(self):
        self.write_item(SARA, "person", {"name": [SARA_NAME]})
        self.assertEqual(self.run_validator().errors, [])

    def test_member_and_co_performer_are_valid_records(self):
        member = dict(SARA_NAME, value=BAND)
        self.write_item(SARA, "person", {"name": [SARA_NAME], "member of": [member]})
        self.assertEqual(self.run_validator().errors, [])

        self.write_item(SARA, "person", {"name": [SARA_NAME]})
        self.add_performer(SARA, SARA_NAME)
        self.assertEqual(self.run_validator().errors, [])

    def test_release_can_have_a_performer_without_an_article(self):
        self.edit("published/items/release/%s.yaml" % RELEASE, "  - value: %s\n" % BAND, "  - value: %s\n" % NIMA)
        self.assertEqual(self.run_validator().errors, [])

    def test_places_and_organizations_are_not_limited(self):
        self.write_item(VENUE, "place", {"name": [{
            "value": {"text": "تهران", "language": "fa"},
            "references": [{
                "source": "example.com-magazine-badnama-interview",
                "quote": "در تهران شکل گرفت",
                "accessed": "2026-10-12",
            }],
        }]})
        self.assertEqual(self.run_validator().errors, [])

    def test_article_citations_and_references_must_match(self):
        self.edit("published/articles/%s.en.md" % BAND, "says 2005.[^roundup]", "says 2005.[^rundup]")
        report = self.run_validator()
        self.assertOnlyError(report, "cites [^rundup], which is not under `references`")
        self.assertEqual(len(report.warnings), 1)
        self.assertIn("reference roundup is never cited", report.warnings[0])

    def test_article_quote_must_be_captured(self):
        self.edit("published/articles/%s.en.md" % BAND, "released November 2012 via", "released December 2012 via")
        self.assertOnlyError(self.run_validator(), "reference album: quote is not in any blockquote")

    def test_article_must_cite_something(self):
        self.edit("published/articles/%s.en.md" % BAND, "[^formed]", "")
        self.edit("published/articles/%s.en.md" % BAND, "[^roundup]", "")
        self.edit("published/articles/%s.en.md" % BAND, "[^guitar]", "")
        self.edit("published/articles/%s.en.md" % BAND, "[^album]", "")
        report = self.run_validator()
        self.assertOnlyError(report, "cites nothing")
        self.assertEqual(len(report.warnings), 4)

    def test_footnote_definitions_belong_in_the_front_matter(self):
        path = self.root / "published" / "articles" / ("%s.en.md" % BAND)
        path.write_text(path.read_text(encoding="utf-8") + "\n[^album]: Bandcamp\n", encoding="utf-8")
        self.assertOnlyError(self.run_validator(), "defines a footnote in the text")

    def test_article_is_about_a_live_person_or_act(self):
        articles = self.root / "published" / "articles"
        source = articles / ("%s.en.md" % BAND)
        shutil.copy(source, articles / ("%s.en.md" % NIMA))
        shutil.copy(source, articles / ("%s.en.md" % RELEASE))
        shutil.copy(source, articles / ("%s.en.md" % MERGED))
        shutil.copy(source, articles / "badnama.en.md")
        self.assertOnlyError(
            self.run_validator(),
            "Q9pw4tm.en.md: is about Q9pw4tm, merged into Q7k3m9x",
            "Qd8mk4r.en.md: is about a release",
            "badnama.en.md: file name must be <item ID>.<language tag>.md",
        )

    def test_contributor_needs_a_role(self):
        path = "published/items/release/%s.yaml" % RELEASE
        self.edit(path, "      qualifiers:\n        role: [composer, lyricist]\n", "")
        self.assertOnlyError(self.run_validator(), "contributor[1]: needs a `role` qualifier")

    def test_unrefined_lists_artists_with_a_page(self):
        (self.root / "published" / "unrefined.yaml").write_text(
            "%s: Badnama\n%s: Nima Rad\nQzzzzz9: Nobody\n" % (BAND, NIMA), encoding="utf-8")
        self.assertOnlyError(
            self.run_validator(),
            "Q5fd2cn has no article, so no page to mark",
            "Qzzzzz9 is not an item",
        )

    def test_life_event_keeps_the_source_words(self):
        path = "published/items/act/%s.yaml" % BAND
        self.edit(path, "        text: |-\n          اولین اجرای ما", "        text: |-\n          نخستین اجرای ما")
        self.assertOnlyError(self.run_validator(), "life event[1]: reference 1: the value is not in any blockquote")

    def test_life_event_place_must_be_a_place(self):
        path = "published/items/act/%s.yaml" % BAND
        self.edit(path, "        place: %s\n" % PLACE, "        place: %s\n" % LABEL)
        self.assertOnlyError(self.run_validator(), "qualifier place: %s is a organization" % LABEL)


if __name__ == "__main__":
    unittest.main()
