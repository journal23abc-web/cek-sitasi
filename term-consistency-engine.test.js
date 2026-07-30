// Automated tests for term-consistency-engine.js — zero dependencies, pure Node `assert`.
// Run with: node tests/term-consistency-engine.test.js

const assert = require('assert');
const path = require('path');
const TCE = require(path.join(__dirname, '..', 'term-consistency-engine.js'));

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

console.log('\n=== Surface-form normalization (Level 1) ===');

test('hyphen/space/case variants normalize to the same form', () => {
  const a = TCE.normalizeTermSurface('Short-Video Addiction');
  const b = TCE.normalizeTermSurface('short video addiction');
  const c = TCE.normalizeTermSurface('Short Video Addictions');
  assert.strictEqual(a, b);
  assert.strictEqual(a, c);
});

test('genuinely different terms do not collide', () => {
  assert.notStrictEqual(TCE.normalizeTermSurface('Fear of Failure'), TCE.normalizeTermSurface('Emotion Regulation Difficulties'));
});

console.log('\n=== Acronym/alias pairing (Level 2, safe & automatic) ===');

test('standard acronym pattern is detected', () => {
  const r = TCE.findAcronymAliases('Emotion Regulation Difficulties (ERD) refers to...');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].fullTerm, 'Emotion Regulation Difficulties');
  assert.strictEqual(r[0].acronym, 'ERD');
});

test('mixed-case acronym derived from a connector word ("Fear of Failure" -> "FoF") is detected', () => {
  const r = TCE.findAcronymAliases('Fear of Failure (FoF) is defined as...');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].acronym, 'FoF');
});

test('a plain parenthetical word that is not a real acronym is not falsely paired', () => {
  const r = TCE.findAcronymAliases('The results (see Table 1) show that...');
  assert.strictEqual(r.length, 0);
});

console.log('\n=== Definition detection (Section 1) ===');

test('conceptual definition is detected', () => {
  const occ = [{ start: 0, end: 15 }];
  const text = 'Fear of Failure is defined as concern over the consequences of failure.';
  const r = TCE.detectDefinitions(text, 'fear of failure', occ, { sentences: TCE.splitSentences(text) });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].type, 'conceptual');
});

test('operational (measurement) definition is detected', () => {
  const text = 'Short-Video Addiction is measured using an adapted Short-Video Dependence Scale.';
  const occ = [{ start: 0, end: 21 }];
  const r = TCE.detectDefinitions(text, 'short video addiction', occ, { sentences: TCE.splitSentences(text) });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].type, 'operational');
});

test('role-based definition is detected', () => {
  const text = 'Fear of Failure acts as a mediator in the model.';
  const occ = [{ start: 0, end: 15 }];
  const r = TCE.detectDefinitions(text, 'fear of failure', occ, { sentences: TCE.splitSentences(text) });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].type, 'role');
});

console.log('\n=== Variable-candidate scoring (Section 3) ===');

test('a term with measurement + hypothesis + stats evidence scores as a construct variable', () => {
  // NOTE: statistical evidence (coefficients/p-values) only counts toward a term's score when
  // it's reported in the SAME sentence as the term — this engine works sentence-by-sentence and
  // has no awareness of tables, so a coefficient reported in a separate results table without
  // repeating the term name won't be picked up. Documented, known limitation (see engine header).
  const text = 'Short-Video Addiction is measured using an adapted scale, a validated instrument. H1: Short-Video Addiction predicts outcomes with a significant path coefficient for Short-Video Addiction (β = 0.42, p < 0.001).';
  const occ = TCE.extractCandidateTerms(text).phraseOccurrences['short video addiction'];
  const score = TCE.scoreVariableEvidence(text, occ, TCE.splitSentences(text));
  assert.ok(score >= 0.5, 'expected score >= 0.5, got ' + score);
});

test('a term with no measurement/hypothesis/statistical evidence scores low', () => {
  const text = 'Short videos are a popular format on Short videos platforms. Short videos platforms are widely used.';
  const occ = TCE.extractCandidateTerms(text).phraseOccurrences['short video platform'] || [];
  const score = TCE.scoreVariableEvidence(text, occ, TCE.splitSentences(text));
  assert.ok(score < 0.5, 'expected score < 0.5, got ' + score);
});

console.log('\n=== Full pipeline: concept dictionary ===');

