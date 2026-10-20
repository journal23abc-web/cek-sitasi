// Tes Node: deteksi & perlindungan Zotero/Mendeley/EndNote, serta laporan komentar.
//   node word-addin/test/citation-managers.test.js
var assert = require('assert');
var AC = require('../addin-core.js');
var CM = require('../citation-managers.js');
var RC = require('../report-core.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); }
}

function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function run(t) { return '<w:r><w:rPr><w:i w:val="0"/></w:rPr><w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>'; }
function begin(code) { return '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ' + esc(code) + ' </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'; }
var END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
function field(code, t) { return begin(code) + run(t) + END; }
function doc(body) { return '<pkg:package><pkg:part><pkg:xmlData><w:document xmlns:w="w"><w:body>' + body + '<w:sectPr/></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>'; }
function p(inner) { return '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' + inner + '</w:p>'; }

var ZCODE = 'ADDIN ZOTERO_ITEM CSL_CITATION {"citationID":"a1","citationItems":[{"id":1}],"schema":"https://github.com/citation-style-language/schema/raw/master/csl-citation.json"}';
var WORD_TEXTS = [
  'Pendahuluan',
  'Pembelajaran mesin berkembang pesat (Smith & Jones, 2020). Menurut Brown et al. (2019), model besar membutuhkan data. Penelitian lain (Lee and Park, 2021; Adams, 2018) menunjukkan hal serupa.',
  'Daftar Pustaka',
  'Smith, J., & Jones, K. (2020). Deep learning for text classification. Journal of Machine Learning Research, 21(4), 1-20. https://doi.org/10.1234/jmlr.2020.004',
  'Brown, T., Mann, B., Ryder, N., & Subbiah, M. (2019). Language models are few-shot learners. Advances in Neural Information Processing Systems, 33, 1877-1901.',
  'Lee, H., and Park, S. (2021). Attention mechanisms revisited. Neural Networks, 140, 12–25.',
  'Adams, P. (2018). Statistical learning theory. Springer.'
];
var ZOTERO_XML = doc(
  p(run('Pendahuluan')) +
  p(run('Pembelajaran mesin berkembang pesat ') + field(ZCODE, '(Smith & Jones, 2020)') + run('. Menurut ') + field(ZCODE, 'Brown et al. (2019)') +
    run(', model besar membutuhkan data. Penelitian lain ') + field(ZCODE, '(Lee and Park, 2021; Adams, 2018)') + run(' menunjukkan hal serupa.')) +
  p(run('Daftar Pustaka')) +
  p(begin('ADDIN ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY') + run(WORD_TEXTS[3])) +
  p(run(WORD_TEXTS[4])) + p(run(WORD_TEXTS[5])) + p(run(WORD_TEXTS[6]) + END)
);

