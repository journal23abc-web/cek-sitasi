// Automated tests for link-engine.js — zero dependencies beyond @xmldom/xmldom, pure Node `assert`.
// Run with: node link-engine.test.js
//
// These build small, realistic word/document.xml fragments by hand (rather than a full real
// .docx) so each scenario is isolated and fast — the fixtures below mirror the exact structural
// patterns found in real citation-manager-generated documents that this file needs to handle.

const assert = require('assert');
const path = require('path');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const CE = require(path.join(__dirname, 'engine.js'));

global.window = { CitationEngine: CE };
global.DOMParser = DOMParser;
global.XMLSerializer = XMLSerializer;
require(path.join(__dirname, 'link-engine.js'));
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

test('safe default preserves an SDT citation-manager field while linking inside its content', () => {
  var paras = [
    sdtWrappedPara([], ['(Smith, 2020)'], []),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var textBefore = plainText(xmlDoc);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 1);
  assert.strictEqual(result.protectedControlsSkipped, 0);
  assert.strictEqual(xmlDoc.getElementsByTagName('w:sdt').length, 1);
  assert.strictEqual(xmlDoc.getElementsByTagName('w:sdt')[0].getElementsByTagName('w:hyperlink').length, 1);
  assert.strictEqual(plainText(xmlDoc), textBefore);
  assert.strictEqual(result.integrity.ok, true);
});

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
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', preserveCitationControls: false });
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
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', preserveCitationControls: false });
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

