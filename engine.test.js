// Automated tests for engine.js — zero dependencies, pure Node `assert`.
// Run with: node engine.test.js
// Exits with code 1 if any test fails (safe to wire into CI).

const assert = require('assert');
const path = require('path');
const CE = require(path.join(__dirname, 'engine.js'));

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (err) {
    fail++;
    failures.push({ name, err });
    console.log('  FAIL  ' + name);
    console.log('        ' + err.message);
  }
}

function validate(article, references, styleId) {
  const v = new CE.MultiFormatValidator(article, references, styleId || 'apa7');
  return v.validate();
}

function errorTitles(result) { return result.errors.map(e => e.title); }

console.log('\n=== Basic citation patterns (regression) ===');

test('single author matches cleanly', () => {
  const r = validate('Menurut penelitian (Smith, 2020), hal ini benar.',
    'Smith, J. (2020). Some title. Journal A, 1(1), 1-10.');
  assert.strictEqual(r.errors.length, 0);
});

test('two authors with & (APA) — correct', () => {
  const r = validate('Studi ini menunjukkan hasil serupa (Smith & Jones, 2020).',
    'Smith, J., & Jones, K. (2020). Some title. Journal A, 1(1), 1-10.');
  assert.strictEqual(r.errors.length, 0);
});

test('et al. required at threshold, missing -> flagged', () => {
  const r = validate('Penelitian (Smith, Jones, and Lee, 2021) menunjukkan hal ini.',
    'Smith, J., Jones, K., & Lee, M. (2021). Title. Journal B, 2(2), 5-15.');
  assert.ok(errorTitles(r).some(t => t.includes('et al.')));
});

test('narrative citation with leading discourse word still matches', () => {
  const r = validate('However, Riand and Radil (2022) found that the effect was negligible.',
    'Riand, A., & Radil, B. (2022). Some study title. Journal Z, 3(1), 10-20.');
  assert.strictEqual(r.errors.length, 0);
});

test('journal Received/Revised/Accepted metadata is not parsed as a citation', () => {
  const r = validate(
    'Judul Naskah\n\n(Received: July 03, 2023; Revised: October 21, 2023; Accepted: October 30, 2023)\n\n' +
    'Menurut penelitian (Smith, 2020), hal ini benar.',
    'Smith, J. (2020). Some title. Journal A, 1(1), 1-10.');
  assert.strictEqual(r.errors.length, 0);
});

test('n.d. (no date) citation matches', () => {
  const r = validate('Sebuah sumber online (Author, n.d.) menyatakan hal ini.',
    'Author, A. (n.d.). Title of webpage. Website Name.');
  assert.strictEqual(r.errors.length, 0);
});

test('narrative citation does not swallow the end of the previous sentence (regression)', () => {
  const r = CE.extractAuthorDateCitations(
    'Ini menjadi tantangan besar bagi Indonesian MSMEs. Suseno (2025) menyatakan bahwa hal ini penting.');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].authors, 'Suseno');
});

test('narrative citation keeps "of/for/the" inside an institutional author name (regression)', () => {
  const r = CE.extractAuthorDateCitations(
    'Menurut Institute of International Finance and Deloitte (2023), pertumbuhan sektor ini pesat.');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].authors, 'Institute of International Finance and Deloitte');
});

test('narrative citation supports "&" as an author-chain connector, not just "and"/"dan" (regression)', () => {
  assert.strictEqual(CE.extractAuthorDateCitations('Smith & Jones (2020) argued...')[0].authors, 'Smith & Jones');
  assert.strictEqual(CE.extractAuthorDateCitations('Juar-Hah & Jsaj-Mau (2019) found that...')[0].authors, 'Juar-Hah & Jsaj-Mau');
});

test('narrative citation supports "Author, (Year)" (comma before the parenthesis) as well as "Author (Year)" (regression)', () => {
  const r = CE.extractAuthorDateCitations('According to Kristiani & Pradnyadewi, (2021) the obstacles are common.');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].authors, 'Kristiani & Pradnyadewi');
  assert.strictEqual(r[0].year, '2021');
});

test('two-author "&" citation with hyphenated surnames matches its reference end to end (regression)', () => {
  const r = validate(
    'Studi oleh Juar-Hah & Jsaj-Mau (2019) menunjukkan hal ini.',
    'Juar-Hah, A., & Jsaj-Mau, B. (2019). Judul artikel. Jurnal, 1(1), 1-10.');
  assert.strictEqual(r.errors.some(e => /tidak ada di daftar referensi|tidak disitasi/.test(e.title)), false);
});

console.log('\n=== Reference-heading detection (typo tolerance, singular form, trailing identity block) ===');

test('a "References" heading with common typos is still detected', () => {
  ['Refernces', 'REFRENCES', 'Bibliograpy', 'Refrensi'].forEach((h) => {
    const text = 'Judul\n\nIsi artikel yang cukup panjang untuk lolos validasi minimal karakter di sini.\n\n' + h + '\n\nSmith, J. (2020). Title. Journal, 1(1), 1-10.';
    const split = CE.splitDocumentByReferences(text);
    assert.ok(split, 'heading "' + h + '" should have been detected');
    assert.strictEqual(split.headingIsTypo, true);
  });
});

test('confusable words like "Preference"/"Conference" are never mistaken for a typo\'d heading', () => {
  ['Preference', 'Conference'].forEach((h) => {
    const text = 'Judul\n\nIsi artikel yang cukup panjang untuk lolos validasi minimal karakter di sini.\n\n' + h + '\n\nSmith, J. (2020). Title. Journal, 1(1), 1-10.';
    const split = CE.splitDocumentByReferences(text);
    assert.strictEqual(split, null, '"' + h + '" must not be detected as a references heading');
  });
});

test('singular "Reference" (no trailing s) is detected as the heading', () => {
  const text = 'Judul\n\nIsi artikel yang cukup panjang untuk lolos validasi minimal karakter di sini.\n\nREFERENCE\n\nSmith, J. (2020). Title. Journal, 1(1), 1-10.';
  const split = CE.splitDocumentByReferences(text);
  assert.ok(split);
  assert.strictEqual(split.headingIsTypo, false);
});

test('a trailing author-identity block (corresponding author note, address, email) is discarded, not merged into the last reference', () => {
  const text = 'Judul\n\nIsi artikel.\n\nREFERENCES\n\n' +
    'Smith, J. (2020). Title one. Journal, 1(1), 1-10.\n' +
    'Jones, K. (2019). Title two. Journal, 2(1), 1-10.\n' +
    '* Jane Doe (Corresponding Author)\n' +
    'Some University, Some City\n' +
    'Email: jane@example.com';
  const split = CE.splitDocumentByReferences(text);
  const parsed = CE.parseReferenceListDetailed(split.references, 'apa7');
  assert.strictEqual(parsed.references.length, 2);
  assert.strictEqual(parsed.failedLines.length, 0);
  assert.ok(!parsed.references[1].raw.includes('Corresponding Author'));
});

test('multiple SEPARATE non-reference blocks of DIFFERENT kinds, scattered anywhere in the list, are all discarded (not just one trailing block)', () => {
  const text = 'Judul\n\nIsi artikel.\n\nREFERENCES\n\n' +
    'Smith, J. (2020). Title one. Journal, 1(1), 1-10.\n' +
    '\nACKNOWLEDGMENTS\nWe thank the reviewers for their valuable feedback and support during this research.\n\n' +
    'Jones, K. (2019). Title two. Journal, 2(1), 1-10.\n' +
    'Conflict of Interest: The authors declare no conflict of interest in this study.\n' +
    'Brown, A. (2021). Title three. Journal, 3(1), 1-10.\n' +
    '* Widia Wati (Corresponding Author)\nUniversitas Bengkulu, Indonesia\nEmail: widia@example.com\n' +
    '* Iis Sujarwati\nUniversitas Bengkulu, Indonesia\nEmail: iis@example.com\n' +
    'FUNDING STATEMENT\nThis research received no external funding from any organization whatsoever this year.\n' +
    'Data Availability: Data supporting this study are available upon reasonable request.';
  const split = CE.splitDocumentByReferences(text);
  const parsed = CE.parseReferenceListDetailed(split.references, 'apa7');
  assert.strictEqual(parsed.references.length, 3);
  assert.deepStrictEqual(parsed.references.map(r => r.firstAuthor), ['Smith, J', 'Jones, K', 'Brown, A']);
  assert.strictEqual(parsed.failedLines.length, 0);
});

test('looksLikeGenuineReference recognizes year/DOI/URL/n.d. as reference-like, rejects plain junk text', () => {
  assert.strictEqual(CE.looksLikeGenuineReference('Smith, J. (2020). Title. Journal, 1(1), 1-10.'), true);
  assert.strictEqual(CE.looksLikeGenuineReference('Author, A. (n.d.). Title. Website.'), true);
  assert.strictEqual(CE.looksLikeGenuineReference('Author, A. Title. https://example.com/x'), true);
  assert.strictEqual(CE.looksLikeGenuineReference('We thank the reviewers for their support.'), false);
  assert.strictEqual(CE.looksLikeGenuineReference('Email: someone@example.com'), false);
});

console.log('\n=== findReferencesListEnd: reference list boundary vs. trailing back-matter (real-world regression) ===');

test('an Abbreviations section (and everything after it — Appendix data tables, etc.) is excluded from the reference zone entirely', () => {
  // Reproduces a real, severe bug: a reference list with no explicit "[N]" numbering, followed
  // by "Abbreviations" and then Appendix tables whose cells (e.g. an "Author(s)" column full of
  // "Surname et al. (Year)" values) each look enough like a short reference to "successfully"
  // parse — looksLikeGenuineReference alone can't tell those apart from real references (they
  // DO have a year), so without a structural cutoff they get parsed as ~400 extra "references,"
  // physically reordered together with the ~45 genuine ones, and scatter both throughout the
  // document. The heading-based cutoff below must stop the zone at "Abbreviations", not just
  // rely on content-shape filtering.
  const text = 'Judul\n\nIsi artikel.\n\nREFERENCES\n\n' +
    'Smith, J. (2020). Title one. Journal, 1(1), 1-10.\n' +
    'Jones, K. (2019). Title two. Journal, 2(1), 1-10.\n\n' +
    'Abbreviations\nAI\tArtificial intelligence\nGenAI\tGenerative artificial intelligence\n\n' +
    'Appendices\nNo\nAuthor(s)\nYear\n1\nAcosta-Enriquez et al. (2024)\n2024\n2\nAlammar & Amin (2023)\n2023';
  const split = CE.splitDocumentByReferences(text);
  const parsed = CE.parseReferenceListDetailed(split.references, 'apa7');
  assert.strictEqual(parsed.references.length, 2);
  assert.deepStrictEqual(parsed.references.map(r => r.firstAuthor), ['Smith, J', 'Jones, K']);
  assert.ok(!split.references.includes('Acosta-Enriquez'), split.references);
  assert.ok(!split.references.includes('Abbreviations'), split.references);
});

test('a prose back-matter section (Acknowledgments) does NOT cut the reference zone off early — still handled by looksLikeGenuineReference, not the heading cutoff', () => {
  // The heading-based cutoff is deliberately narrow (Abbreviations/Appendix/Glossary-shaped
  // headings only) — it must NOT also fire on Acknowledgments/Conflict of Interest/Funding/
  // etc., since real references legitimately appear interspersed with or after those in some
  // journals, and the existing per-line content filter already handles that case correctly.
  const text = 'Judul\n\nIsi artikel.\n\nREFERENCES\n\n' +
    'Smith, J. (2020). Title one. Journal, 1(1), 1-10.\n' +
    '\nACKNOWLEDGMENTS\nWe thank the reviewers for their valuable feedback and support.\n\n' +
    'Jones, K. (2019). Title two. Journal, 2(1), 1-10.';
  const split = CE.splitDocumentByReferences(text);
  const parsed = CE.parseReferenceListDetailed(split.references, 'apa7');
  assert.strictEqual(parsed.references.length, 2);
  assert.deepStrictEqual(parsed.references.map(r => r.firstAuthor), ['Smith, J', 'Jones, K']);
});

test('findReferencesListEnd returns the full remaining text length when no trailing back-matter heading is present', () => {
  const text = 'REFERENCES\nSmith, J. (2020). Title. Journal, 1(1), 1-10.';
  const heading = CE.findReferencesHeading(text);
  const end = CE.findReferencesListEnd(text, heading.offset + heading.lineLength);
  assert.strictEqual(end, text.length);
});

test('narrative citation position points at the actual author text, not a stripped-away prefix (regression)', () => {
  const text = 'may be insufficient in certain contexts. Conversely, Mwangi (2024) document a negative relationship.';
  const r = CE.extractAuthorDateCitations(text);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].authors, 'Mwangi');
  assert.strictEqual(text.slice(r[0].position, r[0].position + r[0].raw.length), r[0].raw);
});

test('narrative citations keep two-word surnames with a common name particle intact (regression)', () => {
  const cases = [
    ['Al Amin et al. (2023) found that...', 'Al Amin et al.'],
    ['Al Amin (2023) found that...', 'Al Amin'],
    ['Van der Berg (2021) argued...', 'Van der Berg'],
    ['De la Cruz (2020) showed...', 'De la Cruz'],
    ['Bin Ahmad et al. (2022) noted...', 'Bin Ahmad et al.'],
    ['van Dijk (2020) argued...', 'van Dijk'],
    ['This aligns with van Dijk (2020), who found...', 'van Dijk'],
  ];
  cases.forEach(([text, expected]) => {
    const r = CE.extractAuthorDateCitations(text);
    assert.strictEqual(r.length, 1, 'expected exactly one citation for: ' + text);
    assert.strictEqual(r[0].authors, expected, 'for: ' + text);
  });
});

