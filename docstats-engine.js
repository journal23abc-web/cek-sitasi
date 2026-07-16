// DocStats engine — analyzes a single manuscript's structure for a "Preliminary Check"
// (the kind of desk-check an editor does before sending a paper out for review).
// Pure logic: takes an already-extracted {paragraphs, tableCount, imageCount} structure, so
// it's independently testable in Node and reusable from any page.

var DocStatsEngine = (function () {

  function countWords(text) {
    return (text || '').split(/\s+/).filter(Boolean).length;
  }

  var ABBREV = /\b(et al|e\.g|i\.e|vs|cf|no|fig|tabel|dkk|st|dr|prof|misal)\.$/i;
  function splitSentences(text) {
    var parts = (text || '').split(/(?<=[.!?])\s+/);
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

  // Order matters: earlier patterns are checked first, and each is matched at the START of
  // a paragraph. "results and discussion" must be checked before "discussion" alone so a
  // combined heading doesn't get mis-tagged.
  var SECTION_PATTERNS = [
    { key: 'title', label: 'Judul', re: null }, // resolved separately, not by heading match
    { key: 'abstract', label: 'Abstrak', re: /^(?:\d+[\.\)]?\s*)?(abstract|abstrak)\b\s*[:.\-]?\s*/i },
    { key: 'keywords', label: 'Kata Kunci', re: /^(?:\d+[\.\)]?\s*)?(keywords?|kata\s*kunci)\s*[:.\-]/i },
    { key: 'introduction', label: 'Pendahuluan (I)', re: /^(?:\d+[\.\)]?\s*)?(introduction|pendahuluan|latar\s*belakang)\b\s*[:.\-]?\s*$/i },
    { key: 'method', label: 'Metode (M)', re: /^(?:\d+[\.\)]?\s*)?(research\s*method(ology)?|methods?|methodology|metod(e|ologi)(\s*penelitian)?)\b\s*[:.\-]?\s*$/i },
    { key: 'results_discussion', label: 'Hasil & Pembahasan (R&D)', re: /^(?:\d+[\.\)]?\s*)?(results?\s*and\s*discussions?|hasil\s*dan\s*pembahasan)\s*[:.\-]?\s*$/i },
    { key: 'results', label: 'Hasil (R)', re: /^(?:\d+[\.\)]?\s*)?(results?|findings?|hasil(\s*penelitian)?|temuan)\b\s*[:.\-]?\s*$/i },
    { key: 'discussion', label: 'Pembahasan (D)', re: /^(?:\d+[\.\)]?\s*)?(discussions?|pembahasan|diskusi)\b\s*[:.\-]?\s*$/i },
    { key: 'conclusion', label: 'Kesimpulan', re: /^(?:\d+[\.\)]?\s*)?(conclusions?(\s*and\s*suggestions?)?|kesimpulan(\s*dan\s*saran)?|simpulan|penutup)\b\s*[:.\-]?\s*$/i },
    { key: 'acknowledgment', label: 'Ucapan Terima Kasih', re: /^(?:\d+[\.\)]?\s*)?(acknowledge?ments?|ucapan\s*terima\s*kasih)\s*[:.\-]?\s*$/i },
    { key: 'references', label: 'Referensi', re: /^(?:\d+[\.\)]?\s*)?(references|daftar\s*pustaka|bibliography|reference\s*list)\s*[:.\-]?\s*$/i },
  ];

  // Headings we expect to stand ALONE on their own paragraph (numbered IMRAD sections).
  // Abstract/Keywords are handled specially below since they very commonly share a
  // paragraph with their own content ("Abstract. Lorem ipsum...").
  var STANDALONE_KEYS = ['introduction', 'method', 'results_discussion', 'results', 'discussion', 'conclusion', 'acknowledgment', 'references'];

  function matchSection(line) {
    var t = (line || '').trim();
    if (!t) return null;
    for (var i = 0; i < SECTION_PATTERNS.length; i++) {
      var sp = SECTION_PATTERNS[i];
      if (!sp.re) continue;
      var m = t.match(sp.re);
      if (m) return { key: sp.key, label: sp.label, matchLength: m[0].length, fullLine: t };
    }
    return null;
  }

  // Returns [{key, label, startIdx, startOffset (char offset within that paragraph where
  // content begins), endIdx, endOffset}]. Handles both "heading alone on its own paragraph"
  // and "Abstract. <content starts right here>" in the same paragraph.
  function detectSections(paragraphs) {
    var hits = [];
    paragraphs.forEach(function (p, idx) {
      var t = (p || '').trim();
      if (!t) return;
      // Standalone-style headings only match if the WHOLE paragraph is short (just the
      // heading, nothing else) — avoids matching "Introduction" appearing mid-sentence.
      var standaloneCandidateOk = t.length <= 60;
      var m = matchSection(t);
      if (!m) return;
      if (STANDALONE_KEYS.indexOf(m.key) !== -1 && !standaloneCandidateOk) return;
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
    var startP = (paragraphs[section.startIdx] || '');
    var restOfStartLine = startP.slice(section.startOffset).trim();
    if (restOfStartLine) parts.push(restOfStartLine);
    for (var i = section.startIdx + 1; i < section.endIdx; i++) {
      if (paragraphs[i]) parts.push(paragraphs[i]);
    }
    if (section.endOffset > 0 && paragraphs[section.endIdx]) {
      // last chunk belongs to the NEXT heading's own paragraph, before that heading starts —
      // only relevant if the next section's heading shares a paragraph with trailing content
      // from THIS section, which in practice doesn't happen since headings start paragraphs.
    }
    return parts.join('\n').trim();
  }

  function analyzeDocument(doc) {
    var paragraphs = (doc.paragraphs || []).map(function (p) { return p || ''; });
    var nonEmpty = paragraphs.map(function (p) { return p.trim(); }).filter(Boolean);

    var sections = detectSections(paragraphs);
    var byKey = {};
    sections.forEach(function (s) { byKey[s.key] = s; });

    // Title: first non-empty paragraph that isn't itself a detected heading and has 3+ words.
    var title = null, titleIdx = -1;
    for (var i = 0; i < Math.min(paragraphs.length, 10); i++) {
      var t = paragraphs[i].trim();
      if (!t) continue;
      if (matchSection(t)) break; // hit a real section heading before finding a title candidate
      if (countWords(t) >= 3) { title = t; titleIdx = i; break; }
    }

    var abstractText = sectionText(paragraphs, byKey.abstract);
    var abstractWords = countWords(abstractText);

    var imradKeys = ['introduction', 'method', 'results_discussion', 'results', 'discussion', 'conclusion'];
    var allImradSections = imradKeys.filter(function (k) { return byKey[k]; }).map(function (k) {
      var text = sectionText(paragraphs, byKey[k]);
      return { key: k, label: byKey[k].label, headingText: byKey[k].headingText, words: countWords(text), sentences: splitSentences(text).length };
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
      keywordsFound: !!byKey.keywords,
      keywordList: keywordList,
      keywordCount: keywordList.length,
      imradSections: imradSections,
      emptyWrapperHeadings: emptyWrapperSections.map(function (s) { return s.headingText; }),
      missingImrad: missingImrad,
      totalWords: totalWords,
      totalSentences: totalSentences,
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
