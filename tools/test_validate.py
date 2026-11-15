"""The published record and article checks of tools/validate.py."""

import copy
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

    def test_accessed_dates(self):
        import datetime
        def name(accessed):
            ref = dict(SARA_NAME["references"][0], accessed=accessed)
            return dict(SARA_NAME, references=[ref])
        today = datetime.datetime.now(datetime.timezone.utc).date()
        self.write_item(SARA, "person", {"name": [name((today + datetime.timedelta(days=1)).isoformat())]})
        self.assertEqual(self.run_validator().errors, [])
        self.write_item(SARA, "person", {"name": [name((today + datetime.timedelta(days=2)).isoformat())]})
        self.assertOnlyError(self.run_validator(), "`accessed` is in the future")
        self.write_item(SARA, "person", {"name": [name("2007-08-07")]})
        report = self.run_validator()
        self.assertEqual(report.errors, [])
        self.assertEqual(len(report.warnings), 1)
        self.assertIn("before 2025", report.warnings[0])

    def test_tier_is_from_the_list(self):
        self.edit("capture/sources/example.net-lyrics-badnama.md", "tier: other", "tier: press")
        self.assertOnlyError(self.run_validator(), "tier: 'press' is not one of")

    def test_contributor_needs_a_role(self):
        path = "published/items/release/%s.yaml" % RELEASE
        self.edit(path, "      qualifiers:\n        role: [composer, lyricist]\n", "")
        self.assertOnlyError(self.run_validator(), "contributor[1]: needs a `role` qualifier")

    def test_life_event_keeps_the_source_words(self):
        path = "published/items/act/%s.yaml" % BAND
        self.edit(path, "        text: |-\n          اولین اجرای ما", "        text: |-\n          نخستین اجرای ما")
        self.assertOnlyError(self.run_validator(), "life event[1]: reference 1: the value is not in any blockquote")

    def test_life_event_place_must_be_a_place(self):
        path = "published/items/act/%s.yaml" % BAND
        self.edit(path, "        place: %s\n" % PLACE, "        place: %s\n" % LABEL)
        self.assertOnlyError(self.run_validator(), "qualifier place: %s is a organization" % LABEL)