test('two-word personal names with a name particle are not misclassified as institutional (regression)', () => {
  assert.strictEqual(CE.isInstitutionalAuthor('Bin Ahmad'), false);
  assert.strictEqual(CE.isInstitutionalAuthor('Al Amin'), false);
  assert.strictEqual(CE.isInstitutionalAuthor('Van der Berg'), false);
  // real institutions must still be detected
  assert.strictEqual(CE.isInstitutionalAuthor('Bank Indonesia'), true);
  assert.strictEqual(CE.isInstitutionalAuthor('World Health Organization'), true);
});

test('citation with a two-word surname (name particle) matches its reference end to end (regression)', () => {
  const r1 = validate('Studi oleh Al Amin et al. (2023) menunjukkan hal ini.',
    'Al Amin, F., Rahman, S., & Hossain, T. (2023). Title. Journal, 1(1), 1-10.');
  assert.strictEqual(r1.errors.some(e => /tidak ada di daftar referensi|tidak disitasi/.test(e.title)), false);

  const r2 = validate('Studi oleh Bin Ahmad et al. (2022) menunjukkan hal ini.',
    'Bin Ahmad, K., Yusof, N., & Ismail, R. (2022). Title. Journal, 1(1), 1-10.');
  assert.strictEqual(r2.errors.some(e => /tidak ada di daftar referensi|tidak disitasi/.test(e.title)), false);
});

test('a statistical result reported in parentheses is not mistaken for a citation (regression)', () => {
  const r1 = CE.extractAuthorDateCitations('(Effect = \u22120.0509, p = 0.4330, 95% CI [\u22120.1808; 0.0789])');
  assert.strictEqual(r1.length, 0);
  const r2 = CE.extractAuthorDateCitations('(Effect = \u22120.1023, BootSE = 0.0568, 95% BootCI [\u22120.2098; \u22120.0162])');
  assert.strictEqual(r2.length, 0);
  // sanity: a real citation right next to similar-looking decimals still works
  const r3 = CE.extractAuthorDateCitations('as shown by the model (R\u00b2 = 0.45) (Smith, 2020).');
  assert.strictEqual(r3.length, 1);
  assert.strictEqual(r3[0].parts[0].year, '2020');
});

test('a short acronym citation matches its reference even with a trailing period (regression)', () => {
  const r = validate(
    'Internet penetration is defined per country-year (GEM, 2022), following established practice.',
    'GEM. (2022). GEM 2022. Global Entrepreneurship Monitor. https://www.gemconsortium.org/data/sets?id=aps');
  assert.strictEqual(r.errors.some(e => e.title === 'Sitasi tidak ada di daftar referensi'), false);
  assert.strictEqual(r.errors.some(e => e.title === 'Referensi tidak disitasi dalam teks'), false);
});

console.log('\n=== Regression: surnames that are also common words were stripped before "et al." and left fake "al. (Year)" citations ===');

test('"Can et al. (2023)" keeps Can as the surname instead of extracting the fake fragment "al. (2023)"', () => {
  const cites = CE.extractAuthorDateCitations('Can et al. (2023) explain how life-cycle stages affect capital expenditure.');
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].authors, 'Can et al.');
  assert.strictEqual(cites[0].raw, 'Can et al. (2023)');
});

test('the common-word-surname guard generalizes to other surnames and author connectors', () => {
  const cases = [
    ['May et al. (2024) report the same result.', 'May et al.'],
    ['Will and Stone (2022) report the same result.', 'Will and Stone'],
    ['Per & Holm (2021) report the same result.', 'Per & Holm'],
  ];
  cases.forEach(([text, expected]) => {
    const cites = CE.extractAuthorDateCitations(text);
    assert.strictEqual(cites.length, 1, text);
    assert.strictEqual(cites[0].authors, expected, text);
  });
});

test('line breaks inside "et al." do not revive the orphan "al." false positive', () => {
  const variants = [
    'Can et\nal. (2023) explain the result.',
    'Can et\r\nal. (2023) explain the result.',
    'Can et\n\nal. (2023) explain the result.',
  ];
  variants.forEach((text) => {
    const cites = CE.extractAuthorDateCitations(text);
    assert.strictEqual(cites.length, 1, JSON.stringify(text));
    assert.strictEqual(cites[0].authors.replace(/\s+/g, ' '), 'Can et al.', JSON.stringify(text));
    assert.strictEqual(/^al\./i.test(cites[0].authors), false, JSON.stringify(text));
  });
});

test('capitalized genuine surnames Al and Et remain valid while lowercase fragments stay excluded', () => {
  const cites = CE.extractAuthorDateCitations('Al (2018) and Et (2017) reported this; lowercase al. (2016) is only a fragment.');
  assert.deepStrictEqual(cites.map(c => c.authors), ['Al', 'Et']);
});

test('common-word surnames match their references end to end without false missing-citation errors', () => {
  const article = 'Can et al. (2023), May et al. (2024), and Will and Stone (2022) report consistent evidence.';
  const refs = [
    'Can, G., Demiraj, R., & Mersni, H. (2023). Life-cycle stages and capital expenditures. Journal A, 1(1), 1-10.',
    'May, A., Doe, B., & Lee, C. (2024). Evidence from another setting. Journal B, 2(1), 11-20.',
    'Will, R., & Stone, S. (2022). A two-author study. Journal C, 3(1), 21-30.',
  ].join('\n');
  const r = validate(article, refs);
  assert.strictEqual(r.citations.length, 3);
  assert.strictEqual(r.errors.some(e => e.title === 'Sitasi tidak ada di daftar referensi'), false);
  assert.strictEqual(r.errors.some(e => e.title === 'Referensi tidak disitasi dalam teks'), false);
  assert.strictEqual(r.citations.some(c => c.authors && /^al\./i.test(c.authors)), false);
});

test('hyphenated and Unicode given-name initials stay attached to their surnames', () => {
  const ref = CE.parseReferenceLine(
    'Yang, T.-J., Howard, A., & Álvarez, É. (2018). NetAdapt. Journal X, 1(1), 1-9.',
    'apa7'
  );
  assert.deepStrictEqual(ref.authors, ['Yang, T.-J.', 'Howard, A.', 'Álvarez, É']);
  assert.strictEqual(ref.authorCount, 3);
});

console.log('\n=== Unicode / international names ===');

test('normalizeTitle preserves accented Latin letters', () => {
  assert.strictEqual(CE.normalizeTitle('García López'), 'garcía lópez');
});

test('normalizeTitle preserves CJK characters', () => {
  const out = CE.normalizeTitle('李明的研究');
  assert.ok(out.includes('李') && out.includes('明'));
});

test('Spanish surname García matches cleanly', () => {
  const r = validate('Menurut García (2020), hal ini penting.',
    'García, M. (2020). Un estudio importante. Revista de Psicología, 5(1), 1-10.');
  assert.strictEqual(r.errors.length, 0);
});

test('Polish surname Łukasz matches cleanly', () => {
  const r = validate('Menurut Łukasz (2021), hal ini penting.',
    'Łukasz, K. (2021). Studium przypadku. Journal of Studies, 3(2), 20-30.');
  assert.strictEqual(r.errors.length, 0);
});

console.log('\n=== Same-surname same-year disambiguation ===');

test('initial-prefixed citation matches its reference (the core bug fix)', () => {
  const r = validate('Menurut penelitian terbaru (H. Zhang, 2023), hal ini terjadi.',
    'Zhang, H. (2023). Some study. Journal A, 1(1), 1-5.');
  assert.strictEqual(r.errors.length, 0);
});

test('different people, same surname+year, NO disambiguation -> flagged ambiguous', () => {
  const r = validate('Beberapa studi menunjukkan hal ini (Zhang, 2023).',
    'Zhang, H. (2023). Study on X. Journal A, 1(1), 1-5.\nZhang, F. (2023). Study on Y. Journal B, 2(1), 6-10.');
  assert.ok(errorTitles(r).includes('Sitasi ambigu'));
});

test('different people, same surname+year, WITH correct disambiguation -> clean', () => {
  const r = validate('H. Zhang (2023) menemukan X, sedangkan F. Zhang (2023) menemukan Y.',
    'Zhang, H. (2023). Study on X. Journal A, 1(1), 1-5.\nZhang, F. (2023). Study on Y. Journal B, 2(1), 6-10.');
  assert.strictEqual(r.errors.length, 0);
});

test('same author, two works same year -> suggests letter suffix', () => {
  const r = validate('Smith (2020) menemukan X. Smith (2020) juga menunjukkan Y.',
    'Smith, J. (2020). Study on X. Journal A, 1(1), 1-5.\nSmith, J. (2020). Study on Y. Journal B, 2(1), 6-10.');
  assert.ok(errorTitles(r).includes('Nama belakang & tahun sama, kemungkinan penulis sama'));
});

test('properly-suffixed grouped citation (APA, 2023a, 2023b) parses as two citations', () => {
  const r = validate(
    'Sebuah studi (Asosiasi Psikologi Amerika [APA], 2023a) menyatakan hal ini. Beberapa panduan (APA, 2023a, 2023b) diterbitkan.',
    'Asosiasi Psikologi Amerika. (2023a). Panduan A. Penerbit APA.\nAsosiasi Psikologi Amerika. (2023b). Panduan B. Penerbit APA.');
  assert.strictEqual(r.errors.length, 0);
});

console.log('\n=== Parse-failure detection ===');

test('unparseable reference line is reported, not silently dropped', () => {
  const r = validate('Menurut Smith (2020), hal ini benar.',
    'Smith, J. (2020). Some title. Journal A, 1(1), 1-10.\nasdkjaslkdjaslkdj random garbage text no year no author');
  assert.strictEqual(r.parseStats.totalFound, 2);
  assert.strictEqual(r.parseStats.succeededCount, 1);
  assert.strictEqual(r.parseStats.failedCount, 1);
  assert.strictEqual(r.failedLines.length, 1);
  assert.strictEqual(r.failedLines[0].lineNumber, 2);
});

test('all references parse cleanly -> failedCount is 0', () => {
  const r = validate('Menurut Smith (2020), hal ini benar.',
    'Smith, J. (2020). Some title. Journal A, 1(1), 1-10.');
  assert.strictEqual(r.parseStats.failedCount, 0);
});

console.log('\n=== Duplicate / near-duplicate detection ===');

test('duplicate DOI across two references is flagged', () => {
  const r = validate('Menurut Smith (2020) dan Jones (2019).',
    'Smith, J. (2020). Title A. Journal A, 1(1), 1-10. https://doi.org/10.1234/abc\n' +
    'Jones, K. (2019). Title B. Journal B, 2(1), 1-10. https://doi.org/10.1234/abc');
  assert.ok(errorTitles(r).includes('DOI duplikat'));
});

test('near-identical titles across two different-author references is flagged', () => {
  const r = validate('Menurut Smith (2020) dan Smyth (2020).',
    'Smith, J. (2020). The effect of leadership on performance. Journal A, 1(1), 1-10.\n' +
    'Smyth, J. (2020). The effect of leadership on performance. Journal B, 2(1), 1-10.');
  assert.ok(errorTitles(r).includes('Referensi kemungkinan duplikat'));
});

console.log('\n=== Mixed citation style detection ===');

test('numeric + author-date mixed in one document is flagged', () => {
  const r = validate(
    'Penelitian sebelumnya [1] menunjukkan X. Penelitian lain (Smith, 2020) juga menunjukkan Y.',
    'Smith, J. (2020). Title. Journal A, 1(1), 1-10.');
  assert.ok(errorTitles(r).includes('Gaya sitasi tidak konsisten'));
});

test('single consistent style is NOT flagged as mixed', () => {
  const r = validate('Menurut Smith (2020) dan Jones (2019), hal ini benar.',
    'Smith, J. (2020). Title A. Journal A, 1(1), 1-10.\nJones, K. (2019). Title B. Journal B, 2(1), 1-10.');
  assert.ok(!errorTitles(r).includes('Gaya sitasi tidak konsisten'));
});

console.log('\n=== Style auto-detection ===');

test('clean APA7 reference list detected as apa7, not tied with harvard', () => {
  const d = CE.FormatDetector.detect(
    'Menurut penelitian (Smith, 2020), hal ini benar.',
    'Smith, J. (2020). Some title about things. Journal A, 1(1), 1-10.\n' +
    'Riand, A., & Agus, B. (2021). Pengaruh disiplin kerja terhadap kinerja karyawan. Jurnal Manajemen Bisnis, 12(1), 45-60.');
  assert.strictEqual(d.styleId, 'apa7');
  assert.ok(d.scores.apa7 > d.scores.harvard, 'apa7 score should clearly beat harvard, got ' + JSON.stringify(d.scores));
});

test('clean Harvard reference list (quoted title, pp.) detected as harvard', () => {
  const d = CE.FormatDetector.detect(
    'Menurut penelitian (Smith, 2020), hal ini benar.',
    "Smith, J. (2020) 'Some title about things', Journal A, 1(1), pp. 1-10.");
  assert.strictEqual(d.styleId, 'harvard');
});

