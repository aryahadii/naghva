"""Stage 3 of the gate, in code: the measurable habits specs/artist-writing.md
names, and whether the Persian and English articles cite the same sources.

The numbers don't judge the prose; they show where an article leaves the
range the guide describes, so a reader knows where to look.
"""

import re

from gate_common import Finding, plain_text

_KEY = re.compile(r"\[\^([^\]\s]+)\]")
_SENTENCE_EN = re.compile(r"(?<=[.!?])[\"”’)]*\s+(?=[A-Z“\"‘(])")
_SENTENCE_FA = re.compile(r"(?<=[.!؟])[»”)]*\s+")

SOURCE_NOUNS = (
    "biography|website|site|page|profile|listing|catalogue|catalog|channel|post|interview|article|"
    "report|credits?|description|account|source|record|notes|announcement|entry|obituary|statement|"
    "chronology|discography|database|caption|bio|press release|release notes|liner notes"
)
SOURCE_VERBS = (
    "says?|said|gives?|gave|dates?|dated|lists?|listed|describes?|described|places?|placed|credits?|"
    "credited|names?|named|identifies|identified|records?|recorded|states?|stated|notes?|noted|calls?|"
    "called|reports?|reported|shows?|showed|presents?|presented|preserves?|bills?|billed"
)
SOURCE_SUBJECT = re.compile(
    r"^(According to\b|(His|Her|Their|Its|The|A|An|One|Another|This|That)\s+(?:[\w’'-]+\s+){0,4}?"
    r"(?:%s)\s+(?:also\s+|later\s+)?(?:%s)\b)" % (SOURCE_NOUNS, SOURCE_VERBS)
)
RECORD_VERBS = re.compile(
    r"\b(is|are|was|were|been)\s+(credited|billed|listed|dated|featured)\b"
    r"|\b(credits?|bills?|lists?)\s+(him|her|them|it|[A-Z]\w+)\s+(as|with|for|among)\b"
    r"|\bcredited\s+(as|with|to)\b|\bbilled\s+as\b"
)
THREADLESS = re.compile(r"\b(also|too|alongside)\b", re.I)
QUOTATION = re.compile(r"[“\"][^”\"]{15,}?[”\"]")
QUOTATION_FA = re.compile(r"«[^»]{40,}?»")
SOLAR_YEAR_EN = re.compile(r"\b1[34]\d\d\s*(SH|AH)\b|\bSH\b")

FA_FILLERS = re.compile(r"(?<![\w‌])(نیز|همچنین)(?![\w‌])")
FA_DOCUMENT = re.compile(r"آمده است|می‌داند|قرار می‌دهد|ثبت کرده است|ذکر شده است|اشاره شده است")
FA_HEAVY = re.compile(
    r"بر عهده داشت|بر عهده داشته|حضور یافت|مورد \S+ قرار گرفت|می‌توان به|به اجرای \S+ پرداخت|به‌عنوان|در قالب"
)

# Starting ranges, for articles long enough to have a shape (see ENRICHED).
ENRICHED = 300
BANDS = {
    "lead": (30, 110),
    "mean sentence": 21.0,
    "long sentences": 0.05,
    "threadless": 4.0,
    "fillers": 3.0,
    "quotations per 150 words": 1.0,
    "heading words": 5,
}


def sections_of(body):
    """[(heading, text)] with the lead first, under an empty heading."""
    out, heading, lines = [], "", []
    for line in body.split("\n"):
        if line.startswith("#"):
            out.append((heading, "\n".join(lines)))
            heading, lines = line.lstrip("#").strip(), []
        else:
            lines.append(line)
    out.append((heading, "\n".join(lines)))
    return out


def measure_en(body):
    sections = sections_of(body)
    text = plain_text(body)
    paragraphs = [" ".join(p.split()) for p in re.split(r"\n\s*\n", text) if p.strip()]
    sentences = [s for p in paragraphs for s in _SENTENCE_EN.split(p) if len(s.split()) > 2]
    lengths = [len(s.split()) for s in sentences]
    count = sum(len(p.split()) for p in paragraphs)
    lead = plain_text(sections[0][1])
    return {
        "words": count,
        "lead": len(lead.split()),
        "lead paragraphs": len([p for p in re.split(r"\n\s*\n", lead) if p.strip()]),
        "sections": len(sections) - 1,
        "headings": [h for h, _ in sections[1:]],
        "sentences": len(sentences),
        "mean sentence": round(sum(lengths) / len(lengths), 1) if lengths else 0.0,
        "long sentences": round(sum(n > 35 for n in lengths) / len(lengths), 3) if lengths else 0.0,
        "longest": sorted(sentences, key=lambda s: -len(s.split()))[:3],
        "source subjects": [s for s in sentences if SOURCE_SUBJECT.match(s)],
        "record verbs": [s for s in sentences if RECORD_VERBS.search(s)],
        "threadless": round(1000 * len(THREADLESS.findall(text)) / max(count, 1), 1),
        "quotations": len(QUOTATION.findall(text)),
        "solar years": [s for s in sentences if SOLAR_YEAR_EN.search(s)],
    }


