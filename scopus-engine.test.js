// Automated tests for scopus-engine.js — zero dependencies, pure Node `assert`.
// Run with: node scopus-engine.test.js

const assert = require('assert');
const path = require('path');
const CE = require(path.join(__dirname, 'engine.js'));

global.window = { CitationEngine: CE };
const SM = require(path.join(__dirname, 'scopus-engine.js'));

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (err) {
    fail++;
    failures.push({ name, err });
    console.log('  FAIL  ' + name);
    console.log('        ' + err.message);
  }
}

function ref(raw, styleId) {
  return CE.parseReferenceLine(raw, styleId || 'apa7');
}

console.log('=== normalizeDOI / normalizeISSN ===');

test('normalizeDOI strips the https://doi.org/ prefix and lowercases', () => {
  assert.strictEqual(SM.normalizeDOI('https://doi.org/10.1016/J.Compag.2022.107590'), '10.1016/j.compag.2022.107590');
});

test('normalizeDOI handles a bare DOI (no URL prefix) unchanged (besides lowercasing)', () => {
  assert.strictEqual(SM.normalizeDOI('10.1016/J.COMPAG.2022.107590'), '10.1016/j.compag.2022.107590');
});

test('normalizeISSN formats a bare 8-digit ISSN into NNNN-NNNN form', () => {
  assert.strictEqual(SM.normalizeISSN('12345678'), '1234-5678');
});

test('normalizeISSN preserves a trailing X check digit', () => {
  assert.strictEqual(SM.normalizeISSN('1234567X'), '1234-567X');
});

test('normalizeISSN returns null for an invalid-length input', () => {
  assert.strictEqual(SM.normalizeISSN('123'), null);
});

console.log('\n=== ScopusDatabase: DOI exact lookup ===');

test('a reference whose DOI exactly matches a loaded document returns status SCOPUS with confidence 1', () => {
  const db = new SM.ScopusDatabase();
  db.loadDocuments([{ doi: '10.1016/j.compag.2022.107590', title: 'Deep learning for crop disease detection', firstAuthor: 'Smith, J.', journal: 'Computers and Electronics in Agriculture', year: '2023', volume: '205', articleNumber: '107590' }]);
  const r = ref('Smith, J., & Doe, A. (2023). Deep learning for crop disease detection. Computers and Electronics in Agriculture, 205, 107590. https://doi.org/10.1016/j.compag.2022.107590');
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.status, SM.STATUS.SCOPUS);
  assert.strictEqual(result.confidence, 1);
  assert.strictEqual(result.method, 'DOI_EXACT');
});

console.log('\n=== ScopusDatabase: metadata matching (no DOI, or DOI not found) ===');

test('a reference with no DOI still matches via title+author+year+journal metadata scoring, above the SCOPUS threshold', () => {
  const db = new SM.ScopusDatabase();
  db.loadDocuments([{ title: 'Deep learning for crop disease detection', firstAuthor: 'Smith, J.', journal: 'Computers and Electronics in Agriculture', year: '2023', volume: '205', articleNumber: '107590' }]);
  const r = ref('Smith, J. (2023). Deep learning for crop-disease detection. Computers and Electronics in Agriculture, 205, 107590.');
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.status, SM.STATUS.SCOPUS);
  assert.strictEqual(result.method, 'METADATA_MATCH');
});

test('candidate lookup is resilient to minor tokenization differences (e.g. "crop-disease" vs "crop disease") — regression against a too-strict positional word bucket', () => {
  const db = new SM.ScopusDatabase();
  db.loadDocuments([{ title: 'Deep learning for crop disease detection', firstAuthor: 'Smith, J.', journal: 'X', year: '2023' }]);
  const candidates = db.findCandidatesByTitle('Deep learning for crop-disease detection');
  assert.ok(candidates.length >= 1);
});