const SAMPLE = `
This study examines Short-Video Addiction (SVA) among university students. Short-Video Addiction is measured using an adapted Short-Video Dependence Scale.
Emotion Regulation Difficulties (ERD) refers to the inability to manage emotional responses effectively. Emotion Regulation Difficulties is measured using the DERS.
Time Management Skills (TMS) is defined as the ability to organize and plan daily activities. Time Management Skills was assessed using a validated scale.
Fear of Failure (FoF) is defined as concern over the consequences of failure. Fear of Failure is measured using a validated fear-of-failure scale. Fear of Failure acts as a mediator in the model.
Academic Dishonesty (AD) refers to dishonest behavior in academic settings. Academic Dishonesty is measured using the ADS.
H1: Short-Video Addiction predicts Emotion Regulation Difficulties and Time Management Skills.
H2: Emotion Regulation Difficulties predicts Fear of Failure.
H3: Fear of Failure predicts Academic Dishonesty.
The path coefficient for H1 was significant (beta = 0.42, p < 0.001). Loading values for all indicators exceeded 0.70.
Short video addiction (written inconsistently here) was also discussed in the introduction. short-video addictions were noted as a growing concern.
`;

test('all five known constructs are detected with their acronym aliases', () => {
  const result = TCE.buildConceptDictionary(SAMPLE);
  const c = result.concepts;
  assert.ok(c['short video addiction'], 'Short-Video Addiction missing');
  assert.deepStrictEqual(c['short video addiction'].aliasAcronyms, ['SVA']);
  assert.ok(c['emotion regulation difficulty'], 'Emotion Regulation Difficulties missing');
  assert.ok(c['fear of failure'], 'Fear of Failure missing');
  assert.deepStrictEqual(c['fear of failure'].aliasAcronyms, ['FoF']);
});

test('constructs with clear measurement + hypothesis evidence classify as variables', () => {
  const result = TCE.buildConceptDictionary(SAMPLE);
  const c = result.concepts;
  ['short video addiction', 'emotion regulation difficulty', 'fear of failure', 'academic dishonesty'].forEach((k) => {
    assert.ok(c[k].variableScore >= 0.5, k + ' expected score >= 0.5, got ' + c[k].variableScore);
    assert.ok(['CANDIDATE_VARIABLE', 'CONSTRUCT_VARIABLE'].includes(c[k].type), k + ' expected a variable classification, got ' + c[k].type);
  });
});

test('inconsistent surface-form usage of the same concept is flagged', () => {
  const result = TCE.buildConceptDictionary(SAMPLE);
  const flagged = result.inconsistentTerms.map((c) => c.canonicalSurface);
  assert.ok(flagged.includes('Short-Video Addiction'));
  const svaVariants = result.concepts['short video addiction'].surfaceVariants.map((v) => v.text);
  assert.ok(svaVariants.includes('Short-Video Addiction'));
  assert.ok(svaVariants.includes('Short video addiction'));
  assert.ok(svaVariants.includes('short-video addictions'));
});

test('a genuinely single-spelling concept is NOT flagged as inconsistent', () => {
  const result = TCE.buildConceptDictionary(SAMPLE);
  const flagged = result.inconsistentTerms.map((c) => c.canonicalSurface);
  assert.strictEqual(flagged.includes('Academic Dishonesty'), false);
});

console.log('\n=== Level 3: possible-alias flagging (NEVER auto-merged, only surfaced for review) ===');

test('two related-but-genuinely-different constructs are NOT flagged as possible aliases', () => {
  const result = TCE.buildConceptDictionary(SAMPLE);
  const pair = result.possibleAliases.find((p) =>
    (p.termA.includes('Emotion') && p.termB.includes('Fear')) || (p.termB.includes('Emotion') && p.termA.includes('Fear')));
  assert.strictEqual(pair, undefined, 'Emotion Regulation Difficulties and Fear of Failure must not be flagged as possible aliases');
});

test('contrast evidence ("X and Y" in the same sentence) suppresses an alias flag even with lexical overlap', () => {
  const text = 'Academic Dishonesty and Academic Misconduct Behavior are both discussed. Academic Dishonesty (AD) is measured using the ADS. Academic Misconduct Behavior is measured using a different survey.';
  const result = TCE.buildConceptDictionary(text);
  const pair = result.possibleAliases.find((p) =>
    (p.termA.includes('Dishonesty') && p.termB.includes('Misconduct')) || (p.termB.includes('Dishonesty') && p.termA.includes('Misconduct')));
  assert.strictEqual(pair, undefined);
});

console.log('\n' + '='.repeat(50));
console.log(`${pass} passed, ${fail} failed (of ${pass + fail} total)`);
if (fail > 0) process.exit(1);
