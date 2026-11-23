"""The Statistics page's counts that tools/stats.py makes for the site record."""

import unittest

import datastore as ds
import derive
import stats

EXAMPLES = ds.REPO / "data" / "examples"


def statement(value, rank="normal"):
    return {"value": value, "rank": rank, "references": [{"source": "s", "quote": "q", "accessed": "2026-11-10"}]}


def release(item_id, performers, day=None, links=(), label=None):
    st = {"performer": [statement(p) for p in performers], "listen link": [statement(u) for u in links]}
    if day:
        st["release date"] = [statement({"date": day, "range": [day, day]})]
    if label:
        st["published by"] = [statement(label)]
    return {"id": item_id, "type": "release", "statements": st}


def person(item_id):
    return {"id": item_id, "type": "person", "statements": {}}


class StatsTests(unittest.TestCase):
    def setUp(self):
        self.items = {
            "QA": person("QA"), "QB": person("QB"), "QC": person("QC"),
            "QR1": release("QR1", ["QA", "QB"], "2020-05-01", ["https://open.spotify.com/album/x", "https://music.apple.com/x"]),
            "QR2": release("QR2", ["QA", "QC"], "2022-01-01", ["https://foo.bandcamp.com/album/y"], label="QL"),
            "QR3": release("QR3", ["QB"]),
        }
        self.stats = stats.stats(self.items, ["QA", "QB"], {"s": {"language": "fa"}}, {"s": "own"})

    def test_counts_releases_by_their_dates(self):
        self.assertEqual(self.stats["totals"]["releases"], 3)
        self.assertEqual(self.stats["releases"]["days"], ["2020-05-01", "2022-01-01"])

    def test_an_artist_starts_at_their_earliest_dated_release(self):
        self.assertEqual(self.stats["starts"]["days"], ["2020-05-01", "2020-05-01"])

    def test_listen_links_are_grouped_by_platform(self):
        self.assertEqual(dict(self.stats["listen"]["platforms"]), {"spotify": 1, "apple": 1, "bandcamp": 1})
        self.assertEqual(self.stats["listen"]["linked"], 2)

    def test_explicit_absence_does_not_inflate_coverage(self):
        self.items["QR1"]["statements"]["listen link"].append(statement("no value", "preferred"))
        self.items["QR3"]["statements"]["published by"] = [statement("unknown value")]
        self.items["QA"]["statements"]["image"] = [statement("no value")]
        got = stats.stats(self.items, ["QA", "QB"], {}, {})
        self.assertEqual(got["listen"]["linked"], 1)
        self.assertEqual(got["listen"]["platforms"], [["bandcamp", 1]])
        self.assertEqual(got["labels"]["known"], 1)
        self.assertIn(["photo", 0, 2], got["completeness"]["artists"])

    def test_year_only_dates_count_in_the_middle_of_their_range(self):
        self.assertEqual(stats.first_day([statement({"date": "2020", "range": ["2020-01-01", "2020-12-31"]})]), "2020-07-01")

    def test_deprecated_statements_are_not_counted(self):
        self.items["QR3"]["statements"]["release date"] = [statement({"date": "1990", "range": ["1990-01-01", "1990-12-31"]}, "deprecated")]
        self.assertNotIn("1990-07-02", stats.stats(self.items, ["QA", "QB"], {}, {})["releases"]["days"])

    def test_bases_split_inside_and_abroad_and_date_leaving(self):
        def place(i, name, country=None):
            st = {"name": [statement({"text": name, "language": "en"})]}
            if country:
                st["country"] = [statement(country)]
            return {"id": i, "type": "place", "statements": st}

        def based(place_id, start=None, end=None):
            s = statement(place_id)
            q = {}
            if start:
                q["start time"] = [{"date": start, "range": [start + "-01-01", start + "-12-31"]}]
            if end:
                q["end time"] = [{"date": end, "range": [end + "-01-01", end + "-12-31"]}]
            if q:
                s["qualifiers"] = q
            return s

        items = dict(self.items)
        items.update({stats.IRAN: place(stats.IRAN, "Iran"), "QT": place("QT", "Tehran", stats.IRAN),
                      "QG": place("QG", "Germany"), "QBE": place("QBE", "Berlin", "QG")})
        berlin = based("QBE", start="2013")
        berlin["rank"] = "preferred"
        items["QA"] = {"id": "QA", "type": "person", "statements": {"based in": [based("QT", end="2012"), berlin]}}
        items["QB"] = {"id": "QB", "type": "person", "statements": {"based in": [based("QT")]}}
        got = stats.stats(items, ["QA", "QB", "QC"], {}, {})["based"]
        self.assertEqual((got["known"], got["inside"], got["abroad"]), (2, 1, 1))
        self.assertEqual(got["countries"], [["QG", 1]])
        self.assertEqual(got["left"], ["2012-07-01"])

    def test_network_links_artists_who_share_a_release_and_lays_out_the_same_each_time(self):
        net = self.stats["network"]
        self.assertEqual({n["id"] for n in net["nodes"]}, {"QA", "QB"})
        again = stats.stats(self.items, ["QA", "QB"], {}, {})["network"]
        self.assertEqual(net["nodes"], again["nodes"])

    def test_sources_cited_only_in_articles_count_as_gathered(self):
        articles = {"QA": {"en": {"notes": [{"key": "n", "source": "art", "quote": "q", "accessed": "2026-11-12"}]}}}
        gathered = lambda a: sum(n for _, n in stats.stats(self.items, ["QA", "QB"], {}, {}, a)["pace"])
        self.assertEqual(gathered(articles), gathered(None) + 1)

    def test_examples_record_carries_stats(self):
        record = derive.derive(EXAMPLES)
        self.assertEqual(record["stats"]["totals"]["artists"], len(record["artists"]))


if __name__ == "__main__":
    unittest.main()
