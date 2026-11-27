"""Routing-only continuity for an already published contributor panel."""
import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import yaml
import datastore as ds
import derive

BAND, CONTRIBUTOR, RELEASE = "Q7k3m9x", "Q5fd2cn", "Qd8mk4r"


class ContributorPanelRouteTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "examples"
        shutil.copytree(ds.REPO / "data/examples", self.root)
        articles = self.root / "published/articles"
        self.original_articles = {p.name: p.read_bytes() for p in articles.iterdir()}
        # These fictional fixtures already credit Nima as the composer. Give
        # that existing contributor the example article, without a performer.
        for article in list(articles.glob(BAND + ".*")):
            article.rename(articles / article.name.replace(BAND, CONTRIBUTOR))
        self.path = self.root / "published/items/release" / (RELEASE + ".yaml")
        self.original = yaml.safe_load(self.path.read_text())
        data = copy.deepcopy(self.original)
        data["statements"].pop("performer")
        self.write(data)
        self.issued = derive.no_addresses()

    def write(self, data):
        self.path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False))

    def seeded(self):
        before = derive.derive(self.root, self.issued)
        self.assertNotIn(RELEASE, before["panelHosts"])
        self.issued["panelHosts"][RELEASE] = CONTRIBUTOR
        return before, derive.derive(self.root, self.issued)

    def test_existing_contributor_destination_does_not_invent_performer_billing(self):
        before, after = self.seeded()
        self.assertEqual(after["panelHosts"][RELEASE], CONTRIBUTOR)
        self.assertEqual(after["items"][RELEASE], before["items"][RELEASE])
        self.assertNotIn("host", after["items"][RELEASE])
        self.assertNotIn("performer", after["items"][RELEASE]["statements"])
        self.assertEqual(after["items"][CONTRIBUTOR]["releases"], [])
        self.assertEqual(after["timeline"], before["timeline"])
        self.assertEqual(self.issued["publicPanels"][RELEASE], RELEASE)
        self.assertEqual(self.issued["publicPanels"][after["items"][RELEASE]["anchor"]], RELEASE)

    def test_an_existing_primary_performer_page_still_takes_precedence(self):
        self.seeded()
        articles = self.root / "published/articles"
        for name, content in self.original_articles.items():
            (articles / name).write_bytes(content)
        data = yaml.safe_load(self.path.read_text())
        data["statements"]["performer"] = self.original["statements"]["performer"]
        self.write(data)
        record = derive.derive(self.root, self.issued)
        self.assertEqual(record["items"][RELEASE]["host"], BAND)
        self.assertEqual(record["panelHosts"][RELEASE], BAND)
        self.assertIn(RELEASE, record["items"][BAND]["releases"])
        self.assertNotIn(RELEASE, record["items"][CONTRIBUTOR]["releases"])

    def test_removing_the_credit_keeps_the_recorded_destination_only(self):
        self.seeded()
        data = yaml.safe_load(self.path.read_text())
        data["statements"].pop("contributor")
        self.write(data)
        record = derive.derive(self.root, self.issued)
        self.assertEqual(record["panelHosts"][RELEASE], CONTRIBUTOR)
        self.assertNotIn("host", record["items"][RELEASE])
        self.assertNotIn("contributor", record["items"][RELEASE]["statements"])
        self.assertEqual(record["items"][CONTRIBUTOR]["releases"], [])

    def test_eight_frozen_existing_contributor_destinations_are_registered(self):
        expected = {'Q4g6gkc': {'host': 'Qfvnnnd', 'anchor': 'swear-it-sign-it-bleed-on-it-conference-ensemble-2025-4g6', 'aliases': ['Q4g6gkc', 'swear-it-sign-it-bleed-on-it-conference-ensemble-2025-4g6']}, 'Q5hrkvz': {'host': 'Qa744p5', 'anchor': 'شمبهای-5hr', 'aliases': ['Q5hrkvz', 'شمبهای-5hr']}, 'Q75yd3g': {'host': 'Qhqb38j', 'anchor': 'one-day-tehran-75y', 'aliases': ['Q75yd3g', 'one-day-tehran-75y']}, 'Qatvq7d': {'host': 'Qfvnnnd', 'anchor': 'micro-moments-v-collettivo-21-ensemble-flute-piano-and-live-electronics-atv', 'aliases': ['Qatvq7d', 'micro-moments-v-collettivo-21-ensemble-flute-piano-and-live-electronics-atv']}, 'Qayhr4j': {'host': 'Qhqb38j', 'anchor': 'alef-2011-recital-ayh', 'aliases': ['Qayhr4j', 'alef-2011-recital-ayh']}, 'Qch8sxp': {'host': 'Qa744p5', 'anchor': 'مقدمۀ-بیتخوانی-در-عزاداری-و-بیت-عزا-ch8', 'aliases': ['Qch8sxp', 'مقدمۀ-بیتخوانی-در-عزاداری-و-بیت-عزا-ch8']}, 'Qjsmsth': {'host': 'Qd5zat9', 'anchor': 'silence-of-homa-jsm', 'aliases': ['Qjsmsth', 'silence-of-homa-jsm']}, 'Qqht6vr': {'host': 'Qk45pkn', 'anchor': 'ambient-room-qht', 'aliases': ['Qqht6vr', 'ambient-room-qht']}}
        ledger = json.loads((ds.REPO / "site/addresses.json").read_text())
        for item_id, route in expected.items():
            with self.subTest(item=item_id):
                self.assertEqual(ledger["panelHosts"][item_id], route["host"])
                for alias in route["aliases"]:
                    self.assertEqual(ledger["publicPanels"][alias], item_id)
                item = yaml.safe_load((ds.REPO / "data/published/items/release" / (item_id + ".yaml")).read_text())
                contributors = item["statements"].get("contributor", [])
                active = [s for s in contributors if s.get("rank") == "preferred"] or [
                    s for s in contributors if s.get("rank", "normal") == "normal"]
                self.assertTrue(any(s["value"] == route["host"] for s in active))
                self.assertFalse(any(s["value"] == route["host"] for s in
                    item["statements"].get("performer", []) if s.get("rank", "normal") != "deprecated"))
        self.assertEqual(yaml.safe_load((ds.REPO / "data/published/items/release/Q75yd3g.yaml").read_text())
                         ["statements"]["release date"][0]["value"], {"date": "2012"})
        for held in ["Qj59mk5", "Qxhzskw"]:
            self.assertNotIn(held, ledger["panelHosts"])
            self.assertNotIn(held, ledger["publicPanels"])


if __name__ == "__main__":
    unittest.main()
