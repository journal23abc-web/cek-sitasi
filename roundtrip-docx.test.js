// Real page event handlers + real ZIP export/reupload. No browser downloads or live APIs.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const JSZip = require('jszip');
const mammoth = require('mammoth');
const fixtures = require('./fixtures/apa-ieee-scenarios.json');
const root = __dirname;
const dom = new JSDOM(fs.readFileSync(path.join(root, 'citation-converter.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://test.example/citation-converter.html' });
const w = dom.window;
const downloads = [];
w.JSZip = JSZip;
w.HTMLElement.prototype.scrollIntoView = function() {};
w.alert = message => { throw new Error(message); };
w.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:test'; };
w.URL.revokeObjectURL = function() {};
w.document.addEventListener('click', e => { if (e.target.tagName === 'A') e.preventDefault(); });
w.fetch = async url => {
  assert.equal(url, 'fixtures/apa-ieee-scenarios.json', 'Tests may only load local fixtures; no hidden Crossref request');
  return { ok: true, json: async () => JSON.parse(JSON.stringify(fixtures)) };
};
for (const file of ['engine.js', 'bibliography-engine.js', 'converter-engine.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
const ui = fs.readFileSync(path.join(root, 'convert-ui.js'), 'utf8');
// Test-only instrumentation of the shipping IIFE, not a second export implementation.
assert.ok(/\}\)\(\);\s*$/.test(ui));
w.eval(ui.replace(/\}\)\(\);\s*$/, 'window.__testUI = { state, handleFile, buildMinimalDocx, loadDocxTextIndex, splitDocxIndex, readConversionMetadata, showSourceDetails, refreshOriginalExportAvailability }; })();'));
const api = w.__testUI;
const el = id => w.document.getElementById(id);
const waitFor = async predicate => {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > 6000) throw new Error('UI timeout: ' + el('exportStatus').textContent + ' / ' + el('topStatus').textContent + ' / ' + el('uploadStatus').textContent); await new Promise(r => setTimeout(r, 5)); }
};
async function bytes(blob) {
  if (blob.arrayBuffer) return Buffer.from(await blob.arrayBuffer());
  return new Promise((resolve, reject) => { const reader = new w.FileReader(); reader.onload = () => resolve(Buffer.from(reader.result)); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
}
function file(buffer) { return { name: 'scenario.docx', size: buffer.length, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) }; }
async function upload(buffer, style, target) {
  const source = file(buffer); api.handleFile(source);
  await waitFor(() => api.state.originalFile === source && el('uploadStatus').textContent.includes('Terpisah'));
  el('sourceStyleSelect').value = style; el('targetStyleSelect').value = target;
}
async function convert() {
  api.state.lastResult = null; el('convertBtn').click();
  await waitFor(() => !!api.state.lastResult || (!el('loading').classList.contains('active') && !!el('topStatus').textContent));
  assert.ok(api.state.lastResult, el('topStatus').textContent);
  return api.state.lastResult;
}
async function exportOriginal() {
  assert.ok(api.refreshOriginalExportAvailability(), 'Original export should match current preview and details');
  const before = downloads.length; el('btnExportDocxOriginal').click();
  await waitFor(() => downloads.length > before || el('exportStatus').className.includes('err'));
  assert.ok(downloads.length > before, el('exportStatus').textContent);
  return bytes(downloads[downloads.length - 1]);
}
async function verifyPackage(buffer, expected) {
  const index = await api.loadDocxTextIndex(file(buffer)), split = api.splitDocxIndex(index);
  assert.equal(split.article, expected.convertedArticle);
  assert.equal(split.references, expected.referenceLines.map(x => x.line).join('\n'));
  assert.equal(index.metadata.entries.length, expected.referenceLines.length);
  const zip = await JSZip.loadAsync(buffer), xml = await zip.file('word/document.xml').async('string');
  const doc = new w.DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  for (const entry of expected.referenceLines.filter(x => x.fullyFormatted)) {
    const p = Array.from(doc.getElementsByTagNameNS(W, 'p')).find(p => Array.from(p.getElementsByTagNameNS(W, 't')).map(x => x.textContent).join('') === entry.line);
    assert.ok(p, entry.line);
    assert.equal(p.getElementsByTagNameNS(W, 'spacing')[0].getAttributeNS(W, 'line'), expected.targetStyleId === 'apa7' ? '480' : '240');
    assert.equal(p.getElementsByTagNameNS(W, 'ind')[0].getAttributeNS(W, 'hanging'), '720');
  }
  return xml;
}
async function synthetic() {
  const article = fixtures.cases.map(c => c.article).join('\n');
  const refs = fixtures.cases.slice().reverse().map(c => c.apa).join('\n');
  let buffer = await bytes(await api.buildMinimalDocx(article, refs));
  const zip = await JSZip.loadAsync(buffer);
  zip.file('word/sentinel.xml', '<sentinel>UNTOUCHED PACKAGE PART</sentinel>');
  const xml = await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml', xml.replace('<w:sectPr/>', '<w:p><w:r><w:t>Appendix A. Unchanged data</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>TABLE SENTINEL</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/>'));
  buffer = await zip.generateAsync({ type: 'nodebuffer' });
  let firstIEEE, firstAPA, canonical;
  for (let cycle = 0; cycle < fixtures.cycles; cycle++) {
    await upload(buffer, 'apa7', 'ieee');
    if (!cycle) {
      const hints = fixtures.cases.map(c => Object.assign({ line: c.apa }, c.details));
      const preview = w.CitationConverter.convert(el('articleText').value, el('referenceText').value, 'apa7', 'apa7', { referenceDetails: hints });
      api.showSourceDetails(preview, hints);
    }
    const ieee = await convert(); assert.equal(ieee.unmatched.length, 0);
    assert.deepEqual(Array.from(ieee.referenceLines, x => x.line), fixtures.cases.map((c, i) => c.ieee.replace('[1]', '[' + (i + 1) + ']')));
    buffer = await exportOriginal(); const ieeeXML = await verifyPackage(buffer, ieee);
    if (!cycle) firstIEEE = ieeeXML; else assert.equal(ieeeXML, firstIEEE, 'IEEE document.xml must be byte-stable after normalization');
    await upload(buffer, 'ieee', 'apa7');
    const apa = await convert(); assert.equal(apa.restoredMetadataCount, fixtures.cases.length);
    assert.equal(apa.convertedArticle, article);
    assert.deepEqual(Array.from(apa.referenceLines, x => x.line).sort(), fixtures.cases.map(c => c.expectedAPA).sort());
    const models = JSON.parse(JSON.stringify(apa.metadata.entries));
    if (!cycle) canonical = models; else assert.deepEqual(models, canonical);
    buffer = await exportOriginal(); const apaXML = await verifyPackage(buffer, apa);
    if (!cycle) firstAPA = apaXML; else assert.equal(apaXML, firstAPA, 'APA document.xml must be byte-stable after normalization');
    const z = await JSZip.loadAsync(buffer);
    assert.equal(await z.file('word/sentinel.xml').async('string'), '<sentinel>UNTOUCHED PACKAGE PART</sentinel>');
    assert.ok(apaXML.includes('TABLE SENTINEL')); assert.ok(apaXML.includes('Appendix A. Unchanged data'));
  }
  // Fresh-document export uses the same typography as the preserved-layout export.
  const final = api.state.lastResult;
  const plain = await bytes(await api.buildMinimalDocx(final.convertedArticle, final.referenceLines.map(x => x.line).join('\n'), final.metadata));
  await verifyPackage(plain, final);
  const outIndex = process.argv.indexOf('--output-dir');
  if (outIndex >= 0) {
    const dir = path.resolve(process.argv[outIndex + 1]); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'scenarios-apa.docx'), plain);
    const back = w.CitationConverter.convert(final.convertedArticle, final.referenceLines.map(x => x.line).join('\n'), 'apa7', 'ieee', { metadata: final.metadata });
    fs.writeFileSync(path.join(dir, 'scenarios-ieee.docx'), await bytes(await api.buildMinimalDocx(back.convertedArticle, back.referenceLines.map(x => x.line).join('\n'), back.metadata)));
  }
  console.log('  PASS real DOCX export/reupload: ' + fixtures.cases.length + ' references, five cycles, exact XML stability, typography, metadata, appendix/table/package preservation');
}
async function uiFeatures() {
  const sample = fixtures.cases.find(c => c.id === 'journal-pages');
  el('articleText').value = sample.article; el('referenceText').value = sample.apa;
  el('sourceStyleSelect').value = 'apa7'; el('targetStyleSelect').value = 'ieee'; api.state.metadata = null;
  const ieee = await convert(); el('btnUseResult').click();
  assert.equal(el('articleText').value, ieee.convertedArticle); assert.equal(el('sourceStyleSelect').value, 'ieee');
  const apa = await convert(); assert.equal(apa.convertedArticle, sample.article); assert.equal(apa.restoredMetadataCount, 1);
  // Editing a reference invalidates its archived model on the next conversion.
  el('btnUseResult').click(); el('referenceText').value = el('referenceText').value.replace('A reproducible study', 'An edited study');
  const edited = await convert(); assert.equal(edited.restoredMetadataCount, 0); assert.ok(edited.referenceLines[0].line.includes('An edited study'));
  el('btnRunScenarios').click(); await waitFor(() => !el('btnRunScenarios').disabled);
  assert.ok(el('scenarioResults').textContent.startsWith(fixtures.cases.length + '/' + fixtures.cases.length), el('scenarioResults').textContent);
  console.log('  PASS page controls: reverse conversion, edited-reference invalidation, local five-cycle scenario runner');
}
async function allStyleDocx() {
  const sample = fixtures.cases.find(c => c.id === 'book-edition');
  const initial = w.CitationConverter.convert(sample.article, sample.apa, 'apa7', 'apa7', { referenceDetails: [Object.assign({ line: sample.apa }, sample.details)] });
  const source = await bytes(await api.buildMinimalDocx(initial.convertedArticle, initial.referenceLines[0].line, initial.metadata));
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  for (const style of ['apa7', 'ieee', 'mla9', 'chicago', 'harvard', 'vancouver']) {
    await upload(source, 'apa7', style); const converted = await convert();
    const original = await exportOriginal();
    const fresh = await bytes(await api.buildMinimalDocx(converted.convertedArticle, converted.referenceLines[0].line, converted.metadata));
    for (const buffer of [original, fresh]) {
      const z = await JSZip.loadAsync(buffer), xml = await z.file('word/document.xml').async('string');
      const doc = new w.DOMParser().parseFromString(xml, 'application/xml');
      const p = Array.from(doc.getElementsByTagNameNS(W, 'p')).find(p => Array.from(p.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join('') === converted.referenceLines[0].line);
      assert.ok(p, style + ': reference matches preview');
      const italic = Array.from(p.getElementsByTagNameNS(W, 'r')).some(r => Array.from(r.getElementsByTagNameNS(W, 'i')).some(i => i.getAttributeNS(W, 'val') === '1'));
      assert.equal(italic, style !== 'vancouver');
      assert.equal(p.getElementsByTagNameNS(W, 'spacing')[0].getAttributeNS(W, 'line'), style === 'apa7' || style === 'mla9' ? '480' : '240');
      const extracted = await mammoth.extractRawText({ buffer }), split = w.CitationEngine.splitDocumentByReferences(extracted.value);
      const parsed = w.CitationEngine.parseReferenceList(split.references, style);
      assert.equal(parsed.length, 1);
      const checked = w.BibliographyEngine.validateReference(parsed[0], style, { metadata: converted.metadata });
      assert.equal(checked.model.type, 'book'); assert.equal(checked.model.place, sample.details.place);
      assert.equal(checked.model.title, 'Research methods', 'Archive retains source case through the actual upload text extractor');
    }
    await upload(original, style, 'apa7'); const back = await convert();
    assert.equal(back.referenceLines[0].line, sample.expectedAPA); assert.equal(back.convertedArticle, sample.article);
  }
  console.log('  PASS all six styles: original/fresh DOCX typography, real Mammoth extraction, metadata binding, return to APA');
}
async function sampleDocument() {
  const i = process.argv.indexOf('--sample'); if (i < 0) return;
  let buffer = fs.readFileSync(path.resolve(process.argv[i + 1])), metadataCount;
  const initialZip = await JSZip.loadAsync(buffer), stable = {};
  for (const name of Object.keys(initialZip.files)) if (!initialZip.files[name].dir && !['word/document.xml', 'customXml/citation-converter.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml'].includes(name)) stable[name] = await initialZip.file(name).async('nodebuffer');
  let firstAPA, firstIEEE;
  for (let cycle = 0; cycle < 5; cycle++) {
    for (const [source, target] of [['ieee', 'apa7'], ['apa7', 'ieee']]) {
      await upload(buffer, source, target); const result = await convert();
      assert.equal(result.referenceLines.length, 13); assert.equal(result.unmatched.length, 3);
      metadataCount = result.metadata.entries.reduce((n, e) => n + e.model.authors.length, 0); assert.equal(metadataCount, 53);
      buffer = await exportOriginal(); const xml = await verifyPackage(buffer, result);
      const z = await JSZip.loadAsync(buffer);
      for (const [name, content] of Object.entries(stable)) assert.deepEqual(await z.file(name).async('nodebuffer'), content, name);
      if (target === 'apa7') { if (!cycle) firstAPA = xml; else assert.equal(xml, firstAPA); }
      else { if (!cycle) firstIEEE = xml; else assert.equal(xml, firstIEEE); }
    }
  }
  console.log('  PASS supplied manuscript: 13 references, 53 authors, three unresolved citations retained, five DOCX cycles, all other package parts unchanged');
}

// Optional real-manuscript check. The private input is never copied into this repository.
async function manuscriptDocument() {
  const arg = process.argv.indexOf('--manuscript'); if (arg < 0) return;
  let buffer = fs.readFileSync(path.resolve(process.argv[arg + 1]));
  await upload(buffer, 'ieee', 'apa7');
  const initial = await convert(), referenceCount = initial.referenceLines.length;
  const authorCount = initial.metadata.entries.reduce((n, e) => n + e.model.authors.length, 0);
  assert.equal(initial.unmatched.length, 0, 'All body citations of this regression manuscript must resolve');
  const initialZip = await JSZip.loadAsync(buffer), stable = {};
  const changedParts = ['word/document.xml', 'customXml/citation-converter.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml'];
  for (const name of Object.keys(initialZip.files)) if (!initialZip.files[name].dir && !changedParts.includes(name)) stable[name] = await initialZip.file(name).async('nodebuffer');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const initialXML = await initialZip.file('word/document.xml').async('string');
  const inputDoc = new w.DOMParser().parseFromString(initialXML, 'application/xml');
  const tables = inputDoc.getElementsByTagNameNS(W, 'tbl').length, drawings = inputDoc.getElementsByTagNameNS(W, 'drawing').length;
  let firstAPA, firstIEEE, canonicalAPA;
  for (let cycle = 0; cycle < 5; cycle++) {
    for (const [source, target] of [['ieee', 'apa7'], ['apa7', 'ieee']]) {
      await upload(buffer, source, target); const result = await convert();
      assert.equal(result.referenceLines.length, referenceCount); assert.equal(result.unmatched.length, 0);
      assert.equal(result.referenceLines.filter(r => r.fullyFormatted).length, referenceCount);
      assert.equal(result.metadata.entries.reduce((n, e) => n + e.model.authors.length, 0), authorCount);
      buffer = await exportOriginal(); const xml = await verifyPackage(buffer, result);
      const doc = new w.DOMParser().parseFromString(xml, 'application/xml');
      assert.equal(doc.getElementsByTagNameNS(W, 'tbl').length, tables); assert.equal(doc.getElementsByTagNameNS(W, 'drawing').length, drawings);
      const z = await JSZip.loadAsync(buffer);
      for (const [name, content] of Object.entries(stable)) assert.deepEqual(await z.file(name).async('nodebuffer'), content, name);
      if (target === 'apa7') {
        if (!cycle) {
          firstAPA = xml; canonicalAPA = JSON.parse(JSON.stringify(result.metadata.entries));
          const output = process.argv.indexOf('--manuscript-output');
          if (output >= 0) fs.writeFileSync(path.resolve(process.argv[output + 1]), buffer);
        } else {
          assert.ok(xml === firstAPA, 'APA document.xml changed on cycle ' + (cycle + 1));
          assert.deepEqual(JSON.parse(JSON.stringify(result.metadata.entries)), canonicalAPA);
        }
      } else { if (!cycle) firstIEEE = xml; else assert.ok(xml === firstIEEE, 'IEEE document.xml changed on cycle ' + (cycle + 1)); }
    }
  }
  console.log('  PASS supplied conversion case: ' + referenceCount + ' references, ' + authorCount + ' authors, no unresolved body citations, five DOCX cycles, stable XML/metadata, ' + tables + ' tables and ' + drawings + ' drawings preserved; all other package parts unchanged');
}

(async () => {
  try { await synthetic(); await uiFeatures(); await allStyleDocx(); await sampleDocument(); await manuscriptDocument(); console.log('\n' + (3 + Number(process.argv.includes('--sample')) + Number(process.argv.includes('--manuscript'))) + ' passed, 0 failed (DOCX/UI integration).'); }
  catch (e) { console.error(e.stack); process.exitCode = 1; }
  finally { w.close(); }
})();
