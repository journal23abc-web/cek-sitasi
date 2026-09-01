// Automated tests for convert-ui.js's DOM-manipulation functions (the .docx "format asli
// dipertahankan" export) — zero extra dependencies beyond @xmldom/xmldom (already a
// devDependency) and jszip (devDependency, used only by convert-ui.js itself at runtime, not
// needed here since these tests work on parsed XML directly).
//
// convert-ui.js is written as a browser-only IIFE (it calls document.getElementById(...) at
// load time to wire up the page), so it can't be require()'d directly in Node the way
// engine.js/converter-engine.js can. Rather than maintain a second, hand-copied version of its
// DOM functions that could quietly drift out of sync with what actually ships, this extracts the
// exact function source text from convert-ui.js at test time and evaluates it against xmldom
// (which implements the same DOMParser/XMLSerializer/Node API convert-ui.js relies on) — so a
// change to the real functions is what these tests exercise, not a copy of them.
//
// Run with: node convert-ui.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const CE = require(path.join(__dirname, 'engine.js'));
const CC = require(path.join(__dirname, 'converter-engine.js'));

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const STYLES = CE.STYLES;

// Extract buildDocxTextIndex ... applyPlainReplacements verbatim from convert-ui.js and eval
// them into this scope (they only ever reference W_NS/XML_NS/CC/CE from their closure, all of
// which are already defined above).
const src = fs.readFileSync(path.join(__dirname, 'convert-ui.js'), 'utf-8');
const startMarker = '  function buildDocxTextIndex(xmlDoc) {';
const endMarker = '\n  function fileTimestamp() {';
const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1) {
  throw new Error('convert-ui.test.js: could not locate the DOM-function block in convert-ui.js — did it move or get renamed?');
}
eval(src.slice(startIdx, endIdx));
// The eval above defines: buildDocxTextIndex, paragraphAtOffset, reorderParagraphs, makeRun,
// runIsItalic, directChildRuns, runText, rewriteReferenceParagraphToApa7, applyPlainReplacements.

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (err) { fail++; failures.push({ name, err }); console.log('  FAIL  ' + name); console.log('        ' + err.message); }
}

// ---- helpers to build minimal synthetic docx-shaped XML for tests ----
const DOC_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="' + W_NS + '" xmlns:xml="' + XML_NS + '"><w:body>';
const DOC_FOOTER = '</w:body></w:document>';

function parseDoc(bodyXml) {
  return new DOMParser().parseFromString(DOC_HEADER + bodyXml + DOC_FOOTER, 'application/xml');
}
function serialize(xmlDoc) {
  return new XMLSerializer().serializeToString(xmlDoc.documentElement);
}
function run(text, italic) {
  return '<w:r>' + (italic ? '<w:rPr><w:i/></w:rPr>' : '') +
    '<w:t xml:space="preserve">' + text + '</w:t></w:r>';
}

console.log('\n=== applyPlainReplacements: multiple citations sharing one run ===');

test('two citations in the SAME original run both get replaced (not just the first)', () => {
  // Mirrors a real paragraph shape: one long run containing two separate bracket citations,
  // e.g. "...for example, Almaraz-Lopez et al. [6] and Chan and Hu [7] examined...".
  const text = 'For example, Name A et al. [6] and Name B and Name C [7] examined students.';
  const xmlDoc = parseDoc('<w:p>' + run(text, false) + '</w:p>');
  const index = buildDocxTextIndex(xmlDoc);
  const start6 = text.indexOf('[6]'), start7 = text.indexOf('[7]');
  const matches = [
    { start: start6, end: start6 + 3, text: '(2024)' },
    { start: start7, end: start7 + 3, text: '(2023)' },
  ];
  const count = applyPlainReplacements(xmlDoc, index, matches);
  assert.strictEqual(count, 2);
  const resultText = xmlDoc.getElementsByTagName('w:p')[0].getElementsByTagName('w:t')[0].parentNode.parentNode.textContent;
  assert.ok(resultText.includes('Name A et al. (2024) and Name B and Name C (2023) examined'), resultText);
  assert.ok(!resultText.includes('[6]') && !resultText.includes('[7]'), resultText);
});

test('three citations sharing one run all get replaced, in order', () => {
  const text = 'Findings from [1], [2] and [3] agree.';
  const xmlDoc = parseDoc('<w:p>' + run(text, false) + '</w:p>');
  const index = buildDocxTextIndex(xmlDoc);
  const positions = ['[1]', '[2]', '[3]'].map(tok => text.indexOf(tok));
  const matches = positions.map((p, i) => ({ start: p, end: p + 3, text: '(Ref' + (i + 1) + ')' }));
  const count = applyPlainReplacements(xmlDoc, index, matches);
  assert.strictEqual(count, 3);
  const p = xmlDoc.getElementsByTagName('w:p')[0];
  const fullText = Array.from(p.getElementsByTagName('w:t')).map(t => t.textContent).join('');
  assert.strictEqual(fullText, 'Findings from (Ref1), (Ref2) and (Ref3) agree.');
});