console.log('\n=== Reference formatting check (italic / case) ===');

test('APA journal article with correct italic placement -> no issues', () => {
  const refs = CE.parseReferenceList(
    'Riand, A., & Agus, B. (2021). Pengaruh disiplin kerja terhadap kinerja karyawan. Jurnal Manajemen Bisnis, 12(1), 45-60.', 'apa7');
  const raw = refs[0].raw;
  const idx = raw.indexOf('Jurnal Manajemen Bisnis, 12');
  const richLine = [
    { text: raw.slice(0, idx), italic: false },
    { text: raw.slice(idx, idx + 'Jurnal Manajemen Bisnis, 12'.length), italic: true },
    { text: raw.slice(idx + 'Jurnal Manajemen Bisnis, 12'.length), italic: false },
  ];
  const issues = CE.checkReferenceFormatting([richLine], refs, 'apa7');
  assert.strictEqual(issues.length, 0);
});

test('APA book with no italic on title -> flagged', () => {
  const refs = CE.parseReferenceList('Sugiyono. (2019). Metode penelitian kuantitatif. Alfabeta.', 'apa7');
  const richLine = [{ text: refs[0].raw, italic: false }];
  const issues = CE.checkReferenceFormatting([richLine], refs, 'apa7');
  assert.ok(issues.some(i => i.field === 'italic'));
});

console.log('\n=== DOI mismatch tolerance (online-first vs print) ===');

test('year mismatch is tolerated when ANY CrossRef date field matches', () => {
  const ref = { firstAuthor: 'Riand, A.', year: '2021', title: 'Some Study Title', styleId: 'apa7', isInstitutional: false };
  const crossRefData = {
    title: ['Some Study Title'],
    published: { 'date-parts': [[2019]] },
    'published-online': { 'date-parts': [[2019]] },
    'published-print': { 'date-parts': [[2021]] },
    author: [{ family: 'Riand', given: 'A.' }],
  };
  const cmp = CE.DOIChecker.compareMetadata(ref, crossRefData);
  assert.strictEqual(cmp.mismatches.length, 0);
});

console.log('\n=== Reference source-type detection (DOI expectations) ===');

test('book is classified as book (DOI not expected)', () => {
  const t = CE.detectSourceType('Smith, J. K. (2020). The psychology of learning (3rd ed.). Oxford University Press.');
  assert.strictEqual(t, 'book');
  assert.ok(CE.DOI_NOT_EXPECTED_TYPES[t]);
});

test('journal article is classified as journal-article (DOI expected)', () => {
  const t = CE.detectSourceType('Riand, A. (2021). Title. Jurnal Manajemen Bisnis, 12(1), 45-60.');
  assert.strictEqual(t, 'journal-article');
  assert.ok(!CE.DOI_NOT_EXPECTED_TYPES[t]);
});

console.log('\n=== Reference-list alphabetical ordering (diacritics & tie-breaking) ===');

test('a reference starting with an accented letter (Ú, É, Ñ, ...) is not wrongly flagged as out of order (regression)', () => {
  const r = validate(
    'Studi oleh Tsai (2013) dan Úbeda García et al. (2018) serta Venugopal et al. (2023) menunjukkan hal ini.',
    'Tsai, P. C.-F., & Shih, C.-T. (2013). Title. Journal, 1(1), 1-10.\n' +
    'Úbeda García, M., Claver-Cortés, E., Marco-Lajara, B., Zaragoza-sáez, P., & García-Lillo, F. (2018). Title. Journal, 2(1), 1-10.\n' +
    'Venugopal, A., Nerur, S., Yasar, M., & Rasheed, A. A. (2023). Title. Journal, 3(1), 1-10.');
  assert.strictEqual(r.errors.some(e => e.title === 'Daftar referensi tidak alfabetis'), false);
});

test('a solo-authored entry is correctly ordered before a co-authored entry with the same first surname, even when published later (regression)', () => {
  const r = validate(
    'Studi oleh Teece (2012) dan Teece et al. (1997) menunjukkan hal ini.',
    'Teece, D. (2012). Title one. Journal, 1(1), 1-10.\n' +
    'Teece, D. J., Pisano, G., & Shuen, A. (1997). Title two. Journal, 2(1), 1-10.');
  assert.strictEqual(r.errors.some(e => e.title === 'Daftar referensi tidak alfabetis'), false);
});

test('two DIFFERENT multi-author entries by the same first author sort by year, not by however many co-authors each happens to have (regression: a 3-author 2026 paper was wrongly sorted before a 4-author 2025 paper by the same lead author)', () => {
  const r = validate(
    'Studi oleh Sundari et al. (2025) dan Sundari et al. (2026) menunjukkan hal ini.',
    'Sundari, A., Armanu, Indrasari, M., & Hasbullah, M. A. (2025). Title one. Journal, 1(1), 1-10.\n' +
    'Sundari, A., Indrasari, M., & Sukesi. (2026). Title two. Journal, 2(1), 1-10.');
  assert.strictEqual(r.errors.some(e => e.title === 'Daftar referensi tidak alfabetis'), false);
});

test('a genuinely out-of-order reference list is still correctly flagged (sanity check against over-correction)', () => {
  const r = validate(
    'Studi oleh Zebra (2020) dan Apple (2019) menunjukkan hal ini.',
    'Zebra, A. (2020). Title one. Journal, 1(1), 1-10.\n' +
    'Apple, B. (2019). Title two. Journal, 2(1), 1-10.');
  assert.strictEqual(r.errors.some(e => e.title === 'Daftar referensi tidak alfabetis'), true);
});

test('a diacritic surname ("Çivitci") inside a multi-citation group is correctly sorted by its BASE letter (C, between "Bandura" and "Rienties"), not pushed to the end via raw Unicode code-point comparison (regression)', () => {
  const r = validate(
    'Beberapa studi (Çivitci, 2010; Rienties et al., 2018; Travis & Bunde, 2020) menunjukkan hal ini.',
    'Çivitci, A. (2010). Title A. Journal, 1(1), 1-10.\n' +
    'Rienties, B., et al. (2018). Title B. Journal, 2(1), 1-10.\n' +
    'Travis, C., & Bunde, D. (2020). Title C. Journal, 3(1), 1-10.');
  assert.strictEqual(r.errors.some(e => e.title === 'Multiple citations tidak alfabetis'), false);
});

test('a narrative citation with a possessive apostrophe ("Bandura\u2019s (1986) theory") correctly matches the reference "Bandura, A. (1986)" — the possessive grammar suffix must not become part of the matching key (regression)', () => {
  const r = validate(
    'Derived from Bandura\u2019s (1986) social cognitive theory, this concept is central.',
    'Bandura, A. (1986). Social foundations of thought and action. Prentice-Hall.');
  assert.strictEqual(r.errors.some(e => e.title === 'Referensi tidak disitasi dalam teks'), false);
});

test('a narrative citation with a plain straight-quote possessive ("Bandura\'s (1986)") also matches correctly', () => {
  const r = validate(
    "Derived from Bandura's (1986) social cognitive theory, this concept is central.",
    'Bandura, A. (1986). Social foundations of thought and action. Prentice-Hall.');
  assert.strictEqual(r.errors.some(e => e.title === 'Referensi tidak disitasi dalam teks'), false);
});

console.log('\n=== Malformed in-text citation format detection ===');

test('missing space before citation opening parenthesis is detected', () => {
  const issues = CE.detectMalformedCitations('Ekonomi(Agus, 2023) sangat penting.');
  const found = issues.find(i => i.type === 'no_space_before_paren');
  assert.ok(found, 'expected a no_space_before_paren issue');
  assert.strictEqual(found.raw, 'Ekonomi(Agus, 2023)');
});

test('wrong capitalization of "et al." is detected and normalized in the suggestion', () => {
  const issues = CE.detectMalformedCitations('(Agus, Et Al., 2023)');
  const found = issues.find(i => i.type === 'et_al_case');
  assert.ok(found);
  assert.strictEqual(found.raw, '(Agus, Et Al., 2023)');
  assert.ok(found.suggestion.includes('et al.') && found.suggestion.includes('Agus'), 'expected the suggestion to include author context too: ' + found.suggestion);
});

test('a missing opening parenthesis is detected, with a useful context snippet', () => {
  const issues = CE.detectMalformedCitations('Menurut Agusalim Muhammad, et al., 2020) hal ini benar.');
  const found = issues.find(i => i.type === 'missing_open_paren');
  assert.ok(found);
  assert.ok(found.raw.includes('Agusalim Muhammad'), 'expected the snippet to include enough context, got: ' + found.raw);
  assert.strictEqual(found.suggestion, null, 'no safe auto-fix is possible when there is no earlier "(" at all');
});

test('a stray closing paren in the middle of a multi-source citation list produces a full, correct, copyable suggestion (regression)', () => {
  const text = 'The reported measures of firm performance include financial and non-financial performance adopted from(Delaney & Huselid, 1996; Fu et al., 2016; Ho et al., 2024); Kim et al., 2024).';
  const issues = CE.detectMalformedCitations(text);
  const found = issues.find(i => i.type === 'missing_open_paren');
  assert.ok(found);
  assert.strictEqual(found.raw, '(Delaney & Huselid, 1996; Fu et al., 2016; Ho et al., 2024); Kim et al., 2024)');
  assert.strictEqual(found.suggestion, '(Delaney & Huselid, 1996; Fu et al., 2016; Ho et al., 2024; Kim et al., 2024)');
});

test('"et al." following two listed author names (not just the first) is flagged', () => {
  const issues = CE.detectMalformedCitations('(Agus, Supardi, et al., 2023)');
  const found = issues.find(i => i.type === 'multiple_authors_before_et_al');
  assert.ok(found);
  assert.strictEqual(found.suggestion, '(Agus et al., 2023)');
});

test('an initial before "et al." ("Smith, J. et al.") is NOT wrongly flagged as two authors', () => {
  const issues = CE.detectMalformedCitations('Menurut Smith, J. et al. (2020) hal ini benar.');
  assert.strictEqual(issues.some(i => i.type === 'multiple_authors_before_et_al'), false);
});

test('the combined example from the report (all four problems in one citation) is fully caught', () => {
  const issues = CE.detectMalformedCitations('Ekonomi(Agus, Supardi, Et Al., 2023)');
  const types = issues.map(i => i.type).sort();
  assert.deepStrictEqual(types, ['et_al_case', 'multiple_authors_before_et_al', 'no_space_before_paren']);
});

test('well-formed citations in various valid styles produce no false positives', () => {
  const clean = [
    'Studi ini didukung oleh (Smith, 2020).',
    'Menurut Smith (2020), hal ini benar.',
    'Studi ini didukung oleh (Smith et al., 2020).',
    'Studi ini didukung oleh (Smith, Jones, & Brown, 2020).',
    'Menurut Smith, J. (2020) hal ini benar.',
    'The R\u00b2 value was significant (see Table 3).',
    'The function calculateTotal(x) returns a value.',
    'Studi (Van der Berg, 2021) menunjukkan hal ini.',
    'Analisis menunjukkan hasil (p < 0.05) yang signifikan.',
    'Item (3) dalam daftar ini penting.',
    'Sebagaimana ditemukan oleh (1) faktor ekonomi, (2) faktor sosial.',
  ];
  clean.forEach((text) => {
    const issues = CE.detectMalformedCitations(text);
    assert.strictEqual(issues.length, 0, 'expected no issues for: "' + text + '", got: ' + JSON.stringify(issues.map(i => i.type)));
  });
});

test('missing period after "et al" (correct case, but no period) is detected', () => {
  const issues = CE.detectMalformedCitations('(Agus et al, 2023)');
  const found = issues.find(i => i.type === 'et_al_case');
  assert.ok(found);
  assert.ok(found.message.includes('tanpa titik'));
});

test('missing space around "&" in a citation context is detected', () => {
  const issues = CE.detectMalformedCitations('Pitelis &Wagner, (2019) demonstrated this.');
  const found = issues.find(i => i.type === 'no_space_around_ampersand');
  assert.ok(found);
  assert.strictEqual(found.suggestion, 'Pitelis & Wagner, (2019)');
});

test('"&" without a nearby year (R&D, AT&T, Q&A) is NOT flagged', () => {
  const clean = [
    'This is a research and development (R&D) department.',
    'Perusahaan AT&T meluncurkan produk baru tahun ini.',
    'Sebuah studi Q&A yang dilakukan minggu lalu.',
  ];
  clean.forEach((text) => {
    const issues = CE.detectMalformedCitations(text);
    assert.strictEqual(issues.some(i => i.type === 'no_space_around_ampersand'), false, 'false positive for: ' + text);
  });
});

test('extra space right after "(" or right before ")" is detected, including the year-only narrative style', () => {
  const issues1 = CE.detectMalformedCitations('quality management ( Gutierrez et al., 2018).');
  assert.ok(issues1.find(i => i.type === 'extra_space_in_paren'));
  const issues2 = CE.detectMalformedCitations('Studi ini (Smith, 2020 ) menunjukkan hal ini.');
  assert.ok(issues2.find(i => i.type === 'extra_space_in_paren'));
});

test('missing space after a citation\'s closing ")" is detected, including "Author, (Year)text" narrative style', () => {
  const issues1 = CE.detectMalformedCitations('(Abdeen et al., 2025)found that this is true.');
  assert.ok(issues1.find(i => i.type === 'no_space_after_paren'));
  const issues2 = CE.detectMalformedCitations('Jaleha & Machuki, (2018)claim that this is true.');
  assert.ok(issues2.find(i => i.type === 'no_space_after_paren'), 'expected the year-only-parenthetical narrative style to also be caught');
});

