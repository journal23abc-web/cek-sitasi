// Shared bibliography models, source-specific templates, and conservative validation.
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
    webpage: 'Halaman web', 'ai-chat': 'Percakapan AI yang dapat diakses',
    'diagnostic-manual': 'Manual diagnostik', 'religious-work': 'Karya keagamaan',
    'audiobook': 'Buku audio', transcript: 'Transkrip audiovisual',
    review: 'Ulasan karya', 'measurement-instrument': 'Tes / instrumen pengukuran',
    coursepack: 'Paket materi kuliah', interview: 'Wawancara', archival: 'Arsip / manuskrip historis',
    'personal-communication': 'Komunikasi pribadi', 'whole-website': 'Situs secara keseluruhan',
    legal: 'Dokumen hukum (perlu tinjauan)', unknown: 'Belum ditentukan'
  };
  // A profile names the convention actually checked. Harvard has institutional variants;
  // Vancouver here follows the NLM sample's first-six-author option, not every journal variant.
  var PROFILES = {
    apa7: { name: 'APA 7', url: 'https://apastyle.apa.org/style-grammar-guidelines/references/examples' },
    ieee: { name: 'IEEE Reference Guide (2025)', url: 'https://journals.ieeeauthorcenter.ieee.org/create-your-ieee-journal-article/create-the-text-of-your-article/ieee-editorial-style-manual/' },
    mla9: { name: 'MLA 9', url: 'https://style.mla.org/works-cited/works-cited-a-quick-guide/' },
    chicago: { name: 'Chicago 18 Author-Date', url: 'https://www.chicagomanualofstyle.org/tools_citationguide/citation-guide-2.html' },
    harvard: { name: 'Harvard umum (varian institusi perlu diperiksa)', url: 'https://library.leeds.ac.uk/info/1402/referencing/50/leeds-harvard-introduction' },
    vancouver: { name: 'Vancouver / contoh NLM, opsi enam penulis', url: 'https://www.nlm.nih.gov/bsd/uniform_requirements.html' }
  };
  var MANUAL_TYPES = /^(?:unknown|legal|review|measurement-instrument|coursepack|interview|archival|personal-communication|whole-website)$/;
  var PERIODICAL_TYPES = /^(?:journal-article|magazine-article|newspaper-article|blog)$/;
  var CHAPTER_TYPES = /^(?:book-chapter|conference|dictionary-entry)$/;
  var BOOK_TYPES = /^(?:book|edited-book|manual|diagnostic-manual|religious-work|audiobook)$/;
  var REPORT_TYPES = /^(?:report|brochure|fact-sheet|press-release|white-paper|ethics-code)$/;
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
    Systems: 'Syst.', Technical: 'Tech.', Technology: 'Technol.', Transactions: 'Trans.',
    // Tambahan dari daftar singkatan IEEE Reference Guide (kata yang sering muncul di naskah informatika).
    Advances: 'Adv.', Artificial: 'Artif.', Intelligence: 'Intell.', Intelligent: 'Intell.', Machine: 'Mach.', Learning: 'Learn.',
    Processing: 'Process.', Network: 'Netw.', Networks: 'Netw.', Letters: 'Lett.', Recognition: 'Recognit.', Vision: 'Vis.',
    Software: 'Softw.', Security: 'Secur.', Knowledge: 'Knowl.', Language: 'Lang.', Computational: 'Comput.', Physics: 'Phys.',
    Economics: 'Econ.', Environmental: 'Environ.', Industrial: 'Ind.', Mechanical: 'Mech.', Robotics: 'Robot.', Sensing: 'Sens.',
    Geoscience: 'Geosci.', Cybernetics: 'Cybern.', Evolutionary: 'Evol.', Development: 'Develop.', Design: 'Des.', Studies: 'Stud.',
    Electronics: 'Electron.', Optics: 'Opt.', Telecommunications: 'Telecommun.', Transportation: 'Transp.', Distributed: 'Distrib.',
    Graphics: 'Graph.', Imaging: 'Imag.', Instrumentation: 'Instrum.', Measurement: 'Meas.', Microwave: 'Microw.', Propagation: 'Propag.',
    Business: 'Bus.', Clinical: 'Clin.', Physical: 'Phys.', Materials: 'Mater.', Chemistry: 'Chem.'
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
    'Journal of the American Medical Informatics Association': 'J. Amer. Med. Inform. Assoc.',
    'IEEE Transactions on Learning Technologies': 'IEEE Trans. Learn. Technol.',
    'Proceedings of the AAAI Conference on Artificial Intelligence': 'Proc. AAAI Conf. Artif. Intell.'
  };
  // Exact aliases only. Generic IEEE abbreviations are not reversible ("Int." alone
  // does not establish a publication's full title). Primary sources are recorded in
  // CONVERTER-FIXES.md. A volume-bearing AAAI paper uses the periodical template.
  var PERIODICAL_ALIASES = {
    'IEEE Trans. Learning Technologies': 'IEEE Transactions on Learning Technologies',
    'Proc. AAAI Conf. Artificial Intelligence': 'Proceedings of the AAAI Conference on Artificial Intelligence'
  };
  // A small exact-title catalogue, not a generic expansion of ambiguous words.
  // Matching a known venue supplies its name only, never guessed editors/pages.
  var CONTAINER_ALIASES = {
    'Proc. 49th Annu. Meeting Assoc. Comput. Linguistics: Human Language Technologies': 'Proceedings of the 49th Annual Meeting of the Association for Computational Linguistics: Human Language Technologies',
    'Proc. 2015 Conf. Empirical Methods Natural Language Processing': 'Proceedings of the 2015 Conference on Empirical Methods in Natural Language Processing',
    'Proc. 2016 Conf. Empirical Methods Natural Language Processing': 'Proceedings of the 2016 Conference on Empirical Methods in Natural Language Processing',
    'Proc. Eleventh Int. Conf. Language Resources and Evaluation (LREC 2018)': 'Proceedings of the Eleventh International Conference on Language Resources and Evaluation (LREC 2018)',
    'Proc. 28th Int. Joint Conf. Artificial Intelligence (IJCAI-19)': 'Proceedings of the Twenty-Eighth International Joint Conference on Artificial Intelligence',
    'Proc. Fifteenth Workshop Innovative Use NLP for Building Educational Applications': 'Proceedings of the Fifteenth Workshop on Innovative Use of NLP for Building Educational Applications',
    'Proc. 14th Int. Conf. Educational Data Mining (EDM 2021)': 'Proceedings of the 14th International Conference on Educational Data Mining',
    'Proc. 2022 6th Int. Conf. Computing Methodologies and Communication (ICCMC)': '2022 6th International Conference on Computing Methodologies and Communication (ICCMC)',
    'Proc. 18th Workshop Innovative Use NLP for Building Educational Applications (BEA 2023)': 'Proceedings of the 18th Workshop on Innovative Use of NLP for Building Educational Applications (BEA 2023)',
    'Proc. 2024 Joint Int. Conf. Computational Linguistics, Language Resources and Evaluation (LREC-COLING 2024)': 'Proceedings of the 2024 Joint International Conference on Computational Linguistics, Language Resources and Evaluation (LREC-COLING 2024)',
    'Proc. 19th Workshop Innovative Use NLP for Building Educational Applications (BEA 2024)': 'Proceedings of the 19th Workshop on Innovative Use of NLP for Building Educational Applications (BEA 2024)',
    'Proc. 17th Int. Conf. Educational Data Mining (EDM 2024)': 'Proceedings of the 17th International Conference on Educational Data Mining'
  };
  function normalizePeriodical(m) {
    var full = PERIODICAL_ALIASES[m.journal];
    if (!full) full = Object.keys(JOURNALS).find(function(title) { return JOURNALS[title] === m.journal; });
    if (full) { m.journal = full; m.abbreviatedSource = false; }
    return m;
  }
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
    // Legacy "doi:10.xxxx/yyy" / "DOI: 10.xxxx/yyy" suffix (no URL). The DOI itself is already
    // captured by the reference parser; only the tail is removed so it is not read as part of
    // the journal name / locator.
    var bareDoi = s.match(/[.,]?\s*\bdoi\s*:\s*10\.\d{4,}\/\S+?\.?\s*$/i);
    if (bareDoi) s = s.slice(0, bareDoi.index) + (/^[.]/.test(bareDoi[0]) ? '.' : '');
    var link = s.match(/\s+(https?:\/\/\S+)\s*$/i);
    if (link) {
      var url = link[1];
      if (!/^https?:\/\/(?:dx\.)?doi\.org\//i.test(url)) m.url = url;
      return clean(s.slice(0, link.index));
    }
    return clean(s);
  }
  function parseNames(s, styleId, personal) {
    var parsed = CE.parseAuthorsForStyle(s, styleId);
    return parsed.authors.filter(function(a) { return !/^et al\.?$/i.test(a); }).map(function(a) {
      if (parsed.isInstitutional && !personal) return { last: a.replace(/\.$/, ''), given: [], institutional: true };
      if (CE.STYLES[styleId].authorForm === 'vancouver') {
        var van = a.match(/^(.+?)\s+([A-Z]{1,4})$/);
        return { last: van ? van[1] : a, given: van ? van[2].split('') : [], institutional: false };
      }
      if (a.indexOf(',') >= 0 && CE.STYLES[styleId].authorForm !== 'non-inverted') {
        var parts = a.split(','); return { last: parts.shift().trim(), given: parts.join(',').trim().split(/\s+/).filter(Boolean), institutional: false };
      }
      var match = a.match(/^((?:\p{Lu}\.(?:-\p{Lu}\.)?\s*)+)\s+(.+)$/u);
      if (match) return { last: match[2], given: match[1].trim().split(/\s+/), institutional: false };
      var tokens = a.split(/\s+/);
      return { last: tokens.pop(), given: tokens, institutional: false };
    });
  }
  function seedFromReference(ref, sourceStyleId, authors) {
    var style = ref.styleId || sourceStyleId;
    var ellipsis = (ref.authors || []).some(function(a) { return /^(?:\.\s*\.\s*\.|…)\s*/u.test(a); });
    var truncated = /\bet\s+al\.?\b/i.test((ref.authors || []).join(' '));
    var names = authors || (ref.isInstitutional
      ? (ref.authors || []).map(function(a) { return { last: a, given: [], institutional: true }; })
      : (ref.authors || []).filter(function(a) { return !/^et\s+al\.?$/i.test(a); }).map(function(a) {
        return parseNames(a, style, true)[0] || { last: a, given: [], institutional: false };
      }));
    var model = {
      authors: names.map(function(a) { return { last: a.last.replace(/^(?:\.\s*\.\s*\.|…)\s*/u, ''), given: a.given, institutional: a.institutional }; }),
      completeAuthors: !truncated && !ellipsis, ellipsis: ellipsis,
      authorCount: ellipsis ? Math.max(21, ref.authorCount || 0) : ref.authorCount,
      year: ref.year, title: ref.title, journal: ref.journal, volume: ref.volume,
      issue: ref.issue, pages: ref.pages, articleNumber: ref.articleNumber, doi: ref.doi,
      publisher: ref.publisher, editor: ref.editor, editorIsPlural: ref.editorIsPlural,
      type: ref.sourceType, isBookChapter: ref.isBookChapter || false,
      url: null, originalStyle: style, ambiguousLocator: false, publicationDate: null
    };
    var links = ref.raw.match(/https?:\/\/\S+/ig);
    if (links) model.url = links.filter(function(u) { return !/^https?:\/\/(?:dx\.)?doi\.org\//i.test(u); })[0] || null;
    var at = ref.title ? ref.raw.indexOf(ref.title) : -1;
    var tail = at >= 0 ? ref.raw.slice(at + ref.title.length) : '';
    if (CE.STYLES[style].family === 'author-date') {
      var suffix = tail.match(/,\s*(\d+)\s*(?:\(([^()]+)\))?\s*,\s*(Article\s+)?([A-Za-z]?\d+(?:\s*[-–]\s*\d+)?)\.?\s*(?:https?:\/\/\S+)?\s*$/i);
      if (suffix) {
        model.volume = suffix[1]; model.issue = suffix[2] || null;
        var locator = suffix[4].replace(/\s*[-–]\s*/g, '–');
        if (suffix[3] || /^e\d+/i.test(locator) || (!/[-–]/.test(locator) && locator.length >= 5)) { model.articleNumber = locator; model.pages = null; }
        else { model.pages = locator; model.articleNumber = null; model.ambiguousLocator = !/[-–]/.test(locator); }
      }
    }
    if (CE.STYLES[style].family === 'numeric' && model.year) {
      var month = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
      var date = tail.split(/\bdoi\s*:|https?:\/\//i)[0].match(new RegExp('(?:^|,\\s*)(' + month + '(?:/' + month + ')?\\s+(?:\\d{1,2},\\s*)?' + model.year + ')(?=[.,\\s]|$)', 'i'));
      if (date) model.publicationDate = date[1];
    }
    if (model.pages) model.pages = model.pages.replace(/-/g, '–');
    return model;
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
    [/^Generative AI chat/i, 'ai-chat'], [/^(?:Transcript|.*transcript)$/i, 'transcript'],
    [/^Audiobook/i, 'audiobook'],
    [/^Personal communication/i, 'personal-communication'], [/^Whole website/i, 'whole-website'],
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
    if (/^(?:Diagnostic and statistical manual|International statistical classification of diseases)/i.test(m.title || '')) return 'diagnostic-manual';
    if (m.description) return 'unknown';
    if (m.url) return 'webpage';
    if (source) return 'book';
    return 'unknown';
  }
  function enrich(raw, styleId, seed, details, trusted) {
    var m = clone(seed), opt = details || {};
    if (m.schema === 2) {
      // Repair archives made by the old parser, using their exact-bound original
      // IEEE reference. Do not reparse the author list: it can contain names that
      // the current displayed IEEE line suppresses as "et al.".
      if (m.originalStyle === 'ieee' && !m.ieeeContainerVersion && /^in\s+/i.test(m.journal || '') &&
          /^(?:journal-article|website|webpage|unknown)$/.test(m.type || '')) {
        var oldTail = (m.sourceText || '').match(/["“][^"”]+["”]\s*,?\s*(in\s+.+)$/i);
        if (oldTail) parseIEEEContainer(oldTail[1], m);
      }
      return applyDetails(normalizePeriodical(m), opt);
    }
    m.schema = 2; m.notes = []; m.sourceText = raw;
    if (styleId !== 'apa7') {
      if (trusted) {
        m.date = m.publicationDate ? apaDate(m.publicationDate) : (m.year || 'n.d.');
        if (!m.source && m.publisher) m.source = m.publisher;
        return applyDetails(m, opt);
      }
      return applyDetails(styleId === 'ieee' ? parseIEEE(raw, m) : parseOtherStyle(raw, styleId, m), opt);
    }
    var date = raw.match(/\((\d{4}[a-z]?(?:[–-](?:\d{4}|present))?|n\.d\.(?:-?[a-z])?|in press)(?:,\s*([^()]+))?\)\s*\.?\s*/i);
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
    if (!/,\s*(?:\p{Lu}\.)/u.test(authorText) && ((!CE.isInstitutionalAuthor(authorText.replace(/\.$/, '')) && /\s/.test(authorText)) || (opt.type === 'religious-work' && !m.role))) {
      m.noAuthor = true; m.authors = []; m.authorTitle = clean(authorText);
    }
    var body = raw.slice(date.index + date[0].length).trim();
    var original = body.match(/\s*\(Original work published (\d{4})\)\s*$/i);
    if (original) { m.originalYear = original[1]; body = body.slice(0, original.index); }
    body = stripLink(body, m);
    var parts = splitSentence(body);
    // "Cash or condition? Evidence from a cash transfer experiment. The Quarterly Journal…":
    // a question/exclamation mark followed by a SUBTITLE sentence is still the title. Merge
    // when the remainder holds another sentence and that sentence is not itself the container.
    if (/[?!]$/.test(parts[0]) && parts[1]) {
      var more = splitSentence(parts[1]);
      if (more[1] && more[0] && !/,\s*\d/.test(more[0]) && !/^(?:In|Dalam)\s/.test(more[0]) && more[0].split(/\s+/).length >= 2) parts = [parts[0] + ' ' + more[0], more[1]];
    }
    parseDetails(parts[0], m);
    // APA assigns the company to the author slot for AI tools/chats. Uppercase short
    // tokens in a company name can otherwise resemble Vancouver personal initials.
    if (/^(?:Generative AI chat|Large language model)$/i.test(m.description || '') && !/,\s*\p{Lu}\./u.test(authorText)) {
      m.noAuthor = false; delete m.authorTitle;
      m.authors = [{ last: clean(authorText), given: [], institutional: true }];
    }
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
    } else if (BOOK_TYPES.test(m.type) || REPORT_TYPES.test(m.type)) m.publisher = m.source || null;
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
    ['place', 'accessed', 'journalAbbreviation', 'nlmAbbreviation', 'journal', 'publisher', 'institution', 'department', 'degree', 'date', 'articleNumber', 'apaTitle', 'apaContainerTitle', 'editor', 'seriesTitle', 'seriesVolume'].forEach(function(k) {
      if (typeof opt[k] === 'string' && opt[k].trim()) {
        if (k === 'date' && /^\d{4}/.test(opt[k]) && opt[k].slice(0, 4) !== String(m.year).slice(0, 4)) {
          m.notes = m.notes || []; m.notes.push('Tahun detail berbeda dari tahun sumber. Perbaiki tahun pada referensi sumber terlebih dahulu.');
        } else { m[k] = opt[k].trim(); if (k === 'date') m.publicationDate = null; }
      }
    });
    if (opt.journal) m.abbreviatedSource = false;
    if (opt.publisher) m.source = m.publisher;
    if (opt.editor) m.editorIsPlural = /(?:,|\s&\s|\sand\s)/.test(opt.editor.trim());
    if (TYPES[opt.type]) m.type = opt.type;
    if (opt.articleNumber) { m.pages = null; m.ambiguousLocator = false; }
    return m;
  }
  function parseIEEEContainer(tail, m) {
    if (!/^in\s+/i.test(tail)) return false;
    var body = tail.replace(/^in\s+/i, '').split(/\s*\[Online\]|\s+https?:\/\/|,?\s*doi:/i)[0];
    // The publication year is a separate comma-delimited element. A year inside
    // "Proc. 2024 ... (EDM 2024)" belongs to the title and must not end the container.
    var years = Array.from(body.matchAll(/,\s*(?:[A-Za-z.]+\s+)?(?:19|20)\d{2}[a-z]?(?=\s*(?:[,.;]|$))/g));
    var header = years.length ? body.slice(0, years[years.length - 1].index) : body.split(/,\s*(?:pp?\.|doi:)/i)[0];
    var vol = body.match(/\bvol\.\s*([\w–-]+)/i), issue = body.match(/\bno\.\s*([^,.;]+)/i);
    if (vol) m.volume = vol[1]; if (issue) m.issue = issue[1];
    var headerBeforeClean = header.replace(/,\s*(?:vol\.\s*[\w–-]+|no\.\s*[^,;]+|pp?\.\s*[\w–-]+)/gi, '').trim();
    header = clean(headerBeforeClean);
    // clean() drops a trailing full stop, but in an already-abbreviated container name
    // ("Proc. Adv. Neural Inf. Process. Syst.") that stop belongs to the last abbreviation.
    if (/(?:^|\s)\p{Lu}[\p{Ll}]{0,6}\.$/u.test(headerBeforeClean) && /\b(?:Proc|Conf|Int|Symp|Trans)\./.test(headerBeforeClean) && !/\.$/.test(header)) header += '.';
    var parts = header.split(',').map(function(p) { return p.trim(); });
    // A recognized country suffix permits separating a conference location from
    // its title. Unknown suffixes are retained and explicitly sent for review.
    var country = /^(?:USA|U\.S\.A\.|United States(?: of America)?|UK|U\.K\.|United Kingdom|Japan|Canada|China|India|Italy|Italia|Portugal|Morocco|Mexico|Germany|France|Australia|Netherlands|Spain|Singapore|Indonesia|South Korea|Republic of Korea|Taiwan|Brazil|Greece|Austria|Switzerland|Sweden|Finland|Denmark|Norway|Belgium|Ireland|Malaysia|Thailand|Vietnam|New Zealand|South Africa)$/i;
    if (parts.length >= 3 && country.test(parts[parts.length - 1])) {
      var count = parts.length >= 4 && /^[A-Z]{2}$/.test(parts[parts.length - 2]) ? 3 : 2;
      var city = parts[parts.length - count];
      if (!/\b(?:Proc\.|Proceedings|Conf\.|Conference|LNCS|vol\.)/i.test(city)) m.conferenceLocation = parts.splice(-count).join(', ');
    }
    header = parts.join(', ');
    // Keep an explicitly supplied book-series volume separate from both the title
    // and the event location. No expansion of an unknown series name is guessed.
    var series = header.match(/,\s*(LNCS|Lecture Notes in Computer Science)\s+(\d+)$/i);
    if (series) { m.seriesTitle = 'Lecture notes in computer science'; m.seriesVolume = series[2]; header = header.slice(0, series.index); }
    m.journal = CONTAINER_ALIASES[header] || header;
    normalizePeriodical(m);
    if (m.journal === 'Proceedings of the AAAI Conference on Artificial Intelligence' && m.volume) {
      m.type = 'journal-article'; m.isBookChapter = false;
    } else {
      m.type = /\b(?:Proc\.|Proceedings|Conf\.|Conference)\b|^Proc\./i.test(header) ? 'conference' : 'book-chapter';
      m.isBookChapter = m.type === 'book-chapter';
      m.containerDetails = [m.edition, m.volume ? 'Vol. ' + m.volume : null, m.issue ? 'No. ' + m.issue : null, m.pages ? 'pp. ' + m.pages : null].filter(Boolean).join(', ');
      m.containerVolume = m.volume; m.containerIssue = m.issue;
      m.volume = null; m.issue = null;
    }
    m.ieeeContainerVersion = 1;
    m.abbreviatedSource = /\b(?:J\.|Trans\.|Int\.|Comput\.|Proc\.|Conf\.|Annu\.|Assoc\.)/.test(m.journal);
    return true;
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
      if (!m.editor) parseIEEEContainer(tail, m);
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
    if (m.journal && /\b(?:J\.|Trans\.|Int\.|Comput\.|Proc\.|Conf\.)/.test(m.journal)) m.abbreviatedSource = true;
    normalizePeriodical(m);
    return m;
  }

  function issues(m, target) {
    var notes = (m.notes || []).slice();
    if (m.noAuthor) notes.push('Sumber tanpa penulis: sitasi berdasarkan judul harus diperiksa manual.');
    if (target === 'apa7' && m.abbreviatedSource) notes.push('Nama jurnal sumber berupa singkatan; nama lengkap APA harus diverifikasi dari sumber asli. Untuk prosiding, isi nama lengkap buku/prosiding pada detail sumber.');
    if (target === 'apa7' && CHAPTER_TYPES.test(m.type)) {
      if (!m.editor) notes.push('Editor buku/prosiding belum tersedia. Periksa sumber asli dan isi editor jika tercantum; jangan mengarang nama.');
      if (!m.publisher) notes.push('Penerbit buku/prosiding belum tersedia. Lengkapi dari sumber asli.');
    }
    if (target === 'apa7' && m.originalStyle === 'ieee' && !m.apaTitle && (m.title || '').split(/\s+/).filter(function(w) { return /^\p{Lu}\p{Ll}+/u.test(w); }).length >= (BOOK_TYPES.test(m.type) ? 2 : 3)) notes.push('Judul mungkin masih memakai title case IEEE. Isi judul APA terverifikasi (sentence case); pertahankan nama diri dan akronim.');
    if (target === 'apa7' && m.type === 'book-chapter' && m.originalStyle === 'ieee' && !m.apaContainerTitle) notes.push('Periksa sentence case judul buku induk; isi judul buku/prosiding APA terverifikasi bila perlu.');
    if (target === 'ieee') {
      if ((BOOK_TYPES.test(m.type) || /^(?:book-chapter|report|brochure|fact-sheet|press-release|white-paper|ethics-code|thesis)$/.test(m.type)) && !m.place) notes.push('Lokasi penerbit/institusi tidak tersedia. Lengkapi dari sumber asli untuk IEEE.');
      if ((m.type === 'conference' || m.type === 'dictionary-entry') && m.publisher && !m.place) notes.push('Lokasi penerbit prosiding/kamus belum tersedia. Lengkapi dari sumber asli untuk IEEE.');
      if (m.type === 'journal-article' && m.journal && !m.journalAbbreviation && !JOURNALS[m.journal] && /\s/.test(m.journal) && !m.abbreviatedSource) notes.push('Singkatan jurnal dibentuk dari daftar kata IEEE; periksa singkatan resmi terbitan bila tersedia.');
      if ((m.type === 'webpage' || m.type === 'social-media' || m.type === 'video') && !m.accessed) notes.push('Tanggal akses belum tersedia. Isi tanggal saat sumber benar-benar diakses untuk IEEE.');
      if (m.type === 'patent' && !/\d{4},\s*\w+\s+\d+/.test(m.date || '')) notes.push('Paten memerlukan tanggal pemberian (issued date), termasuk hari; periksa sumber asli.');
      if (/^(?:film|tv-series|tv-episode|podcast|podcast-episode|radio-broadcast|artwork|musical-score|course)$/.test(m.type)) notes.push('IEEE tidak memberi templat khusus untuk subjenis media ini; adaptasi bibliografi memerlukan tinjauan editorial.');
      if (/^(?:audiobook|transcript|ai-chat)$/.test(m.type)) notes.push('Subjenis ini memakai adaptasi unsur bibliografi IEEE dan perlu tinjauan editorial.');
      if (m.type === 'legal') notes.push('Format dokumen hukum bergantung yurisdiksi; perlu tinjauan manual.');
    }
    if (m.type === 'webpage' && !m.description) notes.push('Pastikan jenis sumber: bentuk teks ini juga dapat berupa laporan, berita, atau buku daring. Pilih jenis sumber bila perlu.');
    if (/^(?:mla9|chicago)$/.test(target) && m.authors.some(function(a) { return !a.institutional && a.given.some(function(g) { return /^\p{Lu}\.?$/u.test(g); }); })) notes.push('Nama depan sumber hanya tersedia sebagai inisial. Nama lengkap untuk ' + PROFILES[target].name + ' harus diverifikasi dari sumber asli; tidak ditebak.');
    if (target === 'harvard') notes.push('Harvard memiliki varian institusi. Templat umum ini perlu disesuaikan dengan pedoman jurnal/kampus.');
    if (target === 'vancouver' && m.type === 'journal-article' && m.journal && /\s/.test(m.journal) && !m.nlmAbbreviation && !m.abbreviatedSource) notes.push('Singkatan jurnal NLM belum diverifikasi. Nama yang tersedia dipertahankan; periksa NLM Catalog, bukan daftar singkatan IEEE.');
    if (/^(?:mla9|chicago|vancouver|harvard)$/.test(target) && !/^(?:journal-article|magazine-article|newspaper-article|blog|book|edited-book|book-chapter|conference|dictionary-entry|report|thesis|webpage)$/.test(m.type)) notes.push('Templat ' + PROFILES[target].name + ' untuk subjenis ini merupakan adaptasi unsur bibliografi; perlu tinjauan editorial.');
    if (m.type === 'ai-chat' && target !== 'apa7') notes.push('Percakapan AI perlu ditinjau menurut kebijakan penerbit, akses transkrip, dan gaya tujuan.');
    return notes;
  }
  function parseOtherStyle(raw, styleId, m) {
    var s = raw.replace(/^(?:\[\d+\]|\d+\.)\s*/, '');
    m.type = m.type === 'website' ? 'webpage' : m.type;
    m.date = m.year || 'n.d.'; m.notes = m.notes || [];
    var link = s.match(/https?:\/\/\S+/g);
    if (link) m.url = link.filter(function(x) { return !/\/doi\.org\//i.test(x); }).map(function(x) { return x.replace(/[.,]$/, ''); })[0] || null;
    var accessed = s.match(/(?:Accessed:?|cited)\s+([^\]]+?)(?=\]|\.|$)/i);
    if (accessed) m.accessed = apaDate(accessed[1].trim());
    var scope = s.replace(/https?:\/\/\S+/g, '').replace(/\bdoi:\s*\S+/i, '');
    if (styleId === 'vancouver') {
      // NLM's year;volume(issue):pages block is a reliable delimiter. Years in titles,
      // DOIs, or access dates must not be used as publication dates.
      var vj = scope.match(/\b(\d{4})(?:\s+([A-Za-z]{3,9})(?:\s+(\d{1,2}))?)?\s*;\s*(\d*)\s*(?:\(([^)]+)\))?\s*:\s*([A-Za-z]?\d+(?:[-–][A-Za-z]?\d+)?|[ivxlcdm]+(?:[-–][ivxlcdm]+)?)/i);
      if (vj) {
        m.type = 'journal-article'; m.year = vj[1];
        m.date = m.year + (vj[2] ? ', ' + vj[2] + (vj[3] ? ' ' + vj[3] : '') : '');
        m.volume = vj[4] || null; m.issue = vj[5] || null; m.pages = vj[6].replace(/-/g, '–');
        var titleAt = m.title ? s.indexOf(m.title) : -1;
        if (titleAt >= 0) m.journal = clean(scope.slice(titleAt + m.title.length, vj.index).replace(/\[Internet\]/i, ''));
      } else {
        var vb = scope.match(/([^.;]+):\s*([^;]+);\s*(\d{4})/);
        if (vb) { m.type = m.type === 'unknown' ? 'book' : m.type; m.place = clean(vb[1]); m.publisher = clean(vb[2]); m.year = vb[3]; }
      }
      var ved = scope.match(/\b(\d+(?:st|nd|rd|th)\s+ed\.)/i); if (ved) { m.edition = ved[1]; m.details = m.edition; }
      var vd = scope.match(/\[(dissertation|master[’']s thesis|dataset|computer program|software|Internet)\]/i);
      if (vd && !/^Internet$/i.test(vd[1])) {
        m.description = vd[1]; m.type = /dissertation|thesis/i.test(vd[1]) ? 'thesis' : /dataset/i.test(vd[1]) ? 'dataset' : 'software';
      }
    } else {
      var quote = scope.match(/[“"]([^”"]+)[”"]/) || (styleId === 'harvard' ? scope.match(/[‘'](.+?)[’'](?=\s*[,\.])/): null);
      var tail;
      if (quote) {
        m.title = quote[1].replace(/[.,]$/, ''); tail = clean(scope.slice(quote.index + quote[0].length));
      } else {
        var at = m.title ? scope.indexOf(m.title) : -1;
        tail = at >= 0 ? clean(scope.slice(at + m.title.length)) : '';
      }
      var j = styleId === 'chicago' ? tail.match(/^(.*?)\s+(\d+)\s*(?:\(([^)]+)\))?\s*:\s*([\w]+(?:[-–][\w]+)?)/)
        : styleId === 'mla9' ? tail.match(/^(.*?),\s*vol\.\s*(\d+)(?:,\s*no\.\s*([^,]+))?/i)
        : tail.match(/^(.*?),\s*(\d+)\s*(?:\(([^)]+)\))?/);
      if (j) {
        m.type = 'journal-article'; m.journal = clean(j[1]); m.volume = j[2]; m.issue = j[3] || null;
        if (styleId === 'chicago' && j[4]) m.pages = j[4].replace(/-/g, '–');
        var pg = tail.match(/\bpp?\.\s*([A-Za-z]?\d+(?:[-–][A-Za-z]?\d+)?)/i);
        if (pg) m.pages = pg[1].replace(/-/g, '–');
        var ai = tail.match(/(?:Article\s+|:\s*)(e\d+|\d{5,})/i);
        if (ai) { m.articleNumber = ai[1]; m.pages = null; }
      } else if (quote && /^(?:In\s|.*?edited by\s)/i.test(tail)) {
        m.type = /\bProceedings\b|\bProc\./.test(tail) ? 'conference' : 'book-chapter';
        var ch = tail.replace(/^In\s+/i, '').match(/^(.*?)(?:,\s*edited by\s+(.+?))?(?:,\s*(?:pp\.\s*)?([\d]+[-–][\d]+))?\.\s*(.*)$/i);
        if (ch) { m.journal = ch[1]; m.editor = ch[2] || null; m.pages = ch[3] || null; m.publisher = clean(ch[4]); }
      } else if (quote && /(?:PhD diss\.|Ph\.D\.|thesis|dissertation)/i.test(tail)) {
        m.type = 'thesis'; var th = tail.match(/^(.+?(?:diss\.|thesis|dissertation)),\s*([^.]*)/i);
        if (th) { m.degree = th[1]; m.institution = th[2]; }
      } else if (quote && m.url && (m.type === 'unknown' || m.type === 'webpage')) {
        m.type = 'webpage'; m.source = clean(tail.replace(/(?:Accessed|Last modified|\b\d{4}\b).*$/i, ''));
      } else if (!quote && tail) {
        var edition = tail.match(/^(\d+(?:st|nd|rd|th)\s+ed\.)[,\s]*/i);
        if (edition) { m.edition = edition[1]; m.details = m.edition; tail = tail.slice(edition[0].length); }
        var pub = clean(tail.replace(/,?\s*\b\d{4}\b\.?\s*$/, ''));
        if (pub.indexOf(':') >= 0) { m.place = clean(pub.slice(0, pub.indexOf(':'))); pub = clean(pub.slice(pub.indexOf(':') + 1)); }
        if (pub && !/\b(?:vol\.|pp\.|Available|Accessed)\b/i.test(pub)) { m.publisher = pub; if (m.type === 'unknown' || m.type === 'webpage') m.type = 'book'; }
      }
    }
    if (m.publisher) m.source = m.publisher;
    if (m.journal && /\b(?:J\.|Trans\.|Int\.|Comput\.|Proc\.)/.test(m.journal)) m.abbreviatedSource = true;
    if (/^(?:mla9|chicago)$/.test(styleId)) m.notes.push('Nama depan lengkap dan sentence case tidak dapat dipulihkan dari inisial atau title case saja; periksa sumber asli bila gaya tujuan memerlukannya.');
    return m;
  }

  function validateReference(ref, styleId, options) {
    var opt = options || {}, profile = PROFILES[styleId], diagnostics = [];
    if (!profile) return { model: null, diagnostics: [], coverage: 'manual' };
    var display = seedFromReference(ref, styleId);
    var entries = opt.metadata && opt.metadata.version === 1 && opt.metadata.styleId === styleId && Array.isArray(opt.metadata.entries) ? opt.metadata.entries : [];
    var matched = entries.filter(function(e) { return e.line === bindingLine(ref.raw) && validModel(e.model); });
    var trusted = matched.length === 1;
    var m = enrich(ref.raw, ref.styleId || styleId, trusted ? matched[0].model : display, opt.details || null, trusted);
    if (m.type === 'unknown' && !m.description && !(opt.details && opt.details.type) && ref.sourceType !== 'unknown') m.type = ref.sourceType === 'website' ? 'webpage' : ref.sourceType;
    var raw = ref.raw, type = m.type || 'unknown';
    var coverage = !TYPES[type] || MANUAL_TYPES.test(type) || m.noAuthor ? 'manual' : styleId === 'harvard' ? 'basic' : 'structured';
    function add(id, title, description, severity, field) {
      if (diagnostics.some(function(x) { return x.ruleId === 'bibliography.' + styleId + '.' + id; })) return;
      diagnostics.push({ ruleId: 'bibliography.' + styleId + '.' + id, title: title,
        description: description, severity: severity || 'suggestion', field: field || 'bibliography',
        code: raw, sourceUrl: profile.url, sourceType: type });
    }
    function missing(field, label, value) {
      if (!value) add('missing-' + field, 'Unsur ' + TYPES[type] + ' perlu diperiksa', label + ' belum terbaca pada referensi. Cocokkan dengan sumber asli; jangan mengisi data perkiraan.', 'suggestion', field);
    }
    if (coverage === 'manual') add('manual-type', 'Jenis referensi memerlukan tinjauan manual', 'Jenis: ' + (TYPES[type] || type) + '. Pencocokan sitasi tetap dijalankan, tetapi templat bibliografi khusus belum dapat dipastikan.');
    if (styleId === 'harvard') add('harvard-variant', 'Varian Harvard perlu disesuaikan', 'Pemeriksaan ini memakai unsur bibliografi umum. Tanda baca, tanggal akses, dan format rinci mengikuti pedoman institusi/jurnal yang Anda gunakan.');
    missing('title', 'Judul', m.title);
    // No-author works and n.d. are legitimate. Never require an invented author or date.
    if (!m.year && styleId !== 'mla9') add('missing-date', 'Tanggal sumber belum terbaca', 'Periksa tanggal terbit. Gunakan penanda tanpa tanggal sesuai gaya bila sumber memang tidak mencantumkannya.');
    if (/https?:\/\/(?:dx\.)?doi\.org\/https?:\/\//i.test(raw)) add('doi-url', 'URL DOI berulang', 'Awalan https://doi.org/ tidak boleh diikuti URL DOI lain.', 'error', 'doi');
    if (m.doi && styleId === 'apa7' && !/https:\/\/doi\.org\/10\./i.test(raw)) add('doi-format', 'Format DOI APA 7', 'Tuliskan DOI sebagai URL https://doi.org/' + m.doi + '.', 'suggestion', 'doi');
    if (BOOK_TYPES.test(type) || REPORT_TYPES.test(type)) {
      var sameOrgPossible = m.authors.length === 1 && m.authors[0].institutional && styleId === 'apa7';
      if (!sameOrgPossible) missing('publisher', 'Penerbit/institusi', m.publisher || m.source);
      if (/^(?:ieee|vancouver)$/.test(styleId)) missing('place', 'Lokasi penerbit/institusi', m.place);
    }
    if (PERIODICAL_TYPES.test(type)) {
      missing('container', 'Nama jurnal/majalah/surat kabar/blog', m.journal || (type === 'blog' ? m.source : null));
      // A journal may legitimately have no volume, issue, or page range (online-first,
      // article IDs). Such absences are never universal format errors.
      if (type === 'journal-article' && !m.pages && !m.articleNumber && !m.status && m.year !== 'in press') add('locator-review', 'Lokasi artikel perlu diperiksa', 'Halaman/nomor artikel belum terbaca. Periksa apakah sumber menggunakan nomor artikel, publikasi daring awal, atau memang tidak memiliki penomoran.');
    }
    if (CHAPTER_TYPES.test(type)) { missing('container', 'Judul buku induk/prosiding/kamus', m.journal); if (type === 'book-chapter') missing('editor', 'Editor buku suntingan', m.editor); }
    if (type === 'thesis') { missing('institution', 'Institusi pemberi gelar', m.institution); missing('degree', 'Jenis tesis/disertasi atau gelar', m.degree); }
    if (type === 'dataset' || type === 'software') missing('provider', 'Repositori/penerbit/penyedia', m.publisher || m.source || m.url || m.doi);
    if (type === 'standard') missing('number', 'Nomor standar', m.standardNumber);
    if (type === 'patent') missing('number', 'Nomor paten', m.patentNumber);
    if (/^(?:webpage|social-media|video|ai-chat)$/.test(type)) missing('url', 'URL sumber', m.url || m.doi);
    if (type === 'conference-presentation') missing('event', 'Nama konferensi/pertemuan', m.source);
    if (type === 'preprint') missing('repository', 'Nama repositori preprint atau identifikator', m.repository || m.arxiv || m.source || m.doi);
    if (/^(?:film|tv-series|podcast|radio-broadcast|musical-score)$/.test(type)) missing('provider', 'Perusahaan produksi/penerbit/penyedia media', m.source || m.publisher || m.url);
    if (/^(?:tv-episode|podcast-episode)$/.test(type)) missing('series', 'Judul serial/podcast induk', m.series);
    if (/^(?:lecture-notes|course|transcript)$/.test(type)) missing('provider', 'Institusi/platform/sumber materi', m.source || m.url || m.doi);
    if (styleId === 'apa7' && /^(?:dataset|software|film|tv-series|tv-episode|podcast|podcast-episode|radio-broadcast|artwork|lecture-notes|ai-chat|transcript)$/.test(type) && !m.description) add('medium-description', 'Deskripsi jenis karya APA 7', 'Periksa deskripsi dalam kurung siku, misalnya [Data set], [Computer software], atau [Film], sesuai jenis karya yang sebenarnya.');
    if (type === 'ai-chat' && styleId === 'apa7' && !/^\d{4},\s*[A-Za-z]+\s+\d/.test(m.date || '')) add('chat-date', 'Tanggal percakapan AI belum lengkap', 'APA 7 untuk percakapan AI memakai tanggal percakapan, termasuk bulan dan hari.');
    if (type === 'personal-communication' && /^(?:apa7|chicago)$/.test(styleId)) add('no-bibliography', 'Komunikasi pribadi biasanya hanya disitasi dalam teks', 'Komunikasi yang tidak dapat diakses pembaca umumnya tidak dimasukkan ke daftar referensi. Periksa sifat akses sumber.');
    if (type === 'whole-website' && styleId === 'apa7') add('no-bibliography', 'Situs secara keseluruhan tidak memerlukan entri APA', 'Sebutkan nama situs dan URL dalam teks. Informasi dari halaman tertentu tetap memerlukan referensi halaman/karya tersebut.');
    if (m.ambiguousLocator) add('ambiguous-locator', 'Halaman atau nomor artikel belum jelas', 'Angka tunggal belum membedakan halaman dengan nomor artikel. Periksa sumber asli sebelum menambahkan Article atau Art. no.');
    var authorScope = raw.slice(0, Math.max(0, raw.indexOf(m.title)));
    if (styleId === 'apa7') {
      if (/\bet\s+al\.?/i.test(authorScope)) add('authors-truncated', 'Daftar penulis APA 7 terpotong', 'Daftar referensi APA 7 mencantumkan semua penulis hingga 20; untuk 21 atau lebih, gunakan 19 pertama, elipsis, dan penulis terakhir. Nama yang hilang harus diperoleh dari sumber asli.', 'error', 'authors');
      if (display.completeAuthors && display.authors.length > 20) add('authors-over20', 'Daftar penulis APA 7 lebih dari 20', 'Gunakan 19 penulis pertama, elipsis, dan penulis terakhir.', 'error', 'authors');
      if (/\band\b\s+[\p{Lu}][\p{L}'’-]+,\s*\p{Lu}\./u.test(authorScope) && !ref.isInstitutional) add('author-connector', 'Penghubung penulis referensi APA 7', 'Gunakan & sebelum penulis terakhir pada daftar referensi.', 'suggestion', 'authors');
    }
    if (styleId === 'ieee') {
      if (!/^\[\d+\]\s/.test(raw)) add('label', 'Label referensi IEEE', 'Awali setiap entri dengan nomor dalam kurung siku, misalnya [1].', 'error', 'number');
      // Inverted "Last, F." only — "T. Brown, B. Mann" is the correct IEEE form, so a surname
      // that is itself preceded by an initial ("T. Brown") is not evidence of inversion.
      if (!ref.isInstitutional && /(?<!\p{Lu}\.(?:\s*\p{Ll}+)*\s?)(?<![\p{L}'’-])\p{Lu}[\p{Ll}'’-]+,\s*\p{Lu}\./u.test(authorScope)) add('author-order', 'Urutan nama penulis IEEE', 'IEEE memakai inisial di depan nama keluarga, misalnya J. Smith.', 'suggestion', 'authors');
      if (display.completeAuthors && display.authors.length > 6) add('authors-over6', 'Daftar penulis IEEE lebih dari enam', 'Gunakan nama penulis pertama diikuti et al. Simpan daftar lengkap dalam metadata untuk konversi balik.', 'suggestion', 'authors');
      if (!display.completeAuthors && display.authors.length > 1) add('authors-truncated', 'Pemendekan nama penulis IEEE', 'Untuk lebih dari enam penulis, IEEE memakai penulis pertama diikuti et al.; bukan enam nama diikuti et al.', 'suggestion', 'authors');
      if ((PERIODICAL_TYPES.test(type) || CHAPTER_TYPES.test(type) || type === 'report' || type === 'thesis') && !/[“"][^”"]+[”"]/.test(raw)) add('title-quotes', 'Tanda kutip judul IEEE', 'Judul artikel/bab/makalah/laporan/tesis biasanya diletakkan dalam tanda kutip; judul karya induk diperiksa terpisah.', 'suggestion', 'title');
      if (raw.indexOf('http') < 0 && !/\.$/.test(raw)) add('terminal-period', 'Tanda akhir referensi IEEE', 'Entri IEEE yang tidak berakhir dengan URL diakhiri titik.', 'suggestion', 'punctuation');
    }
    if (styleId === 'mla9' && display.completeAuthors && display.authors.length > 2) add('authors-over2', 'Daftar penulis MLA 9', 'Untuk tiga penulis atau lebih, cantumkan penulis pertama diikuti et al.', 'suggestion', 'authors');
    if (styleId === 'chicago' && display.completeAuthors && display.authors.length > 6) add('authors-over6', 'Daftar penulis Chicago 18', 'Untuk lebih dari enam penulis, cantumkan tiga penulis pertama diikuti et al.', 'suggestion', 'authors');
    if (styleId === 'vancouver' && /\b(?:vol\.|pp\.)/i.test(raw) && type === 'journal-article') add('journal-block', 'Blok jurnal Vancouver', 'Periksa susunan tahun;volume(nomor):halaman, bukan label vol. dan pp. seperti IEEE.');
    if (styleId === 'vancouver' && display.completeAuthors && display.authors.length > 6) add('authors-over6', 'Opsi daftar penulis Vancouver', 'Profil ini menggunakan enam nama pertama diikuti et al. NLM juga mengizinkan daftar lengkap; ikuti ketentuan jurnal.', 'suggestion', 'authors');
    if (styleId === 'chicago' && type === 'webpage' && /^n\.d\./i.test(m.year || '') && !m.accessed) add('access-date', 'Tanggal akses halaman tanpa tanggal', 'Chicago Author-Date memakai tanggal akses untuk halaman web tanpa tanggal. Isi tanggal akses yang sebenarnya.');
    issues(m, styleId).forEach(function(note, i) {
      // Conversion-only uncertainties (restoring initials/title case) are not evidence that
      // a correctly written source-style reference is erroneous.
      if (/sentence case|Nama depan lengkap/.test(note)) return;
      add('review-' + i, 'Detail bibliografi perlu diverifikasi', note);
      if (/adaptasi|yurisdiksi/.test(note)) coverage = 'manual';
    });
    return { model: m, diagnostics: diagnostics, coverage: coverage, profile: profile.name };
  }
  function validModel(m) {
    return !!(m && typeof m.title === 'string' && Array.isArray(m.authors) && (m.authors.length || m.noAuthor) && m.authors.every(function(a) {
      return a && typeof a.last === 'string' && Array.isArray(a.given) && a.given.every(function(g) { return typeof g === 'string'; });
    }));
  }
  function bindingLine(raw) {
    // The converter writes one layout-only Word tab after its literal numeric label.
    // Mammoth exposes that tab, while custom XML stores visible reference text without it.
    // Remove only that exact delimiter; changes inside bibliographic fields stay significant.
    return String(raw).replace(/^(\[\d+\] |\d+\. )\t/, '$1');
  }
  function formattingSpans(m, styleId, raw) {
    if (!m || MANUAL_TYPES.test(m.type) || styleId === 'vancouver') return [];
    var spans = [], periodical = PERIODICAL_TYPES.test(m.type), chapter = CHAPTER_TYPES.test(m.type);
    var part = periodical || chapter || /^(?:podcast-episode|tv-episode|social-media)$/.test(m.type);
    var titleItalic = !part;
    if (/^(?:mla9|chicago)$/.test(styleId) && /^(?:webpage|thesis|ai-chat)$/.test(m.type)) titleItalic = styleId === 'mla9' && m.type === 'thesis';
    if (styleId === 'ieee' && /^(?:report|brochure|fact-sheet|press-release|white-paper|ethics-code|thesis|conference-presentation|dataset|preprint|unpublished|webpage|ai-chat)$/.test(m.type)) titleItalic = false;
    function span(text, italic, field, from) {
      if (!text) return null;
      var at = raw.indexOf(text, from || 0);
      if (at < 0) return null;
      var found = { start: at, end: at + text.length, text: text, italic: italic, field: field }; spans.push(found); return found;
    }
    var title = span(m.title, titleItalic, 'title');
    var container = part ? span(m.journalAbbreviation && styleId === 'ieee' ? m.journalAbbreviation : (periodical || chapter ? m.journal || m.source : m.series), true, 'container', title ? title.end : 0) : null;
    if (styleId === 'apa7' && periodical && m.volume && container) span(m.volume, true, 'volume', container.end);
    return spans;
  }
  function renderOtherStyle(m, target, number, authors, year) {
    var runs = [], type = m.type, journal = type === 'journal-article';
    var periodical = PERIODICAL_TYPES.test(type), chapter = CHAPTER_TYPES.test(type), book = BOOK_TYPES.test(type);
    function add(text, italic) { if (text) runs.push({ text: String(text), italic: !!italic }); }
    function end() { if (runs.length && !/[.!?]\s*$/.test(runs[runs.length - 1].text)) add('.'); }
    function link() { var url = m.doi ? 'https://doi.org/' + m.doi : m.url; if (url) add(' ' + url + (/^(?:chicago|mla9)$/.test(target) ? '.' : '')); }
    function fullDate() { var d = m.date || year; return d.replace(/^\d{4}[a-z]?,?\s*/, ''); }
    function mlaDate() { var d = fullDate(), hit = d.match(/^([A-Za-z]+)\s+(\d{1,2})$/); return hit ? hit[2] + ' ' + hit[1] + ' ' + year : (d && d !== year ? d + ' ' : '') + year; }
    var title = /^(?:mla9|chicago)$/.test(target) ? titleCase(m.title) : m.title;
    var container = /^(?:mla9|chicago)$/.test(target) && !periodical ? titleCase(m.journal || '') : m.journal;
    if (target === 'vancouver') {
      add(number + '. '); if (authors) add(period(authors) + ' ');
      add(m.title); if (m.edition && book) add('. ' + m.edition.replace(/\.$/, ''));
      if (!periodical && !chapter && !book && m.description) add(' [' + m.description.toLowerCase() + ']');
      add('. ');
      var vd = ieeeDate(m.date || year).replace(/\./g, '').replace(/,\s*(\d{4})$/, ' $1');
      var dm = vd.match(/^([A-Za-z]+)\s*(\d+)?,?\s*(\d{4})$/); if (dm) vd = dm[3] + ' ' + dm[1] + (dm[2] ? ' ' + dm[2] : '');
      if (journal || periodical) {
        // NLM abbreviations differ from IEEE. Use an explicitly supplied NLM abbreviation
        // or keep the actual title, with an editorial note; never reuse IEEE's word table.
        add(m.nlmAbbreviation || m.journal || m.source); add('. ' + vd);
        if (m.volume || m.issue || m.pages || m.articleNumber) add(';');
        add(m.volume); if (m.issue) add('(' + m.issue + ')');
        if (m.pages || m.articleNumber) add(':' + (m.articleNumber || m.pages)); end();
      } else if (chapter) {
        add('In: ' + (m.editor ? m.editor + ', ' + (m.editorIsPlural ? 'editors. ' : 'editor. ') : ''));
        add(m.journal); add('. ' + (m.place ? m.place + ': ' : '') + (m.publisher || m.source || '') + '; ' + year + '.');
        if (m.pages) add(' p. ' + m.pages + '.');
      } else if (type === 'webpage' || type === 'social-media' || type === 'ai-chat') {
        // Online resources need an actual access date. Never insert today's date.
        add('[Internet]. ' + (m.publisher || m.source || '') + (m.publisher || m.source ? '; ' : '') + vd);
        if (m.accessed) add(' [cited ' + m.accessed.replace(/, /g, ' ') + ']'); end();
      } else {
        add((m.place ? m.place + ': ' : '') + (m.publisher || m.institution || m.source || '') + '; ' + year + '.');
        if (m.number) add(' Report No.: ' + m.number.replace(/^.*?No\.\s*/i, '') + '.');
      }
      if (m.doi) add(' doi: ' + m.doi + '.'); else if (m.url) add(' Available from: ' + m.url);
    } else if (target === 'mla9') {
      if (authors) add(period(authors) + ' ');
      var quote = periodical || chapter || type === 'webpage' || type === 'social-media';
      add(quote ? '“' + period(title) + '”' : title, !quote); if (!quote) end();
      if (m.edition && book) add(' ' + m.edition + ',');
      if (periodical || chapter || type === 'webpage') {
        if (container || m.source) { add(' '); add(container || m.source, true); }
        if (chapter && m.editor) add(', edited by ' + m.editor);
        if (m.volume) add(', vol. ' + m.volume); if (m.issue) add(', no. ' + m.issue);
        if (chapter && m.publisher) add(', ' + m.publisher);
        add(', ' + mlaDate());
        if (m.pages) add(', ' + (/[–-]/.test(m.pages) ? 'pp. ' : 'p. ') + m.pages);
        else if (m.articleNumber) add(', article ' + m.articleNumber); end();
      } else { if (m.publisher || m.source) add(' ' + (m.publisher || m.source) + ', ' + year + '.'); else add(' ' + year + '.'); }
      link();
    } else if (target === 'chicago') {
      if (authors) add(period(authors) + ' '); add(year + '. ');
      var quoted = periodical || chapter || type === 'webpage' || type === 'thesis' || type === 'social-media';
      add(quoted ? '“' + period(title) + '”' : title, !quoted); if (!quoted) end();
      if (m.edition && book) add(' ' + m.edition);
      if (journal) {
        add(' '); add(m.journal, true); if (m.volume) add(' ' + m.volume); if (m.issue) add(' (' + m.issue + ')');
        if (m.pages || m.articleNumber) add(': ' + (m.articleNumber || m.pages)); end();
      } else if (periodical || type === 'webpage') {
        if (m.journal || m.source) { add(' '); add(m.journal || m.source, periodical); end(); }
        if (fullDate() && fullDate() !== year) add(' ' + fullDate() + '.');
      } else if (chapter) {
        add(' In '); add(container, true); if (m.editor) add(', edited by ' + m.editor); if (m.pages) add(', ' + m.pages); end();
        if (m.publisher) add(' ' + period(m.publisher));
      } else if (type === 'thesis') add(' ' + (m.degree || 'Thesis') + ', ' + period(m.institution || ''));
      else if (m.publisher || m.source) add(' ' + period(m.publisher || m.source));
      if (m.accessed && /^n\.d\./i.test(year)) add(' Accessed ' + m.accessed + '.'); link();
    } else { // Generic Harvard, deliberately not advertised as a named institutional variant.
      if (authors) add(authors + ' '); add('(' + year + ') ');
      var hQuote = periodical || chapter;
      add(hQuote ? '‘' + title + '’' : title, !hQuote);
      if (hQuote) { add(', '); add(m.journal || m.source, true); }
      if (m.volume) add(', ' + m.volume); if (m.issue) add('(' + m.issue + ')');
      if (m.pages) add(', pp. ' + m.pages); else if (m.articleNumber) add(', article ' + m.articleNumber);
      if (m.edition) add('. ' + m.edition);
      if (!periodical && (m.publisher || m.institution || m.source)) add('. ' + (m.place ? m.place + ': ' : '') + (m.publisher || m.institution || m.source)); end();
      var hLink = m.doi ? 'https://doi.org/' + m.doi : m.url;
      if (hLink) add(' Available at: ' + hLink + (m.accessed ? ' (Accessed: ' + m.accessed + ').' : ''));
    }
    return { line: runs.map(function(r) { return r.text; }).join(''), runs: runs };
  }
  function render(m, target, number, authors, citationYear) {
    if (!m || !m.title || !PROFILES[target] || !TYPES[m.type] || MANUAL_TYPES.test(m.type)) return null;
    if (m.noAuthor && target !== 'apa7' && target !== 'ieee') return null;
    if (target !== 'apa7' && target !== 'ieee') return renderOtherStyle(m, target, number, authors, citationYear || m.year || 'n.d.');
    var runs = [], year = citationYear || m.year || 'n.d.';
    if (m.originalYear && year.indexOf('/') >= 0) year = m.year;
    var date = m.date && m.date.indexOf(m.year) === 0 ? year + m.date.slice(m.year.length) : (m.date || year);
    var journal = /^(?:journal-article|magazine-article|newspaper-article)$/.test(m.type);
    var chapter = /^(?:book-chapter|conference|dictionary-entry)$/.test(m.type);
    var report = /^(?:report|brochure|fact-sheet|press-release|white-paper|ethics-code)$/.test(m.type);
    var book = BOOK_TYPES.test(m.type);
    var episode = /^(?:podcast-episode|tv-episode)$/.test(m.type);
    function add(t, italic) { if (t) runs.push({ text: String(t), italic: !!italic }); }
    function apaTitle(italic) {
      // Only the first word and subtitle initial can be capitalized safely. Lowering
      // every title-case word would corrupt proper names, acronyms and product names.
      var title = (m.apaTitle || m.title).replace(/^\p{Ll}/u, function(c) { return c.toUpperCase(); }).replace(/(:\s+)\p{Ll}/gu, function(s) { return s.toUpperCase(); });
      add(title, italic); if (m.details) add(' (' + m.details + ')');
      if (m.description) add(' [' + m.description + ']');
      add(/[.!?]$/.test(title) && !m.details && !m.description ? ' ' : '. ');
    }
    function quoted() { add('"' + m.title.replace(/"/g, "'") + '," '); }
    function doiAndUrl() {
      if (m.doi) add(', doi: ' + m.doi);
      add('.');
      if (m.accessed) add(' Accessed: ' + ieeeDate(m.accessed) + '.');
      if (m.url) add(' [Online]. Available: ' + m.url);
    }
    if (target === 'apa7') {
      var yearOnly = /^(?:journal-article|book|edited-book|book-chapter|dictionary-entry|conference|report|thesis|preprint|dataset|software|standard|patent|manual|unpublished|diagnostic-manual|religious-work|audiobook)$/.test(m.type);
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
        if (m.seriesTitle) add(m.seriesTitle + (m.seriesVolume ? ': Vol. ' + m.seriesVolume : '') + '. ', true);
        add(m.apaContainerTitle || m.journal, true);
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
          if (m.seriesTitle) add(', ' + m.seriesTitle + (m.seriesVolume ? ' ' + m.seriesVolume : ''));
          if (m.containerVolume) add(', vol. ' + m.containerVolume); if (m.containerIssue) add(', no. ' + m.containerIssue);
          if (m.editor) add(', ' + ieeeEditors(m.editor) + (m.editorIsPlural ? ', Eds.' : ', Ed.'));
          if (m.edition) add(', ' + m.edition); if (m.conferenceLocation) add(', ' + m.conferenceLocation); if (m.place) add(', ' + m.place);
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
  var api = { TYPES: TYPES, PROFILES: PROFILES, seedFromReference: seedFromReference,
    bindingLine: bindingLine, validModel: validModel, formattingSpans: formattingSpans, validateReference: validateReference, enrich: enrich, render: render, issues: issues, abbreviate: abbreviate,
    ieeeDate: ieeeDate, titleCase: titleCase, apaDate: apaDate, splitSentence: splitSentence, parseNames: parseNames };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BibliographyEngine = api;
  if (CE.registerBibliographyEngine) CE.registerBibliographyEngine(api);
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
