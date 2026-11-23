"""Role kinds and listening platforms, from the registry."""

import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import datastore as ds
import validate

EXAMPLES = ds.REPO / "data" / "examples"
RELEASE = "Qd8mk4r"


class RoleKindTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "examples"
        shutil.copytree(EXAMPLES, self.root)
        self.release = self.root / "published" / "items" / "release" / (RELEASE + ".yaml")

    def tearDown(self):
        self.tmp.cleanup()

    def errors(self):
        report = validate.Report()
        validate.validate(self.root, report)
        return report.errors

    def edit(self, old, new):
        text = self.release.read_text(encoding="utf-8")
        self.assertIn(old, text)
        self.release.write_text(text.replace(old, new), encoding="utf-8")

    def test_every_role_has_site_words(self):
        roles = set(ds.load_registry()["terms"]["role"])
        for lang in ("en", "fa"):
            words = json.loads((ds.REPO / "site" / "src" / "strings" / (lang + ".json")).read_text(encoding="utf-8"))["roles"]
            self.assertEqual(sorted(roles - set(words)), [], lang)

    def test_registry_kinds(self):
        kinds = ds.role_kinds(ds.load_registry())
        self.assertEqual(kinds["guitar"], "performance")
        self.assertEqual(kinds["producer"], "creation")
        self.assertEqual(set(kinds), set(ds.load_registry()["terms"]["role"]))

    def test_contributor_takes_only_creation_roles(self):
        self.edit("role: [composer, lyricist]", "role: [composer, guitar]")
        errors = self.errors()
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("contributor[1]: `guitar` is a performance role; it belongs under performer", errors[0])

    def test_performer_takes_only_performance_roles(self):
        self.edit("  performer:\n    - value: Q7k3m9x\n",
                  "  performer:\n    - value: Q7k3m9x\n      qualifiers:\n        role: producer\n")
        errors = self.errors()
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("performer[1]: `producer` is a creation role; it belongs under contributor", errors[0])

    def test_wrong_role_value_reports_its_kind(self):
        self.edit("role: [composer, lyricist]", 'role: {text: composer, language: en}')
        errors = self.errors()
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("qualifier role: expected a term value, got text", errors[0])

    def test_member_roles_are_not_limited(self):
        person = self.root / "published" / "items" / "person" / "Q5fd2cn.yaml"
        text = person.read_text(encoding="utf-8")
        person.write_text(text.replace("role: guitar", "role: producer"), encoding="utf-8")
        self.assertEqual(self.errors(), [])


class RegistryTableTests(unittest.TestCase):
    def check(self, fn):
        registry = copy.deepcopy(ds.load_registry())
        fn(registry)
        report = validate.Report()
        validate.check_registry(registry, report)
        return report.errors

    def test_links_take_the_platform_hosts(self):
        registry = ds.load_registry()
        hosts = [h for hs in registry["platforms"].values() for h in hs]
        self.assertEqual(registry["properties"]["listen link"]["hosts"], hosts)
        self.assertEqual(registry["properties"]["profile link"]["hosts"], hosts)

    def test_platform_of(self):
        registry = ds.load_registry()
        self.assertEqual(ds.platform_of("https://www.youtube.com/watch?v=x", registry), "youtube")
        self.assertEqual(ds.platform_of("https://foo.bandcamp.com/album/y", registry), "bandcamp")
        self.assertIsNone(ds.platform_of("https://www.radiojavan.com/x", registry))

    def test_creation_role_must_be_a_role(self):
        errors = self.check(lambda r: r["creation roles"].append("dj"))
        self.assertEqual(errors, ["data/schema/properties.yaml: creation role `dj` is not in the term list for role"])

    def test_platform_needs_hosts(self):
        errors = self.check(lambda r: r["platforms"].update(tidal=[]))
        self.assertEqual(errors, ["data/schema/properties.yaml: platform `tidal` needs a list of hosts"])


if __name__ == "__main__":
    unittest.main()