def measure_fa(body):
    text = plain_text(body)
    paragraphs = [" ".join(p.split()) for p in re.split(r"\n\s*\n", text) if p.strip()]
    sentences = [s for p in paragraphs for s in _SENTENCE_FA.split(p) if len(s.split()) > 2]
    lengths = [len(s.split()) for s in sentences]
    count = sum(len(p.split()) for p in paragraphs)
    return {
        "words": count,
        "sections": len(sections_of(body)) - 1,
        "mean sentence": round(sum(lengths) / len(lengths), 1) if lengths else 0.0,
        "fillers": round(1000 * len(FA_FILLERS.findall(text)) / max(count, 1), 1),
        "document subjects": [s for s in sentences if FA_DOCUMENT.search(s)],
        "heavy verbs": [s for s in sentences if FA_HEAVY.search(s)],
        "quotations": len(QUOTATION_FA.findall(text)),
    }


def check_parity(artist):
    """The two articles carry the same sections, citing the same sources in each."""
    en, fa = artist.articles.get("en"), artist.articles.get("fa")
    if en is None or fa is None:
        missing = "Persian" if fa is None else "English"
        return [Finding("block", "two languages", "The %s article is missing" % missing)]
    findings = []
    a, b = sections_of(en.body), sections_of(fa.body)
    if len(a) != len(b):
        findings.append(Finding(
            "block", "two languages",
            "English has %d sections and Persian %d" % (len(a) - 1, len(b) - 1),
        ))
        return findings
    refs_en, refs_fa = artist.article_references("en"), artist.article_references("fa")
    differ = []
    for (heading, text_en), (_, text_fa) in zip(a, b):
        # Footnote names differ between the languages; what they cite must not.
        cited_en = {refs_en[k].source for k in _KEY.findall(text_en) if k in refs_en}
        cited_fa = {refs_fa[k].source for k in _KEY.findall(text_fa) if k in refs_fa}
        if cited_en != cited_fa:
            differ.append("%s: only in English %s; only in Persian %s" % (
                heading or "lead", ", ".join(sorted(cited_en - cited_fa)) or "none",
                ", ".join(sorted(cited_fa - cited_en)) or "none",
            ))
    if differ:
        findings.append(Finding(
            "block", "two languages", "Sections that cite different sources in the two languages", differ,
        ))
    return findings


def _clip(text, length=150):
    return text if len(text) <= length else text[:length - 1] + "…"


def check_article(artist):
    findings = check_parity(artist)
    en, fa = artist.articles.get("en"), artist.articles.get("fa")
    data, lines = {}, []
    if en is not None:
        m = data["en"] = measure_en(en.body)
        enriched = m["words"] >= ENRICHED
        lines.append(
            "English %d words · lead %d · %d sections · %.1f words a sentence · %d quotations" % (
                m["words"], m["lead"], m["sections"], m["mean sentence"], m["quotations"],
            )
        )
        if m["source subjects"]:
            findings.append(Finding(
                "fix", "people are the subjects", "Sentences whose subject is a source",
                [_clip(s) for s in m["source subjects"]],
            ))
        if m["record verbs"]:
            findings.append(Finding(
                "fix", "plain verbs", "Sentences with record-keeping verbs (credited, billed, listed)",
                [_clip(s) for s in m["record verbs"]],
            ))
        if m["solar years"]:
            findings.append(Finding(
                "fix", "dates", "English sentences with a Solar Hijri year", [_clip(s) for s in m["solar years"]],
            ))
        if enriched:
            low, high = BANDS["lead"]
            if not low <= m["lead"] <= high or m["lead paragraphs"] > 2:
                findings.append(Finding(
                    "fix", "lead", "The lead is %d words in %d paragraphs; the range is %d to %d words in "
                    "one or two" % (m["lead"], m["lead paragraphs"], low, high),
                ))
            if m["sections"] < 2:
                findings.append(Finding("fix", "sections", "An article of this length needs sections"))
            wordy = [h for h in m["headings"] if len(h.split()) > BANDS["heading words"]]
            if wordy:
                findings.append(Finding("fix", "sections", "Headings longer than five words", wordy))
            if m["mean sentence"] > BANDS["mean sentence"] or m["long sentences"] > BANDS["long sentences"]:
                findings.append(Finding(
                    "fix", "sentence length",
                    "Sentences average %.1f words and %d%% run past 35; the longest:" % (
                        m["mean sentence"], round(100 * m["long sentences"]),
                    ), [_clip(s, 260) for s in m["longest"]],
                ))
            if m["threadless"] > BANDS["threadless"]:
                findings.append(Finding(
                    "fix", "thread", "“also”, “too” and “alongside” appear %.1f times per 1,000 words"
                    % m["threadless"],
                ))
            if m["quotations"] > BANDS["quotations per 150 words"] * m["words"] / 150:
                findings.append(Finding(
                    "fix", "quotations", "%d direct quotations in %d words" % (m["quotations"], m["words"]),
                ))
    if fa is not None:
        m = data["fa"] = measure_fa(fa.body)
        lines.append(
            "Persian %d words · %.1f words a sentence · «نیز/همچنین» %.1f per 1,000" % (
                m["words"], m["mean sentence"], m["fillers"],
            )
        )
        if m["document subjects"]:
            findings.append(Finding(
                "fix", "people are the subjects", "Persian sentences where a document acts",
                [_clip(s) for s in m["document subjects"]],
            ))
        if m["heavy verbs"]:
            findings.append(Finding(
                "note", "plain verbs", "Persian sentences with wording the guide calls official or translated",
                [_clip(s) for s in m["heavy verbs"]],
            ))
        if m["words"] >= ENRICHED and m["fillers"] > BANDS["fillers"]:
            findings.append(Finding(
                "fix", "fillers", "«نیز» and «همچنین» appear %.1f times per 1,000 words" % m["fillers"],
            ))
    return " · ".join(lines) if len(lines) < 2 else lines[0] + "\n           " + lines[1], findings, data
