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

console.log('\n=== Mixed-style detection & auto-fix ===');

test('stray already-target-style citation in a source doc gets auto-fixed too (IEEE source, stray APA citation)', () => {
  const article = 'Metode ini terbukti [1] dan diperkuat oleh (Jones, 2019) dalam studi lanjutan.';
  const refs = '[1] J. Smith, "Title A," Journal A, vol. 1, no. 1, pp. 1-10, 2020.\n[2] K. Jones, "Title B," Journal B, vol. 2, no. 2, pp. 20-30, 2019.';
  const r = CC.convert(article, refs, 'ieee', 'apa7');
  assert.ok(r.convertedArticle.includes('(Jones, 2019)'), r.convertedArticle);
  assert.strictEqual(r.mixedStyleFoundCount, 1);
  assert.strictEqual(r.mixedStyleFixedCount, 1);
  assert.strictEqual(r.mixedStyleUnresolvedCount, 0);
});

test('unresolvable stray bracket citation (no numbered ref list) is flagged, not guessed', () => {
  const article = 'Hasil ini (Smith, 2020) konsisten. Studi lain [2] juga mendukung.';
  const refs = 'Smith, J. (2020). Title A. Journal A, 1(1), 1-10.\nJones, K. (2019). Title B. Journal B, 2(2), 20-30.';
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  assert.ok(r.convertedArticle.includes('[2]'), r.convertedArticle); // left as literal, unresolved
  assert.strictEqual(r.mixedStyleFoundCount, 1);
  assert.strictEqual(r.mixedStyleFixedCount, 0);
  assert.strictEqual(r.mixedStyleUnresolvedCount, 1);
  assert.ok(r.unmatched[0].crossFamily === true);
});

test('ordinary prose (stats, table/equation refs) is NOT false-flagged as mixed style', () => {
  const article = 'Hasil signifikan (p < 0.05) ditemukan (Smith, 2020). Lihat Tabel 3 dan Persamaan (5) untuk detail. Interval kepercayaan 95% (CI: 1.2-3.4) juga dilaporkan.';
  const refs = 'Smith, J. (2020). Title A. Journal A, 1(1), 1-10.';
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  assert.strictEqual(r.mixedStyleFoundCount, 0);
  assert.ok(r.convertedArticle.includes('[1]'), r.convertedArticle);
  assert.ok(r.convertedArticle.includes('Persamaan (5)'), r.convertedArticle);
  assert.ok(r.convertedArticle.includes('Tabel 3'), r.convertedArticle);
});

test('when target itself is numeric, stray bracket citations are just normal primary citations, not double-counted as "mixed"', () => {
  const article = 'Dibuktikan [1] dan [2].';
  const refs = '[1] J. Smith, "Title A," Journal A, vol. 1, no. 1, pp. 1-10, 2020.\n[2] K. Jones, "Title B," Journal B, vol. 2, no. 2, pp. 20-30, 2019.';
  const r = CC.convert(article, refs, 'ieee', 'ieee');
  assert.strictEqual(r.mixedStyleFoundCount, 0);
});

console.log('\n=== Shared safe resolver (validator/linker/converter parity) ===');

test('converter resolves a derived institutional acronym through the shared high-confidence resolver', () => {
  const article = 'The requirement applies (BPKP, 2019) across local agencies.';
  const refs = 'Badan Pengawasan Keuangan dan Pembangunan. (2019). Annual performance report. BPKP.';
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  assert.ok(r.convertedArticle.includes('[1]'), r.convertedArticle);
  assert.strictEqual(r.unmatched.length, 0);
});

test('converter abstains from a fuzzy-prefix guess instead of silently converting the wrong citation', () => {
  const article = 'Prior work (Smithe, 2020) supports this claim.';
  const refs = 'Smith, J. (2020). Title. Journal, 1(1), 1-10.';
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  assert.ok(r.convertedArticle.includes('(Smithe, 2020)'), r.convertedArticle);
  assert.strictEqual(r.unmatched.length, 1);
  assert.ok(!r.convertedArticle.includes('[1]'), r.convertedArticle);
});

test('converter resolves APA7 collisions from an arbitrary-length explicit author prefix, matching validator/linker behavior', () => {
  const article = 'Both studies apply (Smith, Jones, Clark, et al., 2020; Smith, Jones, Brown, et al., 2020).';
  const refs = [
    'Smith, A., Jones, B., Clark, C., White, D., & Green, E. (2020). Alpha study. Journal, 1(1), 1-10.',
    'Smith, A., Jones, B., Brown, C., Black, D., & Gray, E. (2020). Beta study. Journal, 2(1), 11-20.',
  ].join('\n');
  const r = CC.convert(article, refs, 'apa7', 'ieee');
  assert.strictEqual(r.unmatched.length, 0, JSON.stringify(r.unmatched));
  assert.strictEqual(r.changedCount, 1);
  assert.ok(r.convertedArticle.includes('[1], [2]') || r.convertedArticle.includes('[1]\u2013[2]'), r.convertedArticle);
});

console.log('\n=== IEEE reference with un-comma\'d "et al." (real-world regression) ===');