test('a partial metadata match (moderate similarity, below the SCOPUS threshold) returns PROBABLE_SCOPUS rather than a hard yes/no', () => {
  const db = new SM.ScopusDatabase();
  db.loadDocuments([{ title: 'Deep learning methods for crop disease detection in agriculture', firstAuthor: 'Smith, J.', journal: 'Computers and Electronics in Agriculture', year: '2023' }]);
  const r = ref('Smith, J. (2023). Deep learning methods for crop disease detection. Computers and Electronics in Agriculture, 205, 107590.');
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.status, SM.STATUS.PROBABLE_SCOPUS);
  assert.ok(result.confidence >= SM.PROBABLE_MATCH_THRESHOLD && result.confidence < SM.SCOPUS_MATCH_THRESHOLD);
});

test('a reference with no plausible match anywhere in the database returns UNKNOWN', () => {
  const db = new SM.ScopusDatabase();
  db.loadDocuments([{ title: 'Deep learning for crop disease detection', firstAuthor: 'Smith, J.', journal: 'X', year: '2023' }]);
  const r = ref('Random, X. (2021). Something totally unrelated about medieval history. Unrelated Journal, 5(1), 1-5.');
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.status, SM.STATUS.UNKNOWN);
});

test('an empty database returns UNKNOWN for every reference, never crashes', () => {
  const db = new SM.ScopusDatabase();
  const r = ref('Smith, J. (2023). Some title. Some Journal, 1(1), 1-10.');
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.status, SM.STATUS.UNKNOWN);
});

console.log('\n=== ScopusDatabase: journal Source List (journal-level, not document-level) ===');

test('a reference whose journal ISSN is in the loaded Source List, but whose specific document is not in the document index, returns SCOPUS_SOURCE_ONLY (not UNKNOWN, not a false SCOPUS)', () => {
  const db = new SM.ScopusDatabase();
  db.loadSourceList([{ issn: '1234-5678', title: 'Some Scopus-indexed Journal' }]);
  const r = ref('Nobody, Y. (2024). A paper not in the document DB. Some Scopus-indexed Journal. ISSN: 1234-5678.');
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.status, SM.STATUS.SCOPUS_SOURCE_ONLY);
  assert.strictEqual(result.method, 'JOURNAL_IN_SOURCE_LIST');
});

test('SCOPUS_SOURCE_ONLY correctly matches via eISSN too, not just print ISSN', () => {
  const db = new SM.ScopusDatabase();
  db.loadSourceList([{ eissn: '8765-432X', title: 'An Online-Only Scopus Journal' }]);
  const r = ref('Nobody, Y. (2024). Title. An Online-Only Scopus Journal. eISSN: 8765-432X.');
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.status, SM.STATUS.SCOPUS_SOURCE_ONLY);
});

test('a reference with a journal NOT in the Source List and no document match correctly falls through to UNKNOWN (not falsely SOURCE_ONLY)', () => {
  const db = new SM.ScopusDatabase();
  db.loadSourceList([{ issn: '1234-5678', title: 'Some Scopus-indexed Journal' }]);
  const r = ref('Nobody, Y. (2024). Title. Totally Different Journal. ISSN: 9999-0000.');
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.status, SM.STATUS.UNKNOWN);
});

console.log('\n=== Comparison helpers ===');

test('compareAuthor matches surnames regardless of "Last, First" vs "First Last" formatting', () => {
  assert.strictEqual(SM.compareAuthor('Smith, J.', 'J. Smith'), 1);
});

test('compareYear gives full credit for an exact match, partial credit for a 1-year difference (e.g. print vs online-first), and zero otherwise', () => {
  assert.strictEqual(SM.compareYear('2023', '2023'), 1);
  assert.strictEqual(SM.compareYear('2023', '2024'), 0.5);
  assert.strictEqual(SM.compareYear('2023', '2020'), 0);
});

