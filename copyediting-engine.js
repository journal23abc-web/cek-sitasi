/* Editorial audit: deterministic facts, evidence, and one author letter. No DOCX mutation.
   Crossref contract: https://www.crossref.org/documentation/retrieve-metadata/rest-api/ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./i18n-translate.js'));
  else root.CopyeditingEngine = factory(root.CitationEngine, root.I18nTranslate);
})(typeof window !== 'undefined' ? window : globalThis, function (CE, I18N) {
  'use strict';
  var DEFAULTS = Object.freeze({ abstractMax: 250, referenceMin: 35, manuscriptMax: 9000 });
  var SECTIONS = ['Abstract', 'Research Method and Findings', 'Citations and References', 'Reference List and DOI Verification', 'Author Contribution Statement', 'Language and Terminology', 'Tables, Figures, and Formatting'];
  function norm(s) { return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, ' ').trim(); }
  function flat(s) { return norm(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, ''); }
  function words(s) { var t = norm(s); return t ? t.split(/\s+/).filter(function (w) { return /[\p{L}\p{N}]/u.test(w); }).length : 0; }
  function textOf(records) { return records.map(function (r) { return r.text; }).join('\n'); }
  function quote(s) { return '“' + norm(s) + '”'; }
  function limit(s, n) { s = norm(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function checkedNumber(value, fallback, min, max, name) {
    if (value === '' || value == null) return fallback;
    var n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max || !Number.isInteger(n)) throw new Error('Nilai ' + name + ' tidak valid.');
    return n;
  }
  function settings(input) {
    input = input || {};
    return {
      abstractMax: checkedNumber(input.abstractMax, DEFAULTS.abstractMax, 1, 10000, 'abstractMax'),
      referenceMin: checkedNumber(input.referenceMin, DEFAULTS.referenceMin, 0, 5000, 'referenceMin'),
      manuscriptMax: checkedNumber(input.manuscriptMax, DEFAULTS.manuscriptMax, 1, 1000000, 'manuscriptMax')
    };
  }
  var HEADINGS = [
    ['abstract', /^(?:abstract|abstrak)\b\s*[:.\-]?\s*/i],
    ['keywords', /^(?:keywords?|kata\s*kunci)\b\s*[:.\-]?\s*/i],
    ['introduction', /^(?:introduction|pendahuluan|background)$/i],
    ['methods', /^(?:research\s+)?(?:methods?|methodology|materials\s+and\s+methods|metode(?:\s+penelitian)?)$/i],
    ['results', /^(?:research\s+)?(?:results?|findings?)(?:\s*(?:and|&)\s*discussion)?$/i],
    ['discussion', /^(?:discussion|pembahasan)$/i],
    ['conclusion', /^(?:conclusions?|kesimpulan)(?:\s*(?:and|&)\s*(?:recommendations?|implications?|suggestions?))?$/i],
    ['contribution', /^(?:authors?['’]?\s+contributions?(?:\s+statement)?|contributions?\s+of\s+(?:the\s+)?authors?|credit(?:\s+authorship)?(?:\s+contribution)?\s+statement)$/i],
    ['ethics', /^(?:research\s+ethics|ethical\s+(?:approval|considerations?|statement)|ethics\s+(?:approval|statement))$/i],
    ['references', /^(?:references?|reference\s+list|bibliography|daftar\s+pustaka|refernces|refrences)$/i],
    ['other', /^(?:acknowledge?ments?|funding(?:\s+statement)?|conflicts?\s+of\s+interest|declaration\s+of\s+interests?|data\s+availability(?:\s+statement)?|appendi(?:x|ces)(?:\s+[A-Z0-9]+)?|supplementary\s+materials?)$/i]
  ];
  function heading(r) {
    if (r.kind && !['body', 'textbox', 'table'].includes(r.kind)) return null;
    var t = norm(r.text).replace(/^(?:\d+(?:\.\d+)*|[IVX]+)[.)\s]+\s*/, '').replace(/[:.]\s*$/, '');
    for (var i = 0; i < HEADINGS.length; i++) {
      if (r.kind === 'table' && !['abstract', 'keywords'].includes(HEADINGS[i][0])) continue;
      var m = t.match(HEADINGS[i][1]);
      if (m) return { key: HEADINGS[i][0], rest: t.slice(m[0].length), text: r.text };
    }
    return null;
  }
  function segment(doc, overrides) {
    overrides = overrides || {};
    var records = doc.records.map(function (r) { return Object.assign({}, r); });
    var main = records.filter(function (r) { return r.part === 'word/document.xml' || !r.part; });
    var h = main.map(heading), refStart = main.findIndex(function (r, i) { return h[i] && h[i].key === 'references'; });
    if (overrides.referenceStartId) refStart = main.findIndex(function (r) { return r.id === overrides.referenceStartId; });
    var refEnd = main.length;
    if (refStart >= 0) for (var i = refStart + 1; i < main.length; i++) if (h[i] && h[i].key !== 'references') { refEnd = i; break; }
    var absStart = main.findIndex(function (r, i) { return h[i] && h[i].key === 'abstract'; });
    if (overrides.abstractStartId) absStart = main.findIndex(function (r) { return r.id === overrides.abstractStartId; });
    var absEnd = main.length;
    if (absStart >= 0) for (var j = absStart + 1; j < main.length; j++) if (h[j] && h[j].key !== 'abstract') { absEnd = j; break; }
    if (overrides.abstractEndId) {
      absEnd = main.findIndex(function (r) { return r.id === overrides.abstractEndId; }) + 1;
      if (absEnd <= absStart) throw new Error('Batas akhir abstrak harus berada setelah awal abstrak.');
    }
    var abstractRecords = absStart < 0 ? [] : main.slice(absStart, absEnd).filter(function (r) { return ['body', 'table', 'textbox'].includes(r.kind) || !r.kind; });
    var abstractText = textOf(abstractRecords.map(function (r, i) { return Object.assign({}, r, { text: i === 0 && heading(r) && heading(r).key === 'abstract' ? heading(r).rest : r.text }); }));
    var referenceRecords = refStart < 0 ? [] : main.slice(refStart + 1, refEnd).filter(function (r) { return norm(r.text); });
    var refIds = new Set(referenceRecords.map(function (r) { return r.id; }));
    var articleRecords = records.filter(function (r) {
      return !refIds.has(r.id) && r.kind !== 'header' && r.kind !== 'footer' && !/^(?:how\s+to\s+cite|to\s+cite\s+this|received\s*:|accepted\s*:|revised\s*:|copyright\s|©)/i.test(norm(r.text));
    });
    var current = 'front';
    main.forEach(function (r, i) { if (h[i]) current = h[i].key; r.section = refIds.has(r.id) ? 'references' : current; });
    records.forEach(function (r) { if (!r.section) r.section = r.kind || 'other'; });
    return { records: records, main: main, abstractRecords: abstractRecords, abstractText: abstractText, referenceRecords: referenceRecords, articleRecords: articleRecords, referenceFound: refStart >= 0, abstractFound: absStart >= 0, abstractBounded: absEnd < main.length || !!overrides.abstractEndId };
  }
  function referenceEntries(records) {
    var entries = [];
    records.forEach(function (r) {
      var t = norm(r.text);
      if (!t) return;
      var prev = entries[entries.length - 1];
      // Merge only obvious hard-wrapped continuations; never silently discard an unparsed entry.
      if (prev && /^(?:https?:\/\/|doi\s*:|\d+\s*\(\d+\)\s*,)/i.test(t) && !/\((?:19|20)\d{2}\)/.test(t)) {
        prev.raw += ' ' + t; prev.recordIds.push(r.id);
      } else entries.push({ raw: t, recordIds: [r.id] });
    });
    return entries.map(function (entry, i) {
      var parsed = CE.parseReferenceLine(entry.raw.replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/, ''), 'apa7');
      if (parsed) parsed.raw = entry.raw;
      return Object.assign({ parsed: !!(parsed && parsed.title && parsed.year), id: 'R' + (i + 1), index: i }, parsed || { raw: entry.raw }, { recordIds: entry.recordIds });
    });
  }
  function findEvidence(records, snippet) {
    var n = norm(snippet);
    var hit = records.find(function (r) { return n && norm(r.text).includes(n); });
    return hit ? [{ paragraphId: hit.id, quote: n }] : [];
  }
  function citations(records, refs) {
    var text = textOf(records), raw = records.reduce(function (all, r) { return all.concat(CE.extractAuthorDateCitations(r.text)); }, []), parts = [], used = new Set(), candidates = new Set();
    var acronymMap = CE.buildAcronymMapFromText(text);
    raw.forEach(function (c) {
      var children = c.parts || [c];
      children.forEach(function (p) {
        var authors = Array.isArray(p.authors) ? p.authors : CE.splitOnSeparators(String(p.authors || '').replace(/\s*et\s+al\.?/gi, ''));
        var first = p.firstAuthor || authors[0];
        var decision = CE.resolveAuthorDateReference(first, authors, p.year, refs.filter(function (r) { return r.parsed; }), 'apa7', acronymMap, { hasEtAl: !!(p.hasEtAl || /et\s+al/i.test(String(c.authors))) });
        if (decision.ref) used.add(decision.ref.id);
        decision.candidates.forEach(function (r) { candidates.add(r.id); });
        parts.push({ raw: p.raw || c.raw, parentRaw: c.raw, year: p.year, authors: authors, status: decision.status, refId: decision.ref ? decision.ref.id : null, evidence: findEvidence(records, c.raw) });
      });
    });
    // The shared extractor also recognizes (2021); those can be author-date years or
    // statistical values. Only unambiguous square-bracket candidates belong in this count.
    var numeric = records.reduce(function (all, r) { return all.concat(CE.extractNumericCitations(r.text)); }, []).filter(function (c) { return /^\s*\[/.test(c.raw); });
    numeric.forEach(function (c) { c.numbers.forEach(function (number) { parts.push({ raw: c.raw, parentRaw: c.raw, number: number, status: 'numeric_style', refId: null, evidence: findEvidence(records, c.raw) }); }); });
    var duplicateGroups = [], byIdentity = new Map();
    refs.forEach(function (r) {
      var key = r.doi ? 'doi:' + r.doi.toLowerCase() : (r.parsed ? 'text:' + flat(r.authors.join(' ')) + ':' + r.year + ':' + flat(r.title) : 'raw:' + flat(r.raw));
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(r.id);
    });
    byIdentity.forEach(function (ids) { if (ids.length > 1) duplicateGroups.push(ids); });
    return {
      occurrences: parts.length, groups: raw.length + numeric.length, authorDateOccurrences: parts.filter(function (p) { return p.status !== 'numeric_style'; }).length, numericOccurrences: parts.filter(function (p) { return p.status === 'numeric_style'; }).length, parts: parts,
      unmatched: parts.filter(function (p) { return p.status === 'nomatch'; }),
      unresolved: parts.filter(function (p) { return p.status === 'ambiguous' || p.status === 'review' || p.status === 'numeric_style'; }),
      uncited: refs.filter(function (r) { return r.parsed && !used.has(r.id) && !candidates.has(r.id); }),
      unresolvedReferences: refs.filter(function (r) { return !r.parsed || (!used.has(r.id) && candidates.has(r.id)); }),
      duplicateGroups: duplicateGroups, duplicateCount: duplicateGroups.reduce(function (n, g) { return n + g.length - 1; }, 0), text: text
    };
  }
  function audit(doc, options) {
    options = options || {};
    var rules = settings(options.rules), zones = segment(doc, options.overrides), refs = referenceEntries(zones.referenceRecords);
    var sync = citations(zones.articleRecords, refs), issues = [], countRecords = zones.records.filter(function (r) { return r.kind !== 'header' && r.kind !== 'footer'; });
    var result = { doc: doc, zones: zones, rules: rules, references: refs, sync: sync, issues: issues, abstractWords: words(zones.abstractText), manuscriptWords: words(textOf(countRecords)), verification: refs.map(function (r) { return { refId: r.id, status: 'not_checked', checked: false, sourceUrl: '', fields: [], differences: [], missingFields: [], reason: 'Online verification has not been run.' }; }), semantic: { complete: false, source: null, elements: {}, reviewedIds: [] } };
    function add(id, section, comment, evidence, review) { issues.push({ id: id, section: section, comment: comment, evidence: evidence || [], source: 'local', review: !!review, selected: !review }); }
    if (!zones.abstractFound || !norm(zones.abstractText) || !zones.abstractBounded) {
      result.abstractUncertain = true;
    } else if (result.abstractWords > rules.abstractMax) add('abstract-length', 1, 'The abstract contains ' + result.abstractWords + ' words, exceeding the journal limit of ' + rules.abstractMax + '. Reduce it by at least ' + (result.abstractWords - rules.abstractMax) + ' words while retaining purpose, methods, findings, research implications, and originality. The revised abstract must remain within ' + rules.abstractMax + ' words.', zones.abstractRecords.map(function (r) { return { paragraphId: r.id, quote: r.text }; }));
    if (result.manuscriptWords > rules.manuscriptMax) add('manuscript-length', 7, 'The extracted draft contains ' + result.manuscriptWords + ' words, exceeding the configured limit of ' + rules.manuscriptMax + '. Shorten the draft by at least ' + (result.manuscriptWords - rules.manuscriptMax) + ' words. This count includes the title, abstract, narrative, table text, captions, references, and notes; repeated headers and footers are excluded. Hyphenated terms count as one token. Confirm the final count in Word under the journal’s counting policy.', []);
    var uniqueReferenceCount = refs.length - sync.duplicateCount;
    if (zones.referenceFound && uniqueReferenceCount < rules.referenceMin) add('reference-minimum', 3, 'The reference list contains ' + refs.length + ' detected entries' + (sync.duplicateCount ? ' and at most ' + uniqueReferenceCount + ' distinct entries after removing the detected duplicates' : '') + ', below the journal minimum of ' + rules.referenceMin + '. Retain or add only verified sources directly relevant to the manuscript’s claims. After removing duplicates, irrelevant sources, or unverifiable entries, the relevant reference list must still satisfy the minimum; do not add citations merely to increase the count.', []);
    if (sync.uncited.length) add('uncited', 3, sync.uncited.length + ' parsed reference entries have no detected in-text citation: ' + sync.uncited.map(function (r) { return r.id + ' ' + quote(limit(r.raw, 220)); }).join('; ') + '. Confirm these findings and either cite each source where it supports a specific claim or remove it.', [], true);
    if (sync.unmatched.length) add('unmatched', 3, sync.unmatched.length + ' detected citation occurrences have no matching parsed reference: ' + sync.unmatched.map(function (p) { return quote(p.parentRaw); }).filter(function (s, i, a) { return a.indexOf(s) === i; }).join('; ') + '. Check author names and years against the original sources, and supply the correct reference entries. If an entry was not parsed, correct its presentation before concluding that the source is absent.', [], true);
    if (sync.unresolved.length) add('ambiguous', 3, sync.unresolved.length + ' citation occurrences cannot be matched uniquely: ' + sync.unresolved.map(function (p) { return quote(p.parentRaw); }).filter(function (s, i, a) { return a.indexOf(s) === i; }).join('; ') + '. Resolve author-name, author-sequence, and year-suffix ambiguity under APA 7 rather than pairing a citation with an arbitrary entry.', [], true);
    if (sync.numericOccurrences) add('numeric-style', 3, sync.numericOccurrences + ' bracketed numeric citation occurrences were detected in a manuscript being checked against APA 7. Examples: ' + sync.parts.filter(function (p) { return p.status === 'numeric_style'; }).map(function (p) { return quote(p.raw); }).filter(function (s, i, a) { return a.indexOf(s) === i; }).join('; ') + '. Confirm that these are citations rather than non-citation numerical labels, then convert genuine numeric citations to author-date forms using the correct source identities.', [], true);
    if (sync.duplicateCount) add('duplicates', 3, 'There are ' + sync.duplicateCount + ' duplicate entries beyond the first entry in ' + sync.duplicateGroups.length + ' identical DOI or author-year-title groups: ' + sync.duplicateGroups.map(function (g) { return g.join(' / '); }).join('; ') + '. Retain one accurate entry per source and synchronize its citations.', []);
    // Run the shared format engine on the entire extracted text, including the abstract.
    // Remove exact Introduction heading lines so the legacy validator does not skip front matter.
    var formatText = sync.text.split('\n').map(function (s) { var h = heading({ text: s, kind: 'body' }); return h && h.key === 'introduction' ? '' : s; }).join('\n');
    var validator = new CE.MultiFormatValidator(formatText, refs.map(function (r) { return r.raw; }).join('\n'), 'apa7');
    var formatResult = validator.validate(), seen = new Set();
    formatResult.errors.concat(formatResult.warnings).forEach(function (it, idx) {
      if (!it.correction || !it.code || /duplikat|tidak disitasi|tidak ada di|kemungkinan|ambigu|penomoran/i.test(it.title)) return;
      var en = I18N.translateIssue(it, 'en');
      if (en.title === it.title) return; // An untranslated fallback must never enter an English letter.
      var evidence = findEvidence(zones.records, it.code);
      if (!evidence.length || seen.has(it.code + it.correction)) return;
      seen.add(it.code + it.correction);
      add('apa-' + idx, 3, en.title + '. The manuscript uses ' + quote(it.code) + '; the suggested APA 7 form is ' + quote(it.correction) + '. Confirm the source authorship and context before applying the correction consistently.', evidence, true);
    });
    var captionRecords = zones.main.filter(function (r) {
      return /^(?:table|figure|fig\.)\s+\d+/i.test(norm(r.text)) && !/^(?:table|figure|fig\.)\s+\d+\s+(?:shows?|reports?|illustrates?|presents?|indicates?|summarizes?|demonstrates?|provides?)\b/i.test(norm(r.text));
    });
    var captions = captionRecords.map(function (r) { var m = norm(r.text).match(/^(table|figure|fig\.)\s+(\d+)/i); return { type: /table/i.test(m[1]) ? 'Table' : 'Figure', number: Number(m[2]), record: r }; });
    ['Table', 'Figure'].forEach(function (type) {
      var list = captions.filter(function (c) { return c.type === type; }), numbers = list.map(function (c) { return c.number; });
      var duplicate = numbers.filter(function (n, i, a) { return a.indexOf(n) !== i; });
      if (duplicate.length) add('caption-duplicate-' + type, 7, type + ' numbering repeats ' + Array.from(new Set(duplicate)).join(', ') + '. Confirm whether these are repeated captions, panel labels, or duplicate numbers, and correct the numbering and corresponding narrative callouts.', list.map(function (c) { return { paragraphId: c.record.id, quote: c.record.text }; }), true);
      var unique = Array.from(new Set(numbers)).sort(function (a, b) { return a - b; });
      if (unique.length && unique.some(function (n, i) { return n !== i + 1; })) add('caption-sequence-' + type, 7, 'Detected ' + type.toLowerCase() + ' captions are numbered ' + unique.join(', ') + '. Confirm the sequence and supply any omitted caption or correct the numbering and narrative callouts.', [], true);
      list.forEach(function (c) {
        var callout = new RegExp('\\b' + (type === 'Table' ? 'Tables?' : '(?:Figures?|Fig\\.)') + '\\s+' + c.number + '(?!\\d)', 'i');
        var nonCaption = zones.articleRecords.filter(function (r) { return !captionRecords.includes(r); });
        if (!nonCaption.some(function (r) { return callout.test(r.text); })) add('callout-' + type + '-' + c.number, 7, type + ' ' + c.number + ' has a detected caption but no detected narrative callout. Verify the finding, then refer to and explain the visual in the relevant narrative.', [{ paragraphId: c.record.id, quote: c.record.text }], true);
      });
    });
    zones.records.forEach(function (r) {
      var t = norm(r.text), placeholders = t.match(/\[(?:INSERT|ENTER|ISI|ADD|AUTHOR NAME|TITLE|MANUSCRIPT ID)[^\]]*\]|\b(?:TODO|TBD|Lorem ipsum)\b|Author\s*\|\s*Title|10\.\d{4,9}\/(?:x{3,}|0{4,}|(?:doi|article)[-_]?here)/gi);
      if (placeholders) add('placeholder-' + r.id, 7, 'Unresolved template text appears in ' + r.kind + ': ' + placeholders.map(quote).join(', ') + '. Replace it with the correct information or remove the unused template element.', findEvidence([r], placeholders[0]));
      if (/\b(?:Received|Revised|Accepted)\s*:\s*(?=(?:[;|]\s*)?(?:Received|Revised|Accepted)\b|[;|]?\s*$)/i.test(t)) add('blank-date-' + r.id, 7, 'Publication-history date fields remain empty in ' + quote(t) + '. Resolve the template metadata with the editorial office. Use verified dates only; publisher-assigned dates should be completed by the journal.', [{ paragraphId: r.id, quote: r.text }]);
      if (r.highlighted) add('highlight-' + r.id, 7, 'Colored highlighting remains in ' + quote(limit(r.text, 160)) + '. Confirm whether it is an intentional part of a table or figure; remove editorial or revision highlighting from the final submission.', [{ paragraphId: r.id, quote: r.text }], true);
    });
    (doc.images || []).forEach(function (image, i) {
      if (image.missing) add('image-missing-' + i, 7, 'An embedded figure relationship (' + image.relationshipId + ') points to an unavailable image asset. Reinsert the correct figure and confirm that it renders in Word.', []);
      else if (image.dpi && image.dpi < 100) add('image-resolution-' + i, 7, 'The embedded raster image ' + quote(image.name || image.path) + ' has approximately ' + Math.round(image.dpi) + ' pixels per inch at its displayed width. Inspect its text and detail at publication size and replace it with a clearer or vector original if it is unreadable.', [], true);
    });
    return result;
  }
  function yearsOf(m) {
    var years = [];
    ['issued', 'published', 'published-online', 'published-print'].forEach(function (key) { var date = m[key]; if (date && date['date-parts'] && date['date-parts'][0]) years.push(String(date['date-parts'][0][0])); });
    return Array.from(new Set(years));
  }
  function compare(ref, m) {
    var fields = [], differences = [], missing = [], identity = true;
    function field(name, provided, official, core) {
      var available = norm(official) !== '' && norm(provided) !== '';
      if (!available) { missing.push(name); if (core) identity = false; return; }
      var same = flat(provided) === flat(official);
      fields.push({ field: name, provided: String(provided), official: String(official), matches: same });
      if (!same) { differences.push({ field: name, provided: String(provided), official: String(official) }); if (core) identity = false; }
    }
    var title = (m.title || [])[0] || '';
    field('title', ref.title, title, true);
    if (ref.doi) field('DOI', ref.doi.toLowerCase(), String(m.DOI || '').toLowerCase(), true);
    var officialAuthors = (m.author || []).map(function (a) { return a.family || a.name || ''; });
    var providedAuthors = (ref.authors || []).map(function (a) { return ref.isInstitutional ? a : CE.surnameOf(a, 'apa7'); });
    field('authors (ordered surnames)', providedAuthors.join('; '), officialAuthors.join('; '), true);
    // Check initials where both sources supply them; never manufacture full names.
    (ref.authors || []).forEach(function (a, i) {
      var given = m.author && m.author[i] && m.author[i].given;
      var initials = norm(a).match(/,\s*(.*)$/), published = (given || '').match(/\p{Lu}/gu);
      if (initials && flat(initials[1]) && !given) missing.push('author initials ' + (i + 1));
      if (initials && published && flat(initials[1]) && flat(initials[1]) !== flat(published.join(''))) differences.push({ field: 'author initials ' + (i + 1), provided: initials[1], official: published.join('. ') + '.' });
    });
    var y = String(ref.year || '').replace(/[a-z]$/i, ''), officialYears = yearsOf(m);
    if (!y || !officialYears.length) { missing.push('year'); identity = false; }
    else { var ok = officialYears.includes(y); fields.push({ field: 'year', provided: y, official: officialYears.join(' / '), matches: ok }); if (!ok) { differences.push({ field: 'year', provided: y, official: officialYears.join(' / ') }); identity = false; } }
    var journal = (m['container-title'] || [])[0] || m.publisher;
    field(m.type === 'journal-article' ? 'journal' : 'container / publisher', ref.journal || ref.publisher, journal, false);
    if (m.type === 'journal-article') {
      field('volume', ref.volume, m.volume, false);
      if (m.issue || ref.issue) field('issue', ref.issue, m.issue, false);
      field('pages / article number', ref.pages || ref.articleNumber, m.page || m['article-number'], false);
    }
    return { fields: fields, differences: differences, missingFields: missing, identityMatches: identity && !differences.some(function (d) { return /^author/.test(d.field); }), title: title, metadata: m };
  }
  function metadataEvidence(ref, m, lookup) {
    var cmp = compare(ref, m);
    return Object.assign({ refId: ref.id, checked: true, checkedAt: new Date().toISOString(), status: cmp.differences.length ? 'metadata_mismatch' : (cmp.missingFields.length ? 'partial_match' : 'metadata_verified'), sourceUrl: 'https://api.crossref.org/works/' + encodeURIComponent(m.DOI || ref.doi), doi: m.DOI || ref.doi || '', lookup: lookup, reason: cmp.differences.length ? 'Fetched metadata differs from the supplied reference.' : (cmp.missingFields.length ? 'Some fields were matched; other fields could not be compared.' : 'All compared bibliographic fields matched the fetched record.') }, cmp);
  }
  async function verifyReferences(result, options) {
    options = options || {};
    var fetcher = options.fetchImpl || fetch, signal = options.signal, cache = new Map(), done = 0;
    async function get(url) {
      if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (cache.has(url)) return cache.get(url);
      var task = (async function () {
        var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, options.timeoutMs || 15000);
        var cancel = function () { controller.abort(); };
        if (signal) signal.addEventListener('abort', cancel, { once: true });
        try {
          var response = await fetcher(url, { headers: { Accept: 'application/json' }, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
          if (!response.ok) throw new Error('Crossref HTTP ' + response.status);
          var json = await response.json();
          if (!json.message) throw new Error('Crossref returned no metadata.');
          return json.message;
        } finally { clearTimeout(timeout); if (signal) signal.removeEventListener('abort', cancel); }
      })();
      cache.set(url, task); return task;
    }
    var next = 0, results = new Array(result.references.length);
    async function worker() {
      while (next < result.references.length) {
        var index = next++, ref = result.references[index];
        if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        try {
          if (ref.doi) results[index] = metadataEvidence(ref, await get('https://api.crossref.org/works/' + encodeURIComponent(ref.doi)), 'doi');
          else if (ref.parsed) {
            var response = await get('https://api.crossref.org/works?query.bibliographic=' + encodeURIComponent(ref.raw) + '&rows=5');
            var exact = (response.items || []).filter(function (m) { return compare(ref, m).identityMatches; });
            if (exact.length === 1 && exact[0].DOI) results[index] = metadataEvidence(ref, exact[0], 'metadata');
            else results[index] = { refId: ref.id, checked: true, status: 'unverified', sourceUrl: '', fields: [], differences: [], missingFields: [], reason: exact.length > 1 ? 'Multiple candidate records require disambiguation.' : 'No uniquely matching metadata record was established. Absence of a DOI has not been proven.' };
          } else results[index] = { refId: ref.id, checked: false, status: 'unverified', sourceUrl: '', fields: [], differences: [], missingFields: [], reason: 'The reference could not be parsed reliably; verify it on an official source page.' };
        } catch (err) {
          if (signal && signal.aborted) throw err;
          results[index] = { refId: ref.id, checked: false, status: 'unverified', sourceUrl: '', fields: [], differences: [], missingFields: [], reason: err.name === 'AbortError' ? 'Metadata request timed out.' : err.message };
        }
        done++; if (options.onProgress) options.onProgress(done, result.references.length);
      }
    }
    await Promise.all([worker(), worker()]);
    return results;
  }
  function verificationComments(result) {
    var comments = [], unverified = [], partial = [];
    result.verification.forEach(function (v) {
      var ref = result.references.find(function (r) { return r.id === v.refId; });
      if (!ref) return;
      var label = ref.id + ' ' + quote(limit(ref.raw, 210));
      if (v.status === 'metadata_mismatch') comments.push(label + ': the fetched Crossref record differs in ' + v.differences.map(function (d) { return d.field + ' (manuscript: ' + quote(d.provided) + '; source: ' + quote(d.official) + ')'; }).join('; ') + '. Verify the source identity on the publisher’s page and correct the bibliographic details. Evidence: ' + v.sourceUrl + '.');
      else if (v.status === 'partial_match') partial.push(label + ' (fields not compared: ' + (v.missingFields || []).join(', ') + ')');
      else if (v.status === 'not_checked' || v.status === 'unverified') unverified.push(label);
      else if (v.status === 'verified_no_doi') comments.push(label + ': the editor recorded source verification at ' + v.sourceUrl + '. The recorded reason for no DOI is: ' + v.reason + '. Retain the appropriate official source URL; do not invent a DOI.' + (ref.doi ? ' The manuscript currently supplies https://doi.org/' + ref.doi + '; confirm or remove this identifier if the official source establishes that no DOI was assigned.' : ''));
      if (v.identityMatches && v.doi && !ref.doi) comments.push('A matching DOI was established for ' + label + ': https://doi.org/' + v.doi + '. Add this DOI URL after confirming any remaining bibliographic fields. Metadata evidence: ' + v.sourceUrl + '.');
      if (v.doi && ref.doi && !ref.raw.includes('https://doi.org/' + ref.doi)) comments.push('Write the supplied DOI for ' + ref.id + ' as https://doi.org/' + ref.doi + '. ' + (v.status === 'unverified' || v.status === 'not_checked' ? 'This format correction does not establish DOI validity.' : 'Confirm the associated source metadata before retaining it.'));
    });
    if (partial.length) comments.push(partial.length + ' references have only a partial metadata match: ' + partial.join('; ') + '. Verify the remaining fields on the official source pages before treating these entries as fully verified.');
    if (unverified.length) comments.push('The following ' + unverified.length + ' entries remain unverified references: ' + unverified.join('; ') + '. Their validity has not been established by this audit. Check each entry against the official journal, publisher, DOI record, or institutional source, and provide the accurate details. For a genuine source without a DOI, provide the official URL and a supported explanation where appropriate. Failure to find a Crossref record is not evidence that a source is fabricated.');
    return comments;
  }
  function createLetter(result, meta) {
    meta = meta || {};
    if (!norm(meta.manuscriptId)) throw new Error('Manuscript ID wajib diisi.');
    var id = norm(meta.manuscriptId).replace(/[\r\n]/g, ' '), sections = SECTIONS.map(function () { return []; });
    result.issues.filter(function (it) { return it.selected; }).forEach(function (it) { sections[it.section - 1].push(norm(it.comment)); });
    var sync = result.sync;
    if (result.zones.referenceFound) sections[2].unshift('Citation synchronization detected ' + sync.occurrences + ' individual citation occurrences (' + sync.authorDateOccurrences + ' author-date and ' + sync.numericOccurrences + ' bracketed numeric) in ' + sync.groups + ' citation groups, including the abstract, narrative, tables, captions, and notes where present; ' + result.references.length + ' reference-list entries; ' + sync.uncited.length + ' parsed entries without a detected citation; ' + sync.unmatched.length + ' author-date citation occurrences without a matching parsed entry; ' + sync.unresolved.length + ' ambiguous, unresolved, or non-APA occurrences; and ' + sync.duplicateCount + ' duplicate entries beyond the first entry. ' + sync.unresolvedReferences.length + ' reference entries remain unparsed or ambiguously linked. Counts describe detected patterns and should be checked against the source manuscript.');
    else sections[2].unshift('A reliable reference-list boundary was not established. Reference totals and citation-reference synchronization cannot yet be confirmed. Identify the reference section for a complete audit.');
    verificationComments(result).forEach(function (c) { sections[3].push(c); });
    var substantive = result.issues.some(function (it) { return it.selected; }) || sections[3].length > 0;
    var opening = 'The manuscript has been examined for editorial requirements' + (meta.editorConfirmed ? ' across the full extracted text' : ' using automated checks') + '. ';
    opening += substantive ? 'The points below require revision or clarification before copyediting.' : 'No confirmed correction is listed in this note; final editorial evaluation is still required before copyediting.';
    if (!meta.editorConfirmed) opening += ' This is a draft editorial note: substantive consistency, research ethics, reference relevance, academic English, and visual legibility still require editor confirmation.';
    var chunks = ['Subject: Manuscript ID [' + id + '] Editorial Revision Required Before Copyediting', 'Dear Author,', opening];
    sections.forEach(function (comments, i) { if (comments.length) chunks.push((i + 1) + ' ' + SECTIONS[i] + '\n\n' + comments.join('\n\n')); });
    chunks.push('Please submit the revised manuscript for final editorial evaluation before copyediting.\n\nThank you for your attention and cooperation.\n\nSincerely,');
    // Generated prose avoids em dashes; quoted source text is preserved rather than
    // globally replacing punctuation that could be part of a scientific range or claim.
    return chunks.join('\n\n');
  }
  function validateIssue(item, result) {
    if (!item || !Number.isInteger(item.section) || item.section < 1 || item.section > 7 || !norm(item.comment)) throw new Error('Temuan harus berisi section 1–7 dan komentar Inggris.');
    if (!Array.isArray(item.evidence) || !item.evidence.length) throw new Error('Temuan semantik memerlukan kutipan dan ID paragraf yang nyata.');
    item.evidence.forEach(function (e) { var record = result.zones.records.find(function (r) { return r.id === e.paragraphId; }); if (!record || !norm(e.quote) || !norm(record.text).includes(norm(e.quote))) throw new Error('Kutipan tidak ditemukan di ' + (e.paragraphId || 'paragraf') + '.'); });
    var relevance = item.type === 'reference_relevance' || /\b(?:irrelevant|does not support|fails to support|unrelated to|not relevant)\b/i.test(item.comment);
    if (item.source === 'ai' && relevance) {
      if (!Array.isArray(item.sourceEvidence) || !item.sourceEvidence.length) throw new Error('Penilaian relevansi memerlukan kutipan isi sumber, bukan hanya judul.');
      item.sourceEvidence.forEach(function (source) {
        var v = result.verification.find(function (v) { return v.refId === source.refId; });
        var content = v && v.checked && v.identityMatches && v.metadata && v.metadata.abstract;
        var plain = norm(String(content || '').replace(/<[^>]*>/g, ' '));
        if (source.field !== 'abstract' || !norm(source.quote) || !plain.includes(norm(source.quote))) throw new Error('Bukti isi sumber untuk relevansi belum diperoleh atau tidak cocok.');
      });
    }
    var allowed = new Set(result.references.map(function (r) { return norm(r.doi).toLowerCase(); }).concat(result.verification.filter(function (v) { return v.checked && v.doi; }).map(function (v) { return v.doi.toLowerCase(); })));
    var dois = norm(item.comment).match(/10\.\d{4,9}\/[^\s“”"<>]+/gi) || [];
    dois.forEach(function (doi) { doi = doi.replace(/[.,;)]*$/, '').toLowerCase(); if (!allowed.has(doi)) throw new Error('DOI dalam komentar tidak berasal dari naskah atau metadata yang diperiksa.'); });
    if (/\b(?:all\s+references\s+(?:are|have\s+been)\s+verified|I\s+verified\s+every)\b/i.test(item.comment)) throw new Error('Klaim verifikasi harus berasal dari pemeriksaan terstruktur.');
    return Object.assign({}, item, { comment: norm(item.comment), source: item.source || 'editor', review: true, selected: false });
  }
  function acceptSemantic(payload, result) {
    if (!payload || !Array.isArray(payload.reviewedParagraphIds) || !Array.isArray(payload.issues)) throw new Error('JSON review tidak sesuai skema.');
    var expected = result.zones.records.map(function (r) { return r.id; }), ids = new Set(payload.reviewedParagraphIds);
    if (expected.some(function (id) { return !ids.has(id); }) || ids.size !== expected.length || payload.reviewedParagraphIds.length !== expected.length) throw new Error('Review tidak mencakup seluruh ID paragraf naskah tepat satu kali. Tidak ada teks yang boleh dilewati.');
    var issues = payload.issues.map(function (it, i) { return Object.assign(validateIssue(Object.assign({}, it, { source: 'ai' }), result), { id: 'semantic-' + i }); });
    var elements = payload.abstractElements || {};
    ['purpose', 'methods', 'findings', 'researchImplications', 'originality'].forEach(function (key) {
      var e = elements[key];
      if (!e || !['present', 'missing', 'unclear'].includes(e.status)) throw new Error('Status unsur abstrak tidak lengkap: ' + key + '.');
      if (e.status === 'present') {
        var r = result.zones.abstractRecords.find(function (r) { return r.id === e.paragraphId; });
        if (!r || !norm(e.quote) || !norm(r.text).includes(norm(e.quote))) throw new Error('Bukti unsur abstrak tidak cocok: ' + key + '.');
      }
    });
    if (Object.keys(elements).some(function (key) { return elements[key].status === 'missing'; }) && !issues.some(function (it) { return it.section === 1; })) throw new Error('Review menandai unsur abstrak yang kurang tetapi tidak memberikan komentar dan tindakan perbaikan pada bagian 1.');
    return { issues: issues, semantic: { complete: true, source: 'ai', reviewedIds: expected, elements: elements } };
  }
  return { DEFAULTS: DEFAULTS, SECTIONS: SECTIONS, normalize: norm, countWords: words, settings: settings, segment: segment, audit: audit, compareMetadata: compare, verifyReferences: verifyReferences, verificationComments: verificationComments, createLetter: createLetter, validateIssue: validateIssue, acceptSemantic: acceptSemantic };
});