test('IEEE source author list "F. Last et al." (no comma) resolves surname correctly, not "al"', () => {
  // Reproduces a real bug: "A. R. Malik et al." was parsed with "al" as the surname because
  // nothing split "et al" off before the non-inverted last-token-is-surname rule ran.
  const article = 'Prior work found positive effects [1].';
  const refs = '[1] A. R. Malik et al., "Exploring AI in academic essay writing," International Journal of Educational Research Open, vol. 4, p. 100296, 2023. doi: 10.1016/j.ijedro.2023.100296.';
  const r = CC.convert(article, refs, 'ieee', 'apa7');
  assert.ok(r.convertedArticle.includes('(Malik et al., 2023)'), r.convertedArticle);
  assert.ok(!r.convertedArticle.includes('(al, 2023)'), r.convertedArticle);
});

test('IEEE source author list "et al." truncation is preserved in the converted reference-list line too', () => {
  const article = 'Prior work found positive effects [1].';
  const refs = '[1] A. R. Malik et al., "Exploring AI in academic essay writing," International Journal of Educational Research Open, vol. 4, p. 100296, 2023. doi: 10.1016/j.ijedro.2023.100296.';
  const r = CC.convert(article, refs, 'ieee', 'apa7');
  assert.ok(r.referenceLines[0].line.startsWith('Malik, A. R., et al.,'), r.referenceLines[0].line);
});

test('narrative "Wang et al." citation with un-comma\'d source "et al." also resolves (not left unmatched)', () => {
  const article = 'Wang et al. [1] reported similar findings.';
  const refs = '[1] S. Wang et al., "Artificial intelligence in education," Expert Systems with Applications, vol. 235, p. 124167, 2024. doi: 10.1016/j.eswa.2024.124167.';
  const r = CC.convert(article, refs, 'ieee', 'apa7');
  assert.ok(r.convertedArticle.includes('Wang et al. (2024)'), r.convertedArticle);
  assert.strictEqual(r.unmatched.length, 0, JSON.stringify(r.unmatched));
});

console.log('\n=== Reference year vs. a page-range number that looks like a year (real-world regression) ===');

test('year is read from the end of the reference (after the page range), not the page range itself', () => {
  // Reproduces a real bug: "pp. 1944-1958, 2025" was parsed as year 1944 (the first 19xx/20xx-
  // shaped number in the line) instead of the actual publication year, 2025, stated afterward.
  const article = 'This gender gap was previously documented [1].';
  const refs = '[1] H. Al-Samarraie, S. M. Sarsam, A. I. Alzahrani, A. Chatterjee, and B. J. Swinnerton, "Gender perceptions of generative AI in higher education," Journal of Applied Research in Higher Education, vol. 17, no. 5, pp. 1944-1958, 2025. doi: 10.1108/JARHE-02-2024-0109.';
  const r = CC.convert(article, refs, 'ieee', 'apa7');
  assert.ok(r.convertedArticle.includes('(Al-Samarraie et al., 2025)'), r.convertedArticle);
  assert.ok(!r.convertedArticle.includes('1944'), r.convertedArticle);
});

test('year extraction still works normally for references with no page range at all', () => {
  const article = 'This was noted in an earlier review [1].';
  const refs = '[1] O. A. Ilie, "The ethics of AI-assisted academic writing," in Proceedings of the International Conference Knowledge-Based Organization, vol. 31, no. 2, pp. 155-158, 2025.';
  const r = CC.convert(article, refs, 'ieee', 'apa7');
  assert.ok(r.convertedArticle.includes('(Ilie, 2025)'), r.convertedArticle);
});

test('two-author reference-list entry uses a comma before "&" (APA7 rule), unlike in-text', () => {
  const article = 'Studi ini didukung oleh temuan sebelumnya [1].';
  const refs = '[1] A. Alammar and E. A. R. Amin, "EFL students perception," Arab World English Journal, vol. 14, no. 3, pp. 166-181, 2023.';
  const r = CC.convert(article, refs, 'ieee', 'apa7');
  assert.ok(r.referenceLines[0].line.startsWith('Alammar, A., & Amin, E. A. R.'), r.referenceLines[0].line);
});

test('parseNumericReferenceTail reads volume/issue/pages/doi from a typical IEEE tail', () => {
  const r = CC._internal.parseNumericReferenceTail(', vol. 16, no. 1, p. 39, 2019. doi: 10.1186/s41239-019-0171-0.');
  assert.deepStrictEqual(r, { volume: '16', issue: '1', pages: '39', doi: '10.1186/s41239-019-0171-0' });
});

test('parseNumericReferenceTail handles a conference tail with no volume at all', () => {
  const r = CC._internal.parseNumericReferenceTail(', 2025, pp. 1\u201317. doi: 10.1145/3706598.3713393.');
  assert.strictEqual(r.volume, null);
  assert.strictEqual(r.pages, '1\u201317');
});

test('deriveBookPublisher strips the "City, Country:" prefix and trailing year', () => {
  assert.strictEqual(CC._internal.deriveBookPublisher('. London, U.K.: Pearson, 2016.', '2016'), 'Pearson');
  assert.strictEqual(CC._internal.deriveBookPublisher('. Cambridge, U.K.: Polity Press, 2019.', '2019'), 'Polity Press');
});

console.log(`\n${pass} passed, ${fail} failed.\n`);
if (fail > 0) {
  failures.forEach(f => console.log('FAILED: ' + f.name + '\n' + f.err.stack + '\n'));
  process.exit(1);
}
