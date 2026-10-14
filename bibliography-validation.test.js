// Synthetic examples only. These are parser/validation oracles, not research sources.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CE = require('./engine.js');
const BE = require('./bibliography-engine.js');
const CC = require('./converter-engine.js');
const fixtures = require('./fixtures/apa-ieee-scenarios.json');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n' + e.stack); }
}
function check(raw, style, options) {
  const ref = CE.parseReferenceLine(raw, style); assert.ok(ref, 'Reference must be readable');
  return BE.validateReference(ref, style, options);
}
const journals = {
  apa7: 'Smith, J., & Jones, A. (2024). A reproducible study. Journal of Research, 12(3), 20–35. https://doi.org/10.0000/test',
  ieee: '[1] J. Smith and A. Jones, "A reproducible study," J. Res., vol. 12, no. 3, pp. 20–35, 2024, doi: 10.0000/test.',
  mla9: 'Smith, John, and Alice Jones. “A Reproducible Study.” Journal of Research, vol. 12, no. 3, 2024, pp. 20–35. https://doi.org/10.0000/test.',
  chicago: 'Smith, John, and Alice Jones. 2024. “A Reproducible Study.” Journal of Research 12 (3): 20–35. https://doi.org/10.0000/test.',
  harvard: 'Smith, J. and Jones, A. (2024) ‘A reproducible study’, Journal of Research, 12(3), pp. 20–35. Available at: https://doi.org/10.0000/test',
  vancouver: '1. Smith J, Jones A. A reproducible study. J Res. 2024;12(3):20–35. doi: 10.0000/test.'
};
const books = {
  apa7: 'Smith, J. (2024). Research methods (2nd ed.). Example Press.',
  ieee: '[1] J. Smith, Research Methods, 2nd ed. London, U.K.: Example Press, 2024.',
  mla9: 'Smith, John. Research Methods. 2nd ed., Example Press, 2024.',
  chicago: 'Smith, John. 2024. Research Methods. 2nd ed. Example Press.',
  harvard: 'Smith, J. (2024). Research methods. 2nd ed. London: Example Press.',
  vancouver: '1. Smith J. Research methods. 2nd ed. London: Example Press; 2024.'
};
for (const style of Object.keys(BE.PROFILES)) {
  test(style + ': external journal parser preserves independent fields', () => {
    const r = check(journals[style], style), m = r.model;
    assert.equal(m.type, 'journal-article'); assert.equal(m.year, '2024');
    assert.equal(m.volume, '12'); assert.equal(m.issue, '3'); assert.equal(m.pages, '20–35');
    assert.equal(m.doi, '10.0000/test'); assert.deepEqual(m.authors.map(a => a.last), ['Smith', 'Jones']);
    assert.equal(r.diagnostics.filter(d => d.severity === 'error').length, 0);
    assert.ok(!r.diagnostics.some(d => /missing-|locator-review/.test(d.ruleId)), JSON.stringify(r.diagnostics));
  });
  test(style + ': external book parser keeps title, publisher, edition and year', () => {
    const m = check(books[style], style).model;
    assert.equal(m.type, 'book'); assert.equal(m.publisher, 'Example Press');
    assert.equal(m.edition, '2nd ed.'); assert.equal(m.year, '2024'); assert.equal(m.authors[0].last, 'Smith');
  });
  test(style + ': canonical conversion returns APA without losing metadata', () => {
    const original = 'Smith, J., Jones, A., & Green, B. (2024). A reproducible study. Journal of Research, 12(3), 20–35. https://doi.org/10.0000/test';
    const first = CC.convert('Evidence (Smith et al., 2024).', original, 'apa7', style);
    const back = CC.convert(first.convertedArticle, first.referenceLines[0].line, style, 'apa7', { metadata: first.metadata });
    assert.equal(back.referenceLines[0].line, original); assert.equal(back.convertedArticle, 'Evidence (Smith et al., 2024).');
    assert.equal(back.referenceLines[0].model.authors.length, 3);
  });
}
for (const sample of fixtures.cases) test('APA source rule coverage: ' + sample.id, () => {
  const r = new CE.MultiFormatValidator(sample.article, sample.apa, 'apa7', { referenceDetails: [Object.assign({ line: sample.apa }, sample.details)] }).validate();
  assert.equal(r.references.length, 1); assert.equal(r.references[0].bibliographicType, sample.type);
  assert.equal(r.bibliographyValidation.structured + r.bibliographyValidation.basic + r.bibliographyValidation.manual, 1);
  assert.equal(r.errors.filter(e => (e.ruleId || '').startsWith('bibliography.')).length, 0, JSON.stringify(r.errors));
});
test('APA legitimately absent issue/volume and early access are not mandatory-field errors', () => {
  for (const raw of ['Smith, J. (2024). Findings. Journal of Research. Advance online publication. https://doi.org/10.0000/early', 'Smith, J. (2024). Findings. Journal of Research, Article e1234.']) {
    assert.ok(!check(raw, 'apa7').diagnostics.some(d => /missing-volume|missing-issue/.test(d.ruleId)));
  }
});
test('an organization publishing its own manual does not need a duplicate APA publisher', () => {
  const r = check('Example Association. (2024). Diagnostic and statistical manual (5th ed.).', 'apa7');
  assert.ok(!r.diagnostics.some(d => /missing-publisher/.test(d.ruleId)));
});
test('APA et al. in the reference list is detected without inventing absent names', () => {
  const r = check('Smith, J., et al. (2024). Findings. Journal of Research, 12, 20–35.', 'apa7');
  assert.ok(r.diagnostics.some(d => /authors-truncated/.test(d.ruleId) && d.severity === 'error'));
  assert.ok(r.model.authors.every(a => !/et al/.test(a.last)));
});
test('IEEE first-author et al. is accepted; six-authors plus et al. is reviewed', () => {
  const one = check('[1] J. Smith et al., "Findings," J. Res., vol. 12, pp. 20–35, 2024.', 'ieee');
  const six = check('[1] J. Smith, A. Jones, B. Green, C. White, D. Gray, E. Black, et al., "Findings," J. Res., vol. 12, pp. 20–35, 2024.', 'ieee');
  assert.ok(!one.diagnostics.some(d => /authors-truncated/.test(d.ruleId)));
  assert.ok(six.diagnostics.some(d => /authors-truncated/.test(d.ruleId)));
});
test('IEEE locators match existing references and do not become extra reference numbers', () => {
  const r = new CE.MultiFormatValidator('Evidence [1, pp. 22–23].', journals.ieee, 'ieee').validate();
  assert.equal(r.citations.length, 1); assert.deepEqual(r.citations[0].numbers, [1]);
  assert.ok(!r.errors.some(e => /tidak ada|tidak pernah/.test(e.title)));
});
test('IEEE accepts legacy range membership and recommends separate numbers', () => {
  const refs = [1, 2, 3].map(n => journals.ieee.replace('[1]', '[' + n + ']').replace('A reproducible study', 'Study ' + n)).join('\n');
  const r = new CE.MultiFormatValidator('Evidence [1]–[3].', refs, 'ieee').validate();
  assert.deepEqual(r.citations[0].numbers, [1, 2, 3]);
  assert.ok(r.suggestions.some(e => e.title === 'Kelompok sitasi IEEE' && /\[1\], \[2\], \[3\]/.test(e.description)));
});
test('Chicago 18 uses first-three et al. above six reference authors and 3+ in-text', () => {
  const raw = 'Smith, J., Jones, A., Green, B., White, C., Gray, D., Black, E., & Blue, F. (2024). Findings. Journal of Research, 12, 20–35.';
  const r = CC.convert('Evidence (Smith et al., 2024).', raw, 'apa7', 'chicago');
  assert.ok(r.referenceLines[0].line.startsWith('Smith, J., A. Jones, B. Green, et al. 2024.'));
  assert.equal(r.convertedArticle, 'Evidence (Smith et al. 2024).');
  assert.equal(CE.STYLES.chicago.etAlThreshold, 3);
});
test('MLA reference truncation keeps the first author; Vancouver uses commas between every name', () => {
  const raw = 'Smith, J., Jones, A., & Green, B. (2024). Findings. Journal of Research, 12, 20–35.';
  const mla = CC.convert('Evidence (Smith et al., 2024).', raw, 'apa7', 'mla9');
  const van = CC.convert('Evidence (Smith et al., 2024).', raw, 'apa7', 'vancouver');
  assert.ok(mla.referenceLines[0].line.startsWith('Smith, J., et al.'));
  assert.ok(van.referenceLines[0].line.startsWith('1. Smith J, Jones A, Green B.'));
});
test('NLM abbreviations are distinct from IEEE abbreviations', () => {
  const r = CC.convert('Evidence (Smith, 2024).', 'Smith, J. (2024). Findings. Journal of Research, 12, 20–35.', 'apa7', 'vancouver', { referenceDetails: [{ line: 'Smith, J. (2024). Findings. Journal of Research, 12, 20–35.', nlmAbbreviation: 'J Res' }] });
  assert.ok(r.referenceLines[0].line.includes('. J Res. 2024;'));
  assert.ok(!r.referenceLines[0].line.includes('J. Res.'));
});
test('unknown, legal, instruments, coursepacks, archives and reviews are visibly manual', () => {
  const raw = books.apa7;
  for (const type of ['unknown', 'legal', 'measurement-instrument', 'coursepack', 'archival', 'review', 'interview']) {
    const r = check(raw, 'apa7', { details: { type } });
    assert.equal(r.coverage, 'manual', type); assert.ok(r.diagnostics.some(d => /manual-type$/.test(d.ruleId)));
    assert.equal(BE.render(r.model, 'apa7', 1, 'Smith, J.'), null);
  }
});
test('APA AI chat uses its actual full date and available transcript URL', () => {
  const raw = 'Example AI. (2026, October 1). Research planning [Generative AI chat]. Example Assistant. https://ai.example/share/123';
  const r = check(raw, 'apa7'); assert.equal(r.model.type, 'ai-chat'); assert.equal(r.model.date, '2026, October 1');
  assert.ok(!r.diagnostics.some(d => /chat-date|missing-url/.test(d.ruleId)));
});
test('private communications and whole websites have explicit bibliography exceptions', () => {
  assert.ok(check(books.apa7, 'apa7', { details: { type: 'personal-communication' } }).diagnostics.some(d => /no-bibliography/.test(d.ruleId)));
  assert.ok(check(books.apa7, 'apa7', { details: { type: 'whole-website' } }).diagnostics.some(d => /no-bibliography/.test(d.ruleId)));
});
test('metadata restores a source type but never mistakes hidden authors for the displayed IEEE list', () => {
  const sample = fixtures.cases.find(c => c.id === 'book-edition');
  const converted = CC.convert(sample.article, sample.apa, 'apa7', 'ieee', { referenceDetails: [Object.assign({ line: sample.apa }, sample.details)] });
  const raw = converted.referenceLines[0].line;
  const r = check(raw, 'ieee', { metadata: converted.metadata });
  assert.equal(r.model.type, 'book'); assert.equal(r.model.place, sample.details.place);
  const stale = check(raw.replace('Research Methods', 'Edited Methods'), 'ieee', { metadata: converted.metadata });
  assert.equal(stale.model.title, 'Edited Methods');
});
test('duplicate metadata bindings and stale manual details are never selected arbitrarily', () => {
  const raw = books.apa7, model = check(raw, 'apa7').model;
  const metadata = { version: 1, styleId: 'apa7', entries: [{ line: raw, model: Object.assign({}, model, { type: 'legal' }) }, { line: raw, model }] };
  assert.equal(check(raw, 'apa7', { metadata }).model.type, 'book');
  const result = new CE.MultiFormatValidator('Evidence (Smith, 2024).', raw, 'apa7', { referenceDetails: [{ line: raw + ' changed', type: 'legal' }] }).validate();
  assert.equal(result.references[0].bibliographicType, 'book');
});
test('rich formatting uses source type for thesis, data, journal volume and webpages', () => {
  const samples = [
    ['Smith, J. (2024). A thesis [Doctoral dissertation, Example University]. Example Repository.', 'A thesis'],
    ['Smith, J. (2024). Research data [Data set]. Example Repository.', 'Research data'],
    ['Smith, J. (2024). A page. Example Site. https://site.example/page', 'A page']
  ];
  for (const [raw, title] of samples) {
    const ref = CE.parseReferenceLine(raw, 'apa7');
    const findings = CE.checkReferenceFormatting([[{ text: raw, italic: false }]], [ref], 'apa7');
    assert.ok(findings.some(d => d.field === 'italic' && d.message.includes(title)), raw);
  }
  const raw = journals.apa7;
  assert.ok(CE.checkReferenceFormatting([[{ text: raw, italic: false }]], [CE.parseReferenceLine(raw, 'apa7')], 'apa7').some(d => d.message.includes('Volume')));
});
test('formatting never compares a reference with the next unreadable paragraph by index', () => {
  assert.deepEqual(CE.checkReferenceFormatting([[{ text: 'A different unreadable line', italic: false }]], [CE.parseReferenceLine(books.apa7, 'apa7')], 'apa7'), []);
});
test('repeat validation does not accumulate bibliography diagnostics', () => {
  const v = new CE.MultiFormatValidator('Evidence (Smith, 2024).', books.apa7, 'apa7');
  const a = JSON.stringify(v.validate()), b = JSON.stringify(v.validate()); assert.equal(a, b);
});
test('worker and main thread return the same bibliography checks and exact-line facts', () => {
  let response;
  const context = vm.createContext({ self: {}, console });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, file.split('?')[0]), 'utf8'), context));
  context.self.postMessage = data => { response = JSON.parse(JSON.stringify(data)); };
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'validator-worker.js'), 'utf8'), context);
  for (const style of Object.keys(journals)) {
    const articleText = style === 'mla9' ? 'Evidence (Smith and Jones 22).' : CE.STYLES[style].family === 'numeric' ? 'Evidence [1].' : style === 'chicago' ? 'Evidence (Smith and Jones 2024).' : 'Evidence (Smith & Jones, 2024).';
    const message = { articleText, referenceText: journals[style], styleId: style, referenceDetails: [{ line: journals[style], type: 'journal-article' }] };
    context.self.onmessage({ data: message }); assert.equal(response.ok, true);
    const main = new CE.MultiFormatValidator(articleText, journals[style], style, { referenceDetails: message.referenceDetails }).validate();
    assert.deepEqual(response.result, JSON.parse(JSON.stringify(main)));
  }
});
test('MLA unpaginated citations with two initial-only authors remain reversible', () => {
  const ref = 'Smith, J., & Jones, A. (2024). Research methods. Example Press.';
  const mla = CC.convert('Evidence (Smith & Jones, 2024).', ref, 'apa7', 'mla9');
  assert.ok(mla.referenceLines[0].line.startsWith('Smith, J., and A. Jones.'));
  const back = CC.convert(mla.convertedArticle, mla.referenceLines[0].line, 'mla9', 'apa7', { metadata: mla.metadata });
  assert.equal(back.convertedArticle, 'Evidence (Smith & Jones, 2024).');
  assert.equal(back.referenceLines[0].line, ref);
});
test('personal and institutional author sequences do not force an arbitrary match', () => {
  const refs = CE.parseReferenceList('Wright, W., & Wolfe, V. (2024). Alpha. Example Press.\nWright and Wolfe. (2024). Beta. Example Press.', 'apa7');
  const r = CE.resolveAuthorDateReference('Wright and Wolfe', ['Wright and Wolfe'], '2024', refs, 'apa7', {}, { hasEtAl: false });
  assert.equal(r.status, 'ambiguous');
});
test('MLA and Vancouver edition punctuation follows independent book examples', () => {
  const raw = 'Smith, J. (2024). Research methods (2nd ed.). Example Press.';
  const opts = { referenceDetails: [{ line: raw, place: 'London' }] };
  assert.equal(CC.convert('Evidence (Smith, 2024).', raw, 'apa7', 'mla9', opts).referenceLines[0].line, 'Smith, J. Research Methods. 2nd ed., Example Press, 2024.');
  assert.equal(CC.convert('Evidence (Smith, 2024).', raw, 'apa7', 'vancouver', opts).referenceLines[0].line, '1. Smith J. Research methods. 2nd ed. London: Example Press; 2024.');
});
for (const style of ['mla9', 'chicago', 'harvard', 'vancouver']) {
  for (const sample of fixtures.cases) test(style + ': five-cycle metadata preservation for ' + sample.id, () => {
    let article = sample.article, references = sample.apa, metadata, canonical;
    for (let i = 0; i < 5; i++) {
      const forward = CC.convert(article, references, 'apa7', style, { metadata, referenceDetails: [Object.assign({ line: references }, sample.details)] });
      assert.equal(forward.unmatched.length, 0);
      const back = CC.convert(forward.convertedArticle, forward.referenceLines[0].line, style, 'apa7', { metadata: forward.metadata });
      assert.equal(back.referenceLines[0].line, sample.expectedAPA); assert.equal(back.convertedArticle, sample.article);
      assert.equal(back.restoredMetadataCount, 1); assert.equal(back.unmatched.length, 0);
      if (canonical) assert.deepEqual(back.referenceLines[0].model, canonical); else canonical = back.referenceLines[0].model;
      article = back.convertedArticle; references = back.referenceLines[0].line; metadata = back.metadata;
    }
  });
}
console.log('\n' + passed + ' passed, ' + failed + ' failed (shared bibliography validation).');
if (failed) process.exitCode = 1;