class RuleTests(ValidateTests):
    """One broken record per rule, so that switching a rule off fails a test.

    Each test starts from the clean examples and breaks one thing.
    """

    def change(self, kind, item_id, fn):
        path = self.root / "published" / "items" / kind / (item_id + ".yaml")
        data = ds.load_yaml(path)
        fn(data)
        path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")

    def change_release(self, fn):
        self.change("release", RELEASE, fn)

    def first_ref(self, data, prop="name"):
        return data["statements"][prop][0]["references"][0]

    def assertOnlyWarning(self, report, fragment):
        self.assertEqual(report.errors, [])
        self.assertEqual(len(report.warnings), 1, report.warnings)
        self.assertIn(fragment, report.warnings[0])

    # --- Store ---------------------------------------------------------------

    def test_unreadable_item_is_a_problem(self):
        path = self.root / "published" / "items" / "release" / (RELEASE + ".yaml")
        path.write_text("id: [unclosed\n", encoding="utf-8")
        report = self.run_validator()
        self.assertTrue(any("%s.yaml: cannot read" % RELEASE in e for e in report.errors), report.errors)

    def test_repeated_key_is_a_problem(self):
        path = self.root / "published" / "items" / "place" / (PLACE + ".yaml")
        path.write_text(path.read_text(encoding="utf-8") + "type: place\n", encoding="utf-8")
        report = self.run_validator()
        self.assertTrue(any("found the key 'type' twice" in e for e in report.errors), report.errors)

    def test_item_without_id_is_a_problem(self):
        path = self.root / "published" / "items" / "place" / "Qzzzzz4.yaml"
        path.write_text("type: place\n", encoding="utf-8")
        self.assertOnlyError(self.run_validator(), "Qzzzzz4.yaml: not an item with an `id`")

    def test_duplicate_id_is_a_problem(self):
        source = self.root / "published" / "items" / "place" / (PLACE + ".yaml")
        shutil.copy(source, source.parent.parent / "organization" / (PLACE + ".yaml"))
        report = self.run_validator()
        self.assertTrue(any("duplicate id %s" % PLACE in e for e in report.errors), report.errors)

    def test_source_needs_front_matter(self):
        path = self.root / "capture" / "sources" / "t.me-badnama_example-42.md"
        path.write_text("> نیما راد: گیتار\n", encoding="utf-8")
        report = self.run_validator()
        self.assertTrue(any("cannot read: no front matter" in e for e in report.errors), report.errors)

    def test_unreadable_article_is_a_problem(self):
        path = self.root / "published" / "articles" / ("%s.en.md" % BAND)
        path.write_text("No front matter.\n", encoding="utf-8")
        report = self.run_validator()
        self.assertTrue(any("%s.en.md: cannot read: no front matter" % BAND in e for e in report.errors),
                        report.errors)

    # --- Schemas -------------------------------------------------------------

    def test_item_must_match_the_schema(self):
        self.change_release(lambda d: d["statements"]["name"][0].update(rank="best"))
        report = self.run_validator()
        self.assertTrue(report.errors)
        self.assertTrue(all("%s.yaml: $.statements" % RELEASE in e for e in report.errors), report.errors)

    def test_source_must_match_the_schema(self):
        self.edit("capture/sources/example.net-lyrics-badnama.md",
                  "reason: Lyrics site; Data Policies say not to cite these.\n", "")
        report = self.run_validator()
        self.assertEqual(len(report.errors), 1, report.errors)
        self.assertIn("example.net-lyrics-badnama.md: $", report.errors[0])
        self.assertIn("reason", report.errors[0])

    def test_article_must_match_the_schema(self):
        self.edit("published/articles/%s.en.md" % BAND, "references:", "refs:")
        report = self.run_validator()
        self.assertTrue(report.errors)
        self.assertTrue(all("%s.en.md" % BAND in e for e in report.errors), report.errors)

    # --- Sources -------------------------------------------------------------

    def test_source_file_name_is_lowercase(self):
        sources = self.root / "capture" / "sources"
        (sources / "instagram.com-badnama.example.md").rename(sources / "Instagram.com-badnama.example.md")
        self.assertOnlyError(self.run_validator(), "file name may use only lowercase letters")

    def test_source_part_of_must_exist(self):
        self.edit("capture/sources/t.me-badnama_example-42.md",
                  "part of: t.me-badnama_example\n", "part of: t.me-badnama_missing\n")
        self.assertOnlyError(self.run_validator(), "`part of` refers to unknown source t.me-badnama_missing")

    def test_source_is_not_part_of_itself(self):
        self.edit("capture/sources/t.me-badnama_example-42.md",
                  "part of: t.me-badnama_example\n", "part of: t.me-badnama_example-42\n")
        self.assertOnlyError(self.run_validator(), "`part of` points at itself")

    def test_source_issued_is_a_real_date(self):
        self.edit("capture/sources/t.me-badnama_example-42.md", 'date: "1394-03-10"', 'date: "1394-13-10"')
        self.assertOnlyError(self.run_validator(), "issued: month out of range")

    def test_processed_source_without_a_quote_warns(self):
        self.edit("capture/sources/instagram.com-badnama.example.md", "status: found", "status: processed")
        report = self.run_validator()
        self.assertEqual(report.errors, [])
        self.assertTrue(any("processed but holds no blockquote" in w for w in report.warnings), report.warnings)

    def test_two_sources_with_one_url_warn(self):
        self.edit("capture/sources/example.org-music-tehran-rock-roundup.md",
                  "url: https://example.org/music/tehran-rock-roundup",
                  "url: https://example.com/magazine/badnama-interview/")
        self.assertOnlyWarning(self.run_validator(), "same url as")

    # --- Items ---------------------------------------------------------------

    def test_file_name_matches_id(self):
        folder = self.root / "published" / "items" / "place"
        (folder / (PLACE + ".yaml")).rename(folder / "Qzzzzz5.yaml")
        self.assertOnlyError(self.run_validator(), "file name does not match id %s" % PLACE)

    def test_folder_matches_type(self):
        items = self.root / "published" / "items"
        (items / "event").mkdir()
        (items / "place" / (PLACE + ".yaml")).rename(items / "event" / (PLACE + ".yaml"))
        self.assertOnlyError(self.run_validator(), "directory does not match type place")

    def test_item_without_a_name_warns(self):
        self.write_item(SARA, "person", {"legal name": [SARA_NAME]})
        self.assertOnlyWarning(self.run_validator(), "has no `name` statement")

    def test_unknown_property_is_an_error(self):
        self.change_release(lambda d: d["statements"].update(genre=d["statements"]["name"][:1]))
        self.assertOnlyError(self.run_validator(), "genre: unknown property")

    def test_property_is_used_on_its_types(self):
        self.change_release(lambda d: d["statements"].update({"legal name": d["statements"]["name"][:1]}))
        self.assertOnlyError(self.run_validator(), "legal name: not used on a release")

    def test_only_a_name_can_be_editorial(self):
        self.change("person", NIMA, lambda d: d["statements"]["legal name"][0].update(editorial=True))
        self.assertOnlyError(self.run_validator(), "only a `name` can be an editorial display spelling")
        self.change("person", NIMA, lambda d: (d["statements"]["legal name"][0].pop("editorial"),
                                               d["statements"]["name"][0].update(editorial=True)))
        self.assertEqual(self.run_validator().errors, [])

    def test_qualifier_must_be_allowed_on_the_property(self):
        self.change_release(lambda d: d["statements"]["performer"][0].update(qualifiers={"place": PLACE}))
        self.assertOnlyError(self.run_validator(), "performer[1]: qualifier place: not allowed on `performer`")

    # --- Merges --------------------------------------------------------------

    def test_merge_target_must_exist(self):
        self.edit("published/items/act/%s.yaml" % MERGED, "merged into: %s" % BAND, "merged into: Qzzzzz6")
        self.assertOnlyError(self.run_validator(), "`merged into` refers to unknown item Qzzzzz6")

    def test_merge_target_is_the_survivor(self):
        self.write_item("Qzzzzz7", "act", {})
        path = self.root / "published" / "items" / "act" / "Qzzzzz7.yaml"
        path.write_text("id: Qzzzzz7\ntype: act\nmerged into: %s\n" % MERGED, encoding="utf-8")
        self.assertOnlyError(self.run_validator(), "itself merged; point at the survivor")

    def test_merge_into_another_type_warns(self):
        self.edit("published/items/act/%s.yaml" % MERGED, "merged into: %s" % BAND, "merged into: %s" % NIMA)
        self.assertOnlyWarning(self.run_validator(), "merged into a person")

    # --- Platform searches ----------------------------------------------------

    def write_note(self, name, text):
        path = self.root / "capture" / "notes" / (name + ".md")
        path.write_text(text, encoding="utf-8")

    def searched(self, about, **days):
        lines = "".join("  %s: %s\n" % (key, day) for key, day in days.items())
        return "---\nabout: %s\nsearched:\n%s---\n\nSearched for Badnama and بادنما.\n" % (about, lines)

    def test_a_note_without_front_matter_is_free_text(self):
        self.write_note("questions", "# Open questions\n\n- Who played bass in 2012?\n")
        report = self.run_validator()
        self.assertEqual(report.errors, [])
        self.assertEqual(report.warnings, [])

    def test_recorded_searches_load_and_validate(self):
        self.write_note("badnama-searches", self.searched(BAND, bandcamp="2026-11-15", soundcloud="'2026-11-15'"))
        store = validate.validate(self.root, report := validate.Report())
        self.assertEqual(report.errors, [])
        self.assertEqual(report.warnings, [])
        found = store.searches(BAND)
        self.assertEqual({k: day for k, (day, _) in found.items()}, {"bandcamp": "2026-11-15", "soundcloud": "2026-11-15"})
        self.assertEqual(found["bandcamp"][1].name, "badnama-searches")

    def test_searches_need_an_existing_live_artist(self):
        self.write_note("unknown", self.searched("Qzzzzz9", bandcamp="2026-11-15"))
        self.write_note("merged", self.searched(MERGED, bandcamp="2026-11-15"))
        self.write_note("release", self.searched(RELEASE, bandcamp="2026-11-15"))
        self.write_note("by-name", self.searched("Badnama", bandcamp="2026-11-15"))
        self.write_note("no-about", "---\nsearched:\n  bandcamp: 2026-11-15\n---\n")
        self.assertOnlyError(
            self.run_validator(),
            "by-name.md: $.about: 'Badnama' is not an item ID",
            "merged.md: `about` refers to Q9pw4tm, merged into Q7k3m9x",
            "no-about.md: $: 'about' is a dependency of 'searched'",
            "release.md: `about` is a release; searches are for a person or an act",
            "unknown.md: `about` refers to unknown item Qzzzzz9",
        )

    def test_searches_name_registry_platforms(self):
        self.write_note("badnama", self.searched(BAND, Bandcamp="2026-11-15", deezer="2026-11-15"))
        report = self.run_validator()
        self.assertEqual(len(report.errors), 2, report.errors)
        self.assertTrue(all("not a platform key; use one of youtube, spotify" in e for e in report.errors))

    def test_searched_days_are_real_and_not_in_the_future(self):
        import datetime
        today = datetime.datetime.now(datetime.timezone.utc).date()
        tomorrow, later = today + datetime.timedelta(days=1), today + datetime.timedelta(days=2)
        self.write_note("ahead", self.searched(BAND, bandcamp=tomorrow.isoformat()))
        self.assertEqual(self.run_validator().errors, [])
        self.write_note("ahead", self.searched(BAND, bandcamp=later.isoformat(), youtube="'2026-02-30'"))
        self.assertOnlyError(
            self.run_validator(),
            "searched bandcamp: in the future: %s" % later.isoformat(),
            "searched youtube: not a real date: 2026-02-30",
        )
        self.write_note("ahead", self.searched(BAND, spotify="2026-11"))
        self.assertOnlyError(self.run_validator(), "$.searched.spotify: '2026-11' is not a full date")
        self.write_note("ahead", self.searched(BAND, apple="1405-08-24"))
        self.assertOnlyWarning(self.run_validator(), "searched apple: before 2025, likely a typo: 1405-08-24")

    def test_an_unquoted_impossible_day_cannot_be_read(self):
        self.write_note("badnama", self.searched(BAND, bandcamp="2026-02-30"))
        self.assertOnlyError(self.run_validator(), "badnama.md: cannot read")

    def test_a_platform_is_recorded_once_per_artist(self):
        self.write_note("a", self.searched(BAND, bandcamp="2026-11-01"))
        self.write_note("b", self.searched(BAND, bandcamp="2026-11-15"))
        self.write_note("c", self.searched(NIMA, bandcamp="2026-11-15"))
        self.assertOnlyError(self.run_validator(), "b.md: searched bandcamp: already recorded for Q7k3m9x in")

    def test_a_search_beside_a_profile_link_is_stale(self):
        def add_profile(data):
            data["statements"]["profile link"] = [dict(SARA_NAME, value="https://badnama-example.bandcamp.com/")]
        self.change("act", BAND, add_profile)
        self.write_note("badnama", self.searched(BAND, bandcamp="2026-11-15", soundcloud="2026-11-15"))
        report = self.run_validator()
        self.assertEqual(report.errors, [])
        self.assertOnlyWarning(report, "searched bandcamp: Q7k3m9x now has a profile link on bandcamp")

    # --- References ----------------------------------------------------------

    def test_reference_quote_is_not_blank(self):
        self.change("place", PLACE, lambda d: self.first_ref(d).update(quote="   "))
        self.assertOnlyError(self.run_validator(), "quote: '   ' is not a quote with at least one visible character")

    def test_reference_source_must_exist(self):
        self.change("place", PLACE, lambda d: self.first_ref(d).update(source="example.com-missing"))
        self.assertOnlyError(self.run_validator(), "cites unknown source example.com-missing")

    def test_excluded_source_cannot_be_cited(self):
        self.edit("capture/sources/example.com-magazine-badnama-interview.md",
                  "status: processed", "status: excluded\nreason: Test.")
        report = self.run_validator()
        self.assertTrue(report.errors)
        self.assertTrue(all("cites example.com-magazine-badnama-interview, which is excluded" in e
                            for e in report.errors), report.errors)

    def test_found_source_cannot_be_cited(self):
        self.edit("capture/sources/example.com-magazine-badnama-interview.md", "status: processed", "status: found")
        report = self.run_validator()
        self.assertTrue(report.errors)
        self.assertTrue(all("whose status is found; set it to processed" in e for e in report.errors), report.errors)

    def test_reference_quote_must_be_in_the_source(self):
        self.change("place", PLACE, lambda d: self.first_ref(d).update(quote="جمله‌ای که در منبع نیست"))
        self.assertOnlyError(self.run_validator(), "name[1]: reference 1: quote is not in any blockquote")

    def test_accessed_is_a_real_date(self):
        self.change("place", PLACE, lambda d: self.first_ref(d).update(accessed="2026-02-30"))
        self.assertOnlyError(self.run_validator(), "`accessed` is not a real date: 2026-02-30")

    def test_accessed_is_not_in_the_future(self):
        self.change("place", PLACE, lambda d: self.first_ref(d).update(accessed="2999-01-01"))
        self.assertOnlyError(self.run_validator(), "`accessed` is in the future: 2999-01-01")

    def test_article_is_about_a_known_item(self):
        articles = self.root / "published" / "articles"
        shutil.copy(articles / ("%s.en.md" % BAND), articles / "Qzzzzz9.en.md")
        self.assertOnlyError(self.run_validator(), "Qzzzzz9.en.md: is about unknown item Qzzzzz9")

    # The schemas catch these two first; the validator keeps its own check in
    # case a schema loosens, so test the check directly.

    def test_blank_quote_check(self):
        report = validate.Report()
        store = ds.load_store(self.root)
        ref = {"source": "t.me-badnama_example-42", "quote": " \n ", "accessed": "2026-10-11"}
        validate._check_reference("here", ref, store, report)
        self.assertIn("here: quote is only whitespace; copy the words from the source", report.errors)

    def test_date_shape_check(self):
        report = validate.Report()
        validate._check_date("here", "2012", report)
        self.assertEqual(report.errors, ["here: a date is a map with `date` and an optional `calendar`"])

    # --- Values --------------------------------------------------------------

    def test_value_has_the_property_kind(self):
        self.change_release(lambda d: d["statements"]["listen link"][0].update(value="not a link"))
        self.assertOnlyError(self.run_validator(), "listen link[1]: expected a url value")

    def test_special_values_are_allowed(self):
        self.change_release(lambda d: d["statements"]["performer"][0].update(value="unknown value"))
        self.assertEqual(self.run_validator().errors, [])

    def test_item_value_must_exist(self):
        self.change_release(lambda d: d["statements"]["performer"][0].update(value="Qzzzzz8"))
        self.assertOnlyError(self.run_validator(), "performer[1]: refers to unknown item Qzzzzz8")

    def test_item_value_is_not_merged(self):
        self.change_release(lambda d: d["statements"]["performer"][0].update(value=MERGED))
        self.assertOnlyError(self.run_validator(), "refers to %s, merged into %s" % (MERGED, BAND))

    def test_item_value_has_an_allowed_type(self):
        self.change_release(lambda d: d["statements"]["performer"][0].update(value=LABEL))
        self.assertOnlyError(self.run_validator(), "%s is a organization; `performer` takes" % LABEL)

    def test_term_is_in_the_list(self):
        self.change_release(lambda d: d["statements"]["contributor"][0]["qualifiers"].update(role=["kazoo"]))
        self.assertOnlyError(self.run_validator(), "`kazoo` is not in the term list for role")

    def test_url_host_is_allowed(self):
        self.change_release(lambda d: d["statements"]["listen link"][0].update(value="https://example.com/x"))
        self.assertOnlyError(self.run_validator(), "host of https://example.com/x is not allowed for `listen link`")

    def test_url_host_cannot_hide_behind_user_info(self):
        bad = "https://bandcamp.com:443@evil.example/x"
        self.change_release(lambda d: d["statements"]["listen link"][0].update(value=bad))
        self.assertOnlyError(self.run_validator(), "is not allowed for `listen link`")

    def test_date_value_is_a_real_date(self):
        self.change_release(lambda d: d["statements"]["release date"][0].update(value={"date": "2012-02-30"}))
        self.assertOnlyError(self.run_validator(), "release date[1]: day out of range: '2012-02-30'")

    def test_jalali_day_must_exist(self):
        self.change_release(lambda d: d["statements"]["release date"][0].update(
            value={"date": "1392-12-30", "calendar": "jalali"}))
        self.assertOnlyError(self.run_validator(), "day out of range")

    def test_interval_ends_after_it_starts(self):
        self.change_release(lambda d: d["statements"]["release date"][0].update(value={"date": "2013/2012"}))
        self.assertOnlyError(self.run_validator(), "interval ends before it starts")

    def test_early_year_without_a_calendar_warns(self):
        self.change_release(lambda d: d["statements"]["release date"][0].update(value={"date": "1391"}))
        self.assertOnlyWarning(self.run_validator(), "year 1391 with no calendar")