test('a citation followed by normal punctuation (comma, period, semicolon) is NOT flagged as missing space', () => {
  const clean = [
    'Studi (Smith, 2020), sebagaimana ditunjukkan, adalah valid.',
    'Studi (Smith, 2020). Selanjutnya, penelitian lain menunjukkan.',
    'Studi ini (Smith, 2020); dilanjutkan oleh penelitian lain.',
  ];
  clean.forEach((text) => {
    const issues = CE.detectMalformedCitations(text);
    assert.strictEqual(issues.some(i => i.type === 'no_space_after_paren'), false, 'false positive for: ' + text);
  });
});

test('malformed-citation format issues surface as validator errors with clear per-type titles', () => {
  const r = validate(
    'Ekonomi(Agus, Supardi, Et Al., 2023) sangat penting.',
    'Agus, A., & Supardi, S. (2023). Judul. Jurnal, 1(1), 1-10.');
  assert.ok(r.errors.some(e => e.title === 'Sitasi tanpa spasi sebelum tanda kurung'));
  assert.ok(r.errors.some(e => e.title === '"et al." format salah (huruf besar/kecil atau titik)'));
  assert.ok(r.errors.some(e => e.title === '"et al." mengikuti lebih dari satu nama penulis'));
});

test('malformed-citation suggestions use the dedicated "correction" field (rendered as a copyable box by the UI), not buried inside the description text', () => {
  const r = validate(
    'The reported measures of firm performance include financial and non-financial performance adopted from(Delaney & Huselid, 1996; Fu et al., 2016; Ho et al., 2024); Kim et al., 2024).',
    'Delaney, J. T., & Huselid, M. A. (1996). Title. Journal, 1(1), 1-10.\n' +
    'Fu, N. (2016). Title. Journal, 2(1), 1-10.\n' +
    'Ho, M. (2024). Title. Journal, 3(1), 1-10.\n' +
    'Kim, M. (2024). Title. Journal, 4(1), 1-10.');
  const openParenErr = r.errors.find(e => e.title === 'Tanda kurung sitasi tidak lengkap');
  assert.ok(openParenErr);
  assert.strictEqual(openParenErr.correction, '(Delaney & Huselid, 1996; Fu et al., 2016; Ho et al., 2024; Kim et al., 2024)');
  assert.ok(!openParenErr.description.includes('Saran:'), 'suggestion should live in the correction field, not be appended to the description text');

  const noSpaceErr = r.errors.find(e => e.title === 'Sitasi tanpa spasi sebelum tanda kurung');
  assert.ok(noSpaceErr);
  assert.ok(noSpaceErr.correction, 'expected a correction field for the no-space-before-paren issue too');
});

console.log('\n=== Regression: real-world false positives/negatives found via user documents ===');

test('a bare well-known institutional acronym in text ("OECD, 2023") correctly resolves/matches a reference written out in full (no false "not found" error), AND is separately flagged (as a suggestion, not a hard error — many journals don\'t strictly enforce this) for not being spelled out in full on its first use, per APA7 (regression)', () => {
  const r = validate(
    'Studi menunjukkan bahwa (OECD, 2023) hal ini penting.',
    'Organisation for Economic Co-operation and Development. (2023). Title. Publisher.');
  assert.strictEqual(r.errors.some((e) => e.title === 'Sitasi tidak ada di daftar referensi'), false);
  const firstUseSuggestion = (r.suggestions || []).find((s) => s.title === 'Singkatan institusi dipakai sebelum diperkenalkan lengkap');
  assert.ok(firstUseSuggestion);
  assert.strictEqual(firstUseSuggestion.correction, '(Organisation for Economic Co-operation and Development [OECD], 2023)');
});

test('when the acronym IS properly introduced in full first ("Full Name [ACR]"), later bare-acronym citations of the SAME institution (even a different year/publication) are correctly NOT flagged', () => {
  const r = validate(
    'Sebuah studi (Organisation for Economic Co-operation and Development [OECD], 2023a) menyatakan hal ini. Studi lain (OECD, 2023b) juga menunjukkan hal ini.',
    'Organisation for Economic Co-operation and Development. (2023a). Title A. Publisher.\n' +
    'Organisation for Economic Co-operation and Development. (2023b). Title B. Publisher.');
  assert.strictEqual(r.errors.some((e) => e.title === 'Singkatan institusi dipakai sebelum diperkenalkan lengkap'), false);
});

test('a NARRATIVE citation with "[ACR]" right before the year ("Organisation ... [OECD] (2023)") is actually extracted at all — it was previously invisible to the extractor entirely (regression)', () => {
  const cites = CE.extractAuthorDateCitations(
    'According to the Organisation for Economic Co-operation and Development [OECD] (2023), digitalization is a necessity.');
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].authors, 'Organisation for Economic Co-operation and Development [OECD]');
});

test('a narrative "Full Name [ACR] (Year)" citation correctly matches its reference with NO false "possible mismatch" suggestion, even when the institution\'s own name contains "and" (regression: the narrative branch had its own separate and-splitting bug, distinct from the parenthetical one)', () => {
  const r = validate(
    'According to the Organisation for Economic Co-operation and Development [OECD] (2023), digitalization is a necessity.',
    'Organisation for Economic Co-operation and Development [OECD] (2023). Title. Publisher.');
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual((r.suggestions || []).length, 0);
});


test('a well-known institutional acronym (OECD) in the reference list is NOT flagged at all — spelling these out is unnecessary noise since readers already recognize them (regression)', () => {
  const r = validate(
    'Studi menunjukkan bahwa hal ini penting.',
    'OECD. (2023). Title. Publisher.');
  assert.strictEqual((r.suggestions || []).some((s) => s.title.includes('singkatan')), false);
});

test('an UNRECOGNIZED institutional acronym in the reference list still gets a helpful suggestion, since a reader has no way to know what it stands for', () => {
  const r = validate(
    'Studi menunjukkan bahwa hal ini penting.',
    'ZQXP. (2023). Title. Publisher.');
  const s = (r.suggestions || []).find((e) => e.title.includes('singkatan'));
  assert.ok(s);
  assert.strictEqual(s.correction, undefined);
});

test('name particles ("le", "de", "van", ...) only match as standalone words, never as a substring inside an unrelated word (regression: "while Wang" was wrongly extracted as "le Wang")', () => {
  const text = 'target samples can improve performance, while Wang et al. (2021) demonstrated that entropy minimization reduces errors.';
  const citations = CE.extractAuthorDateCitations(text);
  assert.strictEqual(citations.length, 1);
  assert.strictEqual(citations[0].authors, 'Wang et al.');
});

test('a valid name particle at an actual word boundary still works ("Van der Berg")', () => {
  const text = 'This is confirmed by Van der Berg (2020) in a related study.';
  const citations = CE.extractAuthorDateCitations(text);
  assert.strictEqual(citations.length, 1);
  assert.ok(citations[0].authors.includes('Van der Berg'));
});

test('a sentence-initial discourse word ("Moreover", "However", ...) followed by a correctly-formatted citation is NOT flagged as two authors before "et al." (regression)', () => {
  const cases = [
    'improve performance (Koh et al., 2021). Moreover, Taori et al. (2020) found that robustness transfers poorly.',
    'this is well established. However, Smith et al. (2019) challenged this view in later work.',
    'the model performs well. Furthermore, Lee et al. (2022) extended this to other domains.',
  ];
  cases.forEach((text) => {
    const issues = CE.detectMalformedCitations(text);
    assert.strictEqual(issues.some(i => i.type === 'multiple_authors_before_et_al'), false, 'false positive for: ' + text);
  });
});

test('a genuine two-listed-authors-before-et-al issue is still caught even with the discourse-word exclusion in place', () => {
  const issues = CE.detectMalformedCitations('(Agus, Supardi, et al., 2023)');
  assert.ok(issues.some(i => i.type === 'multiple_authors_before_et_al'));
});
console.log('\n=== Regression: Filipino/Tagalog institution names with lowercase connector words (e.g. "ng" = "of") ===');

test('an institution name with a Filipino connector word ("Bangko Sentral ng Pilipinas") is correctly recognized as institutional, not misread as a personal surname', () => {
  const ref = CE.parseReferenceLine('Bangko Sentral ng Pilipinas. (2023). Summary of monetary policy decisions.', 'apa7');
  assert.strictEqual(ref.isInstitutional, true);
  assert.strictEqual(ref.firstAuthor, 'Bangko Sentral ng Pilipinas');
});

test('a narrative citation of an institution name containing a Filipino connector word is fully extracted, not truncated to just the last word', () => {
  const cites = CE.extractAuthorDateCitations('According to Bangko Sentral ng Pilipinas (2024), digital banks expanded.');
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].authors, 'Bangko Sentral ng Pilipinas');
});

test('a bare acronym ("BSP") correctly resolves to its full Filipino institution name when introduced via "Full Name (ACR)" in prose (not just inside a formal citation)', () => {
  const r = validate(
    'The Bangko Sentral ng Pilipinas (BSP) initially authorized six digital banks. This is confirmed by (BSP, 2023).',
    'Bangko Sentral ng Pilipinas. (2023). Title. Publisher.');
  assert.strictEqual(r.errors.some((e) => e.title === 'Sitasi tidak ada di daftar referensi'), false);
  assert.strictEqual(r.errors.some((e) => e.title === 'Referensi tidak disitasi dalam teks'), false);
});

console.log('\n=== Regression: "Full Name (ACR)" trailing-bracket institutions not caught by the word-shape heuristic ===');

test('an institution reference ending directly in "(ACR)" (e.g. "Philippine Statistics Authority (PSA)") is recognized as institutional even though the trailing "(PSA)" token breaks the plain word-shape check', () => {
  const ref = CE.parseReferenceLine('Philippine Statistics Authority (PSA). (2026). Summary inflation report.', 'apa7');
  assert.strictEqual(ref.isInstitutional, true);
});

test('a citation of such an institution correctly matches its reference, with no false "possible mismatch" suggestion', () => {
  const r = validate(
    'Recent trends (Gonzales, 2025; PSA, 2026) show inflation stabilizing.',
    'Gonzales, R. (2025). Title. Publisher.\nPhilippine Statistics Authority (PSA). (2026). Summary inflation report.');
  assert.strictEqual((r.suggestions || []).some((s) => s.title === 'Kemungkinan ketidakcocokan' && s.description.includes('PSA')), false);
});

console.log('\n=== Regression: table/score rank numbers wrongly counted as a "numeric citation style" ===');

test('rank numbers in a scoring table ("4.48 (1)", "4.28 (Joint 1)") are NOT counted toward "mixed citation style", even alongside genuine author-date citations', () => {
  const r = validate(
    'Results: 4.48 (1), 4.28 (Joint 1), 4.10 (3), 4.05 (4), 3.75 (10). This is supported by (Smith, 2020) and (Jones, 2021) and (Brown, 2022).',
    'Smith, A. (2020). Title. Publisher.\nJones, B. (2021). Title. Publisher.\nBrown, C. (2022). Title. Publisher.');
  assert.strictEqual(r.errors.some((e) => e.title === 'Gaya sitasi tidak konsisten'), false);
});

test('a genuinely mixed citation style (real numeric citations alongside author-date) is still correctly flagged', () => {
  const r = validate(
    'This is shown (1). Also shown (2), (3), (4), and (5). Additionally (Smith, 2020) and (Jones, 2021) and (Brown, 2022) agree.',
    'Smith, A. (2020). Title. Publisher.\nJones, B. (2021). Title. Publisher.\nBrown, C. (2022). Title. Publisher.');
  assert.strictEqual(r.errors.some((e) => e.title === 'Gaya sitasi tidak konsisten'), true);
});

console.log('\n=== Regression: grouped multi-year narrative citations silently dropping all but the first year ===');

test('a narrative citation listing several years for the same author ("Author (2020, 2024, 2025, 2026a)") extracts ALL of them, not just the first', () => {
  const cites = CE.extractAuthorDateCitations('Sources: Bangko Sentral ng Pilipinas (2020, 2024, 2025, 2026a) and Philippine Deposit Insurance Corporation (2025).');
  const bspYears = cites.filter((c) => c.authors === 'Bangko Sentral ng Pilipinas').map((c) => c.year).sort();
  assert.deepStrictEqual(bspYears, ['2020', '2024', '2025', '2026a']);
  assert.ok(cites.some((c) => c.authors === 'Philippine Deposit Insurance Corporation' && c.year === '2025'));
});

test('all four references in a grouped multi-year narrative citation correctly match their reference-list entries, with no false "not found" errors', () => {
  const r = validate(
    'Sources: Bangko Sentral ng Pilipinas (2020, 2024, 2025, 2026a) and Philippine Deposit Insurance Corporation (2025).',
    'Bangko Sentral ng Pilipinas. (2020). Title A. Publisher.\n' +
    'Bangko Sentral ng Pilipinas. (2024). Title B. Publisher.\n' +
    'Bangko Sentral ng Pilipinas. (2025). Title C. Publisher.\n' +
    'Bangko Sentral ng Pilipinas. (2026a). Title D. Publisher.\n' +
    'Philippine Deposit Insurance Corporation. (2025). Title E. Publisher.');
  assert.strictEqual(r.errors.some((e) => e.title === 'Sitasi tidak ada di daftar referensi'), false);
});



