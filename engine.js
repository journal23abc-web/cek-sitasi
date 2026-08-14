/* ============================================================
   MULTI-FORMAT CITATION ENGINE
   Mendukung: APA7, MLA9, Chicago (Author-Date), Harvard, IEEE, Vancouver
   ============================================================ */

// ---------- UTILITIES ----------
function esc(t) {
  if (typeof document === 'undefined') return String(t == null ? '' : t);
  var d = document.createElement('div');
  d.textContent = t == null ? '' : String(t);
  return d.innerHTML;
}

function stripNameParticles(name) {
  if (!name) return '';
  return name.replace(/^(van\s+den|van\s+der|van\s+de|van\s+het|van|de\s+la|de\s+los|de\s+las|de\s+le|von\s+der|von|del|della|de|der|den|di|da|dos|du|bin|binti)\s+/i, '').trim();
}

function normalizeTitle(title) {
  if (!title) return '';
  return title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

function bigramSimilarity(s1, s2) {
  s1 = normalizeTitle(s1); s2 = normalizeTitle(s2);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 3 || s2.length < 3) return 0;
  var bigrams1 = {};
  for (var i = 0; i < s1.length - 1; i++) { var bg = s1.substring(i, i + 2); bigrams1[bg] = (bigrams1[bg] || 0) + 1; }
  var overlap = 0, total = 0;
  for (var j = 0; j < s2.length - 1; j++) { var bg2 = s2.substring(j, j + 2); total++; if (bigrams1[bg2] > 0) { overlap++; bigrams1[bg2]--; } }
  return (2 * overlap) / (s1.length - 1 + total);
}

// ---------- INSTITUTIONAL AUTHOR DETECTION ----------
var INSTITUTION_KEYWORDS = /\b(Organization|Organisation|Organisasi|Ministry|Kementerian|Department|Departemen|Institute|Institut|University|Universitas|Agency|Agensi|Badan|Dinas|Komisi|Commission|Council|Dewan|Association|Asosiasi|Perhimpunan|Ikatan|Committee|Panitia|Bureau|Biro|Corporation|Corp\.?|Inc\.?|Foundation|Yayasan|Center|Centre|Pusat|Bank|WHO|UNESCO|UNICEF|UNDP|WWF|FAO|World|National|Nasional|Federal|State|Pemerintah|Government|Perusahaan|PT\.?|Fakultas|Faculty|Sekolah|School|Rumah\s+Sakit|Hospital|Perpustakaan|Library|Laboratorium|Laboratory)\b/i;

var ACRONYM_PATTERN = /^[A-Z]{2,8}$/;

