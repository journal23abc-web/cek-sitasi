// APA 7 / IEEE bibliography models and source-specific templates.
// No network requests. Missing facts stay missing; details must come from the source.
// Rules and the independently written test cases: CONVERSION-COVERAGE.md.
(function(root) {
  'use strict';
  var CE = typeof module !== 'undefined' && module.exports ? require('./engine.js') : root.CitationEngine;
  var TYPES = {
    'journal-article': 'Artikel jurnal', 'magazine-article': 'Artikel majalah',
    'newspaper-article': 'Artikel surat kabar', blog: 'Artikel blog',
    book: 'Buku / ebook', 'edited-book': 'Buku suntingan', 'book-chapter': 'Bab buku',
    'dictionary-entry': 'Entri kamus / ensiklopedia', report: 'Laporan',
    brochure: 'Brosur', 'fact-sheet': 'Lembar fakta', 'press-release': 'Siaran pers',
    'white-paper': 'White paper', 'ethics-code': 'Kode etik',
    conference: 'Makalah prosiding', 'conference-presentation': 'Presentasi konferensi',
    thesis: 'Tesis / disertasi', preprint: 'Preprint', unpublished: 'Naskah belum terbit',
    dataset: 'Data set', software: 'Perangkat lunak', standard: 'Standar', patent: 'Paten',
    manual: 'Manual / handbook', 'lecture-notes': 'Slide / catatan kuliah', course: 'Kursus',
    video: 'Video daring', film: 'Film', 'tv-series': 'Serial televisi',
    'tv-episode': 'Episode televisi', podcast: 'Podcast', 'podcast-episode': 'Episode podcast',
    'radio-broadcast': 'Siaran radio', artwork: 'Karya seni / gambar',
    'musical-score': 'Partitur', 'social-media': 'Media sosial / forum',
    webpage: 'Halaman web', legal: 'Dokumen hukum (perlu tinjauan)', unknown: 'Belum ditentukan'
  };
  var APA_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var IEEE_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
  // Exact words listed in IEEE Reference Guide, IV.A. Unknown words stay spelled out.
  // This is an abbreviation rule, never a dictionary for expanding an ambiguous short title.
  var ABBREVIATIONS = {
    American: 'Amer.', Analysis: 'Anal.', Annals: 'Ann.', Annual: 'Annu.', Applications: 'Appl.',
    Applied: 'Appl.', Association: 'Assoc.', Automation: 'Automat.', Biology: 'Biol.', Biomedical: 'Biomed.', Bulletin: 'Bull.', Chemical: 'Chem.',
    Communications: 'Commun.', Computer: 'Comput.', Computing: 'Comput.', Conference: 'Conf.', Education: 'Educ.', Electrical: 'Elect.',
    Electronic: 'Electron.', Engineering: 'Eng.', Experimental: 'Exp.', Information: 'Inf.',
    Informatics: 'Inform.', International: 'Int.', Journal: 'J.', Magazine: 'Mag.', Management: 'Manage.', Mathematical: 'Math.', Mathematics: 'Math.',
    Medical: 'Med.', Medicine: 'Med.', National: 'Nat.', Organization: 'Org.', Personal: 'Pers.', Proceedings: 'Proc.', Psychology: 'Psychol.',
    Quarterly: 'Quart.', Research: 'Res.', Review: 'Rev.', Science: 'Sci.', Society: 'Soc.', Symposium: 'Symp.',
    Systems: 'Syst.', Technical: 'Tech.', Technology: 'Technol.', Transactions: 'Trans.'
  };
  // Exact-title exceptions retain punctuation/meaning that word replacement cannot infer.
  var JOURNALS = {
    'Journal of Computer-Mediated Communication': 'J. Comput.-Mediat. Commun.',
    'Medicine & Science in Sports & Exercise': 'Med. Sci. Sports Exerc.',
    'Personality and Individual Differences': 'Pers. Individ. Dif.',
    'International Journal of Behavioral Nutrition and Physical Activity': 'Int. J. Behav. Nutr. Phys. Act.',
    'Computers in Human Behavior': 'Comput. Hum. Behav.',
    'Psychology of Sport and Exercise': 'Psychol. Sport Exerc.',
    'Psychological Bulletin': 'Psychol. Bull.',
    'International Journal of Medical Informatics': 'Int. J. Med. Inform.',
    'Journal of the American Medical Informatics Association': 'J. Amer. Med. Inform. Assoc.'
  };
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function clean(s) { return String(s || '').trim().replace(/^[.,;]\s*|\s*[.,;]$/g, '').trim(); }
  function period(s) { return /[.!?]$/.test(s) ? s : s + '.'; }
  function initial(s) { return s.split(/\s+/).map(function(t) {
    if (/^(?:\p{Lu}\.){2,}$/u.test(t)) return t.match(/\p{Lu}/gu).join('. ') + '.';
    return t.split('-').map(function(p) { return p ? p[0].toUpperCase() + '.' : ''; }).join('-');
  }).join(' '); }
  function titleCase(value) {
    return value.split(/(\s+|[-–])/).map(function(word, index, all) {
      if (!/[\p{L}]/u.test(word) || /[A-Z].*[A-Z]/.test(word)) return word;
      var minor = /^(?:a|an|the|and|but|or|nor|as|at|by|for|from|in|of|on|per|to|up|via|with)$/i.test(word);
      var afterColon = index > 1 && /:$/.test(all[index - 2]);
      return minor && index > 0 && index < all.length - 1 && !afterColon ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1);
    }).join('');
  }
  function abbreviate(title) {
    if (!title || !/\s/.test(title) || /\b(?:J\.|Trans\.|Proc\.|Int\.)/.test(title)) return title;
    if (JOURNALS[title]) return JOURNALS[title];
    return title.split(/\s+/).filter(function(w) { return !/^(?:of|the|and|in|on|for|&)$/.test(w.toLowerCase()); })
      .map(function(w) { var p = w.match(/^([\p{L}-]+)([,;:]?)$/u); return p && (ABBREVIATIONS[p[1]] || (/s$/.test(p[1]) && ABBREVIATIONS[p[1].slice(0, -1)])) ? (ABBREVIATIONS[p[1]] || ABBREVIATIONS[p[1].slice(0, -1)]) + p[2] : w; }).join(' ');
  }
  function ieeeDate(value) {
    var s = String(value || 'n.d.').replace(/^(\d{4})[a-z](?=,|$)/, '$1');
    var m = s.match(/^(\d{4})(?:,\s*([\p{L}.]+)(?:\s+([\d–-]+))?)?$/u);
    if (!m) return s;
    if (!m[2]) return m[1];
    var idx = APA_MONTHS.findIndex(function(x) { return x.toLowerCase().slice(0, 3) === m[2].toLowerCase().slice(0, 3); });
    return (idx >= 0 ? IEEE_MONTHS[idx] : m[2]) + (m[3] ? ' ' + m[3] + ',' : '') + ' ' + m[1];
  }
  function apaDate(value) {
    var s = String(value || 'n.d.');
    var m = s.match(/^([A-Za-z.]+)\s+(?:(\d+(?:[–-]\d+)?),?\s+)?(\d{4})$/);
    if (!m) return s;
    var i = APA_MONTHS.findIndex(function(x) { return x.slice(0, 3).toLowerCase() === m[1].slice(0, 3).toLowerCase(); });
    return m[3] + ', ' + (i >= 0 ? APA_MONTHS[i] : m[1]) + (m[2] ? ' ' + m[2] : '');
  }
  // A reference's period at depth zero separates elements. Periods in U.S., initials,
  // edition/report identifiers, parentheses, and bracket descriptions are not boundaries.
  function splitSentence(s) {
    var depth = 0;
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '(' || s[i] === '[') depth++;
      if (s[i] === ')' || s[i] === ']') depth--;
      if (depth || !/[.?!]/.test(s[i]) || (i + 1 < s.length && !/\s/.test(s[i + 1]))) continue;
      var prefix = s.slice(0, i + 1);
      if (s[i] === '.' && /(?:\b[A-Z]|\b(?:e\.g|i\.e|vs|Dr|Mr|Mrs|Ms|No|Vol|Inc|Ltd))\.$/.test(prefix)) continue;
      return [s.slice(0, i + (s[i] === '.' ? 0 : 1)).trim(), s.slice(i + 1).trim()];
    }
    return [clean(s), ''];
  }
  function stripLink(s, m) {
    var retrieval = s.match(/\bRetrieved\s+(.+?),\s+from\s+(https?:\/\/\S+)\s*$/i);
    if (retrieval) {
      m.accessed = apaDate(retrieval[1]); m.retrievalRequired = true;
      m.url = retrieval[2]; return clean(s.slice(0, retrieval.index));
    }
    var link = s.match(/\s+(https?:\/\/\S+)\s*$/i);
    if (link) {
      var url = link[1];
      if (!/^https?:\/\/(?:dx\.)?doi\.org\//i.test(url)) m.url = url;
      return clean(s.slice(0, link.index));
    }
    return clean(s);
  }
  function parseNames(s, styleId) {
    var parsed = CE.parseAuthorsForStyle(s, styleId);
    return parsed.authors.filter(function(a) { return !/^et al\.?$/i.test(a); }).map(function(a) {
      if (parsed.isInstitutional) return { last: a.replace(/\.$/, ''), given: [], institutional: true };
      if (styleId === 'apa7' && a.indexOf(',') >= 0) {
        var parts = a.split(','); return { last: parts.shift().trim(), given: parts.join(',').trim().split(/\s+/).filter(Boolean), institutional: false };
      }
      var match = a.match(/^((?:\p{Lu}\.(?:-\p{Lu}\.)?\s*)+)\s+(.+)$/u);
      return match ? { last: match[2], given: match[1].trim().split(/\s+/), institutional: false } : { last: a, given: [], institutional: true };
    });
  }
  function ieeeEditors(s) {
    return s.replace(/,\s*&\s*/g, ' and ').replace(/\s*&\s*/g, ' and ');
  }
  function parseDetails(part, m) {
    var desc = part.match(/\s*\[([^\]]+)\]\s*$/);
    if (desc) { m.description = desc[1]; part = part.slice(0, desc.index); }
    var details = part.match(/\s*\(([^()]*)\)\s*$/);
    if (details && /(?:\bed\.|\bVols?\.|\bVersion\b|\bNo\.|\bPatent\b|\bStandard\b|\bTrans\.|\bReport\b|\bSeason\b)/i.test(details[1])) {
      m.details = details[1]; part = part.slice(0, details.index);
      var ed = m.details.match(/(?:^|;\s*)([^;]*?\bed\.)/i); if (ed) m.edition = ed[1];
      var bv = m.details.match(/^Vols?\.\s*(.+)$/i); if (bv) m.bookVolumes = bv[1];
      var version = m.details.match(/\bVersion\s+([^;]+)/i); if (version) m.version = version[1];
      var report = m.details.match(/^(.*?(?:Report|Paper|Publication)\s+No\.\s*.+)$/i); if (report) m.number = report[1];
      var std = m.details.match(/^(.+?\bStandard)(?:\s+No\.)?\s+(.+)$/i); if (std) m.standardNumber = std[1] + ' ' + std[2];
      var pat = m.details.match(/^(.+?\bPatent)(?:\s+No\.)?\s+(.+)$/i); if (pat) m.patentNumber = pat[1] + ' ' + pat[2];
      var trans = m.details.match(/^(.+?),\s*Trans\.$/i); if (trans) m.translator = trans[1];
    }
    m.title = part.trim();
  }
  var DESCRIPTIONS = [
    [/^(?:Unpublished )?(?:Doctoral dissertation|Master[’']s thesis|Ph\.D\. thesis|Undergraduate.*thesis|Skripsi|Tesis|Disertasi)/i, 'thesis'],
    [/^(?:Conference|Paper|Poster|Keynote).*(?:presentation|session|address|abstract)/i, 'conference-presentation'],
    [/^Data set/i, 'dataset'], [/^(?:Computer software|Mobile app|Software|Large language model)/i, 'software'],
    [/^(?:PowerPoint slides|Lecture notes)/i, 'lecture-notes'], [/^(?:MOOC|Online course)/i, 'course'],
    [/^(?:Video|Online video|TED Talk)$/i, 'video'], [/^Film$/i, 'film'], [/^TV series episode/i, 'tv-episode'],
    [/^TV series$/i, 'tv-series'], [/^(?:Audio|Video) podcast episode/i, 'podcast-episode'],
    [/^(?:Audio|Video) podcast$/i, 'podcast'], [/^Radio broadcast/i, 'radio-broadcast'],
    [/^(?:Painting|Photograph|Sculpture|Map|Illustration|Clip art|Stock image)/i, 'artwork'],
    [/^Musical score/i, 'musical-score'], [/^(?:Tweet|Post|Status update|Video attached|Image attached|Online forum post|Comment)/i, 'social-media'],
    [/^Brochure/i, 'brochure'], [/^Fact sheet/i, 'fact-sheet'], [/^Press release/i, 'press-release'],
    [/^White paper/i, 'white-paper'], [/^Code of ethics/i, 'ethics-code'],
    [/^Unpublished manuscript|^Manuscript (?:in preparation|submitted)/i, 'unpublished']
  ];
  function identify(m, source, hint) {
    if (hint && TYPES[hint]) return hint;
    for (var i = 0; i < DESCRIPTIONS.length; i++) if (DESCRIPTIONS[i][0].test(m.description || '')) return DESCRIPTIONS[i][1];
    if (m.standardNumber) return 'standard';
    if (m.patentNumber) return 'patent';
    if (m.number && /Report|Paper/i.test(m.number)) return 'report';
    if (/^In\s+.+?\(Eds?\.\),/i.test(source)) return /Proceedings|\bProc\./i.test(source) ? 'conference' : 'book-chapter';
    if (/^In\s+/i.test(source)) return 'dictionary-entry';
    if (/\b(?:arXiv|PsyArXiv|bioRxiv|medRxiv|SocArXiv|OSF Preprints)\b/i.test(source)) return 'preprint';
    if (/^ERIC\b/.test(source)) return 'report';
    if (m.year === 'in press' && /Journal|Transactions|\bJ\./i.test(source)) return 'journal-article';
    if (/\b(?:Journal|Transactions)\b/.test(source) || /,\s*\d+(?:\([^)]*\))?(?:,|$)/.test(source) || /Advance online publication|In press/i.test(source)) return 'journal-article';
    if (/^(?:Ed\.|Eds\.)$/.test(m.role || '')) return 'edited-book';
    if (m.description) return 'unknown';
    if (m.url) return 'webpage';
    if (source) return 'book';
    return 'unknown';
  }
  function enrich(raw, styleId, seed, details, trusted) {
    var m = clone(seed), opt = details || {};
    if (m.schema === 2) return applyDetails(m, opt);
    m.schema = 2; m.notes = []; m.sourceText = raw;
    if (styleId !== 'apa7') {
      if (trusted) {
        m.date = m.publicationDate ? apaDate(m.publicationDate) : (m.year || 'n.d.');
        if (!m.source && m.publisher) m.source = m.publisher;
        return applyDetails(m, opt);
      }
      return applyDetails(parseIEEE(raw, m), opt);
    }
    var date = raw.match(/\((\d{4}[a-z]?(?:[–-](?:\d{4}|present))?|n\.d\.[a-z]?|in press)(?:,\s*([^()]+))?\)\s*\.?\s*/i);
    if (!date) { m.type = 'unknown'; m.notes.push('Tanggal atau struktur APA tidak dikenali.'); return applyDetails(m, opt); }
    m.year = date[1].replace(/-(?=\d{4}|present)/, '–');
    m.date = m.year + (date[2] ? ', ' + date[2] : ''); m.apaDate = m.date;
    var prefix = raw.slice(0, date.index).trim().replace(/^\[\d+\]\s*/, '');
    var role = prefix.match(/\s*\(([^()]+)\)\.\s*$/);
    if (role) m.role = role[1];
    var allRoles = Array.from(prefix.matchAll(/\(([^()]+)\)/g)).map(function(x) { return x[1]; });
    var handle = prefix.match(/\s*\[(@[^\]]+)\]\s*\.?$/);
    if (handle) { m.handle = handle[1]; prefix = prefix.slice(0, handle.index); }
    var authorText = prefix.replace(/\s*\((?:[^()]+)\)\.?/g, '').trim();
    if (!m.ellipsis && !/et\s+al\./i.test(authorText)) m.authors = parseNames(authorText, 'apa7');
    if (allRoles.length > 1 && allRoles.length === m.authors.length) { m.authorRoles = allRoles; m.role = null; }
    // A title in the author position is not turned into an invented person's name.
    if (!/,\s*(?:\p{Lu}\.)/u.test(authorText) && !CE.isInstitutionalAuthor(authorText.replace(/\.$/, '')) && /\s/.test(authorText)) {
      m.noAuthor = true; m.authors = []; m.authorTitle = clean(authorText);
    }
    var body = raw.slice(date.index + date[0].length).trim();
    var original = body.match(/\s*\(Original work published (\d{4})\)\s*$/i);
    if (original) { m.originalYear = original[1]; body = body.slice(0, original.index); }
    body = stripLink(body, m);
    var parts = splitSentence(body);
    parseDetails(parts[0], m);
    m.source = parts[1];
    m.type = identify(m, m.source, opt.type);
    // No-author works put the TITLE before the date, so the remaining first element is source.
    if (m.noAuthor) { m.source = body; m.title = m.authorTitle; m.type = opt.type || (m.url ? 'webpage' : 'unknown'); }
    if (m.type === 'journal-article' || m.type === 'magazine-article' || m.type === 'newspaper-article') {
      var j = m.source.match(/^(.*?),\s*(\d+)?\s*(?:\(([^()]*)\))?(?:,\s*(Article\s+)?([\w]+(?:\s*[-–]\s*[\w]+)?))?$/i);
      m.pages = null; m.articleNumber = null;
      if (j) {
        m.journal = j[1]; m.volume = j[2] || null; m.issue = j[3] || null;
        if (j[5]) {
          var locator = j[5].replace(/\s*[-–]\s*/g, '–');
          if (j[4] || /^e\d+/i.test(locator)) m.articleNumber = locator;
          else { m.pages = locator; m.ambiguousLocator = !/[–-]/.test(locator); }
        }
      } else {
        m.journal = m.source.replace(/\.\s*(?:Advance online publication|In press)\.?$/i, '');
        m.volume = null; m.issue = null;
        m.status = /Advance online publication/i.test(m.source) ? 'early access' : /in press/i.test(m.source) ? 'in press' : null;
      }
    } else if (m.type === 'book-chapter' || m.type === 'conference' || m.type === 'dictionary-entry') {
      var ch = m.source.match(/^In\s+(?:(.+?)\s+\((Eds?\.)\),\s*)?(.+)$/i);
      if (ch) {
        m.editor = ch[1] || null; m.editorIsPlural = ch[2] === 'Eds.';
        var cp = splitSentence(ch[3]), bookPart = cp[0]; m.publisher = cp[1] || null;
        var cd = bookPart.match(/\s*\(([^()]*)\)\s*$/);
        if (cd) {
          bookPart = bookPart.slice(0, cd.index); m.containerDetails = cd[1];
          var pg = cd[1].match(/\bpp\.\s*([^,;]+)/); if (pg) m.pages = pg[1].replace(/-/g, '–');
          var ed = cd[1].match(/(^|,\s*)([^,]+\bed\.)/); if (ed) m.edition = ed[2];
        }
        m.journal = bookPart; m.isBookChapter = m.type === 'book-chapter';
      }
    } else if (m.type === 'thesis') {
      var th = (m.description || '').match(/^(Unpublished\s+)?(.+?(?:thesis|dissertation))\s*(?:,\s*(.+))?$/i);
      if (th) { m.unpublished = !!th[1]; m.degree = th[2]; m.institution = th[3] || (m.unpublished ? m.source : null); }
      m.repository = m.unpublished ? null : m.source;
    } else if (/^(?:book|edited-book|report|brochure|fact-sheet|press-release|white-paper|ethics-code|manual)$/.test(m.type)) m.publisher = m.source || null;
    else if (m.type === 'dataset' || m.type === 'software') m.publisher = m.source || null;
    else if (m.type === 'preprint') {
      m.repository = m.source;
      var ar = (m.url || '').match(/arxiv\.org\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/); if (ar) m.arxiv = ar[1];
    }
    if (/^(?:podcast-episode|tv-episode)$/.test(m.type)) {
      var series = splitSentence((m.source || '').replace(/^In /, ''));
      var producers = series[0].match(/^(.+?\((?:Executive Producers?|Producers?)\),\s*)(.+)$/);
      m.series = producers ? producers[2] : series[0]; m.producers = producers ? producers[1] : null; m.production = series[1];
    }
    if (m.completeAuthors) m.authorCount = m.authors.length;
    return applyDetails(m, opt);
  }
  function applyDetails(m, opt) {
    // Only explicit, style-independent facts may be supplied by the user. Bindings are
    // exact reference text, so changing the input invalidates the row's old details.
    ['place', 'accessed', 'journalAbbreviation', 'journal', 'publisher', 'institution', 'department', 'degree', 'date', 'articleNumber'].forEach(function(k) {
      if (typeof opt[k] === 'string' && opt[k].trim()) {
        if (k === 'date' && /^\d{4}/.test(opt[k]) && opt[k].slice(0, 4) !== String(m.year).slice(0, 4)) {
          m.notes = m.notes || []; m.notes.push('Tahun detail berbeda dari tahun sumber. Perbaiki tahun pada referensi sumber terlebih dahulu.');
        } else { m[k] = opt[k].trim(); if (k === 'date') m.publicationDate = null; }
      }
    });
    if (opt.journal) m.abbreviatedSource = false;
    if (opt.publisher) m.source = m.publisher;
    if (TYPES[opt.type]) m.type = opt.type;
    if (opt.articleNumber) { m.pages = null; m.ambiguousLocator = false; }
    return m;
  }
  function parseIEEE(raw, m) {
    // External IEEE has no archive of omitted facts. Read what is present and flag the
    // information/capitalization that needs verification; never expand guessed names.
    var rest = raw.replace(/^\[\d+\]\s*/, '');
    var q = rest.match(/["“]([^"”]+)["”]\s*,?\s*(.*)$/);
    if (q) {
      var authorText = rest.slice(0, q.index).replace(/[,\s.]+$/, '');
      if (authorText) {
        m.authors = parseNames(authorText, 'ieee');
        m.completeAuthors = !/et\s+al/.test(authorText);
        m.authorCount = m.completeAuthors ? m.authors.length : Math.max(3, m.authors.length);
      }
      m.title = q[1].replace(/,$/, ''); var tail = q[2];
      var pages = tail.match(/\bpp?\.\s*([A-Za-z]?\d+(?:[–-][A-Za-z]?\d+)?|[ivxlcdm]+(?:[–-][ivxlcdm]+)?)/i);
      if (pages) m.pages = pages[1].replace(/-/g, '–');
      var art = tail.match(/\bArt\.\s*no\.\s*([^,\s.]+)/i);
      if (art) { m.articleNumber = art[1]; m.pages = null; }
      var issue = tail.replace(/\bArt\.\s*no\.\s*[^,\s]+/i, '').match(/\bno\.\s*([^,]+)/i);
      if (issue) m.issue = issue[1];
      if (m.journal && (m.volume || m.articleNumber) && !/^in /i.test(tail)) m.type = 'journal-article';
      if (m.isBookChapter) m.type = /\bProc\.|Proceedings/i.test(m.journal || '') ? 'conference' : 'book-chapter';
      var rep = tail.match(/^(.*?),\s*((?:Tech\.\s*)?Rep\.\s*.+?),\s*((?:[A-Za-z.]+\s+)?\d{4})\.?$/);
      var thesis = tail.match(/^((?:M\.S\.|Ph\.D\.|Master[’']s|Doctoral).+?),\s*(.+?),\s*(\d{4})\.?$/);
      if (rep) { m.type = 'report'; m.publisher = rep[1]; m.number = rep[2].replace(/^(?:Tech\.\s*)?Rep\.\s*(?:No\.\s*)?/i, 'Report No. '); m.details = m.number; }
      if (thesis) { m.type = 'thesis'; m.degree = thesis[1]; m.institution = thesis[2]; m.description = m.degree + ', ' + m.institution; }
      if (/\barXiv:/.test(tail)) { m.type = 'preprint'; m.arxiv = tail.match(/arXiv:([^,\s.]+(?:\.[^,\s.]+)*)/)[1]; }
      if (m.type === 'book-chapter' || m.type === 'conference') {
        var chapterEdition = tail.match(/,\s*(\d+(?:st|nd|rd|th) ed\.)/i);
        if (chapterEdition) m.edition = chapterEdition[1];
        m.containerDetails = [m.edition, m.pages ? 'pp. ' + m.pages : null].filter(Boolean).join(', ');
      }
    } else {
      var person = "(?:(?:\\p{Lu}\\.(?:-\\p{Lu}\\.)?)\\s*)+[\\p{L}][\\p{L}'’\\-]*(?:\\s+(?!and\\b)[\\p{L}][\\p{L}'’\\-]*)*";
      var authors = new RegExp('^(' + person + '(?:,\\s*' + person + ')*(?:,?\\s+and\\s+' + person + ')?)(?:,\\s*(Eds?)\\.)?,\\s+(.+)$', 'u').exec(rest);
      if (authors) {
        m.authors = parseNames(authors[1], 'ieee'); m.completeAuthors = true; m.authorCount = m.authors.length;
        m.role = authors[2] ? authors[2] + '.' : null; m.type = m.role ? 'edited-book' : 'book';
        var body = authors[3].split(/\s+https?:\/\/|,?\s*doi:/i)[0];
        var ed = body.match(/,\s*(\d+(?:st|nd|rd|th) ed\.)\s+/i), bookTail;
        if (ed) { m.title = body.slice(0, ed.index); m.edition = ed[1]; m.details = ed[1]; bookTail = body.slice(ed.index + ed[0].length); }
        else { var split = splitSentence(body); m.title = split[0]; bookTail = split[1]; }
        m.publisher = CE.deriveBookPublisher(bookTail, m.year);
        if (bookTail.indexOf(':') >= 0) m.place = bookTail.slice(0, bookTail.lastIndexOf(':')).trim();
      }
    }
    if (m.publisher) m.source = m.publisher;
    if (m.type === 'preprint') m.source = m.repository || 'arXiv';
    m.date = m.publicationDate ? apaDate(m.publicationDate) : (m.year || 'n.d.');
    if (m.journal && /\b(?:J\.|Trans\.|Int\.|Comput\.|Proc\.)/.test(m.journal)) m.abbreviatedSource = true;
    if (/^(?:book|edited-book|book-chapter|conference)$/.test(m.type)) m.notes.push('Judul IEEE dapat memakai title case. Periksa sentence case APA dan kapitalisasi nama diri dari sumber asli.');
    return m;
  }

  function issues(m, target) {
    var notes = (m.notes || []).slice();
    if (m.noAuthor) notes.push('Sumber tanpa penulis: sitasi berdasarkan judul harus diperiksa manual.');
    if (target === 'apa7' && m.abbreviatedSource) notes.push('Nama jurnal sumber berupa singkatan; nama lengkap APA harus diverifikasi dari sumber asli.');
    if (target === 'ieee') {
      if (/^(?:book|edited-book|book-chapter|report|brochure|fact-sheet|press-release|white-paper|ethics-code|thesis|manual)$/.test(m.type) && !m.place) notes.push('Lokasi penerbit/institusi tidak tersedia. Lengkapi dari sumber asli untuk IEEE.');
      if ((m.type === 'conference' || m.type === 'dictionary-entry') && m.publisher && !m.place) notes.push('Lokasi penerbit prosiding/kamus belum tersedia. Lengkapi dari sumber asli untuk IEEE.');
      if (m.type === 'journal-article' && m.journal && !m.journalAbbreviation && !JOURNALS[m.journal] && /\s/.test(m.journal) && !m.abbreviatedSource) notes.push('Singkatan jurnal dibentuk dari daftar kata IEEE; periksa singkatan resmi terbitan bila tersedia.');
      if ((m.type === 'webpage' || m.type === 'social-media' || m.type === 'video') && !m.accessed) notes.push('Tanggal akses belum tersedia. Isi tanggal saat sumber benar-benar diakses untuk IEEE.');
      if (m.type === 'patent' && !/\d{4},\s*\w+\s+\d+/.test(m.date || '')) notes.push('Paten memerlukan tanggal pemberian (issued date), termasuk hari; periksa sumber asli.');
      if (/^(?:film|tv-series|tv-episode|podcast|podcast-episode|radio-broadcast|artwork|musical-score|course)$/.test(m.type)) notes.push('IEEE tidak memberi templat khusus untuk subjenis media ini; adaptasi bibliografi memerlukan tinjauan editorial.');
      if (m.type === 'legal') notes.push('Format dokumen hukum bergantung yurisdiksi; perlu tinjauan manual.');
    }
    if (m.type === 'webpage' && !m.description) notes.push('Pastikan jenis sumber: bentuk teks ini juga dapat berupa laporan, berita, atau buku daring. Pilih jenis sumber bila perlu.');
    return notes;
  }
  function render(m, target, number, authors, citationYear) {
    if (!m || !m.title || (target !== 'apa7' && target !== 'ieee') || m.type === 'unknown' || m.type === 'legal') return null;
    var runs = [], year = citationYear || m.year || 'n.d.';
    if (m.originalYear && year.indexOf('/') >= 0) year = m.year;
    var date = m.date && m.date.indexOf(m.year) === 0 ? year + m.date.slice(m.year.length) : (m.date || year);
    var journal = /^(?:journal-article|magazine-article|newspaper-article)$/.test(m.type);
    var chapter = /^(?:book-chapter|conference|dictionary-entry)$/.test(m.type);
    var report = /^(?:report|brochure|fact-sheet|press-release|white-paper|ethics-code)$/.test(m.type);
    var book = /^(?:book|edited-book|manual)$/.test(m.type);
    var episode = /^(?:podcast-episode|tv-episode)$/.test(m.type);
    function add(t, italic) { if (t) runs.push({ text: String(t), italic: !!italic }); }
    function apaTitle(italic) {
      add(m.title, italic); if (m.details) add(' (' + m.details + ')');
      if (m.description) add(' [' + m.description + ']');
      add(/[?!]$/.test(m.title) && !m.details && !m.description ? ' ' : '. ');
    }
    function quoted() { add('"' + m.title.replace(/"/g, "'") + '," '); }
    function doiAndUrl() {
      if (m.doi) add(', doi: ' + m.doi);
      add('.');
      if (m.accessed) add(' Accessed: ' + ieeeDate(m.accessed) + '.');
      if (m.url) add(' [Online]. Available: ' + m.url);
    }
    if (target === 'apa7') {
      var yearOnly = /^(?:journal-article|book|edited-book|book-chapter|dictionary-entry|conference|report|thesis|preprint|dataset|software|standard|patent|manual|unpublished)$/.test(m.type);
      var apaSourceDate = m.apaDate || (yearOnly ? m.year : m.date);
      if (apaSourceDate) date = apaSourceDate.indexOf(m.year) === 0 ? year + apaSourceDate.slice(m.year.length) : apaSourceDate;
      if (m.noAuthor) { add(m.title, m.type === 'webpage' || book); add('. (' + date + '). '); }
      else {
        if (m.authorRoles) {
          var roleNames = m.authors.map(function(a, i) { return a.last + (a.given.length ? ', ' + initial(a.given.join(' ')) : '') + ' (' + m.authorRoles[i] + ')'; });
          authors = roleNames.length > 1 ? roleNames.slice(0, -1).join(', ') + ', & ' + roleNames[roleNames.length - 1] : roleNames[0];
        }
        add((m.role ? authors + ' (' + m.role + ').' : period(authors)) + (m.handle ? ' [' + m.handle + '].' : '') + ' (' + date + '). ');
      }
      if (journal) {
        apaTitle(false); add(m.journal, true);
        if (m.volume) { add(', '); add(m.volume, true); }
        if (m.issue) add((m.volume ? '' : ', ') + '(' + m.issue + ')');
        if (m.articleNumber) add(', Article ' + m.articleNumber);
        else if (m.pages) add(', ' + m.pages);
        add('.'); if (m.status === 'early access') add(' Advance online publication.');
      } else if (chapter) {
        apaTitle(false); add('In ' + (m.editor ? m.editor + (m.editorIsPlural ? ' (Eds.), ' : ' (Ed.), ') : ''));
        add(m.journal, true);
        var cd = m.containerDetails || [m.edition, m.pages ? 'pp. ' + m.pages : null].filter(Boolean).join(', ');
        if (cd) add(' (' + cd + ')'); add('.'); if (m.publisher) add(' ' + period(m.publisher));
      } else if (m.type === 'thesis') {
        apaTitle(true); if (m.source || m.repository) add(period(m.source || m.repository));
      } else {
        if (!m.noAuthor) apaTitle(!(episode || m.type === 'social-media' || m.type === 'blog'));
        if (episode) {
          if (m.series) { add('In ' + (m.producers || '')); add(m.series, true); add('.'); if (m.production) add(' ' + period(m.production)); }
          else add(m.source || '');
        } else if (m.source) {
          var authorOrg = m.authors.length === 1 && m.authors[0].institutional ? m.authors[0].last : null;
          if (clean(m.source) !== authorOrg) add(period(m.source), m.type === 'blog');
        }
      }
      if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
      if (m.doi) add(' https://doi.org/' + m.doi);
      else if (m.url) add(m.retrievalRequired && m.accessed ? ' Retrieved ' + m.accessed.replace(/^(\d{4}),\s*(.+)$/, '$2, $1') + ', from ' + m.url : ' ' + m.url);
      if (m.originalYear) add(' (Original work published ' + m.originalYear + ')');
    } else {
      add('[' + number + '] ');
      var d = m.publicationDate || (/^n\.d\./i.test(year) ? '(n.d.)' : year === 'in press' ? 'to be published' : ieeeDate(date));
      var parentheticalDate = d === '(n.d.)' ? 'n.d.' : d;
      if (m.type === 'standard') {
        add(titleCase(m.title), true); if (m.standardNumber) add(', ' + m.standardNumber);
        if (authors) add(', ' + authors); if (m.place) add(', ' + m.place); add(', ' + d); doiAndUrl();
      } else if (m.type === 'dataset') {
        add((authors ? authors + ', ' : '') + d + ', '); quoted();
        if (m.details) add('(' + m.details + '), '); add(m.publisher || m.source || ''); doiAndUrl();
      } else if (m.type === 'software') {
        if (authors) add(authors + '. '); add(titleCase(m.title), true); add('. (' + parentheticalDate + '). ');
        if (m.details) add('(' + m.details + '). '); if (m.publisher) add(period(m.publisher) + ' ');
        if (m.accessed) add('Accessed: ' + ieeeDate(m.accessed) + '. ');
        add('[' + (m.description || 'Computer software') + ']'); if (m.doi) add('. doi: ' + m.doi); add('.');
        if (m.url) add(' Available: ' + m.url);
      } else if (m.type === 'lecture-notes' || m.type === 'course') {
        if (authors) add(authors + '. '); add('(' + parentheticalDate + '). '); add(titleCase(m.title), true);
        add(' [' + (m.description || 'Lecture notes') + '].'); if (m.source) add(' ' + period(m.source));
        if (m.url) add(' Available: ' + m.url);
      } else if (m.type === 'video') {
        if (authors) add(authors + (m.place ? ', ' + m.place : '') + '. ');
        add(titleCase(m.title), true); add('. (' + parentheticalDate + ').');
        if (m.accessed) add(' Accessed: ' + ieeeDate(m.accessed) + '.'); add(' [Online Video].'); if (m.url) add(' Available: ' + m.url);
      } else if (m.type === 'webpage' || m.type === 'social-media') {
        if (authors) add(authors + '. '); add('"' + period(m.title).replace(/"/g, "'") + '" ');
        var site = m.source || (m.authors.length === 1 && m.authors[0].institutional ? m.authors[0].last : '');
        if (site) add(period(site) + ' '); add(m.year === 'n.d.' ? '(n.d.).' : period(d));
        if (m.accessed) add(' Accessed: ' + ieeeDate(m.accessed) + '.'); if (m.url) add(' [Online]. Available: ' + m.url);
      } else if (m.type === 'manual') {
        add(titleCase(m.title), true); if (m.edition) add(', ' + m.edition);
        add(', ' + (m.publisher || m.source || authors)); if (m.place) add(', ' + m.place);
        add(', ' + d); doiAndUrl();
      } else if (book) {
        if (m.type !== 'manual' && authors) add(authors + (m.type === 'edited-book' ? (m.authors.length > 1 ? ', Eds., ' : ', Ed., ') : ', '));
        add(titleCase(m.title), true); if (m.edition) add(', ' + m.edition);
        if (m.bookVolumes) add(', ' + (/[–-]/.test(m.bookVolumes) ? 'vols. ' : 'vol. ') + m.bookVolumes);
        if (m.translator) add(', trans. ' + ieeeEditors(m.translator));
        add((m.edition && !m.translator ? ' ' : '. ') + (m.place ? m.place + ': ' : '') + (m.publisher || m.source || authors) + ', ' + d); doiAndUrl();
      } else {
        if (authors) add(authors + ', '); quoted();
        if (journal) {
          add(m.journalAbbreviation || abbreviate(m.journal), true);
          if (m.volume) add(', vol. ' + m.volume); if (m.issue) add(', no. ' + m.issue);
          if (m.pages) add(', ' + (m.ambiguousLocator ? '' : /[–-]/.test(m.pages) ? 'pp. ' : 'p. ') + m.pages);
          if (m.status === 'early access') add(', early access');
          add(', ' + d); if (m.articleNumber) add(', Art. no. ' + m.articleNumber);
        } else if (chapter) {
          add('in '); add(m.type === 'conference' ? abbreviate(m.journal) : titleCase(m.journal), true);
          if (m.editor) add(', ' + ieeeEditors(m.editor) + (m.editorIsPlural ? ', Eds.' : ', Ed.'));
          if (m.edition) add(', ' + m.edition); if (m.place) add(', ' + m.place);
          if (m.publisher) add((m.place ? ': ' : ', ') + m.publisher);
          add(', ' + d); if (m.pages) add(', pp. ' + m.pages);
        } else if (report) {
          add(m.publisher || m.source || authors); if (m.place) add(', ' + m.place);
          if (m.number) add(', ' + m.number.replace(/Report No\.\s*/i, 'Rep. '));
          else if (m.description) add(', ' + m.description); add(', ' + d);
        } else if (m.type === 'thesis') {
          add((m.degree || 'Thesis').replace(/^Doctoral dissertation$/i, 'Ph.D. dissertation'));
          if (m.department) add(', ' + m.department); if (m.institution) add(', ' + m.institution);
          if (m.place) add(', ' + m.place); add(', ' + d);
        } else if (m.type === 'conference-presentation') {
          add('presented at the ' + abbreviate(m.source) + ', ' + d);
        } else if (m.type === 'patent') add((m.patentNumber || m.details || 'Patent') + ', ' + d);
        else if (m.type === 'preprint') { add(d + ', ' + (m.arxiv ? 'arXiv:' + m.arxiv : m.repository || m.source || 'preprint')); }
        else if (m.type === 'unpublished') add('unpublished, ' + d);
        else if (m.type === 'blog') { add(m.source, true); add(', ' + d); }
        else { if (m.description) add('[' + m.description + '], '); if (m.source) add(m.source + ', '); add(d); }
        doiAndUrl();
      }
    }
    if (target === 'ieee') runs.forEach(function(r) { r.text = r.text.replace(/,\s*\(n\.d\.\)/g, '. (n.d.)'); });
    // No trailing space, no extra full stop after URLs, and the exact same rich/plain text.
    while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop();
    if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
    return { line: runs.map(function(r) { return r.text; }).join(''), runs: runs };
  }
  var api = { TYPES: TYPES, enrich: enrich, render: render, issues: issues, abbreviate: abbreviate,
    ieeeDate: ieeeDate, titleCase: titleCase, apaDate: apaDate, splitSentence: splitSentence, parseNames: parseNames };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BibliographyEngine = api;
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
