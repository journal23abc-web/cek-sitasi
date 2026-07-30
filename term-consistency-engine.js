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
   manusia. Ini konsisten dengan filosofi di spesifikasi: "kemiripan tinggi bukan bukti identitas".
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
    'between', 'among', 'both', 'each', 'per', 'via', 'also', 'than', 'then',
    'yang', 'dan', 'atau', 'adalah', 'merupakan', 'ini', 'itu', 'pada', 'dari', 'ke', 'di',
    'dengan', 'oleh', 'untuk', 'sebagai', 'juga', 'akan', 'telah', 'sudah', 'dapat', 'bisa',
  ]);

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
      if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
      return w;
    });
    return words.join(' ');
  }

  // ---------- candidate term extraction ----------
  // Multi-word Title-Case noun phrases (2-5 words) and standalone acronym-like tokens
  // (2-6 uppercase letters). Deliberately loose — no real POS tagger is available client-side —
  // filtered down later by repetition count and definition/variable evidence, so an overly
  // permissive extractor here is fine as long as the downstream scoring is conservative.
  var TITLECASE_PHRASE_RE = /\b(?:[A-Z][a-zA-Z]*(?:[-\u2010-\u2015][A-Z][a-zA-Z]*)?)(?:[ \t]+(?:of|for|the|in|on|to|a|an)?[ \t]*[A-Z][a-zA-Z]*(?:[-\u2010-\u2015][A-Z][a-zA-Z]*)?){1,4}\b/g;
  var ACRONYM_TOKEN_RE = /\b[A-Z]{2,6}\d{0,2}\b|\b[A-Z][a-z]?[A-Z][a-zA-Z]*\d{1,2}\b/g;

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
    return { phraseOccurrences: occurrences, acronymOccurrences: acronymOccurrences };
  }

  // ---------- acronym/alias pairing (Level 2: safe, automatic) ----------
  // "Full Term (ABC)" or "ABC (Full Term)" — very low false-positive risk, since the acronym's
  // letters are checked against the full term's initials.
  function initialsOf(phrase) {
    return phrase.split(/\s+/)
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
      var wordsAll = fullTerm.split(/\s+/).map(function (w) { return w[0].toUpperCase(); }).join('');
      var initials = initialsOf(fullTerm);
      // Accept if the acronym's letters plausibly come from the full term: either from the
      // content-word initials (standard case, e.g. "Emotion Regulation Difficulties" -> "ERD"),
      // or from EVERY word's first letter including connectors (covers "Fear of Failure" -> "FoF",
      // where the lowercase "o" comes from "of").
      var acrUpper = acr.toUpperCase();
      var initialsMatch = initials.length >= acrUpper.length - 1 && initials.slice(0, acrUpper.length).indexOf(acrUpper[0]) !== -1;
      var allWordsMatch = wordsAll === acrUpper;
      if (initialsMatch || allWordsMatch) {
        aliases.push({ fullTerm: fullTerm, acronym: acr, position: m.index });
      }
    }
    var re2 = /\b([A-Z]{2,6})\s*\(((?:[A-Z][a-zA-Z]+\s*){1,5})\)/g;
    while ((m = re2.exec(text)) !== null) {
      var acr2 = m[1];
      var fullTerm2 = m[2].trim();
      aliases.push({ fullTerm: fullTerm2, acronym: acr2, position: m.index });
    }
    return aliases;
  }

  // ---------- Section 1: definition detection ----------
  var DEFINITION_PATTERNS = {
    conceptual: /\b(is|are|was|were)\s+defined\s+as\b|\brefers?\s+to\b|\bis\s+the\b|\bmeans?\b|\b(?:proposes?|posits?|suggests?|argues?|states?|explains?|assumes?)\s+that\b|\bmerupakan\b|\badalah\b|\bmerujuk\s+pada\b|\bdidefinisikan\s+sebagai\b|\bmencakup\b|\bditandai\s+dengan\b/i,
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
              if (defText.length > 8) {
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
  var HYPOTHESIS_RE = /\bH\d+\s*[:.]|\bhypothesiz(?:e|ed|es)\b|\bpredicts?\b|\beffect\s+of\b|\binfluence[s]?\b|\brelationship\s+between\b|\bpengaruh\b|\bhubungan\s+antara\b|\bmemprediksi\b/i;
  var STATS_RE = /\bcoefficient\b|\bloading\b|\bR\s*[²2]\b|\bp\s*[<>=]\s*0?\.\d+\b|\bβ\s*=|\bpath\s+coefficient\b/i;
  var MODEL_SECTION_RE = /\b(hypothes[ie]s|conceptual\s+framework|instrumentation|structural\s+model|sem\b|regression)\b/i;
  var ROLE_LANGUAGE_RE = /\b(?:mediat(?:or|es|ing)|moderat(?:or|es|ing)|predictor|antecedent|exogenous|endogenous|independent\s+variable|dependent\s+variable|outcome\s+variable)\b|\bvariabel\s+(?:mediasi|moderasi|independen|dependen)\b/i;

  function scoreVariableEvidence(text, occurrences, sentences) {
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
    var modelRel = (modelRelHit > 0 || roleHit > 0) ? 1 : 0;
    var stats = statsHit > 0 ? 1 : 0;
    var section = sectionHit > 0 ? 1 : 0;
    var repetition = Math.min(1, occurrences.length / 5);
    var score = 0.25 * measurement + 0.20 * hypothesis + 0.20 * modelRel + 0.15 * stats + 0.10 * section + 0.10 * repetition;
    return Math.round(score * 100) / 100;
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
  var PREDICTS_VERB_RE = /\b(?:predicts?|influences?|affects?)\b/i;
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
    var autoMerged = [];
    var keys = Object.keys(concepts);
    for (var i = 0; i < keys.length; i++) {
      for (var j = i + 1; j < keys.length; j++) {
        var normA = keys[i], normB = keys[j];
        var a = concepts[normA], b = concepts[normB];
        if (a.acronymOf || b.acronymOf) continue; // already resolved via Level 2
        // Hard vetos: no similarity score can override these regardless of how high it scores.
        if (hasCausalEdge(relations, normA, normB)) continue;
        if (isIndicatorOfEachOther(a, b)) continue;
        var wsA = wordSet(normA), wsB = wordSet(normB);
        var lexSim = jaccard(wsA, wsB);
        var editSim = levenshteinRatio(normA, normB);
        if (lexSim < 0.15 && editSim < 0.5) continue; // clearly unrelated, skip the pair entirely
        var measurementSim = (a.measuredBy && b.measuredBy && a.measuredBy === b.measuredBy) ? 1 : 0;
        var defSim = definitionSimilarity(a, b);
        var relSim = relationNeighborhoodSimilarity(relations, normA, normB);
        var contrast = hasContrastEvidence(text, a.canonicalSurface, b.canonicalSurface);
        var discriminant = hasDiscriminantValidityMention(text, a.canonicalSurface, b.canonicalSurface);
        var diffIndicators = hasDifferentIndicatorSets(a, b);

        // Spec's 5-component formula, 0.20 each: lexical, semantic (approximated here by edit
        // distance — no real embedding model is available client-side, see file header), same
        // definition, same measurement, same relation-graph neighborhood.
        var score = 0.20 * lexSim + 0.20 * editSim + 0.20 * defSim + 0.20 * measurementSim + 0.20 * relSim;
        var contradictionPenalty = 0;
        if (contrast) contradictionPenalty += 0.5;
        if (discriminant) contradictionPenalty += 0.5;
        if (diffIndicators) contradictionPenalty += 0.3;
        score = Math.max(0, Math.min(1, Math.round((score - contradictionPenalty) * 100) / 100));

        var hasNegativeEvidence = contrast || discriminant || diffIndicators;
        if (hasNegativeEvidence) continue; // never flag OR merge — matches spec's "bukti negatif yang membatalkan penyatuan"

        // Auto-merge is the highest-stakes decision this engine makes, so on top of the score
        // threshold it also requires at least one STRUCTURAL corroborating signal (shared
        // instrument or shared graph neighborhood) — never merges on lexical/edit-distance
        // resemblance alone, which is exactly the mistake the spec warns against ("kemiripan
        // tinggi bukan bukti identitas").
        if (score >= 0.90 && (measurementSim >= 1 || relSim >= 0.5)) {
          autoMerged.push({ normA: normA, normB: normB, score: score });
        } else if (score >= 0.75) {
          flagged.push({ termA: a.canonicalSurface, termB: b.canonicalSurface, score: score, reason: 'lexical/definition/measurement/relation overlap' });
        }
      }
    }
    return { flagged: flagged.sort(function (x, y) { return y.score - x.score; }), autoMerged: autoMerged };
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

  function buildConceptDictionary(text) {
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

    // Only keep candidate phrase-terms that repeat at least twice (single-mention capitalized
    // phrases are usually just normal sentence-start capitalization noise, not real constructs).
    var concepts = {};
    Object.keys(extracted.phraseOccurrences).forEach(function (norm) {
      var titleCaseOccs = extracted.phraseOccurrences[norm];
      if (titleCaseOccs.length < 2) return;
      // Re-scan the whole document case-insensitively for this normalized form, so lowercase/
      // mixed-case mentions of the same concept are counted too (see findAllSurfaceOccurrences).
      var occs = findAllSurfaceOccurrences(text, norm);
      if (occs.length < 2) occs = titleCaseOccs;
      var canonicalSurface = titleCaseOccs[0].surface; // prefer a Title-Case form as the display name
      var defs = detectDefinitions(text, norm, occs, sectionHints);
      var varScore = scoreVariableEvidence(text, occs, sentenceList);
      var surfaceVariants = {};
      occs.forEach(function (o) { surfaceVariants[o.surface] = (surfaceVariants[o.surface] || 0) + 1; });
      concepts[norm] = {
        canonicalSurface: canonicalSurface,
        surfaceVariants: Object.keys(surfaceVariants).map(function (s) { return { text: s, count: surfaceVariants[s] }; }),
        occurrenceCount: occs.length,
        definitions: defs,
        variableScore: varScore,
        measuredBy: null,
        acronymOf: null,
        aliasAcronyms: [],
      };
    });

    // link acronym aliases to their concept (Level 2, safe/automatic)
    acronymAliases.forEach(function (pair) {
      var norm = normalizeTermSurface(pair.fullTerm);
      if (concepts[norm]) {
        if (concepts[norm].aliasAcronyms.indexOf(pair.acronym) === -1) concepts[norm].aliasAcronyms.push(pair.acronym);
      } else if (normalizeTermSurface(pair.fullTerm).split(' ').length >= 2) {
        // full term wasn't picked up as a repeating candidate on its own — still worth recording
        concepts[norm] = {
          canonicalSurface: pair.fullTerm, surfaceVariants: [{ text: pair.fullTerm, count: 1 }],
          occurrenceCount: 1, definitions: [], variableScore: 0, measuredBy: null, acronymOf: null,
          aliasAcronyms: [pair.acronym],
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
        occurrenceCount: occs.length, definitions: [], variableScore: 0, measuredBy: null,
        acronymOf: null, aliasAcronyms: [],
      };
    });

    // A paper very commonly introduces "Full Term (ACR)" once, then uses just "ACR" alone for
    // the rest of the text — including for the sentence that actually explains what it means
    // ("The TPB proposes that...") AND for most of its measurement/hypothesis/statistical
    // evidence. Without folding acronym-only occurrences back in here, both the definition
    // search and the variable-evidence scoring would only ever see the ONE full-phrase mention,
    // missing everything that follows.
    Object.keys(concepts).forEach(function (norm) {
      var c = concepts[norm];
      if (!c.aliasAcronyms.length) return;
      var allOccs = findAllSurfaceOccurrences(text, norm);
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
      var recomputed = scoreVariableEvidence(text, allOccs, sentenceList);
      c.variableScore = Math.max(c.variableScore, recomputed);
    });

    // record which instrument measures which concept, from operational definitions
    Object.keys(concepts).forEach(function (norm) {
      var opDef = concepts[norm].definitions.find(function (d) { return d.type === 'operational'; });
      if (opDef) {
        var instrumentPhrase = opDef.text.slice(0, 80).replace(/^(?:an?|the)\s+/i, '').replace(/^(?:adapted|modified|validated|revised|original|standard|adopted)\s+/i, '');
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
      concepts[mb] = {
        canonicalSurface: mbOccs[0].surface, surfaceVariants: Object.keys(surfaceVariants).map(function (s) { return { text: s, count: surfaceVariants[s] }; }),
        occurrenceCount: mbOccs.length, definitions: [], variableScore: 0, measuredBy: null,
        acronymOf: null, aliasAcronyms: [],
      };
    });

    // First pass — just enough (INDICATOR / ALIAS detection) for indicator-linkage below to work.
    Object.keys(concepts).forEach(function (norm) {
      var c = concepts[norm];
      var isDefined = c.definitions.length > 0;
      var isAcronymAlias = !!c.acronymOf;
      c.type = classifyType(norm, c.variableScore, false, isAcronymAlias, isDefined, false, false);
      c.consistencyIssue = c.surfaceVariants.length >= 2; // written more than one way -> flag
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

    // Execute auto-merges (score >= 0.90 + structural corroboration). Handled with a redirect
    // map so a chain (A merges into B, then B merges into C) still resolves to one final survivor
    // instead of silently dropping data if the pairs are processed in an inconvenient order.
    var redirect = {};
    function resolve(norm) { while (redirect[norm]) norm = redirect[norm]; return norm; }
    var mergeLog = [];
    aliasResult.autoMerged.forEach(function (m) {
      var survivorNorm = resolve(m.normA), mergedNorm = resolve(m.normB);
      if (survivorNorm === mergedNorm) return; // already merged via a chain
      var survivor = concepts[survivorNorm], merged = concepts[mergedNorm];
      if (!survivor || !merged) return;
      // keep the more frequently-used surface form as canonical, merge everything else
      if (merged.occurrenceCount > survivor.occurrenceCount) survivor.canonicalSurface = merged.canonicalSurface;
      var variantMap = {};
      survivor.surfaceVariants.concat(merged.surfaceVariants).forEach(function (v) {
        variantMap[v.text] = (variantMap[v.text] || 0) + v.count;
      });
      survivor.surfaceVariants = Object.keys(variantMap).map(function (t) { return { text: t, count: variantMap[t] }; });
      survivor.occurrenceCount += merged.occurrenceCount;
      merged.definitions.forEach(function (d) {
        if (!survivor.definitions.some(function (e) { return e.text === d.text; })) survivor.definitions.push(d);
      });
      merged.aliasAcronyms.forEach(function (acr) {
        if (survivor.aliasAcronyms.indexOf(acr) === -1) survivor.aliasAcronyms.push(acr);
      });
      if (merged.indicators) {
        survivor.indicators = survivor.indicators || [];
        merged.indicators.forEach(function (ind) { if (survivor.indicators.indexOf(ind) === -1) survivor.indicators.push(ind); });
      }
      survivor.variableScore = Math.max(survivor.variableScore, merged.variableScore);
      survivor.measuredBy = survivor.measuredBy || merged.measuredBy;
      (merged.roles || []).forEach(function (r) { if (survivor.roles.indexOf(r) === -1) survivor.roles.push(r); });
      survivor.consistencyIssue = survivor.surfaceVariants.length >= 2;
      survivor.mergedFrom = (survivor.mergedFrom || []).concat([merged.canonicalSurface]);
      mergeLog.push({ into: survivor.canonicalSurface, from: merged.canonicalSurface, score: m.score });
      delete concepts[mergedNorm];
      redirect[mergedNorm] = survivorNorm;
    });

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
      .filter(function (c) { return c.variableScore >= 0.5 && c.definitions.length === 0; })
      .map(function (c) { return c.canonicalSurface; });

    var inconsistentTerms = Object.keys(concepts)
      .map(function (norm) { return concepts[norm]; })
      .filter(function (c) { return c.consistencyIssue; });

    return {
      concepts: concepts,
      possibleAliases: aliasResult.flagged,
      autoMerged: mergeLog,
      undefinedImportantTerms: undefinedImportantTerms,
      inconsistentTerms: inconsistentTerms,
      acronymAliases: dedupeAcronymAliases(acronymAliases),
      relations: relations,
    };
  }

  return {
    normalizeTermSurface: normalizeTermSurface,
    extractCandidateTerms: extractCandidateTerms,
    findAcronymAliases: findAcronymAliases,
    detectDefinitions: detectDefinitions,
    scoreVariableEvidence: scoreVariableEvidence,
    flagPossibleAliases: flagPossibleAliases,
    extractRelations: extractRelations,
    deriveRoles: deriveRoles,
    hasCausalEdge: hasCausalEdge,
    findAllSurfaceOccurrences: findAllSurfaceOccurrences,
    buildConceptDictionary: buildConceptDictionary,
    splitSentences: splitSentences,
  };
});
