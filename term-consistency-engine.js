/* ============================================================
   TERM CONSISTENCY ENGINE — mendeteksi istilah/konsep dalam naskah, definisinya, dan
   konsistensi penulisannya, tanpa model ML eksternal (murni rule-based + heuristik leksikal).

   Arsitektur mengikuti tiga keputusan terpisah (bukan "mirip kata" saja):
     1. Apakah sebuah istilah memiliki definisi?            -> detectDefinitions()
     2. Apakah dua istilah merujuk pada konsep yang sama?   -> groupBySurfaceForm() + findAcronymAliases()
                                                                 (aman, otomatis) + flagPossibleAliases()
                                                                 (leksikal, HANYA ditandai untuk ditinjau,
                                                                 TIDAK PERNAH digabung otomatis)
     3. Apakah sebuah istilah berfungsi sebagai variabel?   -> scoreVariableEvidence()

   KETERBATASAN JUJUR: tidak ada akses ke model embedding/semantic beneran di browser tanpa
   memuat model ML besar. "Kemiripan semantik" di sini didekati dengan kemiripan leksikal
   (kata-kata penting yang sama) — SELALU lebih lemah dari makna sesungguhnya, karena itu hasil
   Tingkat-3 (alias leksikal) tidak pernah digabung otomatis, hanya ditandai untuk tinjauan
   manusia. Bahkan skor 1.00 bukan izin untuk menyatukan konsep. Penyatuan pasangan yang tidak
   eksplisit ditulis sebagai "Istilah Lengkap (AKRONIM)" hanya boleh dilakukan melalui keputusan
   pengguna atau kamus khusus yang dimasukkan pengguna sendiri.
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.TermConsistencyEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- text utilities ----------
  function normalizeWhitespace(s) {
    return (s || '')
      .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var ABBREV = /\b(et al|e\.g|i\.e|vs|cf|no|fig|tabel|dkk|st|dr|prof|misal|mr|mrs|ms)\.$/i;
  function splitSentences(text) {
    var parts = normalizeWhitespace(text).split(/(?<=[.!?])\s+/);
    var sentences = [];
    var buffer = '';
    var offset = 0;
    var full = normalizeWhitespace(text);
    parts.forEach(function (p) {
      buffer = buffer ? buffer + ' ' + p : p;
      if (ABBREV.test(buffer.trim())) return;
      var trimmed = buffer.trim();
      if (trimmed) {
        var start = full.indexOf(trimmed, offset);
        sentences.push({ text: trimmed, start: start >= 0 ? start : offset });
        offset = start >= 0 ? start + trimmed.length : offset + trimmed.length;
      }
      buffer = '';
    });
    if (buffer.trim()) {
      var t2 = buffer.trim();
      var s2 = full.indexOf(t2, offset);
      sentences.push({ text: t2, start: s2 >= 0 ? s2 : offset });
    }
    return sentences;
  }

  var STOPWORDS = new Set([
    'the', 'a', 'an', 'of', 'in', 'on', 'at', 'for', 'to', 'and', 'or', 'is', 'are', 'was', 'were',
    'be', 'been', 'being', 'this', 'that', 'these', 'those', 'as', 'by', 'with', 'from', 'their',
    'its', 'it', 'which', 'who', 'whom', 'has', 'have', 'had', 'will', 'would', 'can', 'could',
    'may', 'might', 'must', 'should', 'not', 'no', 'yes', 'do', 'does', 'did', 'such', 'into',
    'between', 'among', 'both', 'each', 'per', 'via', 'also', 'than', 'then', 'although',
    'however', 'whereas', 'while', 'when', 'because', 'therefore', 'thus',
    'yang', 'dan', 'atau', 'adalah', 'merupakan', 'ini', 'itu', 'pada', 'dari', 'ke', 'di',
    'dengan', 'oleh', 'untuk', 'sebagai', 'juga', 'akan', 'telah', 'sudah', 'dapat', 'bisa',
    'dalam', 'antara', 'terhadap', 'melalui', 'secara', 'namun', 'karena', 'maupun', 'serta',
    'kami', 'penelitian', 'studi', 'hasil', 'berdasarkan', 'menunjukkan', 'bahwa',
  ]);

  var GENERIC_NON_CONCEPT_RE = /^(?:appendix|lampiran|table|tabel|figure|gambar|model)\s+[a-z0-9ivx]+$/i;

  function isGenericNonConceptCandidate(term) {
    var norm = normalizeTermSurface(term);
    return !norm || GENERIC_NON_CONCEPT_RE.test(norm) ||
      /^(?:respondent profile|profil responden|author contribution statement|ai disclosure statement|acknowledgment|acknowledgement)$/.test(norm);
  }

  // ---------- Level 1: surface-form normalization (safe, automatic) ----------
  function normalizeTermSurface(term) {
    var t = (term || '').toLowerCase()
      .replace(/[-\u2010-\u2015]/g, ' ')   // hyphen/dash variants -> space
      .replace(/[^\p{L}\p{N}\s]/gu, '')     // strip remaining punctuation
      .replace(/\s+/g, ' ')
      .trim();
    // very simple singular/plural fold: trailing "s" or "ies"->"y" (English), safe for the
    // short 2-6 word noun phrases this engine deals with — not a full lemmatizer, but doesn't
    // need to be: it only has to make identical-meaning surface variants collide.
    var words = t.split(' ').map(function (w) {
      if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
      // Hindari merusak kata Indonesia/Latin seperti "kualitas", "status", dan "analisis".
      // Fold jamak Inggris hanya diterapkan bila akhiran tidak menyerupai akhiran kata tersebut.
      if (w.length > 3 && /s$/.test(w) && !/(ss|us|is|as|os|ics)$/.test(w)) return w.slice(0, -1);
      return w;
    });
    return words.join(' ');
  }

  // References/bibliography are not manuscript claims. Including them creates large numbers of
  // fake concepts from article titles and author names. Appendices after the reference list are
  // retained because they often contain instruments or operational definitions.
  var REFERENCE_HEADING_RE = /^(?:references?|bibliography|works cited|daftar pustaka|referensi)$/i;
  var APPENDIX_HEADING_RE = /^(?:appendix|appendices|lampiran)(?:\s+[a-z0-9ivx]+)?$/i;

  function prepareAnalysisText(rawText, options) {
    options = options || {};
    var raw = String(rawText || '').replace(/\r\n?/g, '\n');
    if (options.excludeReferences === false) {
      return { text: raw, excludedReferenceCharacters: 0, referenceSectionFound: false };
    }
    var lines = raw.split('\n');
    var kept = [], excludedChars = 0, inReferences = false, found = false, seenContentChars = 0;
    for (var i = 0; i < lines.length; i++) {
      var trimmed = normalizeWhitespace(lines[i]);
      if (!inReferences && seenContentChars >= 40 && REFERENCE_HEADING_RE.test(trimmed)) {
        inReferences = true;
        found = true;
        excludedChars += lines[i].length + 1;
        continue;
      }
      if (inReferences && APPENDIX_HEADING_RE.test(trimmed)) {
        inReferences = false;
      }
      if (inReferences) excludedChars += lines[i].length + 1;
      else {
        kept.push(lines[i]);
        seenContentChars += trimmed.length;
      }
    }
    return {
      text: kept.join('\n'),
      excludedReferenceCharacters: excludedChars,
      referenceSectionFound: found,
    };
  }

  // Format: "Preferred Term = alias one | alias two". The glossary is an explicit user
  // decision, so unlike heuristic alias scoring it is allowed to unify terms automatically.
  function parseGlossary(input) {
    if (Array.isArray(input)) return input;
    var groups = [];
    String(input || '').split(/\r?\n/).forEach(function (line, index) {
      var clean = line.trim();
      if (!clean || clean[0] === '#') return;
      var eq = clean.indexOf('=');
      if (eq <= 0) return;
      var preferred = normalizeWhitespace(clean.slice(0, eq));
      var aliases = clean.slice(eq + 1).split('|').map(normalizeWhitespace).filter(Boolean);
      if (!preferred || !aliases.length) return;
      var seen = {};
      aliases = aliases.filter(function (alias) {
        var norm = normalizeTermSurface(alias);
        if (!norm || norm === normalizeTermSurface(preferred) || seen[norm]) return false;
        seen[norm] = true;
        return true;
      });
      if (aliases.length) groups.push({ preferred: preferred, aliases: aliases, line: index + 1 });
    });
    return groups;
  }

  function buildGlossaryIndex(input) {
    var groups = parseGlossary(input);
    var byPreferred = {}, redirect = {};
    groups.forEach(function (group) {
      var preferredNorm = normalizeTermSurface(group.preferred);
      if (!preferredNorm) return;
      var normalized = {
        preferred: group.preferred,
        preferredNorm: preferredNorm,
        aliases: group.aliases.slice(),
        memberNorms: [preferredNorm],
      };
      group.aliases.forEach(function (alias) {
        var aliasNorm = normalizeTermSurface(alias);
        if (!aliasNorm || normalized.memberNorms.indexOf(aliasNorm) !== -1) return;
        normalized.memberNorms.push(aliasNorm);
        redirect[aliasNorm] = preferredNorm;
      });
      byPreferred[preferredNorm] = normalized;
    });
    return { groups: groups, byPreferred: byPreferred, redirect: redirect };
  }

  // ---------- candidate term extraction ----------
  // Multi-word Title-Case noun phrases (2-5 words) and standalone acronym-like tokens
  // (2-6 uppercase letters). Deliberately loose — no real POS tagger is available client-side —
  // filtered down later by repetition count and definition/variable evidence, so an overly
  // permissive extractor here is fine as long as the downstream scoring is conservative.
  var TITLECASE_PHRASE_RE = /\b(?:[A-Z][a-zA-Z]*(?:[-\u2010-\u2015][A-Z][a-zA-Z]*)?)(?:[ \t]+(?:of|for|the|in|on|to|a|an)?[ \t]*[A-Z][a-zA-Z]*(?:[-\u2010-\u2015][A-Z][a-zA-Z]*)?){1,4}\b/g;
  var ACRONYM_TOKEN_RE = /\b[A-Z]{2,6}\d{0,2}\b|\b[A-Z][a-z]?[A-Z][a-zA-Z]*\d{1,2}\b/g;

  var TERM_CUE_RE = /\b(?:is|are|was|were)\s+(?:defined\s+as|measured\s+(?:using|by|with|through)|assessed\s+(?:using|through|via)|operationalized\s+as|comprised?\s+of|comprises?|consists?\s+of|includes?|composed\s+of)\b|\b(?:merupakan|adalah|merujuk\s+pada|didefinisikan\s+sebagai|diukur\s+menggunakan|dinilai\s+melalui|dioperasionalkan\s+sebagai|terdiri\s+dari|mencakup|meliputi)\b/i;
  var RELATION_CUE_RE = /\b(?:predicts?|influences|affects|is\s+associated\s+with|are\s+associated\s+with|memprediksi|memengaruhi|mempengaruhi|berhubungan\s+dengan)\b/i;

  function cleanCueCandidate(raw, takeFromEnd) {
    var s = String(raw || '').split(PARA_BOUNDARY).pop();
    s = s.split(/[.;:!?]/).pop().split(',').pop();
    s = s.replace(/\s*\([A-Za-z]{2,8}\)\s*$/, '');
    s = s.replace(/^\s*(?:H\d+[a-z]?\s*[:.)-]?\s*)/i, '')
      .replace(/^\s*(?:in\s+this\s+study|this\s+study|the\s+present\s+study|dalam\s+penelitian\s+ini|penelitian\s+ini)\s*,?\s*/i, '')
      .replace(/^\s*(?:the|a|an|suatu|sebuah)\s+(?:construct|concept|variable|term|konstruk|konsep|variabel|istilah)\s+/i, '')
      .replace(/^\s*(?:the|a|an|suatu|sebuah)\s+/i, '')
      .trim();
    var tokens = s.match(/[\p{L}\p{N}]+(?:[-\u2010-\u2015][\p{L}\p{N}]+)*/gu) || [];
    while (tokens.length && STOPWORDS.has(tokens[0].toLowerCase())) tokens.shift();
    while (tokens.length && STOPWORDS.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop();
    if (tokens.length > 6) tokens = takeFromEnd ? tokens.slice(-6) : tokens.slice(0, 6);
    var candidate = tokens.join(' ');
    if (!candidate || isGenericNonConceptCandidate(candidate)) return '';
    if (tokens.length === 1 && (tokens[0].length < 4 || STOPWORDS.has(tokens[0].toLowerCase()))) return '';
    return candidate;
  }

  function extractCueBackedTerms(text) {
    var occurrences = {}, cueNorms = {};
    function add(surface, absoluteStart) {
      var norm = normalizeTermSurface(surface);
      if (!norm || isGenericNonConceptCandidate(norm)) return;
      if (!occurrences[norm]) occurrences[norm] = [];
      occurrences[norm].push({ surface: surface, start: absoluteStart, end: absoluteStart + surface.length, cueBacked: true });
      cueNorms[norm] = true;
    }
    splitSentences(text).forEach(function (sentence) {
      var cue = TERM_CUE_RE.exec(sentence.text);
      if (cue) {
        var before = sentence.text.slice(0, cue.index);
        var subject = cleanCueCandidate(before, true);
        if (subject) add(subject, sentence.start + Math.max(0, before.lastIndexOf(subject)));
      }
      var relation = RELATION_CUE_RE.exec(sentence.text);
      if (!relation) return;
      var left = sentence.text.slice(0, relation.index);
      var right = sentence.text.slice(relation.index + relation[0].length).split(/\b(?:and|dan|serta|but|tetapi)\b|[.;]/i)[0];
      var subject2 = cleanCueCandidate(left, true);
      var object2 = cleanCueCandidate(right, false);
      if (subject2) add(subject2, sentence.start + Math.max(0, left.lastIndexOf(subject2)));
      if (object2) {
        var objectOffset = sentence.text.indexOf(object2, relation.index + relation[0].length);
        add(object2, sentence.start + Math.max(relation.index + relation[0].length, objectOffset));
      }
    });
    return { occurrences: occurrences, cueNorms: cueNorms };
  }

  function extractCandidateTerms(text) {
    var occurrences = {}; // normalizedForm -> [{surface, start, end}]
    var FIRST_WORD_REJECT = new Set([
      'the', 'a', 'an', 'in', 'on', 'at', 'for', 'to', 'of', 'and', 'or', 'but', 'with', 'from',
      'by', 'as', 'this', 'that', 'these', 'those', 'it', 'its', 'if', 'when', 'while', 'because',
      'since', 'although', 'though', 'however', 'therefore', 'thus', 'moreover', 'furthermore',
      'additionally', 'consequently', 'meanwhile', 'according', 'based', 'given', 'during',
      'after', 'before', 'within', 'among', 'between', 'across', 'such', 'each', 'both', 'all',
      'some', 'many', 'most', 'first', 'second', 'third', 'finally', 'overall', 'specifically',
      'not', 'no', 'very', 'highly', 'relatively', 'particularly', 'significantly', 'only', 'also',
    ]);
    var m;
    TITLECASE_PHRASE_RE.lastIndex = 0;
    while ((m = TITLECASE_PHRASE_RE.exec(text)) !== null) {
      var surface = m[0].trim();
      if (surface.indexOf(PARA_BOUNDARY) !== -1) continue; // spans a paragraph/table-cell boundary — not a real phrase
      var wordCount = surface.split(/\s+/).length;
      if (wordCount < 2 || wordCount > 5) continue;
      // Skip phrases that are entirely stopword-like or look like a sentence start artifact
      // (single capitalized word only, e.g. just "The") — TITLECASE_PHRASE_RE already requires
      // 2+ words so this mostly guards against noise from headings in ALL CAPS text.
      if (surface === surface.toUpperCase()) continue; // ALL CAPS -> likely a heading, not a term
      var firstWord = surface.split(/\s+/)[0].toLowerCase();
      if (FIRST_WORD_REJECT.has(firstWord)) continue; // "In the Indonesian" etc. — sentence-start noise, not a term
      var norm = normalizeTermSurface(surface);
      if (!norm || norm.split(' ').length < 2) continue;
      if (!occurrences[norm]) occurrences[norm] = [];
      occurrences[norm].push({ surface: surface, start: m.index, end: m.index + surface.length });
    }
    ACRONYM_TOKEN_RE.lastIndex = 0;
    var acronymOccurrences = {};
    while ((m = ACRONYM_TOKEN_RE.exec(text)) !== null) {
      var acr = m[0];
      // Exclude common false positives: roman numerals in headings, unit abbreviations handled
      // elsewhere, and pure numbers already excluded by the regex requiring 2+ letters first.
      if (!acronymOccurrences[acr]) acronymOccurrences[acr] = [];
      acronymOccurrences[acr].push({ surface: acr, start: m.index, end: m.index + acr.length });
    }
    var cueBacked = extractCueBackedTerms(text);
    Object.keys(cueBacked.occurrences).forEach(function (norm) {
      if (!occurrences[norm]) occurrences[norm] = [];
      cueBacked.occurrences[norm].forEach(function (occ) {
        if (!occurrences[norm].some(function (existing) { return existing.start === occ.start && existing.end === occ.end; })) {
          occurrences[norm].push(occ);
        }
      });
    });
    return { phraseOccurrences: occurrences, acronymOccurrences: acronymOccurrences, cueNorms: cueBacked.cueNorms };
  }

  // ---------- acronym/alias pairing (Level 2: safe, automatic) ----------
  // "Full Term (ABC)" or "ABC (Full Term)" — very low false-positive risk, since the acronym's
  // letters are checked against the full term's initials.
  function initialsOf(phrase) {
    return phrase.split(/[\s\-\u2010-\u2015]+/)
      .filter(function (w) { return w && !/^(of|for|the|and|in|on|to|a|an|dan|di|ke|dari)$/i.test(w); })
      .map(function (w) { return w[0].toUpperCase(); })
      .join('');
  }

  function findAcronymAliases(text) {
    var aliases = []; // { fullTerm, acronym, position }
    // [ \t]+ only (no \n at all) between chained words: a real multi-word term is always
    // written on one continuous line — allowing \s+ here let table cells (which mammoth renders
    // as separate blank-line-delimited paragraphs, e.g. "CR\n\nAVE\n\nShort Video Addiction")
    // get wrongly chained into one bogus "full term".
    var re1 = /\b((?:[A-Z][a-zA-Z]+(?:[-\u2010-\u2015][A-Z][a-zA-Z]+)?(?:[ \t]+(?:of|for|the|and)?[ \t]*)?){1,5})[ \t]*\(([A-Za-z]{2,6})\)/g;
    var m;
    while ((m = re1.exec(text)) !== null) {
      if (m[0].indexOf(PARA_BOUNDARY) !== -1) continue; // spans a paragraph/table-cell boundary
      var fullTerm = m[1].trim().replace(/\s+$/, '');
      var acr = m[2];
      if (acr !== acr.toUpperCase() && !/^[A-Z][a-z]?[A-Z]+$|^[A-Z]+[a-z]?[A-Z]$/.test(acr)) continue; // reject plain lowercase words in parens
      var wordsAll = fullTerm.split(/[\s\-\u2010-\u2015]+/).map(function (w) { return w[0].toUpperCase(); }).join('');
      var initials = initialsOf(fullTerm);
      // Accept if the acronym's letters plausibly come from the full term: either from the
      // content-word initials (standard case, e.g. "Emotion Regulation Difficulties" -> "ERD"),
      // or from EVERY word's first letter including connectors (covers "Fear of Failure" -> "FoF",
      // where the lowercase "o" comes from "of").
      var acrUpper = acr.toUpperCase();
      var initialsMatch = initials === acrUpper;
      var allWordsMatch = wordsAll === acrUpper;
      if (initialsMatch || allWordsMatch) {
        aliases.push({ fullTerm: fullTerm, acronym: acr, position: m.index });
      }
    }
    var re2 = /\b([A-Z]{2,6})\s*\(((?:[A-Z][a-zA-Z]+\s*){1,5})\)/g;
    while ((m = re2.exec(text)) !== null) {
      var acr2 = m[1];
      var fullTerm2 = m[2].trim();
      var reverseInitials = initialsOf(fullTerm2);
      var reverseAllWords = fullTerm2.split(/[\s\-\u2010-\u2015]+/).map(function (w) { return w[0].toUpperCase(); }).join('');
      if (reverseInitials === acr2 || reverseAllWords === acr2) {
        aliases.push({ fullTerm: fullTerm2, acronym: acr2, position: m.index });
      }
    }
    return aliases;
  }

  // ---------- Section 1: definition detection ----------
  var DEFINITION_PATTERNS = {
    conceptual: /\b(is|are|was|were)\s+defined\s+as\b|\brefers?\s+to\b|\bis\s+the\b|\bmeans?\b|\b(?:comprises?|comprised\s+of|consists?\s+of|includes?|is\s+composed\s+of)\b|\b(?:proposes?|posits?|suggests?|argues?|states?|explains?|assumes?)\s+that\b|\bmerupakan\b|\badalah\b|\bmerujuk\s+pada\b|\bdidefinisikan\s+sebagai\b|\b(?:terdiri\s+dari|mencakup|meliputi)\b|\bditandai\s+dengan\b/i,
    operational: /\bmeasured\s+(?:using|by|with|through)\b|\bassessed\s+(?:using|through|via)\b|\boperationalized\s+as\b|\bdiukur\s+menggunakan\b|\bdinilai\s+melalui\b|\bdioperasionalkan\s+sebagai\b|\bindicator[s]?\s+(?:of|for)\b/i,
    role: /\b(?:acts?|serves?|functions?)\s+as\s+(?:a|an)?\s*(?:mediator|moderator|predictor|antecedent|outcome|independent|dependent|exogenous|endogenous)\b|\b(?:is|are)\s+(?:a|an)?\s*(?:mediating|moderating|predictor|independent|dependent|exogenous|endogenous)\s+variable\b|\bberfungsi\s+sebagai\s+variabel\b|\bbertindak\s+sebagai\b|\bmenjadi\s+variabel\b/i,
  };
  // Weak/generic cues ("is the", "means") are far more prone to false matches (any sentence with
  // "X is the ..." isn't necessarily defining X) than an explicit definitional verb — scored
  // lower so a borderline match can actually fall below the "not a definition" threshold instead
  // of every pattern match landing in the same high band regardless of how weak the cue was.
  var WEAK_DEFINITION_CUE = /^\s*(?:is\s+the|means?)\b/i;
  var SECTION_HEADING_RE = /\b(method|methodology|instrumentation|conceptual\s+framework|definition|metode|instrumen)\b/i;
  // Reversed operational phrasing: the instrument is named FIRST, then "was used to measure X" /
  // "digunakan untuk mengukur X" — the cue sits BEFORE the term, not after it like every other
  // pattern here, so it needs its own check against the text preceding the occurrence.
  var REVERSED_OPERATIONAL_RE = /(?:was|were|is|are)\s+used\s+to\s+(?:measure|assess)\s*$|digunakan\s+(?:untuk\s+)?mengukur\s*$/i;

  function detectDefinitions(text, termNorm, occurrences, sectionHints) {
    var found = [];
    occurrences.forEach(function (occ) {
      // find the sentence containing this occurrence
      var sentences = sectionHints.sentences;
      for (var i = 0; i < sentences.length; i++) {
        var s = sentences[i];
        if (occ.start >= s.start && occ.start < s.start + s.text.length) {
          var sentText = s.text;
          var relPos = occ.start - s.start;
          // Reversed operational: "<Instrument Name> was used to measure <term>." — check the
          // text immediately BEFORE the term for the cue, and if found, the "definition" is the
          // instrument name phrase right before the cue itself.
          var before = sentText.slice(0, relPos);
          var revMatch = REVERSED_OPERATIONAL_RE.exec(before);
          if (revMatch && before.length - revMatch.index < 80) {
            var instrumentPhrase = before.slice(0, revMatch.index).trim().replace(/^.*[.;]\s*/, '');
            if (instrumentPhrase.split(/\s+/).length >= 2) {
              found.push({
                type: 'operational', text: instrumentPhrase.slice(-160).split(PARA_BOUNDARY).join(' '),
                sentence: sentText.slice(0, 260).split(PARA_BOUNDARY).join(' '), score: 0.78, confidence: 'possible',
              });
            }
          }
          // require the definitional pattern to appear reasonably close AFTER the term
          var after = sentText.slice(relPos);
          for (var type in DEFINITION_PATTERNS) {
            var pat = DEFINITION_PATTERNS[type];
            var pm = pat.exec(after);
            if (pm && pm.index < 60) {
              var defText = after.slice(pm.index + pm[0].length).trim().replace(/^[:,]\s*/, '');
              if (defText.length >= 4) {
                var definitional = WEAK_DEFINITION_CUE.test(pm[0]) ? 0.2 : 0.4;
                var syntactic = relPos < 30 ? 0.25 : 0.1;
                var sectionRel = SECTION_HEADING_RE.test(sectionHints.nearbyHeading || '') ? 0.2 : 0.08;
                var explanatory = defText.split(/\s+/).length >= 4 ? 0.15 : 0.05;
                var score = Math.min(1, Math.round((definitional + syntactic + sectionRel + explanatory) * 100) / 100);
                // Spec's own decision rule: score < 0.60 means "bukan definisi" — not a weak
                // definition, NOT a definition at all. Discard rather than keep-but-flag-low.
                if (score >= 0.60) {
                  found.push({
                    type: type, text: defText.slice(0, 220).split(PARA_BOUNDARY).join(' '), sentence: sentText.slice(0, 260).split(PARA_BOUNDARY).join(' '),
                    score: score, confidence: score >= 0.80 ? 'strong' : 'possible',
                  });
                }
              }
              break;
            }
          }
          break;
        }
      }
    });
    return found;
  }

  // ---------- Section 3: variable-candidate evidence ----------
  var MEASUREMENT_RE = /\bmeasured\s+(?:using|by|with)\b|\bscale\b|\bdiukur\s+menggunakan\b|\binstrument\b/i;
  var HYPOTHESIS_RE = /\bH\d+[a-z]?\s*[:.]|\bhypothesiz(?:e|ed|es)\b|\bpredicts?\b|\b(?:is|are)\s+associated\s+with\b|\beffect\s+of\b|\binfluences\b|\brelationship\s+between\b|\bpengaruh\b|\bhubungan\s+antara\b|\b(?:memprediksi|memengaruhi|mempengaruhi|berhubungan\s+dengan)\b/i;
  var STATS_RE = /\bcoefficient\b|\bloading\b|\bR\s*[²2]\b|\bp\s*[<>=]\s*0?\.\d+\b|\bβ\s*=|\bpath\s+coefficient\b/i;
  var MODEL_SECTION_RE = /\b(hypothes[ie]s|conceptual\s+framework|instrumentation|structural\s+model|sem\b|regression)\b/i;
  var ROLE_LANGUAGE_RE = /\b(?:mediat(?:or|es|ing)|moderat(?:or|es|ing)|predictor|antecedent|exogenous|endogenous|independent\s+variable|dependent\s+variable|outcome\s+variable)\b|\bvariabel\s+(?:mediasi|moderasi|independen|dependen)\b/i;

  function evaluateVariableEvidence(text, occurrences, sentences, hasTableStatEvidence) {
    var measurementHit = 0, hypothesisHit = 0, modelRelHit = 0, statsHit = 0, sectionHit = 0, roleHit = 0;
    occurrences.forEach(function (occ) {
      for (var i = 0; i < sentences.length; i++) {
        var s = sentences[i];
        if (occ.start >= s.start && occ.start < s.start + s.text.length) {
          if (MEASUREMENT_RE.test(s.text)) measurementHit++;
          if (HYPOTHESIS_RE.test(s.text)) hypothesisHit++;
          if (STATS_RE.test(s.text)) statsHit++;
          if (ROLE_LANGUAGE_RE.test(s.text)) roleHit++;
          if (MODEL_SECTION_RE.test(s.text)) { modelRelHit++; sectionHit++; }
          break;
        }
      }
    });
    // Presence-based, not average-per-mention: a term repeated 20 times as plain prose but with
    // ONE clear "measured using..." sentence is still clearly a measured variable — dividing by
    // total occurrence count would wrongly crush that signal toward zero.
    var measurement = measurementHit > 0 ? 1 : 0;
    var hypothesis = hypothesisHit > 0 ? 1 : 0;
    // "model relation" evidence = explicit hypothesis/model-section language OR being named with
    // an explicit structural role (mediator/predictor/...) — both count as the same dimension
    // from the spec's Section 3 evidence list ("menjadi mediator/moderator", "muncul dalam
    // hipotesis").
    // Berada di kalimat yang menyebut "model"/"SEM" hanyalah konteks bagian, bukan bukti bahwa
    // istilah tersebut benar-benar memiliki relasi struktural. Relasi butuh verba hipotesis atau
    // peran eksplisit; ini mencegah label seperti "Model A" menjadi calon variabel.
    var modelRel = (hypothesisHit > 0 || roleHit > 0) ? 1 : 0;
    // Statistical evidence: an in-sentence coefficient/loading/p-value mention, OR (when the
    // caller supplies it — see extractDocxTableRows for the DOCX-upload pathway) this term's row
    // in an actual loadings/path-coefficient TABLE, which sentence-level scanning alone can never
    // see since a table row rarely repeats the term name in the same "sentence" as its numbers.
    var stats = (statsHit > 0 || hasTableStatEvidence) ? 1 : 0;
    var section = sectionHit > 0 ? 1 : 0;
    var repetition = Math.min(1, occurrences.length / 5);
    var score = 0.25 * measurement + 0.20 * hypothesis + 0.20 * modelRel + 0.15 * stats + 0.10 * section + 0.10 * repetition;
    return {
      score: Math.round(score * 100) / 100,
      measurement: measurement,
      hypothesis: hypothesis,
      modelRelation: modelRel,
      statistics: stats,
      sectionContext: section,
      roleLanguage: roleHit > 0 ? 1 : 0,
      repetition: Math.round(repetition * 100) / 100,
      directEvidenceCount: measurement + hypothesis + modelRel + stats + (roleHit > 0 ? 1 : 0),
    };
  }

  function scoreVariableEvidence(text, occurrences, sentences, hasTableStatEvidence) {
    return evaluateVariableEvidence(text, occurrences, sentences, hasTableStatEvidence).score;
  }

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Re-scans the whole text case-insensitively for every surface variant of a concept's
  // normalized form (allowing hyphen-vs-space and singular/plural to differ, since that's
  // exactly what normalizeTermSurface() already folds together) — this is what lets the engine
  // catch "Short-Video Addiction" vs "short video addiction" vs "short-video addictions" as the
  // SAME concept written three different ways, instead of only ever seeing the Title-Case form.
  function findAllSurfaceOccurrences(text, normalizedForm) {
    var words = normalizedForm.split(' ');
    var pattern = words.map(function (w) {
      // Mirror the y->ies fold normalizeTermSurface() applies going the other way, so a
      // normalized singular like "difficulty" still matches the plural "difficulties" in the
      // original text (a plain "(?:e?s)?" suffix only covers "s"/"es", not "y"->"ies").
      if (/[^aeiou]y$/.test(w)) return escapeRegex(w.slice(0, -1)) + '(?:y|ies)';
      return escapeRegex(w) + '(?:e?s)?';
    }).join('[\\s\\-\\u2010-\\u2015]+');
    var re = new RegExp('\\b' + pattern + '\\b', 'gi');
    var out = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      if (normalizeTermSurface(m[0]) === normalizedForm) {
        out.push({ surface: m[0], start: m.index, end: m.index + m[0].length });
      }
    }
    return out;
  }

  function chooseCanonicalSurface(occurrences, preferred) {
    if (preferred) return preferred;
    var counts = {};
    (occurrences || []).forEach(function (occ) {
      counts[occ.surface] = (counts[occ.surface] || 0) + 1;
    });
    var forms = Object.keys(counts);
    if (!forms.length) return '';
    forms.sort(function (a, b) {
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      var aTitle = /^(?:[A-Z][\p{L}\p{N}'’]*)(?:[ \-\u2010-\u2015]+(?:of|for|the|and|in|on|to|a|an|dan|di|ke|dari)?[ \-\u2010-\u2015]*[A-Z][\p{L}\p{N}'’]*)+$/u.test(a);
      var bTitle = /^(?:[A-Z][\p{L}\p{N}'’]*)(?:[ \-\u2010-\u2015]+(?:of|for|the|and|in|on|to|a|an|dan|di|ke|dari)?[ \-\u2010-\u2015]*[A-Z][\p{L}\p{N}'’]*)+$/u.test(b);
      if (aTitle !== bTitle) return bTitle ? 1 : -1;
      return a.length - b.length;
    });
    return forms[0];
  }

  // Kapitalisasi karena posisi di awal kalimat dan bentuk tunggal/jamak sering sah secara
  // gramatikal. Keduanya tetap dicatat sebagai variasi informatif, tetapi hanya perbedaan tanda
  // hubung/tanda baca yang masuk daftar masalah yang perlu tindakan.
  function analyzeSurfaceConsistency(surfaceVariants) {
    var forms = surfaceVariants.map(function (v) { return normalizeWhitespace(v.text); }).filter(Boolean);
    var lower = Array.from(new Set(forms.map(function (s) { return s.toLowerCase(); })));
    var hyphenStates = Array.from(new Set(forms.map(function (s) { return /[\u2010-\u2015-]/.test(s); })));
    var punctuationForms = Array.from(new Set(forms.map(function (s) {
      return (s.match(/[^\p{L}\p{N}\s\u2010-\u2015-]/gu) || []).join('');
    })));
    var issueTypes = [];
    if (hyphenStates.length > 1) issueTypes.push('HYPHENATION');
    if (punctuationForms.length > 1 && hyphenStates.length === 1) issueTypes.push('PUNCTUATION');
    var informational = [];
    if (lower.length === 1 && forms.length > 1) informational.push('CASE_ONLY');
    else if (!issueTypes.length && forms.length > 1) informational.push('GRAMMATICAL_VARIANT');
    return { actionable: issueTypes.length > 0, issueTypes: issueTypes, informational: informational };
  }

  function contextSnippets(text, occurrences, limit) {
    var seen = {}, out = [];
    (occurrences || []).some(function (occ) {
      var start = Math.max(0, occ.start - 90), end = Math.min(text.length, occ.end + 110);
      var snippet = normalizeWhitespace(text.slice(start, end).split(PARA_BOUNDARY).join(' '));
      if (!snippet || seen[snippet]) return false;
      seen[snippet] = true;
      out.push({ text: snippet, start: occ.start });
      return out.length >= (limit || 3);
    });
    return out;
  }

  var INSTRUMENT_NAME_RE = /\b(scale|inventory|questionnaire|index|survey|checklist)\b/i;
  var EXAMPLE_CUE_RE = /\b(?:such as|e\.g\.,?|for example|including|like)\s*$/i;

  function isExampleMention(termNorm, occurrences, sentences) {
    return occurrences.some(function (occ) {
      for (var i = 0; i < sentences.length; i++) {
        var s = sentences[i];
        if (occ.start >= s.start && occ.start < s.start + s.text.length) {
          var before = s.text.slice(0, occ.start - s.start);
          return EXAMPLE_CUE_RE.test(before.slice(-40));
        }
      }
      return false;
    });
  }

  function classifyType(termNorm, score, isInstrumentReferenced, isAcronymAlias, isDefined, hasIndicators, isExample) {
    if (isAcronymAlias) return 'ALIAS';
    if (/^[a-z]+\d$/.test(termNorm.replace(/\s+/g, ''))) return 'INDICATOR'; // e.g. "sva1"
    // Checked before the variable-score branches: a term can score reasonably high on generic
    // "variable-ish" evidence (repetition, appearing near model/hypothesis language) purely
    // because it's the NAME of the measurement tool used for something else, e.g. "the Short-
    // Video Dependence Scale" showing up repeatedly across the instrumentation section.
    if (isInstrumentReferenced || INSTRUMENT_NAME_RE.test(termNorm)) return 'INSTRUMENT';
    if (isExample) return 'EXAMPLE';
    if (score >= 0.75) return hasIndicators ? 'CONSTRUCT_VARIABLE' : 'OBSERVED_VARIABLE';
    if (score >= 0.50) return 'CANDIDATE_VARIABLE';
    if (isDefined) return 'GENERAL_CONCEPT';
    return 'UNCLASSIFIED';
  }

  // ---------- relation graph: PREDICTS / MEDIATES / RELATED_TO ----------
  // The piece the original spec calls "bangun graph hubungan antarkonsep" — without this, there
  // is no way to implement relation_neighborhood_similarity or most of the negative-evidence
  // checks ("dihubungkan oleh panah sebab-akibat", etc.), so alias flagging was structurally
  // incomplete without it.
  //
  // Rather than trying to regex-capture arbitrary noun phrases around a relational verb (error-
  // prone — noun phrase boundaries are exactly what's hard without a real parser), this finds
  // WHICH ALREADY-KNOWN CONCEPTS are mentioned on either side of the verb within the same
  // sentence, and infers direction from their relative position. That means relation extraction
  // can only ever connect concepts the earlier stages already found — which is the right
  // trade-off here: a missed relation is a smaller problem than a hallucinated one.
  var PREDICTS_VERB_RE = /\b(?:predicts?|influences|affects)\b/i;
  var EFFECT_OF_RE = /\beffect\s+of\b|\bpengaruh\b/i;
  var MEDIATES_BETWEEN_RE = /\bmediat(?:es|ed|ing)\s+the\s+relationship\s+between\b/i;
  var RELATIONSHIP_BETWEEN_RE = /\brelationship\s+between\b|\bhubungan\s+antara\b/i;

  var MAX_RELATION_DISTANCE = 120; // chars — keeps relation extraction inside one clause, not the whole (possibly long, multi-clause) sentence

  var THEORY_NAME_RE = /\b(theory|model|framework|approach)\b/i;

  function extractRelations(concepts, sentences) {
    var normKeys = Object.keys(concepts);
    var relations = [];

    function mentionsInSentence(sentenceText) {
      var found = [];
      normKeys.forEach(function (norm) {
        var occs = findAllSurfaceOccurrences(sentenceText, norm);
        if (occs.length) found.push({ norm: norm, start: occs[0].start });
      });
      found.sort(function (a, b) { return a.start - b.start; });
      return found;
    }

    sentences.forEach(function (s) {
      var mentions = mentionsInSentence(s.text);
      if (mentions.length < 2) return;

      // A compound "mediated the relationship between X and Y and between Z and W" has more
      // than one "between", and the simple "take the first two mentions after between" approach
      // below would mispair concepts across the two clauses. Skip rather than guess wrong.
      var betweenCount = (s.text.match(/\bbetween\b/gi) || []).length;
      if (MEDIATES_BETWEEN_RE.test(s.text) && betweenCount === 1) {
        var mIdx = s.text.search(MEDIATES_BETWEEN_RE);
        var before = mentions.filter(function (m) { return m.start < mIdx; });
        var after = mentions.filter(function (m) { return m.start >= mIdx && m.start - mIdx <= MAX_RELATION_DISTANCE; });
        if (before.length && after.length >= 2) {
          var mediator = before[before.length - 1].norm, b = after[0].norm, c = after[1].norm;
          if (mediator !== b && mediator !== c && b !== c) {
            relations.push({ type: 'MEDIATES', subject: mediator, between: [b, c], sentence: s.text.slice(0, 200) });
            relations.push({ type: 'PREDICTS', subject: b, object: mediator, sentence: s.text.slice(0, 200), inferred: true });
            relations.push({ type: 'PREDICTS', subject: mediator, object: c, sentence: s.text.slice(0, 200), inferred: true });
          }
        }
        return;
      }
      if (MEDIATES_BETWEEN_RE.test(s.text)) return; // compound "between...and between..." — skip, see above
      var verbMatch = PREDICTS_VERB_RE.test(s.text) ? PREDICTS_VERB_RE : (EFFECT_OF_RE.test(s.text) ? EFFECT_OF_RE : null);
      if (verbMatch) {
        var vIdx = s.text.search(verbMatch);
        var before2 = mentions.filter(function (m) { return m.start < vIdx && vIdx - m.start <= MAX_RELATION_DISTANCE; });
        var after2 = mentions.filter(function (m) { return m.start >= vIdx && m.start - vIdx <= MAX_RELATION_DISTANCE; });
        if (before2.length && after2.length) {
          // A theory/model/framework name positioned right before a relational verb almost
          // always describes what the theory EXPLAINS or provides a lens for, not a literal
          // causal claim it makes itself — skip it as a candidate subject and fall back to an
          // earlier concept mention if there is one, rather than asserting "TPB predicts X".
          var subjCandidates = before2.slice().reverse().filter(function (m) {
            return !THEORY_NAME_RE.test(concepts[m.norm].canonicalSurface);
          });
          if (!subjCandidates.length) return;
          var subj = subjCandidates[0].norm;
          after2.forEach(function (o) {
            if (o.norm !== subj) relations.push({ type: 'PREDICTS', subject: subj, object: o.norm, sentence: s.text.slice(0, 200) });
          });
        }
        return;
      }
      if (RELATIONSHIP_BETWEEN_RE.test(s.text)) {
        var bIdx = s.text.search(RELATIONSHIP_BETWEEN_RE);
        var after3 = mentions.filter(function (m) { return m.start >= bIdx && m.start - bIdx <= MAX_RELATION_DISTANCE; });
        if (after3.length >= 2 && after3[0].norm !== after3[1].norm) {
          relations.push({ type: 'RELATED_TO', subject: after3[0].norm, object: after3[1].norm, sentence: s.text.slice(0, 200) });
        }
      }
    });

    // dedupe identical (type, subject, object) triples
    var seen = {};
    return relations.filter(function (r) {
      var key = r.type + '|' + r.subject + '|' + (r.object || r.between.join(','));
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  // A directed PREDICTS/MEDIATES edge between two DIFFERENT concepts is the strongest possible
  // signal that they are NOT the same concept — matches the spec's negative-evidence rule
  // "keduanya dihubungkan oleh panah sebab-akibat" directly.
  function hasCausalEdge(relations, normA, normB) {
    return relations.some(function (r) {
      if (r.type === 'PREDICTS') return (r.subject === normA && r.object === normB) || (r.subject === normB && r.object === normA);
      if (r.type === 'MEDIATES') return r.subject === normA ? r.between.indexOf(normB) !== -1 : (r.subject === normB && r.between.indexOf(normA) !== -1);
      return false;
    });
  }

  // Structural role, derived purely from the concept's position in the relation graph —
  // matches the spec's desired "roles" output field (exogenous_variable / mediator / outcome /
  // predictor). A concept can hold more than one role if the text is inconsistent about it
  // (worth surfacing, not hiding).
  function deriveRoles(norm, relations) {
    var roles = [];
    var isSubjectOfPredicts = relations.some(function (r) { return r.type === 'PREDICTS' && r.subject === norm; });
    var isObjectOfPredicts = relations.some(function (r) { return r.type === 'PREDICTS' && r.object === norm; });
    var isMediator = relations.some(function (r) { return r.type === 'MEDIATES' && r.subject === norm; });
    if (isMediator) roles.push('mediator');
    if (isSubjectOfPredicts && !isObjectOfPredicts) roles.push('exogenous_variable / predictor');
    if (isObjectOfPredicts && !isSubjectOfPredicts) roles.push('outcome_variable');
    if (isSubjectOfPredicts && isObjectOfPredicts && !isMediator) roles.push('intermediate_variable');
    return roles;
  }

  // ---------- Level 3: lexical equivalence flagging (NEVER auto-merged) ----------
  function wordSet(termNorm) {
    return new Set(termNorm.split(' ').filter(function (w) { return w && !STOPWORDS.has(w); }));
  }

  function jaccard(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 0;
    var inter = 0;
    setA.forEach(function (x) { if (setB.has(x)) inter++; });
    var union = setA.size + setB.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  function levenshteinRatio(a, b) {
    var m = a.length, n = b.length;
    if (m === 0 || n === 0) return 0;
    var dp = [];
    for (var i = 0; i <= m; i++) dp.push([i]);
    for (var j = 0; j <= n; j++) dp[0][j] = j;
    for (var i2 = 1; i2 <= m; i2++) {
      for (var j2 = 1; j2 <= n; j2++) {
        dp[i2][j2] = a[i2 - 1] === b[j2 - 1] ? dp[i2 - 1][j2 - 1] : 1 + Math.min(dp[i2 - 1][j2 - 1], dp[i2 - 1][j2], dp[i2][j2 - 1]);
      }
    }
    var dist = dp[m][n];
    return 1 - dist / Math.max(m, n);
  }

  // ---------- "semantic_similarity" approximation: curated academic synonym clusters ----------
  // HONEST LIMITATION (see file header): there is no real embedding model here. This is a
  // hand-curated list of word clusters common in social-science/psychology/education/business
  // research papers — it will correctly catch KNOWN synonym pairs ("dishonesty" ~ "misconduct")
  // but will NOT generalize to a synonym pair it doesn't already contain. It is still a genuine,
  // meaningful improvement over edit-distance (which only measures spelling closeness, not
  // meaning at all) for the pairs it does cover, and unlike edit-distance it correctly does NOT
  // treat spelling-similar-but-meaning-different words (e.g. "addiction" vs "affliction") as close.
  var SYNONYM_CLUSTERS = [
    ['dishonesty', 'misconduct', 'cheating', 'fraud', 'deception', 'dishonest'],
    ['addiction', 'dependence', 'dependency', 'compulsion'],
    ['difficulty', 'difficulties', 'problem', 'problems', 'issue', 'issues', 'struggle', 'struggles'],
    ['regulation', 'control', 'management', 'regulating'],
    ['skill', 'skills', 'ability', 'abilities', 'competence', 'competency', 'competencies', 'proficiency', 'kemampuan', 'kompetensi'],
    ['behavior', 'behaviour', 'behaviors', 'behaviours', 'conduct', 'perilaku'],
    ['intention', 'intentions', 'intent', 'willingness', 'readiness', 'niat', 'minat'],
    ['perception', 'perceptions', 'perceived', 'attitude', 'attitudes', 'view', 'views'],
    ['failure', 'failures', 'setback', 'setbacks', 'shortcoming', 'shortcomings'],
    ['fear', 'anxiety', 'worry', 'apprehension', 'dread'],
    ['satisfaction', 'contentment', 'fulfillment', 'fulfilment', 'kepuasan'],
    ['engagement', 'involvement', 'participation', 'engagment'],
    ['motivation', 'drive', 'incentive'],
    ['performance', 'achievement', 'attainment', 'kinerja', 'pencapaian'],
    ['effectiveness', 'efficacy', 'effectivenes'],
    ['awareness', 'consciousness', 'mindfulness'],
    ['norm', 'norms', 'standard', 'standards', 'expectation', 'expectations'],
    ['influence', 'impact', 'effect', 'effects', 'pengaruh', 'dampak'],
    ['stress', 'strain', 'pressure', 'tension'],
    ['wellbeing', 'wellness', 'welfare'],
    ['commitment', 'dedication', 'devotion'],
    ['trust', 'confidence', 'reliance', 'kepercayaan'],
    ['support', 'assistance', 'help', 'aid', 'dukungan', 'bantuan'],
    ['communication', 'interaction', 'exchange'],
    ['knowledge', 'understanding', 'comprehension'],
    ['perception', 'awareness', 'recognition'],
    ['procrastination', 'delay', 'postponement', 'avoidance'],
    ['loneliness', 'isolation', 'solitude'],
    ['resilience', 'resiliency', 'hardiness'],
    ['burnout', 'exhaustion', 'fatigue'],
    ['self-esteem', 'self esteem', 'self-worth', 'self worth'],
    ['self-efficacy', 'self efficacy', 'self-confidence', 'self confidence'],
    ['adoption', 'acceptance', 'uptake'],
    ['usage', 'use', 'utilization', 'utilisation', 'penggunaan', 'pemakaian'],
    ['dependency', 'reliance', 'overreliance'],
    ['quality', 'qualities', 'kualitas', 'mutu'],
    ['system', 'systems', 'sistem'],
    ['factor', 'factors', 'faktor'],
    ['characteristic', 'characteristics', 'karakteristik'],
    ['disorder', 'condition', 'syndrome'],
    ['symptom', 'symptoms', 'indication', 'indications'],
    ['intervention', 'treatment', 'therapy'],
    ['outcome', 'outcomes', 'result', 'results', 'consequence', 'consequences'],
    ['antecedent', 'antecedents', 'predictor', 'predictors', 'determinant', 'determinants'],
    ['mediator', 'mediators', 'intermediary'],
    ['moderator', 'moderators', 'modifier'],
    ['construct', 'concept', 'variable'],
  ];
  var SYNONYM_CLUSTER_INDEX = {};
  SYNONYM_CLUSTERS.forEach(function (cluster, idx) {
    cluster.forEach(function (w) { SYNONYM_CLUSTER_INDEX[w] = idx; });
  });

  function synonymAwareSimilarity(wordsA, wordsB) {
    var arrA = Array.from(wordsA), arrB = Array.from(wordsB);
    if (!arrA.length || !arrB.length) return 0;
    function overlapCount(from, against) {
      var matched = 0;
      from.forEach(function (wa) {
        var clusterA = SYNONYM_CLUSTER_INDEX[wa];
        var hit = against.some(function (wb) {
          return wa === wb || (clusterA !== undefined && SYNONYM_CLUSTER_INDEX[wb] === clusterA);
        });
        if (hit) matched++;
      });
      return matched;
    }
    // symmetric: average of "how much of A is covered by B" and "how much of B is covered by A"
    var covA = overlapCount(arrA, arrB) / arrA.length;
    var covB = overlapCount(arrB, arrA) / arrB.length;
    return Math.round(((covA + covB) / 2) * 100) / 100;
  }

  // Negative evidence: if two terms are ever joined by "and"/"dan" in one phrase, or both listed
  // as distinct items in the same short list, that's a strong signal they're being treated as
  // DIFFERENT things by the author — the single most reliable signal available without a real
  // relation graph, per the "kontras dalam satu kalimat" check in the spec.
  function hasContrastEvidence(text, surfaceA, surfaceB) {
    var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    // Plain "X and Y" AND comma-separated enumerations ("X, Y, and Z" / "X, Y, dan Z") — a paper
    // listing several constructs side by side in one sentence ("attitude, social norms, and
    // perceived behavioral control") is explicitly treating each as its own distinct item.
    var re = new RegExp(
      esc(surfaceA) + '\\s*,?\\s+(?:and|dan)\\s+' + esc(surfaceB) + '|' +
      esc(surfaceB) + '\\s*,?\\s+(?:and|dan)\\s+' + esc(surfaceA) + '|' +
      esc(surfaceA) + '\\s*,\\s*' + esc(surfaceB) + '|' + esc(surfaceB) + '\\s*,\\s*' + esc(surfaceA),
      'i');
    return re.test(text);
  }

  // "Discriminant validity" is a specific statistical test authors run PRECISELY to confirm two
  // constructs are empirically distinct — if it's mentioned within the same neighborhood as both
  // terms, that is about as strong a negative signal as this engine can get without a citation-
  // level understanding of what the test actually concluded.
  function hasDiscriminantValidityMention(text, surfaceA, surfaceB) {
    var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    var dvRe = /discriminant\s+validity/gi;
    var reA = new RegExp(esc(surfaceA), 'i');
    var reB = new RegExp(esc(surfaceB), 'i');
    var m;
    while ((m = dvRe.exec(text)) !== null) {
      var windowText = text.slice(Math.max(0, m.index - 400), m.index + 400);
      if (reA.test(windowText) && reB.test(windowText)) return true;
    }
    return false;
  }

  // If both concepts have their own linked indicator items (see indicator-linkage in
  // buildConceptDictionary) and those indicator sets don't overlap at all, the paper is
  // measuring them with entirely separate item sets — a concrete structural difference, not
  // just a wording difference.
  function hasDifferentIndicatorSets(a, b) {
    if (!a.indicators || !b.indicators || !a.indicators.length || !b.indicators.length) return false;
    var setA = new Set(a.indicators.map(function (s) { return s.toLowerCase(); }));
    return !b.indicators.some(function (s) { return setA.has(s.toLowerCase()); });
  }

  // One term is literally an indicator OF the other (e.g. "SVA1" measures "SVA") — never a
  // same-concept candidate, it's a part-of relationship, not identity.
  function isIndicatorOfEachOther(a, b) {
    return (a.indicators && a.indicators.indexOf(b.canonicalSurface) !== -1) ||
      (b.indicators && b.indicators.indexOf(a.canonicalSurface) !== -1);
  }

  // Spec check #1 ("apakah definisinya sama?") means comparing what the definitions actually
  // SAY, not just whether both happen to have one — otherwise two totally different concepts
  // that both merely have SOME definition would score as if their definitions matched.
  function definitionSimilarity(a, b) {
    if (!a.definitions.length || !b.definitions.length) return 0;
    var best = 0;
    a.definitions.forEach(function (da) {
      b.definitions.forEach(function (db) {
        var wsA = new Set(da.text.toLowerCase().split(/\s+/).filter(function (w) { return w.length > 3 && !STOPWORDS.has(w); }));
        var wsB = new Set(db.text.toLowerCase().split(/\s+/).filter(function (w) { return w.length > 3 && !STOPWORDS.has(w); }));
        var sim = jaccard(wsA, wsB);
        if (sim > best) best = sim;
      });
    });
    return best;
  }

  // ---------- DOCX table awareness (optional — only usable when a parsed document.xml is
  // available, i.e. the DOCX-upload pathway, not plain pasted text) ----------
  // Plain-text extraction (mammoth, or a person copy-pasting from Word) flattens every table
  // cell into just another paragraph, so a loadings/path-coefficient table like:
  //   Construct | Loading | CR | AVE
  //   SVA       | 0.85    | 0.90 | 0.75
  // loses all row/column structure — sentence-level scanning can never connect "SVA" to "0.85"
  // because they were never in the same "sentence" to begin with. This reads the RAW DOCX XML
  // (the same way link-engine.js already does for citation-linking) to recover that structure:
  // find tables whose header row looks statistical (Loading/CR/AVE/Alpha/Beta/p-value/...), then
  // record which row-label cells have a numeric value elsewhere in their own row.
  var TABLE_STAT_HEADER_RE = /\b(loading|cr|ave|alpha|rho[-_]?a|beta|coefficient|p[-\s]?value|r\s*[²2]|vif|t[-\s]?stat|t[-\s]?value)\b/i;

  function extractDocxTableRows(xmlDoc) {
    function cellText(tc) {
      var ts = tc.getElementsByTagName('w:t');
      var s = '';
      for (var i = 0; i < ts.length; i++) s += ts[i].textContent;
      return s.trim();
    }
    var results = []; // [{ rowLabel }]
    var tables = xmlDoc.getElementsByTagName('w:tbl');
    for (var t = 0; t < tables.length; t++) {
      var rows = tables[t].getElementsByTagName('w:tr');
      if (rows.length < 2) continue;
      var headerCells = rows[0].getElementsByTagName('w:tc');
      var isStatTable = false;
      for (var h = 0; h < headerCells.length; h++) {
        if (TABLE_STAT_HEADER_RE.test(cellText(headerCells[h]))) { isStatTable = true; break; }
      }
      if (!isStatTable) continue;
      for (var r = 1; r < rows.length; r++) {
        var cells = rows[r].getElementsByTagName('w:tc');
        if (!cells.length) continue;
        var rowLabel = cellText(cells[0]);
        if (!rowLabel) continue;
        var hasNumeric = false;
        for (var c = 1; c < cells.length; c++) {
          if (/\d/.test(cellText(cells[c]))) { hasNumeric = true; break; }
        }
        if (hasNumeric) results.push({ rowLabel: rowLabel });
      }
    }
    return results;
  }

  // Does this concept correspond to a given table row label? Matches on canonical/normalized
  // form or any acronym alias — a loadings table typically labels rows by whichever short form
  // (often the acronym) the author found convenient in that table.
  function conceptMatchesRowLabel(concept, norm, rowLabel) {
    var labelNorm = normalizeTermSurface(rowLabel);
    if (!labelNorm) return false;
    if (labelNorm === norm || labelNorm.indexOf(norm) !== -1 || norm.indexOf(labelNorm) !== -1) return true;
    return concept.aliasAcronyms.some(function (acr) { return acr.toLowerCase() === rowLabel.trim().toLowerCase(); });
  }

  // relation_neighborhood_similarity: do A and B connect to the SAME third concepts in the
  // relation graph (excluding edges between A and B themselves, which is what hasCausalEdge
  // already covers as a hard veto)? Two labels for one real construct tend to show up with
  // near-identical graph neighborhoods; two genuinely different constructs usually don't.
  function relationNeighborhoodSimilarity(relations, normA, normB) {
    function neighborsOf(norm) {
      var set = new Set();
      relations.forEach(function (r) {
        if (r.type === 'PREDICTS') {
          if (r.subject === norm && r.object !== normA && r.object !== normB) set.add(r.object);
          if (r.object === norm && r.subject !== normA && r.subject !== normB) set.add(r.subject);
        }
        if (r.type === 'MEDIATES' && r.subject === norm) {
          r.between.forEach(function (x) { if (x !== normA && x !== normB) set.add(x); });
        }
      });
      return set;
    }
    var nA = neighborsOf(normA), nB = neighborsOf(normB);
    if (nA.size === 0 && nB.size === 0) return 0;
    return jaccard(nA, nB);
  }

  function flagPossibleAliases(text, concepts, relations) {
    relations = relations || [];
    var flagged = [];
    var keys = Object.keys(concepts);
    var blocks = {}, pairSet = {};

    function addBlock(block, norm) {
      if (!blocks[block]) blocks[block] = [];
      if (blocks[block].indexOf(norm) === -1) blocks[block].push(norm);
    }

    // Candidate blocking avoids a full O(n²) comparison. Pairs are scored only when their names
    // share a meaningful token/synonym bucket, a spelling-shape bucket, or an instrument.
    keys.forEach(function (norm) {
      var words = Array.from(wordSet(norm));
      words.forEach(function (word) {
        addBlock('w:' + word, norm);
        if (SYNONYM_CLUSTER_INDEX[word] !== undefined) addBlock('s:' + SYNONYM_CLUSTER_INDEX[word], norm);
      });
      if (norm.length >= 6) addBlock('p:' + norm.slice(0, 4) + ':' + Math.round(norm.length / 5), norm);
      if (concepts[norm].measuredBy) addBlock('m:' + concepts[norm].measuredBy, norm);
    });
    Object.keys(blocks).forEach(function (block) {
      var bucket = blocks[block];
      if (bucket.length > 40) return; // extremely common token: not useful evidence, costly noise
      for (var bi = 0; bi < bucket.length; bi++) {
        for (var bj = bi + 1; bj < bucket.length; bj++) {
          var ordered = [bucket[bi], bucket[bj]].sort();
          pairSet[ordered[0] + '||' + ordered[1]] = ordered;
        }
      }
    });

    var candidatePairs = Object.keys(pairSet).map(function (key) { return pairSet[key]; });
    candidatePairs.forEach(function (pair) {
        var normA = pair[0], normB = pair[1];
        var a = concepts[normA], b = concepts[normB];
        if (a.acronymOf || b.acronymOf) return; // already resolved via Level 2
        // Hard vetos: no similarity score can override these regardless of how high it scores.
        if (hasCausalEdge(relations, normA, normB)) return;
        if (isIndicatorOfEachOther(a, b)) return;
        var wsA = wordSet(normA), wsB = wordSet(normB);
        var lexSim = jaccard(wsA, wsB);
        var editSim = levenshteinRatio(normA, normB);
        var semanticSim = synonymAwareSimilarity(wsA, wsB);
        if (lexSim < 0.15 && editSim < 0.55 && semanticSim < 0.4) return; // clearly unrelated
        var measurementSim = (a.measuredBy && b.measuredBy && a.measuredBy === b.measuredBy) ? 1 : 0;
        var defSim = definitionSimilarity(a, b);
        var relSim = relationNeighborhoodSimilarity(relations, normA, normB);
        var contrast = hasContrastEvidence(text, a.canonicalSurface, b.canonicalSurface);
        var discriminant = hasDiscriminantValidityMention(text, a.canonicalSurface, b.canonicalSurface);
        var diffIndicators = hasDifferentIndicatorSets(a, b);

        // Multi-evidence score. Edit similarity is deliberately weak; definitions, measurement,
        // and graph neighborhood carry more decision value than spelling resemblance.
        var score = 0.22 * lexSim + 0.18 * semanticSim + 0.20 * defSim +
          0.18 * measurementSim + 0.15 * relSim + 0.07 * editSim;
        var contradictionPenalty = 0;
        if (contrast) contradictionPenalty += 0.5;
        if (discriminant) contradictionPenalty += 0.5;
        if (diffIndicators) contradictionPenalty += 0.3;
        score = Math.max(0, Math.min(1, Math.round((score - contradictionPenalty) * 100) / 100));

        var hasNegativeEvidence = contrast || discriminant || diffIndicators;
        if (hasNegativeEvidence) return;

        if (score >= 0.55) {
          var reasons = [];
          if (lexSim >= 0.45) reasons.push('kata penting tumpang tindih');
          if (semanticSim >= 0.65) reasons.push('sinonim terkurasi');
          if (defSim >= 0.45) reasons.push('definisi mirip');
          if (measurementSim) reasons.push('instrumen sama');
          if (relSim >= 0.5) reasons.push('tetangga relasi sama');
          if (editSim >= 0.82) reasons.push('ejaan sangat mirip');
          flagged.push({
            pairKey: normA + '||' + normB,
            normA: normA,
            normB: normB,
            termA: a.canonicalSurface,
            termB: b.canonicalSurface,
            score: score,
            priority: score >= 0.78 ? 'high' : (score >= 0.65 ? 'medium' : 'low'),
            reason: reasons.length ? reasons.join(', ') : 'beberapa bukti lemah saling mendukung',
            evidence: {
              lexical: Math.round(lexSim * 100) / 100,
              semantic: Math.round(semanticSim * 100) / 100,
              definition: Math.round(defSim * 100) / 100,
              measurement: measurementSim,
              relation: Math.round(relSim * 100) / 100,
              spelling: Math.round(editSim * 100) / 100,
            },
            contexts: {
              termA: (a.contexts || []).slice(0, 2),
              termB: (b.contexts || []).slice(0, 2),
            },
          });
        }
    });
    return {
      flagged: flagged.sort(function (x, y) { return y.score - x.score; }),
      autoMerged: [],
      metrics: {
        possiblePairs: keys.length * (keys.length - 1) / 2,
        candidatePairs: candidatePairs.length,
      },
    };
  }

  function dedupeAcronymAliases(pairs) {
    var seen = {};
    var out = [];
    pairs.forEach(function (p) {
      var key = normalizeTermSurface(p.fullTerm) + '|' + p.acronym;
      if (seen[key]) { seen[key].occurrenceCount++; return; }
      var entry = { fullTerm: p.fullTerm, acronym: p.acronym, position: p.position, occurrenceCount: 1 };
      seen[key] = entry;
      out.push(entry);
    });
    return out;
  }

  // ---------- orchestration ----------
  var PARA_BOUNDARY = '\u0001';

  function buildConceptDictionary(text, options) {
    options = options || {};
    var tableRows = options.tableRows || [];
    var prepared = prepareAnalysisText(text, options);
    var glossaryIndex = buildGlossaryIndex(options.glossary || []);
    text = prepared.text;
    // Mark paragraph/table-cell boundaries BEFORE normalizeWhitespace flattens all newlines to
    // plain spaces — otherwise adjacent table cells (e.g. a "CR" / "AVE" / "Short Video
    // Addiction (SVA)" row in a loadings table, which mammoth renders as separate blank-line-
    // separated paragraphs) would look identical to genuine same-sentence spacing, and the
    // multi-word term/acronym extraction below would wrongly glue them into one bogus term.
    text = text.replace(/\n[ \t]*\n+/g, PARA_BOUNDARY);
    text = normalizeWhitespace(text);
    var sentenceList = splitSentences(text);
    var sectionHints = { sentences: sentenceList, nearbyHeading: '' };
    var extracted = extractCandidateTerms(text);
    var acronymAliases = findAcronymAliases(text);

    // Canonicalize explicit glossary members before concept construction. This is the only
    // non-acronym path that may unify terms automatically because the instruction came directly
    // from the user, not from a similarity score.
    Object.keys(glossaryIndex.byPreferred).forEach(function (preferredNorm) {
      var group = glossaryIndex.byPreferred[preferredNorm];
      if (!extracted.phraseOccurrences[preferredNorm]) extracted.phraseOccurrences[preferredNorm] = [];
      group.memberNorms.forEach(function (memberNorm) {
        var memberOccs = findAllSurfaceOccurrences(text, memberNorm);
        memberOccs.forEach(function (occ) {
          if (!extracted.phraseOccurrences[preferredNorm].some(function (existing) { return existing.start === occ.start && existing.end === occ.end; })) {
            extracted.phraseOccurrences[preferredNorm].push(occ);
          }
        });
        if (memberNorm !== preferredNorm) delete extracted.phraseOccurrences[memberNorm];
      });
      extracted.cueNorms[preferredNorm] = true;
    });

    // Only keep candidate phrase-terms that repeat at least twice (single-mention capitalized
    // phrases are usually just normal sentence-start capitalization noise, not real constructs).
    var concepts = {};
    Object.keys(extracted.phraseOccurrences).forEach(function (norm) {
      if (glossaryIndex.redirect[norm]) return;
      var candidateOccs = extracted.phraseOccurrences[norm];
      var glossaryGroup = glossaryIndex.byPreferred[norm];
      var cueBacked = !!extracted.cueNorms[norm];
      if (candidateOccs.length < 2 && !cueBacked && !glossaryGroup) return;
      if (isGenericNonConceptCandidate(norm)) return;
      // Re-scan the whole document case-insensitively for this normalized form, so lowercase/
      // mixed-case mentions of the same concept are counted too (see findAllSurfaceOccurrences).
      var occs = glossaryGroup
        ? glossaryGroup.memberNorms.reduce(function (all, memberNorm) { return all.concat(findAllSurfaceOccurrences(text, memberNorm)); }, [])
        : findAllSurfaceOccurrences(text, norm);
      if (occs.length < candidateOccs.length) occs = candidateOccs;
      var occurrenceSeen = {};
      occs = occs.filter(function (occ) {
        var key = occ.start + ':' + occ.end;
        if (occurrenceSeen[key]) return false;
        occurrenceSeen[key] = true;
        return true;
      }).sort(function (a, b) { return a.start - b.start; });
      var canonicalSurface = chooseCanonicalSurface(occs, glossaryGroup && glossaryGroup.preferred);
      var defs = detectDefinitions(text, norm, occs, sectionHints);
      var variableEvidence = evaluateVariableEvidence(text, occs, sentenceList);
      var surfaceVariants = {};
      occs.forEach(function (o) { surfaceVariants[o.surface] = (surfaceVariants[o.surface] || 0) + 1; });
      var variantList = Object.keys(surfaceVariants).map(function (s) { return { text: s, count: surfaceVariants[s] }; });
      var consistency = analyzeSurfaceConsistency(variantList);
      concepts[norm] = {
        canonicalSurface: canonicalSurface,
        normalizedForm: norm,
        surfaceVariants: variantList,
        occurrenceCount: occs.length,
        definitions: defs,
        variableScore: variableEvidence.score,
        variableEvidence: variableEvidence,
        measuredBy: null,
        acronymOf: null,
        aliasAcronyms: [],
        userAliases: glossaryGroup ? glossaryGroup.aliases.slice() : [],
        glossaryDefined: !!glossaryGroup,
        contexts: contextSnippets(text, occs, 3),
        consistency: consistency,
        consistencyIssue: consistency.actionable,
      };
    });

    // link acronym aliases to their concept (Level 2, safe/automatic)
    acronymAliases.forEach(function (pair) {
      var norm = normalizeTermSurface(pair.fullTerm);
      norm = glossaryIndex.redirect[norm] || norm;
      if (concepts[norm]) {
        if (concepts[norm].aliasAcronyms.indexOf(pair.acronym) === -1) concepts[norm].aliasAcronyms.push(pair.acronym);
      } else if (normalizeTermSurface(pair.fullTerm).split(' ').length >= 2) {
        // full term wasn't picked up as a repeating candidate on its own — still worth recording
        concepts[norm] = {
          canonicalSurface: pair.fullTerm, surfaceVariants: [{ text: pair.fullTerm, count: 1 }],
          normalizedForm: norm, occurrenceCount: 1, definitions: [], variableScore: 0,
          variableEvidence: evaluateVariableEvidence(text, [], sentenceList), measuredBy: null, acronymOf: null,
          aliasAcronyms: [pair.acronym], userAliases: [], glossaryDefined: false,
          contexts: [], consistency: analyzeSurfaceConsistency([{ text: pair.fullTerm, count: 1 }]), consistencyIssue: false,
        };
      }
    });

    // Item/indicator codes ("SVA1", "SVA2", "ERD1") were extracted into acronymOccurrences but
    // never turned into their own concept entries — without an entry, classifyType() never runs
    // on them and the indicator-linkage step below has nothing to find. Only keep ones that
    // actually end in a digit (the acronym-alias pattern above already covers plain acronyms
    // like "TPB" that never carry a trailing number).
    Object.keys(extracted.acronymOccurrences).forEach(function (acr) {
      if (!/\d$/.test(acr)) return;
      var norm = normalizeTermSurface(acr);
      if (concepts[norm]) return;
      var occs = extracted.acronymOccurrences[acr];
      concepts[norm] = {
        canonicalSurface: acr, surfaceVariants: [{ text: acr, count: occs.length }],
        normalizedForm: norm, occurrenceCount: occs.length, definitions: [], variableScore: 0,
        variableEvidence: evaluateVariableEvidence(text, occs, sentenceList), measuredBy: null,
        acronymOf: null, aliasAcronyms: [], userAliases: [], glossaryDefined: false,
        contexts: contextSnippets(text, occs, 3), consistency: analyzeSurfaceConsistency([{ text: acr, count: occs.length }]), consistencyIssue: false,
      };
    });

    // A paper very commonly introduces "Full Term (ACR)" once, then uses just "ACR" alone for
    // the rest of the text — including for the sentence that actually explains what it means
    // ("The TPB proposes that...") AND for most of its measurement/hypothesis/statistical
    // evidence. Without folding acronym-only occurrences back in here, both the definition
    // search and the variable-evidence scoring would only ever see the ONE full-phrase mention,
    // missing everything that follows. Table-derived statistical evidence (see
    // extractDocxTableRows) is folded into this SAME final scoreVariableEvidence call, not a
    // separate one — computing it separately and taking Math.max() across the two would silently
    // drop any case where the acronym occurrences supply one kind of evidence (say, hypothesis
    // language) and the table supplies another (statistical), since neither call alone would see
    // both and the higher-scoring one would just mask the other's contribution.
    Object.keys(concepts).forEach(function (norm) {
      var c = concepts[norm];
      var allOccs = findAllSurfaceOccurrences(text, norm);
      (c.userAliases || []).forEach(function (alias) {
        allOccs = allOccs.concat(findAllSurfaceOccurrences(text, normalizeTermSurface(alias)));
      });
      c.aliasAcronyms.forEach(function (acr) {
        var acrRe = new RegExp('\\b' + escapeRegex(acr) + '\\b', 'g');
        var acrOccs = [];
        var m;
        while ((m = acrRe.exec(text)) !== null) acrOccs.push({ surface: m[0], start: m.index, end: m.index + m[0].length });
        if (!acrOccs.length) return;
        var acrDefs = detectDefinitions(text, norm, acrOccs, sectionHints);
        acrDefs.forEach(function (d) {
          var alreadyHave = c.definitions.some(function (existing) { return existing.text === d.text; });
          if (!alreadyHave) c.definitions.push(d);
        });
        allOccs = allOccs.concat(acrOccs);
      });
      var seenOcc = {};
      allOccs = allOccs.filter(function (occ) {
        var key = occ.start + ':' + occ.end;
        if (seenOcc[key]) return false;
        seenOcc[key] = true;
        return true;
      });
      var hasTableEvidence = tableRows.length > 0 && tableRows.some(function (row) { return conceptMatchesRowLabel(c, norm, row.rowLabel); });
      if (hasTableEvidence) c.hasTableStatEvidence = true;
      if (allOccs.length || hasTableEvidence) {
        var recomputed = evaluateVariableEvidence(text, allOccs.length ? allOccs : [{ start: -1, end: -1 }], sentenceList, hasTableEvidence);
        if (recomputed.score >= c.variableScore) c.variableEvidence = recomputed;
        c.variableScore = Math.max(c.variableScore, recomputed.score);
      }
    });

    // record which instrument measures which concept, from operational definitions
    Object.keys(concepts).forEach(function (norm) {
      var opDef = concepts[norm].definitions.find(function (d) { return d.type === 'operational'; });
      if (opDef) {
        var instrumentPhrase = opDef.text.slice(0, 80)
          .replace(/^(?:an?|the)\s+/i, '')
          .replace(/^(?:adapted|modified|validated|revised|original|standard|adopted)\s+/i, '')
          .replace(/[.,;]?\s*(?:as\s+well|too|also|likewise|similarly)\b.*$/i, '')
          .replace(/[.,;]?\s*(?:following|consistent\s+with|in\s+line\s+with|based\s+on|per)\s+.*$/i, '')
          .replace(/[.,;]?\s*(?:from|in|for)\s+(?:this|the\s+present)\s+study.*$/i, '');
        instrumentPhrase = instrumentPhrase.replace(/[.,;]\s*$/, '');
        concepts[norm].measuredBy = normalizeTermSurface(instrumentPhrase.slice(0, 60));
      }
    });

    // A single-mention instrument name (very common — introduced once in the operational
    // definition, then only the construct name is used afterward) wouldn't otherwise clear the
    // "repeats at least twice" bar to become its own concept at all, which meant it could never
    // be classified as INSTRUMENT. Anything recorded as some other concept's measuredBy value
    // earns a lightweight concept entry of its own if it doesn't already have one.
    Object.keys(concepts).slice().forEach(function (norm) {
      var mb = concepts[norm].measuredBy;
      if (!mb || concepts[mb]) return;
      var mbOccs = findAllSurfaceOccurrences(text, mb);
      if (!mbOccs.length) return;
      var surfaceVariants = {};
      mbOccs.forEach(function (o) { surfaceVariants[o.surface] = (surfaceVariants[o.surface] || 0) + 1; });
      var instrumentVariants = Object.keys(surfaceVariants).map(function (s) { return { text: s, count: surfaceVariants[s] }; });
      var instrumentConsistency = analyzeSurfaceConsistency(instrumentVariants);
      concepts[mb] = {
        canonicalSurface: chooseCanonicalSurface(mbOccs), normalizedForm: mb, surfaceVariants: instrumentVariants,
        occurrenceCount: mbOccs.length, definitions: [], variableScore: 0,
        variableEvidence: evaluateVariableEvidence(text, mbOccs, sentenceList), measuredBy: null,
        acronymOf: null, aliasAcronyms: [], userAliases: [], glossaryDefined: false,
        contexts: contextSnippets(text, mbOccs, 3), consistency: instrumentConsistency,
        consistencyIssue: instrumentConsistency.actionable,
      };
    });

    // First pass — just enough (INDICATOR / ALIAS detection) for indicator-linkage below to work.
    Object.keys(concepts).forEach(function (norm) {
      var c = concepts[norm];
      var isDefined = c.definitions.length > 0;
      var isAcronymAlias = !!c.acronymOf;
      c.type = classifyType(norm, c.variableScore, false, isAcronymAlias, isDefined, false, false);
      c.consistency = c.consistency || analyzeSurfaceConsistency(c.surfaceVariants);
      c.consistencyIssue = c.consistency.actionable;
    });

    // ---------- relation graph (PREDICTS / MEDIATES / RELATED_TO) ----------
    var relations = extractRelations(concepts, sentenceList);
    Object.keys(concepts).forEach(function (norm) {
      concepts[norm].roles = deriveRoles(norm, relations);
    });

    // ---------- indicator -> parent construct linkage ----------
    // "SVA1" is an INDICATOR of the "Short-Video Addiction" construct, identified by whichever
    // concept's acronym is a case-insensitive prefix of the indicator's own (numberless) form —
    // e.g. "sva1" -> strip trailing digit -> "sva" -> matches SVA's aliasAcronyms.
    Object.keys(concepts).forEach(function (norm) {
      var c = concepts[norm];
      if (c.type !== 'INDICATOR') return;
      var indicatorPrefix = norm.replace(/\s+/g, '').replace(/\d+$/, '').toLowerCase();
      Object.keys(concepts).forEach(function (parentNorm) {
        if (parentNorm === norm) return;
        var parent = concepts[parentNorm];
        var matchesAcronym = parent.aliasAcronyms.some(function (acr) { return acr.toLowerCase() === indicatorPrefix; });
        if (matchesAcronym) {
          parent.indicators = parent.indicators || [];
          if (parent.indicators.indexOf(c.canonicalSurface) === -1) parent.indicators.push(c.canonicalSurface);
        }
      });
    });

    // Second pass — now that measuredBy (all concepts) and indicators (parent constructs) are
    // both known, upgrade the classification: INSTRUMENT for anything referenced as someone
    // else's measuring tool, EXAMPLE for terms introduced via "such as"/"e.g."/"including",
    // CONSTRUCT_VARIABLE (has its own indicator items) vs OBSERVED_VARIABLE (measured directly,
    // no indicator sub-items) for the rest.
    var instrumentTargets = {};
    Object.keys(concepts).forEach(function (norm) {
      if (concepts[norm].measuredBy) instrumentTargets[norm] = concepts[norm].measuredBy;
    });
    Object.keys(concepts).forEach(function (norm) {
      var c = concepts[norm];
      if (c.type === 'INDICATOR' || c.type === 'ALIAS') return; // already final
      var isDefined = c.definitions.length > 0;
      var isAcronymAlias = !!c.acronymOf;
      var isInstrumentReferenced = Object.keys(instrumentTargets).some(function (ownerNorm) {
        if (ownerNorm === norm) return false; // never let a concept's own measuredBy self-reference it
        var t = instrumentTargets[ownerNorm];
        return t.indexOf(norm) !== -1 || norm.indexOf(t) !== -1;
      });
      var hasIndicators = !!(c.indicators && c.indicators.length >= 2);
      var occsForExample = findAllSurfaceOccurrences(text, norm);
      var isExample = isExampleMention(norm, occsForExample.length ? occsForExample : [{ start: -1 }], sentenceList);
      c.type = classifyType(norm, c.variableScore, isInstrumentReferenced, isAcronymAlias, isDefined, hasIndicators, isExample);
    });

    var aliasResult = flagPossibleAliases(text, concepts, relations);

    // Deliberately no heuristic merge here. flagPossibleAliases() only creates a review queue.
    // Explicit decisions are applied later by applyReviewDecisions().

    // Assign a stable concept_id and attach a per-concept related_to list (derived from the
    // relation graph) — the spec's output shape wants both directly on each concept, not just
    // available as a separate global relations array the caller has to cross-reference by hand.
    var idCounter = 0;
    Object.keys(concepts).sort().forEach(function (norm) {
      idCounter++;
      var c = concepts[norm];
      c.concept_id = 'C' + String(idCounter).padStart(3, '0');
      c.related_to = relations
        .filter(function (r) {
          return r.subject === norm || r.object === norm || (r.between && r.between.indexOf(norm) !== -1);
        })
        .map(function (r) {
          if (r.type === 'MEDIATES' && r.subject === norm) {
            return { concept: r.between.map(function (n) { return concepts[n] ? concepts[n].canonicalSurface : n; }).join(' & '), relation: 'MEDIATES_BETWEEN' };
          }
          var otherNorm = r.subject === norm ? r.object : r.subject;
          var otherSurface = concepts[otherNorm] ? concepts[otherNorm].canonicalSurface : otherNorm;
          if (r.type === 'PREDICTS') return { concept: otherSurface, relation: r.subject === norm ? 'PREDICTS' : 'PREDICTED_BY' };
          if (r.type === 'MEDIATES') return { concept: otherSurface, relation: 'MEDIATED_BY' };
          return { concept: otherSurface, relation: r.type };
        });
    });

    // undefined-but-important terms: variable-like score but zero definitions found
    var undefinedImportantTerms = Object.keys(concepts)
      .map(function (norm) { return concepts[norm]; })
      .filter(function (c) {
        return c.variableScore >= 0.5 && c.definitions.length === 0 &&
          c.variableEvidence && c.variableEvidence.directEvidenceCount >= 1 &&
          !isGenericNonConceptCandidate(c.canonicalSurface);
      })
      .map(function (c) { return c.canonicalSurface; });

    var inconsistentTerms = Object.keys(concepts)
      .map(function (norm) { return concepts[norm]; })
      .filter(function (c) { return c.consistencyIssue; });

    return {
      concepts: concepts,
      possibleAliases: aliasResult.flagged,
      autoMerged: [], // backward-compatible field; heuristic auto-merge has been removed
      undefinedImportantTerms: undefinedImportantTerms,
      inconsistentTerms: inconsistentTerms,
      acronymAliases: dedupeAcronymAliases(acronymAliases),
      relations: relations,
      reviewMetrics: aliasResult.metrics,
      analysisMeta: {
        referenceSectionFound: prepared.referenceSectionFound,
        excludedReferenceCharacters: prepared.excludedReferenceCharacters,
        analyzedCharacters: text.length,
        glossaryGroupsApplied: glossaryIndex.groups.length,
      },
    };
  }

  function applyReviewDecisions(result, decisions) {
    decisions = decisions || {};
    var out = JSON.parse(JSON.stringify(result || {}));
    out.concepts = out.concepts || {};
    out.relations = out.relations || [];
    out.possibleAliases = out.possibleAliases || [];
    var redirects = {}, applied = [];
    function resolve(norm) {
      var guard = 0;
      while (redirects[norm] && guard++ < 100) norm = redirects[norm];
      return norm;
    }
    function uniqueConcat(a, b, keyFn) {
      var seen = {}, merged = [];
      (a || []).concat(b || []).forEach(function (item) {
        var key = keyFn ? keyFn(item) : String(item);
        if (seen[key]) return;
        seen[key] = true;
        merged.push(item);
      });
      return merged;
    }
    function mergeConcepts(preferredNorm, otherNorm, preferredLabel) {
      preferredNorm = resolve(preferredNorm);
      otherNorm = resolve(otherNorm);
      if (preferredNorm === otherNorm) return preferredNorm;
      var target = out.concepts[preferredNorm], source = out.concepts[otherNorm];
      if (!target || !source) return preferredNorm;
      var variantCounts = {};
      (target.surfaceVariants || []).concat(source.surfaceVariants || []).forEach(function (v) {
        variantCounts[v.text] = (variantCounts[v.text] || 0) + v.count;
      });
      target.surfaceVariants = Object.keys(variantCounts).map(function (text) { return { text: text, count: variantCounts[text] }; });
      target.canonicalSurface = preferredLabel || target.canonicalSurface;
      target.occurrenceCount = (target.occurrenceCount || 0) + (source.occurrenceCount || 0);
      target.definitions = uniqueConcat(target.definitions, source.definitions, function (d) { return d.type + '|' + d.text; });
      target.aliasAcronyms = uniqueConcat(target.aliasAcronyms, source.aliasAcronyms);
      target.userAliases = uniqueConcat(target.userAliases, (source.userAliases || []).concat([source.canonicalSurface]));
      target.indicators = uniqueConcat(target.indicators, source.indicators);
      target.roles = uniqueConcat(target.roles, source.roles);
      target.contexts = uniqueConcat(target.contexts, source.contexts, function (c) { return c.text; }).slice(0, 6);
      target.related_to = uniqueConcat(target.related_to, source.related_to, function (r) { return r.concept + '|' + r.relation; });
      if ((source.variableScore || 0) > (target.variableScore || 0)) target.variableEvidence = source.variableEvidence;
      target.variableScore = Math.max(target.variableScore || 0, source.variableScore || 0);
      target.measuredBy = target.measuredBy || source.measuredBy;
      target.hasTableStatEvidence = !!(target.hasTableStatEvidence || source.hasTableStatEvidence);
      target.glossaryDefined = !!(target.glossaryDefined || source.glossaryDefined);
      target.mergedFrom = uniqueConcat(target.mergedFrom, (source.mergedFrom || []).concat([source.canonicalSurface]));
      target.consistency = analyzeSurfaceConsistency(target.surfaceVariants);
      target.consistencyIssue = target.consistency.actionable;
      redirects[otherNorm] = preferredNorm;
      delete out.concepts[otherNorm];
      return preferredNorm;
    }

    out.possibleAliases.forEach(function (pair) {
      var decision = decisions[pair.pairKey];
      if (!decision || decision.action !== 'same') return;
      var preferredOriginal = decision.preferred === pair.normB ? pair.normB : pair.normA;
      var otherOriginal = preferredOriginal === pair.normA ? pair.normB : pair.normA;
      var labelConcept = result.concepts && result.concepts[preferredOriginal];
      var mergedInto = mergeConcepts(preferredOriginal, otherOriginal, labelConcept && labelConcept.canonicalSurface);
      applied.push({ pairKey: pair.pairKey, action: 'same', into: mergedInto, from: otherOriginal });
    });

    out.relations = out.relations.map(function (r) {
      r.subject = resolve(r.subject);
      if (r.object) r.object = resolve(r.object);
      if (r.between) r.between = uniqueConcat(r.between.map(resolve), []);
      return r;
    }).filter(function (r) {
      if (r.object && r.subject === r.object) return false;
      if (r.between && (r.between.length < 2 || r.between.indexOf(r.subject) !== -1)) return false;
      return true;
    });
    var relationSeen = {};
    out.relations = out.relations.filter(function (r) {
      var key = r.type + '|' + r.subject + '|' + (r.object || (r.between || []).join(','));
      if (relationSeen[key]) return false;
      relationSeen[key] = true;
      return true;
    });

    var idCounter = 0;
    Object.keys(out.concepts).sort().forEach(function (norm) {
      var concept = out.concepts[norm];
      concept.normalizedForm = norm;
      concept.concept_id = 'C' + String(++idCounter).padStart(3, '0');
      concept.related_to = out.relations.filter(function (r) {
        return r.subject === norm || r.object === norm || (r.between && r.between.indexOf(norm) !== -1);
      }).map(function (r) {
        if (r.type === 'MEDIATES' && r.subject === norm) {
          return { concept: r.between.map(function (n) { return out.concepts[n] ? out.concepts[n].canonicalSurface : n; }).join(' & '), relation: 'MEDIATES_BETWEEN' };
        }
        var other = r.subject === norm ? r.object : r.subject;
        var otherLabel = out.concepts[other] ? out.concepts[other].canonicalSurface : other;
        if (r.type === 'PREDICTS') return { concept: otherLabel, relation: r.subject === norm ? 'PREDICTS' : 'PREDICTED_BY' };
        if (r.type === 'MEDIATES') return { concept: otherLabel, relation: 'MEDIATED_BY' };
        return { concept: otherLabel, relation: r.type };
      });
    });
    out.inconsistentTerms = Object.keys(out.concepts).map(function (k) { return out.concepts[k]; })
      .filter(function (c) { return c.consistencyIssue; });
    out.undefinedImportantTerms = Object.keys(out.concepts).map(function (k) { return out.concepts[k]; })
      .filter(function (c) {
        return c.variableScore >= 0.5 && (!c.definitions || !c.definitions.length) &&
          c.variableEvidence && c.variableEvidence.directEvidenceCount >= 1 && !isGenericNonConceptCandidate(c.canonicalSurface);
      }).map(function (c) { return c.canonicalSurface; });
    out.possibleAliases = out.possibleAliases.map(function (pair) {
      pair.decision = decisions[pair.pairKey] || null;
      return pair;
    });
    out.reviewSummary = {
      total: out.possibleAliases.length,
      decided: out.possibleAliases.filter(function (p) { return !!p.decision; }).length,
      mergedByUser: applied.length,
      applied: applied,
    };
    return out;
  }

  function fingerprintText(text) {
    var h = 2166136261;
    var s = String(text || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8) + '-' + s.length;
  }

  return {
    normalizeTermSurface: normalizeTermSurface,
    prepareAnalysisText: prepareAnalysisText,
    parseGlossary: parseGlossary,
    extractCandidateTerms: extractCandidateTerms,
    findAcronymAliases: findAcronymAliases,
    detectDefinitions: detectDefinitions,
    scoreVariableEvidence: scoreVariableEvidence,
    evaluateVariableEvidence: evaluateVariableEvidence,
    flagPossibleAliases: flagPossibleAliases,
    synonymAwareSimilarity: synonymAwareSimilarity,
    extractDocxTableRows: extractDocxTableRows,
    extractRelations: extractRelations,
    deriveRoles: deriveRoles,
    hasCausalEdge: hasCausalEdge,
    findAllSurfaceOccurrences: findAllSurfaceOccurrences,
    analyzeSurfaceConsistency: analyzeSurfaceConsistency,
    buildConceptDictionary: buildConceptDictionary,
    applyReviewDecisions: applyReviewDecisions,
    fingerprintText: fingerprintText,
    splitSentences: splitSentences,
  };
});
