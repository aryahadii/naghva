"""Regression checks for conservative, read-only catalog identity review."""
from types import SimpleNamespace
import unittest

from catalog_quality import audit, platform_identity, posting_only_evidence, track_parent


class CatalogQualityTests(unittest.TestCase):
    def test_storefront_does_not_split_same_album(self):
        self.assertEqual(platform_identity("https://music.apple.com/at/album/title/123"),
                         platform_identity("https://music.apple.com/us/album/other-title/123?uo=4"))

    def test_album_and_track_are_distinct(self):
        album = "https://music.apple.com/us/album/title/123"
        track = album + "?i=456"
        self.assertNotEqual(platform_identity(track), platform_identity(album))
        self.assertEqual(platform_identity(track),
                         platform_identity("https://music.apple.com/us/song/track/456"))
        self.assertEqual(track_parent(track), platform_identity(album))
        self.assertIsNone(track_parent(album))

    def test_spotify_tracking_and_embed_do_not_split_identity(self):
        self.assertEqual(platform_identity("https://open.spotify.com/intl-de/track/aBc?si=abc"),
                         platform_identity("https://open.spotify.com/embed/track/aBc"))
        self.assertNotEqual(platform_identity("https://open.spotify.com/track/aBc"),
                            platform_identity("https://open.spotify.com/album/aBc"))

    def test_video_offsets_and_playlists_are_not_duplicate_tracks(self):
        short = "https://youtu.be/ABC123"
        watch = "https://www.youtube.com/watch?v=ABC123"
        self.assertEqual(platform_identity(short), platform_identity(watch + "&si=abc"))
        self.assertNotEqual(platform_identity(short), platform_identity(watch + "&t=90"))
        self.assertNotEqual(platform_identity(watch + "&t=20"), platform_identity(watch + "&t=90"))
        self.assertIsNone(platform_identity("https://music.youtube.com/playlist?list=PLabc"))

    def test_posting_metadata_does_not_override_release_evidence(self):
        refs = [{"locator": "Video publication date, YYYYMMDD"}]
        self.assertTrue(posting_only_evidence({"references": refs}))
        self.assertFalse(posting_only_evidence({"references": refs + [{"locator": "Label issue date"}]}))
        self.assertFalse(posting_only_evidence({"references": [{"locator": "Original release or upload date"}]}))
        self.assertFalse(posting_only_evidence({"references": []}))

    def test_audit_ignores_merge_stubs_and_deprecated_urls(self):
        album = "https://music.apple.com/us/album/title/123"
        def row(url, **kwargs):
            return SimpleNamespace(data={"type": "release", "statements": {
                "listen link": [{"value": url, **kwargs}]}})
        store = SimpleNamespace(items={
            "album": row(album),
            "track": row(album + "?i=456"),
            "same-track": row("https://music.apple.com/us/song/track/456"),
            "deprecated": row(album, rank="deprecated"),
            "stub": SimpleNamespace(data={"type": "release", "merged into": "album"}),
        })
        result = audit(store)
        self.assertEqual(result["releases"], 4)
        self.assertEqual(result["missing"]["listen link"], ["deprecated"])
        self.assertEqual(result["shared_platform_id_review"],
                         [{"identity": ("apple", "track", "456"), "items": ["same-track", "track"]}])
        self.assertEqual(result["explicit_apple_track_parent_review"], [{
            "identity": ("apple", "album", "123"), "album_items": ["album"], "track_items": ["track"]}])


if __name__ == "__main__":
    unittest.main()
