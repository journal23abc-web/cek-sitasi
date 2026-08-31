// converter-engine.js — Konversi in-text citation (parenthetical & narrative) antar gaya sitasi.
//
// Prinsip desain:
//  - Semua parsing & pencocokan sitasi<->referensi memakai ulang engine.js (CitationEngine),
//    bukan menulis ulang — supaya konversi selalu konsisten dengan apa yang Validator anggap
//    "benar/cocok". Ini penting: converter tidak boleh mengarang pencocokan yang berbeda dari
//    validator, karena keduanya harus sepakat soal sitasi mana merujuk ke referensi mana.
//  - Sitasi yang AMBIGU atau TIDAK COCOK dengan referensi manapun TIDAK diubah sama sekali —
//    dibiarkan seperti aslinya dan ditandai supaya pengguna bisa cek manual. Lebih baik tidak
//    mengonversi daripada mengonversi dengan salah tebak.
//  - Untuk daftar referensi: HANYA bagian format nama penulis + penomoran/urutan entri yang
//    diubah. Bagian setelah penulis (tahun, judul, jurnal, halaman) SENGAJA tidak disentuh,
//    karena penempatan tahun & gaya tanda kutip judul berbeda-beda per gaya dan mengubahnya
//    otomatis berisiko salah tanpa nama depan lengkap / template per jenis sumber yang lengkap.
//    Ini konsisten dengan filosofi "jujur soal keterbatasan" yang sudah dipakai di README.