console.log('\n=== Pemindaian OOXML ===');
test('Zotero: 3 sitasi field + daftar pustaka multi-paragraf terdeteksi', function () {
  var sc = CM.scanOoxml(ZOTERO_XML);
  assert.strictEqual(sc.paragraphs.length, 7);
  assert.deepStrictEqual(sc.managers.Zotero, { citations: 3, bibliography: true });
  assert.strictEqual(sc.paragraphs[1].text, WORD_TEXTS[1], 'kode field tidak boleh ikut teks');
  assert.deepStrictEqual(sc.paragraphs[1].segs.map(function (s) { return s.text; }), ['(Smith & Jones, 2020)', 'Brown et al. (2019)', '(Lee and Park, 2021; Adams, 2018)']);
  [3, 4, 5, 6].forEach(function (i) { assert.strictEqual(sc.paragraphs[i].segs[0].kind, 'bibliography'); assert.strictEqual(sc.paragraphs[i].segs[0].text, WORD_TEXTS[i]); });
});
test('Mendeley Desktop (ADDIN CSL_CITATION) & Mendeley Cite (content control) dikenali', function () {
  var xml = doc(p(run('A ') + field('ADDIN CSL_CITATION {"citationItems":[]}', '(Lee, 2021)')) +
    p('<w:sdt><w:sdtPr><w:alias w:val="Mendeley Citation"/><w:tag w:val="MENDELEY_CITATION_v3_eyJjaXRhdGlvbklEIjoi"/></w:sdtPr><w:sdtContent>' + run('(Park, 2020)') + '</w:sdtContent></w:sdt>' + run(' lanjut.')) +
    '<w:sdt><w:sdtPr><w:tag w:val="MENDELEY_BIBLIOGRAPHY"/></w:sdtPr><w:sdtContent>' + p(run('Lee, H. (2021). X.')) + p(run('Park, S. (2020). Y.')) + '</w:sdtContent></w:sdt>');
  var sc = CM.scanOoxml(xml);
  assert.strictEqual(sc.managers.Mendeley.citations, 2);
  assert.strictEqual(sc.managers.Mendeley.bibliography, true);
  assert.strictEqual(sc.paragraphs[1].segs[0].text, '(Park, 2020)');
  assert.strictEqual(sc.paragraphs[2].segs[0].kind, 'bibliography');
  assert.strictEqual(sc.paragraphs.length, 4, 'paragraf di dalam content control tetap dihitung');
});
test('EndNote, sitasi bawaan Word, dan bookmark Zotero dikenali', function () {
  assert.deepStrictEqual(CM.classify(' ADDIN EN.CITE <EndNote>'), { manager: 'EndNote', kind: 'citation' });
  assert.deepStrictEqual(CM.classify(' ADDIN EN.REFLIST '), { manager: 'EndNote', kind: 'bibliography' });
  assert.deepStrictEqual(CM.classify(' CITATION Smi20 \\l 1033 '), { manager: 'Word', kind: 'citation' });
  assert.deepStrictEqual(CM.classify(' BIBLIOGRAPHY '), { manager: 'Word', kind: 'bibliography' });
  assert.strictEqual(CM.classify(' HYPERLINK "https://x" '), null);
  var sc = CM.scanOoxml(doc(p(run('Lihat ') + '<w:bookmarkStart w:id="9" w:name="ZOTERO_BREF_abc"/>' + run('(Smith, 2020)') + '<w:bookmarkEnd w:id="9"/>' + run('.'))));
  assert.strictEqual(sc.paragraphs[0].segs[0].text, '(Smith, 2020)');
});
test('kotak teks & tab stop tidak mengacaukan urutan/teks paragraf', function () {
  var xml = doc(p(run('Satu') + '<w:r><w:tab/></w:r>' + run('dua') + '<w:r><mc:AlternateContent><mc:Choice><w:drawing><w:txbxContent>' + p(run('di kotak teks')) + '</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>' + p(run('cadangan')) + '</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>') + p(run('Tiga')));
  var sc = CM.scanOoxml(xml);
  assert.deepStrictEqual(sc.paragraphs.map(function (x) { return x.text; }), ['Satu\tdua', 'Tiga']);
});

console.log('\n=== Pemetaan & perlindungan ===');
var managed = CM.mapToWord(WORD_TEXTS, CM.scanOoxml(ZOTERO_XML));
var st = AC.structure(WORD_TEXTS.map(function (t) { return { text: t }; }));
test('rentang terkelola dipetakan ke offset paragraf Word', function () {
  var sp = managed.spans[1];
  assert.strictEqual(sp.length, 3);
  assert.strictEqual(WORD_TEXTS[1].slice(sp[0].start, sp[0].end), '(Smith & Jones, 2020)');
  assert.ok(CM.managedPara(managed, 4) && CM.managedPara(managed, 4).kind === 'bibliography');
  assert.strictEqual(CM.managedPara(managed, 2), null, 'judul daftar pustaka tidak termasuk field');
  assert.strictEqual(managed.primary, 'Zotero');
});
test('paragraf yang disisipkan tetap terpetakan (penyelarasan berbasis teks)', function () {
  var texts = WORD_TEXTS.slice(0, 2).concat(['Paragraf baru yang belum dipindai.']).concat(WORD_TEXTS.slice(2));
  var m = CM.mapToWord(texts, CM.scanOoxml(ZOTERO_XML));
  assert.ok(!m.spans[2]);
  assert.ok(m.spans[1] && m.spans[5] && m.spans[5][0].kind === 'bibliography');
});
test('saran pada sitasi & referensi Zotero tidak bisa "Terima", diberi petunjuk', function () {
  var v = AC.validate(st, 'apa7');
  var prot = CM.protectSuggestions(v.suggestions, managed, st);
  var amp = prot.find(function (s) { return s.kind === 'replace' && /Lee and Park/.test(s.original); });
  assert.ok(amp, 'saran & untuk Lee and Park ada');
  assert.strictEqual(amp.canApply, false);
  assert.strictEqual(amp.managedBy, 'Zotero');
  assert.ok(/Add\/Edit Citation/.test(amp.blockedReason));
  var lee = prot.find(function (s) { return s.kind === 'paragraph' && /^Lee/.test(s.original); });
  assert.ok(lee && !lee.canApply && /Refresh/.test(lee.blockedReason));
  var sort = prot.find(function (s) { return s.kind === 'sort'; });
  if (sort) assert.ok(!sort.canApply && /Document Preferences/.test(sort.blockedReason));
  // tanpa Zotero, saran yang sama tetap bisa diterapkan
  assert.ok(v.suggestions.find(function (s) { return s.kind === 'replace' && /Lee and Park/.test(s.original); }).canApply);
});
test('tautan langsung melewati field Zotero; konversi diblokir dengan petunjuk gaya', function () {
  var plan = CM.filterLinkPlan(AC.planLinks(st, 'apa7'), managed);
  assert.strictEqual(plan.citationLinks.length, 0);
  assert.ok(plan.managedSkipped.citations > 0);
  var conv = CM.guardConversion(AC.planConversion(st, 'apa7', 'ieee'), managed, st);
  assert.ok(conv.managedBlock && /Document Preferences/.test(conv.managedBlock.message));
  assert.strictEqual(conv.edits.length, 0);
});
test('kode field yang tampil (Alt+F9) disamarkan tanpa menggeser offset', function () {
  var t = 'Teks { ADDIN ZOTERO_ITEM CSL_CITATION {"citationID":"x","a":"}{"} \\* MERGEFORMAT }(Smith, 2020) lanjut';
  var m = CM.maskFieldCodes(t);
  assert.strictEqual(m.length, t.length);
  assert.ok(m.indexOf('ADDIN') < 0 && m.indexOf('citationID') < 0 && m.indexOf('(Smith, 2020) lanjut') > 0);
  var mm = CM.mapToWord([t], null);
  assert.ok(mm.codesVisible && mm.found);
});

