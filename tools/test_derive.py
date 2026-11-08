"""The site record that tools/derive.py builds from a data root."""

import shutil
import copy
import tempfile
import json
import subprocess
import sys
from unittest.mock import patch
import unittest
from pathlib import Path

import yaml

import datastore as ds
import derive

EXAMPLES = ds.REPO / "data" / "examples"
BAND, NIMA, RELEASE, MERGED = "Q7k3m9x", "Q5fd2cn", "Qd8mk4r", "Q9pw4tm"


class DeriveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.record = derive.derive(EXAMPLES)

    def test_curated_artist_has_a_page_named_after_its_latin_name(self):
        self.assertEqual(self.record["artists"], [BAND])
        self.assertEqual(self.record["items"][BAND]["page"], "badnama-7k3")
        self.assertNotIn("page", self.record["items"][NIMA])

    def test_new_artist_article_gets_a_page_without_an_approval_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "examples"
            shutil.copytree(EXAMPLES, root)
            artist = "Qzzzzz2"
            reference = {
                "source": "t.me-badnama_example-42",
                "quote": "سارا کوهی: خواننده و کیبورد",
                "accessed": "2026-10-11",
            }
            item = {
                "id": artist,
                "type": "person",
                "statements": {"name": [{
                    "value": {"text": "سارا کوهی", "language": "fa"},
                    "references": [reference],
                }]},
            }
            (root / "published" / "items" / "person" / (artist + ".yaml")).write_text(
                yaml.safe_dump(item, allow_unicode=True), encoding="utf-8")
            issued = derive.no_addresses()
            before = derive.derive(root, issued)
            self.assertNotIn(artist, before["artists"])
            self.assertNotIn("page", before["items"][artist])

            article = root / "published" / "articles" / (artist + ".fa.md")
            article.write_text(
                "---\n" + yaml.safe_dump({"references": {"credit": reference}}, allow_unicode=True)
                + "---\n\nسارا کوهی خواننده و نوازندهٔ کیبورد است.[^credit]\n",
                encoding="utf-8")
            after = derive.derive(root, issued)
            self.assertIn(artist, after["artists"])
            self.assertEqual(after["items"][artist]["page"], "سارا-کوهی-zzz")
            self.assertEqual(after["items"][BAND]["page"], before["items"][BAND]["page"])
            # The existing band member still participates in relationships,
            # without gaining an empty page from the new article.
            self.assertIn(NIMA, after["items"])
            self.assertNotIn(NIMA, after["artists"])
            self.assertNotIn("page", after["items"][NIMA])
            self.assertIn({"from": "/en/%s/" % artist, "to": "/en/سارا-کوهی-zzz/"}, after["redirects"])

    def test_display_name_per_language(self):
        names = self.record["items"][BAND]["names"]
        self.assertEqual(names["en"], {"text": "Badnama", "language": "en"})
        self.assertEqual(names["fa"], {"text": "بادنما", "language": "fa"})

    def test_relations_are_seen_from_both_ends(self):
        incoming = self.record["items"][BAND]["incoming"]
        member = next(i for i in incoming if i["property"] == "member of")
        self.assertEqual(member["item"], NIMA)
        self.assertEqual(member["qualifiers"]["role"], ["guitar"])
        self.assertIn({"property": "performer", "item": RELEASE, "rank": "normal"}, incoming)

    def test_dates_carry_their_gregorian_range(self):
        formed = self.record["items"][BAND]["statements"]["formation date"][0]["value"]
        self.assertEqual(formed["range"], ["2004-03-20", "2005-03-20"])

    def test_timeline_runs_earliest_first(self):
        kinds = [(e["kind"], e["item"]) for e in self.record["timeline"]]
        self.assertEqual(kinds, [("formation", BAND), ("joined", NIMA), ("life", BAND), ("release", RELEASE)])

    def test_life_event_reaches_the_timeline_in_its_own_words(self):
        entry = next(e for e in self.record["timeline"] if e["kind"] == "life")
        self.assertEqual(entry["text"]["language"], "fa")
        self.assertTrue(entry["text"]["text"].startswith("اولین اجرای ما سال ۱۳۸۴"))
        self.assertNotIn("\n", entry["text"]["text"])
        self.assertEqual(entry["date"]["range"], ["2005-03-21", "2006-03-20"])

    def test_contributor_is_seen_from_the_person(self):
        incoming = self.record["items"][NIMA]["incoming"]
        credit = next(i for i in incoming if i["property"] == "contributor")
        self.assertEqual(credit["item"], RELEASE)
        self.assertEqual(credit["qualifiers"]["role"], ["composer", "lyricist"])

    def test_timeline_preserves_conflicting_dates_without_duplicate_events(self):
        items = copy.deepcopy(self.record["items"])
        dates = items[RELEASE]["statements"]["release date"]
        alternate = copy.deepcopy(dates[0])
        alternate["value"] = {"date": "2001", "range": ["2001-01-01", "2001-12-31"]}
        dates.append(alternate)
        entries = [e for e in derive.timeline(items) if e["item"] == RELEASE]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["date"], dates[0]["value"])
        self.assertIn(alternate["value"], entries[0]["alternatives"])

    def test_announced_event_carries_its_billed_performer(self):
        items = copy.deepcopy(self.record["items"])
        items["Qzzzzz3"] = {
            "id": "Qzzzzz3", "type": "event", "statements": {
                "event date": [{"value": {"date": "2025-10-31", "range": ["2025-10-31", "2025-10-31"]}, "rank": "normal"}],
                "performer": [{"value": BAND, "rank": "normal"}],
            },
        }
        event = next(e for e in derive.timeline(items) if e["kind"] == "event")
        self.assertEqual(event["about"], [BAND])
        self.assertEqual(event["date"]["date"], "2025-10-31")

    def test_old_addresses_redirect(self):
        self.assertIn({"from": "/en/%s/" % BAND, "to": "/en/badnama-7k3/"}, self.record["redirects"])
        self.assertIn({"from": "/fa/%s/" % MERGED, "to": "/fa/badnama-7k3/"}, self.record["redirects"])

    def test_release_panel_address(self):
        self.assertEqual(self.record["items"][RELEASE]["anchor"], "nameless-street-d8m")

    def test_article_notes_follow_reading_order(self):
        article = self.record["articles"][BAND]["en"]
        self.assertTrue(article["lead"].startswith("Badnama is a band from Tehran."))
        self.assertEqual([s["heading"] for s in article["sections"]], ["Nameless Street"])
        self.assertEqual([n["key"] for n in article["notes"]][:2], ["formed", "roundup"])

    def test_cited_sources_are_resolved(self):
        source = self.record["sources"]["example.com-magazine-badnama-interview"]
        self.assertEqual(source["kind"], "web page")
        self.assertIn("title", source)
        self.assertEqual(source["issued"], {"date": "1394-07", "calendar": "jalali", "range": ["2015-09-23", "2015-10-22"]})


