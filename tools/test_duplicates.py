"""The duplicate-record warnings of tools/validate.py."""

import shutil
import tempfile
import unittest
from pathlib import Path

import yaml

import datastore as ds
import validate

EXAMPLES = ds.REPO / "data" / "examples"
BAND, NIMA, RELEASE = "Q7k3m9x", "Q5fd2cn", "Qd8mk4r"


class DuplicateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "examples"
        shutil.copytree(EXAMPLES, self.root)
        self.items = self.root / "published" / "items"

    def tearDown(self):
        self.tmp.cleanup()

    def warnings(self):
        report = validate.Report()
        validate.validate(self.root, report)
        self.assertEqual(report.errors, [])
        return report.warnings

    def copy_as(self, kind, item_id, new_id):
        data = ds.load_yaml(self.items / kind / (item_id + ".yaml"))
        data["id"] = new_id
        self.write(kind, data)
        return data

    def write(self, kind, data):
        path = self.items / kind / (data["id"] + ".yaml")
        path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")

    def test_two_people_with_one_name_warn(self):
        self.copy_as("person", NIMA, "Qzzzzz2")
        warnings = self.warnings()
        self.assertEqual(len(warnings), 2, warnings)  # Persian and English names
        self.assertTrue(all("Qzzzzz2.yaml: a person named" in w and "is also %s" % NIMA in w for w in warnings))

    def test_merged_record_is_not_a_duplicate(self):
        self.copy_as("act", BAND, "Qzzzzz3")
        (self.items / "act" / "Qzzzzz3.yaml").write_text("id: Qzzzzz3\ntype: act\nmerged into: %s\n" % BAND)
        self.assertEqual(self.warnings(), [])

    def test_two_releases_with_one_listen_link_warn_once(self):
        data = self.copy_as("release", RELEASE, "Qzzzzz4")
        data["statements"]["name"] = [data["statements"]["name"][0]]
        data["statements"]["name"][0]["value"] = dict(data["statements"]["name"][0]["value"])
        self.write("release", data)
        warnings = self.warnings()
        self.assertEqual(len(warnings), 1, warnings)
        self.assertIn("Qzzzzz4.yaml: listen link https://badnama-example.bandcamp.com/album/nameless-street "
                      "is also on %s" % RELEASE, warnings[0])

    def test_different_apple_storefronts_warn_for_the_same_product(self):
        first = ds.load_yaml(self.items / "release" / (RELEASE + ".yaml"))
        second = self.copy_as("release", RELEASE, "Qzzzzz4")
        for region, data in (("us", first), ("at", second)):
            statement = data["statements"]["listen link"][0]
            statement["value"] = "https://music.apple.com/" + region + "/album/nameless-street/1576834213"
            self.write("release", data)
        warnings = self.warnings()
        self.assertEqual(len(warnings), 1, warnings)
        self.assertIn("apple album ID 1576834213 also appears on " + RELEASE, warnings[0])

    def test_same_statement_twice_warns(self):
        data = ds.load_yaml(self.items / "release" / (RELEASE + ".yaml"))
        data["statements"]["performer"].append(data["statements"]["performer"][0])
        self.write("release", data)
        self.assertEqual(self.warnings(), [
            "examples/published/items/release/%s.yaml: performer[2]: same value as performer[1]; "
            "put both references on one statement" % RELEASE])

    def test_same_value_with_other_qualifiers_is_fine(self):
        data = ds.load_yaml(self.items / "person" / (NIMA + ".yaml"))
        other = dict(data["statements"]["member of"][0], qualifiers={"role": "bass"})
        data["statements"]["member of"].append(other)
        self.write("person", data)
        self.assertEqual(self.warnings(), [])


if __name__ == "__main__":
    unittest.main()