test('two references with near-identical TITLES but clearly different AUTHORS (a shared title template across different entities, e.g. bank product pages) are NOT flagged as duplicates', () => {
  const r = validate(
    'Studi (OwnBank, 2026) dan (UnionDigital Bank, 2026) menunjukkan hal ini.',
    'OwnBank. (2026). OwnBank Savings Account — interest rates and terms. Publisher.\n' +
    'UnionDigital Bank, Inc. (2026). Union Savings+ Account — interest rates and terms. Publisher.');
  assert.strictEqual(r.errors.some((e) => e.title === 'Referensi kemungkinan duplikat'), false);
});

test('a genuine duplicate (same/similar author AND near-identical title) is still correctly flagged', () => {
  const r = validate(
    'Studi (Smith, 2020a) dan (Smith, 2020b) menunjukkan hal ini.',
    'Smith, J. (2020a). The impact of digital technology on business growth outcomes. Journal A, 1(1), 1-10.\n' +
    'Smith, J. (2020b). The impact of digital technology on business growth outcome. Journal A, 1(1), 1-10.');
  assert.strictEqual(r.errors.some((e) => e.title === 'Referensi kemungkinan duplikat'), true);
});

console.log('\n=== Scopus-prep fixes: broader journal-article detection, IEEE author-list vs institution, new bibliographic fields ===');

test('detectSourceType recognizes the modern "volume, article-number" journal format (no issue-in-parens), e.g. "205, 107590" (regression)', () => {
  const ref = CE.parseReferenceLine('Smith, J., & Doe, A. (2023). Deep learning for crop disease detection. Computers and Electronics in Agriculture, 205, 107590. https://doi.org/10.1016/j.compag.2022.107590', 'apa7');
  assert.strictEqual(ref.sourceType, 'journal-article');
});

test('detectSourceType recognizes an "e"-prefixed article ID format, e.g. "14, e0251234" (PLOS/eLife style)', () => {
  assert.strictEqual(CE.detectSourceType('Jones, K. (2020). Some study. PLOS ONE, 14, e0251234.'), 'journal-article');
});

test('detectSourceType recognizes the IEEE "vol. N, p. M" abbreviated form', () => {
  const ref = CE.parseReferenceLine('[1] J. Smith and A. Doe, "Deep learning for crop disease detection," Computers and Electronics in Agriculture, vol. 205, p. 107590, 2023, doi: 10.1016/j.compag.2022.107590.', 'ieee');
  assert.strictEqual(ref.sourceType, 'journal-article');
});

test('an IEEE-style non-inverted two-person author list ("J. Smith and A. Doe") is correctly split into two individual authors, NOT misread as one institution name (regression)', () => {
  const ref = CE.parseReferenceLine('[1] J. Smith and A. Doe, "Deep learning for crop disease detection," Computers and Electronics in Agriculture, vol. 205, p. 107590, 2023, doi: 10.1016/j.compag.2022.107590.', 'ieee');
  assert.deepStrictEqual(ref.authors, ['J. Smith', 'A. Doe']);
  assert.strictEqual(ref.isInstitutional, false);
  assert.strictEqual(ref.authorCount, 2);
});

test('an institution name that legitimately contains "and" ("Organisation for Economic Co-operation and Development") is still correctly recognized as institutional (sanity check against over-correction from the fix above)', () => {
  const ref = CE.parseReferenceLine('Organisation for Economic Co-operation and Development. (2023). Title. Publisher.', 'apa7');
  assert.strictEqual(ref.isInstitutional, true);
  assert.deepStrictEqual(ref.authors, ['Organisation for Economic Co-operation and Development']);
});

test('parseReferenceLine now extracts journal, volume, issue, and pages for a classic "12(3), 100-120" reference', () => {
  const ref = CE.parseReferenceLine('Green, B. (2020). Some title here. Journal of Agriculture Science, 12(3), 100-120.', 'apa7');
  assert.strictEqual(ref.journal, 'Journal of Agriculture Science');
  assert.strictEqual(ref.volume, '12');
  assert.strictEqual(ref.issue, '3');
  assert.strictEqual(ref.pages, '100-120');
});

test('parseReferenceLine extracts articleNumber (not pages) for a "volume, article-number" reference with no page range', () => {
  const ref = CE.parseReferenceLine('Smith, J., & Doe, A. (2023). Deep learning for crop disease detection. Computers and Electronics in Agriculture, 205, 107590. https://doi.org/10.1016/j.compag.2022.107590', 'apa7');
  assert.strictEqual(ref.journal, 'Computers and Electronics in Agriculture');
  assert.strictEqual(ref.volume, '205');
  assert.strictEqual(ref.articleNumber, '107590');
  assert.strictEqual(ref.pages, null);
});

test('parseReferenceLine cleanly extracts the journal name for an IEEE-style reference, without a stray trailing comma/quote from the title boundary (regression)', () => {
  const ref = CE.parseReferenceLine('[1] J. Smith and A. Doe, "Deep learning for crop disease detection," Computers and Electronics in Agriculture, vol. 205, p. 107590, 2023, doi: 10.1016/j.compag.2022.107590.', 'ieee');
  assert.strictEqual(ref.journal, 'Computers and Electronics in Agriculture');
  assert.strictEqual(ref.volume, '205');
  assert.strictEqual(ref.pages, '107590');
});

test('parseReferenceLine extracts an explicit ISSN/eISSN when present in the reference text', () => {
  const ref = CE.parseReferenceLine('Smith, J. (2020). Title. Journal of X. ISSN: 1234-5678, eISSN: 8765-432X.', 'apa7');
  assert.strictEqual(ref.issn, '1234-5678');
  assert.strictEqual(ref.eissn, '8765-432X');
});

console.log('\n=== Regression: citation-like text before "Introduction" (e.g. "How to Cite" self-citation box) no longer falsely detected as an in-text citation ===');

test('findIntroductionHeading finds the "INTRODUCTION" heading and reports the offset right after it', () => {
  const text = 'Title page stuff.\n\nTo cite this article: Smith, J. (2026). Some Title. Journal, 1(1), 1-10.\n\nINTRODUCTION\n\nActual body content that is long enough to count as substantial.';
  const h = CE.findIntroductionHeading(text);
  assert.ok(h);
  assert.strictEqual(h.text, 'INTRODUCTION');
});

test('a "How to Cite" self-citation box before the Introduction heading is no longer flagged as "reference not cited" / "3+ authors without et al." (regression)', () => {
  const r = validate(
    'To cite this article: Shiddiq, A. K., Faiz, M. N. (2026). Some Title. Journal, 1(1), 66-81.\n\nINTRODUCTION\n\nSome real body text discussing the topic (Smith, 2020) at length, long enough to be substantial content for this test.',
    'Smith, J. (2020). Title. Publisher.');
  assert.strictEqual(r.errors.some((e) => (e.code || '').includes('Shiddiq')), false);
  assert.strictEqual(r.errors.some((e) => (e.description || '').includes('Shiddiq')), false);
});

test('a genuine citation appearing AFTER the Introduction heading is still correctly detected and matched', () => {
  const r = validate(
    'To cite this article: Shiddiq, A. K. (2026). Some Title. Journal, 1(1), 66-81.\n\nINTRODUCTION\n\nThis is discussed by Jones (2021) in detail, providing enough substantial content for the test.',
    'Jones, K. (2021). Title. Publisher.');
  assert.strictEqual(r.errors.some((e) => e.title === 'Referensi tidak disitasi dalam teks'), false);
});

test('a document with NO Introduction heading at all falls back to the old behavior (nothing filtered) — safe default, no regression for documents that lack this heading', () => {
  const r = validate(
    'To cite this article: Shiddiq, A. K., Faiz, M. N. (2026). Some Title. Journal, 1(1), 66-81.',
    'Shiddiq, A. K., & Faiz, M. N. (2026). Some Title. Journal, 1(1), 66-81.');
  // Tanpa heading Introduction, sitasi how-to-cite TETAP terdeteksi seperti perilaku lama (di
  // sini justru "cocok" karena referensinya memang ada) — poinnya adalah tidak error/crash dan
  // perilaku lama tetap berjalan sebagai fallback yang aman.
  assert.strictEqual(r.errors.some((e) => e.title === 'Referensi tidak disitasi dalam teks'), false);
});


console.log('\n=== Regression: /i flag silently making \\p{Lu} (uppercase) match lowercase letters too (JS Unicode-property + case-fold gotcha) ===');

test('a prose phrase like "At a broader international level, Titko et al. (2023)" is no longer flagged as "et al. after two authors" — the lowercase word "level" was only matching due to the /i + \\p{Lu} case-folding bug (regression)', () => {
  const issues = CE.detectMalformedCitations('AI.\n\nAt a broader international level, Titko et al. (2023) investigated staff.');
  assert.strictEqual(issues.some((i) => i.type === 'multiple_authors_before_et_al'), false);
});

test('a genuinely malformed "Word, Word et al." (both capitalized, not a place/discourse word) is still correctly flagged — sanity check that removing /i did not break real detection', () => {
  const issues = CE.detectMalformedCitations('This is shown by Smith, Jones et al. (2020) in their study.');
  assert.strictEqual(issues.some((i) => i.type === 'multiple_authors_before_et_al'), true);
});

console.log('\n=== Regression: \\b (word boundary) failing before non-ASCII letters, breaking narrative citations for internationally-accented author names ===');

test('a narrative citation whose first author name starts with a non-ASCII accented letter ("Özekinci and Eminsoy (2025)") is fully extracted, not truncated to just the second author (regression: \\b does not recognize accented letters as word characters)', () => {
  const cites = CE.extractAuthorDateCitations('Prior work. Özekinci and Eminsoy (2025) examined academicians\u2019 knowledge and attitudes.');
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].authors, 'Özekinci and Eminsoy');
});

console.log('\n=== Regression: a preposition + place name before a citation ("Outside Nigeria, Syed et al.") no longer glued onto the author chain ===');

test('"Outside Nigeria, Syed et al. (2024)" extracts cleanly as just "Syed et al. (2024)" — the leading preposition + country name are stripped, not treated as two extra author surnames', () => {
  const cites = CE.extractAuthorDateCitations('Tech is available.\n\nOutside Nigeria, Syed et al. (2024) investigated awareness of AI tools in academia.');
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].authors, 'Syed et al.');
});

test('a citation preceded by "Outside Nigeria," correctly matches its reference, with no false "not found" error', () => {
  const r = validate(
    'Tech is available.\n\nOutside Nigeria, Syed et al. (2024) investigated awareness of AI tools in academia at length.',
    'Syed, A., Ibrahim, K., & Noor, M. (2024). Title. Publisher.');
  assert.strictEqual(r.errors.some((e) => (e.code || '').includes('Outside Nigeria')), false);
});

console.log('\n=== Comprehensive audit: non-ASCII letters from many different countries/languages, not just the one Turkish case that surfaced the bug ===');

test('narrative citations with author names using non-ASCII letters from a broad range of countries are all fully extracted (not truncated), covering Turkish, Polish, Czech/Slovak, Croatian, Romanian, Vietnamese, Scandinavian, German, Spanish, and French letter systems', () => {
  const cases = [
    ['Şahin and İlhan', 'Prior work. Şahin and İlhan (2022) examined this at length in their study.'],
    ['Łukasik and Żółć', 'Prior work. Łukasik and Żółć (2021) examined this at length in their study.'],
    ['Černý and Řehák', 'Prior work. Černý and Řehák (2020) examined this at length in their study.'],
    ['Đurić and Novak', 'Prior work. Đurić and Novak (2023) examined this at length in their study.'],
    ['Șerban and Țăranu', 'Prior work. Șerban and Țăranu (2019) examined this at length in their study.'],
    ['Nguyễn and Phạm', 'Prior work. Nguyễn and Phạm (2024) examined this at length in their study.'],
    ['Åström and Østergaard', 'Prior work. Åström and Østergaard (2022) examined this at length in their study.'],
    ['Müller and Weiß', 'Prior work. Müller and Weiß (2021) examined this at length in their study.'],
    ['Muñoz and Peña', 'Prior work. Muñoz and Peña (2020) examined this at length in their study.'],
    ['Éric and François', 'Prior work. Éric and François (2023) examined this at length in their study.'],
  ];
  cases.forEach(([expectedAuthors, text]) => {
    const cites = CE.extractAuthorDateCitations(text);
    assert.strictEqual(cites.length, 1, 'gagal untuk: ' + expectedAuthors);
    assert.strictEqual(cites[0].authors, expectedAuthors, 'gagal untuk: ' + expectedAuthors);
  });
});

test('a citation with a non-ASCII author name correctly matches its reference end-to-end (full validate() pass), not just at the extraction level', () => {
  const r = validate(
    'Prior work. Şahin and İlhan (2022) examined this at length in their study of the topic.',
    'Şahin, A., & İlhan, B. (2022). Title. Publisher.');
  assert.strictEqual(r.errors.some((e) => e.title === 'Referensi tidak disitasi dalam teks'), false);
  assert.strictEqual(r.errors.some((e) => e.title === 'Sitasi tidak ada di daftar referensi'), false);
});

console.log('\n=== Regression: extractDOI truncating a DOI that legitimately ends in a parenthesized issue number ===');

