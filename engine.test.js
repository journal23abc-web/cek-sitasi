// Automated tests for engine.js — zero dependencies, pure Node `assert`.
// Run with: node tests/engine.test.js
// Exits with code 1 if any test fails (safe to wire into CI).

const assert = require('assert');
const path = require('path');
const CE = require(path.join(__dirname, '..', 'engine.js'));

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

test('a bare well-known institutional acronym in text ("OECD, 2023") correctly resolves/matches a reference written out in full (no false "not found" error), AND is separately flagged for not being spelled out in full on its first use, per APA7 (regression)', () => {
  const r = validate(
    'Studi menunjukkan bahwa (OECD, 2023) hal ini penting.',
    'Organisation for Economic Co-operation and Development. (2023). Title. Publisher.');
  assert.strictEqual(r.errors.some((e) => e.title === 'Sitasi tidak ada di daftar referensi'), false);
  assert.strictEqual((r.suggestions || []).length, 0);
  const firstUseErr = r.errors.find((e) => e.title === 'Singkatan institusi dipakai sebelum diperkenalkan lengkap');
  assert.ok(firstUseErr);
  assert.strictEqual(firstUseErr.correction, '(Organisation for Economic Co-operation and Development [OECD], 2023)');
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


test('the institutional-acronym-only reference suggestion is the plain full name, WITHOUT a "[ACRONYM]" bracket — APA7 puts that bracket only on the first in-text citation, never in the reference list entry itself (regression)', () => {
  const r = validate(
    'Studi menunjukkan bahwa hal ini penting.',
    'OECD. (2023). Title. Publisher.');
  const err = r.errors.find((e) => e.title.includes('singkatan'));
  assert.ok(err);
  assert.strictEqual(err.correction, 'Organisation for Economic Co-operation and Development. (2023). Title. Publisher.');
  assert.ok(!err.correction.includes('['), 'the reference-list correction must not include a bracketed acronym');
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

console.log('\n' + '='.repeat(50));
console.log(pass + ' passed, ' + fail + ' failed (of ' + (pass + fail) + ' total)');
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + f.err.message));
  process.exit(1);
}


