// Automated tests for link-engine.js — zero dependencies beyond @xmldom/xmldom, pure Node `assert`.
// Run with: node tests/link-engine.test.js
//
// These build small, realistic word/document.xml fragments by hand (rather than a full real
// .docx) so each scenario is isolated and fast — the fixtures below mirror the exact structural
// patterns found in real citation-manager-generated documents that this file needs to handle.

const assert = require('assert');
const path = require('path');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const CE = require(path.join(__dirname, '..', 'engine.js'));

global.window = { CitationEngine: CE };
global.DOMParser = DOMParser;
global.XMLSerializer = XMLSerializer;
require(path.join(__dirname, '..', 'link-engine.js'));
const CitationLinker = global.window.CitationLinker;

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.log('  FAIL  ' + name + '\n        ' + e.message);
  }
}

var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function xmlDocFromParas(paraXmlList) {
  var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="' + W_NS + '"><w:body>' + paraXmlList.join('') + '</w:body></w:document>';
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function run(text) { return '<w:r><w:t xml:space="preserve">' + text + '</w:t></w:r>'; }
function para(innerXml) { return '<w:p>' + innerXml + '</w:p>'; }
function sdtWrappedPara(prefixRuns, sdtRuns, suffixRuns) {
  var sdtContent = sdtRuns.map(run).join('');
  return para(
    prefixRuns.map(run).join('') +
    '<w:sdt><w:sdtPr></w:sdtPr><w:sdtEndPr></w:sdtEndPr><w:sdtContent>' + sdtContent + '</w:sdtContent></w:sdt>' +
    suffixRuns.map(run).join('')
  );
}
function hyperlinkWrappedPara(prefixRuns, hlRuns, suffixRuns, anchor) {
  var hlContent = hlRuns.map(run).join('');
  return para(
    prefixRuns.map(run).join('') +
    '<w:hyperlink w:anchor="' + (anchor || 'old_target') + '">' + hlContent + '</w:hyperlink>' +
    suffixRuns.map(run).join('')
  );
}

function plainText(xmlDoc) {
  var wts = xmlDoc.getElementsByTagName('w:t');
  var t = '';
  for (var i = 0; i < wts.length; i++) t += wts[i].textContent;
  return t;
}

console.log('\n=== SDT-wrapped citations (content-control plugin, the reported bug) ===');

test('a citation wrapped in <w:sdt><w:sdtContent> gets linked (regression for the reported bug)', () => {
  var paras = [
    para(run('Studi oleh ')),
    sdtWrappedPara([], ['(Smith, 2020)'], []),
    para(run(' menunjukkan hal ini.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var textBefore = plainText(xmlDoc);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 1);
  assert.strictEqual(result.unmatched.length, 0);
  assert.strictEqual(xmlDoc.getElementsByTagName('w:sdt').length, 0, 'the sdt wrapper should be fully unwrapped');
  assert.strictEqual(xmlDoc.getElementsByTagName('w:hyperlink').length, 1);
  assert.strictEqual(plainText(xmlDoc), textBefore, 'unwrapping + linking must not change any visible text');
});

test('multiple SDT-wrapped citations in the same paragraph all get linked', () => {
  var paras = [
    para(
      run('First ') +
      '<w:sdt><w:sdtContent>' + run('(Smith, 2020)') + '</w:sdtContent></w:sdt>' +
      run(' then ') +
      '<w:sdt><w:sdtContent>' + run('(Jones, 2019)') + '</w:sdtContent></w:sdt>' +
      run(' end.')
    ),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
    para(run('Jones, K. (2019). Title. Journal, 2(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var textBefore = plainText(xmlDoc);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 2);
  assert.strictEqual(result.unmatched.length, 0);
  assert.strictEqual(xmlDoc.getElementsByTagName('w:sdt').length, 0);
  assert.strictEqual(plainText(xmlDoc), textBefore);
});

test('a citation split across an SDT boundary (partly inside, partly outside) still links', () => {
  // Mirrors the real-world case found in the reported document: "(Gunawan, 2023; Gunawan &
  // Wiyata, 2024)" where only PART of the parenthetical group is inside the sdt.
  var paras = [
    sdtWrappedPara(['Studi ('], ['Gunawan, 2023; '], [') dan lainnya menunjukkan.']),
    para(run('REFERENCES')),
    para(run('Gunawan, A. (2023). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 1);
  assert.strictEqual(result.unmatched.length, 0);
});

console.log('\n=== Existing hyperlink retargeting (Mendeley/Zotero-style, regression) ===');

test('a citation already wrapped in a hyperlink gets retargeted, not double-wrapped', () => {
  var paras = [
    para(run('Studi oleh ')),
    hyperlinkWrappedPara([], ['(Smith, 2020)'], [], 'wrong_old_anchor'),
    para(run(' menunjukkan hal ini.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var textBefore = plainText(xmlDoc);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 1);
  assert.strictEqual(result.retargeted, 1);
  var hyperlinks = xmlDoc.getElementsByTagName('w:hyperlink');
  assert.strictEqual(hyperlinks.length, 1, 'must not create a second, nested hyperlink');
  assert.notStrictEqual(hyperlinks[0].getAttribute('w:anchor'), 'wrong_old_anchor');
  assert.strictEqual(plainText(xmlDoc), textBefore);
});

console.log('\n=== Plain (unwrapped) citations, no special structure ===');

test('an ordinary plain-text citation (no sdt, no hyperlink) still links correctly', () => {
  var paras = [
    para(run('Studi oleh Smith (2020) menunjukkan hal ini.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 1);
  assert.strictEqual(result.unmatched.length, 0);
});

test('a citation with no matching reference is reported as unmatched, not crashed', () => {
  var paras = [
    para(run('Studi oleh Nobody (2099) menunjukkan hal ini.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 0);
  assert.strictEqual(result.unmatched.length, 1);
});

console.log('\n=== Readable bookmark names (Surname+Year, not opaque ref_5000) ===');

function bookmarkNamesIn(xmlDoc) {
  var bms = xmlDoc.getElementsByTagName('w:bookmarkStart');
  var names = [];
  for (var i = 0; i < bms.length; i++) {
    var n = bms[i].getAttribute('w:name');
    if (n && n.charAt(0) !== '_') names.push(n);
  }
  return names;
}

test('a new bookmark is named after the reference\'s first author surname + year, not an opaque "ref_5000" id', () => {
  var paras = [
    para(run('Studi oleh ') + run('(Smith, 2020)') + run(' menunjukkan hal ini.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  var names = bookmarkNamesIn(xmlDoc);
  assert.strictEqual(names.length, 1);
  assert.strictEqual(names[0], 'Smith2020');
});

test('accented/special characters in the surname are normalized to their base letter, not just deleted (Müller -> Muller, not Mller)', () => {
  var paras = [
    para(run('Studi oleh ') + run('(Müller, 2019)') + run(' menunjukkan hal ini.')),
    para(run('REFERENCES')),
    para(run('Müller, A. (2019). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  var names = bookmarkNamesIn(xmlDoc);
  assert.strictEqual(names[0], 'Muller2019');
});

test('an apostrophe/hyphen in the surname is stripped cleanly (O\'Brien, Garcia-Lopez)', () => {
  var paras = [
    para(run('Studi oleh ') + run("(O'Brien, 2021)") + run(' dan ') + run('(Garcia-Lopez, 2022)') + run(' menunjukkan hal ini.')),
    para(run('REFERENCES')),
    para(run("O'Brien, K. (2021). Title. Journal, 1(1), 1-10.")),
    para(run('Garcia-Lopez, M. (2022). Title. Journal, 2(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  var names = bookmarkNamesIn(xmlDoc).sort();
  assert.deepStrictEqual(names, ['GarciaLopez2022', 'OBrien2021']);
});

test('two different references that would normalize to the same bookmark name get disambiguated', () => {
  var paras = [
    para(run('Studi oleh ') + run('(Smith, 2020a)') + run(' dan ') + run('(Smith, 2020b)') + run(' menunjukkan hal ini.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020a). First title. Journal, 1(1), 1-10.')),
    para(run('Smith, K. (2020b). Second title. Journal, 2(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  var names = bookmarkNamesIn(xmlDoc);
  assert.strictEqual(names.length, 2);
  assert.strictEqual(new Set(names).size, 2, 'the two bookmark names must be distinct, got: ' + JSON.stringify(names));
});

console.log('\n=== Citation\'s own "(" and ")" are included in the linked span ===');

function hyperlinkTexts(xmlDoc) {
  var hls = xmlDoc.getElementsByTagName('w:hyperlink');
  var texts = [];
  for (var i = 0; i < hls.length; i++) {
    var wts = hls[i].getElementsByTagName('w:t');
    var t = '';
    for (var j = 0; j < wts.length; j++) t += wts[j].textContent;
    texts.push(t);
  }
  return texts;
}

test('a single parenthetical citation "(Smith, 2020)" is linked INCLUDING both parentheses', () => {
  var paras = [
    para(run('Studi oleh ') + run('(Smith, 2020)') + run(' menunjukkan hal ini.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  var texts = hyperlinkTexts(xmlDoc);
  assert.strictEqual(texts.length, 1);
  assert.strictEqual(texts[0], '(Smith, 2020)', 'expected the parentheses themselves to be part of the hyperlink, got: ' + JSON.stringify(texts[0]));
});

test('in a multi-citation group "(Smith, 2020; Jones, 2019)", the opening "(" attaches to the first link and the closing ")" to the last', () => {
  var paras = [
    para(run('Studi oleh ') + run('(Smith, 2020; Jones, 2019)') + run(' menunjukkan hal ini.')),
    para(run('REFERENCES')),
    para(run('Jones, K. (2019). Title. Journal, 2(1), 1-10.')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 2);
  var texts = hyperlinkTexts(xmlDoc);
  assert.strictEqual(texts.length, 2);
  assert.ok(texts[0].startsWith('('), 'first segment should include the opening "(": ' + JSON.stringify(texts[0]));
  assert.ok(texts[1].endsWith(')'), 'last segment should include the closing ")": ' + JSON.stringify(texts[1]));
  // the whole visible text must still be completely unchanged
  assert.strictEqual(texts[0] + '; ' + texts[1], '(Smith, 2020; Jones, 2019)');
});

console.log('\n=== Regression: bare institutional acronym citations (e.g. "BSP") now correctly link to their spelled-out reference ===');

test('a bare acronym citation ("BSP, 2023") inside a multi-citation group links correctly to a reference written out in full, when the acronym was introduced elsewhere in the article as "Full Name (BSP)"', () => {
  var paras = [
    para(run('The Bangko Sentral ng Pilipinas (BSP) regulates digital banks. Inflation intensified ') + run('(Ferreira, 2019; BSP, 2023)') + run(' during this period.')),
    para(run('REFERENCES')),
    para(run('Bangko Sentral ng Pilipinas. (2023). Circular. Publisher.')),
    para(run('Ferreira, C. (2019). Title. Publisher.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 2);
  assert.strictEqual(result.unmatched.length, 0);
});

console.log('\n' + '='.repeat(50));
console.log(`${pass} passed, ${fail} failed (of ${pass + fail} total)`);
if (fail > 0) process.exit(1);