test('extractDOI preserves a trailing ")" that has a matching "(" earlier in the DOI itself (e.g. Virtual Economics journal\u2019s "10.34021/ve.2023.06.03(1)") — this DOI would otherwise get silently truncated and then wrongly reported as "not found" when checked against CrossRef', () => {
  const doi = CE.extractDOI('Titko, J. (2023). Title. Virtual Economics, 6(3), 7\u201319. https://doi.org/10.34021/ve.2023.06.03(1)');
  assert.strictEqual(doi, '10.34021/ve.2023.06.03(1)');
});

test('extractDOI still correctly strips a trailing ")" that is NOT part of the DOI (e.g. the DOI sits inside a surrounding citation-style parenthetical with no matching "(" inside the DOI itself)', () => {
  const doi = CE.extractDOI('See (https://doi.org/10.1234/abcd)');
  assert.strictEqual(doi, '10.1234/abcd');
});

test('extractDOI still correctly strips ordinary trailing sentence punctuation (period, comma, semicolon) after a DOI', () => {
  assert.strictEqual(CE.extractDOI('Smith, J. (2020). Title. https://doi.org/10.1016/j.compag.2022.107590.'), '10.1016/j.compag.2022.107590');
  assert.strictEqual(CE.extractDOI('doi: 10.1234/abcd, Retrieved 2020'), '10.1234/abcd');
});

console.log('\n=== New: "citation not found" errors within a multi-citation group now name the SPECIFIC missing citation, not the whole vague group ===');

test('when only ONE citation within a multi-citation group is missing from the reference list, the error clearly names that specific citation, not just the whole ambiguous group text', () => {
  const r = validate(
    'Beberapa studi (Smith, 2020; Jones, 2021; Brown, 2022) menunjukkan hal ini.',
    'Smith, J. (2020). Title. Publisher.\nBrown, C. (2022). Title. Publisher.');
  const errs = r.errors.filter((e) => e.title === 'Sitasi tidak ada di daftar referensi');
  assert.strictEqual(errs.length, 1);
  assert.ok(errs[0].description.startsWith('Sitasi "Jones, 2021"'), 'deskripsi harus menyebut "Jones, 2021" secara eksplisit di awal: ' + errs[0].description);
  assert.ok(errs[0].description.includes('(Smith, 2020; Jones, 2021; Brown, 2022)'), 'deskripsi tetap menyertakan konteks kelompok lengkapnya');
});

test('when MULTIPLE citations within the same group are missing, each gets its own clearly-named error, not one vague combined error', () => {
  const r = validate(
    'Studi (Adams, 2019; Baker, 2020) menunjukkan hal ini.',
    'Zimmer, X. (2021). Title. Publisher.');
  const errs = r.errors.filter((e) => e.title === 'Sitasi tidak ada di daftar referensi');
  assert.strictEqual(errs.length, 2);
  assert.ok(errs.some((e) => e.description.startsWith('Sitasi "Adams, 2019"')));
  assert.ok(errs.some((e) => e.description.startsWith('Sitasi "Baker, 2020"')));
});

test('a single (non-grouped) missing citation does NOT get a redundant "part of a group" note — that phrasing is reserved for genuine multi-citation groups', () => {
  const r = validate(
    'Studi (Adams, 2019) menunjukkan hal ini.',
    'Zimmer, X. (2021). Title. Publisher.');
  const err = r.errors.find((e) => e.title === 'Sitasi tidak ada di daftar referensi');
  assert.ok(err);
  assert.strictEqual(err.description, 'Sitasi "Adams, 2019" tidak memiliki entri cocok di daftar referensi.');
});

test('the institutional-acronym "not yet introduced in full" suggestion still correctly includes the enclosing parentheses in its correction, unaffected by the citation-group raw-text change above', () => {
  const r = validate(
    'Studi menunjukkan bahwa (OECD, 2023) hal ini penting.',
    'Organisation for Economic Co-operation and Development. (2023). Title. Publisher.');
  const s = (r.suggestions || []).find((x) => x.title.includes('sebelum diperkenalkan'));
  assert.ok(s);
  assert.strictEqual(s.correction, '(Organisation for Economic Co-operation and Development [OECD], 2023)');
});

console.log('\n=== New: reference metadata completeness checking (per APA7 source-type requirements, excluding DOI which is already covered separately) ===');

test('a fully complete journal-article reference gets no completeness suggestion', () => {
  const r = validate('Studi (Green, 2020) menunjukkan hal ini.',
    'Green, B. (2020). Some title here. Journal of Agriculture Science, 12(3), 100-120.');
  assert.strictEqual(r.suggestions.some((s) => s.title === 'Metadata referensi tampak tidak lengkap'), false);
});

test('a journal-article reference missing volume/pages gets a clear completeness suggestion naming exactly what is missing', () => {
  const r = validate('Studi (Green, 2020) menunjukkan hal ini.',
    'Green, B. (2020). Some title here. Journal of Agriculture Science.');
  const s = r.suggestions.find((x) => x.title === 'Metadata referensi tampak tidak lengkap');
  assert.ok(s);
  assert.ok(s.description.includes('nomor volume'));
  assert.ok(s.description.includes('halaman atau nomor artikel'));
});

test('a fully complete book reference (with publisher) gets no completeness suggestion', () => {
  const r = validate('Studi (Adams, 2019) menunjukkan hal ini.',
    'Adams, C. (2019). Book Title (2nd ed.). Penguin Random House.');
  assert.strictEqual(r.suggestions.some((s) => s.title === 'Metadata referensi tampak tidak lengkap'), false);
});

test('a book reference missing its publisher is correctly flagged — the publisher field must not wrongly capture the title itself when no publisher segment actually exists (regression)', () => {
  const r = validate('Studi (Adams, 2019) menunjukkan hal ini.',
    'Adams, C. (2019). Book Title.');
  const s = r.suggestions.find((x) => x.title === 'Metadata referensi tampak tidak lengkap');
  assert.ok(s);
  assert.ok(s.description.includes('nama penerbit'));
});

test('a website reference with no URL at all is flagged as missing its URL/link', () => {
  const r = validate('Studi (Smith, 2020) menunjukkan hal ini.',
    'Smith, J. (2020). Retrieved from some page title.');
  const s = r.suggestions.find((x) => x.title === 'Metadata referensi tampak tidak lengkap');
  assert.ok(s);
  assert.ok(s.description.includes('URL'));
});

test('a reference whose source type could not be confidently classified ("unknown") is never flagged for missing metadata — not enough basis to say what should be there', () => {
  const r = validate('Studi (X, 2020) menunjukkan hal ini.', 'X. (2020). Some short fragment');
  assert.strictEqual(r.suggestions.some((s) => s.title === 'Metadata referensi tampak tidak lengkap'), false);
});

console.log('\n=== Regression: extractTitle only recognized "." as ending a title, swallowing everything after a "?"/"!" -titled reference\'s publisher/journal into the title itself ===');

test('extractTitle correctly stops at a title ending in "?" (a question-phrased title, valid in APA7), instead of swallowing the following publisher segment into the title', () => {
  const ref = CE.parseReferenceLine('McCarthy, J. (2007). What is artificial intelligence? Stanford University.', 'apa7');
  assert.strictEqual(ref.title, 'What is artificial intelligence?');
  assert.strictEqual(ref.publisher, 'Stanford University');
});

test('extractTitle correctly stops at a title ending in "!" too', () => {
  const ref = CE.parseReferenceLine('Doe, A. (2021). Amazing Discovery! University Press.', 'apa7');
  assert.strictEqual(ref.title, 'Amazing Discovery!');
});

test('a journal-article reference with a "vol(issue), eArticleID" shape (e.g. "22(4), e250060" — issue number kept but no page range, common in newer online-first journals) is fully recognized, not flagged as missing volume/pages', () => {
  const ref = CE.parseReferenceLine('Reis, J. F. (2025). Title. BAR \u2013 Brazilian Administration Review, 22(4), e250060.', 'apa7');
  assert.strictEqual(ref.volume, '22');
  assert.strictEqual(ref.issue, '4');
  assert.strictEqual(ref.articleNumber, 'e250060');
});

console.log('\n=== Regression: an unrelated, unclosed "(" earlier in the sentence (e.g. a structural aside like "Cluster 3 (n = 5; ...") silently made ALL subsequent narrative citations in that sentence invisible ===');

test('narrative citations sitting inside an unrelated structural parenthetical aside ("Cluster 3 (n = 5; ..., including Author (Year), Author (Year), and Author (Year))") are all correctly extracted, not silently dropped because of an unrelated unclosed "(" earlier in the sentence', () => {
  const text = 'Cluster 3 (n = 5; entrepreneurship and strategy foundations, including Nambisan (2017), Barney (1991), and Shane and Venkataraman (2000)); and Cluster 4 (n = 3; other theory, including something else here).';
  const cites = CE.extractAuthorDateCitations(text);
  const raws = cites.map((c) => c.raw);
  assert.ok(raws.includes('Nambisan (2017)'));
  assert.ok(raws.includes('Barney (1991)'));
  assert.ok(raws.includes('Shane and Venkataraman (2000)'));
});

test('a genuine parenthetical multi-citation group ("(Smith, 2020; Jones, 2021)") is still correctly de-duplicated as ONE group, not double-counted as separate narrative citations too — the fix above must not break the original de-duplication intent', () => {
  const cites = CE.extractAuthorDateCitations('Studi (Smith, 2020; Jones, 2021) menunjukkan hal ini secara meyakinkan dalam konteks luas.');
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].type, 'parenthetical');
});

test('a citation immediately following an UNRELATED reference-list-style numbered aside earlier in the same sentence is still found (broader sanity check for the same class of bug)', () => {
  const cites = CE.extractAuthorDateCitations('As noted in item (a) of the checklist, Smith (2020) recommends this approach for the study.');
  assert.ok(cites.some((c) => c.raw === 'Smith (2020)'));
});

console.log('\n=== Regression: a long common noun phrase joined by ordinary English "and" to a possessive citation got wrongly glued into one fake compound author ===');

test('"Technology Acceptance Model and Ajzen\'s (1991)" is correctly split into two separate narrative citations, not merged into one fake author "Technology Acceptance Model and Ajzen\'s"', () => {
  const text = "technology-adoption theory, including Davis's (1989) Technology Acceptance Model and Ajzen's (1991) Theory of Planned Behavior).";
  const cites = CE.extractAuthorDateCitations(text);
  const raws = cites.map((c) => c.raw);
  assert.ok(raws.includes("Davis's (1989)"));
  assert.ok(raws.includes("Ajzen's (1991)"), 'harus ada "Ajzen\'s (1991)" terpisah, bukan tergabung dengan frasa sebelumnya: ' + JSON.stringify(raws));
});

test('a genuine short two-author possessive citation ("Smith and Jones\'s (2020)") is NOT incorrectly truncated by the fix above — only long (3+ word) noun-phrase prefixes trigger the split', () => {
  const cites = CE.extractAuthorDateCitations("This supports Smith and Jones's (2020) argument on this topic overall in the field.");
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].authors, "Smith and Jones's");
});

test('these two bugs combined no longer produce false "reference not cited in text" errors for citations that were genuinely present but previously invisible to the extractor', () => {
  const article = 'Cluster 3 (n = 5; foundations, including Nambisan (2017), Barney (1991), and Shane and Venkataraman (2000)); Cluster 4 includes Davis\'s (1989) Technology Acceptance Model and Ajzen\'s (1991) Theory of Planned Behavior).';
  const refs = 'Nambisan, S. (2017). Digital entrepreneurship. Journal, 41(6), 1029-1055.\n' +
    'Barney, J. B. (1991). Firm resources. Journal of Management, 17(1), 99-120.\n' +
    'Shane, S., & Venkataraman, S. (2000). The promise of entrepreneurship. AMR, 25(1), 217-226.\n' +
    'Davis, F. D. (1989). Perceived usefulness. MIS Quarterly, 13(3), 319-340.\n' +
    'Ajzen, I. (1991). The theory of planned behavior. OBHDP, 50(2), 179-211.';
  const r = validate(article, refs);
  assert.strictEqual(r.errors.filter((e) => e.title === 'Referensi tidak disitasi dalam teks').length, 0);
});

console.log('\n=== Regression: legitimate APA7 disambiguation by naming a second author ("Author, SecondAuthor, et al., Year") — needed when two colliding same-surname-same-year references also share the same first-author initial — was flagged as malformed AND failed to match its reference ===');

test('"(Abercrombie, Bang, et al., 2022; Abercrombie, Carbonneau, et al., 2022)" — two different works by the same first author (same initial too) in the same year, disambiguated by naming a different second author for each — is NOT flagged as "et al. follows multiple names" (it is the correct, necessary APA7 disambiguation form here)', () => {
  const issues = CE.detectMalformedCitations('Findings (Abercrombie, Bang, et al., 2022; Abercrombie, Carbonneau, et al., 2022) support this claim.');
  assert.strictEqual(issues.filter((i) => i.type === 'multiple_authors_before_et_al').length, 0);
});

test('a genuine "et al. follows two names" mistake ("Smith, Jones et al., 2020") is still correctly flagged — the fix above only excludes the specific disambiguation shape, not the general mistake', () => {
  const issues = CE.detectMalformedCitations('Research by Smith, Jones et al. (2020) shows this clearly across the whole sample.');
  assert.strictEqual(issues.filter((i) => i.type === 'multiple_authors_before_et_al').length, 1);
});

