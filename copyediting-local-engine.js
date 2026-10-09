/* Editorial audit: deterministic facts, evidence, and one author letter. No DOCX mutation.
   Crossref contract: https://www.crossref.org/documentation/retrieve-metadata/rest-api/ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./i18n-translate.js'));
  else root.CopyeditingEngine = factory(root.CitationEngine, root.I18nTranslate);
})(typeof window !== 'undefined' ? window : globalThis, function (CE, I18N) {
  'use strict';
  var BUILD = '20261009-local3';
  var DEFAULTS = Object.freeze({ abstractMax: 250, referenceMin: 35, manuscriptMax: 9000 });
  var SECTIONS = ['Abstract', 'Research Method and Findings', 'Citations and References', 'Reference List and DOI Verification', 'Author Contribution Statement', 'Language and Terminology', 'Tables, Figures, and Formatting'];
  function norm(s) { return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, ' ').trim(); }
  function flat(s) { return norm(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, ''); }
  // A browser estimate, not Word's proprietary ComputeStatistics engine.
  // Preserve compounds, apostrophes, decimals and URLs; split dash-separated words,
  // remove optional hyphens and count East Asian characters without requiring spaces.
  // Scope options follow Word's text-box / footnote / endnote counting controls.
  // https://learn.microsoft.com/en-us/office/vba/api/word.document.computestatistics
  function words(s) {
    var t = String(s == null ? '' : s).normalize('NFC').replace(/\u00ad/g, '');
    // Keep compact numeric ranges as one token, consistent with this repository's
    // existing manuscript-count fixtures; never rewrite the displayed source text.
    t = t.replace(/(?<=\d)[\u2012\u2013](?=\d)/g, '-').replace(/[\u2012-\u2015\u200b]/g, ' ');
    t = t.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' $& ');
    return t.split(/\s+/u).filter(function (w) { return /[\p{L}\p{N}]/u.test(w); }).length;
  }
  function documentWords(doc, includeExtra) {
    var main = 0, extra = 0;
    doc.records.forEach(function (r) {
      if (r.kind === 'header' || r.kind === 'footer') return;
      if (['textbox', 'footnote', 'endnote'].includes(r.kind)) extra += words(r.text);
      else main += words(r.text);
    });
    return { main: main, extra: extra, includeExtra: includeExtra !== false, total: main + (includeExtra === false ? 0 : extra) };
  }
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
  function pair(id, en) { return { id: id, en: en }; }
  function audit(doc, options) {
    options = options || {};
    var rules = settings(options.rules), zones = segment(doc, options.overrides), refs = referenceEntries(zones.referenceRecords);
    var sync = citations(zones.articleRecords, refs), issues = [], wordCounts = documentWords(doc, !options.countOptions || options.countOptions.includeExtra !== false);
    var result = { doc: doc, zones: zones, rules: rules, references: refs, sync: sync, issues: issues, abstractWords: words(zones.abstractText), manuscriptWords: wordCounts.total, wordCounts: wordCounts,
      verification: refs.map(function (r) { return { refId: r.id, status: 'not_checked', checked: false, sourceUrl: '', fields: [], differences: [], missingFields: [], reason: 'Online verification has not been run.' }; }) };
    function add(id, section, title, problem, action, evidence, review, examples, correction) {
      issues.push({ id: id, section: section, texts: { id: { title: title.id, problem: problem.id, action: action.id }, en: { title: title.en, problem: problem.en, action: action.en } },
        comment: problem.en + ' ' + action.en, evidence: evidence || [], examples: examples || [], correction: correction || '', source: 'local', review: !!review, selected: true });
    }
    function refEvidence(ref) { return ref.recordIds.map(function (id) { var r = zones.records.find(function (r) { return r.id === id; }); return { paragraphId: id, quote: r.text }; }); }
    if (!zones.abstractFound || !norm(zones.abstractText) || !zones.abstractBounded) result.abstractUncertain = true;
    else if (result.abstractWords > rules.abstractMax) add('abstract-length', 1,
      pair('Abstrak melebihi batas kata', 'Abstract exceeds the word limit'),
      pair('Abstrak berisi ' + result.abstractWords + ' kata; batas jurnal ' + rules.abstractMax + ' kata.', 'The abstract contains ' + result.abstractWords + ' words; the journal limit is ' + rules.abstractMax + '.'),
      pair('Kurangi sedikitnya ' + (result.abstractWords - rules.abstractMax) + ' kata. Pertahankan tujuan, metode, temuan, implikasi penelitian, dan kebaruan. Hasil revisi harus tetap dalam batas jurnal.', 'Remove at least ' + (result.abstractWords - rules.abstractMax) + ' words. Retain purpose, methods, findings, research implications, and originality, within the journal limit.'),
      zones.abstractRecords.filter(function (r) { return norm(r.text) && !/^(?:Abstract|Abstrak)\s*[:.]?$/i.test(r.text); }).map(function (r) { return { paragraphId: r.id, quote: r.text }; }));
    if (result.manuscriptWords > rules.manuscriptMax) add('manuscript-length', 7,
      pair('Naskah melebihi batas kata', 'Manuscript exceeds the word limit'),
      pair('Perkiraan jumlah kata naskah ' + result.manuscriptWords + '; batas jurnal ' + rules.manuscriptMax + ' kata.', 'The estimated manuscript word count is ' + result.manuscriptWords + '; the journal limit is ' + rules.manuscriptMax + '.'),
      pair('Kurangi sedikitnya ' + (result.manuscriptWords - rules.manuscriptMax) + ' kata menurut cakupan hitungan yang dipilih. Konfirmasikan angka akhir melalui Word Count di Microsoft Word.', 'Remove at least ' + (result.manuscriptWords - rules.manuscriptMax) + ' words under the selected counting scope. Confirm the final count in Microsoft Word.'));
    var uniqueReferenceCount = refs.length - sync.duplicateCount;
    if (zones.referenceFound && uniqueReferenceCount < rules.referenceMin) add('reference-minimum', 3,
      pair('Jumlah referensi belum memenuhi ketentuan', 'Reference count is below the minimum'),
      pair('Terdeteksi ' + refs.length + ' entri' + (sync.duplicateCount ? ', dengan paling banyak ' + uniqueReferenceCount + ' sumber berbeda setelah duplikat dihapus' : '') + '. Minimum jurnal ' + rules.referenceMin + ' referensi.', 'The list contains ' + refs.length + (refs.length === 1 ? ' entry' : ' entries') + (sync.duplicateCount ? ', with at most ' + uniqueReferenceCount + ' distinct sources after deduplication' : '') + '. The journal requires at least ' + rules.referenceMin + ' references.'),
      pair('Lengkapi dengan sumber terverifikasi yang langsung mendukung klaim naskah. Setelah duplikat atau sumber tidak relevan dihapus, jumlah sumber relevan tetap harus memenuhi minimum. Jangan menambah sitasi hanya untuk mengejar jumlah.', 'Add verified sources that directly support the manuscript’s claims. Keep the relevant reference count above the minimum after removing duplicates or unsuitable sources. Do not add citations merely to increase the count.'));
    sync.uncited.forEach(function (ref) { add('uncited-' + ref.id, 3,
      pair('Referensi belum ditemukan dalam sitasi teks', 'Reference has no detected in-text citation'),
      pair('Belum ditemukan sitasi yang berpasangan dengan ' + ref.id + '.', 'No in-text citation was matched to ' + ref.id + '.'),
      pair('Periksa nama penulis dan tahun. Jika sumber mendukung klaim, sitasi pada kalimat yang relevan; jika tidak digunakan, hapus entri ini.', 'Check author names and year. Cite the source where it supports a claim, or remove the unused entry.'), refEvidence(ref), true, [ref.raw]); });
    var seenCitations = new Set();
    (zones.referenceFound ? sync.unmatched : []).forEach(function (c) {
      if (seenCitations.has(c.parentRaw)) return; seenCitations.add(c.parentRaw);
      add('unmatched-' + seenCitations.size, 3, pair('Sitasi tidak mempunyai pasangan referensi', 'Citation has no matching reference'),
        pair('Sitasi berikut tidak cocok dengan entri referensi yang berhasil dibaca.', 'The following citation does not match a parsed reference entry.'),
        pair('Cocokkan penulis dan tahun dengan sumber asli. Lengkapi entri yang benar. Jika entri sudah ada tetapi belum terbaca, perbaiki formatnya sebelum menyimpulkan sumber tidak dicantumkan.', 'Check author names and year against the original source and supply the correct entry. If an existing entry could not be parsed, correct its presentation first.'), c.evidence, true, [c.parentRaw]);
    });
    seenCitations = new Set();
    sync.unresolved.filter(function (c) { return c.status !== 'numeric_style'; }).forEach(function (c) {
      if (seenCitations.has(c.parentRaw)) return; seenCitations.add(c.parentRaw);
      add('ambiguous-' + seenCitations.size, 3, pair('Pasangan sitasi masih ambigu', 'Citation match is ambiguous'),
        pair('Sitasi ini belum dapat dipasangkan secara unik dengan satu sumber.', 'This citation cannot be linked uniquely to one source.'),
        pair('Periksa urutan dan identitas penulis serta tahun. Bedakan karya yang berbeda sesuai APA 7; entri duplikat harus dihapus, bukan diberi akhiran a/b.', 'Check authorship, author order, and year. Distinguish different works under APA 7; remove duplicate entries rather than assigning year suffixes to the same work.'), c.evidence, true, [c.parentRaw]);
    });
    if (sync.numericOccurrences) add('numeric-style', 3, pair('Sitasi angka perlu ditinjau', 'Numeric citations need review'),
      pair('Terdeteksi ' + sync.numericOccurrences + ' angka di dalam kurung siku pada pemeriksaan APA 7.', sync.numericOccurrences + ' bracketed numeric citation candidates were detected during APA 7 checks.'),
      pair('Pastikan angka ini merupakan sitasi. Ubah sitasi angka yang benar-benar merujuk sumber menjadi bentuk penulis-tahun berdasarkan identitas sumber yang tepat.', 'Confirm these are citations. Convert genuine numeric citations to author-date forms using the correct source identities.'),
      sync.parts.filter(function (c) { return c.status === 'numeric_style'; }).flatMap(function (c) { return c.evidence; }), true,
      Array.from(new Set(sync.parts.filter(function (c) { return c.status === 'numeric_style'; }).map(function (c) { return c.raw; }))));
    sync.duplicateGroups.forEach(function (group, i) {
      var ref = refs.find(function (r) { return r.id === group[0]; });
      add('duplicates-' + i, 3, pair('Entri referensi duplikat', 'Duplicate reference entries'),
        pair('Entri ' + group.join(', ') + ' memiliki DOI atau identitas penulis-tahun-judul yang sama.', 'Entries ' + group.join(', ') + ' share the same DOI or author-year-title identity.'),
        pair('Pertahankan satu entri yang akurat untuk setiap sumber. Selaraskan semua sitasi dengan entri yang dipertahankan.', 'Keep one accurate entry per source and synchronize all citations to it.'),
        group.flatMap(function (id) { return refEvidence(refs.find(function (r) { return r.id === id; })); }), false, [ref.raw]);
    });
    var formatText = sync.text.split('\n').map(function (s) { var h = heading({ text: s, kind: 'body' }); return h && h.key === 'introduction' ? '' : s; }).join('\n');
    var validator = new CE.MultiFormatValidator(formatText, refs.map(function (r) { return r.raw; }).join('\n'), 'apa7');
    var formatResult = validator.validate(), seen = new Set();
    formatResult.errors.concat(formatResult.warnings).forEach(function (it, idx) {
      if (!it.correction || !it.code || /duplikat|tidak disitasi|tidak ada di|kemungkinan|ambigu|penomoran/i.test(it.title)) return;
      var en = I18N.translateIssue(it, 'en');
      if (en.title === it.title) return;
      var evidence = findEvidence(zones.records, it.code);
      if (!evidence.length || seen.has(it.code + it.correction)) return;
      seen.add(it.code + it.correction);
      add('apa-' + idx, 3, pair(it.title.replace(/^Multiple citations/i, 'Sitasi gabungan'), en.title), pair('Bentuk sitasi berikut perlu disesuaikan dengan APA 7.', 'The following citation form may need adjustment under APA 7.'),
        pair('Konfirmasikan identitas penulis dan konteks sitasi. Terapkan bentuk yang benar secara konsisten.', 'Confirm the source authorship and citation context. Apply the correct form consistently.'), evidence, true, [it.code], it.correction);
    });
    var captionRecords = zones.main.filter(function (r) {
      return /^(?:table|tabel|figure|gambar|fig\.)\s+\d+/i.test(norm(r.text)) && !/^(?:table|tabel|figure|gambar|fig\.)\s+\d+\s+(?:shows?|reports?|illustrates?|presents?|indicates?|summarizes?|demonstrates?|provides?|menunjukkan|menyajikan|memperlihatkan)\b/i.test(norm(r.text));
    });
    var captions = captionRecords.map(function (r) { var m = norm(r.text).match(/^(table|tabel|figure|gambar|fig\.)\s+(\d+)/i); return { type: /table|tabel/i.test(m[1]) ? 'Table' : 'Figure', number: Number(m[2]), record: r }; });
    ['Table', 'Figure'].forEach(function (type) {
      var label = type === 'Table' ? 'Tabel' : 'Gambar', list = captions.filter(function (c) { return c.type === type; }), numbers = list.map(function (c) { return c.number; });
      var duplicate = numbers.filter(function (n, i, a) { return a.indexOf(n) !== i; });
      if (duplicate.length) add('caption-duplicate-' + type, 7, pair('Nomor ' + label.toLowerCase() + ' berulang', 'Repeated ' + type.toLowerCase() + ' numbers'),
        pair(label + ' bernomor ' + Array.from(new Set(duplicate)).join(', ') + ' muncul lebih dari sekali.', type + ' numbers ' + Array.from(new Set(duplicate)).join(', ') + ' occur more than once.'),
        pair('Pastikan ini bukan label panel atau caption berulang. Perbaiki nomor dan penyebutannya dalam narasi jika memang duplikat.', 'Check whether these are panel labels or repeated captions. Correct duplicate numbers and corresponding narrative callouts.'), list.map(function (c) { return { paragraphId: c.record.id, quote: c.record.text }; }), true);
      var unique = Array.from(new Set(numbers)).sort(function (a, b) { return a - b; });
      if (unique.length && unique.some(function (n, i) { return n !== i + 1; })) add('caption-sequence-' + type, 7,
        pair('Urutan nomor ' + label.toLowerCase() + ' perlu diperiksa', 'Check the ' + type.toLowerCase() + ' sequence'),
        pair('Nomor yang terbaca: ' + unique.join(', ') + '.', 'Detected numbers: ' + unique.join(', ') + '.'),
        pair('Periksa kemungkinan caption yang tidak terbaca. Lengkapi caption yang hilang atau selaraskan penomorannya dengan narasi.', 'Check for captions that were not detected. Supply any missing caption or align numbering with the narrative.'), list.map(function (c) { return { paragraphId: c.record.id, quote: c.record.text }; }), true);
      list.forEach(function (c) {
        var callout = new RegExp('\\b' + (type === 'Table' ? '(?:Tables?|Tabel)' : '(?:Figures?|Fig\\.|Gambar)') + '\\s+' + c.number + '(?!\\d)', 'i');
        if (!zones.articleRecords.filter(function (r) { return !captionRecords.includes(r); }).some(function (r) { return callout.test(r.text); })) add('callout-' + type + '-' + c.number, 7,
          pair(label + ' belum ditemukan dalam narasi', type + ' has no detected narrative callout'),
          pair('Caption ' + label.toLowerCase() + ' ' + c.number + ' terdeteksi, tetapi penyebutannya belum ditemukan pada narasi.', 'The caption for ' + type.toLowerCase() + ' ' + c.number + ' was detected, but no narrative callout was found.'),
          pair('Periksa hasil deteksi. Sebutkan dan jelaskan visual ini pada bagian narasi yang relevan.', 'Check the detection result. Refer to and explain this visual in the relevant narrative.'), [{ paragraphId: c.record.id, quote: c.record.text }], true);
      });
    });
    zones.records.forEach(function (r) {
      var t = norm(r.text), placeholders = t.match(/\[(?:INSERT|ENTER|ISI|ADD|AUTHOR NAME|TITLE|MANUSCRIPT ID)[^\]]*\]|\b(?:TODO|TBD|Lorem ipsum)\b|Author\s*\|\s*Title|10\.\d{4,9}\/(?:x{3,}|0{4,}|(?:doi|article)[-_]?here)/gi);
      if (placeholders) add('placeholder-' + r.id, 7, pair('Teks templat belum diselesaikan', 'Unresolved template text'),
        pair('Elemen templat berikut masih ada dalam naskah.', 'The following template elements remain in the manuscript.'),
        pair('Ganti dengan informasi yang benar atau hapus elemen templat yang tidak digunakan.', 'Replace them with accurate information or remove unused template elements.'), findEvidence([r], placeholders[0]), false, placeholders);
      if (/\b(?:Received|Revised|Accepted)\s*:\s*(?=(?:[;|]\s*)?(?:Received|Revised|Accepted)\b|[;|]?\s*$)/i.test(t)) add('blank-date-' + r.id, 7,
        pair('Tanggal riwayat publikasi masih kosong', 'Empty publication-history dates'),
        pair('Kolom tanggal pada templat ini belum diisi.', 'These publication-history fields are empty.'),
        pair('Koordinasikan pengisian dengan pengelola jurnal. Gunakan hanya tanggal yang dapat dikonfirmasi.', 'Resolve these fields with the editorial office using confirmed dates only.'), [{ paragraphId: r.id, quote: r.text }]);
      if (r.highlighted) add('highlight-' + r.id, 7, pair('Sorotan warna masih ada', 'Colored highlighting remains'),
        pair('Paragraf ini masih memiliki sorotan warna dalam file Word.', 'This paragraph still contains colored highlighting in Word.'),
        pair('Jika sorotan hanya menandai revisi editorial, hapus sebelum penyerahan final. Pertahankan hanya jika bagian visual yang disengaja.', 'Remove revision highlighting before final submission. Retain it only if it is an intentional visual element.'), [{ paragraphId: r.id, quote: r.text }], true);
    });
    (doc.images || []).forEach(function (image, i) {
      if (image.missing) add('image-missing-' + i, 7, pair('Berkas gambar tidak ditemukan', 'An embedded image asset is missing'),
        pair('Hubungan gambar ' + image.relationshipId + ' mengarah ke berkas yang tidak tersedia.', 'Image relationship ' + image.relationshipId + ' points to an unavailable asset.'),
        pair('Sisipkan kembali gambar yang benar dan pastikan tampil ketika dibuka di Word.', 'Reinsert the correct image and confirm it renders in Word.'));
      else if (image.dpi && image.dpi < 100) add('image-resolution-' + i, 7, pair('Keterbacaan gambar perlu diperiksa', 'Check image legibility'),
        pair('Gambar ' + quote(image.name || image.path) + ' memiliki perkiraan ' + Math.round(image.dpi) + ' piksel per inci pada lebar tampilnya.', 'Image ' + quote(image.name || image.path) + ' has approximately ' + Math.round(image.dpi) + ' pixels per inch at its displayed width.'),
        pair('Periksa teks dan detail pada ukuran publikasi. Ganti dengan sumber gambar yang lebih jelas jika sulit dibaca.', 'Inspect text and details at publication size. Replace the image with a clearer original if it is unreadable.'), [], true);
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
  var SECTIONS_ID = ['Abstrak', 'Metode dan Temuan Penelitian', 'Sitasi dan Referensi', 'Daftar Pustaka dan Verifikasi DOI', 'Kontribusi Penulis', 'Bahasa dan Istilah', 'Tabel, Gambar, dan Format'];
  var LABELS = {
    id: { title: 'Laporan Pemeriksaan Naskah', summary: 'Ringkasan', source: 'Sumber dokumen', manuscript: 'ID naskah', date: 'Dibuat', greeting: 'Yth. Penulis,',
      problem: 'Masalah', found: 'Ditemukan', correction: 'Saran bentuk yang benar', action: 'Tindakan perbaikan', location: 'Lokasi', evidence: 'Kutipan naskah', sourceEvidence: 'Bukti sumber', review: 'Perlu ditinjau', confirmed: 'Perlu diperbaiki',
      refs: 'Status Pemeriksaan Referensi', ref: 'Referensi', status: 'Status', noIssues: 'Tidak ada temuan yang disertakan. Hasil ini tidak membuktikan bahwa seluruh aspek ilmiah dan bahasa sudah memenuhi ketentuan.',
      draft: 'Hasil pemeriksaan otomatis', final: 'Telah ditinjau editor', documentLevel: 'Seluruh dokumen', translation: 'Komentar ini belum tersedia dalam bahasa pilihan. Versi asli ditampilkan.',
      closing: 'Silakan kirimkan naskah revisi untuk evaluasi editorial akhir sebelum copyediting.\n\nTerima kasih atas perhatian dan kerja sama Anda.\n\nHormat kami,',
      emptyReferences: 'Daftar referensi belum terdeteksi. Jumlah referensi dan kecocokan sitasi belum dapat dikonfirmasi.' },
    en: { title: 'Manuscript Editorial Report', summary: 'Summary', source: 'Source document', manuscript: 'Manuscript ID', date: 'Created', greeting: 'Dear Author,',
      problem: 'Problem', found: 'Found', correction: 'Suggested form', action: 'Required action', location: 'Location', evidence: 'Manuscript evidence', sourceEvidence: 'Source evidence', review: 'Needs review', confirmed: 'Requires correction',
      refs: 'Reference Verification Status', ref: 'Reference', status: 'Status', noIssues: 'No finding is included. This does not establish that all scientific and language requirements have been met.',
      draft: 'Automated check results', final: 'Reviewed by the editor', documentLevel: 'Whole document', translation: 'This comment is unavailable in the selected language. Its original version is shown.',
      closing: 'Please submit the revised manuscript for final editorial evaluation before copyediting.\n\nThank you for your attention and cooperation.\n\nSincerely,',
      emptyReferences: 'The reference list was not reliably detected. Reference totals and citation matching cannot yet be confirmed.' }
  };
  var STATUS = {
    not_checked: pair('Belum diperiksa online', 'Not checked online'), unverified: pair('Belum terverifikasi (unverified reference)', 'Unverified reference'),
    metadata_mismatch: pair('Metadata berbeda', 'Metadata mismatch'), partial_match: pair('Metadata cocok sebagian', 'Partial metadata match'),
    metadata_verified: pair('Metadata cocok pada semua bidang yang diperiksa', 'All compared metadata fields match'), editor_verified: pair('Dikonfirmasi editor', 'Confirmed by the editor'), verified_no_doi: pair('Tanpa DOI, dikonfirmasi editor', 'No DOI, confirmed by the editor')
  };
  function language(meta) { return meta && meta.language === 'en' ? 'en' : 'id'; }
  function sectionNames(lang) { return lang === 'en' ? SECTIONS : SECTIONS_ID; }
  function fieldName(field, lang) {
    if (lang === 'en') return field;
    var names = { title: 'judul', DOI: 'DOI', 'authors (ordered surnames)': 'penulis dan urutannya', year: 'tahun', journal: 'jurnal', 'container / publisher': 'buku induk / penerbit', volume: 'volume', issue: 'nomor', 'pages / article number': 'halaman / nomor artikel' };
    return names[field] || String(field).replace('author initials ', 'inisial penulis ');
  }
  function reasonText(v, lang) {
    var reason = v.reason || '';
    if (lang === 'en' || v.lookup === 'editor') return reason;
    var reasons = {
      'Online verification has not been run.': 'Pemeriksaan online belum dijalankan. Status ini bukan bukti bahwa sumber bermasalah.',
      'Fetched metadata differs from the supplied reference.': 'Metadata sumber berbeda dari entri dalam naskah.',
      'Some fields were matched; other fields could not be compared.': 'Sebagian bidang cocok, tetapi bidang lainnya belum dapat dibandingkan.',
      'All compared bibliographic fields matched the fetched record.': 'Semua bidang bibliografi yang dibandingkan cocok dengan rekaman sumber.',
      'Multiple candidate records require disambiguation.': 'Ada lebih dari satu calon sumber yang cocok; identitasnya perlu dibedakan.',
      'No uniquely matching metadata record was established. Absence of a DOI has not been proven.': 'Belum ditemukan satu rekaman metadata yang cocok secara unik. Ini tidak membuktikan bahwa sumber tidak memiliki DOI.',
      'The reference could not be parsed reliably; verify it on an official source page.': 'Entri belum dapat diuraikan dengan pasti. Periksa melalui laman sumber resmi.',
      'Metadata request timed out.': 'Waktu pemeriksaan habis. Coba lagi atau periksa melalui laman resmi.',
      'Crossref returned no metadata.': 'Crossref tidak mengembalikan metadata sumber.'
    };
    if (reasons[reason]) return reasons[reason];
    if (/Failed to fetch|Network|fetch failed/i.test(reason)) return 'Layanan sumber tidak dapat diakses. Periksa koneksi atau ulangi pemeriksaan.';
    if (/^Crossref HTTP/.test(reason)) return 'Permintaan metadata gagal (' + reason + ').';
    return reason ? 'Pesan layanan: ' + reason : '';
  }
  function locationOf(result, evidence, lang) {
    var names = lang === 'en' ? { body: '', table: 'table', textbox: 'text box', footnote: 'footnote', endnote: 'endnote', header: 'header', footer: 'footer' } : { body: '', table: 'tabel', textbox: 'kotak teks', footnote: 'catatan kaki', endnote: 'catatan akhir', header: 'header', footer: 'footer' };
    var parts = (evidence || []).map(function (e) {
      var r = result.zones.records.find(function (r) { return r.id === e.paragraphId; });
      if (!r) return e.paragraphId;
      var n = result.zones.records.indexOf(r) + 1, kind = names[r.kind] || '';
      if (r.section === 'abstract') kind = lang === 'en' ? 'abstract' : 'abstrak';
      if (r.section === 'references') kind = lang === 'en' ? 'references' : 'daftar pustaka';
      return (lang === 'en' ? 'Paragraph ' : 'Paragraf ') + n + (kind ? ' (' + kind + ')' : '');
    });
    return Array.from(new Set(parts)).join('; ') || LABELS[lang].documentLevel;
  }
  function displayIssue(issue, result, lang) {
    var text = issue.texts && issue.texts[lang], untranslated = false;
    if (!text) {
      var original = issue.texts && (issue.texts.id || issue.texts.en);
      text = original || { title: lang === 'en' ? 'Editor’s finding' : 'Temuan editor', problem: issue.comment, action: '' };
      untranslated = !!(original && issue.commentLanguage && issue.commentLanguage !== lang);
    }
    return Object.assign({}, issue, text, { untranslated: untranslated, location: locationOf(result, issue.evidence, lang), examples: issue.examples || [] });
  }
  function verificationIssues(result, lang) {
    var list = [], id = lang === 'id';
    function add(v, ref, title, problem, action, correction, examples) {
      var evidence = ref.recordIds.map(function (pid) { var r = result.zones.records.find(function (r) { return r.id === pid; }); return { paragraphId: pid, quote: r.text }; });
      list.push({ id: 'verification-' + v.refId + '-' + list.length, section: 4, title: title, problem: problem, action: action, correction: correction || '', examples: examples || [ref.raw], evidence: evidence, sourceUrl: v.sourceUrl || '', review: false, source: 'verification', selected: true, location: locationOf(result, evidence, lang), differences: (v.differences || []).map(function (d) { return { field: fieldName(d.field, lang), provided: d.provided, official: d.official }; }) });
    }
    result.verification.forEach(function (v) {
      var ref = result.references.find(function (r) { return r.id === v.refId; }); if (!ref) return;
      if (v.status === 'metadata_mismatch') add(v, ref,
        id ? 'Metadata referensi berbeda dari sumber' : 'Reference metadata differs from the source',
        ref.id + ': ' + (id ? 'metadata yang diterima berbeda dari entri naskah.' : 'the fetched metadata differs from the manuscript entry.'),
        id ? 'Konfirmasikan identitas sumber di laman penerbit. Perbaiki bidang yang berbeda sesuai sumber resmi; jangan sekadar menyalin rekaman yang mungkin merujuk karya lain.' : 'Confirm the source identity on the publisher’s page. Correct differing fields from the official source; do not copy a record that may describe another work.');
      if (v.identityMatches && v.doi && !ref.doi) add(v, ref,
        id ? 'DOI cocok belum dicantumkan' : 'A matching DOI is missing',
        ref.id + ': ' + (id ? 'pencocokan identitas menemukan DOI yang belum dicantumkan.' : 'identity matching established a DOI absent from the reference.'),
        id ? 'Tambahkan DOI berikut setelah menyelesaikan perbedaan bibliografi yang masih ada.' : 'Add the following DOI after resolving any remaining bibliographic differences.', 'https://doi.org/' + v.doi);
      if (ref.doi && !ref.raw.includes('https://doi.org/' + ref.doi)) add(v, ref,
        id ? 'Penulisan DOI belum berupa URL standar' : 'DOI is not written as the standard URL',
        ref.id + ': ' + (id ? 'DOI yang dicantumkan belum memakai format https://doi.org/.' : 'the supplied DOI does not use the https://doi.org/ format.'),
        id ? 'Gunakan bentuk URL berikut. Perubahan format ini tidak membuktikan bahwa DOI valid; periksa kecocokan sumbernya.' : 'Use the following DOI URL. This format change does not establish DOI validity; check its source identity.', 'https://doi.org/' + ref.doi);
      if (v.status === 'verified_no_doi' && ref.doi) add(v, ref,
        id ? 'Konfirmasi tanpa DOI bertentangan dengan entri' : 'No-DOI confirmation conflicts with the entry',
        ref.id + ': ' + (id ? 'editor mencatat sumber tanpa DOI, tetapi entri naskah masih memiliki DOI.' : 'the editor recorded a source without a DOI, but the manuscript entry still supplies one.'),
        id ? 'Periksa keputusan editor dan identitas DOI. Hapus DOI hanya jika sumber resmi mengonfirmasi bahwa pengenal tersebut tidak berlaku.' : 'Check the editor’s decision and DOI identity. Remove the DOI only if an official source establishes it does not apply.');
    });
    return list;
  }
  function report(result, meta) {
    meta = meta || {};
    if (!norm(meta.manuscriptId)) throw new Error('ID naskah wajib diisi.');
    var lang = language(meta), t = LABELS[lang], id = lang === 'id', sync = result.sync;
    var selected = result.issues.filter(function (it) { return it.selected; }).map(function (it) { return displayIssue(it, result, lang); }).concat(verificationIssues(result, lang));
    var groups = [], itemNumber = 0;
    sectionNames(lang).forEach(function (name, i) {
      var items = selected.filter(function (it) { return it.section === i + 1; });
      if (!items.length) return;
      items.forEach(function (it) { it.number = ++itemNumber; });
      groups.push({ number: groups.length + 1, sectionId: i + 1, title: name, items: items });
    });
    var verified = result.verification.filter(function (v) { return ['metadata_verified', 'editor_verified', 'verified_no_doi'].includes(v.status); }).length;
    var num = function (n) { return n.toLocaleString(id ? 'id-ID' : 'en-US'); };
    var summary = [
      [id ? 'Versi pemeriksa' : 'Checker version', id ? 'Lokal 3 · 9 Oktober 2026' : 'Local 3 · 9 October 2026'],
      [id ? 'Kata naskah (perkiraan) / batas' : 'Estimated manuscript words / limit', num(result.manuscriptWords) + ' / ' + num(result.rules.manuscriptMax)],
      [id ? 'Kata abstrak / batas' : 'Abstract words / limit', (result.abstractUncertain ? (id ? 'Batas abstrak belum pasti' : 'Abstract boundary uncertain') : num(result.abstractWords)) + ' / ' + num(result.rules.abstractMax)],
      [id ? 'Entri referensi / minimum' : 'Reference entries / minimum', (result.zones.referenceFound ? num(result.references.length) : (id ? 'Belum terdeteksi' : 'Not detected')) + ' / ' + num(result.rules.referenceMin)],
      [id ? 'Kemunculan sitasi terdeteksi' : 'Detected citation occurrences', num(sync.occurrences)],
      [id ? 'Referensi tanpa sitasi terdeteksi' : 'References with no detected citation', result.zones.referenceFound ? num(sync.uncited.length) : '-'],
      [id ? 'Sitasi tanpa pasangan referensi' : 'Citations with no matching reference', result.zones.referenceFound ? num(sync.unmatched.length) : '-'],
      [id ? 'Sitasi ambigu / belum terselesaikan' : 'Ambiguous / unresolved citations', num(sync.unresolved.length)],
      [id ? 'Entri duplikat di luar entri pertama' : 'Duplicate entries beyond the first', result.zones.referenceFound ? num(sync.duplicateCount) : '-'],
      [id ? 'Referensi cocok / dikonfirmasi' : 'References matched / confirmed', num(verified) + ' / ' + num(result.references.length)],
      [id ? 'Temuan perbaikan / perlu ditinjau' : 'Corrections / findings to review', selected.filter(function (it) { return !it.review; }).length + ' / ' + selected.filter(function (it) { return it.review; }).length]
    ];
    if (result.doc.wordStatistics && result.doc.wordStatistics.isMicrosoftWord) summary.splice(1, 0, [id ? 'Statistik kata tersimpan dari Microsoft Word' : 'Saved Microsoft Word word statistic', num(result.doc.wordStatistics.savedWords)]);
    var scope = id ? 'Pemeriksaan otomatis membaca teks naskah dan memeriksa jumlah kata, pola sitasi, entri referensi, serta elemen format yang dapat dideteksi. Kesesuaian metode dan temuan, etik, kontribusi penulis, mutu bahasa, relevansi sumber, dan keterbacaan gambar memerlukan penilaian editor.' : 'Automated checks read the manuscript text and examine word counts, citation patterns, reference entries, and detectable formatting elements. Consistency between methods and findings, ethics, author contributions, language quality, source relevance, and image legibility require editorial judgment.';
    if (meta.editorConfirmed) scope += id ? ' Editor telah mengonfirmasi tinjauan naskah dan temuan yang disertakan.' : ' The editor has confirmed the manuscript review and included findings.';
    var countNote = id ? 'Hitungan mencakup judul, abstrak, narasi, tabel, caption, dan daftar pustaka; header/footer tidak dihitung. ' : 'The count includes the title, abstract, narrative, tables, captions, and references; headers and footers are excluded. ';
    countNote += result.wordCounts && !result.wordCounts.includeExtra ? (id ? 'Kotak teks, catatan kaki, dan catatan akhir dikecualikan.' : 'Text boxes, footnotes, and endnotes are excluded.') : (id ? 'Kotak teks, catatan kaki, dan catatan akhir disertakan.' : 'Text boxes, footnotes, and endnotes are included.');
    countNote += id ? ' Angka merupakan perkiraan browser. Samakan cakupan pilihan saat membandingkan dengan Word Count.' : ' This is a browser estimate. Use the same scope when comparing it with Word Count.';
    if (result.doc.wordStatistics && result.doc.wordStatistics.isMicrosoftWord) countNote += id ? ' Statistik Word di atas berasal dari penyimpanan terakhir dan dapat belum diperbarui.' : ' The saved Word statistic comes from the last save and may be out of date.';
    var warnings = [];
    if (result.abstractUncertain) warnings.push(id ? 'Batas abstrak belum pasti; tentukan awal dan akhirnya sebelum menilai jumlah kata.' : 'The abstract boundary is uncertain; confirm its start and end before evaluating its word count.');
    if (!result.zones.referenceFound) warnings.push(t.emptyReferences);
    if (sync.unresolvedReferences.length) warnings.push(id ? sync.unresolvedReferences.length + ' entri referensi belum terbaca atau belum berpasangan secara unik.' : sync.unresolvedReferences.length + (sync.unresolvedReferences.length === 1 ? ' reference entry remains unparsed or ambiguously linked.' : ' reference entries remain unparsed or ambiguously linked.'));
    (result.doc.warnings || []).forEach(function (w) {
      if (id) { warnings.push(w); return; }
      if (/Track Changes/.test(w)) warnings.push('Tracked changes are present. The check reads the visible final text and excludes deleted text.');
      else if (/altChunk/.test(w)) warnings.push('Embedded altChunk content requires opening and resaving in Word before its text can be checked.');
      else if (/VML|Objek/.test(w)) warnings.push('Embedded objects or VML shapes require visual inspection in Word.');
      else if (/Statistik kata/.test(w)) warnings.push('Saved word statistics could not be read; counts use the extracted text.');
    });
    return { build: BUILD, language: lang, labels: t, title: t.title, subject: 'Subject: Manuscript ID [' + norm(meta.manuscriptId) + '] Editorial Revision Required Before Copyediting',
      sourceName: result.doc.fileName, createdAt: meta.createdAt || new Date().toISOString(), mode: meta.editorConfirmed ? t.final : t.draft,
      opening: selected.length ? (id ? 'Hasil pemeriksaan berikut memerlukan perbaikan atau klarifikasi sebelum copyediting. Temuan yang berlabel “Perlu ditinjau” harus dikonfirmasi terlebih dahulu pada naskah.' : 'The following findings require correction or clarification before copyediting. Findings labeled “Needs review” must first be confirmed against the manuscript.') : t.noIssues,
      summary: summary, scope: scope, countNote: countNote, warnings: warnings, groups: groups, hasUntranslated: selected.some(function (it) { return it.untranslated; }) || result.verification.some(function (v) { return v.lookup === 'editor' && v.reason && v.reasonLanguage && v.reasonLanguage !== lang; }),
      excludedCount: result.issues.filter(function (it) { return !it.selected; }).length,
      references: result.references.map(function (ref, i) { var v = result.verification[i]; return { id: ref.id, raw: ref.raw, status: (STATUS[v.status] || STATUS.unverified)[lang], reason: reasonText(v, lang), sourceUrl: v.sourceUrl || '', doi: v.doi || '', sourceReasonLanguage: v.reasonLanguage, missingFields: (v.missingFields || []).map(function (s) { return fieldName(s, lang); }) }; }) };
  }
  function issueText(issue, r) {
    var t = r.labels, lines = [issue.number + '. ' + issue.title, t.status + ': ' + (issue.review ? t.review : t.confirmed), t.location + ': ' + issue.location, t.problem + ': ' + issue.problem];
    if (issue.untranslated) lines.push(t.translation);
    if (issue.examples.length) lines.push(t.found + ':\n' + issue.examples.join('\n'));
    if (issue.correction) lines.push(t.correction + ': ' + issue.correction);
    if (issue.action) lines.push(t.action + ': ' + issue.action);
    if (issue.sourceUrl) lines.push(t.sourceEvidence + ': ' + issue.sourceUrl);
    (issue.differences || []).forEach(function (d) { lines.push(d.field + ': ' + (r.language === 'id' ? 'naskah' : 'manuscript') + ' “' + d.provided + '”; ' + (r.language === 'id' ? 'sumber' : 'source') + ' “' + d.official + '”.'); });
    // Evidence remains exact. A location count refers to extracted paragraphs, not Word's printed lines.
    (issue.evidence || []).forEach(function (e) { if (!issue.examples.includes(e.quote)) lines.push(t.evidence + ': ' + e.quote); });
    return lines.join('\n');
  }
  function reportText(r) {
    var t = r.labels, chunks = [r.title, r.subject, t.source + ': ' + r.sourceName, r.mode, t.greeting, r.opening, t.summary + '\n' + r.summary.map(function (row) { return row[0] + ': ' + row[1]; }).join('\n'), r.scope, r.countNote];
    if (r.warnings.length) chunks.push(r.warnings.join('\n'));
    r.groups.forEach(function (g) { chunks.push(g.number + '. ' + g.title + '\n\n' + g.items.map(function (it) { return issueText(it, r); }).join('\n\n')); });
    if (r.references.length) chunks.push(t.refs + '\n\n' + r.references.map(function (v) { return v.id + ': ' + v.raw + '\n' + v.status + '. ' + (v.sourceReasonLanguage && v.sourceReasonLanguage !== r.language ? (r.language === 'id' ? 'Catatan editor dalam bahasa asli: ' : 'Editor’s note in its original language: ') : '') + v.reason + (v.missingFields.length ? '\n' + (r.language === 'id' ? 'Belum dibandingkan: ' : 'Not compared: ') + v.missingFields.join(', ') : '') + (v.sourceUrl ? '\n' + t.sourceEvidence + ': ' + v.sourceUrl : '') + (v.doi ? '\nhttps://doi.org/' + v.doi : ''); }).join('\n\n'));
    chunks.push(t.closing); return chunks.join('\n\n');
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeSource(url) { try { return new URL(url).protocol === 'https:'; } catch (err) { return false; } }
  function renderReport(r) {
    var t = r.labels, esc = escapeHtml, locale = r.language === 'id' ? 'id-ID' : 'en-US';
    var link = function (url) { return safeSource(url) ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>' : esc(url); };
    var html = '<h1>' + esc(r.title) + '</h1><p class="rp-meta">' + esc(t.source) + ': ' + esc(r.sourceName) + ' | ' + esc(t.date) + ': ' + esc(new Date(r.createdAt).toLocaleString(locale)) + '</p><p class="rp-subject">' + esc(r.subject) + '</p><p class="rp-mode">' + esc(r.mode) + '</p><p>' + esc(t.greeting) + '</p><p>' + esc(r.opening) + '</p><h2>' + esc(t.summary) + '</h2><table class="rp-summary"><tbody>';
    r.summary.forEach(function (row) { html += '<tr><td>' + esc(row[0]) + '</td><td>' + esc(row[1]) + '</td></tr>'; }); html += '</tbody></table><p class="rp-scope">' + esc(r.scope) + '</p><p class="rp-count-note">' + esc(r.countNote) + '</p>';
    if (r.warnings.length) html += '<div class="rp-notice">' + r.warnings.map(esc).join('<br>') + '</div>';
    if (r.excludedCount) html += '<p class="rp-count-note">' + (r.language === 'id' ? r.excludedCount + ' temuan tidak disertakan sesuai pilihan editor.' : r.excludedCount + ' findings were excluded by editor selection.') + '</p>';
    r.groups.forEach(function (g) {
      html += '<h2 class="rp-section" data-section-number="' + g.number + '">' + g.number + '. ' + esc(g.title) + '</h2>';
      g.items.forEach(function (it) {
        html += '<div class="rp-issue ' + (it.review ? 'warning' : 'error') + '"><div class="t">' + it.number + '. ' + esc(it.title) + '</div><p class="rp-location">' + esc(it.location) + ' | ' + esc(it.review ? t.review : t.confirmed) + '</p><p class="d">' + esc(it.problem) + '</p>';
        if (it.untranslated) html += '<p class="rp-notice">' + esc(t.translation) + '</p>';
        if (it.examples.length) html += '<div class="rp-found"><b>' + esc(t.found) + ':</b><ul>' + it.examples.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
        (it.differences || []).forEach(function (d) { html += '<p class="rp-found"><b>' + esc(d.field) + ':</b> ' + (r.language === 'id' ? 'naskah' : 'manuscript') + ' “' + esc(d.provided) + '”; ' + (r.language === 'id' ? 'sumber' : 'source') + ' “' + esc(d.official) + '”.</p>'; });
        if (it.correction) html += '<p class="rp-correction"><b>' + esc(t.correction) + ':</b> ' + esc(it.correction) + '</p>';
        if (it.action) html += '<p class="rp-action"><b>' + esc(t.action) + ':</b> ' + esc(it.action) + '</p>';
        var quotes = (it.evidence || []).filter(function (e) { return !it.examples.includes(e.quote); });
        if (quotes.length) html += '<div class="rp-evidence"><b>' + esc(t.evidence) + ':</b>' + quotes.map(function (e) { return '<blockquote>' + esc(limit(e.quote, 900)) + '</blockquote>'; }).join('') + '</div>';
        if (it.sourceUrl) html += '<p class="rp-source">' + esc(t.sourceEvidence) + ': ' + link(it.sourceUrl) + '</p>';
        html += '</div>';
      });
    });
    if (r.references.length) {
      html += '<h2>' + esc(t.refs) + '</h2><p class="rp-count-note">' + (r.language === 'id' ? 'Status “Belum diperiksa online” berarti pemeriksaan belum dijalankan, bukan bahwa referensi salah. Kegagalan pencarian tidak membuktikan sumber fiktif atau tidak memiliki DOI. Kecocokan metadata tidak membuktikan relevansi terhadap klaim.' : '“Not checked online” means no lookup was run, rather than an invalid source. A failed lookup does not establish fabrication or the absence of a DOI. Metadata matching does not establish relevance to a claim.') + '</p>';
      r.references.forEach(function (v) { html += '<div class="rp-reference"><p><b>' + esc(v.id) + '</b> ' + esc(v.raw) + '</p><p><b>' + esc(t.status) + ':</b> ' + esc(v.status) + '</p><p>' + esc(v.reason) + '</p>' + (v.missingFields.length ? '<p>' + (r.language === 'id' ? 'Belum dibandingkan: ' : 'Not compared: ') + esc(v.missingFields.join(', ')) + '.</p>' : '') + (v.sourceUrl ? '<p>' + link(v.sourceUrl) + '</p>' : '') + (v.doi ? '<p>' + link('https://doi.org/' + v.doi) + '</p>' : '') + '</div>'; });
    }
    html += '<div class="rp-closing">' + t.closing.split('\n\n').map(function (s) { return '<p>' + esc(s) + '</p>'; }).join('') + '</div>';
    return html;
  }
  function createLetter(result, meta) { return reportText(report(result, meta)); }
  function verificationComments(result) { return verificationIssues(result, 'en').map(function (it) { return it.problem + ' ' + it.action + (it.correction ? ' ' + it.correction : ''); }); }
  function validateIssue(item, result) {
    if (!item || !Number.isInteger(item.section) || item.section < 1 || item.section > 7 || !norm(item.comment)) throw new Error('Pilih bagian dan isi komentar masalah serta perbaikannya.');
    if (!Array.isArray(item.evidence) || !item.evidence.length) throw new Error('Temuan editor memerlukan kutipan dari naskah.');
    item.evidence.forEach(function (e) { var record = result.zones.records.find(function (r) { return r.id === e.paragraphId; }); if (!record || !norm(e.quote) || !norm(record.text).includes(norm(e.quote))) throw new Error('Kutipan tidak ditemukan dalam paragraf yang dipilih.'); });
    var allowed = new Set(result.references.map(function (r) { return norm(r.doi).toLowerCase(); }).concat(result.verification.filter(function (v) { return v.checked && v.doi; }).map(function (v) { return v.doi.toLowerCase(); })));
    var dois = norm(item.comment).match(/10\.\d{4,9}\/[^\s“”"<>]+/gi) || [];
    dois.forEach(function (doi) { doi = doi.replace(/[.,;)]*$/, '').toLowerCase(); if (!allowed.has(doi)) throw new Error('DOI dalam komentar belum berasal dari naskah atau metadata yang diperiksa.'); });
    if (/\b(?:all\s+references\s+(?:are|have\s+been)\s+verified|I\s+verified\s+every|semua\s+referensi\s+(?:telah\s+)?terverifikasi)\b/i.test(item.comment)) throw new Error('Status verifikasi harus berasal dari pemeriksaan sumber yang tercatat.');
    return Object.assign({}, item, { comment: norm(item.comment), source: 'editor', review: false, selected: true });
  }
  return { BUILD: BUILD, DEFAULTS: DEFAULTS, SECTIONS: SECTIONS, SECTIONS_ID: SECTIONS_ID, LABELS: LABELS, STATUSES: STATUS, normalize: norm, countWords: words, documentWords: documentWords, settings: settings, segment: segment, audit: audit, compareMetadata: compare, verifyReferences: verifyReferences, verificationComments: verificationComments, reasonText: reasonText, fieldName: fieldName, displayIssue: displayIssue, report: report, renderReport: renderReport, reportText: reportText, issueText: issueText, createLetter: createLetter, validateIssue: validateIssue };
});