class AddressTests(unittest.TestCase):
    def test_latin_names(self):
        self.assertEqual(derive.latin_slug("Bâlzan"), "balzan")
        self.assertEqual(derive.latin_slug("Ain't Our Fault"), "aint-our-fault")
        self.assertEqual(derive.latin_slug("Balzan - Live in Tehran - 2021"), "balzan-live-in-tehran-2021")

    def test_a_name_with_no_latin_spelling_keeps_its_script(self):
        self.assertFalse(derive.is_latin("کاوه غفاری"))
        self.assertEqual(derive.script_slug("کاوه غفاری"), "کاوه-غفاری")
        self.assertEqual(derive.script_slug("بالزَن"), "بالزن")


class IssuedAddressTests(unittest.TestCase):
    def test_new_addresses_join_the_list(self):
        issued = derive.no_addresses()
        derive.derive(EXAMPLES, issued)
        self.assertEqual(issued["pages"], {"badnama-7k3": BAND, BAND: BAND, MERGED: BAND})
        self.assertEqual(issued["panels"]["nameless-street-d8m"], RELEASE)

    def test_an_old_page_address_keeps_redirecting(self):
        issued = {"pages": {"bad-nama-7k3": BAND, "old-name-9pw": MERGED}, "panels": {}}
        record = derive.derive(EXAMPLES, issued)
        self.assertIn({"from": "/en/bad-nama-7k3/", "to": "/en/badnama-7k3/"}, record["redirects"])
        self.assertIn({"from": "/fa/old-name-9pw/", "to": "/fa/badnama-7k3/"}, record["redirects"])

    def test_an_old_panel_address_is_listed_with_its_release(self):
        record = derive.derive(EXAMPLES, {"pages": {}, "panels": {"old-street-d8m": RELEASE}})
        self.assertEqual(record["panels"], {"old-street-d8m": RELEASE, "nameless-street-d8m": RELEASE, RELEASE: RELEASE})

    def test_an_issued_address_never_passes_to_another_item(self):
        with self.assertRaises(ds.DataError):
            derive.derive(EXAMPLES, {"pages": {"badnama-7k3": NIMA}, "panels": {}})

    def test_alias_survives_removal_deprecation_and_canonical_rename(self):
        for correction in ("removed", "deprecated", "renamed"):
            with self.subTest(correction=correction), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp) / "examples"
                shutil.copytree(EXAMPLES, root)
                path = root / "published/items/act" / (BAND + ".yaml")
                data = yaml.safe_load(path.read_text())
                names = data["statements"]["name"]
                alias = copy.deepcopy(next(s for s in names if s["value"]["language"] == "en"))
                alias["value"]["text"] = "Other Spelling"
                names.append(alias)
                path.write_text(yaml.safe_dump(data, allow_unicode=True))
                issued = derive.no_addresses()
                derive.derive(root, issued)
                self.assertEqual(issued["pages"]["other-spelling-7k3"], BAND)
                if correction == "removed":
                    names.remove(alias)
                elif correction == "deprecated":
                    alias["rank"] = "deprecated"
                else:
                    for name in names:
                        if name["value"]["language"] == "en":
                            name["value"]["text"] = "New Name"
                path.write_text(yaml.safe_dump(data, allow_unicode=True))
                record = derive.derive(root, issued)
                target = "/en/" + record["items"][BAND]["page"] + "/"
                self.assertIn({"from": "/en/other-spelling-7k3/", "to": target}, record["redirects"])

    def test_alias_ownership_follows_only_explicit_merges(self):
        issued = {"pages": {"badnama-7k3": MERGED}, "panels": {}}
        derive.derive(EXAMPLES, issued)
        self.assertEqual(issued["pages"]["badnama-7k3"], BAND)
        with self.assertRaises(ds.DataError):
            derive.derive(EXAMPLES, {"pages": {BAND: NIMA}, "panels": {}})


class DestinationContinuityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "examples"
        shutil.copytree(EXAMPLES, self.root)
        self.issued = derive.no_addresses()
        derive.derive(self.root, self.issued)
        self.release = self.root / "published/items/release" / (RELEASE + ".yaml")

    def test_article_removal_cannot_silently_drop_an_issued_artist_page(self):
        for article in (self.root / "published/articles").glob(BAND + ".*"):
            article.unlink()
        with self.assertRaisesRegex(ds.DataError, "issued artist address.*" + BAND):
            derive.derive(self.root, self.issued)

    def test_published_release_deletion_identifies_its_address_and_entity(self):
        self.release.unlink()
        with self.assertRaisesRegex(ds.DataError, "issued release address #.*" + RELEASE):
            derive.derive(self.root, self.issued)

    def test_credit_correction_keeps_former_host_without_inventing_credit(self):
        data = yaml.safe_load(self.release.read_text())
        data["statements"]["performer"][0]["value"] = NIMA
        self.release.write_text(yaml.safe_dump(data, allow_unicode=True))
        record = derive.derive(self.root, self.issued)
        self.assertEqual(record["panelHosts"][RELEASE], BAND)
        self.assertEqual(record["items"][RELEASE]["statements"]["performer"][0]["value"], NIMA)

    def test_never_public_release_needs_no_host_or_artificial_page(self):
        data = yaml.safe_load(self.release.read_text())
        data["statements"]["performer"][0]["value"] = NIMA
        self.release.write_text(yaml.safe_dump(data, allow_unicode=True))
        fresh = derive.no_addresses()
        record = derive.derive(self.root, fresh)
        self.assertNotIn(RELEASE, record["panelHosts"])
        self.assertNotIn(RELEASE, fresh["publicPanels"].values())
        self.release.unlink()
        derive.derive(self.root, fresh)

    def test_release_rename_preserves_all_former_public_anchors(self):
        data = yaml.safe_load(self.release.read_text())
        data["statements"]["name"][1]["value"]["text"] = "Renamed Recording"
        self.release.write_text(yaml.safe_dump(data, allow_unicode=True))
        record = derive.derive(self.root, self.issued)
        self.assertEqual(record["panels"]["nameless-street-d8m"], RELEASE)
        self.assertEqual(record["items"][RELEASE]["anchor"], "renamed-recording-d8m")

    def test_continuity_failure_does_not_publish_either_output(self):
        out, ledger = Path(self.tmp.name) / "record.json", Path(self.tmp.name) / "addresses.json"
        args = ["--root", str(self.root), "--out", str(out), "--addresses", str(ledger)]
        self.assertEqual(derive.main(args), 0)
        before = out.read_bytes(), ledger.read_bytes()
        self.release.unlink()
        self.assertEqual(derive.main(args), 1)
        self.assertEqual((out.read_bytes(), ledger.read_bytes()), before)

    def test_release_merge_preserves_former_public_addresses(self):
        target = "Qzzzzzz"
        data = yaml.safe_load(self.release.read_text())
        data["id"] = target
        (self.release.parent / (target + ".yaml")).write_text(yaml.safe_dump(data, allow_unicode=True))
        self.release.write_text(yaml.safe_dump({"id": RELEASE, "type": "release", "merged into": target}))
        record = derive.derive(self.root, self.issued)
        self.assertEqual(record["panels"]["nameless-street-d8m"], target)
        self.assertEqual(record["panelHosts"][target], BAND)