test('both halves of the "Abercrombie, Bang/Carbonneau, et al., 2022" disambiguated citation group correctly match their own distinct reference — not flagged as ambiguous, and both references count as cited', () => {
  const article = 'Findings (Abercrombie, Bang, et al., 2022; Abercrombie, Carbonneau, et al., 2022) support this claim across the sample studied here overall.';
  // Four authors are intentional: after naming two, "et al." still represents TWO omitted
  // authors. With only three total authors APA7 requires listing all three instead.
  const refs = 'Abercrombie, S., Bang, H., Vaughan, A., & Smith, T. (2022). Motivational and disciplinary differences. Educational Psychology, 1(1), 1-10.\n' +
    'Abercrombie, S., Carbonneau, K. J., Hushman, C. J., & Lee, P. (2022). Re-examining academic risk taking. Journal, 2(2), 5-15.';
  const r = validate(article, refs);
  assert.strictEqual(r.errors.filter((e) => e.title === 'Sitasi ambigu').length, 0);
  assert.strictEqual(r.errors.filter((e) => e.title === 'Referensi tidak disitasi dalam teks').length, 0);
  assert.strictEqual(r.errors.filter((e) => e.title === 'Disambiguasi penulis belum sesuai APA 7').length, 0);
});

console.log('\n=== APA7 general author-sequence disambiguation (author #2, #3, #4, prefix lists, and year suffixes) ===');

test('same first author/year with DIFFERENT second authors and exactly two authors per work resolves from both explicitly named authors — no a/b suffix', () => {
  const article = '(Smith & Jones, 2020; Smith & Brown, 2020)';
  const refs = [
    'Smith, A., & Jones, B. (2020). Alpha study. Journal, 1(1), 1-10.',
    'Smith, A., & Brown, C. (2020). Beta study. Journal, 2(1), 11-20.',
  ].join('\n');
  const r = validate(article, refs);
  assert.strictEqual(r.errors.some((e) => /Sitasi ambigu|suffix a\/b|Referensi tidak disitasi/.test(e.title)), false, JSON.stringify(r.errors));
});

test('when author #1 and #2 match but author #3 differs, APA7 names through author #3 and keeps et al. when two authors remain omitted', () => {
  const article = '(Smith, Jones, Clark, et al., 2020; Smith, Jones, Brown, et al., 2020)';
  const refs = [
    'Smith, A., Jones, B., Clark, C., White, D., & Green, E. (2020). Alpha study. Journal, 1(1), 1-10.',
    'Smith, A., Jones, B., Brown, C., Black, D., & Gray, E. (2020). Beta study. Journal, 2(1), 11-20.',
  ].join('\n');
  const r = validate(article, refs);
  assert.strictEqual(r.errors.some((e) => /Sitasi ambigu|Disambiguasi penulis|Referensi tidak disitasi/.test(e.title)), false, JSON.stringify(r.errors));
});

test('when the first difference is author #4 of five, APA7 lists ALL five because et al. would represent only one omitted author', () => {
  const article = '(Smith, Jones, Clark, White, & Green, 2020; Smith, Jones, Clark, Black, & Gray, 2020)';
  const refs = [
    'Smith, A., Jones, B., Clark, C., White, D., & Green, E. (2020). Alpha study. Journal, 1(1), 1-10.',
    'Smith, A., Jones, B., Clark, C., Black, D., & Gray, E. (2020). Beta study. Journal, 2(1), 11-20.',
  ].join('\n');
  const r = validate(article, refs);
  assert.strictEqual(r.errors.some((e) => /Sitasi ambigu|Disambiguasi penulis|Bentuk nama penulis|Referensi tidak disitasi/.test(e.title)), false, JSON.stringify(r.errors));
});

test('the algorithm is not capped at author #3: a difference at author #4 of six keeps four names plus et al.', () => {
  const article = '(Smith, Jones, Clark, White, et al., 2020; Smith, Jones, Clark, Black, et al., 2020)';
  const refs = [
    'Smith, A., Jones, B., Clark, C., White, D., Green, E., & Blue, F. (2020). Alpha study. Journal, 1(1), 1-10.',
    'Smith, A., Jones, B., Clark, C., Black, D., Gray, E., & Red, F. (2020). Beta study. Journal, 2(1), 11-20.',
  ].join('\n');
  const r = validate(article, refs);
  assert.strictEqual(r.errors.some((e) => /Sitasi ambigu|Disambiguasi penulis|Referensi tidak disitasi/.test(e.title)), false, JSON.stringify(r.errors));
});

test('an under-specified short citation is rejected with both exact APA7 expanded alternatives, not guessed', () => {
  const refs = [
    'Smith, A., Jones, B., Clark, C., White, D., & Green, E. (2020). Alpha study. Journal, 1(1), 1-10.',
    'Smith, A., Jones, B., Brown, C., Black, D., & Gray, E. (2020). Beta study. Journal, 2(1), 11-20.',
  ].join('\n');
  const r = validate('(Smith et al., 2020)', refs);
  const issue = r.errors.find((e) => e.title === 'Sitasi ambigu — perlu perluas daftar penulis');
  assert.ok(issue, JSON.stringify(r.errors));
  assert.strictEqual(issue.correction, '(Smith, Jones, Clark, et al., 2020) / (Smith, Jones, Brown, et al., 2020)');
  assert.ok(issue.description.includes('Jangan menambahkan suffix a/b'));
});

test('et al. is rejected when it would replace only one author; correction lists the complete author sequence', () => {
  const refs = [
    'Smith, A., Jones, B., Clark, C., & White, D. (2020). Alpha study. Journal, 1(1), 1-10.',
    'Smith, A., Jones, B., Brown, C., & Black, D. (2020). Beta study. Journal, 2(1), 11-20.',
  ].join('\n');
  const r = validate('(Smith, Jones, Clark, et al., 2020; Smith, Jones, Brown, et al., 2020)', refs);
  const issues = r.errors.filter((e) => e.title === 'Disambiguasi penulis belum sesuai APA 7');
  assert.strictEqual(issues.length, 2, JSON.stringify(r.errors));
  assert.deepStrictEqual(issues.map((e) => e.correction), [
    '(Smith, Jones, Clark, & White, 2020)',
    '(Smith, Jones, Brown, & Black, 2020)',
  ]);
});

test('if one complete author list is a prefix of another, each work is still resolved safely without first-hit guessing', () => {
  const refs = [
    'Smith, A., Jones, B., & Clark, C. (2020). Short team. Journal, 1(1), 1-10.',
    'Smith, A., Jones, B., Clark, C., White, D., & Green, E. (2020). Long team. Journal, 2(1), 11-20.',
  ].join('\n');
  const r = validate('(Smith, Jones, & Clark, 2020; Smith, Jones, Clark, White, & Green, 2020)', refs);
  assert.strictEqual(r.errors.some((e) => /Sitasi ambigu|Referensi tidak disitasi/.test(e.title)), false, JSON.stringify(r.errors));
});

test('a/b suffixes are assigned only for IDENTICAL full author lists, alphabetically by title', () => {
  const refs = [
    'Smith, A., Jones, B., & Clark, C. (2020). Zebra study. Journal, 1(1), 1-10.',
    'Smith, A., Jones, B., & Clark, C. (2020). Alpha study. Journal, 2(1), 11-20.',
  ].join('\n');
  const r = validate('(Smith et al., 2020)', refs);
  const suffixIssue = r.errors.find((e) => e.title === 'Nama belakang & tahun sama, kemungkinan penulis sama');
  assert.ok(suffixIssue, JSON.stringify(r.errors));
  assert.ok(suffixIssue.description.includes('Alpha study -> 2020a; Zebra study -> 2020b'), suffixIssue.description);
  assert.strictEqual(r.errors.some((e) => e.title === 'Sitasi ambigu — perlu perluas daftar penulis'), false);
});

test('same surname sequence but different coauthor initials is NOT mistaken for an identical author list that needs a/b', () => {
  const refs = [
    'Smith, A., Jones, B., & Clark, C. (2020). Alpha study. Journal, 1(1), 1-10.',
    'Smith, A., Jones, D., & Clark, C. (2020). Beta study. Journal, 2(1), 11-20.',
  ].join('\n');
  const r = validate('(Smith et al., 2020)', refs);
  const issue = r.errors.find((e) => e.title === 'Sitasi ambigu — perlu perluas daftar penulis');
  assert.ok(issue, JSON.stringify(r.errors));
  assert.ok(issue.correction.includes('(Smith, B. Jones, & Clark, 2020)'), issue.correction);
  assert.ok(issue.correction.includes('(Smith, D. Jones, & Clark, 2020)'), issue.correction);
  assert.strictEqual(r.errors.some((e) => e.title === 'Nama belakang & tahun sama, kemungkinan penulis sama'), false);
});

test('references and citations already carrying distinct a/b suffixes resolve cleanly', () => {
  const refs = [
    'Smith, A., Jones, B., & Clark, C. (2020a). Alpha study. Journal, 1(1), 1-10.',
    'Smith, A., Jones, B., & Clark, C. (2020b). Zebra study. Journal, 2(1), 11-20.',
  ].join('\n');
  const r = validate('(Smith et al., 2020a; Smith et al., 2020b)', refs);
  assert.strictEqual(r.errors.some((e) => /Sitasi ambigu|Referensi tidak disitasi|suffix a\/b/.test(e.title)), false, JSON.stringify(r.errors));
});

console.log('\n=== Regression: surnames with a DOUBLE leading particle ("van der Kleij", "von der Leyen", "de la Cruz") were completely invisible to citation extraction — the optional particle prefix only consumed ONE particle word, leaving the second lowercase particle unable to match the required capitalized base-word segment ===');

test('a parenthetical citation with a double-particle surname ("(van der Kleij et al., 2015)") is correctly extracted, not silently dropped', () => {
  const cites = CE.extractAuthorDateCitations('This is discussed further (van der Kleij et al., 2015) in recent literature on the subject.');
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].parts[0].firstAuthor, 'van der Kleij');
});

test('a narrative citation with a double-particle surname ("van der Kleij et al. (2015)") is correctly extracted too', () => {
  const cites = CE.extractAuthorDateCitations('van der Kleij et al. (2015) argue that this approach improves outcomes considerably overall.');
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].authors, 'van der Kleij et al.');
});

test('full validation correctly matches a double-particle-surname citation to its reference, with no false "not cited" error', () => {
  const article = 'This is discussed further (van der Kleij et al., 2015) in recent literature on the subject overall.';
  const refs = 'van der Kleij, F. M., Vermeulen, J. A., Schildkamp, K., & Eggen, T. J. H. M. (2015). Integrating data-based decision making. Journal, 1(1), 1-10.';
  const r = validate(article, refs);
  assert.strictEqual(r.errors.filter((e) => e.title === 'Referensi tidak disitasi dalam teks').length, 0);
});

console.log('\n=== Regression: alphabetical-order checking for multiple citations used the same particle-STRIPPING normalization as citation-to-reference MATCHING — correct for matching (tolerates inconsistent particle usage), but wrong for sorting (APA7 keeps the particle as part of the sortable surname, e.g. "van der Kleij" sorts under V, not stripped to "Kleij" under K) ===');

test('a multi-citation group already in correct APA7 alphabetical order — including a particle surname sorted by its FULL form ("Lodge" < "Schildkamp" < "van der Kleij") — is NOT flagged as out of order', () => {
  const article = 'This is supported (Lodge & Corrin, 2017; Schildkamp, 2019; van der Kleij, 2015) consistently across several studies in this area.';
  const refs = 'Lodge, J. M., & Corrin, L. (2017). Title A. Journal, 1(1), 1-10.\n' +
    'Schildkamp, K. (2019). Title B. Journal, 2(2), 5-15.\n' +
    'van der Kleij, F. M. (2015). Title C. Journal, 3(3), 1-9.';
  const r = validate(article, refs);
  assert.strictEqual(r.errors.filter((e) => e.title === 'Multiple citations tidak alfabetis').length, 0);
});

test('a multi-citation group that IS genuinely out of alphabetical order is still correctly flagged — the fix above only changes how particles are sorted, not whether misordering is detected', () => {
  const article = 'This is supported (Schildkamp, 2019; Lodge & Corrin, 2017) consistently across several studies in this specific area.';
  const refs = 'Lodge, J. M., & Corrin, L. (2017). Title A. Journal, 1(1), 1-10.\n' +
    'Schildkamp, K. (2019). Title B. Journal, 2(2), 5-15.';
  const r = validate(article, refs);
  assert.strictEqual(r.errors.filter((e) => e.title === 'Multiple citations tidak alfabetis').length, 1);
});

test('a disambiguating initial does not distort alphabetical sorting — "H. Zhang" still sorts under "Zhang" (Z), not under "H"', () => {
  const article = 'Studies (Adams, 2020; H. Zhang, 2023) support this claim broadly across the research literature reviewed here.';
  const refs = 'Adams, K. (2020). Title A. Journal, 1(1), 1-10.\n' +
    'Zhang, H. (2023). Title B. Journal, 2(2), 5-15.\n' +
    'Zhang, F. (2023). Title C. Journal, 3(3), 1-9.';
  const r = validate(article, refs);
  assert.strictEqual(r.errors.filter((e) => e.title === 'Multiple citations tidak alfabetis').length, 0);
});

console.log('\n=== Regression: a legal case citation ("X v. Y (Year)") had its second party wrongly extracted as if it were a standalone academic author-date citation ===');

