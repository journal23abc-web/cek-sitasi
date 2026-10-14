// Independent, handwritten format oracles + semantic preservation across five cycles.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CC = require('./converter-engine.js');
const BE = require('./bibliography-engine.js');
const fixtures = require('./fixtures/apa-ieee-scenarios.json');
let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ' + name); results.push({ name, passed: true }); }
  catch (e) { fail++; console.error('  FAIL ' + name + '\n' + e.stack); results.push({ name, passed: false, error: e.message }); }
}
function refText(r) { return r.referenceLines.map(x => x.line).join('\n'); }
function details(c) { return Object.assign({ line: c.apa }, c.details); }
function italic(r, text) { return r.runs.some(run => run.italic && run.text === text); }
for (const c of fixtures.cases) test(c.id + ': format oracle, citations, full metadata, five cycles', () => {
  let article = c.article, references = c.apa, metadata, canonical;
  for (let i = 0; i < fixtures.cycles; i++) {
    const ieee = CC.convert(article, references, 'apa7', 'ieee', { metadata, referenceDetails: [Object.assign({ line: references }, c.details)] });
    assert.equal(ieee.unmatched.length, 0);
    assert.equal(ieee.convertedArticle, 'Evidence [1].');
    assert.equal(refText(ieee), c.ieee);
    assert.equal(ieee.referenceLines[0].model.type, c.type);
    assert.ok(ieee.referenceLines[0].fullyFormatted);
    if (c.review) assert.ok(ieee.referenceIssues.some(x => /tinjauan/.test(x.note)), 'Adapted IEEE media must not claim unconditional compliance');
    const apa = CC.convert(ieee.convertedArticle, refText(ieee), 'ieee', 'apa7', { metadata: ieee.metadata });
    assert.equal(apa.restoredMetadataCount, 1);
    assert.equal(apa.unmatched.length, 0);
    assert.equal(apa.convertedArticle, c.article);
    assert.equal(refText(apa), c.expectedAPA);
    assert.equal(apa.referenceLines[0].runs.map(x => x.text).join(''), c.expectedAPA);
    if (/^(?:journal-article|magazine-article|newspaper-article)$/.test(c.type)) {
      const m = apa.referenceLines[0].model;
      assert.ok(italic(apa.referenceLines[0], m.journal));
      if (m.volume) assert.ok(italic(apa.referenceLines[0], m.volume));
      assert.ok(!italic(apa.referenceLines[0], m.title));
    }
    if (/^(?:book|edited-book|dataset|software|thesis)$/.test(c.type)) assert.ok(italic(apa.referenceLines[0], apa.referenceLines[0].model.title));
    if (canonical) assert.deepEqual(apa.referenceLines[0].model, canonical);
    else canonical = apa.referenceLines[0].model;
    article = apa.convertedArticle; references = refText(apa); metadata = apa.metadata;
  }
});
test('one mixed manuscript: citation order, alphabetization, source identity, five cycles', () => {
  const cases = fixtures.cases;
  let article = cases.map(c => c.article).join('\n'), refs = cases.slice().reverse().map(c => c.apa).join('\n'), metadata;
  const expectedArticle = article, initialAPA = cases.map(c => c.expectedAPA).sort();
  for (let i = 0; i < fixtures.cycles; i++) {
    const ieee = CC.convert(article, refs, 'apa7', 'ieee', { metadata, referenceDetails: cases.map(details) });
    assert.equal(ieee.unmatched.length, 0);
    assert.equal(ieee.referenceLines.length, cases.length);
    assert.deepEqual(ieee.referenceLines.map(x => x.line), cases.map((c, j) => c.ieee.replace('[1]', '[' + (j + 1) + ']')));
    const apa = CC.convert(ieee.convertedArticle, refText(ieee), 'ieee', 'apa7', { metadata: ieee.metadata });
    assert.equal(apa.convertedArticle, expectedArticle);
    assert.equal(apa.restoredMetadataCount, cases.length);
    assert.deepEqual(apa.referenceLines.map(x => x.line).sort(), initialAPA);
    article = apa.convertedArticle; refs = refText(apa); metadata = apa.metadata;
  }
});
const ordinary = 'Smith, J. (2020). Alpha. Journal A, 1, 1–3.\nSmith, J. (2021). Beta. Journal A, 2, 4–6.\nJones, A. (2022). Gamma. Journal B, 3, 7–9.';
test('multi-year narrative resolves the entire span without dropping the second source', () => {
  const ieee = CC.convert('Smith (2020, 2021) agrees.', ordinary, 'apa7', 'ieee');
  assert.equal(ieee.convertedArticle, 'Smith [1], [2] agrees.'); assert.equal(ieee.unmatched.length, 0);
  const apa = CC.convert(ieee.convertedArticle, refText(ieee), 'ieee', 'apa7', { metadata: ieee.metadata });
  assert.equal(apa.convertedArticle, 'Smith (2020, 2021) agrees.');
});
test('partly unresolved multi-year narrative is preserved as one atomic group', () => {
  const r = CC.convert('Smith (2020, 2099) agrees.', ordinary, 'apa7', 'ieee');
  assert.equal(r.convertedArticle, 'Smith (2020, 2099) agrees.'); assert.equal(r.unmatched.length, 1);
});
test('grouped locators return as one APA group with each locator bound to its source', () => {
  const r = CC.convert('Studies (Smith, 2020, pp. 2–3; Jones, 2022, p. 8) agree.', ordinary, 'apa7', 'ieee');
  assert.equal(r.convertedArticle, 'Studies [1, pp. 2–3], [2, p. 8] agree.');
  const a = CC.convert(r.convertedArticle, refText(r), 'ieee', 'apa7', { metadata: r.metadata });
  assert.equal(a.convertedArticle, 'Studies (Jones, 2022, p. 8; Smith, 2020, pp. 2–3) agree.');
});
test('two locators for one source are preserved independently', () => {
  const refs = '[1] J. Smith, "Alpha," Journal A, vol. 1, pp. 1–3, 2020.';
  const a = CC.convert('Evidence [1, p. 2], [1, p. 3].', refs, 'ieee', 'apa7');
  assert.equal(a.convertedArticle, 'Evidence (Smith, 2020, p. 2; Smith, 2020, p. 3).');
});
test('same-style IEEE normalization retains grouped page locators', () => {
  const refs = '[1] J. Smith, "Alpha," Journal A, vol. 1, pp. 1–3, 2020.\n[2] J. Smith, "Beta," Journal A, vol. 2, pp. 4–6, 2021.';
  assert.equal(CC.convert('Evidence [1, p. 2], [2, pp. 4–5].', refs, 'ieee', 'ieee').convertedArticle, 'Evidence [1, p. 2], [2, pp. 4–5].');
});
test('six authors remain visible; seven authors truncate only the IEEE display', () => {
  const names = ['Adams, A.', 'Baker, B.', 'Chen, C.', 'Davis, D.', 'Evans, E.', 'Foster, F.', 'Garcia, G.'];
  for (const n of [6, 7]) {
    const apaNames = names.slice(0, n - 1).join(', ') + ', & ' + names[n - 1];
    const ref = apaNames + ' (2024). A study. Journal A, 1, 1–3.';
    const i = CC.convert('Evidence (Adams et al., 2024).', ref, 'apa7', 'ieee');
    assert.equal(i.referenceLines[0].line.includes('et al.'), n === 7);
    assert.equal(i.metadata.entries[0].model.authors.length, n);
    const a = CC.convert(i.convertedArticle, refText(i), 'ieee', 'apa7', { metadata: i.metadata });
    assert.equal(refText(a), ref);
  }
});
test('ellipsis and hidden middle authors of a 21-author record survive display truncation', () => {
  const model = CC.convert('Evidence (Smith, 2020).', ordinary.split('\n')[0], 'apa7', 'ieee').metadata.entries[0].model;
  model.authors = Array.from({ length: 21 }, (_, i) => ({ last: 'Author' + String.fromCharCode(65 + i), given: ['A.'], institutional: false }));
  model.authorCount = 21;
  const rendered = BE.render(model, 'ieee', 1, 'A. AuthorA et al.', '2020');
  const a = CC.convert('Evidence [1].', rendered.line, 'ieee', 'apa7', { metadata: { version: 1, styleId: 'ieee', entries: [{ line: rendered.line, model }] } });
  assert.equal(a.metadata.entries[0].model.authors.length, 21);
  assert.ok(refText(a).includes('. . . AuthorU, A.')); assert.ok(!refText(a).includes('& AuthorU'));
});
test('Unicode and hyphenated initials and compound surnames survive five cycles', () => {
  let refs = 'Lo Bue, R., & García, É.-J. (2024). A study. Journal A, 1, 1–3.', article = 'Evidence (Lo Bue & García, 2024).', metadata;
  const expected = refs;
  for (let i = 0; i < 5; i++) {
    const r = CC.convert(article, refs, 'apa7', 'ieee', { metadata });
    assert.ok(refText(r).includes('R. Lo Bue and É.-J. García'));
    const a = CC.convert(r.convertedArticle, refText(r), 'ieee', 'apa7', { metadata: r.metadata });
    assert.equal(refText(a), expected); article = a.convertedArticle; refs = refText(a); metadata = a.metadata;
  }
});
test('unlabeled long numbers are not guessed to be article IDs', () => {
  const r = CC.convert('Evidence (Smith, 2024).', 'Smith, J. (2024). Study. Journal A, 9, 123456.', 'apa7', 'ieee');
  assert.equal(r.referenceLines[0].model.articleNumber, null);
  assert.ok(r.referenceIssues.some(x => /Angka tunggal/.test(x.note)));
});
test('verified article-number detail resolves an ambiguous locator and persists in metadata', () => {
  const ref = 'Smith, J. (2024). Study. Journal A, 9, 78.';
  const i = CC.convert('Evidence (Smith, 2024).', ref, 'apa7', 'ieee', { referenceDetails: [{ line: ref, articleNumber: '78' }] });
  assert.ok(refText(i).includes('vol. 9, 2024, Art. no. 78'));
  assert.ok(!i.referenceIssues.some(x => /Angka tunggal/.test(x.note)));
  const a = CC.convert(i.convertedArticle, refText(i), 'ieee', 'apa7', { metadata: i.metadata });
  assert.ok(refText(a).includes(', Article 78.'));
});
test('an edited source cannot inherit stale user details', () => {
  const old = 'Smith, J. (2024). Study. Journal A, 9, 78.', changed = old.replace('78', '79');
  const r = CC.convert('Evidence (Smith, 2024).', changed, 'apa7', 'ieee', { referenceDetails: [{ line: old, articleNumber: '78' }] });
  assert.equal(r.referenceLines[0].model.articleNumber, null); assert.ok(refText(r).includes('79'));
});
test('duplicated metadata bindings never select an arbitrary model', () => {
  const i = CC.convert('Evidence (Smith, 2020).', ordinary.split('\n')[0], 'apa7', 'ieee');
  i.metadata.entries.push(JSON.parse(JSON.stringify(i.metadata.entries[0])));
  const a = CC.convert(i.convertedArticle, refText(i), 'ieee', 'apa7', { metadata: i.metadata });
  assert.equal(a.restoredMetadataCount, 0);
});
test('stripped metadata never invents suppressed author names or expanded journal names', () => {
  const r = CC.convert('Evidence [1].', '[1] A. Smith et al., "Study," J. Res., vol. 9, 2024, Art. no. 78.', 'ieee', 'apa7');
  assert.ok(!refText(r).includes('Journal of Research'));
  assert.ok(r.referenceIssues.some(x => /penulis sumber terpotong/.test(x.note)));
  assert.ok(r.referenceIssues.some(x => /Nama jurnal sumber berupa singkatan/.test(x.note)));
});
test('missing access date and publisher city are reported without inventing values', () => {
  const web = fixtures.cases.find(c => c.id === 'webpage-individual');
  const a = CC.convert(web.article, web.apa, 'apa7', 'ieee');
  assert.ok(a.referenceIssues.some(x => /Tanggal akses/.test(x.note))); assert.ok(!refText(a).includes('Accessed:'));
  const book = fixtures.cases.find(c => c.id === 'book-edition');
  const b = CC.convert(book.article, book.apa, 'apa7', 'ieee');
  assert.ok(b.referenceIssues.some(x => /Lokasi penerbit/.test(x.note))); assert.ok(!refText(b).includes('London'));
});
test('unsupported legal and unknown works remain review cases', () => {
  const ref = 'Example Council. (2024). Research act. Official Gazette.';
  const r = CC.convert('Evidence (Example Council, 2024).', ref, 'apa7', 'ieee', { referenceDetails: [{ line: ref, type: 'legal' }] });
  assert.equal(r.referenceLines[0].fullyFormatted, false); assert.ok(r.referenceIssues.some(x => /yurisdiksi/.test(x.note)));
  const unknown = CC.convert('Evidence (Smith, 2024).', 'Smith, J. (2024). Mystery source.', 'apa7', 'ieee');
  assert.equal(unknown.referenceLines[0].fullyFormatted, false);
});
test('an unparseable entry stops conversion instead of deleting it', () => {
  assert.throws(() => CC.convert('Evidence.', ordinary + '\nBROKEN ENTRY', 'apa7', 'ieee'), /entri referensi tidak dapat dibaca/);
});
test('unmatched citations and statistics remain visible', () => {
  const article = 'A result (Missing, 2024), a personal communication (A. Lee, personal communication, June 12, 2024), and statistics (p = 0.04; n = 2024).';
  const r = CC.convert(article, ordinary, 'apa7', 'ieee');
  assert.equal(r.convertedArticle, article); assert.ok(r.unmatched.length > 0);
});
test('periodical single-word titles and unknown words are not expanded or fabricated', () => {
  assert.equal(BE.abbreviate('Nature'), 'Nature'); assert.equal(BE.abbreviate('Science'), 'Science');
  assert.equal(BE.abbreviate('Journal of Unlistedword Research'), 'J. Unlistedword Res.');
});
for (const locator of ['p. xv', 'Chapter 2', 'para. 3', 'Figure 2', '02:30', 'Chapter 2, pp. 3–5', 'eq. (2)']) test('locator survives five cycles: ' + locator, () => {
  const original = 'Evidence (Smith, 2020, ' + locator + ').';
  let article = original, refs = ordinary.split('\n')[0], metadata;
  for (let i = 0; i < 5; i++) {
    const r = CC.convert(article, refs, 'apa7', 'ieee', { metadata });
    assert.equal(r.unmatched.length, 0); assert.ok(!r.convertedArticle.includes('p. para.'));
    const a = CC.convert(r.convertedArticle, refText(r), 'ieee', 'apa7', { metadata: r.metadata });
    assert.equal(a.convertedArticle, original); article = a.convertedArticle; refs = refText(a); metadata = a.metadata;
  }
});
test('nested narrative locators do not leave an extra closing parenthesis', () => {
  const r = CC.convert('Smith (2020, eq. (2)) agrees.', ordinary, 'apa7', 'ieee');
  assert.equal(r.convertedArticle, 'Smith [1, eq. (2)] agrees.');
});
test('year-like article IDs and years in quoted titles never replace the publication year', () => {
  const r = CC.convert('Evidence [1].', '[1] J. Smith, "Results (2019)," Journal A, vol. 12, 2024, Art. no. 2021.', 'ieee', 'apa7');
  assert.equal(r.convertedArticle, 'Evidence (Smith, 2024).');
  assert.ok(refText(r).includes('(2024). Results (2019). Journal A, 12, Article 2021.'));
});
test('undated books use (n.d.) in IEEE without duplicated periods and restore APA', () => {
  const ref = 'Smith, J. (n.d.). Research methods. Example Press.';
  const r = CC.convert('Evidence (Smith, n.d.).', ref, 'apa7', 'ieee');
  assert.equal(refText(r), '[1] J. Smith, Research Methods. Example Press. (n.d.).');
  const a = CC.convert(r.convertedArticle, refText(r), 'ieee', 'apa7', { metadata: r.metadata });
  assert.equal(refText(a), ref);
});
test('in-press articles retain their status and do not acquire an invented year', () => {
  const ref = 'Smith, J. (in press). New findings. Journal of Research.';
  const r = CC.convert('Evidence (Smith, in press).', ref, 'apa7', 'ieee');
  assert.equal(refText(r), '[1] J. Smith, "New findings," J. Res., to be published.');
  const a = CC.convert(r.convertedArticle, refText(r), 'ieee', 'apa7', { metadata: r.metadata });
  assert.equal(refText(a), ref); assert.equal(a.convertedArticle, 'Evidence (Smith, in press).');
});
test('unrecognized bracketed descriptions do not silently become books', () => {
  const r = CC.convert('Evidence (Smith, 2024).', 'Smith, J. (2024). A scale [Measurement instrument]. Example Institute.', 'apa7', 'ieee');
  assert.equal(r.referenceLines[0].model.type, 'unknown'); assert.equal(r.referenceLines[0].fullyFormatted, false);
});
test('publication month updates are applied, but a conflicting year requires a source correction', () => {
  const ref = ordinary.split('\n')[0];
  const month = CC.convert('Evidence (Smith, 2020).', ref, 'apa7', 'ieee', { referenceDetails: [{ line: ref, date: '2020, June' }] });
  assert.ok(refText(month).includes('Jun. 2020'));
  const conflict = CC.convert('Evidence (Smith, 2020).', ref, 'apa7', 'ieee', { referenceDetails: [{ line: ref, date: '2025, June' }] });
  assert.ok(!refText(conflict).includes('2025')); assert.ok(conflict.referenceIssues.some(x => /Tahun detail berbeda/.test(x.note)));
});
test('external IEEE books preserve three authors, edition, publisher and known location', () => {
  const ref = '[1] J. Smith, A. Jones, and B. Green, Research Methods, 2nd ed. London, U.K.: Example Press, 2024.';
  const a = CC.convert('Evidence [1].', ref, 'ieee', 'apa7');
  assert.equal(refText(a), 'Smith, J., Jones, A., & Green, B. (2024). Research Methods (2nd ed.). Example Press.');
  assert.equal(a.referenceLines[0].model.authors.length, 3);
  assert.equal(a.referenceLines[0].model.place, 'London, U.K.');
  assert.ok(a.referenceIssues.some(x => /sentence case/.test(x.note)));
});
test('external report identifiers cannot become a publication month', () => {
  const a = CC.convert('Evidence [1].', '[1] J. Smith, "Reporting methods," Example Agency, Rep. 24, 2024.', 'ieee', 'apa7');
  assert.equal(refText(a), 'Smith, J. (2024). Reporting methods (Report No. 24). Example Agency.');
  assert.equal(a.referenceLines[0].model.date, '2024');
});
test('external IEEE journal month is retained for IEEE while ordinary APA uses the year', () => {
  const ref = '[1] J. Smith, "A study," J. Res., vol. 12, pp. 1–3, Jun. 2024.';
  const a = CC.convert('Evidence [1].', ref, 'ieee', 'apa7');
  assert.equal(refText(a), 'Smith, J. (2024). A study. J. Res., 12, 1–3.');
  const i = CC.convert(a.convertedArticle, refText(a), 'apa7', 'ieee', { metadata: a.metadata });
  assert.equal(refText(i), ref);
});
test('explicit full journal name resolves the abbreviation review without guessing', () => {
  const ref = '[1] J. Smith, "A study," J. Res., vol. 12, pp. 1–3, Jun. 2024.';
  const a = CC.convert('Evidence [1].', ref, 'ieee', 'apa7', { referenceDetails: [{ line: ref, journal: 'Journal of Research' }] });
  assert.equal(refText(a), 'Smith, J. (2024). A study. Journal of Research, 12, 1–3.');
  assert.ok(!a.referenceIssues.some(x => /Nama jurnal sumber berupa singkatan/.test(x.note)));
});
test('an APA journal with a season and missing volume keeps its actual issue and pages', () => {
  const ref = 'Smith, J. (2024, Winter). A quarterly study. Journal of Research, (4), 20–30.';
  const i = CC.convert('Evidence (Smith, 2024).', ref, 'apa7', 'ieee');
  assert.equal(refText(i), '[1] J. Smith, "A quarterly study," J. Res., no. 4, pp. 20–30, Winter 2024.');
  const a = CC.convert(i.convertedArticle, refText(i), 'ieee', 'apa7', { metadata: i.metadata });
  assert.equal(refText(a), ref);
  assert.equal(a.referenceLines[0].model.volume, null);
});
console.log(`\n${pass} passed, ${fail} failed (bibliography scenarios).`);
if (process.argv.includes('--report')) {
  const lines = ['# Hasil uji konversi APA 7 ↔ IEEE', '', `Acuan sintetis: ${fixtures.cases.length} kasus, masing-masing ${fixtures.cycles} putaran (10 arah konversi).`,
    `Suite ini: ${pass} lulus, ${fail} gagal. Format dibandingkan dengan teks acuan yang ditulis terpisah; metadata dan sitasi juga diperiksa.`, '',
    'Semua contoh adalah data uji, bukan sumber penelitian nyata. Kesetaraan bolak-balik berlaku dengan metadata; teks IEEE tanpa metadata tidak dapat memulihkan informasi yang dihilangkan gaya IEEE.', '',
    '| Kasus | Jenis | Hasil lima putaran |', '|---|---|---|', ...fixtures.cases.map(c => `| ${c.id} | ${c.type}${c.review ? ' (adaptasi; tinjauan editorial)' : ''} | ${results.find(x => x.name.startsWith(c.id + ':')).passed ? 'LULUS' : 'GAGAL'} |`), '',
    '## Input dan keluaran tiap contoh', ''];
  for (const c of fixtures.cases) lines.push('### ' + c.id, '', '**APA awal:** ' + c.apa, '', '**IEEE acuan:** ' + c.ieee, '', '**APA kembali (sama pada lima putaran):** ' + c.expectedAPA, '');
  lines.push('## Kasus batas', '', ...results.slice(fixtures.cases.length).map(x => '- ' + (x.passed ? 'LULUS' : 'GAGAL') + ': ' + x.name));
  fs.writeFileSync(path.join(__dirname, 'CONVERSION-REPORT.md'), lines.join('\n') + '\n');
}
if (fail) process.exitCode = 1;