function looksLikePersonalName(str) {
  // "Last, F. M." or "Last, First" or "F. M. Last" personal-name shapes
  var s = str.trim();
  if (/^[\p{Lu}\p{Lo}][\p{L}'\-]+,\s*(\p{Lu}\.\s*)+$/u.test(s)) return true; // Last, F. M.
  if (/^[\p{Lu}\p{Lo}][\p{L}'\-]+,\s*[\p{Lu}\p{Lo}][\p{L}'\-]+(\s+[\p{Lu}\p{Lo}][\p{L}'\-]+)?$/u.test(s)) return true; // Last, First Middle
  if (/^(\p{Lu}\.\s*)+[\p{Lu}\p{Lo}][\p{L}'\-]+$/u.test(s)) return true; // F. M. Last
  if (/^[\p{Lu}\p{Lo}][\p{L}'\-]+\s+\p{Lu}{1,3}$/u.test(s)) return true; // Vancouver: Last FM
  // Common name-particle(s) + surname, e.g. "Bin Ahmad", "Al Amin", "Van der Berg", "De la Cruz".
  // No institution is named this way, but the bare shape (title-case words, no comma) is
  // otherwise indistinguishable from a short organization name like "Bank Indonesia".
  if (/^(?:(?:[Bb]in|[Ii]bn|[Bb]inti|[Aa]l|[Ee]l|[Dd]a|[Tt]en|[Tt]er|[Vv]an|[Dd]er|[Dd]en|[Vv]on|[Dd]e|[Ll]a|[Ll]e|[Dd]u|[Dd]os|[Dd]as|[Dd]o)\s+)+[\p{Lu}\p{Lo}][\p{L}'\-]+$/u.test(s)) return true;
  return false;
}

// Recognizes a non-inverted personal-author list — "J. Smith and A. Doe", "J. Smith, A. Doe,
// and C. Lee", "J. Smith & A. Doe" — the shape IEEE/Vancouver-family styles write authors in.
// Needed because isInstitutionalAuthor() allows "and"/"&" as connector words (institution names
// legitimately contain them, e.g. "... Co-operation and Development"), which would otherwise
// make a genuine 2+ person author list joined by "and" look exactly like ONE institution name.
// The distinguishing shape here: each segment starts with 1-3 bare capital-letter initials
// followed by a surname — real institution names essentially never start that way.
function looksLikeNonInvertedAuthorList(str) {
  var s = (str || '').trim();
  if (!s) return false;
  var person = '(?:\\p{Lu}\\.\\s*){1,3}[\\p{Lu}\\p{Lo}][\\p{L}\'\\-]+';
  var re = new RegExp('^' + person + '(?:\\s*,?\\s*(?:and|&)\\s*' + person + '|\\s*,\\s*' + person + ')+$', 'u');
  return re.test(s);
}

function isInstitutionalAuthor(str) {
  if (!str) return false;
  // A trailing period is a formatting artifact (reference-list author fields like "GEM." from
  // "GEM. (2022). ..." commonly carry one, citation tokens like "GEM" from "(GEM, 2022)" don't)
  // — strip it before testing so both sides of a match agree on whether an acronym like "GEM"
  // counts as institutional. Leaving this asymmetric caused real acronym citations/references to
  // silently fail to match each other even when they were textually identical.
  var s = str.trim().replace(/\.$/, '');
  if (ACRONYM_PATTERN.test(s)) return true;
  // A string ending in "(ACR)"/"[ACR]" is unambiguously an institution introducing its own
  // acronym (e.g. "Philippine Statistics Authority (PSA)") — check this BEFORE the word-shape
  // check below, since that check requires every word to look like a capitalized word or a
  // known connector, which a trailing "(PSA)" token never satisfies on its own.
  if (extractAcronymPairing(s)) return true;
  if (INSTITUTION_KEYWORDS.test(s)) return true;
  if (looksLikePersonalName(s)) return false;
  // Multi-word title-case string with 3+ words and no comma, no personal-name shape -> likely org
  var words = s.split(/\s+/);
  if (words.length >= 2 && !s.includes(',') && words.every(function(w){ return /^[\p{Lu}\p{Lo}]/u.test(w) || /^(of|the|and|dan|untuk|bagi|ng|sa|at|para|de|la|del)$/i.test(w); })) {
    return true;
  }
  return false;
}

// extract "Full Name (ACR)" or "Full Name [ACR]" pairing from institutional citations
function extractAcronymPairing(str) {
  var m = str.match(/^(.+?)\s*[\(\[]([A-Z]{2,8})[\)\]]/);
  if (m) return { full: m[1].trim(), acronym: m[2].trim() };
  return null;
}

// ---------- IN-TEXT CITATION EXTRACTION ----------

function expandNumberRange(str) {
  // "1-3" -> [1,2,3], "1,2" -> [1,2]
  var nums = [];
  str.split(',').forEach(function(chunk) {
    chunk = chunk.trim();
    var rangeMatch = chunk.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      var a = parseInt(rangeMatch[1], 10), b = parseInt(rangeMatch[2], 10);
      for (var n = a; n <= b; n++) nums.push(n);
    } else if (/^\d+$/.test(chunk)) {
      nums.push(parseInt(chunk, 10));
    }
  });
  return nums;
}

function extractNumericCitations(text) {
  var results = [];
  var bracketRegex = /\[(\d+(?:\s*[,\-–]\s*\d+)*)\]/g;
  var m;
  while ((m = bracketRegex.exec(text)) !== null) {
    results.push({ raw: m[0], numbers: expandNumberRange(m[1]), position: m.index, form: 'bracket' });
  }
  if (results.length === 0) {
    var parenRegex = /\((\d+(?:\s*[,\-–]\s*\d+)*)\)/g;
    while ((m = parenRegex.exec(text)) !== null) {
      results.push({ raw: m[0], numbers: expandNumberRange(m[1]), position: m.index, form: 'paren' });
    }
  }
  return results;
}

// ---------- Malformed in-text citation format detection ----------
// This is a DIFFERENT category of check from the citation<->reference matching logic above: it
// looks for structural/typographical problems in a citation's own formatting (missing space,
// wrong "et al." casing, unbalanced parentheses, non-standard author-list-before-"et al." style)
// — issues that can make a citation invisible to extraction entirely (a missing "(" means
// extractAuthorDateCitations never sees it at all, which would otherwise silently show up as a
// false "reference not cited in text" instead of the real, more specific problem) or just look
// unprofessional even when the citation IS otherwise extractable and matchable.
// Grabs enough surrounding text around a match (nearby author name(s), year, enclosing
// parentheses) to make an issue actually locatable via Ctrl+F in the document — a bare "Et Al."
// or "Pitelis &Wagner" fragment is useless to search for when the same malformed pattern shows
// up more than once with different actual citations.
function citationContext(text, start, end) {
  var ctxStart = start;
  var backLimit = Math.max(0, start - 60);
  while (ctxStart > backLimit && text[ctxStart - 1] !== '(' && text[ctxStart - 1] !== '.') ctxStart--;
  while (ctxStart > 0 && /\S/.test(text[ctxStart - 1]) && /\S/.test(text[ctxStart])) ctxStart--; // snap to word boundary

  var ctxEnd = end;
  var fwdLimit = Math.min(text.length, end + 40);
  while (ctxEnd < fwdLimit && text[ctxEnd] !== ')' && text[ctxEnd] !== '.') ctxEnd++;
  if (text[ctxEnd] === ')') ctxEnd++; // include the closing paren itself

  return text.slice(ctxStart, ctxEnd).trim();
}

// Common country/region names — catches "Outside Nigeria, Syed et al. (2024)" / "Within
// Indonesia, Smith et al. (2020)" / "Across Europe, Jones et al. (2019)", where a capitalized
// PLACE name right after a preposition-like word gets mistaken for part of the author chain
// (both look identical to a plain capitalized-word regex). Not exhaustive — just the common
// cases likely to appear in this exact "preposition + place, Author..." shape. Shared between
// detectMalformedCitations (format checker) and extractAuthorDateCitations (main extraction).
var PLACE_WORDS = new Set([
  'nigeria', 'indonesia', 'malaysia', 'singapore', 'thailand', 'vietnam', 'philippines',
  'india', 'pakistan', 'bangladesh', 'china', 'japan', 'korea', 'africa', 'asia', 'europe',
  'america', 'australia', 'brazil', 'mexico', 'canada', 'egypt', 'kenya', 'ghana',
  'ethiopia', 'tanzania', 'uganda', 'zambia', 'zimbabwe', 'morocco', 'algeria', 'sudan',
  'iran', 'iraq', 'turkey', 'russia', 'germany', 'france', 'italy', 'spain', 'portugal',
  'britain', 'england', 'scotland', 'ireland', 'netherlands', 'belgium', 'switzerland',
  'sweden', 'norway', 'denmark', 'finland', 'poland', 'ukraine', 'greece',
]);

function detectMalformedCitations(text) {
  var issues = [];

  // 1. Missing space before the citation's opening "(" — e.g. "Ekonomi(Agus, 2023)". Requires a
  // letter (not whitespace/punctuation/another bracket) immediately before "(", and citation-like
  // content inside (a capitalized word and a plausible year) so this doesn't fire on unrelated
  // parenthetical asides like "function(x)" or footnote markers.
  var noSpaceRe = /(\S*[\p{L}])\(([\p{Lu}\p{Lo}][^()]{2,140}?\d{4}[a-z]?[^()]{0,20})\)/gu;
  var m;
  while ((m = noSpaceRe.exec(text)) !== null) {
    var precedingWord = m[1].split(/(?<=[.,;:!?])/).pop(); // drop any leading punctuation-terminated fragment, keep the actual word
    issues.push({
      type: 'no_space_before_paren',
      raw: precedingWord + '(' + m[2] + ')',
      position: m.index + (m[1].length - precedingWord.length),
      message: 'Tidak ada spasi sebelum tanda kurung sitasi — seharusnya ada spasi antara "' + precedingWord + '" dan "(".',
      suggestion: precedingWord + ' (' + m[2] + ')',
    });
  }

  // 2. "et al." must be EXACTLY that: lowercase, with a period after "al" — never "Et Al.",
  // "ET AL", "et Al", "et al" (missing period), etc. Checked against the canonical form as a
  // whole rather than case and punctuation separately, so a citation with both problems at once
  // ("Et Al") gets one clear combined message instead of two overlapping ones.
  var etAlRe = /\bet\s+al\.?/gi;
  while ((m = etAlRe.exec(text)) !== null) {
    var matched = m[0];
    if (matched !== 'et al.') {
      var base = matched.replace(/\.$/, '');
      var caseWrong = base !== 'et al';
      var periodMissing = !matched.endsWith('.');
      var problems = [];
      if (caseWrong) problems.push('huruf besar/kecil salah');
      if (periodMissing) problems.push('tanpa titik di akhir');
      var ctx = citationContext(text, m.index, m.index + matched.length);
      issues.push({
        type: 'et_al_case',
        raw: ctx,
        position: m.index,
        message: '"' + matched + '" ' + problems.join(' dan ') + ' — seharusnya "et al.".',
        suggestion: ctx.replace(matched, 'et al.'),
      });
    }
  }

  // 3. A closing ")" that ends what looks like a citation (ends in a 4-digit year, or "et al.,
  // YYYY") but has no matching "(" — i.e. the opening parenthesis was dropped/lost, e.g.
  // "Agusalim Muhammad, et al., 2020)". Tracked via a running paren-balance scan: whenever a ")"
  // would take the balance negative, check whether the text right before it looks citation-like.
  var balance = 0;
  var lastOpenPos = -1;
  var closeCiteRe = /(?:\d{4}[a-z]?|et\s+al\.?,?\s*\d{4}[a-z]?)\)$/i;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (ch === '(') { balance++; lastOpenPos = i; }
    else if (ch === ')') {
      if (balance <= 0) {
        var windowStart = Math.max(0, i - 90);
        var windowText = text.slice(windowStart, i + 1);
        if (closeCiteRe.test(windowText)) {
          // Prefer starting the snippet right after the nearest earlier "(" (the citation group
          // this dangling ")" almost certainly belongs to, even if that "(" was already correctly
          // matched by an EARLIER ")" — e.g. "(A, 2020; B, 2021); C, 2022)" — the stray final ")"
          // conceptually continues the SAME group that opened at that "("). Falls back to the
          // fixed-size window only when no "(" was seen recently enough to be relevant.
          var snippetStart = (lastOpenPos !== -1 && lastOpenPos >= windowStart) ? lastOpenPos : windowStart;
          // Back up to the nearest word boundary so the snippet/suggestion doesn't start
          // mid-word (e.g. "d, 1996..." instead of "Delaney, 1996...") — only relevant for the
          // fixed-size-window fallback, since lastOpenPos already lands exactly on "(".
          while (snippetStart > 0 && text[snippetStart] !== '(' && /\S/.test(text[snippetStart - 1]) && /\S/.test(text[snippetStart])) snippetStart--;
          var rawSnippet = text.slice(snippetStart, i + 1).trim();
          // Best-effort auto-fix: the most common real-world cause of this pattern is a stray
          // ")" in the middle where a ";" (list separator) was intended, with the true closing
          // ")" only appearing at the very end — e.g. "(A, 2020; B, 2021); C, 2022)" almost
          // always means the author meant "(A, 2020; B, 2021; C, 2022)". Only offered when there
          // IS a stray interior ")" to fix this way; otherwise there's no safe generic guess.
          var suggestion = null;
          var interior = rawSnippet.slice(0, -1);
          if (interior.indexOf(')') !== -1) {
            var fixedInner = interior.split(')').join(';').replace(/;\s*;/g, ';').replace(/^;\s*/, '').replace(/\s*;\s*$/, '');
            suggestion = (fixedInner.charAt(0) === '(' ? '' : '(') + fixedInner + ')';
          }
          issues.push({
            type: 'missing_open_paren',
            raw: rawSnippet,
            position: snippetStart,
            message: 'Kurung tutup ")" ditemukan tapi tidak ada kurung buka "(" pasangannya — kemungkinan tanda kurung sitasi hilang.',
            suggestion: suggestion,
          });
        }
        balance = 0; // reset so one dropped "(" doesn't cascade into flagging every later ")" too
      } else {
        balance--;
      }
    }
  }

  // 4. "et al." following TWO OR MORE explicitly listed author names instead of just the first —
  // APA/most styles cite a 3+-author work as "Firstauthor et al.", not "Firstauthor, Secondauthor,
  // et al." (that's mixing the "list everyone" and "abbreviate with et al." conventions).
  var DISCOURSE_WORDS = new Set([
    'moreover', 'however', 'furthermore', 'additionally', 'consequently', 'meanwhile',
    'nevertheless', 'nonetheless', 'therefore', 'thus', 'hence', 'also', 'then', 'indeed',
    'notably', 'specifically', 'overall', 'finally', 'first', 'second', 'third', 'similarly',
    'conversely', 'accordingly', 'alternatively', 'importantly', 'interestingly', 'surprisingly',
    'unfortunately', 'fortunately', 'generally', 'typically', 'essentially', 'basically',
    'ultimately', 'subsequently', 'previously', 'recently', 'currently', 'lastly', 'next',
    'again', 'still', 'yet', 'besides', 'likewise', 'regardless', 'nowadays', 'meanwhile',
  ]);
  // Common country/region names — catches "Outside Nigeria, Syed et al. (2024)" / "Within
  // Indonesia, Smith et al. (2020)" / "Across Europe, Jones et al. (2019)", where a capitalized
  // PLACE name right before the comma gets mistaken for a second author's surname (both look
  // identical to the regex: a capitalized word followed by a comma). Not exhaustive — just the
  // common cases likely to appear in this exact "preposition + place, Author et al." shape.
  var twoThenEtAlRe = /(?<![\p{L}\p{N}])([\p{Lu}\p{Lo}][\p{L}'\-]+)\s*,\s*([\p{Lu}\p{Lo}][\p{L}'\-]+)\s*,?\s*([Ee]t\s+[Aa]l\.?)/gu;
  while ((m = twoThenEtAlRe.exec(text)) !== null) {
    // Skip if the second token is itself an initial (e.g. "Smith, J., et al." is fine — that's
    // just the first author's initial, not a second author being listed).
    if (/^[A-Z]\.?$/.test(m[2])) continue;
    // Skip if the FIRST token is a common sentence-initial discourse word — "Moreover, Taori et
    // al. (2020)" is "Moreover" starting the sentence + a correctly-formatted "Taori et al."
    // citation, not two authors named "Moreover" and "Taori".
    if (DISCOURSE_WORDS.has(m[1].toLowerCase())) continue;
    // Skip if the FIRST token is a common place/country name preceded by a preposition-like
    // word — "Outside Nigeria, Syed et al. (2024)" is "Outside Nigeria" (a location) + a
    // correctly-formatted "Syed et al." citation, not two authors named "Nigeria" and "Syed".
    if (PLACE_WORDS.has(m[1].toLowerCase())) continue;
    var ctx4 = citationContext(text, m.index, m.index + m[0].length);
    issues.push({
      type: 'multiple_authors_before_et_al',
      raw: ctx4,
      position: m.index,
      message: '"et al." semestinya langsung mengikuti penulis PERTAMA saja, bukan setelah ' + (m[2] ? 'dua nama (' + m[1] + ', ' + m[2] + ')' : 'beberapa nama') + ' disebutkan.',
      suggestion: ctx4.replace(m[0], m[1] + ' et al.'),
    });
  }

  // 5. Missing space around "&" joining two author surnames — "Pitelis &Wagner" or "Smith& Jones"
  // instead of "Smith & Jones". Scoped to citation context (a 4-digit year within ~80 chars
  // after) to avoid false positives on unrelated ampersands like "R&D" or a company name.
  var ampRe = /([\p{Lu}\p{Lo}][\p{L}'\-]{1,})(\s?)&(\s?)([\p{Lu}\p{Lo}][\p{L}'\-]{1,})/gu;
  while ((m = ampRe.exec(text)) !== null) {
    if (m[2] === ' ' && m[3] === ' ') continue; // already correctly spaced
    var afterAmp = text.slice(m.index, Math.min(text.length, m.index + 80));
    if (/\d{4}/.test(afterAmp)) {
      var ctx5 = citationContext(text, m.index, m.index + m[0].length);
      issues.push({
        type: 'no_space_around_ampersand',
        raw: ctx5,
        position: m.index,
        message: 'Tidak ada spasi di sekitar tanda "&" — seharusnya ada spasi sebelum dan sesudahnya.',
        suggestion: ctx5.replace(m[0], m[1] + ' & ' + m[4]),
      });
    }
  }

  // 6. Extra space right after the citation's opening "(" or right before its closing ")" —
  // "( Smith, 2020)" or "(Smith, 2020 )" instead of "(Smith, 2020)". Content is either a full
  // citation ("Smith, 2020") or, for the "Author, (Year)" narrative style, just the bare year.
  var citeInnerAlt = '(?:[\\p{Lu}\\p{Lo}][^()]{1,140}?\\d{4}[a-z]?|\\d{4}[a-z]?)';
  var spaceAfterOpenRe = new RegExp('\\(( +)(' + citeInnerAlt + ')\\)', 'gu');
  while ((m = spaceAfterOpenRe.exec(text)) !== null) {
    issues.push({
      type: 'extra_space_in_paren',
      raw: '(' + m[1] + m[2] + ')',
      position: m.index,
      message: 'Ada spasi berlebih tepat setelah tanda kurung buka "(".',
      suggestion: '(' + m[2].trim() + ')',
    });
  }
  var spaceBeforeCloseRe = new RegExp('\\((' + citeInnerAlt + ')( +)\\)', 'gu');
  while ((m = spaceBeforeCloseRe.exec(text)) !== null) {
    issues.push({
      type: 'extra_space_in_paren',
      raw: '(' + m[1] + m[2] + ')',
      position: m.index,
      message: 'Ada spasi berlebih tepat sebelum tanda kurung tutup ")".',
      suggestion: '(' + m[1].trim() + ')',
    });
  }

  // 7. Missing space right after a citation's closing ")" before the next word — "(Smith,
  // 2020)the study" instead of "(Smith, 2020) the study" (also covers the "Author, (2018)claim"
  // narrative-style, year-only-parenthetical case). Excludes cases where the next character is
  // punctuation (",", ".", ";", etc.), which is normal ("as shown (Smith, 2020), this...").
  var noSpaceAfterCloseRe = new RegExp('\\(' + citeInnerAlt + '\\)([\\p{L}])', 'gu');
  while ((m = noSpaceAfterCloseRe.exec(text)) !== null) {
    var closeIdx = m.index + m[0].length - 1 - m[1].length;
    issues.push({
      type: 'no_space_after_paren',
      raw: text.slice(Math.max(0, closeIdx - 20), closeIdx + 1) + m[1],
      position: Math.max(0, closeIdx - 20),
      message: 'Tidak ada spasi setelah tanda kurung tutup sitasi — seharusnya ada spasi sebelum kata "' + m[1] + '..." berikutnya.',
      suggestion: null,
    });
  }

  return issues.sort(function(a, b) { return a.position - b.position; });
}

function extractAuthorDateCitations(text) {
  var citations = [];
  var parenRegex = /\(([^()]+?)\)/g;
  var m;
  var editorialMetaRegex = /^(received|revised|accepted|submitted|published|available\s+online|in\s+press|first\s+published)\s*:/i;
  while ((m = parenRegex.exec(text)) !== null) {
    var content = m[1].trim();
    // A "year" immediately preceded by a decimal point is really just the tail of a decimal
    // fraction (e.g. "p = 0.4330" or "Effect = −0.0509") — common in statistics/regression
    // results reported in parentheses — not a citation year, so it doesn't count here.
    if (!/(?<![.\d])\d{4}[a-z]?\b/.test(content) && !/\bn\.d\./i.test(content)) continue;
    if (/^[\d\s,.\-–:;]+$/.test(content)) continue;
    // Journal manuscripts commonly carry a "(Received: ...; Revised: ...; Accepted: ...)"
    // line near the title/abstract. Every ";"-segment there matches "Word: Date", which
    // parseSingleAuthorDate would otherwise happily parse as an author ("Received: July 03").
    // If ALL segments look like this editorial metadata, it's not a citation at all.
    var segments = content.split(';').map(function(s) { return s.trim(); });
    if (segments.length > 0 && segments.every(function(s) { return editorialMetaRegex.test(s); })) continue;
    var parts = parseParentheticalAuthorDate(content);
    if (parts.length > 0) citations.push({ type: 'parenthetical', raw: m[0], content: content, parts: parts, position: m.index });
  }
  var narrativeRegex = /((?<![\p{L}\p{N}])(?:(?:van|der|den|von|de|la|le|du|bin|ibn|binti|al|el|da|dos|das|do|ter|ten)\s+)?(?:[\p{Lu}\p{Lo}][\p{L}'\u2019.\-]+)(?:(?:\s*,\s*(?:and|dan)\s+|\s*,\s*|\s*&\s*|\s+(?:and|dan|of|for|the|ng|sa|at|para|van|der|den|von|de|la|le|du|bin|ibn|binti|al|el|da|dos|das|do|ter|ten)\s+|\s+)(?:[\p{Lu}\p{Lo}][\p{L}'\u2019.\-]+))*(?:\s+et\s+al\.?)?(?:\s*\[[A-Za-z]{2,8}\])?)\s*,?\s*\((\d{4}[a-z]?|n\.d\.)[,)]/gu;
  var skipWords = buildSkipWordSet();
  // These specific entries in skipWords exist only to catch stray "et al."/"cf."/"e.g."/"i.e."
  // fragments — always lowercase in real usage. The same letters capitalized ("Al", "Et") are
  // virtually always a real surname/word (e.g. the common name prefix "Al" in "Al Amin"), so
  // these must only be treated as skip-fragments when the ORIGINAL text was already lowercase.
  var caseSensitiveSkipWords = new Set(['al', 'et', 'cf', 'e.g', 'i.e']);
  function isSkipWord(originalWord) {
    var lower = originalWord.toLowerCase();
    if (!skipWords.has(lower)) return false;
    if (caseSensitiveSkipWords.has(lower)) return originalWord === lower;
    return true;
  }
  while ((m = narrativeRegex.exec(text)) !== null) {
    var authors = m[1].trim().replace(/^(The|A|An)\s+/, '');
    var year = m[2].trim();
    if (!authors) continue;
    // The bare-whitespace chaining above (needed for space-joined names/orgs with no comma,
    // e.g. "van Dijk" or "Institute of International Finance") doesn't know about sentence
    // boundaries, so it can also glue on the tail of the PREVIOUS sentence when it ends right
    // before the citation, e.g. "...regarding Indonesian MSMEs. Suseno (2025)" would otherwise
    // capture "Indonesian MSMEs. Suseno" as the author. Real chained name/org words only ever
    // sit right before a short abbreviation/initial (<=3 letters, e.g. "J." or "al.") when a
    // period is involved — a period after a longer word marks the end of a sentence, not a
    // name, so drop everything up through the LAST such boundary.
    var sentenceBreak = authors.match(/^(?:.*[\p{L}]{4,})\.\s+(.+)$/u);
    if (sentenceBreak) authors = sentenceBreak[1];
    if (!authors) continue;
    // Strip leading discourse/transition word(s) so they aren't glued onto the real author
    // list, e.g. "However, Riand and Radil (2022)" -> "Riand and Radil (2022)", or "Outside
    // Nigeria, Syed et al. (2024)" -> "Syed et al. (2024)" (two words to strip here: the
    // preposition "Outside" AND the place name "Nigeria", hence the loop instead of a single
    // check). Without this, the whole match gets discarded by the skipWords check below and
    // the citation is lost entirely (shows up as a false "not cited in text" warning instead).
    for (var stripGuard = 0; stripGuard < 4; stripGuard++) {
      var leadMatch = authors.match(/^([\p{L}]+),?\s+/u);
      if (!leadMatch || !(isSkipWord(leadMatch[1]) || PLACE_WORDS.has(leadMatch[1].toLowerCase()))) break;
      authors = authors.slice(leadMatch[0].length).trim();
    }
    if (!authors) continue;
    if (!authors || authors.split(/\s+/).length > 8) continue;
    var before = text.substring(0, m.index);
    var openP = (before.match(/\(/g) || []).length, closeP = (before.match(/\)/g) || []).length;
    if (openP > closeP) continue;
    var firstWordOriginal = authors.split(/[\s,]+/)[0];
    if (isSkipWord(firstWordOriginal)) continue;
    // `authors` may have had leading text stripped above (sentence fragments, discourse words,
    // "The/A/An"), so it's no longer necessarily positioned at m.index — every stripping step
    // only ever removes a prefix, though, so `authors` is still a verbatim substring of the
    // original match; re-locate it so `position` stays accurate for anything that needs the
    // real on-page location (e.g. writing hyperlinks back into the source document).
    var authorsPos = text.indexOf(authors, m.index);
    var position = authorsPos !== -1 ? authorsPos : m.index;
    // Grouped multi-year narrative citation for the SAME author, e.g. "Bangko Sentral ng
    // Pilipinas (2020, 2024, 2025, 2026a)" or "APA (2023a, 2023b, 2023c)" — the regex above
    // only ever captures the FIRST year (stopping at "[,)]"), silently dropping the rest when a
    // comma follows instead of the closing paren. Scan forward for any additional
    // comma-separated years and emit one citation per year, mirroring how the parenthetical
    // ("Author, 2020, 2021)") path already handles this same pattern.
    var years = [year];
    if (text.charAt(m.index + m[0].length - 1) === ',') {
      var scanPos = m.index + m[0].length;
      var yearListRe = /^\s*(\d{4}[a-z]?|n\.d\.)\s*([,)])/;
      while (true) {
        var ym = yearListRe.exec(text.slice(scanPos));
        if (!ym) break;
        years.push(ym[1]);
        scanPos += ym[0].length;
        if (ym[2] === ')') break;
      }
    }
    years.forEach(function (y) {
      citations.push({ type: 'narrative', raw: authors + ' (' + y + ')', authors: authors, year: y, position: position });
    });
  }
  return citations;
}

function parseParentheticalAuthorDate(content) {
  var parts = [];
  function addParsed(p) {
    if (!p) return;
    if (Array.isArray(p)) parts = parts.concat(p);
    else parts.push(p);
  }
  if (content.includes(';')) {
    content.split(';').forEach(function(s) { addParsed(parseSingleAuthorDate(s.trim())); });
  } else {
    addParsed(parseSingleAuthorDate(content));
  }
  return parts;
}

function parseSingleAuthorDate(text) {
  text = text.trim();
  if (!text) return null;
  var yearMatch = text.match(/,?\s*(?<![.\d])(\d{4}[a-z]?|n\.d\.)(?:\s*[,:]\s*(.+))?$/);
  if (!yearMatch) return null;
  var year = yearMatch[1];
  var tail = yearMatch[2] ? yearMatch[2].trim() : null;
  var authorPart = text.substring(0, yearMatch.index).replace(/,\s*$/, '').trim();
  if (!authorPart) return null;

  // Detect a grouped multi-year citation for the SAME author, e.g. "APA, 2023a, 2023b"
  // or "Smith, 2019, 2021" — several works by one author cited together — instead of
  // misreading the extra year(s) as page/location info.
  var years = [year];
  var pageInfo = null;
  if (tail) {
    var tailTokens = tail.split(/\s*,\s*/);
    var allYears = tailTokens.length > 0 && tailTokens.every(function(t) { return /^\d{4}[a-z]?$/.test(t) || /^n\.d\.$/i.test(t); });
    if (allYears) years = years.concat(tailTokens);
    else pageInfo = tail;
  }

  var hasEtAl = /et\s+al\.?/i.test(authorPart);
  var cleanAuthorPart = authorPart.replace(/\s*,?\s*et\s+al\.?/i, '').trim();
  var usedAmp = /&/.test(authorPart);
  var usedAnd = /\b(and|dan)\b/i.test(authorPart);
  // A "Full Name [ACR]"/"Full Name (ACR)" bracket pairing means this is ONE institution
  // introducing its own acronym — its official name may itself legitimately contain "and"
  // (e.g. "Organisation for Economic Co-operation and Development [OECD]"), which must NOT be
  // misread as a personal-author separator splitting it into two fake "co-authors".
  var authors = extractAcronymPairing(cleanAuthorPart) ? [cleanAuthorPart] : splitOnSeparators(cleanAuthorPart);
  var authorCount = authors.length;
  if (hasEtAl) authorCount = Math.max(authorCount, 3);
  var firstAuthor = authors[0] || null;

  if (years.length > 1) {
    return years.map(function(y) {
      return { raw: text, authors: authors, authorCount: authorCount, year: y, pageInfo: null, hasEtAl: hasEtAl, firstAuthor: firstAuthor, usedAmp: usedAmp, usedAnd: usedAnd, groupedSameAuthor: true };
    });
  }
  return { raw: text, authors: authors, authorCount: authorCount, year: year, pageInfo: pageInfo, hasEtAl: hasEtAl, firstAuthor: firstAuthor, usedAmp: usedAmp, usedAnd: usedAnd };
}

function extractAuthorPageCitations(text) {
  // MLA-style (Author Page) or (Author Page-Page) or (Author, Page) - no year
  var citations = [];
  var parenRegex = /\(([^()]+?)\)/g;
  var m;
  while ((m = parenRegex.exec(text)) !== null) {
    var content = m[1].trim();
    if (/(?<![.\d])\d{4}\b/.test(content)) continue; // has a 4-digit year -> not MLA author-page
    var parts = content.split(';').map(function(s) { return s.trim(); });
    var parsedParts = [];
    parts.forEach(function(part) {
      var pm = part.match(/^(.+?),?\s+(\d+(?:[-–]\d+)?)$/);
      if (pm) {
        var authorPart = pm[1].trim();
        var hasEtAl = /et\s+al\.?/i.test(authorPart);
        var cleanAuthor = authorPart.replace(/\s*,?\s*et\s+al\.?/i, '').trim();
        var authors = splitOnSeparators(cleanAuthor);
        parsedParts.push({ raw: part, authors: authors, authorCount: hasEtAl ? Math.max(authors.length,3) : authors.length, firstAuthor: authors[0] || cleanAuthor, page: pm[2], hasEtAl: hasEtAl });
      }
    });
    if (parsedParts.length > 0) citations.push({ type: 'parenthetical', raw: m[0], content: content, parts: parsedParts, position: m.index });
  }
  return citations;
}

function buildSkipWordSet() {
  return new Set(['the','this','that','these','those','according','see','also','however','therefore','furthermore','additionally','although','despite','while','when','where','which','what','how','why','if','then','but','for','with','from','into','after','before','during','between','through','about','above','below','under','over','chapter','table','figure','section','part','page','volume','issue','article','book','report','study','research','data','result','analysis','method','model','system','process','program','project','case','based','related','compared','combined','integrated','developed','proposed','presented','discussed','examined','investigated','observed','found','showed','demonstrated','indicated','suggested','reported','published','available','retrieved','accessed','and','or','not','all','any','both','each','few','many','most','other','some','such','only','own','same','so','than','too','very','just','because','until','against','among','around','along','across','outside','within','inside','beyond','throughout','it','its','he','she','they','we','you','is','are','was','were','has','have','had','do','does','did','will','would','could','should','may','must','can','in','on','at','by','to','of','as','be','been','being','per','via','versus','vs','etc','e.g','i.e','cf','al','et',
    'moreover','meanwhile','consequently','hence','thus','similarly','conversely','nonetheless','nevertheless','accordingly','subsequently','specifically','notably','overall','finally','importantly','interestingly','surprisingly','unfortunately','fortunately','clearly','indeed','certainly','likewise','regardless','instead','otherwise','still','yet','besides','elsewhere','first','second','third','next','last','lastly','initially','ultimately','thereafter','therein','herein','conversely',
    'selanjutnya','kemudian','selain','meskipun','walaupun','oleh','karena','sehingga','dengan','pada','dari','dalam','untuk','yang','adalah','merupakan','menurut','berdasarkan','sebagai','turut','serta','bahwa','tidak','sudah','masih','juga','bahkan','hanya','saja',
    'namun','sementara','sedangkan','akibatnya','demikian','singkatnya','secara','tentu','pasti','selain itu','di sisi lain','sebaliknya','pertama','kedua','ketiga','terakhir','akhirnya']);
}

var STYLES = {
  apa7: {
    id: 'apa7', name: 'APA 7th Edition', family: 'author-date',
    etAlThreshold: 3, sep: '&', altSep: 'and',
    refOrder: 'alphabetical', yearInParens: true, titleQuote: 'none',
    authorForm: 'all-inverted', // Last, F. M. & Last2, F. M.
  },
  harvard: {
    id: 'harvard', name: 'Harvard', family: 'author-date',
    etAlThreshold: 3, sep: 'and', altSep: '&',
    refOrder: 'alphabetical', yearInParens: true, titleQuote: 'single',
    authorForm: 'all-inverted',
  },
  chicago: {
    id: 'chicago', name: 'Chicago (Author-Date)', family: 'author-date',
    etAlThreshold: 4, sep: 'and', altSep: '&',
    refOrder: 'alphabetical', yearInParens: false, titleQuote: 'double',
    authorForm: 'first-inverted', refListFullUpTo: 10,
  },
  mla9: {
    id: 'mla9', name: 'MLA 9th Edition', family: 'author-page',
    etAlThreshold: 3, sep: 'and', altSep: '&',
    refOrder: 'alphabetical', titleQuote: 'double',
    authorForm: 'first-inverted',
  },
  ieee: {
    id: 'ieee', name: 'IEEE', family: 'numeric',
    refOrder: 'citation-order', titleQuote: 'double',
    authorForm: 'non-inverted', refListFullUpTo: 6,
    refPrefix: 'bracket', // [1]
  },
  vancouver: {
    id: 'vancouver', name: 'Vancouver', family: 'numeric',
    refOrder: 'citation-order', titleQuote: 'none',
    authorForm: 'vancouver', refListFullUpTo: 6,
    refPrefix: 'dot', // 1.
  },
};

// ---------- AUTHOR PARSING (style-aware) ----------
function splitOnSeparators(str, sepWord) {
  // Splits "A, B, and C" / "A, B & C" into ['A','B','C'], respecting the given primary separator word/symbol
  var s = str.trim();
  s = s.replace(/\s*&\s*/g, ' %AMP% ').replace(/\s+and\s+/gi, ' %AND% ').replace(/\s+dan\s+/gi, ' %AND% ');
  var lastSepMatch = s.match(/%AMP%|%AND%/g);
  var parts;
  if (lastSepMatch) {
    var lastIdx = s.lastIndexOf(lastSepMatch[lastSepMatch.length - 1]);
    var before = s.substring(0, lastIdx).replace(/%AMP%|%AND%/g, ',').replace(/,\s*$/, '');
    var after = s.substring(lastIdx).replace(/%AMP%|%AND%/g, '').trim();
    parts = before.split(',').map(function(x){return x.trim();}).filter(Boolean);
    if (after) parts.push(after);
  } else {
    parts = s.split(',').map(function(x){return x.trim();}).filter(Boolean);
  }
  return parts;
}

var AuthorParsers = {
  // "Last, F. M." for ALL authors (APA, Harvard)
  allInverted: function(str) {
    var cleaned = str.replace(/\.\s*$/, '').trim();
    var parts = splitOnSeparators(cleaned);
    var authors = [];
    var buffer = null;
    var initialsOnly = /^([A-Z]\.\s*)*[A-Z]\.?$/;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (initialsOnly.test(p)) {
        if (buffer) { authors.push(buffer + ', ' + p); buffer = null; }
      } else {
        if (buffer) authors.push(buffer);
        buffer = p;
      }
    }
    if (buffer) authors.push(buffer);
    return authors.length ? authors : (cleaned ? [cleaned] : []);
  },
  // First author "Last, First M.", rest "First M. Last" (Chicago, MLA)
  firstInverted: function(str) {
    var cleaned = str.replace(/\.\s*$/, '').trim();
    if (!cleaned) return [];
    var work = cleaned.replace(/\s*&\s*/g, ' %AND% ').replace(/\s+and\s+/gi, ' %AND% ').replace(/\s+dan\s+/gi, ' %AND% ');
    var segments = work.split(/%AND%/).map(function(s) { return s.trim().replace(/,\s*$/, ''); }).filter(Boolean);
    var authors = [];
    segments.forEach(function(seg, idx) {
      if (idx === 0) {
        var commaParts = seg.split(',').map(function(x) { return x.trim(); }).filter(Boolean);
        if (commaParts.length <= 2) {
          authors.push(seg);
        } else {
          authors.push(commaParts[0] + ', ' + commaParts[1]);
          for (var k = 2; k < commaParts.length; k++) authors.push(commaParts[k]);
        }
      } else {
        authors.push(seg);
      }
    });
    return authors;
  },
  // "F. M. Last" never inverted (IEEE)
  nonInverted: function(str) {
    var cleaned = str.replace(/\.\s*$/, '').trim();
    var arr = splitOnSeparators(cleaned);
    return arr.filter(Boolean);
  },
  // "Last FM" comma separated, no 'and' (Vancouver / ICMJE)
  vancouver: function(str) {
    var cleaned = str.replace(/\.\s*$/, '').trim();
    var arr = cleaned.split(',').map(function(x){return x.trim();}).filter(Boolean);
    return arr;
  },
};

function parseAuthorsForStyle(authorStr, styleId) {
  var style = STYLES[styleId];
  if (!authorStr || !authorStr.trim()) return { authors: [], isInstitutional: false };
  var trimmed = authorStr.trim();
  if (!looksLikeNonInvertedAuthorList(trimmed) && isInstitutionalAuthor(trimmed.replace(/,\s*$/, ''))) {
    return { authors: [trimmed.replace(/\.\s*$/, '')], isInstitutional: true };
  }
  var authors;
  switch (style.authorForm) {
    case 'all-inverted': authors = AuthorParsers.allInverted(authorStr); break;
    case 'first-inverted': authors = AuthorParsers.firstInverted(authorStr); break;
    case 'non-inverted': authors = AuthorParsers.nonInverted(authorStr); break;
    case 'vancouver': authors = AuthorParsers.vancouver(authorStr); break;
    default: authors = AuthorParsers.allInverted(authorStr);
  }
  return { authors: authors, isInstitutional: false };
}

function looksLikeInitialToken(t) {
  return /^\p{Lu}\.$/u.test(t) || /^\p{Lu}$/u.test(t) || /^\p{Lu}{2,4}$/u.test(t);
}

// In-text citation tokens are written "Surname" or "H. Surname" (initial(s) then surname) —
// never "Surname, Initial". Strips a leading initial block so the key matches the reference
// list's surname exactly, e.g. "H. Zhang" and "Zhang, H." both key to "zhang". Real short
// multi-word surnames ("Le Guin", "Van Der Berg") are untouched because a genuine name
// particle/word is never all-uppercase like a true initial is.
function surnameFromCitationToken(token) {
  var s = (token || '').trim();
  if (!s) return '';
  // A trailing possessive ('s / 's) is grammar, not part of the name — "Bandura's (1986) theory"
  // must match the reference "Bandura, A. (1986)" the same as plain "Bandura (1986)" would.
  s = s.replace(/['\u2019]s$/, '');
  var toks = s.split(/\s+/);
  if (toks.length === 1) return s;
  var leading = toks.slice(0, -1);
  if (leading.every(looksLikeInitialToken)) return toks[toks.length - 1];
  return s;
}

// Extracts the given-name initial from an in-text citation token, e.g. "H. Zhang" -> "H".
// Returns null if the citation has no initial (the normal, unambiguous case).
function initialFromCitationToken(token) {
  var s = (token || '').trim();
  var toks = s.split(/\s+/);
  if (toks.length < 2) return null;
  var leading = toks.slice(0, -1);
  if (!leading.every(looksLikeInitialToken)) return null;
  var first = leading[0].replace(/\./g, '');
  return first ? first[0].toUpperCase() : null;
}

// Extracts the given-name initial from a REFERENCE's author fragment, accounting for the
// author-name shape used by each citation style family.
function initialFromRefAuthor(authorFragment, styleId) {
  var style = STYLES[styleId];
  var s = (authorFragment || '').trim();
  if (!s) return null;
  if (style.authorForm === 'non-inverted') {
    var toks = s.split(/\s+/);
    if (toks.length < 2) return null;
    var f = toks[0].replace(/\./g, '');
    return f ? f[0].toUpperCase() : null;
  }
  if (style.authorForm === 'vancouver') {
    var m = s.match(/^(.+?)\s+(\p{Lu}{1,3})$/u);
    return m ? m[2][0] : null;
  }
  if (s.includes(',')) {
    var given = s.split(',')[1];
    if (!given) return null;
    var gtoks = given.trim().split(/\s+/).filter(Boolean);
    if (!gtoks.length) return null;
    var g0 = gtoks[0].replace(/\./g, '');
    return g0 ? g0[0].toUpperCase() : null;
  }
  return null;
}

function surnameOf(authorFragment, styleId) {
  var style = STYLES[styleId];
  var s = (authorFragment || '').trim();
  if (!s) return '';
  if (style.authorForm === 'non-inverted') {
    // "F. M. Last" -> surname is last token
    var toks = s.split(/\s+/);
    return toks[toks.length - 1];
  }
  if (style.authorForm === 'vancouver') {
    // "Last FM" -> surname is everything before the trailing initials block
    var m = s.match(/^(.+?)\s+[A-Z]{1,3}$/);
    return m ? m[1] : s;
  }
  // inverted forms: "Last, First" or just "Last" (subsequent MLA/Chicago authors are "First Last")
  if (s.includes(',')) return s.split(',')[0].trim();
  var toks2 = s.split(/\s+/);
  return toks2[toks2.length - 1];
}

var FormatDetector = {
  detect: function(articleText, referenceText) {
    var scores = { apa7: 0, harvard: 0, chicago: 0, mla9: 0, ieee: 0, vancouver: 0 };
    var signals = [];

    // --- In-text signals ---
    var numericBracket = (articleText.match(/\[\d+(?:\s*[,\-–]\s*\d+)*\]/g) || []).length;
    var numericParen = (articleText.match(/\(\d+(?:\s*[,\-–]\s*\d+)*\)/g) || []).length;
    var authorPageIntext = (articleText.match(/\([\p{Lu}\p{Lo}][\p{L}'\-]+\s+\d+(?:[-–]\d+)?\)/gu) || []).length;
    var authorYearIntext = (articleText.match(/\([\p{Lu}\p{Lo}][^()]*?,?\s*\d{4}[a-z]?\)/gu) || []).length;

    if (numericBracket > 0) { scores.ieee += 3; scores.vancouver += 3; signals.push('In-text pakai [angka] → gaya numerik'); }
    if (numericBracket === 0 && numericParen > 2 && authorYearIntext === 0) { scores.vancouver += 1; }
    if (authorPageIntext > authorYearIntext) { scores.mla9 += 3; signals.push('In-text pakai (Penulis Halaman) tanpa tahun → mengarah ke MLA'); }
    if (authorYearIntext > 0) { scores.apa7 += 1; scores.harvard += 1; scores.chicago += 1; signals.push('In-text pakai (Penulis, Tahun) → gaya author-date'); }

    // --- Reference list signals ---
    var lines = referenceText.split('\n').map(function(l){return l.trim();}).filter(Boolean);
    var refCount = lines.length || 1;
    var anyQuotedTitle = false;
    lines.forEach(function(line) {
      if (/^\[\d+\]/.test(line)) { scores.ieee += 4; }
      if (/^\d+\.\s/.test(line)) { scores.vancouver += 3; scores.mla9 -= 0.5; }
      if (/\(\d{4}[a-z]?\)/.test(line)) { scores.apa7 += 1; scores.harvard += 1; }
      if (/^\S[^()]*\.\s*\d{4}\.\s/.test(line)) { scores.chicago += 3; } // Author. Year. "Title."
      if (/["""][^"""]+["""]/.test(line)) { scores.chicago += 1; scores.ieee += 1; scores.mla9 += 1; }
      if (/'[^']+'/.test(line)) { scores.harvard += 2; anyQuotedTitle = true; }
      if (/["""][^"""]+["""]/.test(line)) { anyQuotedTitle = true; }
      if (/\bvol\.\s*\d+/i.test(line)) { scores.mla9 += 2; scores.ieee += 1; }
      if (/\bno\.\s*\d+/i.test(line)) { scores.mla9 += 1; scores.ieee += 1; }
      if (/\bpp\.\s*\d+/i.test(line)) { scores.mla9 += 1; scores.chicago += 0.5; scores.harvard += 0.5; }
      // The clearest APA7-vs-Harvard fingerprint: how the volume(issue)+pages segment is
      // written. APA7: "12(1), 45-60" (no "pp."). Harvard: "12(1), pp. 45-60" (with "pp.").
      if (/\d+\s*\(\s*\d+\s*\)\s*,\s*pp\.\s*\d+/i.test(line)) { scores.harvard += 2.5; }
      else if (/\d+\s*\(\s*\d+\s*\)\s*,\s*\d+[-–]\d+/.test(line)) { scores.apa7 += 2.5; }
      if (/\d{4};\d+(\(\d+\))?:\d+/.test(line)) { scores.vancouver += 4; } // Year;Vol(Issue):Pages
      if (/^[\p{Lu}\p{Lo}][\p{L}'\-]+\s+[A-Z]{1,3}[,.]/u.test(line)) { scores.vancouver += 2; } // Last FM,
      if (/^[A-Z]\.\s*[A-Z]?\.?\s*[\p{Lu}\p{Lo}][\p{L}'\-]+,/u.test(line)) { scores.ieee += 2; } // F. M. Last,
    });
    // APA7 never quotes titles at all — if nothing in the whole reference list is quoted,
    // that absence is itself informative (Harvard/Chicago/MLA/IEEE all quote titles).
    if (!anyQuotedTitle && lines.length > 0) { scores.apa7 += 1.5; }

    var best = 'apa7', bestScore = -Infinity;
    Object.keys(scores).forEach(function(k) { if (scores[k] > bestScore) { bestScore = scores[k]; best = k; } });
    var total = Object.keys(scores).reduce(function(a,k){return a+Math.max(scores[k],0);}, 0) || 1;
    var confidence = Math.max(0, Math.min(100, Math.round((bestScore / total) * 100)));
    if (lines.length === 0) confidence = 0;

    return { styleId: best, confidence: confidence, scores: scores, signals: signals };
  }
};

// ---------- REFERENCE LIST PARSING ----------

function extractYear(line, style) {
  if (style.yearInParens === false) {
    var m = line.match(/\.\s*(\d{4}[a-z]?)\.\s/);
    if (m) return m[1];
  }
  var m2 = line.match(/\((\d{4}[a-z]?|n\.d\.)\)/);
  if (m2) return m2[1];
  var m3 = line.match(/\b(19|20)\d{2}[a-z]?\b/);
  return m3 ? m3[0] : null;
}

// Strips trailing sentence-punctuation (., ,, ;) unconditionally, but only strips a trailing
// ")"/"]" if it does NOT have a matching "("/"[" earlier in the string — some publishers
// legitimately include a parenthesized issue number as part of the DOI suffix itself (e.g.
// Virtual Economics: 10.34021/ve.2023.06.03(1)), and blindly stripping it would truncate an
// otherwise-valid DOI.
function trimDOITrailingPunctuation(doi) {
  var out = doi;
  while (out.length) {
    var last = out.charAt(out.length - 1);
    if (last === '.' || last === ',' || last === ';') { out = out.slice(0, -1); continue; }
    if (last === ')') {
      var opens = (out.match(/\(/g) || []).length, closes = (out.match(/\)/g) || []).length;
      if (opens >= closes) break; // kurung tutup ini berpasangan sah, berhenti memotong
      out = out.slice(0, -1); continue;
    }
    if (last === ']') {
      var opensB = (out.match(/\[/g) || []).length, closesB = (out.match(/\]/g) || []).length;
      if (opensB >= closesB) break;
      out = out.slice(0, -1); continue;
    }
    break;
  }
  return out;
}

function extractDOI(refLine) {
  var patterns = [
    /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,}\/[^\s]+)/i,
    /doi:\s*(10\.\d{4,}\/[^\s]+)/i,
    /\b(10\.\d{4,}\/[^\s]+)/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = refLine.match(patterns[i]);
    if (m) return trimDOITrailingPunctuation(m[1]).trim();
  }
  return null;
}

// Heuristically classifies a reference by source type, mainly so DOI-related checks can
// tell apart source types that rarely/never carry a DOI (books, theses, reports, plain
// websites) from journal articles and conference papers, where a missing DOI is worth
// flagging. This is pattern-based on the reference string's shape — not perfect, but good
// enough to stop books from being reported as if a missing DOI were a problem.
function detectSourceType(raw) {
  var s = raw || '';

  // Thesis / dissertation — rarely carry a DOI unless deposited with one by the repository.
  if (/\b(skripsi|tesis|disertasi|thesis|dissertation)\b/i.test(s)) return 'thesis';

  // Explicit ISBN mention is a strong, unambiguous book signal.
  if (/\bISBN\b/i.test(s)) return 'book';

  // Journal-article pattern. Covers several common shapes:
  //  - "..., 12(3), 45-67"       (vol(issue), pages — classic)
  //  - "..., 205, 107590"        (vol, article-number — no issue, single article-ID journals)
  //  - "..., 14, e0251234"       (vol, "e"-prefixed article ID — PLOS/eLife style)
  //  - "Volume 45, Article 102345" (spelled-out form)
  var journalPattern = /\b\d{1,4}\s*\(\s*[\w-]+\s*\)\s*,\s*\d+[-–]\d+/;
  var journalVolArticlePattern = /,\s*\d{1,4}\s*,\s*(?:pp?\.\s*)?e?\d{2,}(?:[-–]\d+)?\b/;
  var journalVolumeArticleWord = /\bvolume\s+\d+\s*,\s*article\s+\d+/i;
  var journalVolAbbrevPattern = /\bvol\.?\s*\d+\s*,\s*(?:no\.?\s*\d+\s*,\s*)?pp?\.\s*\d+/i;
  var journalNameHint = /\b(journal|jurnal|review|quarterly|annals?|transactions|majalah\s+ilmiah)\b/i;
  if (journalPattern.test(s) || journalVolArticlePattern.test(s) || journalVolumeArticleWord.test(s) || journalVolAbbrevPattern.test(s) || journalNameHint.test(s)) return 'journal-article';

  // Conference / proceedings.
  if (/\b(prosiding|proceedings|conference|seminar\s+nasional|konferensi|symposium)\b/i.test(s)) return 'conference';

  // Book chapter: "In X (Ed./Eds.), Book Title (pp. 1-20)."
  if (/\bIn\s+[^()]+\(Eds?\.?\)/i.test(s) || /\(pp\.\s*\d+/i.test(s) || /\bDalam\s+[^()]+\(Ed\.?\)/i.test(s)) return 'book-chapter';

  // Website / online source without DOI.
  if (/\b(retrieved from|diakses dari|diakses pada|accessed on)\b/i.test(s) || (/https?:\/\//i.test(s) && !/doi\.org/i.test(s))) return 'website';

  // Government/institutional report or working paper.
  if (/\b(laporan\s+(tahunan|penelitian)?|working\s+paper|policy\s+brief)\b/i.test(s)) return 'report';

  // Book publisher-ending heuristic: the final ". Segment." clause has no digits and
  // doesn't look like a journal name — typical of "Author. (Year). Title. Publisher." books.
  var tailMatch = s.match(/\.\s*([^.]+)\.\s*$/);
  if (tailMatch) {
    var tail = tailMatch[1].trim();
    var looksLikePublisher = tail.length > 0 && tail.length < 60 && !/\d/.test(tail) && !journalNameHint.test(tail) && !/^https?:\/\//i.test(tail);
    if (looksLikePublisher) return 'book';
  }

  return 'unknown';
}

// Source types where a missing DOI is normal/expected, not a red flag.
var DOI_NOT_EXPECTED_TYPES = { book: true, 'book-chapter': true, thesis: true, report: true, website: true };

function extractTitle(line, style, authorEndIdx) {
  var after = line.substring(authorEndIdx).trim();
  if (style.titleQuote === 'double') {
    var dq = after.match(/["“]([^"”]+)["”]/);
    if (dq) return dq[1].replace(/[,.]$/, '').trim();
  }
  if (style.titleQuote === 'single') {
    var sq = after.match(/'([^']+)'/);
    if (sq) return sq[1].trim();
  }
  var cleaned = after.replace(/^[.\s]+/, '');
  var firstPeriod = cleaned.indexOf('. ');
  if (firstPeriod > 0) return cleaned.substring(0, firstPeriod).trim();
  return cleaned.split('.')[0].trim();
}

// Extracts additional bibliographic fields beyond what parseReferenceLine used to return —
// journal name, ISSN/eISSN, volume, issue, pages, article number. Needed for higher-confidence
// source matching (e.g. against a journal/document index) where title+author+year alone isn't
// enough to disambiguate. Best-effort: any field it can't confidently find is left null rather
// than guessed.
function extractBibliographicFields(raw, title) {
  var result = { journal: null, issn: null, eissn: null, volume: null, issue: null, pages: null, articleNumber: null };
  if (!raw) return result;

  var issnM = raw.match(/\be-?issn\b\s*[:.]?\s*(\d{4}-\d{3}[\dXx])/i);
  if (issnM) { result.eissn = issnM[1].toUpperCase(); }
  var issnM2 = raw.match(/\bissn\b\s*[:.]?\s*(\d{4}-\d{3}[\dXx])/i);
  if (issnM2 && issnM2[0].toLowerCase().indexOf('eissn') === -1 && issnM2[0].toLowerCase().indexOf('e-issn') === -1) {
    result.issn = issnM2[1].toUpperCase();
  }

  // "12(3), 45-67" — vol(issue), pages
  var volIssuePages = raw.match(/\b(\d{1,4})\s*\(\s*([\w-]+)\s*\)\s*,\s*(\d+)[-–](\d+)/);
  if (volIssuePages) {
    result.volume = volIssuePages[1];
    result.issue = volIssuePages[2];
    result.pages = volIssuePages[3] + '-' + volIssuePages[4];
  } else {
    // "vol. 205, no. 3, pp. 45-67" — IEEE-ish
    var ieeeStyle = raw.match(/\bvol\.?\s*(\d+)\s*(?:,\s*no\.?\s*(\d+))?\s*,\s*pp?\.\s*(\d+)(?:[-–](\d+))?/i);
    if (ieeeStyle) {
      result.volume = ieeeStyle[1];
      if (ieeeStyle[2]) result.issue = ieeeStyle[2];
      result.pages = ieeeStyle[4] ? (ieeeStyle[3] + '-' + ieeeStyle[4]) : ieeeStyle[3];
    } else {
      // "205, 107590" or "14, e0251234" — volume, article-number (no issue, single-article-ID journals)
      var volArticle = raw.match(/,\s*(\d{1,4})\s*,\s*(?:pp?\.\s*)?(e?\d{2,})(?:[-–](\d+))?\b/);
      if (volArticle) {
        result.volume = volArticle[1];
        if (volArticle[3]) {
          result.pages = volArticle[2] + '-' + volArticle[3];
        } else if (/^e\d+$/i.test(volArticle[2]) || volArticle[2].length >= 5) {
          result.articleNumber = volArticle[2];
        } else {
          result.pages = volArticle[2];
        }
      }
    }
  }

  // Journal name: best-effort — the segment right after the title, up to wherever the
  // volume/pages/DOI block starts. Deliberately conservative; left null if it doesn't look clean.
  if (title) {
    var titleIdx = raw.indexOf(title);
    if (titleIdx !== -1) {
      var afterTitle = raw.slice(titleIdx + title.length).replace(/^[.,"\u201d'\s]+/, '');
      var endMatch = afterTitle.match(/,\s*\d|\bvol\.?\s*\d|https?:\/\/|\bdoi\b\s*:/i);
      var journalCandidate = endMatch ? afterTitle.slice(0, endMatch.index) : afterTitle.split(/[.,]/)[0];
      journalCandidate = journalCandidate.replace(/[.,;:\s]+$/, '').trim();
      if (journalCandidate && journalCandidate.length > 2 && journalCandidate.length < 150) {
        result.journal = journalCandidate;
      }
    }
  }

  return result;
}

function parseReferenceLine(line, styleId) {
  var style = STYLES[styleId];
  var raw = line.trim();
  if (!raw) return null;

  if (style.family === 'numeric') {
    var numLabel = null, rest = raw;
    if (style.refPrefix === 'bracket') {
      var bm = raw.match(/^\[(\d+)\]\s*(.*)$/);
      if (bm) { numLabel = parseInt(bm[1], 10); rest = bm[2]; }
    } else if (style.refPrefix === 'dot') {
      var dm = raw.match(/^(\d+)\.\s*(.*)$/);
      if (dm) { numLabel = parseInt(dm[1], 10); rest = dm[2]; }
    }
    var authorSeg;
    if (style.authorForm === 'non-inverted') {
      var qIdx = rest.search(/["“]/);
      authorSeg = qIdx > -1 ? rest.substring(0, qIdx).replace(/,\s*$/, '') : rest.split('.')[0];
    } else {
      var firstPeriod = rest.indexOf('. ');
      authorSeg = firstPeriod > -1 ? rest.substring(0, firstPeriod) : rest;
    }
    var parsedAuthors = parseAuthorsForStyle(authorSeg, styleId);
    var year = extractYear(rest, style) || (rest.match(/\b(19|20)\d{2}\b/) || [null])[0];
    var titleStart = authorSeg.length;
    var title = extractTitle(rest, style, titleStart);
    var doi = extractDOI(raw);
    var bibFields = extractBibliographicFields(raw, title);
    return {
      raw: raw, numLabel: numLabel, authors: parsedAuthors.authors, isInstitutional: parsedAuthors.isInstitutional,
      authorCount: parsedAuthors.authors.length, firstAuthor: parsedAuthors.authors[0] || null,
      year: year, title: title, journal: bibFields.journal, issn: bibFields.issn, eissn: bibFields.eissn,
      volume: bibFields.volume, issue: bibFields.issue, pages: bibFields.pages, articleNumber: bibFields.articleNumber,
      doi: doi, styleId: styleId, sourceType: detectSourceType(raw),
    };
  }

  var yearMatch, authorSeg2, year2, titleStartIdx;
  if (style.yearInParens === false) {
    yearMatch = raw.match(/^(.*?)\.\s*(\d{4}[a-z]?)\.\s/);
    if (yearMatch) { authorSeg2 = yearMatch[1]; year2 = yearMatch[2]; titleStartIdx = yearMatch.index + yearMatch[0].length; }
  } else {
    yearMatch = raw.match(/\((\d{4}[a-z]?|n\.d\.)\)/);
    if (yearMatch) { authorSeg2 = raw.substring(0, yearMatch.index).trim(); year2 = yearMatch[1]; titleStartIdx = yearMatch.index + yearMatch[0].length; }
  }
  if (!yearMatch) {
    var dq2 = raw.match(/["“]/);
    if (dq2) {
      authorSeg2 = raw.substring(0, dq2.index).replace(/\.\s*$/, '');
      var ym = raw.match(/,\s*(19|20)\d{2}\b/) || raw.match(/\b(19|20)\d{2}\b/);
      year2 = ym ? ym[0].replace(/^,\s*/, '') : null;
      titleStartIdx = dq2.index;
    } else {
      return null;
    }
  }
  if (!authorSeg2) return null;
  var parsedAuthors2 = parseAuthorsForStyle(authorSeg2, styleId);
  var title2 = extractTitle(raw, style, titleStartIdx);
  var doi2 = extractDOI(raw);
  var bibFields2 = extractBibliographicFields(raw, title2);
  return {
    raw: raw, authors: parsedAuthors2.authors, isInstitutional: parsedAuthors2.isInstitutional,
    authorCount: parsedAuthors2.authors.length, firstAuthor: parsedAuthors2.authors[0] || null,
    year: year2, title: title2, journal: bibFields2.journal, issn: bibFields2.issn, eissn: bibFields2.eissn,
    volume: bibFields2.volume, issue: bibFields2.issue, pages: bibFields2.pages, articleNumber: bibFields2.articleNumber,
    doi: doi2, styleId: styleId, sourceType: detectSourceType(raw),
  };
}

function parseReferenceListDetailed(referenceText, styleId) {
  var rawLines = (referenceText || '').split('\n');
  var references = [];
  var failedLines = [];
  var totalFound = 0;
  rawLines.forEach(function(rawLine, idx) {
    var trimmed = rawLine.trim();
    if (!trimmed) return;
    totalFound++;
    var lineNumber = idx + 1;
    var r = parseReferenceLine(trimmed, styleId);
    var weak = r && !r.year && !r.title; // numeric family "succeeds" even with nothing useful extracted
    if (!r || weak) {
      failedLines.push({
        lineNumber: lineNumber, text: trimmed,
        reason: !r ? 'Pola penulis/tahun tidak dikenali untuk gaya ini' : 'Tidak ada tahun maupun judul yang terbaca',
      });
      return;
    }
    r.lineNumber = lineNumber;
    references.push(r);
  });
  return { references: references, failedLines: failedLines, totalFound: totalFound, succeededCount: references.length, failedCount: failedLines.length };
}

function parseReferenceList(referenceText, styleId) {
  return parseReferenceListDetailed(referenceText, styleId).references;
}

// ---------- MATCH KEY HELPERS ----------
function normalizeKeyName(name, isInstitutional) {
  if (!name) return '';
  if (isInstitutional) {
    var pairing = extractAcronymPairing(name);
    var base = pairing ? pairing.full : name;
    return base.toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^\p{L}\p{N}]/gu, '');
  }
  return stripNameParticles(name).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function acronymOf(name) {
  var pairing = extractAcronymPairing(name);
  if (pairing) return pairing.acronym.toLowerCase();
  if (ACRONYM_PATTERN.test(name.trim())) return name.trim().toLowerCase();
  return null;
}

// ---------- MAIN VALIDATOR ----------
function MultiFormatValidator(articleText, referenceText, styleId) {
  this.articleText = articleText;
  this.referenceText = referenceText;
  this.styleId = styleId;
  this.style = STYLES[styleId];
  this.errors = [];
  this.warnings = [];
  this.suggestions = [];
  this.institutionalNotes = [];
  this.citations = [];
  this.references = [];
}

function computeLineNumber(text, charOffset) {
  if (charOffset < 0) return null;
  return text.slice(0, charOffset).split('\n').length;
}

// Best-effort location tagging: works retroactively for every issue that has a `code`
// snippet (the vast majority) by finding where that exact text appears in the article or
// reference text, without needing to touch every single error-creation call site. Reference
// issues are checked first since `code` there is usually a verbatim substring of a specific
// reference line; falls back to the article text for citation-based issues.
MultiFormatValidator.prototype.annotateLocations = function() {
  var self = this;
  var allIssues = this.errors.concat(this.warnings).concat(this.suggestions);
  allIssues.forEach(function(issue) {
    if (issue.location || !issue.code) return;
    var snippet = issue.code.split(' | ')[0].trim();
    if (!snippet) return;
    var needle = snippet.length > 50 ? snippet.slice(0, 50) : snippet;
    var refIdx = self.referenceText.indexOf(needle);
    if (refIdx !== -1) {
      issue.location = { source: 'reference', line: computeLineNumber(self.referenceText, refIdx) };
      return;
    }
    var artIdx = self.articleText.indexOf(needle);
    if (artIdx !== -1) {
      issue.location = { source: 'article', line: computeLineNumber(self.articleText, artIdx) };
    }
  });
};

MultiFormatValidator.prototype.validate = function() {
  this.buildAcronymMap();
  this.citationCounts = new Map(); // ref object -> number of times it's actually cited (for analytics)
  var parsed = parseReferenceListDetailed(this.referenceText, this.styleId);
  this.references = parsed.references;
  this.parseStats = { totalFound: parsed.totalFound, succeededCount: parsed.succeededCount, failedCount: parsed.failedCount };
  this.failedLines = parsed.failedLines;
  var family = this.style.family;

  // Apa pun yang berada SEBELUM heading "Introduction"/"Pendahuluan" (judul, metadata penulis,
  // kotak "How to Cite" / kutip-naskah-ini-sendiri, info artikel, abstrak) dikecualikan dari
  // pemindaian sitasi — bagian itu sering memuat pola mirip sitasi yang SEBENARNYA bukan sitasi
  // sungguhan (paling umum: "To cite this article: Nama, A. (2026)..." yang secara kebetulan
  // persis berbentuk sitasi naratif). Teks artikel ITU SENDIRI tidak dipotong (articleText tetap
  // utuh) — supaya nomor baris yang dilaporkan untuk masalah lain tetap sesuai dokumen asli;
  // yang difilter cuma OBJEK SITASI yang posisinya jatuh sebelum offset ini. Kalau heading tidak
  // ditemukan, offset-nya 0 -> tidak ada yang terfilter (perilaku lama, aman secara default).
  var introHeading = findIntroductionHeading(this.articleText);
  var introOffset = introHeading ? introHeading.offset + introHeading.lineLength : 0;
  function afterIntro(c) { return c.position >= introOffset; }

  if (family === 'numeric') {
    this.citations = extractNumericCitations(this.articleText).filter(afterIntro);
    this.validateNumeric();
  } else if (family === 'author-date') {
    this.citations = extractAuthorDateCitations(this.articleText).filter(afterIntro);
    this.validateAuthorDate();
  } else if (family === 'author-page') {
    this.citations = extractAuthorPageCitations(this.articleText).filter(afterIntro);
    this.validateAuthorPage();
  }

  if (family === 'author-date' || family === 'author-page') {
    this.validateCitationFormat();
  }

  this.validateInstitutionalConsistency();
  this.validateReferenceOrdering();
  this.detectDuplicateReferences();
  this.detectMixedCitationStyles();
  this.annotateLocations();
  var analytics = computeReferenceAnalytics(this);

  return {
    errors: this.errors, warnings: this.warnings, suggestions: this.suggestions,
    citations: this.citations, references: this.references, styleId: this.styleId,
    parseStats: this.parseStats, failedLines: this.failedLines, analytics: analytics,
  };
};

// ----- NUMERIC FAMILY (IEEE / Vancouver) -----
MultiFormatValidator.prototype.validateNumeric = function() {
  var self = this;
  var refByNumber = {};
  this.references.forEach(function(r) { if (r.numLabel != null) refByNumber[r.numLabel] = r; });

  if (this.references.length > 0 && Object.keys(refByNumber).length === 0) {
    this.errors.push({ title: 'Nomor referensi tidak terdeteksi', description: 'Baris referensi tidak diawali format nomor yang dikenali (' + (this.style.refPrefix === 'bracket' ? '[1]' : '1.') + ') untuk gaya ' + this.style.name + '.', severity: 'error' });
  }

  // first-appearance order of each cited number
  var firstSeenOrder = [];
  var seenNums = new Set();
  this.citations.forEach(function(c) {
    c.numbers.forEach(function(n) {
      if (!seenNums.has(n)) { seenNums.add(n); firstSeenOrder.push(n); }
      if (!refByNumber[n]) {
        self.errors.push({ title: 'Sitasi merujuk nomor yang tidak ada di referensi', description: 'Sitasi "' + c.raw + '" merujuk [' + n + '] tetapi tidak ada referensi bernomor ' + n + '.', code: c.raw, severity: 'error' });
      } else {
        self.citationCounts.set(refByNumber[n], (self.citationCounts.get(refByNumber[n]) || 0) + 1);
      }
    });
  });

  // reference numbering should follow order of first citation
  var expectedOrder = firstSeenOrder.slice().sort(function(a,b){return a-b;});
  var actualCitationOrderOfRefNumbers = this.references.map(function(r){return r.numLabel;}).filter(function(n){return n!=null;});
  var isSequential = actualCitationOrderOfRefNumbers.every(function(n, i){ return n === i + 1; });
  if (!isSequential && actualCitationOrderOfRefNumbers.length > 1) {
    this.errors.push({ title: 'Penomoran referensi tidak berurutan', description: 'Daftar referensi ' + this.style.name + ' seharusnya diberi nomor urut 1, 2, 3, … tanpa lompat/duplikat.', severity: 'error' });
  }
  var mismatchOrder = false;
  for (var i = 0; i < firstSeenOrder.length; i++) {
    if (firstSeenOrder[i] !== i + 1) { mismatchOrder = true; break; }
  }
  if (mismatchOrder && firstSeenOrder.length > 1) {
    this.errors.push({ title: 'Referensi tidak sesuai urutan kemunculan sitasi', description: 'Pada ' + this.style.name + ', referensi nomor 1 harus sumber yang PERTAMA disitasi dalam teks, nomor 2 sumber kedua, dst. Urutan kemunculan sitasi di teks saat ini: [' + firstSeenOrder.join(', ') + '].', severity: 'error' });
  }

  // uncited references
  this.references.forEach(function(r) {
    if (r.numLabel != null && !seenNums.has(r.numLabel)) {
      self.errors.push({ title: 'Referensi tidak pernah disitasi', description: 'Referensi nomor ' + r.numLabel + ' (' + (r.firstAuthor || '-') + ') ada di daftar pustaka tapi tidak dirujuk di teks.', code: r.raw.substring(0, 120), severity: 'error' });
    }
  });

  // author-list length / et al. suggestion in reference list (ICMJE: 6+ -> et al.)
  var threshold = this.style.refListFullUpTo;
  this.references.forEach(function(r) {
    if (!r.isInstitutional && r.authorCount > threshold) {
      self.suggestions.push({ title: 'Daftar penulis panjang', description: 'Referensi "' + (r.firstAuthor||'-') + '" memiliki ' + r.authorCount + ' penulis. Untuk ' + self.style.name + ', umumnya cukup cantumkan ' + threshold + ' penulis pertama diikuti "et al."', code: r.raw.substring(0, 150), severity: 'suggestion' });
    }
  });
};

// ----- AUTHOR-DATE FAMILY (APA / Harvard / Chicago) -----
MultiFormatValidator.prototype.validateAuthorDate = function() {
  var self = this;
  var style = this.style;
  var refMap = new Map();
  this.references.forEach(function(r) {
    var key = self.keyFromRefAuthor(r) + '_' + (r.year || '');
    if (!refMap.has(key)) refMap.set(key, []);
    refMap.get(key).push(r);
  });
  this.refMap = refMap;

  // ----- Same-surname + same-year collisions (e.g. "H. Zhang, 2023" vs "F. Zhang, 2023") -----
  // Two different keys can still legitimately collide once we key only by surname+year.
  // Figure out, per colliding group, whether it looks like the SAME author with two works
  // (same/no initial, different titles -> suggest 2023a/2023b) or DIFFERENT people who just
  // share a surname (different initials -> citations need the initial to disambiguate).
  var matchedRefs = new Set(); // resolved specific reference objects (used for collision groups)
  var collisionGroups = [];
  refMap.forEach(function(refs, key) {
    if (refs.length < 2) return;
    var withInitial = refs.map(function(r) { return { ref: r, initial: initialFromRefAuthor(r.firstAuthor, self.styleId) }; });
    var initials = withInitial.map(function(x) { return x.initial; }).filter(Boolean);
    var distinctInitials = initials.filter(function(v, i) { return initials.indexOf(v) === i; });
    var differentPeople = distinctInitials.length >= 2 && distinctInitials.length === initials.length;
    collisionGroups.push({ key: key, refs: refs, differentPeople: differentPeople, firstInitial: withInitial[0].initial });
    if (!differentPeople) {
      // same/missing initials -> likely the same author with 2+ works published the same year.
      // This is a reference-list formatting issue independent of how citations turn out, so
      // it's reported unconditionally (unlike the "different people" case below).
      var namesList = refs.map(function(r) { return '"' + (r.firstAuthor || '-') + ' (' + r.year + ')"'; }).join(', ');
      var suffixLetters = 'abcdefghij';
      var suggestion = refs.map(function(r, i) { return (r.year || '') + suffixLetters[i]; }).join(' / ');
      self.errors.push({
        title: 'Nama belakang & tahun sama, kemungkinan penulis sama', severity: 'error',
        description: refs.length + ' referensi punya nama belakang dan tahun yang sama (' + namesList + '). Jika ini penulis yang sama dengan ' + refs.length + ' karya di tahun itu, beri akhiran huruf pada tahun (di referensi maupun sitasi): ' + suggestion + '.',
        code: refs.map(function(r){return r.raw.substring(0,100);}).join(' | '),
      });
    }
  });

  var citedKeys = new Set();
  var citationDetails = [];
  this.citedKeys = citedKeys;

  this.citations.forEach(function(c) {
    if (c.type === 'parenthetical') {
      // check separator
      if (c.parts.length === 1) {
        var p = c.parts[0];
        if (p.authors.length === 2) {
          if (style.sep === '&' && p.usedAnd && !p.usedAmp) {
            self.errors.push({ title: 'Pemisah dua penulis salah', description: 'Gaya ' + style.name + ' memakai "&" untuk dua penulis dalam kurung, bukan "and"/"dan".', code: '(' + p.raw + ')', correction: '(' + p.authors[0] + ' & ' + p.authors[1] + ', ' + p.year + ')', severity: 'error' });
          }
          if (style.sep === 'and' && p.usedAmp) {
            self.errors.push({ title: 'Pemisah dua penulis salah', description: 'Gaya ' + style.name + ' memakai "and" untuk dua penulis, bukan "&".', code: '(' + p.raw + ')', correction: '(' + p.authors[0] + ' and ' + p.authors[1] + ', ' + p.year + ')', severity: 'error' });
          }
        }
        if (p.authorCount >= style.etAlThreshold && !p.hasEtAl) {
          self.errors.push({ title: style.etAlThreshold + '+ penulis tanpa "et al."', description: 'Sitasi menulis ' + p.authorCount + ' nama, padahal ' + style.name + ' mengharuskan "et al." mulai ' + style.etAlThreshold + ' penulis.', code: '(' + p.raw + ')', correction: '(' + p.firstAuthor + ' et al., ' + p.year + ')', severity: 'error' });
        }
      } else {
        var fa = c.parts.map(function(p){return self.keyFromCitationToken(p.firstAuthor);});
        // localeCompare (bukan operator < / > mentah) supaya huruf berdiakritik (Ç, Ú, É, Ñ, ...)
        // dibandingkan berdasarkan huruf dasarnya, bukan urutan kode-Unicode mentahnya — kode
        // Unicode taruh huruf besar berdiakritik SETELAH huruf kecil 'z' biasa, yang salah
        // secara alfabetis (mis. "Çivitci" harus di antara "C" dan "D", bukan di akhir).
        var isAlpha = fa.every(function(v,i){return i===0 || fa[i-1].localeCompare(fa[i], 'en', { sensitivity: 'base' }) <= 0;});
        if (!isAlpha) {
          var sortedParts = c.parts.map(function(p, i) { return { part: p, key: fa[i] }; })
            .sort(function(a, b) { return a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }); })
            .map(function(x) { return x.part.raw; });
          self.errors.push({ title: 'Multiple citations tidak alfabetis', description: 'Beberapa sitasi dalam satu kurung harus diurutkan alfabetis berdasarkan penulis pertama.', code: c.raw, correction: '(' + sortedParts.join('; ') + ')', severity: 'error' });
        }
      }
      c.parts.forEach(function(p) {
        if (p.firstAuthor) {
          var key = self.keyFromCitationToken(p.firstAuthor) + '_' + p.year;
          citedKeys.add(key);
          var altKey = null;
          // A 2-"author" citation whose first part looks institutional might actually be ONE
          // combined institutional name split by "&" (e.g. "Institute of International Finance
          // & Deloitte" — a joint report by two organizations) rather than two separate personal
          // co-authors, which citation-text extraction alone can't tell apart. Try the full
          // joined form as a fallback key too, matching how the reference side keys this same
          // entry (isInstitutional=true keeps the whole "&"-joined name as one unit).
          if (p.authorCount === 2 && p.authors && p.authors.length === 2 && isInstitutionalAuthor(p.firstAuthor)) {
            altKey = self.keyFromCitationToken(p.authors.join(' & ')) + '_' + p.year;
            citedKeys.add(altKey);
          }
          citationDetails.push({ key: key, altKey: altKey, part: p, raw: c.raw, initial: initialFromCitationToken(p.firstAuthor), position: c.position });
        }
      });
    } else {
      var cleanAuthors = c.authors.replace(/\s*et\s+al\.?/i, '');
      // Same guard as the parenthetical branch above: a "Full Name [ACR]" pairing means this is
      // ONE institution introducing its own acronym, whose official name may itself contain
      // "and" (e.g. "Organisation for Economic Co-operation and Development [OECD]") — must not
      // be split into fake co-authors on that "and".
      var authors = extractAcronymPairing(cleanAuthors) ? [cleanAuthors] : splitOnSeparators(cleanAuthors);
      var hasEtAl = /et\s+al/i.test(c.authors);
      if (authors.length > 0) {
        var key2 = self.keyFromCitationToken(authors[0]) + '_' + c.year;
        citedKeys.add(key2);
        var altKey2 = null;
        // Same institutional-combined fallback as the parenthetical branch above — a narrative
        // "Institute of International Finance & Deloitte (2023) explains..." citation splits
        // into two "authors" the same way.
        if (authors.length === 2 && !hasEtAl && isInstitutionalAuthor(authors[0])) {
          altKey2 = self.keyFromCitationToken(authors.join(' & ')) + '_' + c.year;
          citedKeys.add(altKey2);
        }
        citationDetails.push({ key: key2, altKey: altKey2, part: { firstAuthor: authors[0], authorCount: hasEtAl ? Math.max(authors.length,3) : authors.length, hasEtAl: hasEtAl, year: c.year }, raw: c.raw, initial: initialFromCitationToken(authors[0]), position: c.position });
        if (authors.length >= style.etAlThreshold && !hasEtAl) {
          self.errors.push({ title: 'Sitasi naratif ' + style.etAlThreshold + '+ penulis tanpa "et al."', description: 'Sitasi naratif "' + c.raw + '" menulis ' + authors.length + ' nama.', code: c.raw, correction: authors[0] + ' et al. (' + c.year + ')', severity: 'error' });
        }
      }
    }
  });

  // cross-reference
  citationDetails.forEach(function(d) {
    var matchKey = refMap.has(d.key) ? d.key : (d.altKey && refMap.has(d.altKey) ? d.altKey : null);
    if (!matchKey) {
      var fuzzy = self.fuzzyFind(d.key, refMap);
      if (!fuzzy) {
        self.errors.push({ title: 'Sitasi tidak ada di daftar referensi', description: 'Sitasi "' + d.raw + '" tidak memiliki entri cocok di daftar referensi.', code: d.raw, severity: 'error' });
      } else {
        self.suggestions.push({ title: 'Kemungkinan ketidakcocokan', description: 'Sitasi "' + d.raw + '" mungkin merujuk "' + fuzzy.firstAuthor + ' (' + fuzzy.year + ')".', code: d.raw, severity: 'suggestion' });
      }
    } else {
      var refs = refMap.get(matchKey);
      if (refs.length > 1) {
        // Collision group: try to resolve to ONE specific reference via the citation's initial.
        var candidates = refs.filter(function(ref) {
          var ri = initialFromRefAuthor(ref.firstAuthor, self.styleId);
          return d.initial && ri ? ri === d.initial : true;
        });
        if (d.initial && candidates.length === 1) {
          matchedRefs.add(candidates[0]);
          d.matchedRef = candidates[0];
          self.citationCounts.set(candidates[0], (self.citationCounts.get(candidates[0]) || 0) + 1);
          if (candidates[0].authorCount <= 2 && d.part.hasEtAl) {
            self.errors.push({ title: '"et al." untuk sumber hanya ' + candidates[0].authorCount + ' penulis', description: 'Referensi "' + candidates[0].firstAuthor + ' (' + candidates[0].year + ')" hanya punya ' + candidates[0].authorCount + ' penulis tercatat, tidak perlu "et al."', code: d.raw, severity: 'error' });
          }
        } else {
          self.errors.push({ title: 'Sitasi ambigu', description: 'Sitasi "' + d.raw + '" bisa merujuk ke ' + refs.length + ' referensi berbeda yang nama belakang & tahunnya sama (' + refs.map(function(r){return r.firstAuthor;}).join(' / ') + '). Tambahkan inisial pada sitasi untuk memperjelas.', code: d.raw, severity: 'error' });
        }
      } else {
        refs.forEach(function(ref) {
          matchedRefs.add(ref);
          d.matchedRef = ref;
          self.citationCounts.set(ref, (self.citationCounts.get(ref) || 0) + 1);
          if (ref.authorCount <= 2 && d.part.hasEtAl) {
            self.errors.push({ title: '"et al." untuk sumber hanya ' + ref.authorCount + ' penulis', description: 'Referensi "' + ref.firstAuthor + ' (' + ref.year + ')" hanya punya ' + ref.authorCount + ' penulis tercatat, tidak perlu "et al."', code: d.raw, severity: 'error' });
          }
        });
      }
    }
  });

  this.references.forEach(function(r) {
    var key = self.keyFromRefAuthor(r) + '_' + (r.year || '');
    var refs = refMap.get(key) || [];
    if (refs.length > 1) {
      // Collision group: this specific reference counts as cited only if a citation resolved to it.
      if (!matchedRefs.has(r)) self.errors.push({ title: 'Referensi tidak disitasi dalam teks', description: '"' + r.firstAuthor + ' (' + r.year + ')" ada di daftar referensi tapi tidak ada sitasi yang jelas merujuk ke sini (perlu inisial untuk memastikan).', code: r.raw.substring(0, 120), severity: 'error' });
      return;
    }
    if (!citedKeys.has(key)) {
      var found = false;
      for (var ck of citedKeys) { if (self.isFuzzyMatch(key, ck)) { found = true; break; } }
      if (!found) self.errors.push({ title: 'Referensi tidak disitasi dalam teks', description: '"' + r.firstAuthor + ' (' + r.year + ')" ada di daftar referensi tapi tidak disitasi.', code: r.raw.substring(0, 120), severity: 'error' });
    }
  });

  // APA7: an institutional/group author with a recognizable acronym must be spelled out in
  // FULL with the acronym in brackets — "Full Name [ACR]" — on its FIRST in-text citation;
  // only later citations may use the bare acronym alone. Group all matched citations by which
  // reference they resolved to, sort by document position, and check whether the very first one
  // is already the bare-acronym form (meaning the full form never appeared before it, or at all).
  var citationsByRef = new Map();
  citationDetails.forEach(function(d) {
    if (!d.matchedRef || !d.matchedRef.isInstitutional) return;
    var acr = (d.part.firstAuthor || '').trim();
    var pairing = extractAcronymPairing(acr);
    var groupKeySource, isFullFormHere, acronymText;
    if (pairing) {
      // this citation itself already spells out "Full Name [ACR]" — the correct first-use form.
      groupKeySource = pairing.full;
      isFullFormHere = true;
      acronymText = pairing.acronym;
    } else if (ACRONYM_PATTERN.test(acr)) {
      var resolved = self.resolveInstitutionalName(acr);
      if (!resolved || resolved === acr) return; // acronym not recognized at all — nothing to check
      groupKeySource = resolved;
      isFullFormHere = false;
      acronymText = acr;
    } else {
      return; // full institution name written out plainly, no acronym involved here
    }
    // Keyed by the resolved full name (not the specific reference object) — introducing
    // "Organization [ACR]" once covers every later citation of that SAME institution,
    // regardless of which particular year/publication from it is being cited each time.
    var groupKey = groupKeySource.toLowerCase();
    if (!citationsByRef.has(groupKey)) citationsByRef.set(groupKey, []);
    citationsByRef.get(groupKey).push({ position: d.position, raw: d.raw, acronym: acronymText, fullName: groupKeySource, isFullForm: isFullFormHere });
  });
  citationsByRef.forEach(function(mentions) {
    mentions.sort(function(a, b) { return a.position - b.position; });
    var first = mentions[0];
    if (!first.isFullForm) {
      self.suggestions.push({
        title: 'Singkatan institusi dipakai sebelum diperkenalkan lengkap',
        description: 'Sitasi pertama untuk "' + first.acronym + '" di teks langsung memakai singkatannya. APA7 mengharuskan kemunculan PERTAMA ditulis lengkap dengan singkatan dalam kurung siku, baru sitasi berikutnya boleh memakai singkatan saja — meskipun banyak jurnal tidak terlalu ketat menerapkan aturan ini.',
        code: first.raw,
        correction: first.raw.replace(first.acronym, first.fullName + ' [' + first.acronym + ']'),
        severity: 'suggestion',
      });
    }
  });

  // "Different people, same surname+year" is only worth flagging if disambiguation is still
  // incomplete somewhere — if every reference in the group already got cleanly resolved to a
  // specific citation (via initials), the document is already handling it correctly.
  collisionGroups.forEach(function(g) {
    if (!g.differentPeople) return;
    var allResolved = g.refs.every(function(r) { return matchedRefs.has(r); });
    if (allResolved) return;
    var namesList = g.refs.map(function(r) { return '"' + (r.firstAuthor || '-') + ' (' + r.year + ')"'; }).join(', ');
    self.errors.push({
      title: 'Nama belakang & tahun sama, penulis berbeda', severity: 'error',
      description: g.refs.length + ' referensi punya nama belakang dan tahun yang sama (' + namesList + ') tapi tampaknya orang berbeda, dan belum semua sitasi ke sini menyertakan inisial pembeda. Gunakan format "(' + (g.firstInitial || 'X') + '. ' + surnameOf(g.refs[0].firstAuthor, self.styleId) + ', ' + g.refs[0].year + ')" di setiap sitasi ke grup ini.',
      code: g.refs.map(function(r){return r.raw.substring(0,100);}).join(' | '),
    });
  });
};

// ----- AUTHOR-PAGE FAMILY (MLA) -----
MultiFormatValidator.prototype.validateAuthorPage = function() {
  var self = this;
  var refByAuthor = new Map();
  this.references.forEach(function(r) {
    var key = self.keyFromRefAuthor(r);
    if (!refByAuthor.has(key)) refByAuthor.set(key, []);
    refByAuthor.get(key).push(r);
  });
  this.refMap = refByAuthor;
  var citedKeys = new Set();
  this.citedKeys = citedKeys;

  this.citations.forEach(function(c) {
    c.parts.forEach(function(p) {
      if (!p.firstAuthor) return;
      var key = self.keyFromCitationToken(p.firstAuthor);
      citedKeys.add(key);
      if (p.authorCount >= 3 && !p.hasEtAl) {
        self.errors.push({ title: 'MLA: 3+ penulis tanpa "et al."', description: 'Sitasi "(' + p.raw + ')" menulis ' + p.authorCount + ' nama. MLA memakai "et al." mulai 3 penulis.', code: '(' + p.raw + ')', correction: '(' + p.firstAuthor + ' et al. ' + p.page + ')', severity: 'error' });
      }
      if (!refByAuthor.has(key)) {
        var fuzzy = self.fuzzyFind(key, refByAuthor);
        if (!fuzzy) self.errors.push({ title: 'Sitasi tidak ada di Works Cited', description: 'Sitasi "(' + p.raw + ')" tidak memiliki entri penulis cocok di Works Cited.', code: '(' + p.raw + ')', severity: 'error' });
      } else {
        refByAuthor.get(key).forEach(function(ref) { self.citationCounts.set(ref, (self.citationCounts.get(ref) || 0) + 1); });
      }
    });
  });

  this.references.forEach(function(r) {
    var key = self.keyFromRefAuthor(r);
    if (!citedKeys.has(key)) {
      self.errors.push({ title: 'Referensi tidak disitasi dalam teks', description: '"' + r.firstAuthor + '" ada di Works Cited tapi tidak disitasi (dengan nomor halaman) dalam teks.', code: r.raw.substring(0, 120), severity: 'error' });
    }
  });
};

// Standalone version of the acronym-pairing scan (see MultiFormatValidator.prototype.
// buildAcronymMap below) — usable without a full validator instance, e.g. by link-engine.js,
// which works with lower-level parsing functions rather than instantiating a validator.
function buildAcronymMapFromText(combinedText) {
  var map = {};
  // Institution names routinely include lowercase connector words that must NOT break the
  // capitalized-word chain — "of"/"the"/"and" in English, "dan"/"untuk"/"bagi" in Indonesian,
  // "ng"/"sa"/"at"/"para" in Filipino/Tagalog (e.g. "Bangko Sentral ng Pilipinas" = "Central
  // Bank of the Philippines" — "ng" means "of" and is always lowercase).
  var connector = '(?:of|the|and|dan|untuk|bagi|ng|sa|at|para|de|la|del)';
  var re = new RegExp('((?:(?:[\\p{Lu}\\p{Lo}][\\p{L}\'\u2019\\-]*|' + connector + ')\\s+){1,8}[\\p{Lu}\\p{Lo}][\\p{L}\'\u2019\\-]*)\\s*[\\(\\[]([A-Z]{2,8})[\\)\\]]', 'gu');
  var m;
  while ((m = re.exec(combinedText)) !== null) {
    map[m[2].toLowerCase()] = m[1].trim().replace(/^(?:The|A|An)\s+/i, '').replace(/[.,;:]$/, '');
  }
  return map;
}

MultiFormatValidator.prototype.buildAcronymMap = function() {
  this.acronymMap = buildAcronymMapFromText(this.articleText + '\n' + this.referenceText);
};

function resolveInstitutionalNameFromMap(name, acronymMap) {
  if (!name) return name;
  var trimmed = name.trim();
  var pairing = extractAcronymPairing(trimmed);
  if (pairing) return pairing.full;
  if (ACRONYM_PATTERN.test(trimmed) && acronymMap && acronymMap[trimmed.toLowerCase()]) {
    return acronymMap[trimmed.toLowerCase()];
  }
  // Fall back to a small list of universally recognized institutional acronyms (OECD, WHO,
  // IMF, ...) even when the document itself never explicitly writes out "Full Name (ACR)" —
  // very common in practice, since authors often treat well-known acronyms as not needing
  // introduction, even though strict APA7 style technically still wants it spelled out once.
  if (ACRONYM_PATTERN.test(trimmed) && KNOWN_INSTITUTIONAL_ACRONYMS[trimmed.toUpperCase()]) {
    return KNOWN_INSTITUTIONAL_ACRONYMS[trimmed.toUpperCase()];
  }
  return trimmed;
}

MultiFormatValidator.prototype.resolveInstitutionalName = function(name) {
  return resolveInstitutionalNameFromMap(name, this.acronymMap);
};

MultiFormatValidator.prototype.keyFromRefAuthor = function(r) {
  if (r.isInstitutional) return normalizeKeyName(this.resolveInstitutionalName(r.firstAuthor), true);
  return normalizeKeyName(surnameOf(r.firstAuthor, this.styleId), false);
};

MultiFormatValidator.prototype.keyFromCitationToken = function(token) {
  if (isInstitutionalAuthor(token)) return normalizeKeyName(this.resolveInstitutionalName(token), true);
  return normalizeKeyName(surnameFromCitationToken(token), false);
};

// Public helpers for UI: determine whether a given in-text citation token/year
// has a matching reference, and whether a given reference was cited in text.
// Used by the citation map so unmatched items render as errors (red), not green.
MultiFormatValidator.prototype.isCitationMatched = function(token, year) {
  if (!this.refMap) return null; // not yet validated (numeric family doesn't use this)
  var key = this.keyFromCitationToken(token) + (year != null ? '_' + year : (this.style.family === 'author-date' ? '_' : ''));
  if (this.refMap.has(key)) return true;
  return this.fuzzyFind(key, this.refMap) !== null;
};

MultiFormatValidator.prototype.isReferenceCited = function(r) {
  if (!this.citedKeys) return null;
  var key = this.keyFromRefAuthor(r) + (this.style.family === 'author-date' ? '_' + (r.year || '') : '');
  if (this.citedKeys.has(key)) return true;
  for (var ck of this.citedKeys) { if (this.isFuzzyMatch(key, ck)) return true; }
  return false;
};

MultiFormatValidator.prototype.fuzzyFind = function(key, refMap) {
  for (var entry of refMap) {
    var rk = entry[0], refs = entry[1];
    if (this.isFuzzyMatch(key, rk)) return Array.isArray(refs) ? refs[0] : refs;
  }
  return null;
};

MultiFormatValidator.prototype.isFuzzyMatch = function(k1, k2) {
  var p1 = k1.split('_'), p2 = k2.split('_');
  if (p1[1] !== undefined && p2[1] !== undefined && p1[1] !== p2[1]) return false;
  var n1 = p1[0], n2 = p2[0];
  if (n1 === n2) return true;
  if (n1.length > 3 && n2.length > 3 && (n1.startsWith(n2.substring(0,3)) || n2.startsWith(n1.substring(0,3)))) return true;
  return false;
};

// ----- REFERENCE LIST ORDERING -----
MultiFormatValidator.prototype.validateReferenceOrdering = function() {
  if (this.style.refOrder !== 'alphabetical' || this.references.length < 2) return;
  var self = this;
  var withKeys = this.references.map(function(r, idx) {
    var pairing = r.isInstitutional ? extractAcronymPairing(r.firstAuthor) : null;
    var sortBase = r.isInstitutional ? (pairing ? pairing.full : r.firstAuthor) : surnameOf(r.firstAuthor, self.styleId);
    return { idx: idx, sortKey: (sortBase || '').toLowerCase().replace(/^(the|a|an)\s+/i, ''), year: r.year || '', firstAuthor: r.firstAuthor, authorCount: r.authorCount || 1 };
  });
  var sorted = withKeys.slice().sort(function(a,b) {
    var cmp = a.sortKey.localeCompare(b.sortKey, 'en', { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    // APA: when the first-listed surname is the same, a SOLO-authored entry ("Teece, D.") is
    // ordered before ANY co-authored one with the same first surname ("Teece, D. J., Pisano, G.,
    // & Shuen, A."), regardless of publication year. This is narrower than "fewer authors always
    // wins" — two different MULTI-author entries by the same first author (e.g. "Sundari, A.,
    // Armanu, ... (2025)" vs "Sundari, A., Indrasari, ... (2026)", 4 vs 3 authors) are NOT
    // solo-vs-group, so they still sort by year like any other same-surname tie.
    if (a.authorCount === 1 && b.authorCount !== 1) return -1;
    if (b.authorCount === 1 && a.authorCount !== 1) return 1;
    return (a.year || '').localeCompare(b.year || '');
  });
  var isSorted = withKeys.every(function(w, i) { return w.idx === sorted[i].idx; });
  if (!isSorted) {
    var order = sorted.map(function(s){return s.firstAuthor + (s.year ? ' (' + s.year + ')' : '');}).join(' → ');
    this.errors.push({ title: 'Daftar referensi tidak alfabetis', description: this.style.name + ' mengharuskan daftar referensi diurutkan alfabetis berdasarkan nama belakang penulis pertama (atau nama institusi).', correction: 'Urutan yang benar: ' + order, severity: 'error' });
  }
};

// ----- DUPLICATE / NEAR-DUPLICATE REFERENCE DETECTION -----
// Catches: identical DOI reused across entries, near-identical titles (likely the same work
// pasted twice, or a preprint + published-version duplicate), and same-author-same-year
// entries with DIFFERENT titles that aren't yet disambiguated with a/b suffixes (numeric and
// author-page families don't go through validateAuthorDate's collision check, so this is
// their only safety net for that case too).
// ----- REFERENCE ANALYTICS -----
// Deliberately does NOT produce a single "quality score" — that would imply a scientific
// judgment this tool can't make. Every number here is a plain, individually-checkable count
// or percentage; interpreting what's "good" is left entirely to the person reading it.
function computeReferenceAnalytics(validator) {
  var refs = validator.references;
  var citations = validator.citations;
  var articleText = validator.articleText || '';
  var styleId = validator.styleId;
  var citationCounts = validator.citationCounts || new Map();
  var currentYear = new Date().getFullYear();

  var total = refs.length;

  // --- Unique sources (dedup by DOI, else normalized title) ---
  var seenKeys = new Set();
  refs.forEach(function(r) {
    var key = r.doi ? 'doi:' + r.doi.toLowerCase() : 'title:' + normalizeTitle(r.title || r.raw);
    seenKeys.add(key);
  });
  var uniqueSources = seenKeys.size;

  // --- Year distribution + median age ---
  var yearCounts = {};
  var ages = [];
  var unknownYearCount = 0;
  refs.forEach(function(r) {
    var y = r.year ? parseInt(String(r.year).replace(/[a-z]$/, ''), 10) : null;
    if (!y || isNaN(y)) { unknownYearCount++; return; }
    yearCounts[y] = (yearCounts[y] || 0) + 1;
    ages.push(currentYear - y);
  });
  var yearDistribution = Object.keys(yearCounts).map(function(y) { return { year: parseInt(y, 10), count: yearCounts[y] }; }).sort(function(a, b) { return a.year - b.year; });
  ages.sort(function(a, b) { return a - b; });
  var medianAge = null;
  if (ages.length > 0) {
    var mid = Math.floor(ages.length / 2);
    medianAge = ages.length % 2 === 0 ? (ages[mid - 1] + ages[mid]) / 2 : ages[mid];
  }

  // --- Source type breakdown ---
  var typeLabels = { 'journal-article': 'Artikel jurnal', 'book': 'Buku', 'book-chapter': 'Bab buku', 'thesis': 'Skripsi/Tesis/Disertasi', 'website': 'Website', 'report': 'Laporan', 'conference': 'Prosiding', 'unknown': 'Tidak teridentifikasi' };
  var typeCounts = {};
  refs.forEach(function(r) { var t = r.sourceType || 'unknown'; typeCounts[t] = (typeCounts[t] || 0) + 1; });
  var sourceTypeBreakdown = Object.keys(typeCounts).map(function(t) {
    return { type: t, label: typeLabels[t] || t, count: typeCounts[t], pct: total ? Math.round((typeCounts[t] / total) * 100) : 0 };
  }).sort(function(a, b) { return b.count - a.count; });
  function pctOfType(t) { return total ? Math.round(((typeCounts[t] || 0) / total) * 100) : 0; }

  // --- DOI coverage ---
  var withDoi = refs.filter(function(r) { return !!r.doi; }).length;
  var doiPercentage = total ? Math.round((withDoi / total) * 100) : 0;
  var journalRefs = refs.filter(function(r) { return r.sourceType === 'journal-article'; });
  var journalWithDoi = journalRefs.filter(function(r) { return !!r.doi; }).length;
  var doiPercentageOfJournals = journalRefs.length ? Math.round((journalWithDoi / journalRefs.length) * 100) : null;

  // --- Most / never cited ---
  var mostCited = refs.map(function(r) { return { ref: r, count: citationCounts.get(r) || 0 }; })
    .filter(function(x) { return x.count > 0; })
    .sort(function(a, b) { return b.count - a.count; })
    .slice(0, 5);
  var neverCited = refs.filter(function(r) { return !citationCounts.get(r); });

  // --- Citation density ---
  var wordCount = articleText.split(/\s+/).filter(Boolean).length;
  function countCitationInstances(cites) {
    var n = 0;
    cites.forEach(function(c) {
      if (c.numbers) n += c.numbers.length;
      else if (c.parts) n += c.parts.length;
      else n += 1;
    });
    return n;
  }
  var totalCitationInstances = countCitationInstances(citations);
  var citationsPerThousandWords = wordCount ? Math.round((totalCitationInstances / wordCount) * 1000 * 10) / 10 : 0;
  var paragraphCount = articleText.split('\n').map(function(l) { return l.trim(); }).filter(Boolean).length;
  var citationsPerParagraph = paragraphCount ? Math.round((totalCitationInstances / paragraphCount) * 10) / 10 : 0;

  // --- Dominant authors (appear as first author on 2+ references) ---
  var authorCounts = new Map();
  refs.forEach(function(r) {
    if (!r.firstAuthor || r.isInstitutional) return;
    var key = normalizeKeyName(surnameOf(r.firstAuthor, styleId), false);
    if (!key) return;
    if (!authorCounts.has(key)) authorCounts.set(key, { label: surnameOf(r.firstAuthor, styleId) || r.firstAuthor, count: 0 });
    authorCounts.get(key).count++;
  });
  var dominantAuthors = Array.from(authorCounts.values()).filter(function(a) { return a.count >= 2; }).sort(function(a, b) { return b.count - a.count; }).slice(0, 5);

  // --- Dominant journals (best-effort extraction, journal-article sources only) ---
  var journalCounts = new Map();
  journalRefs.forEach(function(r) {
    var span = extractJournalNameSpan(r.raw, r.title || '');
    if (!span) return;
    var key = span.text.toLowerCase().trim();
    if (!key) return;
    if (!journalCounts.has(key)) journalCounts.set(key, { label: span.text.trim(), count: 0 });
    journalCounts.get(key).count++;
  });
  var dominantJournals = Array.from(journalCounts.values()).filter(function(j) { return j.count >= 2; }).sort(function(a, b) { return b.count - a.count; }).slice(0, 5);

  return {
    totalReferences: total,
    uniqueSources: uniqueSources,
    yearDistribution: yearDistribution,
    unknownYearCount: unknownYearCount,
    medianAge: medianAge,
    sourceTypeBreakdown: sourceTypeBreakdown,
    pctJournalArticle: pctOfType('journal-article'),
    pctBook: pctOfType('book') + pctOfType('book-chapter'),
    pctWebsite: pctOfType('website'),
    doiPercentage: doiPercentage,
    doiPercentageOfJournals: doiPercentageOfJournals,
    mostCited: mostCited,
    neverCited: neverCited,
    wordCount: wordCount,
    citationsPerThousandWords: citationsPerThousandWords,
    paragraphCount: paragraphCount,
    citationsPerParagraph: citationsPerParagraph,
    dominantAuthors: dominantAuthors,
    dominantJournals: dominantJournals,
  };
}

MultiFormatValidator.prototype.detectDuplicateReferences = function() {
  var self = this;
  var refs = this.references;
  if (refs.length < 2) return;

  // Same DOI
  var byDoi = new Map();
  refs.forEach(function(r) {
    if (!r.doi) return;
    var k = r.doi.toLowerCase().trim();
    if (!byDoi.has(k)) byDoi.set(k, []);
    byDoi.get(k).push(r);
  });
  byDoi.forEach(function(group) {
    if (group.length < 2) return;
    self.errors.push({
      title: 'DOI duplikat', severity: 'error',
      description: group.length + ' referensi memakai DOI yang sama (' + group[0].doi + '): ' + group.map(function(r){return '"'+(r.firstAuthor||'-')+' ('+(r.year||'-')+')"';}).join(', ') + '. Kemungkinan entri terduplikasi atau salah DOI.',
      code: group.map(function(r){return r.raw.substring(0,100);}).join(' | '),
    });
  });

  // Near-identical titles (bigram similarity) — O(n^2), fine for the dozens-of-references
  // case this tool is built for. Skip it outright past a size where it'd noticeably lag the
  // browser instead of silently taking a long time.
  var reportedPairs = new Set();
  if (refs.length <= 400) {
    for (var i = 0; i < refs.length; i++) {
      for (var j = i + 1; j < refs.length; j++) {
        var a = refs[i], b = refs[j];
        if (!a.title || !b.title) continue;
        if (a.title.length < 25 || b.title.length < 25) continue; // short titles: one word can differ a lot yet still look "similar" by bigram count
        var sim = bigramSimilarity(a.title, b.title);
        if (sim >= 0.88) {
          // A near-identical TITLE alone isn't sufficient — many templated source types (bank
          // product pages, government circulars, etc.) share boilerplate title phrasing across
          // genuinely different entities (e.g. "OwnBank Savings Account — interest rates and
          // terms" vs "Union Savings+ Account — interest rates and terms"). Require the authors
          // to also be reasonably similar, since a real duplicate entry almost always has the
          // same or near-identical author field too.
          var authorSim = (a.firstAuthor && b.firstAuthor) ? bigramSimilarity(a.firstAuthor, b.firstAuthor) : 0;
          if (authorSim < 0.5) continue;
          var pairKey = i + '_' + j;
          if (reportedPairs.has(pairKey)) continue;
          reportedPairs.add(pairKey);
          self.errors.push({
            title: 'Referensi kemungkinan duplikat', severity: 'error',
            description: 'Judul referensi "' + (a.firstAuthor||'-') + ' (' + (a.year||'-') + ')" dan "' + (b.firstAuthor||'-') + ' (' + (b.year||'-') + ')" sangat mirip (' + Math.round(sim*100) + '% kemiripan) — kemungkinan entri yang sama tertulis dua kali.',
            code: a.raw.substring(0,90) + ' | ' + b.raw.substring(0,90),
          });
        }
      }
    }
  }

  // Same author+year, different title, not yet using a/b suffixes — general safety net for
  // numeric/author-page families (author-date family already has a richer version of this
  // check in validateAuthorDate with initial-based disambiguation).
  if (this.style.family !== 'author-date') {
    var byAuthorYear = new Map();
    refs.forEach(function(r) {
      if (!r.year || r.isInstitutional) return;
      var k = normalizeKeyName(surnameOf(r.firstAuthor, self.styleId), false) + '_' + r.year.replace(/[a-z]$/, '');
      if (!byAuthorYear.has(k)) byAuthorYear.set(k, []);
      byAuthorYear.get(k).push(r);
    });
    byAuthorYear.forEach(function(group) {
      if (group.length < 2) return;
      var alreadySuffixed = group.every(function(r) { return /[a-z]$/.test(r.year || ''); });
      if (alreadySuffixed) return;
      var suffixLetters = 'abcdefghij';
      var suggestion = group.map(function(r, idx) { return (r.year||'').replace(/[a-z]$/,'') + suffixLetters[idx]; }).join(' / ');
      self.errors.push({
        title: 'Tahun ambigu — penulis & tahun sama, judul berbeda', severity: 'error',
        description: group.length + ' referensi oleh "' + (group[0].firstAuthor||'-') + '" tahun ' + (group[0].year||'-').replace(/[a-z]$/,'') + ' dengan judul berbeda. Beri akhiran huruf: ' + suggestion + '.',
        code: group.map(function(r){return r.raw.substring(0,100);}).join(' | '),
      });
    });
  }
};

// ----- MIXED CITATION STYLE DETECTION -----
// Flags when the article body mixes incompatible in-text citation shapes, e.g. some numeric
// "[1]", some numeric "(1)", and some author-date "(Smith, 2020)" all in the same document —
// a strong sign of copy-pasting from sources with different citation styles.
MultiFormatValidator.prototype.detectMixedCitationStyles = function() {
  var text = this.articleText || '';
  var bracket = (text.match(/\[\d{1,3}(?:\s*[,\-–]\s*\d{1,3})*\]/g) || []).length;
  // Exclude 4-digit numbers here — those are years inside author-date citations like
  // "(2020)", not numeric citation markers. Genuine numeric-style citations are 1-3 digits.
  // Also exclude table-style rank numbers ("4.48 (1)", "4.28 (Joint 1)") — common in
  // scoring/ranking tables (MCDA, TOPSIS, AHP, etc.) — identified by either directly following a
  // decimal score value, or containing "Joint" (a tie-rank indicator no real citation ever has).
  var parenNumericRe = /(\d+\.\d+\s*)?\((?:Joint\s+)?\d{1,3}(?:\s*[,\-–]\s*\d{1,3})*\)/g;
  var parenNumeric = 0;
  var pnMatch;
  while ((pnMatch = parenNumericRe.exec(text)) !== null) {
    if (pnMatch[1]) continue; // preceded by a decimal score -> table rank cell, not a citation
    if (/joint/i.test(pnMatch[0])) continue; // "(Joint 1)" -> tie-rank indicator, not a citation
    if (/^\(\d{4}\)$/.test(pnMatch[0])) continue; // plain 4-digit year
    parenNumeric++;
  }
  var authorDate = (text.match(/\([\p{Lu}\p{Lo}][^()]*?,?\s*\d{4}[a-z]?\)/gu) || []).length;
  var authorPage = (text.match(/\([\p{Lu}\p{Lo}][\p{L}'\-]+\s+\d+(?:[-–]\d+)?\)/gu) || []).length;

  var present = [];
  if (bracket > 0) present.push({ label: 'numerik "[1]"', count: bracket });
  // A handful of "(1)"-shaped matches showing up alongside a mostly author-date document is
  // very often just enumerated prose ("...covers (1) X, (2) Y, (3) Z...") rather than a
  // genuine numeric citation style — require a meaningful volume before flagging it.
  if (parenNumeric >= 5 && parenNumeric > authorDate * 0.3) present.push({ label: 'numerik "(1)"', count: parenNumeric });
  if (authorDate > 0) present.push({ label: 'penulis-tahun "(Smith, 2020)"', count: authorDate });
  if (authorPage > 0 && authorDate === 0) present.push({ label: 'penulis-halaman "(Smith 45)"', count: authorPage });

  if (present.length >= 2) {
    var desc = present.map(function(p) { return p.label + ' (' + p.count + 'x)'; }).join(', ');
    this.errors.push({
      title: 'Gaya sitasi tidak konsisten', severity: 'error',
      description: 'Teks tampaknya mencampur beberapa bentuk sitasi berbeda: ' + desc + '. Pastikan hanya satu gaya yang dipakai di seluruh naskah.',
    });
  }
};

// ----- INSTITUTIONAL AUTHOR CONSISTENCY -----
// Structural/typographical citation format issues — separate from citation<->reference
// matching. See detectMalformedCitations() for what each issue type means.
MultiFormatValidator.prototype.validateCitationFormat = function() {
  var self = this;
  var TITLES = {
    no_space_before_paren: 'Sitasi tanpa spasi sebelum tanda kurung',
    et_al_case: '"et al." format salah (huruf besar/kecil atau titik)',
    missing_open_paren: 'Tanda kurung sitasi tidak lengkap',
    multiple_authors_before_et_al: '"et al." mengikuti lebih dari satu nama penulis',
    no_space_around_ampersand: 'Tanda "&" tanpa spasi di sekitarnya',
    extra_space_in_paren: 'Spasi berlebih di dalam tanda kurung sitasi',
    no_space_after_paren: 'Sitasi tanpa spasi setelah tanda kurung',
  };
  var introHeading2 = findIntroductionHeading(this.articleText);
  var introOffset2 = introHeading2 ? introHeading2.offset + introHeading2.lineLength : 0;
  var issues = detectMalformedCitations(this.articleText).filter(function(issue) { return issue.position >= introOffset2; });
  issues.forEach(function(issue) {
    self.errors.push({
      title: TITLES[issue.type] || 'Format sitasi bermasalah',
      description: issue.message,
      code: issue.raw,
      correction: issue.suggestion || undefined,
      severity: 'error',
    });
  });
};

// Well-known institutional acronyms, for auto-suggesting the full name when a reference's
// author field is JUST the acronym (e.g. "OECD. (2023)."). Deliberately conservative: only
// acronyms common enough to be unambiguous get a suggestion — an unlisted or genuinely
// ambiguous acronym (could plausibly expand several different ways) gets flagged with no
// suggestion rather than risk offering a wrong "correction".
var KNOWN_INSTITUTIONAL_ACRONYMS = {
  'OECD': 'Organisation for Economic Co-operation and Development',
  'WHO': 'World Health Organization',
  'UNESCO': 'United Nations Educational, Scientific and Cultural Organization',
  'UNICEF': 'United Nations Children\u2019s Fund',
  'IMF': 'International Monetary Fund',
  'WTO': 'World Trade Organization',
  'UNDP': 'United Nations Development Programme',
  'WEF': 'World Economic Forum',
  'ADB': 'Asian Development Bank',
  'ILO': 'International Labour Organization',
  'FAO': 'Food and Agriculture Organization',
  'UNEP': 'United Nations Environment Programme',
  'NASA': 'National Aeronautics and Space Administration',
  'FDA': 'U.S. Food and Drug Administration',
  'CDC': 'Centers for Disease Control and Prevention',
  'IEEE': 'Institute of Electrical and Electronics Engineers',
  'ISO': 'International Organization for Standardization',
  'NATO': 'North Atlantic Treaty Organization',
  'ASEAN': 'Association of Southeast Asian Nations',
  'IIF': 'Institute of International Finance',
  'BPS': 'Badan Pusat Statistik',
  'OJK': 'Otoritas Jasa Keuangan',
  'BI': 'Bank Indonesia',
  'KEMENKEU': 'Kementerian Keuangan',
  'KEMENDIKBUD': 'Kementerian Pendidikan dan Kebudayaan',
  'BAPPENAS': 'Badan Perencanaan Pembangunan Nasional',
  'LIPI': 'Lembaga Ilmu Pengetahuan Indonesia',
  'BKPM': 'Badan Koordinasi Penanaman Modal',
};

MultiFormatValidator.prototype.validateInstitutionalConsistency = function() {
  var self = this;
  var institutionalRefs = this.references.filter(function(r) { return r.isInstitutional; });
  if (institutionalRefs.length === 0) return;

  institutionalRefs.forEach(function(r) {
    var trimmedName = r.firstAuthor.trim();
    var isAcronymOnly = ACRONYM_PATTERN.test(trimmedName);
    if (isAcronymOnly) {
      var fullName = KNOWN_INSTITUTIONAL_ACRONYMS[trimmedName.toUpperCase()];
      // Well-known acronyms (OECD, WHO, IMF, ...) are standard practice to leave abbreviated
      // even in the reference list — flagging these is unnecessary noise. Only flag acronyms
      // NOT in the known list, where a reader genuinely has no way to know what it stands for.
      if (fullName) return;
      self.suggestions.push({
        title: 'Referensi institusi hanya berupa singkatan',
        description: 'Entri referensi "' + trimmedName + '" hanya berupa singkatan yang tidak saya kenali, jadi pembaca mungkin tidak tahu artinya. Pertimbangkan menuliskan nama lengkap institusinya. (Untuk singkatan yang sudah umum dikenal seperti OECD/WHO/IMF, ini biasanya tidak masalah dan tidak perlu diubah.)',
        code: r.raw.substring(0, 120),
        severity: 'suggestion',
      });
      return;
    }
  });
};

// ---------- DOCUMENT AUTO-SPLIT (find References/Daftar Pustaka heading) ----------
var REFERENCES_HEADING_RE = /(\breferences?\b|reference\s+list|bibliography|works\s+cited|literature\s+cited|daftar\s+pustaka|daftar\s+referensi|referensi)/i;

// Small, dependency-free Levenshtein distance — used only for typo-tolerant heading matching
// below, on short strings (a single word), so no need for anything fancier/faster.
function levenshteinDistance(a, b) {
  var m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  var prev = [];
  for (var j = 0; j <= n; j++) prev[j] = j;
  for (var i = 1; i <= m; i++) {
    var cur = [i];
    for (var j2 = 1; j2 <= n; j2++) {
      cur[j2] = a[i - 1] === b[j2 - 1]
        ? prev[j2 - 1]
        : 1 + Math.min(prev[j2 - 1], prev[j2], cur[j2 - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

// Candidate words a typo'd heading might be aiming for. Deliberately excludes multi-word phrases
// ("daftar pustaka", "works cited", ...) — fuzzy-matching those word-by-word risks too many false
// positives; typos are handled here only for the single-word English/Indonesian heading forms.
var HEADING_TYPO_CANDIDATES = ['references', 'reference', 'bibliography', 'referensi'];
// Real, unrelated words that happen to sit within edit-distance of a candidate above — must
// never be treated as a typo'd heading no matter how close the distance is.
var HEADING_TYPO_BLOCKLIST = { preference: true, conference: true, difference: true, deference: true, inference: true, interference: true, reverence: true, reference: false };
delete HEADING_TYPO_BLOCKLIST.reference; // "reference" itself is a valid (singular) candidate, not a false-positive

function isFuzzyHeadingWord(word) {
  var w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w || HEADING_TYPO_BLOCKLIST[w]) return false;
  for (var i = 0; i < HEADING_TYPO_CANDIDATES.length; i++) {
    var cand = HEADING_TYPO_CANDIDATES[i];
    var maxDist = cand.length >= 8 ? 2 : 1;
    if (Math.abs(w.length - cand.length) <= maxDist && levenshteinDistance(w, cand) <= maxDist) return true;
  }
  return false;
}

function findReferencesHeading(fullText) {
  var lines = fullText.split('\n');
  var offset = 0;
  var candidates = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length <= 60) {
      var stripped = trimmed.replace(/^[\dIVXLC]+[.\)]\s*/i, '').replace(/[:.\s]+$/, '');
      var wordCount = stripped.split(/\s+/).filter(Boolean).length;
      var isExactMatch = REFERENCES_HEADING_RE.test(stripped) && wordCount <= 4;
      // Typo tolerance only applies to a heading that's exactly ONE word once numbering/
      // punctuation is stripped (e.g. "Refernces", "Bibliograpy") — a whole short line, not
      // just any word inside a longer line, to keep the false-positive risk low.
      var isTypoMatch = !isExactMatch && wordCount === 1 && isFuzzyHeadingWord(stripped);
      if (isExactMatch || isTypoMatch) {
        candidates.push({ lineIndex: i, offset: offset, lineLength: line.length, text: trimmed, isTypo: isTypoMatch });
      }
    }
    offset += line.length + 1;
  }
  if (candidates.length === 0) return null;
  // Prefer the LAST matching heading that is actually followed by substantial content —
  // guards against picking a spurious short "References"-looking line near the very end of
  // the document (e.g. a stray running header/footer line or ToC entry that slipped into the
  // pasted text) which would otherwise leave the "after heading" portion empty.
  for (var c = candidates.length - 1; c >= 0; c--) {
    var afterOffset = candidates[c].offset + candidates[c].lineLength;
    var afterText = fullText.slice(afterOffset).trim();
    if (afterText.length >= 30) return candidates[c];
  }
  // Nothing had substantial trailing content (unusual) — fall back to the last candidate.
  return candidates[candidates.length - 1];
}

var INTRODUCTION_HEADING_RE = /^(introduction|pendahuluan|latar\s*belakang)$/i;

// Sama arsitekturnya seperti findReferencesHeading, tapi mengambil kemunculan PERTAMA (bukan
// terakhir) yang diikuti konten substansial — "Introduction"/"Pendahuluan" normalnya muncul
// SEKALI, di awal naskah, sehingga kemunculan pertama yang masuk akal adalah yang benar.
function findIntroductionHeading(fullText) {
  var lines = fullText.split('\n');
  var offset = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length <= 60) {
      var stripped = trimmed.replace(/^[\dIVXLC]+[.\)]\s*/i, '').replace(/[:.\s]+$/, '');
      var wordCount = stripped.split(/\s+/).filter(Boolean).length;
      if (INTRODUCTION_HEADING_RE.test(stripped) && wordCount <= 4) {
        var afterOffset = offset + line.length;
        var afterText = fullText.slice(afterOffset).trim();
        if (afterText.length >= 30) return { lineIndex: i, offset: offset, lineLength: line.length, text: trimmed };
      }
    }
    offset += line.length + 1;
  }
  return null;
}


// a way real references normally end (sentence-final punctuation, or a trailing DOI/URL) — used
// to stop merging further lines onto it, so unrelated content starting right after (see below)
// can't get glued on just because it doesn't itself look like a new reference's opening line.
function chunkLooksStructurallyComplete(t) {
  if (!/\(\d{4}[a-z]?\)|(?:^|\s)(19|20)\d{2}[a-z]?[.,)]/.test(t) && !/\bn\.d\./i.test(t)) return false;
  var end = t.replace(/\s+$/, '');
  return /[.)]$/.test(end) || /https?:\/\/\S+$/.test(end) || /\d{4,9}\/[^\s]*$/.test(end);
}

// The real test of whether a merged chunk is an actual reference entry at all — deliberately
// content-based (year / DOI / URL / "n.d.") rather than keyword-based ("Corresponding Author",
// "Email:", ...), so it isn't tied to any particular journal template and doesn't need updating
// every time a new kind of trailing content shows up (author bios, acknowledgments, funding
// statements, conflict-of-interest notes, ORCID blocks, "how to cite" boxes, copyright notices,
// etc. — all of it fails this check the same way, wherever it appears and however many separate
// blocks of it there are).
function looksLikeGenuineReference(t) {
  if (/\b(19|20)\d{2}[a-z]?\b/.test(t)) return true;
  if (/\bn\.d\./i.test(t)) return true;
  if (/\bdoi\.org\/|(?:^|\s)10\.\d{4,9}\//.test(t)) return true;
  if (/https?:\/\//.test(t)) return true;
  return false;
}

// Copy-pasting from a PDF commonly re-inserts each page's running header/footer INLINE with the
// body text at every page boundary (e.g. journal name, author list, "Vol X, No Y", "JOURNAL |
// 123") — invisible in the PDF viewer but very much present once pasted as plain text. Left in
// place, this can literally split a single reference-list entry into two (the header lands mid-
// sentence), causing "reference line unreadable" failures for otherwise well-formed entries.
// Detected generically (not hard-coded to any one journal's template): a running header is a
// short line that repeats verbatim 3+ times, usually as part of a small block of consecutive
// repeating lines, with a varying page-number line tacked on the end of each occurrence.
function stripRepeatingPageArtifacts(text) {
  if (!text) return text;
  text = text.replace(/\r\n?/g, '\n');
  var lines = text.split('\n');
  var n = lines.length;
  if (n < 10) return text; // too short for a multi-page "repeats every page" pattern to be real

  var freq = {};
  for (var i = 0; i < n; i++) {
    var t = lines[i].trim();
    if (!t || t.length > 200) continue;
    freq[t] = (freq[t] || 0) + 1;
  }
  var minRepeats = 3;
  var candidateLines = {};
  var anyCandidate = false;
  Object.keys(freq).forEach(function (t) {
    if (freq[t] >= minRepeats) { candidateLines[t] = true; anyCandidate = true; }
  });
  if (!anyCandidate) return text;

  var isCandidate = lines.map(function (l) {
    var t = l.trim();
    return !!(t && candidateLines[t]);
  });

  var toRemove = new Array(n).fill(false);
  for (var i2 = 0; i2 < n; i2++) {
    if (!isCandidate[i2]) continue;
    toRemove[i2] = true;
    var j = i2 + 1;
    while (j < n && isCandidate[j]) { toRemove[j] = true; j++; }
    // The line right after a run of 2+ repeating lines is very often the page-number footer
    // (varies per page, so it never repeats verbatim itself) — fold it in too when it's short
    // and numeric-ish, e.g. "JUPITER | 364" or "Page 12".
    if (j < n && (j - i2) >= 2) {
      var t2 = lines[j].trim();
      if (t2 && t2.length < 40 && /\d/.test(t2) && !candidateLines[t2]) { toRemove[j] = true; j++; }
    }
    i2 = j - 1;
  }

  var kept = [];
  for (var i3 = 0; i3 < n; i3++) if (!toRemove[i3]) kept.push(lines[i3]);
  return kept.join('\n');
}

// PDF text extraction (and naive copy-paste) hard-wraps every visual line, so a single reference
// entry that displays across 2-3 lines in the PDF becomes 2-3 separate lines of pasted text —
// but every downstream reference-list parser assumes one entry per line. This rejoins wrapped
// continuation lines back onto the entry they belong to. A DOCX-sourced reference list (already
// one paragraph per entry) passes through unchanged, since every one of its lines already
// independently looks like a valid entry start.
//
// It also generally handles non-reference content sitting anywhere in the list — not just a
// single trailing block, but any number of separate blocks scattered through it (author bios,
// acknowledgments, funding/conflict-of-interest statements, ORCID blocks, "how to cite" boxes,
// copyright notices, ...): once an accumulating chunk already looks like a complete reference
// (chunkLooksStructurallyComplete), further lines start a NEW chunk instead of being merged on,
// so junk right after a real reference can't corrupt it — and every resulting chunk is then
// independently required to actually look like a reference (looksLikeGenuineReference) or it's
// dropped, wherever in the list it happens to sit.
function rejoinWrappedReferenceLines(text) {
  if (!text) return text;
  var lines = text.split('\n').map(function (l) { return l.replace(/\r$/, ''); });
  var numberedStart = /^\s*(?:\[\d+\]|\(\d+\)|\d+[.)])\s*[\p{Lu}]/u;
  function looksLikeAuthorDateStart(t) {
    if (!/^[\p{Lu}\p{Lo}]/u.test(t)) return false;
    var head100 = t.slice(0, 100);
    var head220 = t.slice(0, 220);
    return /,/.test(head100) && /\(\d{4}[a-z]?\)/.test(head220);
  }
  var merged = [];
  var current = null;
  for (var i = 0; i < lines.length; i++) {
    var trimmed = lines[i].trim();
    if (!trimmed) { if (current !== null) { merged.push(current); current = null; } continue; }
    var looksLikeStart = numberedStart.test(trimmed) || looksLikeAuthorDateStart(trimmed);
    var currentIsDone = current !== null && chunkLooksStructurallyComplete(current);
    if (looksLikeStart || current === null || currentIsDone) {
      if (current !== null) merged.push(current);
      current = trimmed;
    } else {
      current += ' ' + trimmed;
    }
  }
  if (current !== null) merged.push(current);
  return merged.filter(looksLikeGenuineReference).join('\n');
}

function isAllCapsHeadingLike(t) {
  return t.length > 0 && t.length <= 60 && t === t.toUpperCase() && /[A-Z]/.test(t) && !/[a-z]/.test(t);
}

// Companion to rejoinWrappedReferenceLines, for the ARTICLE body instead of the reference list:
// a hard-wrapped PDF line that doesn't end with sentence-ending punctuation is almost certainly
// a continuation of the same sentence, not a real line break — left unjoined, this can literally
// split a single in-text citation like "(Smith, 2020)" into "(Smith," + "2020)" across two lines,
// which breaks citation detection. Never merges an ALL-CAPS heading-like line with its neighbor
// in either direction, so section headings ("INTRODUCTION", "METHOD", ...) are left untouched.
function unwrapHardWrappedLines(text) {
  if (!text) return text;
  var lines = text.split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    var trimmed = raw.trim();
    if (out.length === 0 || trimmed === '') { out.push(raw); continue; }
    var prevTrim = out[out.length - 1].trim();
    if (prevTrim === '') { out.push(raw); continue; }
    var prevEndsSentence = /[.!?:;][")'\]]?$/.test(prevTrim);
    var prevIsHeading = isAllCapsHeadingLike(prevTrim);
    var curIsHeading = isAllCapsHeadingLike(trimmed);
    if (!prevEndsSentence && !prevIsHeading && !curIsHeading) {
      out[out.length - 1] = out[out.length - 1].replace(/\s+$/, '') + ' ' + trimmed;
    } else {
      out.push(raw);
    }
  }
  return out.join('\n');
}

function splitDocumentByReferences(fullText) {
  fullText = stripRepeatingPageArtifacts(fullText);
  var heading = findReferencesHeading(fullText);
  if (!heading) return null;
  var article = fullText.substring(0, heading.offset).trim();
  var afterHeading = fullText.substring(heading.offset + heading.lineLength).trim();
  return {
    article: unwrapHardWrappedLines(article),
    references: rejoinWrappedReferenceLines(afterHeading),
    headingText: heading.text,
    headingIsTypo: !!heading.isTypo,
  };
}


// ---------- Reference FORMATTING checker (italic placement + sentence/title case) ----------
// richLine: array of {text, italic} segments, in document order, joined = the raw reference line.
// Requires a rich-text input (contenteditable paste) upstream — plain textareas carry no
// italic info, so every segment will just be italic:false and only italic-missing warnings
// (never false "wrongly italicized" warnings) can fire, which is the safe default.

function richLineToText(richLine) {
  return richLine.map(function(s) { return s.text; }).join('');
}

function italicCoverage(richLine, start, end) {
  if (end <= start) return 0;
  var pos = 0, italicChars = 0, totalChars = 0;
  for (var i = 0; i < richLine.length; i++) {
    var seg = richLine[i];
    var segStart = pos, segEnd = pos + seg.text.length;
    var overlapStart = Math.max(start, segStart), overlapEnd = Math.min(end, segEnd);
    if (overlapEnd > overlapStart) {
      var len = overlapEnd - overlapStart;
      totalChars += len;
      if (seg.italic) italicChars += len;
    }
    pos = segEnd;
  }
  return totalChars > 0 ? italicChars / totalChars : 0;
}

function findSpan(raw, needle) {
  if (!needle) return null;
  var idx = raw.indexOf(needle);
  if (idx === -1) return null;
  return { start: idx, end: idx + needle.length };
}

// Heuristic: "Title. Journal Name, 12(3), 45-60." -> extracts "Journal Name" span.
function extractJournalNameSpan(raw, title) {
  var titleSpan = findSpan(raw, title);
  if (!titleSpan) return null;
  var rest = raw.slice(titleSpan.end);
  var skip = rest.match(/^[.\s]+/);
  var restStart = titleSpan.end + (skip ? skip[0].length : 0);
  var restText = raw.slice(restStart);
  var m = restText.match(/^([^,]+),\s*\d/);
  if (!m) return null;
  var journalName = m[1].trim();
  var localStart = restText.indexOf(journalName);
  if (localStart === -1) return null;
  return { text: journalName, start: restStart + localStart, end: restStart + localStart + journalName.length };
}

// Heuristic: "In A. Editor (Ed.), Book Title (pp. 1-20). Publisher." -> extracts "Book Title" span.
function extractContainerBookSpan(raw) {
  var m = raw.match(/\(Eds?\.\)\s*,\s*/i) || raw.match(/\(Ed\.\)\s*,\s*/i);
  if (!m) return null;
  var afterEditor = m.index + m[0].length;
  var restText = raw.slice(afterEditor);
  var end = restText.search(/\(pp\.\s*\d/i);
  if (end === -1) end = restText.length;
  var bookTitle = restText.slice(0, end).replace(/[,.\s]+$/, '').trim();
  if (!bookTitle) return null;
  var localStart = restText.indexOf(bookTitle);
  return { text: bookTitle, start: afterEditor + localStart, end: afterEditor + localStart + bookTitle.length };
}

var CASE_STOPWORDS = new Set(['a','an','the','and','or','but','nor','for','of','in','on','at','to','by','with','as','is','it','vs','via','dan','di','ke','dari','yang','untuk','pada','dengan','atau']);

function isLikelyTitleCase(text) {
  var words = (text || '').split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  var capCount = 0, judged = 0;
  words.forEach(function(w, i) {
    var clean = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    if (!clean) return;
    if (i === 0) return;
    if (CASE_STOPWORDS.has(clean.toLowerCase())) return;
    judged++;
    if (/^\p{Lu}/u.test(clean)) capCount++;
  });
  if (judged === 0) return false;
  return (capCount / judged) > 0.6;
}

function isLikelySentenceCaseViolationForTitleCaseStyle(text) {
  var words = (text || '').split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  var capCount = 0, judged = 0;
  words.forEach(function(w, i) {
    var clean = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    if (!clean) return;
    if (i === 0) return;
    if (CASE_STOPWORDS.has(clean.toLowerCase())) return;
    judged++;
    if (/^\p{Lu}/u.test(clean)) capCount++;
  });
  if (judged === 0) return false;
  return (capCount / judged) < 0.15;
}

var ITALIC_ON = { apa7: true, harvard: true, chicago: true, mla9: true, ieee: true, vancouver: false };
var CASE_MODE = { apa7: 'sentence', harvard: 'sentence', chicago: 'sentence', mla9: 'title', ieee: null, vancouver: 'sentence' };

function checkReferenceFormatting(richLines, references, styleId) {
  var issues = [];
  var italicExpected = ITALIC_ON[styleId];
  var caseMode = CASE_MODE[styleId];

  references.forEach(function(ref, i) {
    var richLine = richLines[i];
    if (!richLine) return;
    var raw = ref.raw;
    var lineText = richLineToText(richLine);
    if (lineText.trim().length === 0) return;

    var titleSpan = ref.title ? findSpan(raw, ref.title) : null;

    if (styleId === 'vancouver') {
      var wholeCov = italicCoverage(richLine, 0, raw.length);
      if (wholeCov > 0.04) {
        issues.push({ ref: ref, severity: 'suggestion', field: 'italic',
          message: 'Gaya Vancouver umumnya tidak memakai huruf miring sama sekali, tapi referensi ini terdeteksi sebagian huruf miring.' });
      }
      if (titleSpan && caseMode === 'sentence' && isLikelyTitleCase(ref.title)) {
        issues.push({ ref: ref, severity: 'suggestion', field: 'case',
          message: 'Judul tampak memakai Title Case ("' + ref.title + '"), gaya ini biasanya memakai sentence case.' });
      }
      return;
    }

    if (ref.sourceType === 'journal-article') {
      var journalSpan = extractJournalNameSpan(raw, ref.title || '');
      if (journalSpan && italicExpected) {
        var jCov = italicCoverage(richLine, journalSpan.start, journalSpan.end);
        if (jCov < 0.6) {
          issues.push({ ref: ref, severity: 'suggestion', field: 'italic',
            message: 'Nama jurnal "' + journalSpan.text + '" seharusnya dicetak miring (italic), tapi tidak terdeteksi miring pada referensi ini.' });
        }
      }
      if (titleSpan) {
        var tCov = italicCoverage(richLine, titleSpan.start, titleSpan.end);
        if (tCov > 0.4) {
          issues.push({ ref: ref, severity: 'suggestion', field: 'italic',
            message: 'Judul artikel "' + ref.title + '" terdeteksi miring — untuk artikel jurnal, yang seharusnya miring adalah nama jurnalnya, bukan judul artikelnya.' });
        }
        if (caseMode === 'sentence' && isLikelyTitleCase(ref.title)) {
          issues.push({ ref: ref, severity: 'suggestion', field: 'case',
            message: 'Judul artikel tampak memakai Title Case ("' + ref.title + '"), gaya ini mensyaratkan sentence case (hanya kata pertama & nama diri yang kapital).' });
        } else if (caseMode === 'title' && isLikelySentenceCaseViolationForTitleCaseStyle(ref.title)) {
          issues.push({ ref: ref, severity: 'suggestion', field: 'case',
            message: 'Judul artikel tampak memakai sentence case ("' + ref.title + '"), gaya ini mensyaratkan title case (huruf besar di awal tiap kata penting).' });
        }
      }
    } else if (ref.sourceType === 'book') {
      if (titleSpan && italicExpected) {
        var bCov = italicCoverage(richLine, titleSpan.start, titleSpan.end);
        if (bCov < 0.6) {
          issues.push({ ref: ref, severity: 'suggestion', field: 'italic',
            message: 'Judul buku "' + ref.title + '" seharusnya dicetak miring (italic), tapi tidak terdeteksi miring pada referensi ini.' });
        }
      }
      if (titleSpan) {
        if (caseMode === 'sentence' && isLikelyTitleCase(ref.title)) {
          issues.push({ ref: ref, severity: 'suggestion', field: 'case',
            message: 'Judul buku tampak memakai Title Case ("' + ref.title + '"), gaya ini mensyaratkan sentence case.' });
        } else if (caseMode === 'title' && isLikelySentenceCaseViolationForTitleCaseStyle(ref.title)) {
          issues.push({ ref: ref, severity: 'suggestion', field: 'case',
            message: 'Judul buku tampak memakai sentence case ("' + ref.title + '"), gaya ini mensyaratkan title case.' });
        }
      }
    } else if (ref.sourceType === 'book-chapter') {
      var containerSpan = extractContainerBookSpan(raw);
      if (containerSpan && italicExpected) {
        var cCov = italicCoverage(richLine, containerSpan.start, containerSpan.end);
        if (cCov < 0.6) {
          issues.push({ ref: ref, severity: 'suggestion', field: 'italic',
            message: 'Judul buku induk "' + containerSpan.text + '" seharusnya dicetak miring (italic).' });
        }
      }
      if (titleSpan) {
        var chCov = italicCoverage(richLine, titleSpan.start, titleSpan.end);
        if (chCov > 0.4) {
          issues.push({ ref: ref, severity: 'suggestion', field: 'italic',
            message: 'Judul bab "' + ref.title + '" terdeteksi miring — yang seharusnya miring adalah judul buku induknya, bukan judul babnya.' });
        }
      }
    }
    // thesis / report / website / conference / unknown: formatting too variable to check reliably, skip.
  });

  return issues;
}

var DOIChecker = {
  validateViaCrossRef: function(doi) {
    var url = 'https://api.crossref.org/works/' + encodeURIComponent(doi);
    try {
      return fetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function(response) {
          if (response.status === 404) return { exists: false, status: 'not_found', data: null };
          if (!response.ok) return { exists: false, status: 'error', data: null, message: 'HTTP ' + response.status };
          return response.json().then(function(json) {
            if (json.status === 'ok' && json.message) return { exists: true, status: 'ok', data: json.message };
            return { exists: false, status: 'unknown', data: null };
          });
        })
        .catch(function(err) {
          return { exists: false, status: 'network_error', data: null, message: err.message };
        });
    } catch (err) {
      return Promise.resolve({ exists: false, status: 'network_error', data: null, message: err.message });
    }
  },
  // Opt-in DOI lookup by bibliographic metadata (title/author/year). Returns ranked
  // candidates with a similarity score — the caller decides whether to use any of them.
  // NEVER writes a DOI into a reference automatically.
  searchByMetadata: function(title, author, year) {
    var q = [title, author, year].filter(Boolean).join(' ');
    if (!q.trim()) return Promise.resolve({ status: 'error', candidates: [], message: 'Tidak ada judul/penulis/tahun untuk dicari.' });
    var url = 'https://api.crossref.org/works?query.bibliographic=' + encodeURIComponent(q) + '&rows=5';
    try {
      return fetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function(response) {
          if (!response.ok) return { status: 'error', candidates: [], message: 'HTTP ' + response.status };
          return response.json().then(function(json) {
            var items = (json.message && json.message.items) || [];
            var candidates = items.map(function(it) {
              var crTitle = (it.title && it.title[0]) ? it.title[0] : '';
              var crAuthor = (it.author && it.author[0]) ? ((it.author[0].family || '') + (it.author[0].given ? ', ' + it.author[0].given : '')) : '';
              var crYear = (it.issued && it.issued['date-parts'] && it.issued['date-parts'][0]) ? String(it.issued['date-parts'][0][0]) : '';
              var titleSim = title ? bigramSimilarity(title, crTitle) : 0;
              var authorSim = author ? bigramSimilarity(author, crAuthor) : 0.5;
              var yearMatch = year && crYear ? (year.replace(/[a-z]$/, '') === crYear ? 1 : 0) : 0.5;
              var score = titleSim * 0.6 + authorSim * 0.25 + yearMatch * 0.15;
              return { doi: it.DOI || null, title: crTitle, author: crAuthor, year: crYear, score: Math.round(score * 100) };
            }).sort(function(a, b) { return b.score - a.score; });
            return { status: 'ok', candidates: candidates };
          });
        })
        .catch(function(err) { return { status: 'network_error', candidates: [], message: err.message }; });
    } catch (err) {
      return Promise.resolve({ status: 'network_error', candidates: [], message: err.message });
    }
  },
  compareMetadata: function(ref, crossRefData) {
    var mismatches = [], matches = [];
    if (!crossRefData) return { mismatches: mismatches, matches: matches };
    var crTitle = (crossRefData.title && crossRefData.title[0]) ? crossRefData.title[0] : null;
    if (ref.title && crTitle) {
      var sim = bigramSimilarity(ref.title, crTitle);
      if (sim > 0.6) matches.push({ field: 'Judul', ref: ref.title, cr: crTitle, similarity: Math.round(sim * 100) });
      else mismatches.push({ field: 'Judul', ref: ref.title, cr: crTitle, similarity: Math.round(sim * 100) });
    }

    // CrossRef records several dates that can legitimately differ from each other by a year
    // or more (e.g. "published-online" ahead-of-print vs. "published-print" for the actual
    // issue/volume the author cites). Checking only one of them causes false "mismatch"
    // flags. Instead, collect every date CrossRef has and accept the reference year if it
    // matches ANY of them.
    function extractYear(dateObj) {
      if (dateObj && dateObj['date-parts'] && dateObj['date-parts'][0] && dateObj['date-parts'][0][0]) {
        return String(dateObj['date-parts'][0][0]);
      }
      return null;
    }
    var yearFields = [
      extractYear(crossRefData.issued),
      extractYear(crossRefData.published),
      extractYear(crossRefData['published-print']),
      extractYear(crossRefData['published-online']),
      extractYear(crossRefData.created),
    ].filter(Boolean);

    if (yearFields.length > 0 && ref.year) {
      var refYear = ref.year.replace(/[a-z]$/, '');
      var distinctYears = yearFields.filter(function(y, i) { return yearFields.indexOf(y) === i; });
      if (distinctYears.indexOf(refYear) !== -1) {
        matches.push({ field: 'Tahun', ref: ref.year, cr: refYear });
      } else {
        mismatches.push({
          field: 'Tahun', ref: ref.year, cr: distinctYears.join(' / '),
          note: distinctYears.length > 1
            ? 'CrossRef mencatat beberapa tanggal berbeda (kemungkinan online-first vs. edisi cetak/volume resmi) dan tidak satu pun cocok persis dengan tahun di referensi — periksa manual, kemungkinan besar bukan DOI yang salah.'
            : 'Bisa jadi tanggal terbit online CrossRef berbeda dari edisi cetak/volume resmi yang dikutip — periksa manual sebelum dianggap salah.'
        });
      }
    }

    var crAuthors = crossRefData.author || [];
    if (crAuthors.length > 0 && ref.firstAuthor && !ref.isInstitutional) {
      var crFirst = (crAuthors[0].family || '').toLowerCase();
      var refFirst = stripNameParticles(surnameOf(ref.firstAuthor, ref.styleId) || ref.firstAuthor).toLowerCase();
      if (crFirst === refFirst || (crFirst && refFirst && (crFirst.indexOf(refFirst) !== -1 || refFirst.indexOf(crFirst) !== -1))) {
        matches.push({ field: 'Penulis pertama', ref: ref.firstAuthor, cr: (crAuthors[0].family || '') + (crAuthors[0].given ? ', ' + crAuthors[0].given : '') });
      } else {
        mismatches.push({ field: 'Penulis pertama', ref: ref.firstAuthor, cr: (crAuthors[0].family || '') + (crAuthors[0].given ? ', ' + crAuthors[0].given : '') });
      }
    }
    return { mismatches: mismatches, matches: matches };
  }
};

var YearRange = {
  getRefYear: function(r) {
    if (!r || !r.year) return null;
    var m = String(r.year).match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : null;
  },
  compute: function(references, from, to) {
    var inRange = [], outRange = [], unknown = [];
    references.forEach(function(r) {
      var y = YearRange.getRefYear(r);
      if (y == null) unknown.push(r);
      else if (y >= from && y <= to) inRange.push({ ref: r, y: y });
      else outRange.push({ ref: r, y: y });
    });
    outRange.sort(function(a, b) { return b.y - a.y; });
    var total = references.length;
    var knownTotal = inRange.length + outRange.length;
    var pctOfKnown = knownTotal > 0 ? Math.round((inRange.length / knownTotal) * 100) : 0;
    var pctOfAll = total > 0 ? Math.round((inRange.length / total) * 100) : 0;
    return { inRange: inRange, outRange: outRange, unknown: unknown, total: total, pctOfKnown: pctOfKnown, pctOfAll: pctOfAll };
  },
  presetToRange: function(years) {
    var nowYear = new Date().getFullYear();
    return { from: nowYear - years + 1, to: nowYear, label: years + ' Tahun Terakhir (' + (nowYear - years + 1) + '\u2013' + nowYear + ')' };
  }
};

var CitationEngine = {
  MultiFormatValidator: MultiFormatValidator,
  normalizeKeyName: normalizeKeyName,
  acronymOf: acronymOf,
  parseReferenceLine: parseReferenceLine,
  parseReferenceList: parseReferenceList,
  parseReferenceListDetailed: parseReferenceListDetailed,
  extractDOI: extractDOI,
  STYLES: STYLES,
  FormatDetector: FormatDetector,
  parseAuthorsForStyle: parseAuthorsForStyle,
  surnameOf: surnameOf,
  AuthorParsers: AuthorParsers,
  extractNumericCitations: extractNumericCitations,
  extractAuthorDateCitations: extractAuthorDateCitations,
  detectMalformedCitations: detectMalformedCitations,
  extractAuthorPageCitations: extractAuthorPageCitations,
  splitOnSeparators: splitOnSeparators,
  esc: esc,
  stripNameParticles: stripNameParticles,
  normalizeTitle: normalizeTitle,
  bigramSimilarity: bigramSimilarity,
  isInstitutionalAuthor: isInstitutionalAuthor,
  buildAcronymMapFromText: buildAcronymMapFromText,
  resolveInstitutionalNameFromMap: resolveInstitutionalNameFromMap,
  extractAcronymPairing: extractAcronymPairing,
  looksLikePersonalName: looksLikePersonalName,
  DOIChecker: DOIChecker,
  splitDocumentByReferences: splitDocumentByReferences,
  stripRepeatingPageArtifacts: stripRepeatingPageArtifacts,
  rejoinWrappedReferenceLines: rejoinWrappedReferenceLines,
  unwrapHardWrappedLines: unwrapHardWrappedLines,
  looksLikeGenuineReference: looksLikeGenuineReference,
  chunkLooksStructurallyComplete: chunkLooksStructurallyComplete,
  isFuzzyHeadingWord: isFuzzyHeadingWord,
  findReferencesHeading: findReferencesHeading,
  YearRange: YearRange,
  detectSourceType: detectSourceType,
  findIntroductionHeading: findIntroductionHeading,
  extractBibliographicFields: extractBibliographicFields,
  looksLikeNonInvertedAuthorList: looksLikeNonInvertedAuthorList,
  DOI_NOT_EXPECTED_TYPES: DOI_NOT_EXPECTED_TYPES,
  checkReferenceFormatting: checkReferenceFormatting,
};
if (typeof module !== 'undefined' && module.exports) { module.exports = CitationEngine; }
if (typeof window !== 'undefined') { window.CitationEngine = CitationEngine; }
else if (typeof self !== 'undefined') { self.CitationEngine = CitationEngine; }
