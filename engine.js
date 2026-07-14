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
  return false;
}

function isInstitutionalAuthor(str) {
  if (!str) return false;
  var s = str.trim();
  if (ACRONYM_PATTERN.test(s)) return true;
  if (INSTITUTION_KEYWORDS.test(s)) return true;
  if (looksLikePersonalName(s)) return false;
  // Multi-word title-case string with 3+ words and no comma, no personal-name shape -> likely org
  var words = s.split(/\s+/);
  if (words.length >= 2 && !s.includes(',') && words.every(function(w){ return /^[\p{Lu}\p{Lo}]/u.test(w) || /^(of|the|and|dan|untuk|bagi)$/i.test(w); })) {
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

function extractAuthorDateCitations(text) {
  var citations = [];
  var parenRegex = /\(([^()]+?)\)/g;
  var m;
  while ((m = parenRegex.exec(text)) !== null) {
    var content = m[1].trim();
    if (!/\b\d{4}[a-z]?\b/.test(content) && !/\bn\.d\./i.test(content)) continue;
    if (/^[\d\s,.\-–:;]+$/.test(content)) continue;
    var parts = parseParentheticalAuthorDate(content);
    if (parts.length > 0) citations.push({ type: 'parenthetical', raw: m[0], content: content, parts: parts, position: m.index });
  }
  var narrativeRegex = /((?:[\p{Lu}\p{Lo}][\p{L}'.\-]+)(?:(?:\s*,\s*(?:and|dan)\s+|\s*,\s*|\s+(?:and|dan)\s+|\s+)(?:[\p{Lu}\p{Lo}][\p{L}'.\-]+))*(?:\s+et\s+al\.?)?)\s*\((\d{4}[a-z]?|n\.d\.)[,)]/gu;
  var skipWords = buildSkipWordSet();
  while ((m = narrativeRegex.exec(text)) !== null) {
    var authors = m[1].trim().replace(/^(The|A|An)\s+/, '');
    var year = m[2].trim();
    if (!authors) continue;
    // Strip a leading discourse/transition word so it isn't glued onto the real author
    // list, e.g. "However, Riand and Radil (2022)" -> "Riand and Radil (2022)". Without
    // this, the whole match gets discarded by the skipWords check below and the citation
    // is lost entirely (shows up as a false "not cited in text" warning instead).
    var leadMatch = authors.match(/^([A-Za-zÀ-ÿ]+),?\s+/);
    if (leadMatch && skipWords.has(leadMatch[1].toLowerCase())) {
      authors = authors.slice(leadMatch[0].length).trim();
    }
    if (!authors) continue;
    if (!authors || authors.split(/\s+/).length > 8) continue;
    var before = text.substring(0, m.index);
    var openP = (before.match(/\(/g) || []).length, closeP = (before.match(/\)/g) || []).length;
    if (openP > closeP) continue;
    var firstWord = authors.split(/[\s,]+/)[0].toLowerCase();
    if (skipWords.has(firstWord)) continue;
    citations.push({ type: 'narrative', raw: authors + ' (' + year + ')', authors: authors, year: year, position: m.index });
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
  var yearMatch = text.match(/,?\s*(\d{4}[a-z]?|n\.d\.)(?:\s*[,:]\s*(.+))?$/);
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
  var authors = splitOnSeparators(cleanAuthorPart);
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
    if (/\b\d{4}\b/.test(content)) continue; // has a 4-digit year -> not MLA author-page
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
  return new Set(['the','this','that','these','those','according','see','also','however','therefore','furthermore','additionally','although','despite','while','when','where','which','what','how','why','if','then','but','for','with','from','into','after','before','during','between','through','about','above','below','under','over','chapter','table','figure','section','part','page','volume','issue','article','book','report','study','research','data','result','analysis','method','model','system','process','program','project','case','based','related','compared','combined','integrated','developed','proposed','presented','discussed','examined','investigated','observed','found','showed','demonstrated','indicated','suggested','reported','published','available','retrieved','accessed','and','or','not','all','any','both','each','few','many','most','other','some','such','only','own','same','so','than','too','very','just','because','until','against','among','around','along','across','it','its','he','she','they','we','you','is','are','was','were','has','have','had','do','does','did','will','would','could','should','may','must','can','in','on','at','by','to','of','as','be','been','being','per','via','versus','vs','etc','e.g','i.e','cf','al','et',
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
  if (isInstitutionalAuthor(trimmed.replace(/,\s*$/, ''))) {
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

function extractDOI(refLine) {
  var patterns = [
    /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,}\/[^\s]+)/i,
    /doi:\s*(10\.\d{4,}\/[^\s]+)/i,
    /\b(10\.\d{4,}\/[^\s]+)/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = refLine.match(patterns[i]);
    if (m) return m[1].replace(/[.,;)\]]+$/, '').trim();
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

  // Journal-article pattern: "..., 12(3), 45-67" (vol(issue), pages) or an explicit journal-ish word.
  var journalPattern = /\b\d{1,4}\s*\(\s*[\w-]+\s*\)\s*,\s*\d+[-–]\d+/;
  var journalNameHint = /\b(journal|jurnal|review|quarterly|annals?|transactions|majalah\s+ilmiah)\b/i;
  if (journalPattern.test(s) || journalNameHint.test(s)) return 'journal-article';

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
    return {
      raw: raw, numLabel: numLabel, authors: parsedAuthors.authors, isInstitutional: parsedAuthors.isInstitutional,
      authorCount: parsedAuthors.authors.length, firstAuthor: parsedAuthors.authors[0] || null,
      year: year, title: title, doi: doi, styleId: styleId, sourceType: detectSourceType(raw),
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
  return {
    raw: raw, authors: parsedAuthors2.authors, isInstitutional: parsedAuthors2.isInstitutional,
    authorCount: parsedAuthors2.authors.length, firstAuthor: parsedAuthors2.authors[0] || null,
    year: year2, title: title2, doi: doi2, styleId: styleId, sourceType: detectSourceType(raw),
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

MultiFormatValidator.prototype.validate = function() {
  this.buildAcronymMap();
  var parsed = parseReferenceListDetailed(this.referenceText, this.styleId);
  this.references = parsed.references;
  this.parseStats = { totalFound: parsed.totalFound, succeededCount: parsed.succeededCount, failedCount: parsed.failedCount };
  this.failedLines = parsed.failedLines;
  var family = this.style.family;

  if (family === 'numeric') {
    this.citations = extractNumericCitations(this.articleText);
    this.validateNumeric();
  } else if (family === 'author-date') {
    this.citations = extractAuthorDateCitations(this.articleText);
    this.validateAuthorDate();
  } else if (family === 'author-page') {
    this.citations = extractAuthorPageCitations(this.articleText);
    this.validateAuthorPage();
  }

  this.validateInstitutionalConsistency();
  this.validateReferenceOrdering();
  this.detectDuplicateReferences();
  this.detectMixedCitationStyles();

  return {
    errors: this.errors, warnings: this.warnings, suggestions: this.suggestions,
    citations: this.citations, references: this.references, styleId: this.styleId,
    parseStats: this.parseStats, failedLines: this.failedLines,
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
        var isAlpha = fa.every(function(v,i){return i===0 || fa[i-1] <= fa[i];});
        if (!isAlpha) {
          var sortedParts = c.parts.map(function(p, i) { return { part: p, key: fa[i] }; })
            .sort(function(a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; })
            .map(function(x) { return x.part.raw; });
          self.errors.push({ title: 'Multiple citations tidak alfabetis', description: 'Beberapa sitasi dalam satu kurung harus diurutkan alfabetis berdasarkan penulis pertama.', code: c.raw, correction: '(' + sortedParts.join('; ') + ')', severity: 'error' });
        }
      }
      c.parts.forEach(function(p) {
        if (p.firstAuthor) {
          var key = self.keyFromCitationToken(p.firstAuthor) + '_' + p.year;
          citedKeys.add(key);
          citationDetails.push({ key: key, part: p, raw: c.raw, initial: initialFromCitationToken(p.firstAuthor), position: c.position });
        }
      });
    } else {
      var cleanAuthors = c.authors.replace(/\s*et\s+al\.?/i, '');
      var authors = splitOnSeparators(cleanAuthors);
      var hasEtAl = /et\s+al/i.test(c.authors);
      if (authors.length > 0) {
        var key2 = self.keyFromCitationToken(authors[0]) + '_' + c.year;
        citedKeys.add(key2);
        citationDetails.push({ key: key2, part: { firstAuthor: authors[0], authorCount: hasEtAl ? Math.max(authors.length,3) : authors.length, hasEtAl: hasEtAl, year: c.year }, raw: c.raw, initial: initialFromCitationToken(authors[0]), position: c.position });
        if (authors.length >= style.etAlThreshold && !hasEtAl) {
          self.errors.push({ title: 'Sitasi naratif ' + style.etAlThreshold + '+ penulis tanpa "et al."', description: 'Sitasi naratif "' + c.raw + '" menulis ' + authors.length + ' nama.', code: c.raw, correction: authors[0] + ' et al. (' + c.year + ')', severity: 'error' });
        }
      }
    }
  });

  // cross-reference
  citationDetails.forEach(function(d) {
    if (!refMap.has(d.key)) {
      var fuzzy = self.fuzzyFind(d.key, refMap);
      if (!fuzzy) {
        self.errors.push({ title: 'Sitasi tidak ada di daftar referensi', description: 'Sitasi "' + d.raw + '" tidak memiliki entri cocok di daftar referensi.', code: d.raw, severity: 'error' });
      } else {
        self.suggestions.push({ title: 'Kemungkinan ketidakcocokan', description: 'Sitasi "' + d.raw + '" mungkin merujuk "' + fuzzy.firstAuthor + ' (' + fuzzy.year + ')".', code: d.raw, severity: 'suggestion' });
      }
    } else {
      var refs = refMap.get(d.key);
      if (refs.length > 1) {
        // Collision group: try to resolve to ONE specific reference via the citation's initial.
        var candidates = refs.filter(function(ref) {
          var ri = initialFromRefAuthor(ref.firstAuthor, self.styleId);
          return d.initial && ri ? ri === d.initial : true;
        });
        if (d.initial && candidates.length === 1) {
          matchedRefs.add(candidates[0]);
          if (candidates[0].authorCount <= 2 && d.part.hasEtAl) {
            self.errors.push({ title: '"et al." untuk sumber hanya ' + candidates[0].authorCount + ' penulis', description: 'Referensi "' + candidates[0].firstAuthor + ' (' + candidates[0].year + ')" hanya punya ' + candidates[0].authorCount + ' penulis tercatat, tidak perlu "et al."', code: d.raw, severity: 'error' });
          }
        } else {
          self.errors.push({ title: 'Sitasi ambigu', description: 'Sitasi "' + d.raw + '" bisa merujuk ke ' + refs.length + ' referensi berbeda yang nama belakang & tahunnya sama (' + refs.map(function(r){return r.firstAuthor;}).join(' / ') + '). Tambahkan inisial pada sitasi untuk memperjelas.', code: d.raw, severity: 'error' });
        }
      } else {
        refs.forEach(function(ref) {
          matchedRefs.add(ref);
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

MultiFormatValidator.prototype.buildAcronymMap = function() {
  var map = {};
  var combined = this.articleText + '\n' + this.referenceText;
  var re = /((?:[\p{Lu}\p{Lo}][\p{L}'’\-]*\s+){1,8}[\p{Lu}\p{Lo}][\p{L}'’\-]*)\s*[\(\[]([A-Z]{2,8})[\)\]]/gu;
  var m;
  while ((m = re.exec(combined)) !== null) {
    map[m[2].toLowerCase()] = m[1].trim().replace(/[.,;:]$/, '');
  }
  this.acronymMap = map;
};

MultiFormatValidator.prototype.resolveInstitutionalName = function(name) {
  if (!name) return name;
  var trimmed = name.trim();
  var pairing = extractAcronymPairing(trimmed);
  if (pairing) return pairing.full;
  if (ACRONYM_PATTERN.test(trimmed) && this.acronymMap && this.acronymMap[trimmed.toLowerCase()]) {
    return this.acronymMap[trimmed.toLowerCase()];
  }
  return trimmed;
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
    return { idx: idx, sortKey: (sortBase || '').toLowerCase().replace(/^(the|a|an)\s+/i, ''), year: r.year || '', firstAuthor: r.firstAuthor };
  });
  var sorted = withKeys.slice().sort(function(a,b) {
    if (a.sortKey < b.sortKey) return -1;
    if (a.sortKey > b.sortKey) return 1;
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

  // Near-identical titles (bigram similarity) — O(n^2) but reference lists are small (dozens,
  // not thousands), so this stays fast.
  var reportedPairs = new Set();
  for (var i = 0; i < refs.length; i++) {
    for (var j = i + 1; j < refs.length; j++) {
      var a = refs[i], b = refs[j];
      if (!a.title || !b.title) continue;
      if (a.title.length < 25 || b.title.length < 25) continue; // short titles: one word can differ a lot yet still look "similar" by bigram count
      var sim = bigramSimilarity(a.title, b.title);
      if (sim >= 0.88) {
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
  var parenNumeric = (text.match(/\(\d{1,3}(?:\s*[,\-–]\s*\d{1,3})*\)/g) || []).filter(function(m) { return !/^\(\d{4}\)$/.test(m); }).length;
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
MultiFormatValidator.prototype.validateInstitutionalConsistency = function() {
  var self = this;
  var institutionalRefs = this.references.filter(function(r) { return r.isInstitutional; });
  if (institutionalRefs.length === 0) return;

  institutionalRefs.forEach(function(r) {
    var trimmedName = r.firstAuthor.trim();
    var isAcronymOnly = ACRONYM_PATTERN.test(trimmedName);
    if (isAcronymOnly) {
      self.errors.push({ title: 'Referensi institusi hanya berupa singkatan', description: 'Entri referensi "' + trimmedName + '" sebaiknya menuliskan nama lengkap institusi, bukan hanya singkatannya.', code: r.raw.substring(0, 120), severity: 'error' });
      return;
    }

    // Find an acronym associated with this institution (from a "Full Name [ACR]" pairing anywhere in the text)
    var acronym = null;
    if (self.acronymMap) {
      for (var acr in self.acronymMap) {
        if (Object.prototype.hasOwnProperty.call(self.acronymMap, acr) &&
            normalizeKeyName(self.acronymMap[acr], true) === normalizeKeyName(trimmedName, true)) {
          acronym = acr.toUpperCase();
          break;
        }
      }
    }
    if (!acronym) return; // institution is never abbreviated anywhere -> nothing to check

    var escapedFull = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var pairingRegex = new RegExp(escapedFull + '\\s*[\\(\\[]' + acronym + '[\\)\\]]', 'i');
    var pairingMatch = pairingRegex.exec(self.articleText);

    var bareRegex = new RegExp('\\b' + acronym + '\\b', 'g');
    var firstBareIdx = -1, bm;
    while ((bm = bareRegex.exec(self.articleText)) !== null) {
      if (pairingMatch && bm.index >= pairingMatch.index && bm.index < pairingMatch.index + pairingMatch[0].length) continue;
      firstBareIdx = bm.index;
      break;
    }

    if (firstBareIdx !== -1 && (!pairingMatch || firstBareIdx < pairingMatch.index)) {
      self.errors.push({
        title: 'Singkatan institusi dipakai sebelum nama lengkap diperkenalkan',
        description: 'Sitasi PERTAMA untuk institusi ini harus menuliskan nama lengkap beserta singkatannya, misalnya "' + trimmedName + ' [' + acronym + ']", baru sitasi berikutnya boleh memakai "' + acronym + '" saja. Saat ini singkatan "' + acronym + '" ditemukan dipakai duluan, sebelum (atau tanpa) pengenalan nama lengkap.',
        severity: 'error'
      });
    }
  });
};

// ---------- DOCUMENT AUTO-SPLIT (find References/Daftar Pustaka heading) ----------
var REFERENCES_HEADING_RE = /(references|reference\s+list|bibliography|works\s+cited|literature\s+cited|daftar\s+pustaka|daftar\s+referensi|referensi)/i;

function findReferencesHeading(fullText) {
  var lines = fullText.split('\n');
  var offset = 0;
  var candidates = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length <= 60 && REFERENCES_HEADING_RE.test(trimmed)) {
      var stripped = trimmed.replace(/^[\dIVXLC]+[.\)]\s*/i, '').replace(/[:.\s]+$/, '');
      var wordCount = stripped.split(/\s+/).length;
      if (REFERENCES_HEADING_RE.test(stripped) && wordCount <= 4) {
        candidates.push({ lineIndex: i, offset: offset, lineLength: line.length, text: trimmed });
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

function splitDocumentByReferences(fullText) {
  var heading = findReferencesHeading(fullText);
  if (!heading) return null;
  var article = fullText.substring(0, heading.offset).trim();
  var afterHeading = fullText.substring(heading.offset + heading.lineLength).trim();
  return { article: article, references: afterHeading, headingText: heading.text };
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
  extractAuthorPageCitations: extractAuthorPageCitations,
  splitOnSeparators: splitOnSeparators,
  esc: esc,
  stripNameParticles: stripNameParticles,
  normalizeTitle: normalizeTitle,
  bigramSimilarity: bigramSimilarity,
  isInstitutionalAuthor: isInstitutionalAuthor,
  extractAcronymPairing: extractAcronymPairing,
  looksLikePersonalName: looksLikePersonalName,
  DOIChecker: DOIChecker,
  splitDocumentByReferences: splitDocumentByReferences,
  findReferencesHeading: findReferencesHeading,
  YearRange: YearRange,
  detectSourceType: detectSourceType,
  DOI_NOT_EXPECTED_TYPES: DOI_NOT_EXPECTED_TYPES,
  checkReferenceFormatting: checkReferenceFormatting,
};
if (typeof module !== 'undefined' && module.exports) { module.exports = CitationEngine; }
if (typeof window !== 'undefined') { window.CitationEngine = CitationEngine; }
