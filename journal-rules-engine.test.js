// Automated tests for journal-rules-engine.js — zero dependencies, pure Node `assert`.
// Run with: node tests/journal-rules-engine.test.js

const assert = require('assert');
const path = require('path');
const JR = require(path.join(__dirname, '..', 'journal-rules-engine.js'));

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

console.log('\n=== Origin detection ===');

test('detects Indonesian journal via keyword', () => {
  const ref = { raw: 'Sari, A. (2023). Judul artikel. Jurnal Ekonomi Universitas Indonesia, 5(1), 1-10.' };
  const d = JR.detectOrigin(ref);
  assert.strictEqual(d.origin, 'local');
  assert.strictEqual(d.confidence, 'high');
});

test('detects Indonesian domain (.ac.id)', () => {
  const ref = { raw: 'Sari, A. (2023). Title. Retrieved from https://journal.umt.ac.id/index.php/x' };
  const d = JR.detectOrigin(ref);
  assert.strictEqual(d.origin, 'local');
});

test('defaults to international with low confidence when no local signal found', () => {
  const ref = { raw: 'Smith, J. (2020). Title of a paper. Journal of Management, 17(1), 99-120.' };
  const d = JR.detectOrigin(ref);
  assert.strictEqual(d.origin, 'international');
  assert.strictEqual(d.confidence, 'low');
});

test('known international publisher outweighs a bare ISSN mention', () => {
  const ref = { raw: 'Smith, J. (2020). Title. Elsevier Journal of Finance, 17(1), 99-120. P-ISSN 1234-5678' };
  const d = JR.detectOrigin(ref);
  assert.strictEqual(d.origin, 'international');
});

console.log('\n=== classifyReferencesOrigin + overrides ===');

test('manual override takes precedence over heuristic', () => {
  const refs = [{ raw: 'Smith, J. (2020). Title. Journal of Management, 17(1), 99-120.' }];
  const classified = JR.classifyReferencesOrigin(refs, { 0: 'local' });
  assert.strictEqual(classified[0].origin, 'local');
  assert.strictEqual(classified[0].overridden, true);
});

console.log('\n=== Rule evaluation ===');

function refYear(year, sourceType) {
  return { raw: 'Author. (' + year + '). Title. Journal, 1(1), 1-10.', year: String(year), sourceType: sourceType || 'journal-article' };
}

test('disabled rules produce no checks', () => {
  const result = JR.evaluateRules([refYear(2020)], JR.defaultRules(), {});
  assert.strictEqual(result.totalRules, 0);
  assert.strictEqual(result.overallPass, false); // no rules enabled -> nothing to "pass"
});

test('minCount rule passes/fails correctly', () => {
  const rules = { minCount: { enabled: true, value: 3 } };
  const under = JR.evaluateRules([refYear(2020), refYear(2021)], rules, {});
  assert.strictEqual(under.checks[0].pass, false);
  const enough = JR.evaluateRules([refYear(2020), refYear(2021), refYear(2022)], rules, {});
  assert.strictEqual(enough.checks[0].pass, true);
});

test('yearRange rule computes percentage within N years correctly', () => {
  const currentYear = new Date().getFullYear();
  const refs = [refYear(currentYear), refYear(currentYear - 1), refYear(currentYear - 20)];
  const rules = { yearRange: { enabled: true, years: 10, minPercent: 60 } };
  const result = JR.evaluateRules(refs, rules, {});
  // 2 of 3 within last 10 years = 66.7% >= 60% -> pass
  assert.strictEqual(result.checks[0].pass, true);
  assert.strictEqual(result.checks[0].actual, 66.7);
});

test('yearRange rule ignores references with unreadable years', () => {
  const refs = [refYear(new Date().getFullYear()), { raw: 'No year here.', year: null, sourceType: 'journal-article' }];
  const rules = { yearRange: { enabled: true, years: 10, minPercent: 50 } };
  const result = JR.evaluateRules(refs, rules, {});
  assert.strictEqual(result.checks[0].pass, true); // 1/1 readable-year refs is in range
});

test('sourceType rule computes percentage of a specific type', () => {
  const refs = [refYear(2020, 'journal-article'), refYear(2020, 'book'), refYear(2020, 'journal-article')];
  const rules = { sourceType: { enabled: true, type: 'journal-article', minPercent: 60 } };
  const result = JR.evaluateRules(refs, rules, {});
  assert.strictEqual(result.checks[0].actual, 66.7);
  assert.strictEqual(result.checks[0].pass, true);
});

test('origin rule respects manual overrides in its percentage calculation', () => {
  const refs = [
    { raw: 'Smith, J. (2020). Title. Journal of Management, 17(1), 99-120.', year: '2020', sourceType: 'journal-article' },
    { raw: 'Sari, A. (2020). Judul. Jurnal Ekonomi Indonesia, 5(1), 1-10.', year: '2020', sourceType: 'journal-article' },
  ];
  const rules = { origin: { enabled: true, minInternationalPercent: 100 } };
  const withoutOverride = JR.evaluateRules(refs, rules, {});
  assert.strictEqual(withoutOverride.checks[0].actual, 50); // 1 international (Smith), 1 local (Sari)
  // Now override the Indonesian one to "international" (e.g. user knows it's an internationally
  // indexed journal despite the Indonesian name) — actual should jump to 100%.
  const withOverride = JR.evaluateRules(refs, rules, { 1: 'international' });
  assert.strictEqual(withOverride.checks[0].actual, 100);
  assert.strictEqual(withOverride.checks[0].pass, true);
});

test('overallPass requires every enabled rule to pass', () => {
  const refs = [refYear(2020, 'journal-article'), refYear(2020, 'journal-article')];
  const rules = {
    minCount: { enabled: true, value: 1 },       // passes (2 >= 1)
    sourceType: { enabled: true, type: 'book', minPercent: 50 }, // fails (0% books)
  };
  const result = JR.evaluateRules(refs, rules, {});
  assert.strictEqual(result.passCount, 1);
  assert.strictEqual(result.failCount, 1);
  assert.strictEqual(result.overallPass, false);
});

console.log('\n' + '='.repeat(50));
console.log(`${pass} passed, ${fail} failed (of ${pass + fail} total)`);
if (fail > 0) process.exit(1);
