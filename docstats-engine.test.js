// Automated tests for docstats-engine.js — zero dependencies, pure Node `assert`.
// Run with: node tests/docstats-engine.test.js

const assert = require('assert');
const path = require('path');
const DS = require(path.join(__dirname, '..', 'docstats-engine.js'));

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

console.log('\n=== Section heading detection ===');

test('numbered ALL CAPS IMRAD headings are detected', () => {
  const paragraphs = [
    'A Study of Something Interesting',
    'Abstract. This paper studies something.',
    'Keywords: a, b, c',
    '1. INTRODUCTION',
    'Some introduction text that is reasonably long for a paragraph.',
    '2. METHOD',
    'Some method text here as well, also reasonably long.',
    '3. RESULTS AND DISCUSSION',
    'Some results and discussion text, long enough to count as content.',
    '4. CONCLUSIONS AND SUGGESTIONS',
    'Some concluding remarks that wrap up the paper nicely.',
    'REFERENCES',
    'Smith, J. (2020). Title. Journal, 1(1), 1-10.',
  ];
  const r = DS.analyzeDocument({ paragraphs, tableCount: 0, imageCount: 0 });
  assert.deepStrictEqual(r.missingImrad, []);
  assert.ok(r.imradSections.some(s => s.key === 'introduction'));
  assert.ok(r.imradSections.some(s => s.key === 'method'));
  assert.ok(r.imradSections.some(s => s.key === 'results_discussion'));
  assert.strictEqual(r.referenceCount, 1);
});

test('table/column header text ("Result Hypothesis") is NOT mistaken for a Results heading (regression)', () => {
  const paragraphs = [
    'A Study of Something Interesting',
    'Abstract. This paper studies something in enough words to pass the abstract check here.',
    'Keywords: a, b, c',
    '1. INTRODUCTION',
    'Some introduction text that is reasonably long for a paragraph to be read here.',
    '2. METHOD',
    'Some method text here as well, also reasonably long for this paragraph to read.',
    'Variable',
    'Result Hypothesis', // table column header — must NOT be read as a "Results" section heading
    'H1 Accepted',
    '3. RESULTS AND DISCUSSION',
    'Real results and discussion content goes here, long enough to count as real content.',
    '4. CONCLUSIONS AND SUGGESTIONS',
    'Some concluding remarks that wrap up the paper nicely for the reader here.',
    'REFERENCES',
    'Smith, J. (2020). Title. Journal, 1(1), 1-10.',
  ];
  const r = DS.analyzeDocument({ paragraphs, tableCount: 1, imageCount: 0 });
  const keys = r.imradSections.map(s => s.key);
  assert.ok(!keys.includes('results'), 'a bare "results" section should not have been detected from "Result Hypothesis"');
  assert.ok(keys.includes('results_discussion'), 'the real "3. RESULTS AND DISCUSSION" heading should still be detected');
});

test('plain Title-Case heading with no number/caps signal is skipped for generic risk keys (documented limitation)', () => {
  // No numbering, no ALL CAPS -> intentionally NOT treated as a heading for high-collision keys.
  const hit = DS.detectSections(['Introduction', 'Some body text that follows the heading right here.']);
  assert.strictEqual(hit.some(h => h.key === 'introduction'), false);
});

test('ALL CAPS heading without a number is still detected', () => {
  const hit = DS.detectSections(['INTRODUCTION', 'Some body text that follows the heading right here today.']);
  assert.strictEqual(hit.some(h => h.key === 'introduction'), true);
});

console.log('\n=== Word / sentence counting ===');

test('countWords ignores extra whitespace and non-breaking spaces', () => {
  assert.strictEqual(DS.countWords('Hello\u00A0world   foo'), 3);
});

test('splitSentences does not split on abbreviations like "et al." or "e.g."', () => {
  const sentences = DS.splitSentences('This was shown by Smith et al. in their paper. It was clear.');
  assert.strictEqual(sentences.length, 2);
});

console.log('\n=== Reference recency ===');

test('computeReferenceRecency counts references within threshold correctly', () => {
  const currentYear = new Date().getFullYear();
  const lines = [
    'Smith, J. (' + currentYear + '). Recent paper. Journal, 1(1), 1-10.',
    'Jones, K. (' + (currentYear - 20) + '). Old paper. Journal, 1(1), 1-10.',
    'No year here at all.',
  ];
  const rec = DS.computeReferenceRecency(lines, 10);
  assert.strictEqual(rec.totalWithYear, 2);
  assert.strictEqual(rec.totalWithoutYear, 1);
  assert.strictEqual(rec.recentCount, 1);
});

console.log('\n' + '='.repeat(50));
console.log(`${pass} passed, ${fail} failed (of ${pass + fail} total)`);
if (fail > 0) process.exit(1);
