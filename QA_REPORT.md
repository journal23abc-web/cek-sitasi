# QA Report

## Automated regression suite

All 330 tests pass:

| Suite | Passed | Failed |
|---|---:|---:|
| Citation engine / resolver | 163 | 0 |
| DOCX link engine | 44 | 0 |
| Citation converter | 25 | 0 |
| Document statistics | 9 | 0 |
| Journal rules | 16 | 0 |
| Scopus engine | 30 | 0 |
| Term consistency | 43 | 0 |

## Real-document smoke test

Fixture: `Copyediting 1136 IJOTA.docx` (provided for this task).

| Check | Result |
|---|---:|
| Detected style | APA 7 |
| Parsed references | 35 |
| Citation links created | 53 |
| Unmatched citations | 0 |
| Plain URL/DOI links created | 32 |
| Citation-manager content controls before/after | 24 / 24 |
| Visible text preserved | Yes |
| New duplicate bookmark names | 0 |
| New unbalanced bookmark IDs | 0 |
| New nested hyperlinks | 0 |
| Serialized XML parses again | Yes |

The validator reports zero citation-to-reference cross-reference errors for this fixture. It
retains one unrelated bibliographic-metadata completeness suggestion.

## Idempotence

The link engine was run twice on the same document XML. The second pass reported 53 links as
already present, created 0 new citation links, and kept both the bookmark count and hyperlink
count stable. Visible text remained byte-for-byte identical at the paragraph-text layer.

## Safe matching policy

Automatic mode accepts only a unique high-confidence author-date match. Same-name/same-year
collisions abstain. A unique fuzzy-prefix candidate is reported for review at 55% confidence and
is not linked or converted unless permissive mode is explicitly selected.
