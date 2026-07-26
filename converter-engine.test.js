// Automated tests for converter-engine.js — zero dependencies, pure Node `assert`.
// Run with: node converter-engine.test.js

const assert = require('assert');
const path = require('path');
const CC = require(path.join(__dirname, 'converter-engine.js'));

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (err) { fail++; failures.push({ name, err }); console.log('  FAIL  ' + name); console.log('        ' + err.message); }
}

console.log('\n=== APA7 -> IEEE ===');

test('single-author parenthetical -> [1]', () => {
  const article = 'Hasil ini konsisten dengan temuan sebelumnya (Smith, 2020).';
  const refs = 'Smith, J. (2020). Some title. Journal A, 1(1), 1-10.';
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  assert.ok(r.convertedArticle.includes('[1]'), r.convertedArticle);
  assert.strictEqual(r.changedCount, 1);
  assert.strictEqual(r.unmatched.length, 0);
});

test('narrative -> keeps author name, appends bracket number', () => {
  const article = 'Smith (2020) menemukan bahwa X terjadi.';
  const refs = 'Smith, J. (2020). Some title. Journal A, 1(1), 1-10.';
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  assert.ok(r.convertedArticle.includes('Smith [1]'), r.convertedArticle);
});

test('two references, citation-order numbering follows first appearance', () => {
  const article = 'Awal dibahas oleh Jones (2019), lalu diperkuat oleh Smith (2020).';
  const refs = 'Smith, J. (2020). Title A. Journal A, 1(1), 1-10.\nJones, K. (2019). Title B. Journal B, 2(2), 20-30.';
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  assert.ok(r.convertedArticle.includes('Jones [1]'), r.convertedArticle);
  assert.ok(r.convertedArticle.includes('Smith [2]'), r.convertedArticle);
  assert.strictEqual(r.referenceLines[0].original.indexOf('Jones'), 0);
  assert.strictEqual(r.referenceLines[1].original.indexOf('Smith'), 0);
});

test('grouped parenthetical citation -> compressed range', () => {
  const article = 'Beberapa studi mendukung hal ini (Smith, 2020; Jones, 2019; Brown, 2021).';
  const refs = [
    'Smith, J. (2020). Title A. Journal A, 1(1), 1-10.',
    'Jones, K. (2019). Title B. Journal B, 2(2), 20-30.',
    'Brown, L. (2021). Title C. Journal C, 3(3), 30-40.',
  ].join('\n');
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  // order of first appearance in the parenthetical group: Smith, Jones, Brown (as written) —
  // since these are new refs seen for the first time in this exact group, order should follow
  // their order within the group text.
  assert.ok(/\[1\][\s\S]*\[2\][\s\S]*\[3\]|\[1\]\u2013\[3\]/.test(r.convertedArticle), r.convertedArticle);
});

test('3+ authors collapse to "et al." per APA threshold before conversion', () => {
  const article = 'Studi terbaru (Smith et al., 2022) menunjukkan hal serupa.';
  const refs = 'Smith, J., Doe, A., & Lee, K. (2022). Title. Journal A, 4(1), 1-9.';
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  assert.ok(r.convertedArticle.includes('[1]'), r.convertedArticle);
  assert.strictEqual(r.unmatched.length, 0);
});

test('unmatched citation left unchanged and flagged', () => {
  const article = 'Menurut Nobody (2099), ini tidak ada di referensi.';
  const refs = 'Smith, J. (2020). Title. Journal A, 1(1), 1-10.';
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  assert.ok(r.convertedArticle.includes('Nobody (2099)'), r.convertedArticle);
  assert.strictEqual(r.unmatched.length, 1);
});

console.log('\n=== APA7 -> Vancouver ===');

test('parenthetical -> (n) form', () => {
  const article = 'Ditemukan bahwa X (Smith, 2020).';
  const refs = 'Smith, J. (2020). Title. Journal A, 1(1), 1-10.';
  const r = CC.convert(article, refs, 'apa7', 'vancouver');
  assert.ok(r.convertedArticle.includes('(1)'), r.convertedArticle);
});

console.log('\n=== APA7 -> MLA9 ===');

test('parenthetical with page info carried over', () => {
  const article = 'Ini penting (Smith, 2020, p. 12).';
  const refs = 'Smith, J. (2020). Title. Journal A, 1(1), 1-10.';
  const r = CC.convert(article, refs, 'apa7', 'mla9');
  assert.ok(r.convertedArticle.includes('(Smith 12)'), r.convertedArticle);
});

test('two authors joined with "and"', () => {
  const article = 'Ini didukung (Smith & Jones, 2020).';
  const refs = 'Smith, J., & Jones, K. (2020). Title. Journal A, 1(1), 1-10.';
  const r = CC.convert(article, refs, 'apa7', 'mla9');
  assert.ok(r.convertedArticle.includes('Smith and Jones'), r.convertedArticle);
});

console.log('\n=== APA7 -> Harvard ===');