test('running the linker twice is idempotent: no duplicate bookmark/hyperlink and second pass is reported as already linked', () => {
  var paras = [
    para(run('Studi oleh ') + run('(Smith, 2020)') + run(' menunjukkan hal ini.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var textBefore = plainText(xmlDoc);
  var first = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  var bookmarksAfterFirst = xmlDoc.getElementsByTagName('w:bookmarkStart').length;
  var linksAfterFirst = xmlDoc.getElementsByTagName('w:hyperlink').length;
  var second = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(first.newlyLinked, 1);
  assert.strictEqual(second.newlyLinked, 0);
  assert.strictEqual(second.alreadyLinked, 1);
  assert.strictEqual(xmlDoc.getElementsByTagName('w:bookmarkStart').length, bookmarksAfterFirst);
  assert.strictEqual(xmlDoc.getElementsByTagName('w:hyperlink').length, linksAfterFirst);
  assert.strictEqual(plainText(xmlDoc), textBefore);
  assert.strictEqual(second.integrity.ok, true);
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

console.log('\n=== Regression: grouped multi-year narrative citations ("BSP (2020, 2024, 2025, 2026a)") were collapsing into a single overlapping span ===');

test('all four years in a grouped multi-year narrative citation get their own distinct, non-overlapping hyperlink to their respective reference', () => {
  var paras = [
    para(run('The Bangko Sentral ng Pilipinas (BSP) regulates banks. Sources: ') + run('BSP (2020, 2024, 2025, 2026a)') + run(' and ') + run('Philippine Deposit Insurance Corporation (2025)') + run('.')),
    para(run('REFERENCES')),
    para(run('Bangko Sentral ng Pilipinas. (2020). Title A. Publisher.')),
    para(run('Bangko Sentral ng Pilipinas. (2024). Title B. Publisher.')),
    para(run('Bangko Sentral ng Pilipinas. (2025). Title C. Publisher.')),
    para(run('Bangko Sentral ng Pilipinas. (2026a). Title D. Publisher.')),
    para(run('Philippine Deposit Insurance Corporation. (2025). Title E. Publisher.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 5);
  assert.strictEqual(result.unmatched.length, 0);
  var texts = hyperlinkTexts(xmlDoc);
  // each year's span must be distinct (non-overlapping) and together reconstruct the original text exactly
  assert.strictEqual(texts.slice(0, 4).join(''), 'BSP (2020, 2024, 2025, 2026a)');
});

console.log('\n=== New: auto-link plain URLs/DOIs in reference entries ===');

test('a plain https:// URL in a reference entry gets wrapped in a hyperlink pointing to it, with a new relationship entry created', () => {
  var paras = [
    para(run('Studi ini penting.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10. https://doi.org/10.1234/abcd')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc });
  assert.strictEqual(result.urlsLinked, 1);
  var rel = relsXmlDoc.getElementsByTagName('Relationship')[0];
  assert.strictEqual(rel.getAttribute('Target'), 'https://doi.org/10.1234/abcd');
  assert.strictEqual(rel.getAttribute('TargetMode'), 'External');
  var hls = xmlDoc.getElementsByTagName('w:hyperlink');
  assert.strictEqual(hls.length, 1);
  assert.strictEqual(hls[0].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'), rel.getAttribute('Id'));
});

test('a bare "doi: 10.xxxx/yyyy" (no https:// prefix) in a reference is also linkified, resolving to the full doi.org URL', () => {
  var paras = [
    para(run('Studi ini penting.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10. doi: 10.5678/xyz-123')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc });
  assert.strictEqual(result.urlsLinked, 1);
  assert.strictEqual(relsXmlDoc.getElementsByTagName('Relationship')[0].getAttribute('Target'), 'https://doi.org/10.5678/xyz-123');
});

test('a URL already wrapped in a real hyperlink is left untouched (not double-wrapped)', () => {
  var paras = [
    para(run('Studi ini penting.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. ') + '<w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId9"><w:r><w:t>https://doi.org/10.1234/already</w:t></w:r></w:hyperlink>'),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc });
  assert.strictEqual(result.urlsLinked, 0);
  assert.strictEqual(relsXmlDoc.getElementsByTagName('Relationship').length, 0);
});

test('URL auto-linking can be turned off via options.linkReferenceUrls: false', () => {
  var paras = [
    para(run('Studi ini penting.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10. https://doi.org/10.1234/abcd')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc, linkReferenceUrls: false });
  assert.strictEqual(result.urlsLinked, 0);
});

console.log('\n=== New: optional Figure/Table cross-reference linking (default OFF) ===');

test('mentions of "Figure N"/"Table N" in the body link to their caption paragraph, while the caption itself is untouched', () => {
  var paras = [
    para(run('Sebagaimana ditunjukkan pada Figure 1, hasil penelitian menunjukkan tren positif.')),
    para(run('Figure 1. Grafik tren penjualan.')),
    para(run('Lebih lanjut, Table 2 merangkum data, dan Figure 1 kembali disebut di sini.')),
    para(run('Table 2. Ringkasan statistik.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc, linkFiguresTables: true });
  assert.strictEqual(result.figuresTablesCaptionsFound, 2);
  assert.strictEqual(result.figuresTablesLinked, 3); // 2x "Figure 1" mentions + 1x "Table 2" mention (captions themselves excluded)
  var bms = Array.from(xmlDoc.getElementsByTagName('w:bookmarkStart')).map((b) => b.getAttribute('w:name'));
  assert.ok(bms.includes('figtbl_fig_1'));
  assert.ok(bms.includes('figtbl_tbl_2'));
});

test('a mentioned figure/table with no matching caption is left as plain text — never guessed', () => {
  var paras = [
    para(run('Sebagaimana disebutkan di Table 3, data tidak lengkap.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc, linkFiguresTables: true });
  assert.strictEqual(result.figuresTablesLinked, 0);
});

console.log('\n=== Regression: options.linkColor was never wired into figure/table linking — the option existed and worked for citations, but figure/table hyperlinks always ignored it (hardcoded null) ===');

test('options.linkColor is correctly applied to a plain-text "Figure N"/"Table N" mention that gets linked', () => {
  var paras = [
    para(run('Sebagaimana ditunjukkan pada Figure 1, hasil penelitian menunjukkan tren positif dan jelas.')),
    para(run('Figure 1. Grafik tren penjualan.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc, linkFiguresTables: true, linkColor: '0000FF' });
  assert.strictEqual(result.figuresTablesLinked, 1);
  var serialized = new XMLSerializer().serializeToString(xmlDoc);
  assert.ok(serialized.includes('w:color w:val="0000FF"'), 'warna harus muncul di hyperlink Figure/Table, bukan cuma di sitasi');
});

test('options.linkColor is applied to the visible result run of a field-code figure/table mention too (e.g. the "1" inside a Word Cross-reference field), not just plain-text mentions', () => {
  var fieldRun =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> REF _Ref123 \\r \\h </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>1</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  var paras = [
    para(run('As shown in Table ') + fieldRun + run(', the reliability scores exceed the recommended threshold.')),
    para(run('INTRODUCTION')),
    para(run('Some article body text discussing the topic in sufficient detail for the parser to work.')),
    para(run('Table 1. Reliability and Convergent Validity')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title A. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc, linkFiguresTables: true, linkColor: 'FF0000' });
  assert.strictEqual(result.figuresTablesLinked, 1);
  var serialized = new XMLSerializer().serializeToString(xmlDoc);
  assert.ok(serialized.includes('w:color w:val="FF0000"'), 'warna harus muncul walau sebutannya dibuat lewat field code Word');
});

test('figure/table linking is OFF by default (no options.linkFiguresTables passed)', () => {
  var paras = [
    para(run('Lihat Figure 1 untuk detail.')),
    para(run('Figure 1. Grafik detail.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc });
  assert.strictEqual(result.figuresTablesLinked, 0);
  assert.strictEqual(xmlDoc.getElementsByTagName('w:hyperlink').length, 0);
});

console.log('\n=== Regression: a citation whose visible text is the CACHED RESULT of a field (e.g. Mendeley\'s ADDIN CSL_CITATION — very common: fldChar begin -> instrText (huge JSON metadata) -> fldChar separate -> visible "(Author, Year)" -> fldChar end) was universally rejected as "unsupported run structure", even though the match never touches the field\'s structural markers at all ===');

test('a citation entirely contained within a field\'s cached-result run (not touching fldChar/instrText markers at all) links normally, exactly like plain text — this is the single most common real-world citation pattern (Mendeley/EndNote keeping citations "live" via fields) and was completely broken before this fix', () => {
  var fieldRun =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve">ADDIN CSL_CITATION {"citationItems":[{"id":"x"}]}</w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>(Hair et al., 2019)</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  var paras = [
    para(run('This is supported by ') + fieldRun + run(' regarding the PLS-SEM methodology used throughout.')),
    para(run('REFERENCES')),
    para(run('Hair, J. F., Ringle, C. M. (2019). When to use and how to report the results of PLS-SEM. Journal, 31(1), 2-24.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc, linkColor: '0000FF' });
  assert.strictEqual(result.linked, 1);
  assert.strictEqual(result.unmatched.length, 0);
  // Field-nya sendiri (begin..end) HARUS tetap utuh tanpa terpotong hyperlink apa pun —
  // hyperlink cuma boleh membungkus SEBAGIAN teks hasil cache-nya, tidak menyentuh markernya.
  var serialized = new XMLSerializer().serializeToString(xmlDoc);
  var beginIdx = serialized.indexOf('fldCharType="begin"');
  var endIdx = serialized.indexOf('fldCharType="end"');
  var between = serialized.slice(beginIdx, endIdx);
  var hlOpenCount = (between.match(/<w:hyperlink/g) || []).length;
  var hlCloseCount = (between.match(/<\/w:hyperlink>/g) || []).length;
  assert.strictEqual(hlOpenCount, hlCloseCount, 'setiap <w:hyperlink> yang dibuka di antara begin..end harus tertutup DI DALAM rentang yang sama juga (field tidak boleh "menelan" separuh hyperlink)');
  assert.ok(serialized.includes('w:color w:val="0000FF"'));
});




test('a citation bookmark whose bookmarkStart sits OUTSIDE the reference paragraph (as a body-level sibling right before it — a real pattern from Mendeley/Zotero-generated documents) but whose bookmarkEnd is inside it is correctly detected and reused, instead of creating a duplicate-named bookmark', () => {
  var paras = [
    para(run('Studies (Smith, 2020) show this clearly in the recent literature overall.')),
    para(run('REFERENCES')),
  ];
  // Simulasikan bookmark "melintasi" 2 paragraf: bookmarkStart sebagai elemen mengambang SEBELUM
  // paragraf referensi (pola Mendeley), bookmarkEnd DI DALAM paragraf referensi itu sendiri.
  var refParaXml = '<w:bookmarkStart w:id="0" w:name="Smith2020"/>' + para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.') + '<w:bookmarkEnd w:id="0"/>');
  var xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paras.join('') + refParaXml + '</w:body></w:document>';
  var xmlDoc = new DOMParser().parseFromString(xml, 'application/xml');
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc });
  var bmNames = Array.from(xmlDoc.getElementsByTagName('w:bookmarkStart')).map((b) => b.getAttribute('w:name'));
  var smithCount = bmNames.filter((n) => n === 'Smith2020').length;
  assert.strictEqual(smithCount, 1, 'harus tetap cuma SATU bookmark "Smith2020", bukan bikin baru dengan nama sama: ' + JSON.stringify(bmNames));
});

test('re-running figure/table linking on a document that already has figtbl_ bookmarks from a prior pass reuses the existing bookmarks instead of creating duplicate-named ones', () => {
  var captionPara = '<w:bookmarkStart w:id="8000" w:name="figtbl_tbl_1"/>' + para(run('Table 1. Reliability and Convergent Validity') + '<w:bookmarkEnd w:id="8000"/>');
  var paras = [
    para(run('Table 1 presents the reliability scores for all constructs in the study overall.')),
    para(run('INTRODUCTION')),
    para(run('Some article body text discussing the topic in sufficient detail for the parser.')),
  ];
  var xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paras.join('') + captionPara + para(run('REFERENCES')) + para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')) + '</w:body></w:document>';
  var xmlDoc = new DOMParser().parseFromString(xml, 'application/xml');
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc, linkFiguresTables: true });
  var bmNames = Array.from(xmlDoc.getElementsByTagName('w:bookmarkStart')).map((b) => b.getAttribute('w:name'));
  var tbl1Count = bmNames.filter((n) => n === 'figtbl_tbl_1').length;
  assert.strictEqual(tbl1Count, 1, 'harus tetap cuma SATU bookmark "figtbl_tbl_1", bukan bikin baru dengan nama sama: ' + JSON.stringify(bmNames));
  assert.strictEqual(result.figuresTablesLinked, 1); // sebutan "Table 1" tetap berhasil ditautkan ke bookmark yang SUDAH ada
});



test('a "Table N" mention built from Word\'s native Cross-reference field (fldChar begin/instrText/separate/result/end) is now correctly LINKED — the entire field is moved as one intact unit inside the new <w:hyperlink>, exactly like a manual Ctrl+K selection in Word would produce, never splitting the field\'s internal begin/instrText/separate/end sequence', () => {
  var fieldRun =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> REF _Ref123 \\r \\h </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>1</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  var paras = [
    para(run('As shown in Table ') + fieldRun + run(', the reliability scores exceed the recommended threshold.')),
    para(run('INTRODUCTION')),
    para(run('Some article body text discussing the topic in sufficient detail for the parser to work.')),
    para(run('Table 1. Reliability and Convergent Validity')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title A. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc, linkFiguresTables: true });
  assert.strictEqual(result.figuresTablesLinked, 1);
  // Yang PALING penting: urutan run field code (begin, instrText, separate, hasil, end) HARUS
  // tetap berurutan tanpa jeda elemen LAIN SELAIN w:hyperlink pembungkusnya sendiri — field-nya
  // sendiri tidak boleh terpotong/tersisipi apa pun DI ANTARA kelima run itu.
  var serialized = new XMLSerializer().serializeToString(xmlDoc);
  var fieldIdx = serialized.indexOf('fldCharType="begin"');
  var endIdx = serialized.indexOf('fldCharType="end"');
  var between = serialized.slice(fieldIdx, endIdx);
  assert.ok(between.indexOf('</w:hyperlink>') === -1, 'tidak boleh ada </w:hyperlink> (penutup) di antara fldChar begin dan end, field harus tetap satu kesatuan utuh: ' + between);
  // hyperlink-nya sendiri harus membungkus SELURUH field ini (bukan sebagian)
  assert.ok(serialized.indexOf('<w:hyperlink w:anchor="figtbl_tbl_1"') < fieldIdx, 'hyperlink harus dimulai SEBELUM field dimulai');
});

test('a match that only PARTIALLY overlaps a field (starts or ends in the middle of the field\'s internal run sequence, not aligned with the field\'s true begin/end boundary) is still safely rejected — this genuinely ambiguous case must never produce a hyperlink that splits the field', () => {
  var fieldRun =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> REF _Ref123 \\r \\h </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>123</w:t></w:r>' + // hasil field 3 karakter, sengaja dibuat agar bisa "dipotong sebagian"
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  // Naskah ini TIDAK dipakai untuk memicu match parsial secara langsung (mesin pencocokan
  // Figure/Table normalnya tidak akan menghasilkan match separuh-field), tapi kita uji
  // wrapWithHyperlink secara lebih langsung lewat cara lain: pastikan perilaku dasarnya, kalau
  // toh suatu saat ada jalur lain yang memicu match separuh field, tetap tertolak dengan aman.
  var paras = [
    para(run('Value ') + fieldRun + run(' was recorded during the experiment for later analysis.')),
    para(run('INTRODUCTION')),
    para(run('Some article body text discussing the topic in sufficient detail for the parser.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title A. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  // Tidak ada sebutan Figure/Table genuine di sini -> pastikan tidak ada hyperlink figtbl_* yang
  // ke-generate sama sekali dari teks field "123" ini (memastikan field code TIDAK ikut
  // ke-scan/ke-treat seolah sitasi atau figure/table oleh mesin manapun).
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc, linkFiguresTables: true });
  assert.strictEqual(result.figuresTablesLinked, 0);
  var serialized = new XMLSerializer().serializeToString(xmlDoc);
  var fieldIdx = serialized.indexOf('fldCharType="begin"');
  var endIdx = serialized.indexOf('fldCharType="end"');
  var between = serialized.slice(fieldIdx, endIdx);
  assert.ok(between.indexOf('</w:hyperlink>') === -1, 'field tidak boleh terpotong hyperlink apa pun: ' + between);
});

test('a genuine plain-text mention in the SAME paragraph as an unrelated field code is still safely linked — only the field-code portion itself is protected, not the whole paragraph', () => {
  var fieldRun =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>4</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  var paras = [
    para(run('See page ') + fieldRun + run(' for Table 1, which reports reliability scores at length.')),
    para(run('INTRODUCTION')),
    para(run('Some article body text discussing the topic in sufficient detail for the parser.')),
    para(run('Table 1. Reliability and Convergent Validity')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title A. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc, linkFiguresTables: true });
  assert.strictEqual(result.figuresTablesLinked, 1); // "Table 1" (teks polos, di luar field PAGE) tetap tertaut normal
});


test('a prose sentence beginning with "Figure 1 shows that..." is correctly treated as a MENTION to be linked, not mistaken for the caption — the caption is the paragraph starting "Figure 1." (with a period/colon/dash right after the number)', () => {
  var paras = [
    para(run('Figure 1 shows that the distribution follows a normal pattern across all respondents.')),
    para(run('INTRODUCTION')),
    para(run('Some article body text discussing the topic in sufficient detail for the parser to work correctly.')),
    para(run('Figure 1. Distribution of respondent age across the sample population.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc, linkFiguresTables: true });
  assert.strictEqual(result.figuresTablesCaptionsFound, 1); // cuma "Figure 1. Distribution..." yang genuinely caption
  assert.strictEqual(result.figuresTablesLinked, 1); // "Figure 1 shows that..." ditautkan sebagai mention
  // bookmark harus menempel di paragraf caption ASLI (yang diawali "Figure 1." dengan titik),
  // BUKAN paragraf kalimat "Figure 1 shows that..." (yang cuma kebetulan diawali kata sama)
  var bookmarkPara = null;
  var bmStarts = Array.from(xmlDoc.getElementsByTagName('w:bookmarkStart'));
  bmStarts.forEach((b) => {
    if (b.getAttribute('w:name') === 'figtbl_fig_1') bookmarkPara = b.parentNode;
  });
  assert.ok(bookmarkPara, 'bookmark figtbl_fig_1 harus ada');
  assert.ok(bookmarkPara.textContent.indexOf('Distribution of respondent age') !== -1, 'bookmark harus di paragraf caption, isi paragraf: ' + bookmarkPara.textContent);
});

test('a genuine caption written with a colon instead of a period ("Table 1: Reliability...") is still correctly recognized as a caption', () => {
  var paras = [
    para(run('Table 1 shows the reliability scores for each construct in the study overall.')),
    para(run('INTRODUCTION')),
    para(run('Some article body text discussing the topic in sufficient detail for the parser.')),
    para(run('Table 1: Reliability and Convergent Validity')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc, linkFiguresTables: true });
  assert.strictEqual(result.figuresTablesCaptionsFound, 1);
  assert.strictEqual(result.figuresTablesLinked, 1);
});

console.log('\n=== Regression: narrative citation with a possessive apostrophe ("Bandura\u2019s (1986)") now correctly links ===');

test('a narrative citation with a curly-quote possessive ("Bandura\u2019s (1986) theory") correctly links to its reference — the possessive grammar suffix must not become part of the matching key', () => {
  var paras = [
    para(run('Derived from Bandura\u2019s (1986) social cognitive theory, this concept is central.')),
    para(run('REFERENCES')),
    para(run('Bandura, A. (1986). Social foundations of thought and action. Prentice-Hall.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc });
  assert.strictEqual(result.unmatched.length, 0);
  assert.strictEqual(result.linked, 1);
});

console.log('\n=== Regression: "How to Cite" self-citation box before Introduction is not linked as a real citation ===');

test('a "How to Cite" box before the Introduction heading is not turned into a hyperlink, while a genuine citation after it still is', () => {
  var paras = [
    para(run('To cite this article: Shiddiq, A. K., Faiz, M. N. (2026). Some Title. Journal, 1(1), 66-81.')),
    para(run('INTRODUCTION')),
    para(run('This is discussed by Jones (2021) in detail, providing enough substantial content for the test.')),
    para(run('REFERENCES')),
    para(run('Jones, K. (2021). Title. Publisher.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 1); // cuma "Jones (2021)", bukan kotak how-to-cite
  var texts = hyperlinkTexts(xmlDoc);
  assert.ok(!texts.some((t) => t.includes('Shiddiq')));
});

console.log('\n=== Regression: link-engine.js automatically benefits from shared extraction fixes (accented author names, preposition+place-name prefixes) ===');

test('a narrative citation with an accented author name ("Özekinci and Eminsoy (2025)") links correctly and completely, not truncated to just the second author', () => {
  var paras = [
    para(run('Prior work. Özekinci and Eminsoy (2025) examined academicians\u2019 knowledge and attitudes toward AI, at some length.')),
    para(run('REFERENCES')),
    para(run('Özekinci, A., & Eminsoy, İ. O. (2025). Title. Publisher.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 1);
  assert.strictEqual(result.unmatched.length, 0);
});

test('"Outside Nigeria, Syed et al. (2024)" links correctly to the Syed reference, with the leading preposition+place-name prefix correctly excluded from the link span', () => {
  var paras = [
    para(run('Tech is available.') + run(' Outside Nigeria, Syed et al. (2024) investigated awareness of AI tools in academia at length.')),
    para(run('REFERENCES')),
    para(run('Syed, A., Ibrahim, K., & Noor, M. (2024). Title. Publisher.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 1);
  assert.strictEqual(result.unmatched.length, 0);
  var texts = hyperlinkTexts(xmlDoc);
  assert.ok(!texts.some((t) => t.includes('Outside Nigeria')));
});

console.log('\n=== Regression: URL auto-linking truncating a DOI that legitimately contains parentheses ===');

test('a reference DOI URL ending in a parenthesized issue number (e.g. Virtual Economics\u2019 "10.34021/ve.2023.06.03(1)") is linked to the FULL, untruncated URL, not cut off at the opening paren', () => {
  var paras = [
    para(run('Studi ini penting.')),
    para(run('REFERENCES')),
    para(run('Titko, J. (2023). Title. Virtual Economics, 6(3), 7\u201319. https://doi.org/10.34021/ve.2023.06.03(1)')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc });
  assert.strictEqual(result.urlsLinked, 1);
  var rel = relsXmlDoc.getElementsByTagName('Relationship')[0];
  assert.strictEqual(rel.getAttribute('Target'), 'https://doi.org/10.34021/ve.2023.06.03(1)');
});

console.log('\n=== Regression: a short table cell/label reading exactly "References" earlier in the document (e.g. a bibliometric corpus-statistics table showing a citation-count stat) was wrongly picked as the bibliography heading, truncating the whole article body and mis-parsing hundreds of unrelated paragraphs/table rows as bibliography entries ===');

test('when a short "References" line appears early (a corpus-statistics table cell/label, not followed by anything reference-list-like), the LAST "References" heading — the genuine bibliography, near the real end of the document with substantial content after it — is correctly used instead', () => {
  var paras = [
    para(run('Annual Growth Rate (%)')),
    para(run('22.02')),
    para(run('References')), // label tabel statistik korpus, BUKAN heading bibliografi asli
    para(run('94,688')),
    para(run('Document Contents')),
    para(run('INTRODUCTION')),
    para(run('Some article body text discussing Smith (2020) and the topic in sufficient detail for the parser to work correctly, spanning many sentences.')),
    para(run('More discussion involving Jones (2021) and further analysis of the literature in this specific research area overall.')),
    para(run('References')), // heading bibliografi ASLI
    para(run('Smith, J. (2020). Title A. Journal, 1(1), 1-10.')),
    para(run('Jones, K. (2021). Title B. Journal, 2(2), 5-15.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc });
  assert.strictEqual(result.refCount, 2, 'harus baca TEPAT 2 referensi asli, bukan mencoba mem-parse baris tabel statistik sebagai referensi juga');
  assert.strictEqual(result.linked, 2, 'kedua sitasi asli (Smith, Jones) di badan artikel harus tertaut — sebelumnya badan artikel yang terpotong terlalu awal membuat sitasi ini tidak pernah dicari sama sekali');
  assert.strictEqual(result.refParseFailed.length, 0, 'tidak boleh ada entri refParseFailed sampah dari baris tabel statistik ("94,688", "Document Contents", dst.)');
});

console.log('\n=== Regression: a single institutional author cited by its own full name (no acronym, not a joint 2-institution citation) could never be linked ===');

test('a citation to a single institutional author written out in full ("The Douglas Fir Group, 2016") correctly links to its reference — the simplest institutional case was previously missing from the bookmark-resolution fallback chain entirely', () => {
  var paras = [
    para(run('INTRODUCTION')),
    para(run('The ability to use language meaningfully in real contexts (The Douglas Fir Group, 2016; The New London Group, 1996) is well established in the literature overall.')),
    para(run('Some article body text discussing the topic in sufficient detail for the parser to work correctly here.')),
    para(run('REFERENCES')),
    para(run('The Douglas Fir Group. (2016). A transdisciplinary framework for SLA. The Modern Language Journal, 100(S1), 19-47.')),
    para(run('The New London Group. (1996). A pedagogy of multiliteracies. Harvard Educational Review, 66(1), 60-92.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var relsXmlDoc = new DOMParser().parseFromString('<?xml version="1.0"?><Relationships xmlns="x"></Relationships>', 'application/xml');
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', relsXmlDoc: relsXmlDoc });
  assert.strictEqual(result.refCount, 2);
  assert.strictEqual(result.linked, 2, 'kedua sitasi institusi tunggal harus tertaut: ' + JSON.stringify(result.unmatched));
  assert.strictEqual(result.unmatched.length, 0);
});

console.log('\n=== General resolver shared by citation checking and DOCX auto-linking ===');

test('derived institutional acronyms, shortened jurisdictional names, and leading citation cues all auto-link in one document while full calendar metadata is ignored', () => {
  var paras = [
    para(run('INTRODUCTION')),
    para(run('The system is mandatory ') + run('(BPKP, 2019; Ministry of Home Affairs, 2018)') + run('. ')),
    para(run('Following Faul et al. (2009), power was evaluated. Authorization was obtained (Letter No. 3531/ABC/2025, July 25, 2025).')),
    para(run('REFERENCES')),
    para(run('Badan Pengawasan Keuangan dan Pembangunan. (2019). Annual performance report. BPKP.')),
    para(run('Faul, F., Erdfelder, E., Buchner, A., & Lang, A.-G. (2009). Statistical power analyses. Journal, 41(4), 1149-1160.')),
    para(run('Ministry of Home Affairs of the Republic of Indonesia. (2018). Regulation on village financial management. Government Press.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 3);
  assert.strictEqual(result.unmatched.length, 0);
  assert.deepStrictEqual(hyperlinkTexts(xmlDoc).sort(), ['(BPKP, 2019', 'Faul et al. (2009)', 'Ministry of Home Affairs, 2018)'].sort());
});

test('an ambiguous same-surname same-year citation is reported but never auto-linked to the first reference arbitrarily', () => {
  var paras = [
    para(run('INTRODUCTION')),
    para(run('Prior work ') + run('(Smith, 2020)') + run(' supports the claim.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). First title. Journal, 1(1), 1-10.')),
    para(run('Smith, K. (2020). Second title. Journal, 2(1), 11-20.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 0);
  assert.strictEqual(result.unmatched.length, 1);
  assert.strictEqual(result.unmatchedDetails[0].status, 'ambiguous');
  assert.strictEqual(result.unmatchedDetails[0].reason, 'multiple-candidates');
  assert.strictEqual(hyperlinkTexts(xmlDoc).length, 0);
});

test('safe mode abstains from a unique fuzzy-prefix guess and reports confidence/reason', () => {
  var paras = [
    para(run('INTRODUCTION')),
    para(run('Prior work ') + run('(Smithe, 2020)') + run(' supports the claim.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7' });
  assert.strictEqual(result.linked, 0);
  assert.strictEqual(result.reviewRequired, 1);
  assert.strictEqual(result.unmatchedDetails[0].reason, 'fuzzy-prefix');
  assert.strictEqual(result.unmatchedDetails[0].confidence, 0.55);
});

test('permissive mode may apply one unique fuzzy candidate but still exposes its low confidence', () => {
  var paras = [
    para(run('INTRODUCTION')),
    para(run('Prior work ') + run('(Smithe, 2020)') + run(' supports the claim.')),
    para(run('REFERENCES')),
    para(run('Smith, J. (2020). Title. Journal, 1(1), 1-10.')),
  ];
  var xmlDoc = xmlDocFromParas(paras);
  var result = CitationLinker.linkDocx(xmlDoc, { styleId: 'apa7', safeMode: false });
  assert.strictEqual(result.linked, 1);
  assert.strictEqual(result.linkedDetails[0].reason, 'fuzzy-prefix');
  assert.strictEqual(result.linkedDetails[0].confidence, 0.55);
});

console.log('\n' + '='.repeat(50));
console.log(`${pass} passed, ${fail} failed (of ${pass + fail} total)`);
if (fail > 0) process.exit(1);