test('replacement in one run leaves an unrelated sibling run untouched', () => {
  const xmlDoc = parseDoc('<w:p>' + run('Before ', false) + run('[1]', false) + run(' after, and ', false) + run('Journal Name', true) + '</w:p>');
  const index = buildDocxTextIndex(xmlDoc);
  const text = index.text;
  const at = text.indexOf('[1]');
  applyPlainReplacements(xmlDoc, index, [{ start: at, end: at + 3, text: '(2020)' }]);
  const p = xmlDoc.getElementsByTagName('w:p')[0];
  const runs = Array.from(p.getElementsByTagName('w:r'));
  const italicRun = runs.find(r => r.getElementsByTagName('w:i').length > 0);
  assert.strictEqual(italicRun.getElementsByTagName('w:t')[0].textContent, 'Journal Name');
});

console.log('\n=== rewriteReferenceParagraphToApa7 ===');

function referenceParagraph(numberingText, authorText, italicText, tailText) {
  return '<w:p>' + run(numberingText, false) + '<w:r><w:tab/></w:r>' +
    run(authorText, false) + run(italicText, true) + run(tailText, false) + '</w:p>';
}

test('journal article: year moves after author, title unquoted, volume becomes italic', () => {
  const raw = '[1] O. Zawacki-Richter, V. I. Marín, M. Bond, and F. Gouverneur, "Systematic review of research on AI applications in higher education," International Journal of Educational Technology in Higher Education, vol. 16, no. 1, p. 39, 2019. doi: 10.1186/s41239-019-0171-0.';
  const ref = CE.parseReferenceLine(raw, 'ieee');
  const authorApa = CC._internal.renderAuthorListForReference(ref, 'ieee', 'apa7');
  const xmlDoc = parseDoc(referenceParagraph('[1] ',
    'O. Zawacki-Richter, V. I. Marín, M. Bond, and F. Gouverneur, \u201cSystematic review of research on AI applications in higher education,\u201d ',
    'International Journal of Educational Technology in Higher Education',
    ', vol. 16, no. 1, p. 39, 2019. doi: 10.1186/s41239-019-0171-0.'));
  const paraEl = xmlDoc.getElementsByTagName('w:p')[0];
  const ok = rewriteReferenceParagraphToApa7(xmlDoc, paraEl, ref, authorApa);
  assert.strictEqual(ok, true);
  const fullText = Array.from(paraEl.getElementsByTagName('w:t')).map(t => t.textContent).join('');
  assert.ok(fullText.startsWith('Zawacki-Richter, O., Marín, V. I., Bond, M., & Gouverneur, F. (2019). Systematic review'), fullText);
  assert.ok(!fullText.includes('\u201c') && !fullText.includes('\u201d'), fullText); // no leftover quote marks
  assert.ok(fullText.includes('16(1), 39. https://doi.org/10.1186/s41239-019-0171-0'), fullText);
  // volume "16" must be its own italic run, distinct from the (still-italic) journal name run
  const italicRuns = Array.from(paraEl.getElementsByTagName('w:r')).filter(runIsItalic);
  const italicTexts = italicRuns.map(r => r.getElementsByTagName('w:t')[0].textContent);
  assert.ok(italicTexts.includes('International Journal of Educational Technology in Higher Education'), italicTexts);
  assert.ok(italicTexts.includes('16'), italicTexts);
});

test('book reference: title stays italic verbatim, publisher extracted, no journal/DOI fields forced', () => {
  const raw = '[25] R. Luckin and W. Holmes, Intelligence Unleashed: An Argument for AI in Education. London, U.K.: Pearson, 2016.';
  const ref = CE.parseReferenceLine(raw, 'ieee');
  const authorApa = CC._internal.renderAuthorListForReference(ref, 'ieee', 'apa7');
  const xmlDoc = parseDoc(referenceParagraph('[25] ',
    'R. Luckin and W. Holmes, ',
    'Intelligence Unleashed: An Argument for AI in Education',
    '. London, U.K.: Pearson, 2016.'));
  const paraEl = xmlDoc.getElementsByTagName('w:p')[0];
  const ok = rewriteReferenceParagraphToApa7(xmlDoc, paraEl, ref, authorApa);
  assert.strictEqual(ok, true);
  const fullText = Array.from(paraEl.getElementsByTagName('w:t')).map(t => t.textContent).join('');
  assert.strictEqual(fullText, 'Luckin, R., & Holmes, W. (2016). Intelligence Unleashed: An Argument for AI in Education. Pearson.');
  const italicRun = Array.from(paraEl.getElementsByTagName('w:r')).find(runIsItalic);
  assert.strictEqual(italicRun.getElementsByTagName('w:t')[0].textContent, 'Intelligence Unleashed: An Argument for AI in Education');
});

