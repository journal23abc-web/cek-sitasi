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

  function renderGivenAsInitials(givenTokens) {
    return givenTokens.map(function(t) {
      var c = (t || '').replace(/\./g, '').trim();
      return c ? c.charAt(0).toUpperCase() + '.' : '';
    }).filter(Boolean).join(' ');
  }
  // Keeps full-name tokens as-is (only normalizes bare initials to "X."); used for styles
  // whose convention is a full given name (Chicago, MLA) so we don't downgrade information
  // the source actually had.
  function renderGivenNatural(givenTokens) {
    return givenTokens.map(function(t) {
      if (isInitialToken(t)) { var c = t.replace(/\./g, ''); return c ? c.toUpperCase() + '.' : ''; }
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
        var block = givenTokens.map(function(t) {
          var c = (t || '').replace(/\./g, '');
          return c ? c.charAt(0).toUpperCase() : '';
        }).join('');
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
  // e.g. [1,2,3,5] -> ["1-3","5"]. Used so consecutive citation runs collapse into a range
  // instead of listing every number, matching standard numeric-citation editorial practice.
  function compressRanges(nums) {
    var sorted = nums.slice().sort(function(a, b) { return a - b; });
    var out = [], i = 0;
    while (i < sorted.length) {
      var start = sorted[i], end = start;
      while (i + 1 < sorted.length && sorted[i + 1] === end + 1) { end = sorted[i + 1]; i++; }
      out.push(start === end ? String(start) : (start + '-' + end));
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

  function convert(articleText, referenceText, sourceStyleId, targetStyleId) {
    if (!STYLES[sourceStyleId]) throw new Error('Gaya sumber tidak dikenal: ' + sourceStyleId);
    if (!STYLES[targetStyleId]) throw new Error('Gaya tujuan tidak dikenal: ' + targetStyleId);
    articleText = articleText || '';
    referenceText = referenceText || '';

    var sourceStyle = STYLES[sourceStyleId];
    var v = new CE.MultiFormatValidator(articleText, referenceText, sourceStyleId);
    v.validate(); // populates v.references, v.citations, v.refMap (author-date/page), v.acronymMap

    var refByNumber = {};
    if (sourceStyle.family === 'numeric') {
      v.references.forEach(function(r) { if (r.numLabel != null) refByNumber[r.numLabel] = r; });
    }

    var matchedOrder = [];
    var seen = new Set();
    function register(ref) { if (!seen.has(ref)) { seen.add(ref); matchedOrder.push(ref); } }
    function numberOf(ref) { register(ref); return matchedOrder.indexOf(ref) + 1; }

    function resolveAuthorYear(token, year) {
      if (!v.refMap) return { status: 'nomatch' };
      var key = v.keyFromCitationToken(token) + '_' + year;
      if (v.refMap.has(key)) {
        var refs = v.refMap.get(key);
        return refs.length === 1 ? { status: 'ok', ref: refs[0] } : { status: 'ambiguous', candidates: refs };
      }
      var fuzzy = v.fuzzyFind(key, v.refMap);
      return fuzzy ? { status: 'ok', ref: fuzzy } : { status: 'nomatch' };
    }
    function resolveAuthorOnly(token) { // MLA (no year)
      if (!v.refMap) return { status: 'nomatch' };
      var key = v.keyFromCitationToken(token);
      if (v.refMap.has(key)) {
        var refs = v.refMap.get(key);
        return refs.length === 1 ? { status: 'ok', ref: refs[0] } : { status: 'ambiguous', candidates: refs };
      }
      var fuzzy = v.fuzzyFind(key, v.refMap);
      return fuzzy ? { status: 'ok', ref: fuzzy } : { status: 'nomatch' };
    }

    // Sort citations by position — extractAuthorDateCitations returns ALL parenthetical
    // matches first, THEN all narrative matches, so the combined array is not naturally in
    // reading order even though each sub-pass is. Numeric/author-page extraction is already
    // single-pass and in order, but sorting is harmless there too.
    var citations = v.citations.slice().sort(function(a, b) { return a.position - b.position; });

    var spans = []; // {start,end,replacement,matched,note,originalRaw}
    var lastAcceptedEnd = -1;

    citations.forEach(function(c) {
      var start, end, raw, replacement = null, matched = false, note = null;

      if (sourceStyle.family === 'author-date') {
        if (c.type === 'parenthetical') {
          start = c.position; raw = c.raw; end = start + raw.length;
          if (c.parts.length === 1) {
            var p = c.parts[0];
            var res = p.firstAuthor ? resolveAuthorYear(p.firstAuthor, p.year) : { status: 'nomatch' };
            if (res.status === 'ok') {
              register(res.ref);
              var pg = normalizePageInfo(p.pageInfo);
              replacement = renderForTarget([res.ref], sourceStyleId, targetStyleId, 'parenthetical', { pageInfo: pg, page: pg }, numberOf, null);
              matched = true;
            } else {
              note = res.status === 'ambiguous' ? 'Sitasi ambigu (beberapa referensi cocok) — tidak diubah, cek manual.' : 'Tidak ditemukan referensi yang cocok — tidak diubah.';
            }
          } else {
            var refs = [], ok = true;
            c.parts.forEach(function(part) {
              if (!ok) return;
              var r = part.firstAuthor ? resolveAuthorYear(part.firstAuthor, part.year) : { status: 'nomatch' };
              if (r.status === 'ok') refs.push(r.ref); else ok = false;
            });
            if (ok && refs.length > 0) {
              refs.forEach(register);
              replacement = renderForTarget(refs, sourceStyleId, targetStyleId, 'parenthetical', {}, numberOf, null);
              matched = true;
            } else {
              note = 'Salah satu atau lebih sitasi dalam grup ini tidak cocok dengan referensi — seluruh grup tidak diubah.';
            }
          }
        } else { // narrative
          var span = computeNarrativeSpan(articleText, c.position, c.year);
          if (!span) { note = 'Span sitasi naratif tidak terverifikasi — tidak diubah.'; start = c.position; end = c.position; raw = ''; }
          else {
            start = span.start; end = span.end; raw = span.raw;
            var cleanAuthors = c.authors.replace(/\s*et\s+al\.?/i, '');
            var authorsArr = CE.splitOnSeparators(cleanAuthors);
            var res2 = authorsArr.length ? resolveAuthorYear(authorsArr[0], c.year) : { status: 'nomatch' };
            if (res2.status === 'ok') {
              register(res2.ref);
              replacement = renderForTarget([res2.ref], sourceStyleId, targetStyleId, 'narrative', {}, numberOf, c.authors);
              matched = true;
            } else {
              note = res2.status === 'ambiguous' ? 'Sitasi ambigu — tidak diubah, cek manual.' : 'Tidak ditemukan referensi yang cocok — tidak diubah.';
            }
          }
        }
      } else if (sourceStyle.family === 'author-page') {
        start = c.position; raw = c.raw; end = start + raw.length;
        if (c.parts.length === 1) {
          var pp = c.parts[0];
          var r3 = pp.firstAuthor ? resolveAuthorOnly(pp.firstAuthor) : { status: 'nomatch' };
          if (r3.status === 'ok') {
            register(r3.ref);
            replacement = renderForTarget([r3.ref], sourceStyleId, targetStyleId, 'parenthetical', { page: pp.page, pageInfo: pp.page }, numberOf, null);
            matched = true;
          } else {
            note = r3.status === 'ambiguous' ? 'Sitasi ambigu — tidak diubah, cek manual.' : 'Tidak ditemukan referensi yang cocok — tidak diubah.';
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
            note = 'Salah satu atau lebih sitasi dalam grup ini tidak cocok dengan referensi — seluruh grup tidak diubah.';
          }
        }
      } else { // numeric source
        start = c.position; raw = c.raw; end = start + raw.length;
        var refsN = c.numbers.map(function(n) { return refByNumber[n]; });
        if (refsN.every(Boolean) && refsN.length > 0) {
          refsN.forEach(register);
          replacement = renderForTarget(refsN, sourceStyleId, targetStyleId, 'parenthetical', {}, numberOf, null);
          matched = true;
        } else {
          note = 'Nomor referensi ' + c.numbers.join(',') + ' tidak ditemukan di daftar referensi — tidak diubah.';
        }
      }

      if (start == null) return;
      var accepted = matched && start >= lastAcceptedEnd;
      if (matched && start < lastAcceptedEnd) { matched = false; note = 'Tumpang tindih dengan sitasi lain yang sudah diproses — dilewati.'; }
      spans.push({ start: start, end: end, raw: raw, replacement: matched ? replacement : raw, matched: matched, note: note });
      if (matched) lastAcceptedEnd = Math.max(lastAcceptedEnd, end);
    });

    // Build converted article text
    var out = '', cursor = 0;
    spans.slice().sort(function(a, b) { return a.start - b.start; }).forEach(function(s) {
      if (s.start < cursor) return; // guard against any residual overlap
      out += articleText.slice(cursor, s.start) + s.replacement;
      cursor = s.end;
    });
    out += articleText.slice(cursor);

    var changedCount = spans.filter(function(s) { return s.matched && s.raw !== s.replacement; }).length;
    var unmatchedList = spans.filter(function(s) { return !s.matched; }).map(function(s) {
      return { raw: s.raw, note: s.note };
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
      referenceLines: referenceLines,
      uncitedCount: uncitedRefs.length,
      parseStats: v.parseStats,
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
    var threshold = style.refListFullUpTo;
    var list = canon, truncated = false;
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