test('"Justice K.S. Puttaswamy (Retd.) v. Union of India (2017)" — a legal case name, not an academic citation — does not extract "Union of India (2017)" as a fake standalone citation', () => {
  const cites = CE.extractAuthorDateCitations('In Justice K.S. Puttaswamy (Retd.) v. Union of India (2017), the Supreme Court held that privacy is a fundamental right.');
  assert.strictEqual(cites.length, 0);
});

test('a genuine citation immediately after an unrelated "vs." elsewhere in the sentence is unaffected — the exclusion is narrowly scoped to text immediately preceding the match', () => {
  const cites = CE.extractAuthorDateCitations('Smith (2020) argues this differs from the older vs. newer framing used in prior debates on the topic.');
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].authors, 'Smith');
});

console.log('\n=== Regression: a short all-caps acronym at the end of unrelated prose got wrongly chained via ", and" into a genuinely separate citation ===');

test('"...actors in educational AI, and Ifenthaler et al. (2024), who stress..." correctly extracts only "Ifenthaler et al. (2024)", not "AI, and Ifenthaler et al." as one fake compound author', () => {
  const cites = CE.extractAuthorDateCitations('who emphasize the responsibilities of multiple actors in educational AI, and Ifenthaler et al. (2024), who stress meaningful human involvement.');
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].authors, 'Ifenthaler et al.');
});

test('a genuine multi-author citation using "and" is unaffected by the acronym-chaining fix above (it only excludes the specific "SHORTACRONYM, and Name et al." shape)', () => {
  const cites = CE.extractAuthorDateCitations('Smith and Jones et al. (2020) argue that this holds broadly across most contexts studied here overall.');
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].authors, 'Smith and Jones et al.');
});

console.log('\n=== Regression: a hierarchical institutional author name written with internal commas ("Legislative Department, Ministry of Law and Justice, Government of India") was wrongly split into 3 fake co-authors ===');

test('a hierarchical institutional citation with internal commas is treated as ONE author, not flagged as "3+ authors without et al."', () => {
  const cites = CE.extractAuthorDateCitations('constitutional guarantees exist (Legislative Department, Ministry of Law and Justice, Government of India, 2025) as established.');
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].parts[0].authorCount, 1);
  assert.strictEqual(cites[0].parts[0].firstAuthor, 'Legislative Department, Ministry of Law and Justice, Government of India');
});

test('a genuine 3-author citation (not institutional) still correctly splits into 3 separate authors — the fix above only affects recognized institutional names', () => {
  const cites = CE.extractAuthorDateCitations('(Smith, Jones, and Brown, 2020) show this clearly across all cases studied here overall in the sample.');
  assert.strictEqual(cites[0].parts[0].authorCount, 3);
});

test('full validation no longer flags the hierarchical institutional citation as "3+ authors without et al."', () => {
  const article = 'constitutional guarantees exist (Legislative Department, Ministry of Law and Justice, Government of India, 2025) as established under the framework.';
  const refs = 'Legislative Department, Ministry of Law and Justice, Government of India. (2025). The Constitution of India. Government of India.';
  const r = validate(article, refs);
  assert.strictEqual(r.errors.filter((e) => e.title.includes('penulis tanpa "et al."')).length, 0);
});

console.log('\n=== General resolver: institutional aliases, shortened official names, citation cues, and calendar metadata ===');

test('a bare institutional acronym is derived from the full reference author even when the document never explicitly introduces the acronym', () => {
  const article = 'The implementation is mandatory (BPKP, 2019) and shapes local reporting practice.';
  const refs = 'Badan Pengawasan Keuangan dan Pembangunan. (2019). Annual performance report. BPKP.';
  const r = validate(article, refs);
  assert.strictEqual(CE.deriveInstitutionalAcronym('Badan Pengawasan Keuangan dan Pembangunan'), 'bpkp');
  assert.strictEqual(r.errors.filter((e) => /Sitasi tidak ada|Referensi tidak disitasi/.test(e.title)).length, 0);
});

test('a shortened institution name matches a unique reference when only a jurisdiction qualifier was omitted', () => {
  const article = 'The rule remains applicable (Ministry of Home Affairs, 2018) in this setting.';
  const refs = 'Ministry of Home Affairs of the Republic of Indonesia. (2018). Regulation on village financial management. Government Press.';
  const r = validate(article, refs);
  assert.strictEqual(r.errors.filter((e) => /Sitasi tidak ada|Referensi tidak disitasi/.test(e.title)).length, 0);
  assert.strictEqual(r.suggestions.filter((e) => e.title === 'Kemungkinan ketidakcocokan').length, 0);
});

test('institution-prefix matching stays conservative: a functional tail is not treated as a removable jurisdiction qualifier', () => {
  assert.strictEqual(
    CE.institutionalNamesCompatible('Badan Pengawasan Keuangan', 'Badan Pengawasan Keuangan dan Pembangunan'),
    false
  );
});

test('leading citation cue phrases are stripped generically before narrative-author matching', () => {
  const cites = CE.extractAuthorDateCitations('Following Faul et al. (2009), the analysis was repeated. Drawing on Smith (2020), the model was extended.');
  assert.deepStrictEqual(cites.map((c) => c.authors), ['Faul et al.', 'Smith']);
});

test('complete calendar dates for letters/approvals are not extracted as citations, while a surname that is also a month remains valid', () => {
  const text = 'Authorization was issued (Letter No. 3531/ABC/2025, July 25, 2025) and renewed (Surat No. 12, 28 Juli 2025). The result follows prior work (May, 2020).';
  const cites = CE.extractAuthorDateCitations(text);
  assert.strictEqual(cites.length, 1);
  assert.strictEqual(cites[0].parts[0].firstAuthor, 'May');
  assert.strictEqual(cites[0].parts[0].year, '2020');
});

test('the combined real-world class produces neither false missing citations nor false uncited references', () => {
  const article = 'INTRODUCTION\nThe system is mandatory (BPKP, 2019; Ministry of Home Affairs, 2018). Following Faul et al. (2009), power was evaluated. Authorization was obtained (Letter No. 3531/ABC/2025, July 25, 2025).';
  const refs = [
    'Badan Pengawasan Keuangan dan Pembangunan. (2019). Annual performance report. BPKP.',
    'Faul, F., Erdfelder, E., Buchner, A., & Lang, A.-G. (2009). Statistical power analyses using G*Power. Behavior Research Methods, 41(4), 1149-1160.',
    'Ministry of Home Affairs of the Republic of Indonesia. (2018). Regulation on village financial management. Government Press.',
  ].join('\n');
  const r = validate(article, refs);
  assert.strictEqual(r.errors.filter((e) => /Sitasi tidak ada|Referensi tidak disitasi/.test(e.title)).length, 0);
});

console.log('\n=== Structured author-date resolver: confidence, reason, and abstention ===');

test('resolver returns an exact personal match with explicit confidence and reason', () => {
  const refs = CE.parseReferenceList('Smith, J. (2020). Title. Journal, 1(1), 1-10.', 'apa7');
  const d = CE.resolveAuthorDateReference('Smith', ['Smith'], '2020', refs, 'apa7', {});
  assert.strictEqual(d.status, 'matched');
  assert.strictEqual(d.reason, 'exact-personal');
  assert.strictEqual(d.confidence, 1);
  assert.strictEqual(d.autoSafe, true);
});

test('resolver explains derived acronyms and shortened institutional matches separately', () => {
  const refs = CE.parseReferenceList([
    'Badan Pengawasan Keuangan dan Pembangunan. (2019). Annual report. BPKP.',
    'Ministry of Home Affairs of the Republic of Indonesia. (2018). Regulation. Government Press.',
  ].join('\n'), 'apa7');
  const acronym = CE.resolveAuthorDateReference('BPKP', ['BPKP'], '2019', refs, 'apa7', {});
  const shortened = CE.resolveAuthorDateReference('Ministry of Home Affairs', ['Ministry of Home Affairs'], '2018', refs, 'apa7', {});
  assert.strictEqual(acronym.status, 'matched');
  assert.strictEqual(acronym.reason, 'derived-acronym');
  assert.strictEqual(acronym.confidence, 0.94);
  assert.strictEqual(shortened.status, 'matched');
  assert.strictEqual(shortened.reason, 'shortened-institution');
  assert.strictEqual(shortened.confidence, 0.90);
});

test('a unique fuzzy-prefix candidate is review-only and never auto-safe', () => {
  const refs = CE.parseReferenceList('Smith, J. (2020). Title. Journal, 1(1), 1-10.', 'apa7');
  const d = CE.resolveAuthorDateReference('Smithe', ['Smithe'], '2020', refs, 'apa7', {});
  assert.strictEqual(d.status, 'review');
  assert.strictEqual(d.reason, 'fuzzy-prefix');
  assert.strictEqual(d.confidence, 0.55);
  assert.strictEqual(d.autoSafe, false);
  assert.strictEqual(CE.findAuthorDateReferenceMatches('Smithe', ['Smithe'], '2020', refs, 'apa7', {}).length, 0);
});

test('equally strong same-surname/year candidates cause abstention instead of first-hit selection', () => {
  const refs = CE.parseReferenceList([
    'Smith, J. (2020). First title. Journal, 1(1), 1-10.',
    'Smith, K. (2020). Second title. Journal, 2(1), 11-20.',
  ].join('\n'), 'apa7');
  const d = CE.resolveAuthorDateReference('Smith', ['Smith'], '2020', refs, 'apa7', {});
  assert.strictEqual(d.status, 'ambiguous');
  assert.strictEqual(d.reason, 'multiple-candidates');
  assert.strictEqual(d.candidates.length, 2);
  assert.strictEqual(d.autoSafe, false);
});

console.log('\n=== Reference list with NO explicit bracket numbering — numeric family, order-inferred ===');

test('a numeric-family reference list with zero "[N] " prefixes gets numLabel inferred from list order', () => {
  const refs = [
    'H. Crompton and D. Burke, "Artificial intelligence in higher education," Int. J. Educ. Technol. High. Educ., vol. 20, no. 1, 2023, doi: 10.1186/x.',
    'O. Zawacki-Richter, V. I. Marín, M. Bond, and F. Gouverneur, "Systematic review," Int. J. Educ. Technol. High. Educ., vol. 16, no. 1, 2019, doi: 10.1186/y.',
  ].join('\n');
  const parsed = CE.parseReferenceListDetailed(refs, 'ieee');
  assert.strictEqual(parsed.numberingInferred, true);
  assert.strictEqual(parsed.references[0].numLabel, 1);
  assert.strictEqual(parsed.references[1].numLabel, 2);
});

test('a numeric-family reference list where entries DO carry explicit "[N] " numbers is NOT touched by inference', () => {
  const refs = [
    '[1] H. Crompton and D. Burke, "Artificial intelligence in higher education," Int. J. Educ. Technol. High. Educ., vol. 20, no. 1, 2023, doi: 10.1186/x.',
    '[2] O. Zawacki-Richter et al., "Systematic review," Int. J. Educ. Technol. High. Educ., vol. 16, no. 1, 2019, doi: 10.1186/y.',
  ].join('\n');
  const parsed = CE.parseReferenceListDetailed(refs, 'ieee');
  assert.strictEqual(parsed.numberingInferred, false);
  assert.strictEqual(parsed.references[0].numLabel, 1);
  assert.strictEqual(parsed.references[1].numLabel, 2);
});

test('an author-date family reference list (no numbering concept at all) never gets numberingInferred set', () => {
  const refs = 'Smith, J. (2020). A title. Journal A, 1(1), 1-10.';
  const parsed = CE.parseReferenceListDetailed(refs, 'apa7');
  assert.strictEqual(parsed.numberingInferred, false);
});

console.log('\n=== Multi-word surname in a non-inverted author list is not misclassified as institutional ===');

test('"D. Baidoo-Anu and L. Owusu Ansah" (2-word second surname, no comma) parses as two personal authors, not one institution', () => {
  const raw = 'D. Baidoo-Anu and L. Owusu Ansah, "Education in the era of generative artificial intelligence (AI)," J. AI, vol. 7, no. 1, pp. 52-62, 2023, doi: 10.61969/jai.1337500.';
  const ref = CE.parseReferenceLine(raw, 'ieee');
  assert.strictEqual(ref.isInstitutional, false);
  assert.deepStrictEqual(ref.authors, ['D. Baidoo-Anu', 'L. Owusu Ansah']);
});

test('a genuine institution name is unaffected by the multi-word-surname allowance above', () => {
  const raw = 'UNESCO, Guidance for Generative AI in Education and Research. Paris, France: UNESCO, 2023, doi: 10.54675/x.';
  const ref = CE.parseReferenceLine(raw, 'ieee');
  assert.strictEqual(ref.isInstitutional, true);
});

test('a 3-word-surname multi-author list still parses correctly (2 extra capitalized words allowed, not just 1)', () => {
  const raw = 'A. Van Der Berg and B. Smith, "A title," Journal A, vol. 1, p. 1, 2020, doi: 10.1/x.';
  const ref = CE.parseReferenceLine(raw, 'ieee');
  assert.strictEqual(ref.isInstitutional, false);
  assert.strictEqual(ref.authors.length, 2);
});

console.log('\n' + '='.repeat(50));
console.log(pass + ' passed, ' + fail + ' failed (of ' + (pass + fail) + ' total)');
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + f.err.message));
  process.exit(1);
}
