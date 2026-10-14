// Actual validator pages and event handlers; no external network or copied implementation.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const JSZip = require('jszip');
const CE = require('./engine.js');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n' + e.stack); }
}
async function waitFor(predicate) {
  const started = Date.now();
  while (!predicate()) { if (Date.now() - started > 4000) throw new Error('Validator UI timeout'); await new Promise(r => setTimeout(r, 5)); }
}
function page(upload) {
  const html = upload ? 'validator-upload.html' : 'validator-copy.html';
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, html), 'utf8'), { runScripts: 'outside-only', url: 'https://test.example/' + html });
  const w = dom.window;
  w.JSZip = JSZip; w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
  w.alert = msg => { throw new Error(msg); };
  w.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  for (const file of ['engine.js', 'bibliography-engine.js', 'bibliography-review.js', 'i18n-translate.js', 'journal-rules-engine.js', 'scopus-engine.js']) w.eval(fs.readFileSync(path.join(__dirname, file), 'utf8'));
  const script = fs.readFileSync(path.join(__dirname, upload ? 'upload.js' : 'app.js'), 'utf8');
  assert.ok(/\}\)\(\);\s*$/.test(script));
  w.eval(script.replace(/\}\)\(\);\s*$/, (upload
    ? 'window.__validatorTest = { result: () => state.lastResult, clear: () => { state.lastResult = null; }, state, readBibliographyMetadata, runValidation };'
    : 'window.__validatorTest = { result: () => lastResult, clear: () => { lastResult = null; } };') + '})();'));
  const el = id => w.document.getElementById(id);
  if (upload) el('includeDoi').checked = false;
  async function validate(article, refs, style) {
    w.__validatorTest.clear(); el('styleSelect').value = style;
    el(upload ? 'manualArticle' : 'articleText').value = article;
    el(upload ? 'manualReferences' : 'referenceText').value = refs;
    el(upload ? 'manualProcessBtn' : 'validateBtn').click();
    await waitFor(() => !!w.__validatorTest.result());
    return w.__validatorTest.result();
  }
  return { w, el, dom, validate };
}
const rows = {
  apa7: ['Evidence (Smith, 2024).', 'Smith, J. (2024). Findings. Journal of Research, 12(3), 20–35.'],
  ieee: ['Evidence [1, p. 22].', '[1] J. Smith, "Findings," J. Res., vol. 12, no. 3, pp. 20–35, 2024.'],
  mla9: ['Evidence (Smith 22).', 'Smith, John. “Findings.” Journal of Research, vol. 12, no. 3, 2024, pp. 20–35.'],
  chicago: ['Evidence (Smith 2024).', 'Smith, John. 2024. “Findings.” Journal of Research 12 (3): 20–35.'],
  harvard: ['Evidence (Smith, 2024).', 'Smith, J. (2024) ‘Findings’, Journal of Research, 12(3), pp. 20–35.'],
  vancouver: ['Evidence [1].', '1. Smith J. Findings. J Res. 2024;12(3):20–35.']
};
(async function() {
  for (const upload of [false, true]) {
    const p = page(upload);
    for (const [style, input] of Object.entries(rows)) await test((upload ? 'upload' : 'copy') + ': actual controls validate ' + style + ' and show coverage', async () => {
      const r = await p.validate(...input, style);
      assert.equal(r.references[0].bibliographicType, 'journal-article');
      assert.ok(p.el('bibliographyStatusBanner').textContent.includes(style === 'harvard' ? '1 dengan aturan umum' : '1 referensi'));
      assert.equal(p.el('bibliographyReview').querySelectorAll('select[data-field="type"]').length, 1);
      assert.ok(!r.errors.some(e => /Sitasi tidak ada|Referensi tidak pernah/.test(e.title)), JSON.stringify(r.errors));
    });
    await test((upload ? 'upload' : 'copy') + ': changed source type is applied only to the exact same reference', async () => {
      const raw = 'Smith, J. (2024). Research methods. Example Press.';
      await p.validate('Evidence (Smith, 2024).', raw, 'apa7');
      let select = p.el('bibliographyReview').querySelector('select[data-field="type"]');
      select.value = 'legal'; select.dispatchEvent(new p.w.Event('change', { bubbles: true }));
      assert.ok(p.el('bibliographyStatusBanner').textContent.includes('Jalankan validasi ulang'));
      let r = await p.validate('Evidence (Smith, 2024).', raw, 'apa7');
      assert.equal(r.bibliographyValidation.manual, 1); assert.equal(r.references[0].bibliographicType, 'legal');
      r = await p.validate('Evidence (Smith, 2024).', raw.replace('Research methods', 'Edited methods'), 'apa7');
      assert.equal(r.references[0].bibliographicType, 'book');
      assert.equal(p.w.BibliographyReview.read().length, 0);
    });
    if (upload) {
      await test('uploaded DOCX metadata is read with namespace validation and exact-line binding', async () => {
        const raw = rows.ieee[1], CE = p.w.CitationEngine, BE = p.w.BibliographyEngine;
        const model = BE.validateReference(CE.parseReferenceLine(raw, 'ieee'), 'ieee').model;
        const metadata = { version: 1, styleId: 'ieee', entries: [{ line: raw, model: Object.assign({}, model, { type: 'dataset' }) }] };
        const zip = new JSZip();
        const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        zip.file('customXml/citation-converter.xml', '<cc:metadata xmlns:cc="urn:cek-sitasi:citation-converter:v1">' + escape(JSON.stringify(metadata)) + '</cc:metadata>');
        const read = await p.w.__validatorTest.readBibliographyMetadata(await zip.generateAsync({ type: 'nodebuffer' }));
        assert.equal(read.entries[0].model.type, 'dataset'); p.w.__validatorTest.state.metadata = read;
        const r = await p.validate(...rows.ieee, 'ieee'); assert.equal(r.references[0].bibliographicType, 'dataset');
        zip.file('customXml/citation-converter.xml', '<metadata xmlns="https://wrong.example">{}</metadata>');
        assert.equal(await p.w.__validatorTest.readBibliographyMetadata(await zip.generateAsync({ type: 'nodebuffer' })), null);
        p.w.__validatorTest.state.metadata = null;
      });
      await test('large-document UI worker receives reference details and returns shared checks', async () => {
        const raw = 'Smith, J. (2024). Research methods. Example Press.';
        await p.validate('Evidence (Smith, 2024).', raw, 'apa7');
        const select = p.el('bibliographyReview').querySelector('select[data-field="type"]'); select.value = 'legal';
        let received;
        p.w.Worker = function() { this.postMessage = msg => { received = msg; const r = new CE.MultiFormatValidator(msg.articleText, msg.referenceText, msg.styleId, { referenceDetails: msg.referenceDetails, metadata: msg.metadata }).validate(); this.onmessage({ data: { ok: true, result: r } }); }; };
        const r = await p.w.__validatorTest.runValidation('Evidence (Smith, 2024). ' + 'x'.repeat(51000), raw, 'apa7');
        assert.equal(received.referenceDetails[0].type, 'legal'); assert.equal(r.references[0].bibliographicType, 'legal');
      });
    }
    p.dom.window.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed (validator page integration).');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
