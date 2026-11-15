"""tools/archive.py, without the network."""

import tempfile
import unittest
from pathlib import Path

import archive
import datastore as ds

SOURCE = """---
url: https://example.com/a
title: A
status: processed
---

> words
"""


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "example.com-a.md"

    def tearDown(self):
        self.tmp.cleanup()

    def source(self, text):
        self.path.write_text(text, encoding="utf-8")
        return ds.Source(self.path, *ds.read_markdown(self.path))

    def test_archive_goes_after_the_url(self):
        self.source(SOURCE)
        archive.add_archive_line(self.path, "https://web.archive.org/web/2026/https://example.com/a")
        text = self.path.read_text(encoding="utf-8")
        self.assertEqual(text, SOURCE.replace(
            "url: https://example.com/a\n",
            'url: https://example.com/a\narchive: "https://web.archive.org/web/2026/https://example.com/a"\n'))
        self.assertFalse(archive.needs_archive(self.source(text)))

    def test_blank_archive_is_filled_in(self):
        self.source(SOURCE.replace("status:", "archive:\nstatus:"))
        archive.add_archive_line(self.path, "https://web.archive.org/web/2026/https://example.com/a")
        meta, _ = ds.read_markdown(self.path)
        self.assertEqual(meta["archive"], "https://web.archive.org/web/2026/https://example.com/a")

    def test_only_processed_web_sources_need_one(self):
        self.assertTrue(archive.needs_archive(self.source(SOURCE)))
        self.assertFalse(archive.needs_archive(self.source(SOURCE.replace("processed", "found"))))
        self.assertFalse(archive.needs_archive(self.source(SOURCE.replace("url: https://example.com/a\n", ""))))


if __name__ == "__main__":
    unittest.main()