class RegistryTests(unittest.TestCase):
    """check_registry on a copy of the real registry with one thing broken."""

    def check(self, fn):
        registry = copy.deepcopy(ds.load_registry())
        fn(registry)
        report = validate.Report()
        validate.check_registry(registry, report)
        return report.errors

    def assertOneError(self, fn, fragment):
        errors = self.check(fn)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn(fragment, errors[0])

    def test_real_registry_is_clean(self):
        self.assertEqual(self.check(lambda r: None), [])

    def test_property_must_be_in_the_spec(self):
        self.assertOneError(lambda r: r["properties"].update(genre={"used on": "any", "value": "text"}),
                            "property `genre` is in the registry but not in the spec")

    def test_spec_property_must_be_in_the_registry(self):
        self.assertOneError(lambda r: r["properties"].pop("logo"),
                            "property `logo` is in the spec but not in the registry")

    def test_qualifier_must_be_in_the_spec(self):
        self.assertOneError(lambda r: r["qualifiers"].update(mood={"value": "text"}),
                            "qualifier `mood` is in the registry but not in the spec")

    def test_used_on_names_item_types(self):
        self.assertOneError(lambda r: r["properties"]["name"].update({"used on": ["song"]}),
                            "`used on` must be `any` or a list of item types")

    def test_value_kind_is_known(self):
        self.assertOneError(lambda r: r["properties"]["name"].update(value="number"), "`value` must be one of")

    def test_item_value_needs_item_types(self):
        self.assertOneError(lambda r: r["properties"]["performer"].pop("item type"),
                            "an item value needs `item type`")

    def test_item_type_only_on_item_values(self):
        self.assertOneError(lambda r: r["properties"]["name"].update({"item type": ["act"]}),
                            "`item type` only applies to item values")

    def test_term_value_needs_a_term_list(self):
        self.assertOneError(lambda r: r["terms"].pop("role"), "a term value needs a list under `terms`")

    def test_hosts_only_on_url_values(self):
        self.assertOneError(lambda r: r["properties"]["name"].update(hosts=["example.com"]),
                            "`hosts` only applies to url values")

    def test_allowed_qualifiers_exist(self):
        self.assertOneError(lambda r: r["properties"]["performer"]["qualifiers"].append("mood"),
                            "allows unknown qualifier `mood`")

    def test_required_qualifier_is_allowed(self):
        self.assertOneError(lambda r: r["properties"]["performer"].update(requires=["place"]),
                            "requires `place`, which it does not allow")

    def test_excerpt_only_on_text_values(self):
        self.assertOneError(lambda r: r["properties"]["performer"].update(excerpt=True),
                            "`excerpt` only applies to text values")

    def test_qualifier_value_spec_is_checked(self):
        self.assertOneError(lambda r: r["qualifiers"]["place"].pop("item type"), "an item value needs `item type`")


if __name__ == "__main__":
    unittest.main()