test('two authors joined with "and" (Harvard sep)', () => {
  const article = 'Ini didukung (Smith & Jones, 2020).';
  const refs = 'Smith, J., & Jones, K. (2020). Title. Journal A, 1(1), 1-10.';
  const r = CC.convert(article, refs, 'apa7', 'harvard');
  assert.ok(r.convertedArticle.includes('Smith and Jones, 2020'), r.convertedArticle);
});

console.log('\n=== APA7 -> Chicago ===');

test('parenthetical: no comma between author & year (Chicago rule)', () => {
  const article = 'Ini didukung (Smith, 2020).';
  const refs = 'Smith, J. (2020). Title. Journal A, 1(1), 1-10.';
  const r = CC.convert(article, refs, 'apa7', 'chicago');
  assert.ok(r.convertedArticle.includes('(Smith 2020)'), r.convertedArticle);
  assert.ok(!r.convertedArticle.includes('(Smith, 2020)'), r.convertedArticle);
});

test('4+ authors trigger et al. (Chicago threshold is 4, not 3)', () => {
  const article = 'Studi ini (Doe, Lee, Kim, & Park, 2021) menunjukkan hal serupa.';
  const refs = 'Doe, A., Lee, B., Kim, C., & Park, D. (2021). Title. Journal A, 5(1), 1-9.';
  const r = CC.convert(article, refs, 'apa7', 'chicago');
  assert.ok(r.convertedArticle.includes('Doe et al. 2021') || r.convertedArticle.includes('Doe et al.'), r.convertedArticle);
});

console.log('\n=== IEEE -> APA7 (reverse) ===');

test('bracket number -> (Author, Year)', () => {
  const article = 'Metode ini telah dibuktikan [1] pada berbagai kasus.';
  const refs = '[1] J. Smith, "Title," Journal A, vol. 1, no. 1, pp. 1-10, 2020.';
  const r = CC.convert(article, refs, 'ieee', 'apa7');
  assert.ok(r.convertedArticle.includes('(Smith, 2020)'), r.convertedArticle);
});

console.log('\n=== Vancouver -> IEEE ===');

test('paren number -> bracket number, same index preserved via reference order', () => {
  const article = 'Dibuktikan pada studi (1) sebelumnya.';
  const refs = '1. Smith J. Title. J Test. 2020;1(1):1-10.';
  const r = CC.convert(article, refs, 'vancouver', 'ieee');
  assert.ok(r.convertedArticle.includes('[1]'), r.convertedArticle);
});

console.log('\n=== Range compression ===');

test('compressRanges only merges runs of 3+ consecutive numbers (IEEE convention)', () => {
  // [1,2,3] -> 3 consecutive -> merged into "1-3".
  // [5,6] -> only 2 consecutive -> IEEE writes these separately ("[5], [6]"), not "5-6".
  // [8] -> lone number, unchanged.
  const out = CC._internal.compressRanges([1,2,3,5,6,8]);
  assert.deepStrictEqual(out, ['1-3', '5', '6', '8']);
});

test('formatNumeric: exactly two consecutive citations use a comma, not an en-dash range', () => {
  const out = CC._internal.formatNumeric([1, 2], 'ieee');
  assert.strictEqual(out, '[1], [2]');
});

test('formatNumeric: three or more consecutive citations use an en-dash range', () => {
  const out = CC._internal.formatNumeric([1, 2, 3], 'ieee');
  assert.strictEqual(out, '[1]\u2013[3]');
});

console.log('\n=== citationSpans (for UI preview) ===');

test('citationSpans covers matched and unmatched citations with correct coordinates', () => {
  const article = 'A (Smith, 2020) dan B (Nobody, 2099).';
  const refs = 'Smith, J. (2020). Title. Journal A, 1(1), 1-10.';
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  assert.strictEqual(r.citationSpans.length, 2);
  const first = r.citationSpans[0];
  assert.strictEqual(article.slice(first.start, first.end), first.original);
  assert.strictEqual(first.matched, true);
  assert.strictEqual(first.replacement, '[1]');
  const second = r.citationSpans[1];
  assert.strictEqual(second.matched, false);
  assert.strictEqual(article.slice(second.start, second.end), second.original);
});

console.log('\n=== Hyphenated given-name initials (e.g. "T.-J.") ===');

test('hyphenated initial pair stays as ONE author, not split in two', () => {
  const article = 'Metode ini diperkenalkan (Yang et al., 2018) untuk adaptasi platform.';
  const refs = 'Yang, T.-J., Howard, A., Chen, B., Zhang, X., Go, A., Sandler, M., Sze, V., & Adam, H. (2018). NetAdapt. Journal X, 1(1), 1-9.';
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  assert.strictEqual(r.unmatched.length, 0, 'Yang et al. should resolve cleanly to the reference');
  assert.ok(r.convertedArticle.includes('[1]'), r.convertedArticle);
  // First author's initials ("T.-J.") should survive intact in the converted reference line.
  assert.ok(r.referenceLines[0].line.includes('T.-J. Yang') || r.referenceLines[0].line.includes('T. J. Yang'), r.referenceLines[0].line);
});

console.log(`\n${pass} passed, ${fail} failed.\n`);
if (fail > 0) {
  failures.forEach(f => console.log('FAILED: ' + f.name + '\n' + f.err.stack + '\n'));
  process.exit(1);
}
