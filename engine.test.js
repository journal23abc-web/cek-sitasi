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

test('narrative citation position points at the actual author text, not a stripped-away prefix (regression)', () => {
  const text = 'may be insufficient in certain contexts. Conversely, Mwangi (2024) document a negative relationship.';
  const r = CE.extractAuthorDateCitations(text);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].authors, 'Mwangi');
  assert.strictEqual(text.slice(r[0].position, r[0].position + r[0].raw.length), r[0].raw);
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

console.log('\n' + '='.repeat(50));
console.log(pass + ' passed, ' + fail + ' failed (of ' + (pass + fail) + ' total)');
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + f.err.message));
  process.exit(1);
}