test('compareVolumePages scores volume and pages/articleNumber independently, averaging what is actually present on both sides', () => {
  assert.strictEqual(SM.compareVolumePages({ volume: '205', articleNumber: '107590' }, { volume: '205', articleNumber: '107590' }), 1);
  assert.strictEqual(SM.compareVolumePages({ volume: '205' }, { volume: '999' }), 0);
  assert.strictEqual(SM.compareVolumePages({}, {}), 0);
});

console.log('\n=== checkAllReferences (batch helper) ===');

test('checkAllReferences returns one result per input reference, in the same order, each carrying back its source ref', () => {
  const db = new SM.ScopusDatabase();
  db.loadDocuments([{ doi: '10.1234/paper-a', title: 'Paper A', firstAuthor: 'Smith, J.', journal: 'X', year: '2020' }]);
  const refs = [
    ref('Smith, J. (2020). Paper A. X, 1(1), 1-10. https://doi.org/10.1234/paper-a'),
    ref('Jones, K. (2021). Paper B. Y, 2(2), 1-10.'),
  ];
  const results = SM.checkAllReferences(refs, db);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].status, SM.STATUS.SCOPUS);
  assert.strictEqual(results[1].status, SM.STATUS.UNKNOWN);
  assert.strictEqual(results[0].ref, refs[0]);
});

console.log('\n=== parseCoverage / isYearInCoverage ===');

test('parseCoverage splits a semicolon-separated coverage string into [start,end] year-range segments', () => {
  assert.deepStrictEqual(SM.parseCoverage('2016-2026; 2001-2014'), [[2016, 2026], [2001, 2014]]);
});

test('parseCoverage handles a lone single year as a 1-year segment', () => {
  assert.deepStrictEqual(SM.parseCoverage('1959; 1952-1955'), [[1959, 1959], [1952, 1955]]);
});

test('isYearInCoverage returns true for a year inside a covered segment, false for a year in a gap between segments', () => {
  const coverage = '2026; 2019-2020; 2017; 2011-2015; 2007-2009';
  assert.strictEqual(SM.isYearInCoverage(coverage, '2019'), true);
  assert.strictEqual(SM.isYearInCoverage(coverage, '2016'), false); // celah antara 2015 dan 2017
});

test('isYearInCoverage returns null (unknown, not false) when either the year or the coverage string is missing — must not be treated as "not covered"', () => {
  assert.strictEqual(SM.isYearInCoverage('2010-2020', null), null);
  assert.strictEqual(SM.isYearInCoverage('', '2015'), null);
});

console.log('\n=== ScopusDatabase: compact Source List loader (real Scopus export format) ===');

test('loadSourceListCompact indexes a [issn, eissn, title, active, coverage, sourceType] row and makes it findable by ISSN', () => {
  const db = new SM.ScopusDatabase();
  db.loadSourceListCompact([['1234-5678', '8765-432X', 'Some Journal', 1, '2010-2026', 'Journal']]);
  const found = db.findBySourceISSN('1234-5678');
  assert.strictEqual(found.title, 'Some Journal');
  assert.strictEqual(found.active, true);
});

test('a reference with no ISSN at all still resolves to SCOPUS_SOURCE_ONLY via journal TITLE lookup — the common case, since most citation styles never include ISSN', () => {
  const db = new SM.ScopusDatabase();
  db.loadSourceListCompact([['1234-5678', null, 'African Development Review', 1, '1989-2026', 'Journal']]);
  const r = ref('Smith, J. (2020). Some paper title. African Development Review, 12(3), 100-120.');
  assert.strictEqual(r.issn, null); // sanity: parser tidak mengekstrak ISSN dari teks ini (memang tidak ada)
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.status, SM.STATUS.SCOPUS_SOURCE_ONLY);
});

