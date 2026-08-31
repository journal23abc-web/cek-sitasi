// Automated tests for term-consistency-engine.js — zero dependencies, pure Node `assert`.
// Run with: node term-consistency-engine.test.js

const assert = require('assert');
const path = require('path');
const TCE = require(path.join(__dirname, 'term-consistency-engine.js'));

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

test('Indonesian/Latin words ending in s are not damaged by English plural folding', () => {
  assert.strictEqual(TCE.normalizeTermSurface('Kualitas Sistem'), 'kualitas sistem');
  assert.strictEqual(TCE.normalizeTermSurface('Status Analisis'), 'status analisis');
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

test('an unrelated uppercase token in parentheses is not accepted as an acronym', () => {
  const r = TCE.findAcronymAliases('Customer Satisfaction (XYZ) is measured using a scale.');
  assert.strictEqual(r.length, 0);
});

test('reverse acronym pattern is accepted only when initials agree', () => {
  assert.strictEqual(TCE.findAcronymAliases('SVA (Short Video Addiction) predicts outcomes.').length, 1);
  assert.strictEqual(TCE.findAcronymAliases('SVA (Customer Service Quality) predicts outcomes.').length, 0);
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
    assert.ok(['CANDIDATE_VARIABLE', 'CONSTRUCT_VARIABLE', 'OBSERVED_VARIABLE'].includes(c[k].type), k + ' expected a variable classification, got ' + c[k].type);
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

console.log('\n=== Relation graph (PREDICTS / MEDIATES / RELATED_TO) — the missing piece from the spec ===');

test('PREDICTS relations are extracted from hypothesis-style sentences', () => {
  const text = 'H1: Short-Video Addiction predicts Emotion Regulation Difficulties. Short-Video Addiction is measured using a scale. Emotion Regulation Difficulties is measured using the DERS.';
  const result = TCE.buildConceptDictionary(text);
  const rel = result.relations.find((r) => r.type === 'PREDICTS');
  assert.ok(rel, 'expected a PREDICTS relation');
  assert.strictEqual(rel.subject, 'short video addiction');
  assert.strictEqual(rel.object, 'emotion regulation difficulty');
});

test('MEDIATES relations infer the two implied PREDICTS edges', () => {
  const text = 'Emotion Regulation Difficulties mediates the relationship between Short-Video Addiction and Fear of Failure. Short-Video Addiction is measured using a scale. Emotion Regulation Difficulties is measured using a scale. Fear of Failure is measured using a scale.';
  const result = TCE.buildConceptDictionary(text);
  const mediates = result.relations.find((r) => r.type === 'MEDIATES');
  assert.ok(mediates);
  assert.strictEqual(mediates.subject, 'emotion regulation difficulty');
  assert.deepStrictEqual(mediates.between.sort(), ['fear of failure', 'short video addiction'].sort());
  const inferred = result.relations.filter((r) => r.type === 'PREDICTS' && r.inferred);
  assert.strictEqual(inferred.length, 2);
});

test('a compound "between X and Y and between Z and W" sentence is skipped rather than mispaired', () => {
  const text = 'Behavioral Intention mediated the relationship between Attitude and Psychological Distress and between Perceived Behavioral Control and Psychological Distress. Behavioral Intention is measured using a scale. Psychological Distress is measured using a scale. Perceived Behavioral Control is measured using a scale.';
  const result = TCE.buildConceptDictionary(text);
  const wrongEdge = result.relations.find((r) =>
    r.type === 'PREDICTS' && r.subject === 'behavioral intention' && r.object === 'perceived behavioral control');
  assert.strictEqual(wrongEdge, undefined, 'must not assert a reversed/mispaired relation from a compound sentence it cannot reliably parse');
});

test('a theory/model/framework name is never asserted as the subject of a PREDICTS relation', () => {
  const text = 'The Theory of Planned Behavior provides a foundation for investigating the influence of Social Norms and Perceived Behavioral Control on outcomes. Social Norms is measured using a scale. Perceived Behavioral Control is measured using a scale.';
  const result = TCE.buildConceptDictionary(text);
  const wrongEdge = result.relations.find((r) => r.subject === 'theory of planned behavior');
  assert.strictEqual(wrongEdge, undefined);
});

test('roles are correctly derived from graph position: pure predictor, mediator, pure outcome', () => {
  const text = 'H1: Short-Video Addiction predicts Emotion Regulation Difficulties. H2: Emotion Regulation Difficulties predicts Fear of Failure. Short-Video Addiction is measured using a scale. Emotion Regulation Difficulties is measured using a scale. Fear of Failure is measured using a scale.';
  const result = TCE.buildConceptDictionary(text);
  assert.deepStrictEqual(result.concepts['short video addiction'].roles, ['exogenous_variable / predictor']);
  assert.deepStrictEqual(result.concepts['fear of failure'].roles, ['outcome_variable']);
  assert.deepStrictEqual(result.concepts['emotion regulation difficulty'].roles, ['intermediate_variable']);
});

test('a causal PREDICTS edge between two concepts suppresses a possible-alias flag between them', () => {
  const text = 'Academic Dishonesty (AD) is measured using the ADS. Academic Misconduct Behavior is measured using the ADS too. H1: Academic Dishonesty predicts Academic Misconduct Behavior.';
  const result = TCE.buildConceptDictionary(text);
  const pair = result.possibleAliases.find((p) =>
    (p.termA.includes('Dishonesty') && p.termB.includes('Misconduct')) || (p.termB.includes('Dishonesty') && p.termA.includes('Misconduct')));
  assert.strictEqual(pair, undefined, 'a causal edge is the strongest negative evidence and must suppress the alias flag');
});

console.log('\n=== Indicator -> parent construct linkage ===');

test('numbered item codes (SVA1, SVA2) are linked to their parent construct via acronym match', () => {
  const text = 'Short-Video Addiction (SVA) is measured using an adapted scale, a validated instrument. Item SVA1 asks about frequency. Item SVA2 asks about duration.';
  const result = TCE.buildConceptDictionary(text);
  const parent = result.concepts['short video addiction'];
  assert.ok(parent.indicators, 'expected indicators to be linked');
  assert.deepStrictEqual(parent.indicators.sort(), ['SVA1', 'SVA2']);
  assert.strictEqual(result.concepts['sva1'].type, 'INDICATOR');
});

console.log('\n=== Definition confidence tiers (score >= 0.60 required, tagged strong/possible) ===');

test('a weak/generic definitional cue far from the term is rejected entirely (score < 0.60)', () => {
  const text = 'Many things happen in this long sentence before we finally get to Fear of Failure which honestly is the last thing mentioned here almost as an afterthought.';
  const occ = TCE.extractCandidateTerms(text).phraseOccurrences['fear of failure'];
  const r = TCE.detectDefinitions(text, 'fear of failure', occ, { sentences: TCE.splitSentences(text) });
  assert.strictEqual(r.length, 0, 'a weak, distant "is the" cue should not count as a definition at all');
});

test('a strong definitional cue right after the term is tagged strong confidence', () => {
  const text = 'Fear of Failure is defined as concern over the consequences of failure in academic settings.';
  const occ = TCE.extractCandidateTerms(text).phraseOccurrences['fear of failure'];
  const r = TCE.detectDefinitions(text, 'fear of failure', occ, { sentences: TCE.splitSentences(text) });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].confidence, 'strong');
  assert.ok(r[0].score >= 0.80);
});

console.log('\n=== Reversed operational definition pattern ("Instrument Y was used to measure X") ===');

test('the reversed instrument-first phrasing is detected as an operational definition', () => {
  const text = 'The Short-Video Dependence Scale was used to measure Short-Video Addiction among participants.';
  const occ = TCE.extractCandidateTerms(text).phraseOccurrences['short video addiction'];
  const r = TCE.detectDefinitions(text, 'short video addiction', occ, { sentences: TCE.splitSentences(text) });
  const op = r.find((d) => d.type === 'operational');
  assert.ok(op, 'expected an operational definition from the reversed phrasing');
  assert.ok(op.text.includes('Short-Video Dependence Scale'));
});

console.log('\n=== New negative-evidence checks: discriminant validity, different indicator sets ===');

test('a "discriminant validity" mention near both terms blocks alias flagging/merging', () => {
  const text = `
    Emotion Regulation Difficulties (ERD) is measured using the DERS. Emotion Regulation Difficulties predicts outcomes.
    Emotional Regulation Problems (ERP) is measured using a different survey. Emotional Regulation Problems predicts other outcomes.
    Discriminant validity confirmed that Emotion Regulation Difficulties and Emotional Regulation Problems are empirically distinct constructs.
  `;
  const result = TCE.buildConceptDictionary(text);
  const flaggedOrMerged = result.possibleAliases.some((p) =>
    (p.termA.includes('Difficulties') && p.termB.includes('Problems')) || (p.termB.includes('Difficulties') && p.termA.includes('Problems')));
  assert.strictEqual(flaggedOrMerged, false);
  assert.strictEqual(result.autoMerged.length, 0);
});

test('two concepts with entirely non-overlapping indicator sets are not flagged as possible aliases', () => {
  const text = `
    Short Video Addiction (SVA) is measured using an adapted scale. SVA1 states one thing. SVA2 states another. SVA3 states a third.
    Short Form Anxiety (SFA) is measured using a different scale. SFA1 states one thing. SFA2 states another.
  `;
  const result = TCE.buildConceptDictionary(text);
  const pair = result.possibleAliases.find((p) => p.termA.includes('SVA') || p.termB.includes('SVA') || p.termA.includes('Short'));
  assert.strictEqual(pair, undefined);
});

console.log('\n=== No heuristic auto-merge (all non-explicit aliases require a user decision) ===');

test('near-identical wording with a shared instrument still returns an empty legacy autoMerged field', () => {
  const text = `
    Short Video Addiction (SVA) is measured using the Short-Video Dependence Scale.
    Short-video Addictions is measured using the Short-Video Dependence Scale as well, confirming prior findings.
    Short Video Addiction predicts poor academic outcomes. Short-video Addictions predicts poor academic outcomes too.
  `;
  const result = TCE.buildConceptDictionary(text);
  // These two should already collide at Level 1 (surface-form normalization) in most cases —
  assert.deepStrictEqual(result.autoMerged, []);
});

test('KNOWN-DIFFERENT constructs (Emotion Regulation Difficulties vs Fear of Failure) are NEVER auto-merged, even under adversarial phrasing', () => {
  const result = TCE.buildConceptDictionary(SAMPLE);
  const wronglyMerged = result.autoMerged.some((m) =>
    (m.into.includes('Emotion') && m.from.includes('Fear')) || (m.into.includes('Fear') && m.from.includes('Emotion')));
  assert.strictEqual(wronglyMerged, false);
});

test('auto-merge never fires from lexical/edit-distance similarity alone, without a corroborating structural signal', () => {
  // Two totally unrelated-in-meaning but textually similar-shaped phrases, repeated enough to
  // become candidates, with NO shared instrument and NO shared relation-graph neighborhood.
  const text = `
    Digital Reading Habits are common among students. Digital Reading Habits vary widely.
    Digital Reading Skills are also common among students. Digital Reading Skills vary widely too.
    Students report Digital Reading Habits frequently. Teachers observe Digital Reading Skills frequently.
  `;
  const result = TCE.buildConceptDictionary(text);
  assert.strictEqual(result.autoMerged.length, 0, 'must not merge on lexical similarity alone without measurement/relation corroboration');
});

console.log('\n=== Roles derived from graph position are attached per-concept ===');

test('each concept carries its own roles array (mediator/predictor/outcome) derived from the relation graph', () => {
  const result = TCE.buildConceptDictionary(SAMPLE);
  const erd = result.concepts['emotion regulation difficulty'];
  assert.ok(Array.isArray(erd.roles));
});

console.log('\n=== New classification types: INSTRUMENT, EXAMPLE, CONSTRUCT_VARIABLE vs OBSERVED_VARIABLE ===');

test('an instrument/scale referenced as another construct\'s measuredBy is classified as INSTRUMENT', () => {
  const result = TCE.buildConceptDictionary(SAMPLE);
  const instrument = result.concepts['short video dependence scale'];
  assert.ok(instrument, 'expected the instrument to appear as its own concept');
  assert.strictEqual(instrument.type, 'INSTRUMENT');
});

test('a construct with 2+ linked indicator items is CONSTRUCT_VARIABLE, one with none is OBSERVED_VARIABLE', () => {
  const text = `
    Short Video Addiction (SVA) is measured using an adapted scale. SVA predicts poor outcomes. H1: SVA predicts Academic Dishonesty.
    SVA1 states one thing. SVA2 states another thing. SVA3 states a third thing.
    The path coefficient for SVA in H1 was significant (beta = 0.42, p < 0.001), based on the structural model.
    Academic Dishonesty (AD) is measured using the ADS. Academic Dishonesty is influenced by SVA.
  `;
  const result = TCE.buildConceptDictionary(text);
  assert.strictEqual(result.concepts['short video addiction'].type, 'CONSTRUCT_VARIABLE');
});

console.log('\n=== concept_id and related_to (per-concept relation attachment) ===');

test('every concept gets a stable, unique concept_id', () => {
  const result = TCE.buildConceptDictionary(SAMPLE);
  const ids = Object.keys(result.concepts).map((k) => result.concepts[k].concept_id);
  assert.ok(ids.every((id) => /^C\d{3}$/.test(id)));
  assert.strictEqual(new Set(ids).size, ids.length, 'concept_ids must be unique');
});

test('related_to is attached directly on each concept, reflecting its graph edges', () => {
  const result = TCE.buildConceptDictionary(SAMPLE);
  const erd = result.concepts['emotion regulation difficulty'];
  assert.ok(Array.isArray(erd.related_to));
  const predictsFearOfFailure = erd.related_to.some((r) => r.concept === 'Fear of Failure' && r.relation === 'PREDICTS');
  assert.ok(predictsFearOfFailure, 'expected ERD -> predicts -> Fear of Failure in its related_to list');
});

console.log('\n=== Curated synonym dictionary (semantic_similarity improvement) ===');

test('known synonym pairs from the spec\'s own example ("dishonesty" ~ "misconduct") score high', () => {
  const sim = TCE.synonymAwareSimilarity(new Set(['academic', 'dishonesty']), new Set(['academic', 'misconduct']));
  assert.strictEqual(sim, 1);
});

test('genuinely unrelated word sets score zero, not a false match', () => {
  const sim = TCE.synonymAwareSimilarity(new Set(['emotion', 'regulation', 'difficulty']), new Set(['fear', 'failure']));
  assert.strictEqual(sim, 0);
});

test('with realistic corroborating evidence (matching definitions + shared instrument + shared relation neighbor), a known synonym pair IS flagged for review (but never auto-merged)', () => {
  const text = `
    Academic Dishonesty (AD) refers to dishonest behavior such as cheating and plagiarism among students. Academic Dishonesty is measured using the ADS. H1: Emotion Regulation Difficulties predicts Academic Dishonesty.
    Emotion Regulation Difficulties (ERD) is measured using the DERS. Emotion Regulation Difficulties predicts negative behaviors.
    Academic Misconduct refers to dishonest behavior such as cheating and plagiarism among students too. Academic Misconduct is measured using the ADS. Emotion Regulation Difficulties predicts Academic Misconduct as well.
  `;
  const result = TCE.buildConceptDictionary(text);
  const flagged = result.possibleAliases.find((p) =>
    (p.termA.includes('Dishonesty') && p.termB.includes('Misconduct')) || (p.termB.includes('Dishonesty') && p.termA.includes('Misconduct')));
  assert.ok(flagged, 'expected Academic Dishonesty <-> Academic Misconduct to be flagged given realistic corroborating evidence');
  assert.strictEqual(result.autoMerged.length, 0, 'must still not auto-merge just from this');
});

console.log('\n=== DOCX table awareness (statistical evidence from loadings/CR/AVE tables) ===');

test('extractDocxTableRows finds a statistical table\'s data rows by their header', () => {
  const { DOMParser } = require('@xmldom/xmldom');
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const cell = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const row = (cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
  const tableXml = `<w:tbl>${row(['Construct', 'Loading', 'CR', 'AVE'])}${row(['SVA', '0.85', '0.90', '0.75'])}${row(['ERD', '0.80', '0.88', '0.70'])}</w:tbl>`;
  const xml = `<?xml version="1.0"?><w:document xmlns:w="${W_NS}"><w:body>${tableXml}</w:body></w:document>`;
  const xmlDoc = new DOMParser().parseFromString(xml, 'application/xml');
  const rows = TCE.extractDocxTableRows(xmlDoc);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map((r) => r.rowLabel).sort(), ['ERD', 'SVA']);
});

test('a non-statistical table (no Loading/CR/AVE-style header) is correctly ignored', () => {
  const { DOMParser } = require('@xmldom/xmldom');
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const cell = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const row = (cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
  const tableXml = `<w:tbl>${row(['Author', 'Year', 'Country'])}${row(['Smith', '2020', 'USA'])}</w:tbl>`;
  const xml = `<?xml version="1.0"?><w:document xmlns:w="${W_NS}"><w:body>${tableXml}</w:body></w:document>`;
  const xmlDoc = new DOMParser().parseFromString(xml, 'application/xml');
  const rows = TCE.extractDocxTableRows(xmlDoc);
  assert.strictEqual(rows.length, 0);
});

test('table-derived statistical evidence combines with (not overrides) in-text evidence found via acronym-only mentions', () => {
  const { DOMParser } = require('@xmldom/xmldom');
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const cell = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const row = (cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
  const tableXml = `<w:tbl>${row(['Construct', 'Loading', 'CR', 'AVE'])}${row(['SVA', '0.85', '0.90', '0.75'])}</w:tbl>`;
  const xml = `<?xml version="1.0"?><w:document xmlns:w="${W_NS}"><w:body>${tableXml}</w:body></w:document>`;
  const xmlDoc = new DOMParser().parseFromString(xml, 'application/xml');
  const tableRows = TCE.extractDocxTableRows(xmlDoc);

  const text = 'Short Video Addiction (SVA) is measured using an adapted scale. SVA predicts poor outcomes. H1: SVA predicts negative consequences.';
  const withoutTable = TCE.buildConceptDictionary(text);
  const withTable = TCE.buildConceptDictionary(text, { tableRows: tableRows });
  assert.ok(withTable.concepts['short video addiction'].variableScore > withoutTable.concepts['short video addiction'].variableScore,
    'table evidence should meaningfully increase the score, not just tie with the text-only score');
  assert.strictEqual(withTable.concepts['short video addiction'].hasTableStatEvidence, true);
});

test('passing tableRows is a complete no-op when empty (plain paste-text pathway unaffected)', () => {
  const result1 = TCE.buildConceptDictionary(SAMPLE);
  const result2 = TCE.buildConceptDictionary(SAMPLE, { tableRows: [] });
  Object.keys(result1.concepts).forEach((k) => {
    assert.strictEqual(result1.concepts[k].variableScore, result2.concepts[k].variableScore);
  });
});

console.log('\n=== General-case hardening: references, lowercase terms, composition, and review decisions ===');

test('case-only variation is recorded but not reported as an actionable inconsistency', () => {
  const text = 'System Use is measured using a validated scale. system use predicts outcomes. System Use is discussed again.';
  const result = TCE.buildConceptDictionary(text);
  const concept = result.concepts['system use'];
  assert.ok(concept);
  assert.strictEqual(concept.consistencyIssue, false);
  assert.ok(concept.consistency.informational.includes('CASE_ONLY'));
  assert.strictEqual(result.inconsistentTerms.length, 0);
});

test('singular/plural grammatical variation is not automatically called inconsistent', () => {
  const text = 'Digital Skills are measured using a validated scale. Digital Skill refers to an individual capability. Digital Skills predict outcomes.';
  const result = TCE.buildConceptDictionary(text);
  assert.ok(result.concepts['digital skill']);
  assert.strictEqual(result.concepts['digital skill'].consistencyIssue, false);
});

test('hyphen-versus-space variation remains an actionable consistency issue', () => {
  const text = 'Short-Video Addiction is measured using a scale. Short Video Addiction predicts outcomes. Short-Video Addiction is discussed again.';
  const result = TCE.buildConceptDictionary(text);
  assert.strictEqual(result.concepts['short video addiction'].consistencyIssue, true);
  assert.ok(result.concepts['short video addiction'].consistency.issueTypes.includes('HYPHENATION'));
});

test('reference-list text is excluded from concept detection by default', () => {
  const text = `Customer Trust is measured using a validated scale. Customer Trust predicts Purchase Intention. Purchase Intention is measured using a scale.\n\nREFERENCES\n\nCustomer Satisfaction and Digital Service Quality. Customer Satisfaction and Digital Service Quality.`;
  const result = TCE.buildConceptDictionary(text);
  assert.strictEqual(result.analysisMeta.referenceSectionFound, true);
  assert.strictEqual(result.concepts['customer satisfaction'], undefined);
  assert.ok(result.concepts['customer trust']);
});

test('explicit lowercase definitions and relations can seed concept candidates', () => {
  const text = 'perceived usefulness is defined as the degree to which a system improves work. perceived usefulness predicts adoption intention. adoption intention is measured using a validated scale.';
  const result = TCE.buildConceptDictionary(text);
  assert.ok(result.concepts['perceived usefulness']);
  assert.ok(result.concepts['adoption intention']);
  assert.ok(result.concepts['perceived usefulness'].definitions.length >= 1);
});

test('compositional definitions using comprises/consists of are recognized', () => {
  const text = 'System Use comprises Frequency of Use and Extent of Use. System Use predicts Net Benefits. Net Benefits is measured using a validated scale.';
  const result = TCE.buildConceptDictionary(text);
  assert.ok(result.concepts['system use'].definitions.some((d) => d.type === 'conceptual'));
  assert.strictEqual(result.undefinedImportantTerms.includes('System Use'), false);
});

const REVIEW_SAMPLE = `
  Academic Dishonesty refers to dishonest behavior such as cheating and plagiarism among students. Academic Dishonesty is measured using the ADS. Emotion Regulation Difficulties predicts Academic Dishonesty.
  Emotion Regulation Difficulties is measured using the DERS. Emotion Regulation Difficulties predicts negative behaviors.
  Academic Misconduct refers to dishonest behavior such as cheating and plagiarism among students too. Academic Misconduct is measured using the ADS. Emotion Regulation Difficulties predicts Academic Misconduct.
`;

test('a high-evidence alias suggestion never merges before a user decision', () => {
  const result = TCE.buildConceptDictionary(REVIEW_SAMPLE);
  assert.ok(result.possibleAliases.length >= 1);
  assert.ok(result.concepts['academic dishonesty']);
  assert.ok(result.concepts['academic misconduct']);
  assert.deepStrictEqual(result.autoMerged, []);
});

test('applyReviewDecisions merges only the explicitly approved pair and preserves the chosen label', () => {
  const result = TCE.buildConceptDictionary(REVIEW_SAMPLE);
  const pair = result.possibleAliases.find((p) => p.normA.includes('academic') && p.normB.includes('academic'));
  assert.ok(pair);
  const decisions = {};
  decisions[pair.pairKey] = { action: 'same', preferred: pair.normB };
  const reviewed = TCE.applyReviewDecisions(result, decisions);
  assert.strictEqual(Object.keys(reviewed.concepts).length, Object.keys(result.concepts).length - 1);
  assert.ok(reviewed.concepts[pair.normB]);
  assert.strictEqual(reviewed.reviewSummary.mergedByUser, 1);
});

test('a "different" review decision keeps both concepts separate', () => {
  const result = TCE.buildConceptDictionary(REVIEW_SAMPLE);
  const pair = result.possibleAliases[0];
  const decisions = {};
  decisions[pair.pairKey] = { action: 'different' };
  const reviewed = TCE.applyReviewDecisions(result, decisions);
  assert.ok(reviewed.concepts[pair.normA]);
  assert.ok(reviewed.concepts[pair.normB]);
  assert.strictEqual(reviewed.reviewSummary.mergedByUser, 0);
});

test('a user glossary explicitly unifies cross-language aliases under the preferred term', () => {
  const text = 'system usage is measured using a validated scale. penggunaan sistem memprediksi kinerja. system usage is discussed again.';
  const result = TCE.buildConceptDictionary(text, { glossary: 'System Use = system usage | penggunaan sistem' });
  const concept = result.concepts['system use'];
  assert.ok(concept);
  assert.strictEqual(concept.canonicalSurface, 'System Use');
  assert.deepStrictEqual(concept.userAliases.sort(), ['penggunaan sistem', 'system usage'].sort());
  assert.strictEqual(result.concepts['system usage'], undefined);
  assert.strictEqual(result.analysisMeta.glossaryGroupsApplied, 1);
});

test('generic labels such as Appendix B and Model A are not promoted to concepts', () => {
  const text = 'System Use is measured using a scale. System Use predicts outcomes. Appendix B reports Model A. Appendix B compares Model A and Model B. Model A reports coefficients.';
  const result = TCE.buildConceptDictionary(text);
  assert.strictEqual(result.concepts['appendix b'], undefined);
  assert.strictEqual(result.concepts['model a'], undefined);
  assert.strictEqual(result.undefinedImportantTerms.includes('Appendix B'), false);
});

test('candidate blocking scores fewer pairs than the full Cartesian pair set', () => {
  const result = TCE.buildConceptDictionary(SAMPLE);
  assert.ok(result.reviewMetrics.possiblePairs > 0);
  assert.ok(result.reviewMetrics.candidatePairs < result.reviewMetrics.possiblePairs);
});

test('text fingerprint is deterministic and changes with the content', () => {
  assert.strictEqual(TCE.fingerprintText('abc'), TCE.fingerprintText('abc'));
  assert.notStrictEqual(TCE.fingerprintText('abc'), TCE.fingerprintText('abd'));
});

console.log('\n' + '='.repeat(50));
console.log(`${pass} passed, ${fail} failed (of ${pass + fail} total)`);
if (fail > 0) process.exit(1);