console.log('\n=== Laporan komentar ===');
test('laporan biasa: lokasi tepat, warna sesuai jenis, komentar berawalan [Cek Sitasi]', function () {
  var v = AC.validate(st, 'apa7');
  var rep = RC.build(st, v.suggestions, { years: 5, references: v.references, styleId: 'apa7' });
  assert.ok(rep.items.length > 0);
  rep.items.forEach(function (it) {
    assert.ok(RC.isReportComment(it.comment));
    assert.strictEqual(WORD_TEXTS[it.paraIndex].substr(it.offset, it.length), it.text);
    if (!it.whole && !it.head) assert.ok(it.occurrence >= 0);
  });
  var amp = rep.items.find(function (it) { return /Lee and Park/.test(it.text); });
  assert.ok(amp && amp.color);
  assert.ok(rep.counts.year >= 1, 'tahun di luar 5 tahun terakhir ikut');
  var red = rep.items.find(function (it) { return it.color === 'Red'; });
  assert.ok(red, 'ada temuan merah (perlu diperbaiki)');
});
test('laporan pada naskah Zotero: tidak ada sorotan/komentar di dalam field', function () {
  var v = AC.validate(st, 'apa7');
  var rep = RC.build(st, CM.protectSuggestions(v.suggestions, managed, st), { years: 5, references: v.references, styleId: 'apa7', managed: managed });
  assert.ok(rep.items.length > 0 && rep.managed > 0);
  rep.items.forEach(function (it) {
    assert.strictEqual(CM.managedAt(managed, it.paraIndex, it.offset, it.offset + it.length), null, 'komentar tidak boleh di dalam field: ' + it.text);
  });
  var near = rep.items.find(function (it) { return /Pada sitasi “\(Lee and Park/.test(it.comment); });
  assert.ok(near && near.color === null && near.text === 'lain', 'dipindah ke kata sebelum sitasi: ' + (near && near.text));
  var bib = rep.items.find(function (it) { return it.paraIndex === 2; });
  assert.ok(bib && /daftar pustaka Zotero/.test(bib.comment) && bib.whole, 'temuan daftar pustaka ditempel di judulnya');
});
test('item panjang (> 240 karakter) memakai kepala & ekor untuk pencarian Word', function () {
  var long = 'Ref ' + new Array(60).join('kata ') + 'akhir.';
  var st2 = AC.structure([{ text: 'Isi' }, { text: 'Daftar Pustaka' }, { text: long }, { text: 'Lain' }]);
  var rep = RC.build(st2, [{ id: 'x', severity: 'error', title: 'T', paraIndex: 2, offset: 2, length: long.length - 4 }], {});
  var it = rep.items[0];
  assert.ok(it.head && it.tail && it.headOccurrence === 0 && it.tailOccurrence === 0 && !it.whole);
});

Promise.resolve().then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed) process.exit(1);
});