test('conference proceedings with no volume of its own uses "In ... (pp. X-Y)." form', () => {
  const raw = '[10] R. Adnin, A. Pandkar, B. Yao, D. Wang, and M. Das, "Examining student and teacher perspectives on undisclosed use of generative AI in academic work," in Proceedings of the CHI Conference on Human Factors in Computing Systems, 2025, pp. 1-17. doi: 10.1145/3706598.3713393.';
  const ref = CE.parseReferenceLine(raw, 'ieee');
  const authorApa = CC._internal.renderAuthorListForReference(ref, 'ieee', 'apa7');
  const xmlDoc = parseDoc(referenceParagraph('[10] ',
    'R. Adnin, A. Pandkar, B. Yao, D. Wang, and M. Das, \u201cExamining student and teacher perspectives on undisclosed use of generative AI in academic work,\u201d in ',
    'Proceedings of the CHI Conference on Human Factors in Computing Systems',
    ', 2025, pp. 1-17. doi: 10.1145/3706598.3713393.'));
  const paraEl = xmlDoc.getElementsByTagName('w:p')[0];
  const ok = rewriteReferenceParagraphToApa7(xmlDoc, paraEl, ref, authorApa);
  assert.strictEqual(ok, true);
  const fullText = Array.from(paraEl.getElementsByTagName('w:t')).map(t => t.textContent).join('');
  assert.ok(fullText.includes('. In Proceedings of the CHI Conference on Human Factors in Computing Systems (pp. 1\u201317). https://doi.org/10.1145/3706598.3713393'), fullText);
});

test('numbering/tab prefix runs are removed for the APA target (no bracket numbering)', () => {
  const raw = '[1] A. Author, "A title," Some Journal, vol. 1, p. 1, 2020.';
  const ref = CE.parseReferenceLine(raw, 'ieee');
  const authorApa = CC._internal.renderAuthorListForReference(ref, 'ieee', 'apa7');
  const xmlDoc = parseDoc(referenceParagraph('[1] ', 'A. Author, \u201cA title,\u201d ', 'Some Journal', ', vol. 1, p. 1, 2020.'));
  const paraEl = xmlDoc.getElementsByTagName('w:p')[0];
  rewriteReferenceParagraphToApa7(xmlDoc, paraEl, ref, authorApa);
  const fullText = Array.from(paraEl.getElementsByTagName('w:t')).map(t => t.textContent).join('');
  assert.ok(!fullText.startsWith('[1]'), fullText);
  assert.ok(fullText.startsWith('Author, A. (2020).'), fullText);
});

test('unrecognized paragraph shape (no italic run) is left untouched, not crashed on', () => {
  const raw = '[1] A. Author, "A title," Some Journal, vol. 1, p. 1, 2020.';
  const ref = CE.parseReferenceLine(raw, 'ieee');
  const authorApa = CC._internal.renderAuthorListForReference(ref, 'ieee', 'apa7');
  const xmlDoc = parseDoc('<w:p>' + run('[1] \tA. Author, "A title," Some Journal, vol. 1, p. 1, 2020.', false) + '</w:p>');
  const paraEl = xmlDoc.getElementsByTagName('w:p')[0];
  const ok = rewriteReferenceParagraphToApa7(xmlDoc, paraEl, ref, authorApa);
  assert.strictEqual(ok, false);
  const fullText = Array.from(paraEl.getElementsByTagName('w:t')).map(t => t.textContent).join('');
  assert.ok(fullText.includes('[1]')); // untouched — caller is expected to fall back
});