(function() {
  function loadEngine() {
    if (typeof module !== 'undefined' && module.exports) return require('./engine.js');
    if (typeof window !== 'undefined' && window.CitationEngine) return window.CitationEngine;
    if (typeof self !== 'undefined' && self.CitationEngine) return self.CitationEngine;
    throw new Error('CitationEngine (engine.js) belum dimuat — converter-engine.js butuh itu.');
  }
  var CE = loadEngine();
  var STYLES = CE.STYLES;

  // ---------- AUTHOR-NAME SPLITTING (source style raw fragment -> {last, given[]}) ----------
  // given[] tokens are whatever the source provided: could be bare initials ("J", "J.") or,
  // for first-inverted styles (Chicago/MLA), a full given name ("John"). We never fabricate
  // information that isn't there — a source that only has initials stays initials-only even
  // when the target style conventionally expects a full given name.
  function splitAuthorFragment(fragment, styleId) {
    var style = STYLES[styleId];
    var s = (fragment || '').trim();
    if (!s) return { last: '', given: [] };
    if (style.authorForm === 'non-inverted') { // "F. M. Last"
      var toks = s.split(/\s+/);
      if (toks.length === 1) return { last: toks[0], given: [] };
      return { last: toks[toks.length - 1], given: toks.slice(0, -1) };
    }
    if (style.authorForm === 'vancouver') { // "Last FM"
      var m = s.match(/^(.+?)\s+([A-Za-z]{1,4})$/);
      if (!m) return { last: s, given: [] };
      return { last: m[1], given: m[2].split('').filter(function(c) { return /[A-Za-z]/.test(c); }) };
    }
    // all-inverted ("Last, F. M.") or first-inverted ("Last, First M." / "First M. Last")
    if (s.indexOf(',') !== -1) {
      var parts = s.split(',');
      var lastN = parts[0].trim();
      var givenStr = parts.slice(1).join(',').trim();
      return { last: lastN, given: givenStr ? givenStr.split(/\s+/).filter(Boolean) : [] };
    }
    var toks2 = s.split(/\s+/);
    if (toks2.length === 1) return { last: toks2[0], given: [] };
    return { last: toks2[toks2.length - 1], given: toks2.slice(0, -1) };
  }

  function isInitialToken(t) { return /^[A-Za-z]\.?$/.test(t || ''); }

  // Strips a leading "p."/"pp." label so page numbers can be re-prefixed consistently for the
  // TARGET style (APA/Harvard want "p. 12", MLA wants a bare "12", Chicago wants a bare "12"
  // after the year) regardless of how the source happened to write it.
  function normalizePageInfo(pageInfo) {
    if (!pageInfo) return null;
    return String(pageInfo).replace(/^pp?\.\s*/i, '').trim() || null;
  }

  // Formats a single given-name token as initials, preserving a hyphenated pair like "T.-J."
  // (for a hyphenated first name such as "Tien-Ju") as "T.-J." instead of collapsing it down
  // to just the first letter — each hyphen-joined part gets its own initial+period.
  function formatInitialToken(t) {
    var raw = (t || '').trim();
    if (!raw) return '';
    if (raw.indexOf('-') !== -1) {
      return raw.split('-').map(function(part) {
        var c = part.replace(/\./g, '').trim();
        return c ? c.charAt(0).toUpperCase() + '.' : '';
      }).filter(Boolean).join('-');
    }
    var c = raw.replace(/\./g, '').trim();
    return c ? c.charAt(0).toUpperCase() + '.' : '';
  }
  // Same idea, but returns bare letters with no periods/hyphens — for Vancouver's glued
  // initials block (e.g. "T.-J." -> "TJ", not just "T").
  function initialLettersFromToken(t) {
    var raw = (t || '').trim();
    if (!raw) return '';
    return raw.split('-').map(function(part) {
      var c = part.replace(/\./g, '').trim();
      return c ? c.charAt(0).toUpperCase() : '';
    }).join('');
  }

  function renderGivenAsInitials(givenTokens) {
    return givenTokens.map(formatInitialToken).filter(Boolean).join(' ');
  }
  // Keeps full-name tokens as-is (only normalizes bare initials to "X."); used for styles
  // whose convention is a full given name (Chicago, MLA) so we don't downgrade information
  // the source actually had.
  function renderGivenNatural(givenTokens) {
    return givenTokens.map(function(t) {
      if (isInitialToken(t)) return formatInitialToken(t);
      return t;
    }).filter(Boolean).join(' ');
  }
  function givenTokensHaveFullName(givenTokens) {
    return givenTokens.some(function(t) { return !isInitialToken(t); });
  }

  function renderAuthorForStyle(last, givenTokens, targetStyleId, position) {
    var style = STYLES[targetStyleId];
    switch (style.authorForm) {
      case 'all-inverted': { // "Last, F. M."
        var ini = renderGivenAsInitials(givenTokens);
        return last + (ini ? ', ' + ini : '');
      }
      case 'non-inverted': { // "F. M. Last"
        var ini2 = renderGivenAsInitials(givenTokens);
        return (ini2 ? ini2 + ' ' : '') + last;
      }
      case 'vancouver': { // "Last FM" (no dots/spaces)
        var block = givenTokens.map(initialLettersFromToken).join('');
        return last + (block ? ' ' + block : '');
      }
      case 'first-inverted': { // Chicago / MLA
        var display = renderGivenNatural(givenTokens);
        if (position === 'first') return last + (display ? ', ' + display : '');
        return (display ? display + ' ' : '') + last;
      }
      default: return last;
    }
  }

  // Some source reference lists write "et al." literally inside the author list itself
  // (non-standard, but it happens) instead of listing every author. engine.js's own author
  // parser has no way to tell that apart from a real (unusual) surname, so it can surface as
  // a stray "author" fragment. We filter it out here so it never gets rendered as a fake name
  // like "E. al." in converted output.
  function isEtAlFragment(fragment) { return /^et\s+al\.?$/i.test((fragment || '').trim()); }

  function canonicalAuthorsFromRef(ref, sourceStyleId) {
    if (ref.isInstitutional) return [{ last: ref.firstAuthor, given: [], institutional: true }];
    return (ref.authors || []).filter(function(a) { return !isEtAlFragment(a); }).map(function(a) {
      var sp = splitAuthorFragment(a, sourceStyleId);
      return { last: sp.last, given: sp.given, institutional: false };
    });
  }

  function surnamesFromRef(ref, sourceStyleId) {
    if (ref.isInstitutional) return [ref.firstAuthor];
    return (ref.authors || []).filter(function(a) { return !isEtAlFragment(a); }).map(function(a) { return CE.surnameOf(a, sourceStyleId); });
  }

  // ---------- IN-TEXT RENDERING ----------
  function joinList(names, sep) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' ' + sep + ' ' + names[1];
    return names.slice(0, -1).join(', ') + ', ' + sep + ' ' + names[names.length - 1];
  }

  // The surname string shown in-text for one reference in an author-date/author-page target,
  // respecting that style's et-al threshold (APA/Harvard: 3+, Chicago: 4+, MLA: 3+).
  function inTextDisplayName(ref, sourceStyleId, targetStyleId) {
    var style = STYLES[targetStyleId];
    var surnames = surnamesFromRef(ref, sourceStyleId);
    var count = ref.authorCount || surnames.length;
    var threshold = style.etAlThreshold || 3;
    if (count >= threshold) return (surnames[0] || ref.firstAuthor || '?') + ' et al.';
    var sep = style.sep === '&' ? '&' : (style.sep === 'and' ? 'and' : 'and');
    return joinList(surnames.slice(0, Math.max(1, Math.min(surnames.length, count))), sep);
  }

  function formatAuthorDateSingle(ref, sourceStyleId, targetStyleId, mode, pageInfo) {
    var name = inTextDisplayName(ref, sourceStyleId, targetStyleId);
    var year = ref.year || 'n.d.';
    var isChicago = targetStyleId === 'chicago';
    if (mode === 'narrative') {
      var tailN = pageInfo ? ', ' + pageInfo : '';
      return name + ' (' + year + tailN + ')';
    }
    if (isChicago) { // Chicago author-date parenthetical: (Author Year, page) — no comma before year
      var tailC = pageInfo ? ', ' + pageInfo : '';
      return '(' + name + ' ' + year + tailC + ')';
    }
    var tail = pageInfo ? ', p. ' + pageInfo : '';
    return '(' + name + ', ' + year + tail + ')';
  }

  function formatAuthorDateGroup(refs, sourceStyleId, targetStyleId) {
    var isChicago = targetStyleId === 'chicago';
    var items = refs.map(function(ref) {
      var name = inTextDisplayName(ref, sourceStyleId, targetStyleId);
      var year = ref.year || 'n.d.';
      var sortKey = (surnamesFromRef(ref, sourceStyleId)[0] || ref.firstAuthor || '').toLowerCase();
      return { sortKey: sortKey, text: isChicago ? (name + ' ' + year) : (name + ', ' + year) };
    });
    items.sort(function(a, b) { return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0; });
    return '(' + items.map(function(i) { return i.text; }).join('; ') + ')';
  }

  function formatAuthorPageSingle(ref, sourceStyleId, mode, page) {
    var surnames = surnamesFromRef(ref, sourceStyleId);
    var count = ref.authorCount || surnames.length;
    var name;
    if (count >= 3) name = (surnames[0] || ref.firstAuthor) + ' et al.';
    else if (count === 2) name = surnames[0] + ' and ' + surnames[1];
    else name = surnames[0] || ref.firstAuthor;
    if (mode === 'narrative') return name + (page ? ' (' + page + ')' : ' (page tidak diketahui)');
    return '(' + name + (page ? ' ' + page : '') + ')';
  }

  function formatAuthorPageGroup(refs, sourceStyleId, pages) {
    var items = refs.map(function(ref, i) {
      var surnames = surnamesFromRef(ref, sourceStyleId);
      var count = ref.authorCount || surnames.length;
      var name = count >= 3 ? (surnames[0] || ref.firstAuthor) + ' et al.' : count === 2 ? surnames[0] + ' and ' + surnames[1] : (surnames[0] || ref.firstAuthor);
      var pg = pages && pages[i];
      return name + (pg ? ' ' + pg : '');
    });
    return '(' + items.join('; ') + ')';
  }

  // Compresses a sorted-or-unsorted list of numbers into IEEE/Vancouver-style groups,
  // e.g. [1,2,3,5] -> ["1-3","5"]. Only collapses a run into a range when it has THREE OR
  // MORE consecutive numbers — standard IEEE editorial practice writes exactly two
  // consecutive citations as "[1], [2]", not "[1]-[2]"; a dash range is reserved for 3+
  // (e.g. "[1]-[3]"). Vancouver follows the same convention.
  function compressRanges(nums) {
    var sorted = nums.slice().sort(function(a, b) { return a - b; });
    var out = [], i = 0;
    while (i < sorted.length) {
      var start = sorted[i], end = start;
      while (i + 1 < sorted.length && sorted[i + 1] === end + 1) { end = sorted[i + 1]; i++; }
      var runLength = end - start + 1;
      if (runLength >= 3) {
        out.push(start + '-' + end);
      } else {
        for (var n = start; n <= end; n++) out.push(String(n));
      }
      i++;
    }
    return out;
  }

  function formatNumeric(nums, targetStyleId) {
    var groups = compressRanges(nums);
    if (targetStyleId === 'ieee') {
      return groups.map(function(g) {
        if (g.indexOf('-') !== -1) { var p = g.split('-'); return '[' + p[0] + ']\u2013[' + p[1] + ']'; }
        return '[' + g + ']';
      }).join(', ');
    }
    // vancouver
    return '(' + groups.join(',') + ')';
  }

  // ---------- MAIN CONVERSION ----------
  // Determines how a group of matched references should be rendered for a given target style
  // family, in either "parenthetical" or "narrative" mode. `numberOf` resolves a reference to
  // its assigned citation-order number (only used for numeric targets).
  function renderForTarget(refs, sourceStyleId, targetStyleId, mode, extra, numberOf, literalNarrativeAuthors) {
    var family = STYLES[targetStyleId].family;
    if (family === 'author-date') {
      if (mode === 'narrative') return formatAuthorDateSingle(refs[0], sourceStyleId, targetStyleId, 'narrative', extra.pageInfo);
      if (refs.length === 1) return formatAuthorDateSingle(refs[0], sourceStyleId, targetStyleId, 'parenthetical', extra.pageInfo);
      return formatAuthorDateGroup(refs, sourceStyleId, targetStyleId);
    }
    if (family === 'author-page') {
      if (mode === 'narrative') return formatAuthorPageSingle(refs[0], sourceStyleId, 'narrative', extra.page);
      if (refs.length === 1) return formatAuthorPageSingle(refs[0], sourceStyleId, 'parenthetical', extra.page);
      return formatAuthorPageGroup(refs, sourceStyleId, extra.pages);
    }
    // numeric target
    var nums = refs.map(numberOf);
    if (mode === 'narrative' && literalNarrativeAuthors) {
      return literalNarrativeAuthors + ' ' + formatNumeric(nums, targetStyleId);
    }
    return formatNumeric(nums, targetStyleId);
  }

  // Finds the true end of a narrative "Author (Year...)" match in the ORIGINAL article text.
  // engine.js's own `raw` for narrative citations is a re-assembled string (authors + ' (' +
  // year + ')') that can drift from the literal source text (extra spacing, page info inside
  // the parens, etc.) — so for safe in-place replacement we re-locate the real "(" ... ")"
  // span starting at the citation's reported position instead of trusting the reassembled raw.
  function computeNarrativeSpan(text, position, expectedYear) {
    var openIdx = text.indexOf('(', position);
    if (openIdx === -1 || openIdx - position > 40) return null; // sanity bound
    var closeIdx = text.indexOf(')', openIdx);
    if (closeIdx === -1) return null;
    var raw = text.substring(position, closeIdx + 1);
    if (expectedYear && raw.indexOf(expectedYear) === -1) return null;
    return { start: position, end: closeIdx + 1, raw: raw };
  }

  // Numeric styles (IEEE/Vancouver) don't structurally distinguish narrative from parenthetical
  // citations the way author-date styles do ("Smith (2020)" is self-marking; "[7]" is not) —
  // that distinction lives entirely in how the surrounding prose was written, e.g. "Chan and Hu
  // [7] examined..." vs "...examined by prior work [7]". Converting the FIRST shape to an
  // author-date target by blindly swapping "[7]" for "(Chan & Hu, 2023)" duplicates the name
  // that's already sitting right there in the sentence ("Chan and Hu (Chan & Hu, 2023)"). This
  // looks back from a numeric citation's own position for a plausible personal-name mention
  // immediately before it, so that case can instead get a year-only parenthetical.
  //
  // Deliberately conservative: a MISSED narrative citation just produces slightly redundant
  // (but still correct and complete) output; a FALSE positive would silently drop an author
  // name from the sentence entirely. So this only fires on a tight, name-shaped pattern immediately
  // adjacent to the bracket, and rejects common capitalized non-name words that could otherwise
  // precede a bracket citation (section/figure/table references, etc.).
  var NARRATIVE_LOOKBACK_SKIP_WORDS = new Set([
    'table', 'fig', 'figure', 'figures', 'eq', 'eqs', 'equation', 'equations', 'section', 'sections',
    'sec', 'secs', 'chapter', 'chapters', 'appendix', 'appendices', 'model', 'models', 'theorem',
    'theorems', 'note', 'notes', 'item', 'items', 'step', 'steps', 'algorithm', 'algorithms',
    'definition', 'definitions', 'lemma', 'lemmas', 'proof', 'proofs', 'example', 'examples',
    'page', 'pages', 'vol', 'volume', 'no', 'part', 'parts', 'phase', 'phases', 'stage', 'stages',
    'level', 'levels', 'type', 'types', 'group', 'groups', 'class', 'classes', 'category',
    'categories', 'ref', 'refs', 'reference', 'references', 'rq', 'rqs', 'h', 'hypothesis',
    'hypotheses', 'utaut', 'ai', 'chatgpt',
  ]);
  function precedingNarrativeName(text, position) {
    var windowStart = Math.max(0, position - 60);
    var before = text.slice(windowStart, position);
    var m = before.match(/([\p{Lu}][\p{L}'\u2019\-]*(?:\s+(?:and|&)\s+[\p{Lu}][\p{L}'\u2019\-]*)?(?:\s+et\s+al\.?)?)\s*$/u);
    if (!m) return null;
    var candidate = m[1];
    var firstToken = candidate.split(/\s+/)[0].toLowerCase();
    if (NARRATIVE_LOOKBACK_SKIP_WORDS.has(firstToken)) return null;
    if (firstToken.length < 2) return null; // single-letter tokens are never a surname on their own
    return candidate;
  }

  function convert(articleText, referenceText, sourceStyleId, targetStyleId) {
    if (!STYLES[sourceStyleId]) throw new Error('Gaya sumber tidak dikenal: ' + sourceStyleId);
    if (!STYLES[targetStyleId]) throw new Error('Gaya tujuan tidak dikenal: ' + targetStyleId);
    articleText = articleText || '';
    referenceText = referenceText || '';

    var sourceStyle = STYLES[sourceStyleId];
    var v = new CE.MultiFormatValidator(articleText, referenceText, sourceStyleId);
    v.validate(); // populates v.references, v.citations, v.acronymMap (family-specific refMap/refByNumber not relied on below)

    // ---- Universal reference maps (built regardless of the declared source family) ----
    // v.references always carries author/year/numLabel fields no matter which family
    // sourceStyleId parsed them as (parseReferenceLine populates all of them), so these three
    // maps can resolve a citation written in ANY family's shape against the SAME reference
    // list — this is what lets the converter also catch and fix "stray" citations that were
    // already in a different style than the rest of the document (mixed-style source), not
    // just the ones matching the declared source family. Construction is intentionally
    // identical to what MultiFormatValidator's own family-specific refMap/refByNumber would
    // build, so resolution behavior for the PRIMARY family is unchanged from before.
    var authorPageMap = new Map(), numberMap = {};
    v.references.forEach(function(r) {
      var keyAP = v.keyFromRefAuthor(r);
      if (!authorPageMap.has(keyAP)) authorPageMap.set(keyAP, []);
      authorPageMap.get(keyAP).push(r);
      if (r.numLabel != null) numberMap[r.numLabel] = r;
    });

    var matchedOrder = [];
    var seen = new Set();
    function register(ref) { if (!seen.has(ref)) { seen.add(ref); matchedOrder.push(ref); } }
    function numberOf(ref) { register(ref); return matchedOrder.indexOf(ref) + 1; }

    function resolveAuthorYear(token, authors, year, hasEtAl) {
      if (!CE.resolveAuthorDateReference) return { status: 'nomatch', reason: 'resolver-unavailable' };
      var decision = CE.resolveAuthorDateReference(token, authors || [token], year, v.references, sourceStyleId, v.acronymMap, { hasEtAl: !!hasEtAl });
      if (decision.status === 'matched') {
        return { status: 'ok', ref: decision.ref, reason: decision.reason, confidence: decision.confidence };
      }
      return decision;
    }
    function resolveAuthorOnly(token) { // MLA (no year)
      var key = v.keyFromCitationToken(token);
      if (authorPageMap.has(key)) {
        var refs = authorPageMap.get(key);
        return refs.length === 1 ? { status: 'ok', ref: refs[0] } : { status: 'ambiguous', candidates: refs };
      }
      var fuzzy = v.fuzzyFind(key, authorPageMap);
      return fuzzy ? { status: 'ok', ref: fuzzy } : { status: 'nomatch' };
    }
    function resolveNumbers(numbers) {
      var refs = numbers.map(function(n) { return numberMap[n]; });
      if (refs.every(Boolean) && refs.length > 0) return { status: 'ok', refs: refs };
      return { status: 'nomatch' };
    }

    // ---- Primary-family citations (the declared source style) ----
    // Sort by position — extractAuthorDateCitations returns ALL parenthetical matches first,
    // THEN all narrative matches, so the combined array is not naturally in reading order even
    // though each sub-pass is. Numeric/author-page extraction is already single-pass and in
    // order, but sorting is harmless there too.
    var primaryCitations = v.citations.slice().sort(function(a, b) { return a.position - b.position; })
      .map(function(c) { return { c: c, family: sourceStyle.family, crossFamily: false }; });

    // ---- Cross-family citations (mixed-style detection) ----
    // Scans the article for citation SHAPES belonging to the OTHER two families, in case the
    // source document already mixes styles (e.g. mostly APA with a few stray IEEE-style
    // citations) — without this, those strays would never even be considered for conversion,
    // silently surviving as leftover mixed formatting in the output. Deliberately conservative
    // to avoid false positives on ordinary prose:
    //  - numeric: only the unambiguous "[12]" bracket form is scanned, never bare "(12)"
    //    (which collides with things like "(95% CI)" or "(p < 0.05)").
    //  - author-page: only kept when the leading token looks like a real personal name, to
    //    avoid false hits like "(Table 5)" or "(Figure 3)".
    function scanCrossFamilyBracketNumeric(text) {
      var out = [];
      var re = /\[(\d+(?:\s*[,\-\u2013]\s*\d+)*)\]/g;
      var m;
      while ((m = re.exec(text)) !== null) {
        var nums = m[1].split(/\s*[,\-\u2013]\s*/).map(function(n) { return parseInt(n, 10); }).filter(function(n) { return !isNaN(n); });
        if (nums.length) out.push({ raw: m[0], numbers: nums, position: m.index, form: 'bracket', type: 'numeric-cross' });
      }
      return out;
    }
    var crossFamilyCitations = [];
    if (sourceStyle.family !== 'numeric') {
      scanCrossFamilyBracketNumeric(articleText).forEach(function(c) {
        crossFamilyCitations.push({ c: c, family: 'numeric', crossFamily: true });
      });
    }
    if (sourceStyle.family !== 'author-date') {
      CE.extractAuthorDateCitations(articleText).forEach(function(c) {
        crossFamilyCitations.push({ c: c, family: 'author-date', crossFamily: true });
      });
    }
    if (sourceStyle.family !== 'author-page') {
      CE.extractAuthorPageCitations(articleText).forEach(function(c) {
        var looksReal = c.parts.every(function(p) { return !p.firstAuthor || CE.looksLikePersonalName(p.firstAuthor); });
        if (looksReal) crossFamilyCitations.push({ c: c, family: 'author-page', crossFamily: true });
      });
    }
    // Drop any cross-family find that overlaps a primary-family citation's own span (the
    // primary extractor already owns that text) — keeps the two sets non-overlapping before
    // merging, so the shared processing loop below never double-handles the same characters.
    function eventSpan(ev) {
      if (ev.family === 'author-date' && ev.c.type === 'narrative') {
        var span = computeNarrativeSpan(articleText, ev.c.position, ev.c.year);
        return span ? { start: span.start, end: span.end } : { start: ev.c.position, end: ev.c.position };
      }
      return { start: ev.c.position, end: ev.c.position + ev.c.raw.length };
    }
    var primarySpansForOverlapCheck = primaryCitations.map(eventSpan);
    crossFamilyCitations = crossFamilyCitations.filter(function(ev) {
      var s = eventSpan(ev);
      return primarySpansForOverlapCheck.every(function(ps) { return s.end <= ps.start || s.start >= ps.end; });
    });

    var allEvents = primaryCitations.concat(crossFamilyCitations)
      .sort(function(a, b) { return eventSpan(a).start - eventSpan(b).start; });

    var familyLabel = { 'numeric': 'numerik (IEEE/Vancouver, mis. "[3]")', 'author-date': 'author-date (mis. APA/Harvard/Chicago, "(Penulis, Tahun)")', 'author-page': 'author-page (mis. MLA, "(Penulis Halaman)")' };

    var spans = []; // {start,end,replacement,matched,note,originalRaw}
    var lastAcceptedEnd = -1;

    allEvents.forEach(function(ev) {
      var c = ev.c, family = ev.family, crossFamily = ev.crossFamily;
      var start, end, raw, replacement = null, matched = false, note = null;
      var mismatchNote = crossFamily
        ? ('Terlihat seperti sitasi gaya ' + familyLabel[family] + ' yang tercampur dengan gaya utama naskah — ')
        : '';

      if (family === 'author-date') {
        if (c.type === 'parenthetical') {
          start = c.position; raw = c.raw; end = start + raw.length;
          if (c.parts.length === 1) {
            var p = c.parts[0];
            var res = p.firstAuthor ? resolveAuthorYear(p.firstAuthor, p.authors, p.year, p.hasEtAl) : { status: 'nomatch' };
            if (res.status === 'ok') {
              register(res.ref);
              var pg = normalizePageInfo(p.pageInfo);
              replacement = renderForTarget([res.ref], sourceStyleId, targetStyleId, 'parenthetical', { pageInfo: pg, page: pg }, numberOf, null);
              matched = true;
            } else {
              note = res.status === 'ambiguous' ? mismatchNote + 'Sitasi ambigu (beberapa referensi cocok) — tidak diubah, cek manual.' : mismatchNote + 'Tidak ditemukan referensi yang cocok — tidak diubah.';
            }
          } else {
            var refs = [], ok = true;
            c.parts.forEach(function(part) {
              if (!ok) return;
              var r = part.firstAuthor ? resolveAuthorYear(part.firstAuthor, part.authors, part.year, part.hasEtAl) : { status: 'nomatch' };
              if (r.status === 'ok') refs.push(r.ref); else ok = false;
            });
            if (ok && refs.length > 0) {
              refs.forEach(register);
              replacement = renderForTarget(refs, sourceStyleId, targetStyleId, 'parenthetical', {}, numberOf, null);
              matched = true;
            } else {
              note = mismatchNote + 'Salah satu atau lebih sitasi dalam grup ini tidak cocok dengan referensi — seluruh grup tidak diubah.';
            }
          }
        } else { // narrative
          var span = computeNarrativeSpan(articleText, c.position, c.year);
          if (!span) { note = 'Span sitasi naratif tidak terverifikasi — tidak diubah.'; start = c.position; end = c.position; raw = ''; }
          else {
            start = span.start; end = span.end; raw = span.raw;
            var cleanAuthors = c.authors.replace(/\s*et\s+al\.?/i, '');
            var authorsArr = CE.splitOnSeparators(cleanAuthors);
            var res2 = authorsArr.length ? resolveAuthorYear(authorsArr[0], authorsArr, c.year, /et\s+al/i.test(c.authors)) : { status: 'nomatch' };
            if (res2.status === 'ok') {
              register(res2.ref);
              replacement = renderForTarget([res2.ref], sourceStyleId, targetStyleId, 'narrative', {}, numberOf, c.authors);
              matched = true;
            } else {
              note = res2.status === 'ambiguous' ? mismatchNote + 'Sitasi ambigu — tidak diubah, cek manual.' : mismatchNote + 'Tidak ditemukan referensi yang cocok — tidak diubah.';
            }
          }
        }
      } else if (family === 'author-page') {
        start = c.position; raw = c.raw; end = start + raw.length;
        if (c.parts.length === 1) {
          var pp = c.parts[0];
          var r3 = pp.firstAuthor ? resolveAuthorOnly(pp.firstAuthor) : { status: 'nomatch' };
          if (r3.status === 'ok') {
            register(r3.ref);
            replacement = renderForTarget([r3.ref], sourceStyleId, targetStyleId, 'parenthetical', { page: pp.page, pageInfo: pp.page }, numberOf, null);
            matched = true;
          } else {
            note = r3.status === 'ambiguous' ? mismatchNote + 'Sitasi ambigu — tidak diubah, cek manual.' : mismatchNote + 'Tidak ditemukan referensi yang cocok — tidak diubah.';
          }
        } else {
          var refs2 = [], pages2 = [], ok2 = true;
          c.parts.forEach(function(part) {
            if (!ok2) return;
            var rr = part.firstAuthor ? resolveAuthorOnly(part.firstAuthor) : { status: 'nomatch' };
            if (rr.status === 'ok') { refs2.push(rr.ref); pages2.push(part.page); } else ok2 = false;
          });
          if (ok2 && refs2.length > 0) {
            refs2.forEach(register);
            replacement = renderForTarget(refs2, sourceStyleId, targetStyleId, 'parenthetical', { pages: pages2 }, numberOf, null);
            matched = true;
          } else {
            note = mismatchNote + 'Salah satu atau lebih sitasi dalam grup ini tidak cocok dengan referensi — seluruh grup tidak diubah.';
          }
        }
      } else { // numeric
        start = c.position; raw = c.raw; end = start + raw.length;
        var numRes = resolveNumbers(c.numbers);
        if (numRes.status === 'ok') {
          numRes.refs.forEach(register);
          // Single-number citation immediately preceded by a name already written in the
          // prose ("Chan and Hu [7]") converting to an author-date target: don't duplicate
          // that name — emit a year-only parenthetical instead (see precedingNarrativeName).
          var targetFamily = STYLES[targetStyleId].family;
          var narrativeName = c.numbers.length === 1 && targetFamily === 'author-date'
            ? precedingNarrativeName(articleText, c.position) : null;
          if (narrativeName) {
            replacement = '(' + (numRes.refs[0].year || 'n.d.') + ')';
          } else {
            replacement = renderForTarget(numRes.refs, sourceStyleId, targetStyleId, 'parenthetical', {}, numberOf, null);
          }
          matched = true;
        } else {
          note = mismatchNote + 'Nomor referensi ' + c.numbers.join(',') + ' tidak ditemukan di daftar referensi — tidak diubah.';
        }
      }

      if (start == null) return;
      var accepted = matched && start >= lastAcceptedEnd;
      if (matched && start < lastAcceptedEnd) { matched = false; note = 'Tumpang tindih dengan sitasi lain yang sudah diproses — dilewati.'; }
      spans.push({ start: start, end: end, raw: raw, replacement: matched ? replacement : raw, matched: matched, note: note, crossFamily: crossFamily, family: family });
      if (matched) lastAcceptedEnd = Math.max(lastAcceptedEnd, end);
    });

    // Build converted article text
    var sortedSpans = spans.slice().sort(function(a, b) { return a.start - b.start; });
    var out = '', cursor = 0;
    sortedSpans.forEach(function(s) {
      if (s.start < cursor) return; // guard against any residual overlap
      out += articleText.slice(cursor, s.start) + s.replacement;
      cursor = s.end;
    });
    out += articleText.slice(cursor);

    var changedCount = spans.filter(function(s) { return s.matched && s.raw !== s.replacement; }).length;
    var unmatchedList = spans.filter(function(s) { return !s.matched; }).map(function(s) {
      return { raw: s.raw, note: s.note, family: s.family, crossFamily: s.crossFamily };
    });
    // Mixed-style reporting: how many stray citations were found that were ALREADY written in
    // a different family than the declared source style — split into those we could still
    // auto-fix (resolved + converted despite not matching the primary family) vs. those left
    // for manual attention (same as their entry in `unmatched`, just isolated for a clearer
    // "your document had mixed styles" summary in the UI).
    var mixedStyleFound = spans.filter(function(s) { return s.crossFamily; });
    var mixedStyleFixed = mixedStyleFound.filter(function(s) { return s.matched; }).length;
    var mixedStyleUnresolved = mixedStyleFound.filter(function(s) { return !s.matched; }).length;
    // Full ordered span list (matched + unmatched) with original article-text coordinates —
    // used by the UI to render an inline before/after preview (e.g. <mark> around each span).
    var citationSpans = sortedSpans.map(function(s) {
      return { start: s.start, end: s.end, original: s.raw, replacement: s.replacement, matched: s.matched, note: s.note };
    });

    // ---------- Reference list: renumber/reorder + rebuild author segment only ----------
    var targetStyle = STYLES[targetStyleId];
    var orderedRefs;
    var uncitedRefs = v.references.filter(function(r) { return matchedOrder.indexOf(r) === -1; });
    if (targetStyle.refOrder === 'citation-order') {
      orderedRefs = matchedOrder.concat(uncitedRefs);
    } else {
      orderedRefs = v.references.slice().sort(function(a, b) {
        var ka = (a.isInstitutional ? v.resolveInstitutionalName(a.firstAuthor) : CE.surnameOf(a.firstAuthor, sourceStyleId)) || '';
        var kb = (b.isInstitutional ? v.resolveInstitutionalName(b.firstAuthor) : CE.surnameOf(b.firstAuthor, sourceStyleId)) || '';
        ka = ka.toLowerCase().replace(/^(the|a|an)\s+/i, ''); kb = kb.toLowerCase().replace(/^(the|a|an)\s+/i, '');
        if (ka < kb) return -1; if (ka > kb) return 1;
        return (a.year || '').localeCompare(b.year || '');
      });
    }

    var referenceLines = orderedRefs.map(function(ref, idx) {
      var authorPart = renderAuthorListForReference(ref, sourceStyleId, targetStyleId);
      var trimmedRaw = ref.raw.trim();
      var boundary = findAuthorSegBoundary(ref.raw, sourceStyleId);
      var rest, connector;
      if (boundary != null) {
        connector = connectorBeforeBoundary(trimmedRaw, boundary);
        rest = trimmedRaw.substring(boundary);
      } else { rest = ''; connector = ''; }
      var prefix = '';
      if (targetStyle.family === 'numeric') prefix = targetStyle.refPrefix === 'bracket' ? '[' + (idx + 1) + '] ' : (idx + 1) + '. ';
      var line = prefix + authorPart + connector + rest;
      return { line: line, wasCited: matchedOrder.indexOf(ref) !== -1, numLabel: targetStyle.family === 'numeric' ? idx + 1 : null, original: ref.raw };
    });

    return {
      sourceStyleId: sourceStyleId, targetStyleId: targetStyleId,
      convertedArticle: out,
      changedCount: changedCount,
      totalCitationsFound: spans.length,
      unmatched: unmatchedList,
      citationSpans: citationSpans,
      referenceLines: referenceLines,
      uncitedCount: uncitedRefs.length,
      parseStats: v.parseStats,
      mixedStyleFoundCount: mixedStyleFound.length,
      mixedStyleFixedCount: mixedStyleFixed,
      mixedStyleUnresolvedCount: mixedStyleUnresolved,
    };
  }

  function renderAuthorListForReference(ref, sourceStyleId, targetStyleId) {
    var style = STYLES[targetStyleId];
    if (ref.isInstitutional) return ref.firstAuthor;
    var canon = canonicalAuthorsFromRef(ref, sourceStyleId);
    var n = canon.length;
    if (targetStyleId === 'apa7' && n > 20) { // APA7: first 19, ellipsis, last author
      var head = canon.slice(0, 19).map(function(a, i) { return renderAuthorForStyle(a.last, a.given, targetStyleId, i === 0 ? 'first' : 'other'); });
      var lastA = canon[n - 1];
      return head.join(', ') + ', . . . ' + renderAuthorForStyle(lastA.last, lastA.given, targetStyleId, 'other');
    }
    // The SOURCE reference itself may already be a truncated "et al." list (e.g. IEEE's "A. R.
    // Malik et al."). canonicalAuthorsFromRef strips that marker fragment out (it's not a real
    // name), so `canon` only holds the names that were actually spelled out — but we still need
    // to carry the "there were more" signal through to the rendered line, or a 1-name truncated
    // source silently turns into what looks like a genuine single-author work.
    var sourceTruncated = (ref.authors || []).length > 0 && isEtAlFragment(ref.authors[ref.authors.length - 1]);
    var threshold = style.refListFullUpTo;
    var list = canon, truncated = sourceTruncated;
    if (threshold && n > threshold) { list = canon.slice(0, threshold); truncated = true; }
    var rendered = list.map(function(a, i) { return renderAuthorForStyle(a.last, a.given, targetStyleId, i === 0 ? 'first' : 'other'); });
    if (truncated) return rendered.join(', ') + ', et al.';
    if (rendered.length === 1) return rendered[0];
    if (style.family === 'numeric') {
      return rendered.length === 2 ? rendered[0] + ' and ' + rendered[1] : rendered.slice(0, -1).join(', ') + ', and ' + rendered[rendered.length - 1];
    }
    var sep = style.sep === '&' ? '&' : 'and';
    return rendered.length === 2 ? rendered[0] + ' ' + sep + ' ' + rendered[1] : rendered.slice(0, -1).join(', ') + ', ' + sep + ' ' + rendered[rendered.length - 1];
  }

  // Recovers the exact original connector (whitespace/comma) that sat between the end of the
  // author segment and `boundary` in the source text, so re-joining our newly rendered author
  // list to the untouched "rest" of the line reproduces the source's own punctuation instead
  // of guessing a comma or period that might not match (e.g. APA has a bare space before the
  // year-parenthesis; IEEE has ", " before the opening quote).
  function connectorBeforeBoundary(text, boundary) {
    var start = boundary;
    while (start > 0 && /[\s,]/.test(text[start - 1])) start--;
    return text.substring(start, boundary);
  }

  // Finds where the author segment ends in a raw reference line, for a given style — mirrors
  // the same boundary logic engine.js's parseReferenceLine already uses internally, so the
  // "rest of the line" we preserve verbatim is exactly what parseReferenceLine considers
  // non-author content (title onward).
  function findAuthorSegBoundary(raw, styleId) {
    var style = STYLES[styleId];
    var text = (raw || '').trim();
    if (style.family === 'numeric') {
      var t = text, prefixLen = 0;
      if (style.refPrefix === 'bracket') { var bm = t.match(/^\[(\d+)\]\s*/); if (bm) { prefixLen = bm[0].length; t = t.slice(bm[0].length); } }
      else if (style.refPrefix === 'dot') { var dm = t.match(/^(\d+)\.\s*/); if (dm) { prefixLen = dm[0].length; t = t.slice(dm[0].length); } }
      var authorLen;
      if (style.authorForm === 'non-inverted') {
        var qIdx = t.search(/["“]/);
        authorLen = qIdx > -1 ? qIdx : Math.min(t.length, t.indexOf('.') + 1 || t.length);
      } else {
        var fp = t.indexOf('. ');
        authorLen = fp > -1 ? fp : t.length;
      }
      return prefixLen + authorLen;
    }
    if (style.yearInParens === false) {
      var ym = text.match(/^(.*?)\.\s*\d{4}[a-z]?\.\s/);
      if (ym) return ym[1].length;
    }
    var yearMatch = text.match(/\((\d{4}[a-z]?|n\.d\.)\)/);
    if (yearMatch) return yearMatch.index;
    var dq = text.match(/["“]/);
    if (dq) return dq.index;
    return text.length;
  }

  var CitationConverter = {
    convert: convert,
    STYLES: STYLES,
    _internal: { // exposed for tests
      splitAuthorFragment: splitAuthorFragment,
      renderAuthorForStyle: renderAuthorForStyle,
      compressRanges: compressRanges,
      formatNumeric: formatNumeric,
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CitationConverter;
  if (typeof window !== 'undefined') window.CitationConverter = CitationConverter;
  else if (typeof self !== 'undefined') self.CitationConverter = CitationConverter;
})();