test('a journal found in the Source List but whose coverage does NOT include the reference\'s year correctly falls to UNKNOWN with an informative method, not a false SOURCE_ONLY', () => {
  const db = new SM.ScopusDatabase();
  db.loadSourceListCompact([['1568-1777', null, 'African Dynamics', 1, '2019-2020; 2011-2015', 'Book Series']]);
  const r = ref('Smith, J. (2016). Some paper. African Dynamics, 12(3), 100-120.'); // 2016 falls in the gap
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.status, SM.STATUS.UNKNOWN);
  assert.strictEqual(result.method, 'JOURNAL_FOUND_YEAR_NOT_COVERED');
});

console.log('\n=== ScopusDatabase: conference proceedings (ISBN-level) ===');

test('loadProceedingsCompact indexes a [isbn, title, year, publisher] row and makes it findable by ISBN', () => {
  const db = new SM.ScopusDatabase();
  db.loadProceedingsCompact([['9781604238464', 'Some Conference Proceedings 2020', 2020, 'Some Publisher']]);
  const found = db.findByISBN('978-1-60423-846-4'); // format bervariasi (dengan/tanpa tanda hubung) tetap harus cocok
  assert.strictEqual(found.title, 'Some Conference Proceedings 2020');
});

console.log('\n=== ScopusDatabase: distinguishing "Discontinued by Scopus" from ordinary Inactive (renamed/merged) ===');

test('a journal marked "Discontinued by Scopus" (field index 6) surfaces discontinuedWarning: true on a SOURCE_ONLY match, while status stays SCOPUS_SOURCE_ONLY (historical coverage is still legitimate)', () => {
  const db = new SM.ScopusDatabase();
  db.loadSourceListCompact([
    ['1013-3119', null, 'Some Discontinued Journal', 0, '1989-2018', 'Journal', 1, 'Formerly known as', 'Old Name'],
  ]);
  const r = ref('Smith, J. (2015). Some paper. Some Discontinued Journal, 12(3), 100-120.');
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.status, SM.STATUS.SCOPUS_SOURCE_ONLY);
  assert.strictEqual(result.discontinuedWarning, true);
});

test('an ordinary Inactive journal (renamed/merged, but NOT flagged "Discontinued by Scopus") does NOT raise discontinuedWarning', () => {
  const db = new SM.ScopusDatabase();
  db.loadSourceListCompact([
    ['1234-5678', null, 'Some Renamed Journal', 0, '1989-2020', 'Journal', 0, 'Continued as', 'New Name'],
  ]);
  const r = ref('Smith, J. (2015). Some paper. Some Renamed Journal, 12(3), 100-120.');
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.status, SM.STATUS.SCOPUS_SOURCE_ONLY);
  assert.strictEqual(result.discontinuedWarning, false);
});

test('an Active journal never raises discontinuedWarning', () => {
  const db = new SM.ScopusDatabase();
  db.loadSourceListCompact([
    ['1234-5678', null, 'Some Active Journal', 1, '2000-2026', 'Journal', 0, '', ''],
  ]);
  const r = ref('Smith, J. (2023). Some paper. Some Active Journal, 12(3), 100-120.');
  const result = SM.checkReference(r, db);
  assert.strictEqual(result.discontinuedWarning, false);
});

test('the compact loader remains backward-compatible with the OLD 6-field format (no discontinued/history/related columns) — extra fields simply default to falsy/null', () => {
  const db = new SM.ScopusDatabase();
  db.loadSourceListCompact([
    ['1234-5678', null, 'Old Format Journal', 1, '2000-2026', 'Journal'], // cuma 6 field, format lama
  ]);
  const found = db.findBySourceISSN('1234-5678');
  assert.strictEqual(found.discontinued, false);
  assert.strictEqual(found.historyNote, null);
  assert.strictEqual(found.relatedTitle, null);
});

console.log('\n' + '='.repeat(50));
console.log(pass + ' passed, ' + fail + ' failed (of ' + (pass + fail) + ' total)');
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + f.err.message));
  process.exit(1);
}
