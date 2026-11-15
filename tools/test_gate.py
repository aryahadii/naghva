"""Tests for the enrichment gate's code checks. None of them use the network."""

import shutil
import subprocess
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from types import SimpleNamespace

import gate_article
import gate_common
import gate_quotes
import gate_record
from gate_common import platform_of, squash, tier_of


class Passages(unittest.TestCase):
    def matcher(self, text):
        return gate_quotes.PageMatcher(text, "https://example.com/page")

    def test_layout_and_typography_do_not_matter(self):
        page = self.matcher("<p>He  said: “I’m   not\nfamous.”</p> آلبوم «جنس سوم» منتشر می‌شود")
        self.assertEqual(page.match("He said: “I’m not famous.”"), "found")
        self.assertEqual(page.match("آلبوم «جنس سوم» منتشر می شود"), "found")

    def test_changed_wording_is_near_and_other_words_are_absent(self):
        page = self.matcher(
            "The band formed in Tehran in 2003 and released its first album two years later on a small label"
        )
        self.assertEqual(
            page.match("The band formed in Tehran in 2003 and released its first album two years afterwards "
                       "on a small label"),
            None,
        )
        self.assertEqual(
            page.match("the band formed in Tehran in 2003 and released its first album two years later on a "
                       "small label, they said"),
            "near",
        )
        self.assertIsNone(page.match("The band never released an album"))

    def test_a_quoted_address_matches_the_source_address(self):
        self.assertEqual(self.matcher("nothing").match("https://example.com/page"), "found")


class Fetching(unittest.TestCase):
    def setUp(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder)
        self.addCleanup(setattr, gate_common, "CACHE", gate_common.CACHE)
        gate_common.CACHE = Path(folder)

    def test_a_failed_fetch_is_tried_again(self):
        answers = iter([None, "the page"])
        fetch = lambda: next(answers)  # noqa: E731
        self.assertIsNone(gate_common._cached("plain", "https://example.com", fetch, False))
        self.assertEqual(gate_common._cached("plain", "https://example.com", fetch, False), "the page")
        self.assertEqual(gate_common._cached("plain", "https://example.com", None, False), "the page")

    def test_the_browser_text_includes_meta_contents(self):
        page = ("<title>Bezan - song by Hichkas</title>"
                "<meta property='og:description' content='Hichkas · Bezan · Song · 2021'>"
                "<body><p>Bezan</p><p>Hichkas</p>" + "<p>filler</p>" * 40)
        try:
            run = subprocess.run(
                ["node", str(gate_common.RENDER_SCRIPT), "data:text/html;charset=utf-8," + urllib.parse.quote(page)],
                capture_output=True, text=True, timeout=60,
            )
        except (OSError, subprocess.TimeoutExpired):
            self.skipTest("node is not available")
        if run.returncode == 2:
            self.skipTest("playwright is not installed")
        self.assertIn("Hichkas · Bezan · Song · 2021", run.stdout)


class Claims(unittest.TestCase):
    BODY = (
        "Lead sentence one. Lead sentence two.[^a][^b]\n\n## Early life\n\n"
        "She was born in 1980.[^born] She moved in 1999.[^moved] "
        "A closing remark that no footnote follows at all here."
    )

    def test_each_stretch_takes_the_footnotes_after_it(self):
        claims, uncited = gate_quotes.claims_of(self.BODY)
        self.assertEqual([c.keys for c in claims], [["a", "b"], ["born"], ["moved"]])
        self.assertEqual(claims[1].section, "Early life")
        self.assertEqual(len(uncited), 1)

    def test_years_read_across_calendars_and_scripts(self):
        self.assertEqual(gate_quotes.years_in("In 1999 and ۱۳۷۸, during the 1990s"), {1999, 1378})
        self.assertEqual(gate_quotes.years_in("در دههٔ ۱۳۸۰ و سال ۱۳۸۴"), {1384})
        allowed = gate_quotes._allowed_years("او در سال ۱۳۷۸ رفت")
        self.assertIn(1999, allowed)
        self.assertIn(2000, allowed)
        self.assertNotIn(2003, allowed)
        self.assertIn(1979, gate_quotes._allowed_years("انقلاب ۵۷"))


class Record(unittest.TestCase):
    def test_platforms_and_profile_shapes(self):
        self.assertEqual(platform_of("https://music.apple.com/us/album/x/1"), "Apple Music")
        self.assertEqual(platform_of("https://artist.bandcamp.com/album/x"), "Bandcamp")
        self.assertEqual(platform_of("https://t.me/channel/42"), "Telegram")
        self.assertIsNone(platform_of("https://example.com"))
        self.assertEqual(len(gate_common.PLATFORM_NAMES), len(gate_common.REGISTRY["platforms"]))
        self.assertEqual(set(gate_record.PROFILE_SHAPES), set(gate_common.PLATFORM_NAMES))
        shapes = gate_record.PROFILE_SHAPES
        self.assertTrue(shapes["Spotify"].search("https://open.spotify.com/artist/abc"))
        self.assertFalse(shapes["Spotify"].search("https://open.spotify.com/album/abc"))
        self.assertTrue(shapes["SoundCloud"].search("https://soundcloud.com/someone"))
        self.assertFalse(shapes["SoundCloud"].search("https://soundcloud.com/someone/a-song"))
        self.assertTrue(shapes["Telegram"].search("https://t.me/channel"))
        self.assertFalse(shapes["Telegram"].search("https://t.me/channel/42"))

    def test_a_source_with_no_listed_tier_counts_as_other(self):
        self.assertEqual(tier_of(SimpleNamespace(meta={"tier": "journalism"})), "journalism")
        self.assertEqual(tier_of(SimpleNamespace(meta={})), "other")

    def test_apple_ids_and_url_keys(self):
        self.assertEqual(
            gate_record._apple_ids("https://music.apple.com/us/album/a-song/123?i=456"), {"123", "456"}
        )
        self.assertEqual(
            gate_record.url_key("https://web.archive.org/web/2020/https://www.Example.com/a/"),
            gate_record.url_key("http://example.com/a"),
        )


class Article(unittest.TestCase):
    def test_source_subjects_and_record_verbs(self):
        m = gate_article.measure_en(
            "His biography dates the beginning of his work to 2017. Rian joined Jetpack in 2017. "
            "Golsa is credited as songwriter on the single."
        )
        self.assertEqual(len(m["source subjects"]), 1)
        self.assertEqual(len(m["record verbs"]), 1)

    def test_persian_fillers(self):
        m = gate_article.measure_fa("او نیز خواند. همچنین نواخت. در زندگی‌نامه آمده است که او رفت.")
        self.assertGreater(m["fillers"], 0)
        self.assertEqual(len(m["document subjects"]), 1)

    def test_squash(self):
        self.assertEqual(squash("می‌شود"), squash("می شود"))


if __name__ == "__main__":
    unittest.main()
