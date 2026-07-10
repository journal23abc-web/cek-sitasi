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
  return title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
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
  if (/^[A-ZÀ-Ÿ][a-zà-ÿ'\-]+,\s*([A-Z]\.\s*)+$/.test(s)) return true; // Last, F. M.
  if (/^[A-ZÀ-Ÿ][a-zà-ÿ'\-]+,\s*[A-ZÀ-Ÿ][a-zà-ÿ'\-]+(\s+[A-ZÀ-Ÿ][a-zà-ÿ'\-]+)?$/.test(s)) return true; // Last, First Middle
  if (/^([A-Z]\.\s*)+[A-ZÀ-Ÿ][a-zà-ÿ'\-]+$/.test(s)) return true; // F. M. Last
  if (/^[A-ZÀ-Ÿ][a-zà-ÿ'\-]+\s+[A-Z]{1,3}$/.test(s)) return true; // Vancouver: Last FM
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
  if (words.length >= 2 && !s.includes(',') && words.every(function(w){ return /^[A-ZÀ-Ÿ]/.test(w) || /^(of|the|and|dan|untuk|bagi)$/i.test(w); })) {
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
  var narrativeRegex = /((?:[A-ZÀ-Ÿ][\w'.\-]+)(?:(?:\s*,\s*(?:and|dan)\s+|\s*,\s*|\s+(?:and|dan)\s+|\s+)(?:[A-ZÀ-Ÿ][\w'.\-]+))*(?:\s+et\s+al\.?)?)\s*\((\d{4}[a-z]?|n\.d\.)[,)]/g;
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
    var tokens = authors.split(/\s+/);
    if (tokens[0] && tokens[0].replace(/\./g, '').length <= 1) {
      tokens.shift();
      if (tokens[0] && /^(and|dan)$/i.test(tokens[0])) tokens.shift();
      authors = tokens.join(' ').replace(/^,\s*/, '');
    }
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
    var authorPageIntext = (articleText.match(/\([A-ZÀ-Ÿ][a-zà-ÿ'\-]+\s+\d+(?:[-–]\d+)?\)/g) || []).length;
    var authorYearIntext = (articleText.match(/\([A-ZÀ-Ÿ][^()]*?,?\s*\d{4}[a-z]?\)/g) || []).length;

    if (numericBracket > 0) { scores.ieee += 3; scores.vancouver += 3; signals.push('In-text pakai [angka] → gaya numerik'); }
    if (numericBracket === 0 && numericParen > 2 && authorYearIntext === 0) { scores.vancouver += 1; }
    if (authorPageIntext > authorYearIntext) { scores.mla9 += 3; signals.push('In-text pakai (Penulis Halaman) tanpa tahun → mengarah ke MLA'); }
    if (authorYearIntext > 0) { scores.apa7 += 1; scores.harvard += 1; scores.chicago += 1; signals.push('In-text pakai (Penulis, Tahun) → gaya author-date'); }

    // --- Reference list signals ---
    var lines = referenceText.split('\n').map(function(l){return l.trim();}).filter(Boolean);
    var refCount = lines.length || 1;
    lines.forEach(function(line) {
      if (/^\[\d+\]/.test(line)) { scores.ieee += 4; }
      if (/^\d+\.\s/.test(line)) { scores.vancouver += 3; scores.mla9 -= 0.5; }
      if (/\(\d{4}[a-z]?\)/.test(line)) { scores.apa7 += 1; scores.harvard += 1; }
      if (/^\S[^()]*\.\s*\d{4}\.\s/.test(line)) { scores.chicago += 3; } // Author. Year. "Title."
      if (/["""][^"""]+["""]/.test(line)) { scores.chicago += 1; scores.ieee += 1; scores.mla9 += 1; }
      if (/'[^']+'/.test(line)) { scores.harvard += 2; }
      if (/\bvol\.\s*\d+/i.test(line)) { scores.mla9 += 2; scores.ieee += 1; }
      if (/\bno\.\s*\d+/i.test(line)) { scores.mla9 += 1; scores.ieee += 1; }
      if (/\bpp\.\s*\d+/i.test(line)) { scores.mla9 += 1; scores.chicago += 0.5; scores.harvard += 0.5; }
      if (/\d{4};\d+(\(\d+\))?:\d+/.test(line)) { scores.vancouver += 4; } // Year;Vol(Issue):Pages
      if (/^[A-ZÀ-Ÿ][a-zà-ÿ'\-]+\s+[A-Z]{1,3}[,.]/.test(line)) { scores.vancouver += 2; } // Last FM,
      if (/^[A-Z]\.\s*[A-Z]?\.?\s*[A-ZÀ-Ÿ][a-zà-ÿ'\-]+,/.test(line)) { scores.ieee += 2; } // F. M. Last,
    });

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
      year: year, title: title, doi: doi, styleId: styleId,
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
    year: year2, title: title2, doi: doi2, styleId: styleId,
  };
}

function parseReferenceList(referenceText, styleId) {
  var lines = referenceText.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
  var refs = [];
  lines.forEach(function(line) {
    var r = parseReferenceLine(line, styleId);
    if (r) refs.push(r);
  });
  return refs;
}

// ---------- MATCH KEY HELPERS ----------
function normalizeKeyName(name, isInstitutional) {
  if (!name) return '';
  if (isInstitutional) {
    var pairing = extractAcronymPairing(name);
    var base = pairing ? pairing.full : name;
    return base.toLowerCase().replace(/^(the|a|an)\s+/i, '').replace(/[^\w]/g, '');
  }
  return stripNameParticles(name).toLowerCase().replace(/[^\w]/g, '');
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
  this.references = parseReferenceList(this.referenceText, this.styleId);
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

  return {
    errors: this.errors, warnings: this.warnings, suggestions: this.suggestions,
    citations: this.citations, references: this.references, styleId: this.styleId,
  };
};

// ----- NUMERIC FAMILY (IEEE / Vancouver) -----
MultiFormatValidator.prototype.validateNumeric = function() {
  var self = this;
  var refByNumber = {};
  this.references.forEach(function(r) { if (r.numLabel != null) refByNumber[r.numLabel] = r; });

  if (this.references.length > 0 && Object.keys(refByNumber).length === 0) {
    this.warnings.push({ title: 'Nomor referensi tidak terdeteksi', description: 'Baris referensi tidak diawali format nomor yang dikenali (' + (this.style.refPrefix === 'bracket' ? '[1]' : '1.') + ') untuk gaya ' + this.style.name + '.', severity: 'warning' });
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
    this.warnings.push({ title: 'Penomoran referensi tidak berurutan', description: 'Daftar referensi ' + this.style.name + ' seharusnya diberi nomor urut 1, 2, 3, … tanpa lompat/duplikat.', severity: 'warning' });
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
      self.warnings.push({ title: 'Referensi tidak pernah disitasi', description: 'Referensi nomor ' + r.numLabel + ' (' + (r.firstAuthor || '-') + ') ada di daftar pustaka tapi tidak dirujuk di teks.', code: r.raw.substring(0, 120), severity: 'warning' });
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
        var sorted = fa.slice().sort();
        var isAlpha = fa.every(function(v,i){return i===0 || fa[i-1] <= fa[i];});
        if (!isAlpha) {
          self.errors.push({ title: 'Multiple citations tidak alfabetis', description: 'Beberapa sitasi dalam satu kurung harus diurutkan alfabetis berdasarkan penulis pertama.', code: c.raw, severity: 'error' });
        }
      }
      c.parts.forEach(function(p) {
        if (p.firstAuthor) {
          var key = self.keyFromCitationToken(p.firstAuthor) + '_' + p.year;
          citedKeys.add(key);
          citationDetails.push({ key: key, part: p, raw: c.raw });
        }
      });
    } else {
      var cleanAuthors = c.authors.replace(/\s*et\s+al\.?/i, '');
      var authors = splitOnSeparators(cleanAuthors);
      var hasEtAl = /et\s+al/i.test(c.authors);
      if (authors.length > 0) {
        var key2 = self.keyFromCitationToken(authors[0]) + '_' + c.year;
        citedKeys.add(key2);
        citationDetails.push({ key: key2, part: { firstAuthor: authors[0], authorCount: hasEtAl ? Math.max(authors.length,3) : authors.length, hasEtAl: hasEtAl, year: c.year }, raw: c.raw });
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
        self.warnings.push({ title: 'Kemungkinan ketidakcocokan', description: 'Sitasi "' + d.raw + '" mungkin merujuk "' + fuzzy.firstAuthor + ' (' + fuzzy.year + ')".', code: d.raw, severity: 'warning' });
      }
    } else {
      var refs = refMap.get(d.key);
      refs.forEach(function(ref) {
        if (ref.authorCount <= 2 && d.part.hasEtAl) {
          self.errors.push({ title: '"et al." untuk sumber hanya ' + ref.authorCount + ' penulis', description: 'Referensi "' + ref.firstAuthor + ' (' + ref.year + ')" hanya punya ' + ref.authorCount + ' penulis tercatat, tidak perlu "et al."', code: d.raw, severity: 'error' });
        }
      });
    }
  });

  this.references.forEach(function(r) {
    var key = self.keyFromRefAuthor(r) + '_' + (r.year || '');
    if (!citedKeys.has(key)) {
      var found = false;
      for (var ck of citedKeys) { if (self.isFuzzyMatch(key, ck)) { found = true; break; } }
      if (!found) self.warnings.push({ title: 'Referensi tidak disitasi dalam teks', description: '"' + r.firstAuthor + ' (' + r.year + ')" ada di daftar referensi tapi tidak disitasi.', code: r.raw.substring(0, 120), severity: 'warning' });
    }
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
      self.warnings.push({ title: 'Referensi tidak disitasi dalam teks', description: '"' + r.firstAuthor + '" ada di Works Cited tapi tidak disitasi (dengan nomor halaman) dalam teks.', code: r.raw.substring(0, 120), severity: 'warning' });
    }
  });
};

MultiFormatValidator.prototype.buildAcronymMap = function() {
  var map = {};
  var combined = this.articleText + '\n' + this.referenceText;
  var re = /((?:[A-ZÀ-Ÿ][a-zà-ÿ'’\-]*\s+){1,8}[A-ZÀ-Ÿ][a-zà-ÿ'’\-]*)\s*[\(\[]([A-Z]{2,8})[\)\]]/g;
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
  return normalizeKeyName(token, false);
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

// ----- INSTITUTIONAL AUTHOR CONSISTENCY -----
MultiFormatValidator.prototype.validateInstitutionalConsistency = function() {
  var self = this;
  var institutionalRefs = this.references.filter(function(r) { return r.isInstitutional; });
  if (institutionalRefs.length === 0) return;

  institutionalRefs.forEach(function(r) {
    var trimmedName = r.firstAuthor.trim();
    var isAcronymOnly = ACRONYM_PATTERN.test(trimmedName);
    if (isAcronymOnly) {
      self.warnings.push({ title: 'Referensi institusi hanya berupa singkatan', description: 'Entri referensi "' + trimmedName + '" sebaiknya menuliskan nama lengkap institusi, bukan hanya singkatannya.', code: r.raw.substring(0, 120), severity: 'warning' });
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
  // prefer the LAST matching heading (a real heading near the end of the doc,
  // not an earlier in-text mention like "...see references below...")
  return candidates[candidates.length - 1];
}

function splitDocumentByReferences(fullText) {
  var heading = findReferencesHeading(fullText);
  if (!heading) return null;
  var article = fullText.substring(0, heading.offset).trim();
  var afterHeading = fullText.substring(heading.offset + heading.lineLength).trim();
  return { article: article, references: afterHeading, headingText: heading.text };
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
};
if (typeof module !== 'undefined' && module.exports) { module.exports = CitationEngine; }
if (typeof window !== 'undefined') { window.CitationEngine = CitationEngine; }