class TimelineIdentityTests(unittest.TestCase):
    def test_identity_is_independent_of_related_order_and_duplicates(self):
        record = derive.derive(EXAMPLES)
        items = copy.deepcopy(record["items"])
        release = items[RELEASE]
        extra = copy.deepcopy(release["statements"]["performer"][0])
        extra["value"] = NIMA
        release["statements"]["performer"].append(extra)
        first = derive.timeline(items)
        release["statements"]["performer"].reverse()
        release["statements"]["performer"].append(extra)
        self.assertEqual([e["anchor"] for e in first], [e["anchor"] for e in derive.timeline(items)])
        self.assertEqual(len({e["anchor"] for e in first}), len(first))
        repeated = derive.timeline(items)
        self.assertTrue(all(len(e["about"]) == len(set(e["about"])) for e in repeated))

    def test_duplicate_membership_identity_is_rejected(self):
        items = copy.deepcopy(derive.derive(EXAMPLES)["items"])
        membership = items[NIMA]["statements"]["member of"]
        membership.append(copy.deepcopy(membership[0]))
        with self.assertRaisesRegex(ds.DataError, "duplicate timeline identity"):
            derive.timeline(items)

    def test_intervals_retain_both_endpoint_ranges(self):
        value = derive.with_range({"date": "1400-01/1400-03?", "calendar": "jalali"})
        self.assertEqual(value["endpoints"][0]["range"], ["2021-03-21", "2021-04-20"])
        self.assertEqual(value["endpoints"][1]["date"], "1400-03?")
        self.assertEqual(value["endpoints"][1]["range"], ["2021-05-22", "2021-06-21"])


class OutputTransactionTests(unittest.TestCase):
    def test_failed_atomic_replace_keeps_old_json_and_removes_temporary(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "record.json"
            path.write_text('{"old":true}\n')
            with patch.object(derive.os, "replace", side_effect=OSError("disk error")):
                with self.assertRaises(OSError):
                    derive.atomic_json(path, {"new": True})
            self.assertEqual(json.loads(path.read_text()), {"old": True})
            self.assertEqual(list(Path(tmp).iterdir()), [path])

    def test_validation_failure_does_not_publish_either_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "examples"
            shutil.copytree(EXAMPLES, root)
            out, ledger = Path(tmp) / "record.json", Path(tmp) / "addresses.json"
            args = ["--root", str(root), "--out", str(out), "--addresses", str(ledger)]
            self.assertEqual(derive.main(args), 0)
            before = out.read_bytes(), ledger.read_bytes()
            item = root / "published/items/act" / (BAND + ".yaml")
            item.write_text(item.read_text().replace("type: act", "type: invalid"))
            self.assertEqual(derive.main(args), 1)
            self.assertEqual((out.read_bytes(), ledger.read_bytes()), before)

    def test_concurrent_invocations_retain_both_address_reservations(self):
        # Different records share a ledger, just as two CLI output destinations
        # can. Delay after reading it so an unlocked implementation loses an edit.
        worker = """
import sys, time
sys.path.insert(0, sys.argv[1])
import derive
from pathlib import Path

def fake(root, issued):
    time.sleep(0.2)
    issued['pages'][root] = root
    return {'artists': [], 'items': {}, 'timeline': []}
derive.derive = fake
raise SystemExit(derive.main(sys.argv[2:]))
"""
        with tempfile.TemporaryDirectory() as tmp:
            ledger = Path(tmp) / "addresses.json"
            processes = [subprocess.Popen([sys.executable, "-c", worker, str(ds.REPO / "tools"),
                "--root", name, "--out", str(Path(tmp) / (name + ".json")),
                "--addresses", str(ledger)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                for name in ("first", "second")]
            for process in processes:
                stdout, stderr = process.communicate(timeout=15)
                self.assertEqual(process.returncode, 0, stderr.decode())
            self.assertEqual(json.loads(ledger.read_text())["pages"], {"first": "first", "second": "second"})
            for name in ("first", "second"):
                self.assertEqual(json.loads((Path(tmp) / (name + ".json")).read_text())["items"], {})


class InvalidDataTests(unittest.TestCase):
    def test_stops_when_the_data_does_not_validate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "examples"
            shutil.copytree(EXAMPLES, root)
            path = root / "published" / "items" / "act" / (BAND + ".yaml")
            path.write_text(path.read_text(encoding="utf-8").replace("type: act", "type: band"), encoding="utf-8")
            with self.assertRaises(ds.DataError):
                derive.derive(root)


if __name__ == "__main__":
    unittest.main()