test('journal name fragmented across several adjacent italic runs (Word splitting at abbreviation periods) is still treated as ONE title, not rejected', () => {
  // Real-world case: "Comput. Educ.: Artif. Intell." got split into 4 separate italic runs by
  // Word (likely spell-check breaking at each abbreviation period) — this used to fail the old
  // "exactly one italic run" check entirely and fall back to the author-only rewrite.
  const raw = '[14] T. K. F. Chiu, "Future research recommendations," Comput. Educ.: Artif. Intell., vol. 6, art. 100197, 2024, doi: 10.1016/j.caeai.2023.100197.';
  const ref = CE.parseReferenceLine(raw, 'ieee');
  const authorApa = CC._internal.renderAuthorListForReference(ref, 'ieee', 'apa7');
  const xmlDoc = parseDoc(referenceParagraph('[14] ',
    'T. K. F. Chiu, \u201cFuture research recommendations,\u201d ',
    'PLACEHOLDER', // overwritten below with 4 separate italic runs
    ', vol. 6, art. 100197, 2024, doi: 10.1016/j.caeai.2023.100197.'));
  // Rebuild with the italic journal name fragmented into 4 runs instead of the single run
  // referenceParagraph() would normally produce.
  const xmlDoc2 = parseDoc('<w:p>' + run('[14] ', false) + '<w:r><w:tab/></w:r>' +
    run('T. K. F. Chiu, \u201cFuture research recommendations,\u201d ', false) +
    run('Comput', true) + run('. Educ.: ', true) + run('Artif', true) + run('. Intell.', true) +
    run(', vol. 6, art. 100197, 2024, doi: 10.1016/j.caeai.2023.100197.', false) + '</w:p>');
  const paraEl = xmlDoc2.getElementsByTagName('w:p')[0];
  const ok = rewriteReferenceParagraphToApa7(xmlDoc2, paraEl, ref, authorApa);
  assert.strictEqual(ok, true);
  const fullText = Array.from(paraEl.getElementsByTagName('w:t')).map(t => t.textContent).join('');
  assert.ok(fullText.includes('Comput. Educ.: Artif. Intell.'), fullText); // fragments reassembled in reading order
  const italicRuns = Array.from(paraEl.getElementsByTagName('w:r')).filter(runIsItalic);
  assert.strictEqual(italicRuns.length, 5); // 4 original fragments + 1 new italic volume run
});

test('an italic run with a non-italic run sandwiched between two italic pieces is a genuinely different shape and is still rejected (not force-merged)', () => {
  const raw = '[1] A. Author, "A title," Some Journal, vol. 1, p. 1, 2020, doi: 10.1/x.';
  const ref = CE.parseReferenceLine(raw, 'ieee');
  const authorApa = CC._internal.renderAuthorListForReference(ref, 'ieee', 'apa7');
  const xmlDoc = parseDoc('<w:p>' + run('[1] ', false) + '<w:r><w:tab/></w:r>' +
    run('A. Author, \u201cA title,\u201d ', false) +
    run('Some ', true) + run('unexpected plain text', false) + run('Journal', true) +
    run(', vol. 1, p. 1, 2020, doi: 10.1/x.', false) + '</w:p>');
  const paraEl = xmlDoc.getElementsByTagName('w:p')[0];
  const ok = rewriteReferenceParagraphToApa7(xmlDoc, paraEl, ref, authorApa);
  assert.strictEqual(ok, false);
});

test('a book/report with its OWN DOI (e.g. an organizational report) does not duplicate its title and keeps the DOI', () => {
  // Reproduces a real bug: a book-shaped reference (non-quoted title, no volume/pages) that also
  // happens to carry a DOI used to be routed down the JOURNAL-article path instead (isBook used
  // to require an absent DOI), which re-prepended ref.title into the author text while ALSO
  // keeping the original italic run — whose content, for a report, already IS that same title —
  // printing the title twice and losing the publisher/DOI entirely.
  const raw = 'UNESCO, Guidance for Generative AI in Education and Research. Paris, France: UNESCO, 2023, doi: 10.54675/EWZM9535.';
  const ref = CE.parseReferenceLine(raw, 'ieee');
  const authorApa = CC._internal.renderAuthorListForReference(ref, 'ieee', 'apa7');
  const xmlDoc = parseDoc('<w:p>' +
    run('UNESCO, ', false) +
    run('Guidance for Generative AI in Education and Research', true) +
    run('. Paris, France: UNESCO, 2023, doi: 10.54675/EWZM9535.', false) + '</w:p>');
  const paraEl = xmlDoc.getElementsByTagName('w:p')[0];
  const ok = rewriteReferenceParagraphToApa7(xmlDoc, paraEl, ref, authorApa);
  assert.strictEqual(ok, true);
  const fullText = Array.from(paraEl.getElementsByTagName('w:t')).map(t => t.textContent).join('');
  const titleOccurrences = fullText.split('Guidance for Generative AI in Education and Research').length - 1;
  assert.strictEqual(titleOccurrences, 1, fullText); // title appears exactly once, not twice
  assert.ok(fullText.includes('UNESCO.'), fullText); // publisher survives
  assert.ok(fullText.includes('https://doi.org/10.54675/EWZM9535'), fullText); // DOI survives too
});

console.log(`\n${pass} passed, ${fail} failed.\n`);
if (fail > 0) {
  process.exitCode = 1;
}
