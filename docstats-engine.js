// DocStats engine — analyzes a single manuscript's structure for a "Preliminary Check"
// (the kind of desk-check an editor does before sending a paper out for review).
// Pure logic: takes an already-extracted {paragraphs, tableCount, imageCount} structure, so
// it's independently testable in Node and reusable from any page.

var DocStatsEngine = (function () {

  function normalizeWhitespace(s) {
    return (s || '')
      .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function countWords(text) {
    var t = normalizeWhitespace(text);
    return t ? t.split(' ').filter(Boolean).length : 0;
  }

  var ABBREV = /\b(et al|e\.g|i\.e|vs|cf|no|fig|tabel|dkk|st|dr|prof|misal)\.$/i;
  function splitSentences(text) {
    var parts = normalizeWhitespace(text).split(/(?<=[.!?])\s+/);
    var sentences = [];
    var buffer = '';
    parts.forEach(function (p) {
      buffer = buffer ? buffer + ' ' + p : p;
      if (ABBREV.test(buffer.trim())) return;
      var trimmed = buffer.trim();
      if (trimmed) sentences.push(trimmed);
      buffer = '';
    });
    if (buffer.trim()) sentences.push(buffer.trim());
    return sentences.filter(function (s) { return countWords(s) >= 3; });
  }

  // Optional heading-numbering prefix: "3.", "3.1", "3)", "III.", "BAB 3", "Section 3:" etc.
  var PREFIX = '(?:(?:bab|section|chapter)\\s*)?(?:\\d+(?:\\.\\d+)*|[ivxlcdm]+)?[\\.\\):]?\\s*';

  // Core keyword patterns are intentionally loose (no end-anchor) — real headings routinely
  // carry extra words ("HASIL PENELITIAN DAN PEMBAHASAN", "RESEARCH FINDINGS AND DISCUSSION").
  // A short line containing the keyword near the start is treated as a heading; the "is this
  // short enough to be a heading, not body text" judgment is made separately by word count.
  var SECTION_PATTERNS = [
    { key: 'title', label: 'Judul', re: null },
    { key: 'abstract', label: 'Abstrak', re: /^(abstract|abstrak)\b\s*[:.\-]?\s*/i },
    { key: 'keywords', label: 'Kata Kunci', re: /^(keywords?|kata\s*kunci)\b\s*[:.\-]?\s*/i },
    { key: 'introduction', label: 'Pendahuluan (I)', re: new RegExp('^' + PREFIX + '(introduction|pendahuluan|latar\\s*belakang)\\b', 'i') },
    { key: 'method', label: 'Metode (M)', re: new RegExp('^' + PREFIX + '(research\\s*method\\w*|methods?\\b|methodology|metod(e|ologi)(\\s*penelitian)?)', 'i') },
    { key: 'results_discussion', label: 'Hasil & Pembahasan (R&D)', re: new RegExp('^' + PREFIX + '((research\\s*)?results?\\s*(and|&)\\s*discussions?|hasil(\\s*(penelitian|riset))?\\s*dan\\s*pembahasan)', 'i') },
    { key: 'results', label: 'Hasil (R)', re: new RegExp('^' + PREFIX + '((research\\s*)?results?\\b|findings?\\b|hasil(\\s*(penelitian|riset))?\\b|temuan(\\s*penelitian)?\\b)', 'i') },
    { key: 'discussion', label: 'Pembahasan (D)', re: new RegExp('^' + PREFIX + '(discussions?\\b|pembahasan\\b|diskusi\\b)', 'i') },
    { key: 'conclusion', label: 'Kesimpulan', re: new RegExp('^' + PREFIX + '(conclusions?\\b(\\s*(and|&)\\s*suggestions?)?|kesimpulan\\b(\\s*dan\\s*saran)?|simpulan\\b|penutup\\b)', 'i') },
    { key: 'acknowledgment', label: 'Ucapan Terima Kasih', re: new RegExp('^' + PREFIX + '(acknowledge?ments?\\b|ucapan\\s*terima\\s*kasih\\b)', 'i') },
    { key: 'references', label: 'Referensi', re: new RegExp('^' + PREFIX + '(references\\b|daftar\\s*pustaka\\b|bibliography\\b|reference\\s*list\\b)', 'i') },
  ];

  // Headings we expect to stand ALONE on their own paragraph (numbered IMRAD sections).
  // Abstract/Keywords are handled specially since they very commonly share a paragraph
  // with their own content ("Abstract. Lorem ipsum...").
  var STANDALONE_KEYS = ['introduction', 'method', 'results_discussion', 'results', 'discussion', 'conclusion', 'acknowledgment', 'references'];
  var MAX_HEADING_WORDS = 10; // generous — covers padded headings like "HASIL PENELITIAN DAN PEMBAHASAN UMUM"

  // These single common-word keys are the ones most likely to false-match ordinary prose or
  // short table/column text that merely happens to start with the word — e.g. a results table
  // with a "Result Hypothesis" column header, or a sentence like "Result of this test...".
  // Real IMRAD headings in the manuscripts this tool sees are consistently either numbered
  // ("3. Results", "3.5 Discussion") or fully capitalized ("RESULTS"); plain Title-Case text
  // with neither signal is far more likely to be incidental body/table text, so we require one
  // of those two signals before accepting a match for these particular keys.
  var GENERIC_RISK_KEYS = ['introduction', 'method', 'results', 'discussion', 'conclusion'];
  // Roman numerals must be UPPERCASE and stand alone (followed by ".", ")", ":" or whitespace) —
  // otherwise "I" in "Introduction", "M" in "Method", "C" in "Conclusion", "D" in "Discussion"
  // would each look like a valid roman-numeral prefix of the word itself.
  var NUMBERED_PREFIX_RE = /^(?:(?:bab|section|chapter)\s*)?(?:\d+(?:\.\d+)*|[IVXLCDM]+(?=[.:)\s]))[.:)]?\s*/;

  function looksLikeRealHeadingSignal(t) {
    if (NUMBERED_PREFIX_RE.test(t)) return true;
    return t === t.toUpperCase() && /[A-Z]/.test(t); // ALL CAPS (and contains at least one letter)
  }

  function matchSection(line) {
    var t = normalizeWhitespace(line);
    if (!t) return null;
    for (var i = 0; i < SECTION_PATTERNS.length; i++) {
      var sp = SECTION_PATTERNS[i];
      if (!sp.re) continue;
      var m = t.match(sp.re);
      if (!m) continue;
      if (GENERIC_RISK_KEYS.indexOf(sp.key) !== -1 && !looksLikeRealHeadingSignal(t)) continue;
      return { key: sp.key, label: sp.label, matchLength: m[0].length, fullLine: t };
    }
    return null;
  }

  // Returns [{key, label, startIdx, startOffset (char offset within that paragraph where
  // content begins), endIdx, endOffset}]. Handles both "heading alone on its own paragraph"
  // and "Abstract. <content starts right here>" in the same paragraph.
  function detectSections(paragraphs) {
    var hits = [];
    paragraphs.forEach(function (p, idx) {
      var t = normalizeWhitespace(p);
      if (!t) return;
      var m = matchSection(t);
      if (!m) return;
      var isStandalone = STANDALONE_KEYS.indexOf(m.key) !== -1;
      if (isStandalone && countWords(t) > MAX_HEADING_WORDS) return; // looks like body text, not a heading
      var seenAlready = hits.some(function (h) { return h.key === m.key; });
      if (seenAlready) return; // keep first occurrence only (running headers can repeat)
      hits.push({ key: m.key, label: m.label, startIdx: idx, startOffset: m.matchLength, headingText: t.slice(0, m.matchLength).trim() });
    });
    hits.sort(function (a, b) { return a.startIdx - b.startIdx; });
    hits.forEach(function (h, i) {
      if (i + 1 < hits.length) {
        h.endIdx = hits[i + 1].startIdx;
        h.endOffset = hits[i + 1].startOffset;
      } else {
        h.endIdx = paragraphs.length;
        h.endOffset = 0;
      }
    });
    return hits;
  }

  // Extracts the text belonging to a detected section, correctly handling the "heading and
  // content share a paragraph" case at both ends.
  function sectionText(paragraphs, section) {
    if (!section) return '';
    var parts = [];
    var startP = normalizeWhitespace(paragraphs[section.startIdx] || '');
    var restOfStartLine = startP.slice(section.startOffset).trim();
    if (restOfStartLine) parts.push(restOfStartLine);
    for (var i = section.startIdx + 1; i < section.endIdx; i++) {
      if (paragraphs[i]) parts.push(paragraphs[i]);
    }
    return parts.join('\n').trim();
  }

  function previewText(text, n) {
    var words = normalizeWhitespace(text).split(' ').filter(Boolean);
    if (words.length === 0) return '';
    if (words.length <= n * 2) return words.join(' ');
    return words.slice(0, n).join(' ') + ' … ' + words.slice(-n).join(' ');
  }

  function analyzeDocument(doc) {
    var paragraphs = (doc.paragraphs || []).map(function (p) { return p || ''; });
    var nonEmpty = paragraphs.map(function (p) { return normalizeWhitespace(p); }).filter(Boolean);

    var sections = detectSections(paragraphs);
    var byKey = {};
    sections.forEach(function (s) { byKey[s.key] = s; });

    // Title: first non-empty paragraph that isn't itself a detected heading and has 3+ words.
    var title = null, titleIdx = -1;
    for (var i = 0; i < Math.min(paragraphs.length, 10); i++) {
      var t = normalizeWhitespace(paragraphs[i]);
      if (!t) continue;
      if (matchSection(t)) break; // hit a real section heading before finding a title candidate
      if (countWords(t) >= 3) { title = t; titleIdx = i; break; }
    }

    var abstractText = sectionText(paragraphs, byKey.abstract);
    var abstractWords = countWords(abstractText);
    var abstractPreview = previewText(abstractText, 12);

    var imradKeys = ['introduction', 'method', 'results_discussion', 'results', 'discussion', 'conclusion'];
    var allImradSections = imradKeys.filter(function (k) { return byKey[k]; }).map(function (k) {
      var text = sectionText(paragraphs, byKey[k]);
      return { key: k, label: byKey[k].label, headingText: byKey[k].headingText, words: countWords(text), sentences: splitSentences(text).length, preview: previewText(text, 10) };
    });
    // A section with 0 words almost always means a sub-heading (e.g. "Result" / "Discussion")
    // immediately followed a wrapper heading (e.g. "RESULTS AND DISCUSSION") and took over its
    // content — not that the section is genuinely empty. Keep the sub-headings' real counts,
    // drop the now-redundant empty wrapper from the displayed list.
    var emptyWrapperSections = allImradSections.filter(function (s) { return s.words === 0; });
    var imradSections = allImradSections.filter(function (s) { return s.words > 0; });

    var refSection = byKey.references;
    var bodyEndIdx = refSection ? refSection.startIdx : paragraphs.length;
    var fullBodyText = paragraphs.slice(titleIdx >= 0 ? titleIdx + 1 : 0, bodyEndIdx).join('\n');
    var totalWords = countWords(fullBodyText);
    var totalSentences = splitSentences(fullBodyText).length;

    // Whole-document figures span every single paragraph in the file, start to finish
    // (including the title itself and anything before it, plus the full reference list) —
    // this is the closest match to what MS Word's own word count shows for the whole file.
    // The body-only totalWords/totalSentences above stay as they are for anything that
    // specifically wants "just the manuscript prose, not title/references" (e.g. citation
    // density stats).
    var wholeDocText = paragraphs.join('\n');
    var totalWordsWholeDocument = countWords(wholeDocText);
    var totalSentencesWholeDocument = splitSentences(wholeDocText).length;

    var referenceLines = refSection
      ? paragraphs.slice(refSection.startIdx + 1).map(function (p) { return p.trim(); }).filter(Boolean)
      : [];

    // Keywords: parsed from the "Keywords: a, b, c" line if found.
    var keywordList = [];
    if (byKey.keywords) {
      var kwText = sectionText(paragraphs, byKey.keywords);
      keywordList = kwText.split(/[,;]/).map(function (k) { return k.trim(); }).filter(Boolean);
    }

    // Author/affiliation block heuristic: lines between title and abstract that mention an
    // email address or the word "faculty/fakultas/university/universitas" — just a presence
    // check, not a strict validator.
    var preAbstractIdx = byKey.abstract ? byKey.abstract.startIdx : Math.min(paragraphs.length, 10);
    var authorBlock = paragraphs.slice(titleIdx + 1, preAbstractIdx).join(' ');
    var hasEmail = /[\w.+-]+@[\w-]+\.[\w.-]+/.test(authorBlock);
    var hasAffiliation = /\b(faculty|fakultas|university|universitas|department|departemen|institute|institut|jurusan)\b/i.test(authorBlock);

    var foundImradKeys = imradSections.map(function (s) { return s.key; });
    var missingImrad = [];
    if (!byKey.introduction) missingImrad.push('Pendahuluan (Introduction)');
    if (!byKey.method) missingImrad.push('Metode (Method)');
    if (!byKey.results && !byKey.results_discussion) missingImrad.push('Hasil (Results)');
    if (!byKey.discussion && !byKey.results_discussion) missingImrad.push('Pembahasan (Discussion)');
    if (!byKey.conclusion) missingImrad.push('Kesimpulan (Conclusion)');

    return {
      title: title,
      titleWords: title ? countWords(title) : 0,
      abstractFound: !!byKey.abstract,
      abstractWords: abstractWords,
      abstractPreview: abstractPreview,
      keywordsFound: !!byKey.keywords,
      keywordList: keywordList,
      keywordCount: keywordList.length,
      imradSections: imradSections,
      emptyWrapperHeadings: emptyWrapperSections.map(function (s) { return s.headingText; }),
      missingImrad: missingImrad,
      totalWords: totalWords,
      totalSentences: totalSentences,
      totalWordsWholeDocument: totalWordsWholeDocument,
      totalSentencesWholeDocument: totalSentencesWholeDocument,
      paragraphCount: nonEmpty.length,
      referenceCount: referenceLines.length,
      referenceLines: referenceLines,
      tableCount: doc.tableCount || 0,
      imageCount: doc.imageCount || 0,
      hasAuthorEmail: hasEmail,
      hasAffiliation: hasAffiliation,
      acknowledgmentFound: !!byKey.acknowledgment,
      referenceRecency: computeReferenceRecency(referenceLines, 10),
    };
  }

  function computeReferenceRecency(referenceLines, recentYearsThreshold) {
    var currentYear = new Date().getFullYear();
    var threshold = recentYearsThreshold || 10;
    var years = [];
    (referenceLines || []).forEach(function (line) {
      var m = line.match(/\b(19|20)\d{2}\b/);
      if (m) years.push(parseInt(m[0], 10));
    });
    var recentCount = years.filter(function (y) { return (currentYear - y) <= threshold; }).length;
    return {
      totalWithYear: years.length,
      totalWithoutYear: (referenceLines || []).length - years.length,
      recentCount: recentCount,
      recentPct: years.length ? Math.round((recentCount / years.length) * 100) : 0,
      thresholdYears: threshold,
    };
  }

  return {
    analyzeDocument: analyzeDocument,
    detectSections: detectSections,
    splitSentences: splitSentences,
    countWords: countWords,
    computeReferenceRecency: computeReferenceRecency,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = DocStatsEngine; }
if (typeof window !== 'undefined') { window.DocStatsEngine = DocStatsEngine; }
else if (typeof self !== 'undefined') { self.DocStatsEngine = DocStatsEngine; }
