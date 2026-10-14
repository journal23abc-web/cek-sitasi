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
//  - APA 7 / IEEE memakai model bibliografi yang sama untuk teks dan ekspor Word, termasuk
//    tahun, judul, volume, issue, locator, DOI, serta rentang cetak miring. Struktur yang
//    tidak dikenali diberi peringatan. Metadata lengkap tetap tersedia ketika IEEE menyingkat
//    penulis, sehingga konversi balik tidak mengarang nama yang sudah hilang dari tampilan.

(function() {
  function loadEngine() {
    if (typeof module !== 'undefined' && module.exports) return require('./engine.js');
    if (typeof window !== 'undefined' && window.CitationEngine) return window.CitationEngine;
    if (typeof self !== 'undefined' && self.CitationEngine) return self.CitationEngine;
    throw new Error('CitationEngine (engine.js) belum dimuat — converter-engine.js butuh itu.');
  }
  var CE = loadEngine();
  var STYLES = CE.STYLES;
  var BE = typeof module !== 'undefined' && module.exports ? require('./bibliography-engine.js') : (typeof window !== 'undefined' ? window : self).BibliographyEngine;
  if (!BE) throw new Error('bibliography-engine.js belum dimuat.');

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
      var initialPrefix = s.match(/^((?:(?:\p{Lu}\.(?:-\p{Lu}\.)?)\s*)+)\s+(.+)$/u);
      if (initialPrefix) return { last: initialPrefix[2], given: initialPrefix[1].trim().split(/\s+/) };
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
    if (/^(?:\p{Lu}\.){2,}$/u.test(raw)) return raw.match(/\p{Lu}/gu).map(function(c) { return c + '.'; }).join(' ');
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
    if (ref.bibliography) return ref.bibliography.authors;
    if (ref.isInstitutional) return (ref.authors || [ref.firstAuthor]).map(function(name) { return { last: name, given: [], institutional: true }; });
    // Use THIS reference's own actual format (ref.styleId) when known, not necessarily the
    // style declared for the whole list — a single entry can be written in a different style
    // than its neighbors (see looksLikeEmbeddedAuthorDateReference in engine.js: an "et al."
    // list occasionally has one reference pasted straight from an APA-formatted source, still
    // inverted "Last, F. M." rather than the list's own declared non-inverted "F. M. Last").
    // Interpreting ref.authors with the wrong convention reads the surname off the wrong end of
    // the name entirely.
    var effectiveStyleId = ref.styleId || sourceStyleId;
    return (ref.authors || []).filter(function(a) { return !isEtAlFragment(a); }).map(function(a) {
      var sp = splitAuthorFragment(a, effectiveStyleId);
      return { last: sp.last, given: sp.given, institutional: false };
    });
  }

  function surnamesFromRef(ref, sourceStyleId) {
    if (ref.bibliography) return ref.bibliography.authors.map(function(a) { return a.last; });
    if (ref.isInstitutional) return [ref.firstAuthor];
    var effectiveStyleId = ref.styleId || sourceStyleId;
    return (ref.authors || []).filter(function(a) { return !isEtAlFragment(a); }).map(function(a) { return CE.surnameOf(a, effectiveStyleId); });
  }

  // ---------- IN-TEXT RENDERING ----------
  function joinList(names, sep) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' ' + sep + ' ' + names[1];
    return names.slice(0, -1).join(', ') + ', ' + sep + ' ' + names[names.length - 1];
  }

  // The surname string shown in-text for one reference in an author-date/author-page target,
  // respecting that style's et-al threshold (APA/Harvard: 3+, Chicago: 4+, MLA: 3+).
  function inTextDisplayName(ref, sourceStyleId, targetStyleId, mode) {
    var style = STYLES[targetStyleId];
    var surnames = surnamesFromRef(ref, sourceStyleId);
    var count = ref.authorCount || surnames.length;
    var threshold = style.etAlThreshold || 3;
    if (count >= threshold) return (surnames[0] || ref.firstAuthor || '?') + ' et al.';
    var sep = style.sep === '&' && mode !== 'narrative' ? '&' : 'and';
    return joinList(surnames.slice(0, Math.max(1, Math.min(surnames.length, count))), sep);
  }

  function formatLocator(value, targetStyleId) {
    var s = String(value || '').trim().replace(/^pp?\.\s*/i, '');
    var labels = [ [/^(?:Ch\.|Chapter)\s+/i, 'Chapter ', 'Ch. '], [/^(?:Sect\.|Section)\s+/i, 'Section ', 'Sect. '], [/^(?:Fig\.|Figure)\s+/i, 'Figure ', 'Fig. '] ];
    for (var i = 0; i < labels.length; i++) if (labels[i][0].test(s)) return s.replace(labels[i][0], labels[i][targetStyleId === 'ieee' ? 2 : 1]);
    if (/^(?:[A-Za-z]?\d+|[ivxlcdm]+)(?:\s*[–-]\s*(?:[A-Za-z]?\d+|[ivxlcdm]+))?$/i.test(s)) return (/[–-]/.test(s) ? 'pp. ' : 'p. ') + s;
    return s; // e.g. para. 2, timestamps, or a named section; never fabricate a page prefix.
  }

  function formatAuthorDateSingle(ref, sourceStyleId, targetStyleId, mode, pageInfo) {
    if (targetStyleId === 'apa7' && !ref.isInstitutional && ref.apaPlan) {
      var planned = CE.formatApa7CitationForReference(ref, ref.styleId || sourceStyleId, ref.apaPlan, mode === 'narrative', pageInfo ? formatLocator(pageInfo, targetStyleId) : null);
      if (mode === 'narrative' && pageInfo) planned = planned.replace(/\)$/, ', ' + formatLocator(pageInfo, targetStyleId) + ')');
      return planned;
    }
    var name = inTextDisplayName(ref, sourceStyleId, targetStyleId, mode);
    var year = ref.citationYear || ref.year || 'n.d.';
    var isChicago = targetStyleId === 'chicago';
    if (mode === 'narrative') {
      var tailN = pageInfo ? ', ' + (targetStyleId === 'apa7' ? (/[-–]/.test(pageInfo) ? 'pp. ' : 'p. ') : '') + pageInfo : '';
      return name + ' (' + year + tailN + ')';
    }
    if (isChicago) { // Chicago author-date parenthetical: (Author Year, page) — no comma before year
      var tailC = pageInfo ? ', ' + pageInfo : '';
      return '(' + name + ' ' + year + tailC + ')';
    }
    var tail = pageInfo ? ', ' + formatLocator(pageInfo, targetStyleId) : '';
    return '(' + name + ', ' + year + tail + ')';
  }

  function formatAuthorDateGroup(refs, sourceStyleId, targetStyleId, pages) {
    var isChicago = targetStyleId === 'chicago';
    var items = refs.map(function(ref, index) {
      var name = inTextDisplayName(ref, sourceStyleId, targetStyleId, 'parenthetical');
      var year = ref.citationYear || ref.year || 'n.d.';
      var sortKey = (surnamesFromRef(ref, sourceStyleId)[0] || ref.firstAuthor || '').toLowerCase();
      return { sortKey: sortKey + '\u0000' + year, text: targetStyleId === 'apa7' ? formatAuthorDateSingle(ref, sourceStyleId, targetStyleId, 'parenthetical', pages && pages[index]).slice(1, -1) : isChicago ? (name + ' ' + year) : (name + ', ' + year) };
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

  // Compresses Vancouver numeric groups. IEEE uses every individual bracket number
  // under the 2025 Reference Guide, so its renderer does not call this helper.
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
    nums = Array.from(new Set(nums));
    if (targetStyleId === 'ieee') {
      // IEEE Reference Guide, 2025: write every number, including former ranges.
      return nums.slice().sort(function(a, b) { return a - b; }).map(function(n) { return '[' + n + ']'; }).join(', ');
    }
    var groups = compressRanges(nums);
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
      if (mode === 'narrative' && refs.length > 1) return inTextDisplayName(refs[0], sourceStyleId, targetStyleId, 'narrative') + ' (' + refs.map(function(r) { return r.citationYear || r.year || 'n.d.'; }).join(', ') + ')';
      if (mode === 'narrative') return formatAuthorDateSingle(refs[0], sourceStyleId, targetStyleId, 'narrative', extra.pageInfo);
      if (refs.length === 1) return formatAuthorDateSingle(refs[0], sourceStyleId, targetStyleId, 'parenthetical', extra.pageInfo);
      return formatAuthorDateGroup(refs, sourceStyleId, targetStyleId, extra.pages);
    }
    if (family === 'author-page') {
      if (mode === 'narrative') return formatAuthorPageSingle(refs[0], sourceStyleId, 'narrative', extra.page);
      if (refs.length === 1) return formatAuthorPageSingle(refs[0], sourceStyleId, 'parenthetical', extra.page);
      return formatAuthorPageGroup(refs, sourceStyleId, extra.pages);
    }
    // numeric target
    var nums = refs.map(numberOf);
    if (extra.pages && extra.pages.some(Boolean) && targetStyleId === 'ieee') return nums.map(function(n, i) { return { number: n, page: extra.pages[i] }; }).sort(function(a, b) { return a.number - b.number; }).map(function(x) { return '[' + x.number + (x.page ? ', ' + formatLocator(x.page, targetStyleId) : '') + ']'; }).join(', ');
    var numericText = extra.pageInfo && targetStyleId === 'ieee' && nums.length === 1
      ? '[' + nums[0] + ', ' + formatLocator(extra.pageInfo, targetStyleId) + ']'
      : formatNumeric(nums, targetStyleId);
    if (mode === 'narrative' && literalNarrativeAuthors) {
      return inTextDisplayName(refs[0], sourceStyleId, targetStyleId, 'narrative') + ' ' + numericText;
    }
    return numericText;
  }

  // Finds the true end of a narrative "Author (Year...)" match in the ORIGINAL article text.
  // engine.js's own `raw` for narrative citations is a re-assembled string (authors + ' (' +
  // year + ')') that can drift from the literal source text (extra spacing, page info inside
  // the parens, etc.) — so for safe in-place replacement we re-locate the real "(" ... ")"
  // span starting at the citation's reported position instead of trusting the reassembled raw.
  function computeNarrativeSpan(text, position, expectedYear) {
    var openIdx = text.indexOf('(', position);
    if (openIdx === -1 || openIdx - position > 250) return null;
    var closeIdx = -1, depth = 0;
    for (var i = openIdx; i < text.length; i++) {
      if (text[i] === '(') depth++;
      if (text[i] === ')' && --depth === 0) { closeIdx = i; break; }
    }
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

  // ---- Full-reference-body parsing (for a genuine APA7 bibliographic reformat, not just the
  // author-name swap the rest of this file limits itself to) ----------------------------------
  //
  // These two are pure, DOM-free functions so they're unit-testable on their own; the DOM side
  // (building italic runs for the docx export) lives in convert-ui.js, which has the actual XML
  // and can tell which part of a reference was already italicized (the journal/book title) —
  // these just need to be handed the plain-text "tail" that comes after that italic run.

  // Extracts volume/issue/pages/doi from the text that trails a numeric (IEEE/Vancouver)
  // reference's italicized journal-name segment, e.g. ", vol. 16, no. 1, p. 39, 2019. doi:
  // 10.1186/s41239-019-0171-0." Deliberately independent of extractBibliographicFields (engine.js)
  // — that function has known gaps here (e.g. a conference reference with no "vol." prefix at
  // all, see converter-engine.test.js), and a full reference-list rewrite needs this to be right.
  function parseNumericReferenceTail(text) {
    var t = text || '';
    var doiMatch = t.match(/doi:\s*(\S+?)\.?\s*$/i);
    var volMatch = t.match(/vol\.\s*(\d+)/i);
    var issueMatch = t.match(/no\.\s*(\d+)/i);
    var pagesMatch = t.match(/pp?\.\s*(\d+)(?:[-\u2013](\d+))?/i);
    return {
      volume: volMatch ? volMatch[1] : null,
      issue: issueMatch ? issueMatch[1] : null,
      pages: pagesMatch ? (pagesMatch[1] + (pagesMatch[2] ? ('\u2013' + pagesMatch[2]) : '')) : null,
      doi: doiMatch ? doiMatch[1] : null,
    };
  }

  // Derives a book's publisher name from the text trailing its (italicized) title, e.g.
  // ". London, U.K.: Pearson, 2016." -> "Pearson". IEEE book references conventionally end
  // "City, Country: Publisher, Year." — APA7 no longer requires the location, just the
  // publisher. The actual implementation now lives in engine.js (CE.deriveBookPublisher) since
  // extractBibliographicFields' book-chapter-with-editor detection needs it too; kept as a thin
  // delegate here so existing callers of this local name (and CC._internal.deriveBookPublisher,
  // which convert-ui.js and tests already use) don't need to change.
  function deriveBookPublisher(tailText, year) {
    return CE.deriveBookPublisher(tailText, year);
  }

  // ---- Completing a source reference that's already truncated with "et al." -----------------
  //
  // An incomplete author list is valid in some styles (including IEEE), but cannot supply
  // the full author list required by APA 7 — APA7 in particular requires every author be spelled out,
  // up to 20, with only 21+ authors getting the "first 19, . . . , last author" ellipsis form.
  // When the SOURCE manuscript already truncated a reference that way ("A. R. Malik et al."),
  // this file has never had the missing names to work with — it correctly refuses to invent
  // them, but that leaves the converted output non-compliant through no fault of the citation
  // style conversion itself. If the reference has a DOI, CrossRef usually does have the full
  // list, so this looks it up — opt-in and reported back for the caller to review, never
  // silently applied, matching how DOIChecker.searchByMetadata already handles "never write a
  // DOI in automatically" elsewhere in this codebase.

  // Formats a CrossRef {family, given}[] author list as plain text in the SOURCE style's own
  // shape (e.g. non-inverted "F. M. Last" for IEEE), so the result can be substituted straight
  // back into the reference text and re-parsed by the normal pipeline — no special-casing needed
  // anywhere else once this text is in place.
  function formatCrossRefAuthorsForSourceStyle(crAuthors, sourceStyleId) {
    var style = STYLES[sourceStyleId];
    function initials(given) {
      return (given || '').split(/[\s.\-]+/).filter(Boolean)
        .map(function(p) { return p[0].toUpperCase() + '.'; }).join(' ');
    }
    var pieces = crAuthors.map(function(a) {
      var init = initials(a.given);
      if (style.authorForm === 'vancouver') {
        var initLetters = (a.given || '').split(/[\s.\-]+/).filter(Boolean).map(function(p) { return p[0].toUpperCase(); }).join('');
        return a.family + (initLetters ? ' ' + initLetters : '');
      }
      if (style.authorForm === 'non-inverted') return (init ? init + ' ' : '') + a.family;
      return a.family + (init ? ', ' + init : ''); // inverted styles: "Last, F. M."
    });
    if (pieces.length === 1) return pieces[0];
    var sep = style.sep === '&' ? '&' : 'and';
    if (pieces.length === 2) return pieces[0] + ' ' + sep + ' ' + pieces[1];
    return pieces.slice(0, -1).join(', ') + ', ' + sep + ' ' + pieces[pieces.length - 1];
  }

  // Pure decision logic (no network) — kept separate from the fetch itself so it's directly
  // unit-testable: given a parsed reference and an already-fetched CrossRef result, decide
  // whether completing it is warranted, and build the replacement text if so.
  function evaluateAuthorCompletion(ref, crossRefResult, sourceStyleId) {
    var authors = ref.authors || [];
    var lastIsEtAl = authors.length > 0 && isEtAlFragment(authors[authors.length - 1]);
    if (!lastIsEtAl) return { eligible: false, reason: 'not-truncated' };
    if (!ref.doi) return { eligible: false, reason: 'no-doi' };
    if (!crossRefResult || crossRefResult.status !== 'ok' || !crossRefResult.authors || crossRefResult.authors.length === 0) {
      return { eligible: false, reason: 'crossref-lookup-failed' };
    }
    var realAuthorsListed = authors.length - 1; // minus the "et al." marker itself
    if (crossRefResult.authors.length <= realAuthorsListed) {
      return { eligible: false, reason: 'crossref-not-more-complete' };
    }
    if (ref.title && crossRefResult.title) {
      var sim = CE.bigramSimilarity(ref.title, crossRefResult.title);
      if (sim < 0.6) return { eligible: false, reason: 'title-mismatch', similarity: Math.round(sim * 100) };
    }
    return {
      eligible: true,
      replacementAuthorText: formatCrossRefAuthorsForSourceStyle(crossRefResult.authors, sourceStyleId),
      authorCount: crossRefResult.authors.length,
    };
  }

  // The async orchestrator: finds every "et al."-truncated, DOI-bearing reference in
  // referenceText, looks each one up, and returns a report plus an updatedReferenceText with the
  // eligible ones substituted in — which the caller can review and then hand to convert() as
  // normal, exactly as if the source manuscript had listed the full names to begin with. Never
  // mutates anything on its own; the caller decides whether/when to use updatedReferenceText.
  //
  // Each completed entry carries BOTH numLabel and raw — a caller matching entries back to a
  // reference it re-parses on its own (e.g. to feed a completed author list into a per-reference
  // rewrite) should key off raw, not numLabel: numLabel only survives on a reference parsed as
  // part of the FULL list (parseReferenceListDetailed can infer it from list order when the
  // source never wrote "[N]" at all — see numberingInferred there); parsing that same reference's
  // text again in isolation has no such list context and numLabel comes back null, silently
  // breaking a numLabel-keyed lookup for exactly the documents that most need this feature.
  function completeTruncatedAuthorsAsync(referenceText, sourceStyleId) {
    var refs = CE.parseReferenceList(referenceText, sourceStyleId);
    var candidates = refs.filter(function(r) {
      var authors = r.authors || [];
      return authors.length > 0 && isEtAlFragment(authors[authors.length - 1]) && r.doi;
    });
    if (candidates.length === 0) {
      return Promise.resolve({ checked: 0, completed: [], skipped: [], updatedReferenceText: referenceText });
    }
    return Promise.all(candidates.map(function(ref) {
      return CE.DOIChecker.fetchAuthorList(ref.doi).then(function(crResult) {
        return { ref: ref, evalResult: evaluateAuthorCompletion(ref, crResult, sourceStyleId) };
      });
    })).then(function(results) {
      var completed = [], skipped = [];
      var updatedText = referenceText;
      results.forEach(function(r) {
        if (!r.evalResult.eligible) {
          skipped.push({ numLabel: r.ref.numLabel, reason: r.evalResult.reason, similarity: r.evalResult.similarity });
          return;
        }
        var m = r.ref.raw.match(/^(\[\d+\]\s*|\d+\.\s*)?(.*?\bet\s+al\.?)/i);
        if (!m) {
          skipped.push({ numLabel: r.ref.numLabel, reason: 'could-not-locate-truncation-in-raw-text' });
          return;
        }
        var truncatedAuthorSeg = m[2]; // excludes any "[N] "/"N. " numbering prefix — that must
        // survive untouched, since the citation-matching system keys off it.
        updatedText = updatedText.replace(truncatedAuthorSeg, r.evalResult.replacementAuthorText);
        completed.push({ numLabel: r.ref.numLabel, raw: r.ref.raw, before: truncatedAuthorSeg, after: r.evalResult.replacementAuthorText, authorCount: r.evalResult.authorCount });
      });
      return { checked: candidates.length, completed: completed, skipped: skipped, updatedReferenceText: updatedText };
    });
  }

  // Keep a complete, style-independent record. IEEE display truncation must never erase
  // authors from this record. DOCX exports persist these records, bound to the exact displayed
  // reference text; a changed entry cannot accidentally reuse stale metadata.
  function bibliographyFromRef(ref, sourceStyleId) {
    var effectiveStyle = ref.styleId || sourceStyleId;
    var authors = canonicalAuthorsFromRef(ref, effectiveStyle);
    var ellipsis = (ref.authors || []).some(isEllipsisTruncatedFragment);
    authors = authors.map(function(a) { return { last: a.last.replace(/^(?:\.\s*\.\s*\.|…)\s*/u, ''), given: a.given, institutional: a.institutional }; });
    var truncated = (ref.authors || []).some(isEtAlFragment);
    var model = {
      authors: authors, completeAuthors: !truncated && !ellipsis, ellipsis: ellipsis,
      authorCount: ellipsis ? Math.max(21, ref.authorCount || 0) : ref.authorCount,
      year: ref.year, title: ref.title, journal: ref.journal, volume: ref.volume,
      issue: ref.issue, pages: ref.pages, articleNumber: ref.articleNumber, doi: ref.doi,
      publisher: ref.publisher, editor: ref.editor, editorIsPlural: ref.editorIsPlural,
      type: ref.sourceType, isBookChapter: ref.isBookChapter || false,
      url: null, originalStyle: effectiveStyle,
      ambiguousLocator: false, publicationDate: null,
    };
    var url = ref.raw.match(/https?:\/\/[^\s]+/ig);
    if (url) model.url = url.filter(function(u) { return !/^https?:\/\/(?:dx\.)?doi\.org\//i.test(u); })[0] || null;
    // Scope the fallback to the source details, so numbers in an article title cannot become
    // volume/page fields. Handles ranges beginning at page 1, which the shared parser misses.
    var titleAt = ref.title ? ref.raw.indexOf(ref.title) : -1;
    var tail = titleAt >= 0 ? ref.raw.slice(titleAt + ref.title.length) : '';
    if (STYLES[effectiveStyle].family === 'author-date') {
      var suffix = tail.match(/,\s*(\d+)\s*(?:\(([^()]+)\))?\s*,\s*(Article\s+)?([A-Za-z]?\d+(?:\s*[-–]\s*\d+)?)\.?\s*(?:https?:\/\/\S+)?\s*$/i);
      if (suffix) {
        model.volume = suffix[1]; model.issue = suffix[2] || null;
        var locator = suffix[4].replace(/\s*[-–]\s*/g, '–');
        if (suffix[3] || /^e\d+/i.test(locator) || (!/[-–]/.test(locator) && locator.length >= 5)) {
          model.articleNumber = locator; model.pages = null;
        } else { model.pages = locator; model.articleNumber = null; model.ambiguousLocator = !/[-–]/.test(locator); }
      }
    }
    if (STYLES[effectiveStyle].family === 'numeric' && model.year) {
      var month = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
      var date = tail.split(/\bdoi\s*:|https?:\/\//i)[0].match(new RegExp('(?:^|,\\s*)(' + month + '(?:/' + month + ')?\\s+(?:\\d{1,2},\\s*)?' + model.year + ')(?=[.,\\s]|$)', 'i'));
      if (date) model.publicationDate = date[1];
    }
    if (model.pages) model.pages = model.pages.replace(/-/g, '–');
    return model;
  }

  function restoreBibliography(refs, metadata, sourceStyleId, details) {
    var entries = metadata && metadata.version === 1 && metadata.styleId === sourceStyleId && Array.isArray(metadata.entries) ? metadata.entries : [];
    var restored = 0;
    refs.forEach(function(ref) {
      var candidates = entries.filter(function(e) { return e.line === ref.raw && e.model && Array.isArray(e.model.authors) && (e.model.authors.length || e.model.noAuthor) && e.model.authors.every(function(a) { return typeof a.last === 'string' && Array.isArray(a.given) && a.given.every(function(g) { return typeof g === 'string'; }); }); });
      var entry = candidates.length === 1 ? candidates[0] : null;
      var extra = (details || []).filter(function(d) { return d.line === ref.raw; });
      ref.bibliography = BE.enrich(ref.raw, entry ? sourceStyleId : (ref.styleId || sourceStyleId), entry ? entry.model : bibliographyFromRef(ref, sourceStyleId), extra.length === 1 ? extra[0] : null, !!entry);
      if (entry) restored++;
      // Resolve citations against all the known names, including names suppressed in IEEE.
      ref.authors = ref.bibliography.authors.map(function(a, i) { return a.institutional ? a.last : renderAuthorForStyle(a.last, a.given, sourceStyleId, i ? 'other' : 'first'); });
      if (ref.bibliography.noAuthor) ref.authors = [ref.bibliography.title];
      ref.isInstitutional = ref.bibliography.noAuthor || ref.bibliography.authors.every(function(a) { return a.institutional; });
      ref.firstAuthor = ref.authors[0]; ref.styleId = sourceStyleId;
      ['title', 'journal', 'volume', 'issue', 'pages', 'articleNumber', 'publisher', 'editor', 'isBookChapter'].forEach(function(k) { ref[k] = ref.bibliography[k]; });
      ref.authorCount = Math.max(ref.bibliography.authorCount || 0, ref.authors.length);
      ref.year = ref.bibliography.originalYear ? ref.bibliography.originalYear + '/' + ref.bibliography.year : ref.bibliography.year;
    });
    return restored;
  }

  function renderBibliography(ref, targetStyleId, number) {
    var m = ref.bibliography;
    if (!m) return null;
    var authors = m.noAuthor ? '' : renderAuthorListForReference(ref, 'apa7', targetStyleId);
    return BE.render(m, targetStyleId, number, authors, ref.citationYear || m.year);
  }

  function extractNumericForConversion(text) {
    var items = CE.extractNumericCitations(text).filter(function(c) { return c.form === 'bracket'; });
    // A quoted page locator belongs to its reference, rather than a second reference number.
    var re = /\[(\d+)\s*,\s*((?:pp?\.|Ch\.|Sect\.|para\.|Fig\.|Table|Thm\.|Lemma|Algorithm|Appendix|eq\.)\s*[^\]\r\n]+|\d+:\d+(?::\d+)?)\]/g, match;
    while ((match = re.exec(text))) items.push({ raw: match[0], numbers: [+match[1]], position: match.index, form: 'bracket', pageInfo: normalizePageInfo(match[2]).replace(/\s*[-–]\s*/g, '–') });
    items.sort(function(a, b) { return a.position - b.position; });
    var groups = [];
    items.forEach(function(c) {
      var last = groups[groups.length - 1];
      var gap = last ? text.slice(last.position + last.raw.length, c.position) : '';
      if (!c.members) c.members = c.numbers.map(function(n) { return { number: n, pageInfo: c.pageInfo || null }; });
      if (last && /^\s*,\s*$/.test(gap)) {
        last.raw = text.slice(last.position, c.position + c.raw.length);
        last.numbers = last.numbers.concat(c.numbers); last.members = last.members.concat(c.members);
        last.pageInfo = null;
      } else groups.push(Object.assign({}, c));
    });
    return groups;
  }

  function verifiedNarrativeName(text, position, ref, sourceStyleId) {
    var before = text.slice(Math.max(0, position - 250), position);
    var names = [inTextDisplayName(ref, sourceStyleId, 'apa7', 'narrative')];
    if (ref.isInstitutional) names.push(ref.firstAuthor);
    for (var i = 0; i < names.length; i++) {
      var candidate = names[i];
      // Compare a full author sequence, never an arbitrary capitalized preceding word.
      var trimmed = before.trimEnd();
      if (trimmed.endsWith(candidate) && (trimmed.length === candidate.length || !/[\p{L}\p{N}]/u.test(trimmed[trimmed.length - candidate.length - 1]))) return candidate;
    }
    return null;
  }

  function convert(articleText, referenceText, sourceStyleId, targetStyleId, options) {
    if (!STYLES[sourceStyleId]) throw new Error('Gaya sumber tidak dikenal: ' + sourceStyleId);
    if (!STYLES[targetStyleId]) throw new Error('Gaya tujuan tidak dikenal: ' + targetStyleId);
    articleText = articleText || '';
    referenceText = referenceText || '';

    var sourceStyle = STYLES[sourceStyleId];
    var v = new CE.MultiFormatValidator(articleText, referenceText, sourceStyleId);
    v.validate(); // populates v.references, v.citations, v.acronymMap (family-specific refMap/refByNumber not relied on below)
    if (v.parseStats && v.parseStats.failedCount) {
      throw new Error(v.parseStats.failedCount + ' entri referensi tidak dapat dibaca. Perbaiki entri/heading yang tercampur agar tidak ada referensi yang hilang saat konversi.');
    }
    var restoredMetadataCount = restoreBibliography(v.references, options && options.metadata, sourceStyleId, options && options.referenceDetails);
    if (targetStyleId === 'apa7') {
      var apaPlans = CE.buildApa7DisambiguationPlan(v.references, sourceStyleId).planByRef;
      v.references.forEach(function(ref) { ref.apaPlan = apaPlans.get(ref) || null; ref.citationYear = ref.apaPlan && ref.apaPlan.assignedYear || ref.year; });
    }
    if (sourceStyleId === 'ieee') v.citations = extractNumericForConversion(articleText);

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
      if (r.numLabel != null) {
        if (!numberMap[r.numLabel]) numberMap[r.numLabel] = [];
        numberMap[r.numLabel].push(r);
      }
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
      var refs = numbers.map(function(n) { return numberMap[n] && numberMap[n].length === 1 ? numberMap[n][0] : null; });
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
      return extractNumericForConversion(text);
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
    // The shared extractor emits one event per year, but a narrative multi-year group
    // occupies ONE span. Resolve the entire group atomically before any replacement.
    var mergedEvents = [];
    allEvents.forEach(function(ev) {
      var last = mergedEvents[mergedEvents.length - 1];
      if (ev.family === 'author-date' && ev.c.type === 'narrative') {
        ev.c = Object.assign({}, ev.c, { years: [ev.c.year] });
        if (last && last.family === ev.family && last.c.type === 'narrative' && last.c.position === ev.c.position && last.c.authors === ev.c.authors) {
          last.c.years.push(ev.c.year); return;
        }
      }
      mergedEvents.push(ev);
    });
    allEvents = mergedEvents;

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
              if (c.parts.some(function(part) { return part.pageInfo; })) {
                var sourcePages = c.parts.map(function(part) { return normalizePageInfo(part.pageInfo); });
                replacement = STYLES[targetStyleId].family === 'author-date'
                  ? renderForTarget(refs, sourceStyleId, targetStyleId, 'parenthetical', { pages: sourcePages }, numberOf, null)
                  : refs.map(function(ref, i) { return renderForTarget([ref], sourceStyleId, targetStyleId, 'parenthetical', { pageInfo: sourcePages[i] }, numberOf, null); }).join(', ');
              } else replacement = renderForTarget(refs, sourceStyleId, targetStyleId, 'parenthetical', {}, numberOf, null);
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
            var narrativeDecisions = (c.years || [c.year]).map(function(y) { return authorsArr.length ? resolveAuthorYear(authorsArr[0], authorsArr, y, /et\s+al/i.test(c.authors)) : { status: 'nomatch' }; });
            var res2 = narrativeDecisions.find(function(r) { return r.status !== 'ok'; }) || narrativeDecisions[0];
            if (res2.status === 'ok') {
              var narrativeRefs = narrativeDecisions.map(function(r) { return r.ref; }); narrativeRefs.forEach(register);
              var locator = narrativeRefs.length === 1 ? raw.match(/\([^,]*,\s*(.+)\)$/) : null;
              replacement = renderForTarget(narrativeRefs, sourceStyleId, targetStyleId, 'narrative', { pageInfo: locator ? locator[1] : null }, numberOf, c.authors);
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
          var narrativeName = targetFamily === 'author-date' ? verifiedNarrativeName(articleText, c.position, numRes.refs[0], sourceStyleId) : null;
          if (narrativeName && !numRes.refs.every(function(r) { return verifiedNarrativeName(articleText, c.position, r, sourceStyleId) === narrativeName; })) narrativeName = null;
          if (narrativeName) {
            replacement = '(' + numRes.refs.map(function(r) { return r.citationYear || r.year || 'n.d.'; }).join(', ') + (c.pageInfo ? ', ' + formatLocator(c.pageInfo, targetStyleId) : '') + ')';
          } else {
            replacement = renderForTarget(numRes.refs, sourceStyleId, targetStyleId, 'parenthetical', { pageInfo: c.pageInfo, pages: c.members && c.members.map(function(member) { return member.pageInfo; }) }, numberOf, null);
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
        var ka = (a.isInstitutional ? v.resolveInstitutionalName(a.firstAuthor) : CE.surnameOf(a.firstAuthor, a.styleId || sourceStyleId)) || '';
        var kb = (b.isInstitutional ? v.resolveInstitutionalName(b.firstAuthor) : CE.surnameOf(b.firstAuthor, b.styleId || sourceStyleId)) || '';
        ka = ka.toLowerCase().replace(/^(the|a|an)\s+/i, ''); kb = kb.toLowerCase().replace(/^(the|a|an)\s+/i, '');
        if (ka < kb) return -1; if (ka > kb) return 1;
        var authorsA = canonicalAuthorsFromRef(a, sourceStyleId).map(function(x) { return x.last + ', ' + x.given.join(' '); }).join('; ').toLowerCase();
        var authorsB = canonicalAuthorsFromRef(b, sourceStyleId).map(function(x) { return x.last + ', ' + x.given.join(' '); }).join('; ').toLowerCase();
        return authorsA.localeCompare(authorsB, 'en') || (a.citationYear || a.year || '').localeCompare(b.citationYear || b.year || '') || (a.title || '').localeCompare(b.title || '', 'en');
      });
    }

    var referenceLines = orderedRefs.map(function(ref, idx) {
      var line;
      var rendered = renderBibliography(ref, targetStyleId, idx + 1);
      if (rendered) {
        line = rendered.line;
      } else if (ref.bibliography && ref.bibliography.originalStyle === targetStyleId && targetStyleId !== sourceStyleId) {
        // Already written in exactly the target style (see looksLikeEmbeddedAuthorDateReference
        // in engine.js — a reference pasted straight from a different-styled source into an
        // otherwise-uniform list). There's nothing to convert, and the usual author-render +
        // boundary/connector/rest reconstruction below doesn't fit it: that model assumes a
        // fixed shape (quoted-title-then-journal, or book-title-then-publisher) that this entry
        // — already in the TARGET shape — doesn't share with the rest of a numeric list. Just
        // strip the numeric list's own "[N] "/"N. " prefix, which doesn't belong in the target
        // style either way, and leave everything else exactly as written.
        var strippedRaw = ref.raw.trim();
        if (sourceStyle.family === 'numeric') {
          strippedRaw = sourceStyle.refPrefix === 'bracket'
            ? strippedRaw.replace(/^\[\d+\]\s*/, '')
            : strippedRaw.replace(/^\d+\.\s*/, '');
        }
        line = strippedRaw;
      } else if (ref.isBookChapter && targetStyleId === 'apa7') {
        // Book chapter with a named editor — doesn't fit the generic boundary/connector/rest
        // model below either (that assumes "quoted title, then journal name" or "unquoted title
        // IS the book title", neither of which matches "title, then editor, then book title").
        // APA7 keeps an editor's name in the SAME non-inverted "Initial. Surname" order IEEE
        // already uses (only regular AUTHORS get inverted to "Surname, Initial.") — and the
        // same for an institutional editor, used verbatim — so ref.editor needs no reformatting
        // at all here, just wrapping in "(Ed.)"/"(Eds.)".
        var authorPartCh = renderAuthorListForReference(ref, sourceStyleId, targetStyleId);
        var editorSuffix = ref.editorIsPlural ? ' (Eds.), ' : ' (Ed.), ';
        var pagesPart = ref.pages ? ' (pp. ' + ref.pages + ')' : '';
        var doiPartCh = ref.doi ? ' https://doi.org/' + ref.doi : '';
        line = authorPartCh + ' (' + (ref.year || 'n.d.') + '). ' + (ref.title || '') + '. In ' +
          (ref.editor || '') + editorSuffix + (ref.journal || '') + pagesPart + '. ' + (ref.publisher || '') +
          (doiPartCh ? '.' + doiPartCh : '.');
      } else {
        var authorPart = renderAuthorListForReference(ref, sourceStyleId, targetStyleId);
        var trimmedRaw = ref.raw.trim();
        var boundary = findAuthorSegBoundary(ref, sourceStyleId);
        var rest, connector;
        if (boundary != null) {
          connector = connectorBeforeBoundary(trimmedRaw, boundary);
          rest = trimmedRaw.substring(boundary);
        } else { rest = ''; connector = ''; }
        var prefix = '';
        if (targetStyle.family === 'numeric') prefix = targetStyle.refPrefix === 'bracket' ? '[' + (idx + 1) + '] ' : (idx + 1) + '. ';
        line = prefix + authorPart + connector + rest;
      }
      var model = JSON.parse(JSON.stringify(ref.bibliography));
      if (targetStyleId === 'apa7' && ref.citationYear) {
        var assigned = model.originalYear ? ref.citationYear.split('/').pop() : ref.citationYear;
        ['date', 'apaDate'].forEach(function(field) { if (model[field] && model[field].indexOf(model.year) === 0) model[field] = assigned + model[field].slice(model.year.length); });
        model.year = assigned;
      }
      return { line: line, runs: rendered ? rendered.runs : null, model: model, fullyFormatted: !!rendered,
        wasCited: matchedOrder.indexOf(ref) !== -1, numLabel: targetStyle.family === 'numeric' ? idx + 1 : null, original: ref.raw };
    });

    var referenceIssues = [];
    referenceLines.forEach(function(rl) {
      if ((targetStyleId === 'apa7' || targetStyleId === 'ieee') && !rl.fullyFormatted) referenceIssues.push({ raw: rl.original, note: 'Jenis/struktur sumber belum dikenali sepenuhnya. Detail asli dipertahankan; format bibliografi perlu diperiksa manual.' });
      if (targetStyleId === 'apa7' && !rl.model.completeAuthors && !rl.model.ellipsis) referenceIssues.push({ raw: rl.original, note: 'Daftar penulis sumber terpotong. APA 7 memerlukan nama lengkap; unggah DOCX keluaran alat ini yang menyimpan metadata, atau lengkapi dari sumber asli.' });
      BE.issues(rl.model, targetStyleId).forEach(function(note) { referenceIssues.push({ raw: rl.original, note: note }); });
      if (rl.model.ambiguousLocator) referenceIssues.push({ raw: rl.original, note: 'Angka tunggal pada sumber belum membedakan halaman dan nomor artikel. Angka dipertahankan tanpa menebak; jika ini nomor artikel, tambahkan kata Article pada referensi sumber lalu konversi ulang.' });
    });
    if (v.parseStats && v.parseStats.failedLines) v.parseStats.failedLines.forEach(function(raw) { referenceIssues.push({ raw: typeof raw === 'string' ? raw : JSON.stringify(raw), note: 'Entri tidak dapat diparsing dan tidak boleh dihapus otomatis. Periksa daftar sumber.' }); });

    return {
      sourceStyleId: sourceStyleId, targetStyleId: targetStyleId,
      convertedArticle: out,
      changedCount: changedCount,
      totalCitationsFound: spans.length,
      unmatched: unmatchedList,
      citationSpans: citationSpans,
      referenceLines: referenceLines,
      referenceIssues: referenceIssues,
      metadata: { version: 1, styleId: targetStyleId, entries: referenceLines.map(function(rl) { return { line: rl.line, model: rl.model }; }) },
      restoredMetadataCount: restoredMetadataCount,
      uncitedCount: uncitedRefs.length,
      parseStats: v.parseStats,
      mixedStyleFoundCount: mixedStyleFound.length,
      mixedStyleFixedCount: mixedStyleFixed,
      mixedStyleUnresolvedCount: mixedStyleUnresolved,
      numberingInferred: !!v.numberingInferred,
    };
  }

  // The source's own 21+-author ellipsis marker ("Name, F., . . . Last, F.") can end up glued
  // onto the final author as one fragment during splitting (". . . Moher, D"), which makes the
  // apparent total author count look like exactly one ordinary author too few to cross the
  // n>20 threshold below — silently missing the ellipsis-rendering branch and instead joining
  // every name, including the ellipsis-glued one, with a plain "&": "..., McDonald, S., &
  // . . . Moher, D." This strips the ellipsis prefix from that fragment first and remembers
  // that the list was ALREADY ellipsis-truncated at the source, regardless of the resulting
  // apparent count.
  function isEllipsisTruncatedFragment(s) {
    return /^(?:\.\s*\.\s*\.|…)\s*\S/u.test((s || '').trim());
  }

  function renderAuthorListForReference(ref, sourceStyleId, targetStyleId) {
    var style = STYLES[targetStyleId];
    if (ref.isInstitutional) {
      var institutions = canonicalAuthorsFromRef(ref, sourceStyleId).map(function(a) { return a.last; });
      if (institutions.length === 2 && targetStyleId === 'apa7') return institutions[0] + ', & ' + institutions[1];
      return joinList(institutions, targetStyleId === 'apa7' ? '&' : 'and');
    }

    var rawAuthors = ref.authors || [];
    var sourceHasEllipsis = ref.bibliography ? ref.bibliography.ellipsis : rawAuthors.length > 0 && isEllipsisTruncatedFragment(rawAuthors[rawAuthors.length - 1]);
    var effectiveRef = ref;
    if (sourceHasEllipsis && !ref.bibliography) {
      var cleanedLast = rawAuthors[rawAuthors.length - 1].replace(/^(?:\.\s*\.\s*\.|…)\s*/u, '');
      effectiveRef = { authors: rawAuthors.slice(0, -1).concat([cleanedLast]), isInstitutional: ref.isInstitutional, firstAuthor: ref.firstAuthor, styleId: ref.styleId };
    }

    var canon = canonicalAuthorsFromRef(effectiveRef, sourceStyleId);
    var n = canon.length;
    if (targetStyleId === 'ieee' && (n > 6 || sourceHasEllipsis || (ref.bibliography && !ref.bibliography.completeAuthors))) {
      return renderAuthorForStyle(canon[0].last, canon[0].given, targetStyleId, 'first') + ' et al.';
    }
    if ((targetStyleId === 'apa7' && n > 20) || (sourceHasEllipsis && n >= 2)) { // APA7: first 19, ellipsis, last author
      var headCount = Math.min(n - 1, 19);
      var head = canon.slice(0, headCount).map(function(a, i) { return a.institutional ? a.last : renderAuthorForStyle(a.last, a.given, targetStyleId, i === 0 ? 'first' : 'other'); });
      var lastA = canon[n - 1];
      return head.join(', ') + ', . . . ' + renderAuthorForStyle(lastA.last, lastA.given, targetStyleId, 'other');
    }
    // The SOURCE reference itself may already be a truncated "et al." list (e.g. IEEE's "A. R.
    // Malik et al."). canonicalAuthorsFromRef strips that marker fragment out (it's not a real
    // name), so `canon` only holds the names that were actually spelled out — but we still need
    // to carry the "there were more" signal through to the rendered line, or a 1-name truncated
    // source silently turns into what looks like a genuine single-author work.
    var sourceTruncated = ref.bibliography ? !ref.bibliography.completeAuthors && !ref.bibliography.ellipsis : (ref.authors || []).length > 0 && isEtAlFragment(ref.authors[ref.authors.length - 1]);
    var threshold = style.refListFullUpTo;
    var list = canon, truncated = sourceTruncated;
    if (threshold && n > threshold) { list = canon.slice(0, threshold); truncated = true; }
    var rendered = list.map(function(a, i) { return a.institutional ? a.last : renderAuthorForStyle(a.last, a.given, targetStyleId, i === 0 ? 'first' : 'other'); });
    if (truncated) return rendered.join(', ') + ', et al.';
    if (rendered.length === 1) return rendered[0];
    if (style.family === 'numeric') {
      return rendered.length === 2 ? rendered[0] + ' and ' + rendered[1] : rendered.slice(0, -1).join(', ') + ', and ' + rendered[rendered.length - 1];
    }
    var sep = style.sep === '&' ? '&' : 'and';
    // APA7 always separates reference-list authors with a comma, including right before the
    // final "&" — even for exactly two authors ("Smith, J., & Jones, K."), unlike the in-text
    // citation form ("Smith & Jones, 2020") which correctly omits it. Harvard/Chicago's "and"
    // separator convention is left as-is (not the same documented requirement).
    if (rendered.length === 2) return sep === '&' ? rendered[0] + ', ' + sep + ' ' + rendered[1] : rendered[0] + ' ' + sep + ' ' + rendered[1];
    return rendered.slice(0, -1).join(', ') + ', ' + sep + ' ' + rendered[rendered.length - 1];
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

  // Finds where the author segment ends in a raw reference line, for a given style — i.e. where
  // the connector + "rest of the line" (title onward) that gets preserved verbatim should start.
  //
  // Primary strategy: parseReferenceLine has ALREADY correctly extracted ref.title (it knows how
  // to handle quoted titles, non-quoted book titles, institutional authors, etc. — see engine.js)
  // — just locate that exact text in the raw line. This used to instead re-derive the boundary
  // from scratch with its own narrower regex, which drifted out of sync with parseReferenceLine's
  // own logic: a non-quoted book/institutional reference like "UNESCO, Guidance for Generative AI
  // in Education and Research. Paris, France: UNESCO, ..." would have its ENTIRE title silently
  // swallowed and lost (the old fallback cut at the first period anywhere in the line, which for
  // an untitled institutional author lands mid-title, not at its start).
  function findAuthorSegBoundary(ref, styleId) {
    var style = STYLES[styleId];
    var text = (ref.raw || '').trim();
    // The date lies between the authors and title in APA. It belongs to the preserved body.
    if (style.family === 'author-date' && style.yearInParens !== false) {
      var leadingDate = text.match(/\((?:\d{4}[a-z]?|n\.d\.)(?:,[^)]*)?\)/);
      if (leadingDate) return leadingDate.index;
    }
    if (ref.title) {
      var titleIdx = text.indexOf(ref.title);
      if (titleIdx !== -1) {
        // If a quote mark immediately precedes the title (the common case for a journal
        // article), the boundary belongs AT that quote mark, not just after it — the quote
        // itself needs to survive as part of the preserved "rest", per the existing convention.
        if (titleIdx > 0 && /["“]/.test(text[titleIdx - 1])) return titleIdx - 1;
        return titleIdx;
      }
    }
    // Fallback (title unavailable, or not found verbatim in raw) — narrower heuristics as a
    // safety net; should rarely be reached given a successfully-parsed reference has a title.
    if (style.family === 'numeric') {
      var t = text, prefixLen = 0;
      if (style.refPrefix === 'bracket') { var bm = t.match(/^\[(\d+)\]\s*/); if (bm) { prefixLen = bm[0].length; t = t.slice(bm[0].length); } }
      else if (style.refPrefix === 'dot') { var dm = t.match(/^(\d+)\.\s*/); if (dm) { prefixLen = dm[0].length; t = t.slice(dm[0].length); } }
      var qIdx = t.search(/["“]/);
      return prefixLen + (qIdx > -1 ? qIdx : t.length);
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
    completeTruncatedAuthorsAsync: completeTruncatedAuthorsAsync,
    _internal: { // exposed for tests
      splitAuthorFragment: splitAuthorFragment,
      renderAuthorForStyle: renderAuthorForStyle,
      compressRanges: compressRanges,
      formatNumeric: formatNumeric,
      renderAuthorListForReference: renderAuthorListForReference,
      canonicalAuthorsFromRef: canonicalAuthorsFromRef,
      parseNumericReferenceTail: parseNumericReferenceTail,
      deriveBookPublisher: deriveBookPublisher,
      formatCrossRefAuthorsForSourceStyle: formatCrossRefAuthorsForSourceStyle,
      evaluateAuthorCompletion: evaluateAuthorCompletion,
      bibliographyFromRef: bibliographyFromRef,
      renderBibliography: renderBibliography,
      extractNumericForConversion: extractNumericForConversion,
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CitationConverter;
  if (typeof window !== 'undefined') window.CitationConverter = CitationConverter;
  else if (typeof self !== 'undefined') self.CitationConverter = CitationConverter;
})();
