// scopus-engine.js — Scopus reference matcher.
//
// PENTING — batasan jujur: file ini TIDAK datang dengan data Scopus asli. Scopus adalah basis
// data berbayar/berlisensi milik Elsevier; tidak ada cara legal untuk saya "mengumpulkan sendiri"
// jutaan metadata dokumennya. Yang disediakan di sini adalah MESIN PENCOCOKANNYA — algoritma
// scoring, arsitektur, dan status 4-tingkat — siap dipakai begitu ada sumber data yang sah:
//   1) Ekspor pribadi dari akun Scopus institusi Anda (lewat Scopus Export/API resmi), ATAU
//   2) "Scopus Source List" yang dipublikasikan GRATIS oleh Elsevier (daftar ISSN jurnal yang
//      terindeks Scopus per tahun — ini publik, BUKAN data dokumen individual, tapi cukup untuk
//      tingkat "SCOPUS SOURCE ONLY": mengonfirmasi JURNALNYA terindeks meski dokumen spesifiknya
//      belum diverifikasi).
// Tanpa salah satu dari itu, semua referensi akan berstatus UNKNOWN — bukan bug, itu memang
// keadaan sebenarnya kalau tidak ada data pembanding.
//
// Arsitektur sengaja dipisah dari engine.js (per rekomendasi review): reuse fungsi-fungsi yang
// sudah ada (bigramSimilarity, normalizeTitle, extractBibliographicFields) tanpa membongkarnya.

(function (global) {
  'use strict';

  var CE = (typeof global.CitationEngine !== 'undefined') ? global.CitationEngine : (typeof require === 'function' ? require('./engine.js') : null);
  if (!CE) throw new Error('scopus-engine.js butuh engine.js dimuat lebih dulu (window.CitationEngine).');

  var STATUS = {
    SCOPUS: 'SCOPUS',
    PROBABLE_SCOPUS: 'PROBABLE_SCOPUS',
    SCOPUS_SOURCE_ONLY: 'SCOPUS_SOURCE_ONLY',
    UNKNOWN: 'UNKNOWN',
  };

  // ---------- Normalisasi kecil untuk perbandingan ----------

  function normalizeDOI(doi) {
    if (!doi) return null;
    return String(doi).trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/\/$/, '');
  }

  function normalizeISSN(issn) {
    if (!issn) return null;
    var s = String(issn).trim().toUpperCase().replace(/[^0-9X]/g, '');
    if (s.length !== 8) return null;
    return s.slice(0, 4) + '-' + s.slice(4);
  }

  // Nama belakang saja (bukan seluruh nama) dibandingkan — cara paling stabil untuk cocokkan
  // "Smith, J." dari referensi vs "J. Smith" atau "Smith J." dari sumber data yang formatnya
  // mungkin beda-beda.
  function extractSurname(authorStr) {
    if (!authorStr) return '';
    var s = String(authorStr).trim();
    var commaIdx = s.indexOf(',');
    if (commaIdx > -1) return s.slice(0, commaIdx).trim().toLowerCase();
    var toks = s.split(/\s+/);
    return (toks[toks.length - 1] || '').replace(/[.,]/g, '').toLowerCase();
  }

  function compareAuthor(a, b) {
    var sa = extractSurname(a), sb = extractSurname(b);
    if (!sa || !sb) return 0;
    if (sa === sb) return 1;
    return CE.bigramSimilarity(sa, sb);
  }

  function compareYear(a, b) {
    var ya = parseInt(a, 10), yb = parseInt(b, 10);
    if (!ya || !yb) return 0;
    if (ya === yb) return 1;
    if (Math.abs(ya - yb) === 1) return 0.5; // tahun terbit vs tahun "online first" kadang beda 1
    return 0;
  }

  function compareVolumePages(ref, candidate) {
    var score = 0, parts = 0;
    if (ref.volume && candidate.volume) { parts++; if (String(ref.volume) === String(candidate.volume)) score++; }
    var refPage = ref.pages || ref.articleNumber, candPage = candidate.pages || candidate.articleNumber;
    if (refPage && candPage) { parts++; if (String(refPage) === String(candPage)) score++; }
    return parts ? score / parts : 0;
  }

  // ---------- Database lokal (in-memory, dimuat dari JSON) ----------
  //
  // Bukan SQL — proyek ini seluruhnya berjalan di browser tanpa backend, jadi indeksnya cuma
  // struktur JS in-memory yang dibangun dari array JSON yang di-load user (mis. hasil ekspor
  // Scopus institusi mereka, atau Source List Elsevier).

  function ScopusDatabase() {
    this.byDOI = {};       // normalizedDOI -> document
    this.byNormTitle = {}; // 4 kata pertama judul (dinormalisasi) -> [document, ...]  (indeks kandidat kasar)
    this.bySourceISSN = {}; // normalizedISSN -> { title, active, coverage, sourceType }  (Source List — level jurnal)
    this.bySourceTitle = {}; // normalizeTitle(title) -> { title, active, coverage, sourceType }  (fallback saat referensi tidak mencantumkan ISSN — kasus paling umum)
    this.byISBN = {};      // normalizedISBN -> { title, year, publisher }  (prosiding konferensi, level volume)
    this.documentCount = 0;
    this.sourceCount = 0;
    this.proceedingsCount = 0;
  }

  function normalizeISBN(isbn) {
    if (!isbn) return null;
    var s = String(isbn).replace(/[^0-9Xx]/g, '');
    return s || null;
  }

  // "2016-2026; 2001-2014" / "1959; 1952-1955" -> [[2016,2026],[2001,2014]] / [[1959,1959],[1952,1955]]
  function parseCoverage(coverageStr) {
    if (!coverageStr) return [];
    return String(coverageStr).split(';').map(function (seg) {
      seg = seg.trim();
      var m = seg.match(/^(\d{4})\s*-\s*(\d{4})$/);
      if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
      var single = seg.match(/^(\d{4})$/);
      if (single) return [parseInt(single[1], 10), parseInt(single[1], 10)];
      return null;
    }).filter(Boolean);
  }

  function isYearInCoverage(coverageStr, year) {
    var y = parseInt(year, 10);
    if (!y) return null; // tahun referensi tidak diketahui -> tidak bisa menyimpulkan apa-apa
    var segments = parseCoverage(coverageStr);
    if (segments.length === 0) return null; // tidak ada info cakupan tahun sama sekali
    return segments.some(function (seg) { return y >= seg[0] && y <= seg[1]; });
  }

  // Kata-kata "berarti" (5+ karakter) dari judul dinormalisasi dipakai sebagai kunci indeks —
  // lebih tahan terhadap perbedaan tokenisasi kecil (mis. "crop-disease" vs "crop disease")
  // dibanding kunci posisi-kata-tetap: kandidat ditemukan kalau BERBAGI SATU SAJA kata
  // distingtif dengan judul yang dicari, bukan mengharuskan kata pertama-sampai-keempat cocok
  // persis.
  ScopusDatabase.prototype._titleKeys = function (title) {
    var norm = CE.normalizeTitle(title || '');
    var words = norm.split(/\s+/).filter(function (w) { return w.length >= 5; });
    return words.length ? words : (norm ? [norm] : []);
  };

  // documents: array of { doi, title, firstAuthor, journal, issn, eissn, year, volume, issue,
  //                        pages, articleNumber, scopusId, ... } — mis. hasil ekspor Scopus.
  ScopusDatabase.prototype.loadDocuments = function (documents) {
    var self = this;
    (documents || []).forEach(function (doc) {
      self.documentCount++;
      var ndoi = normalizeDOI(doc.doi);
      if (ndoi) self.byDOI[ndoi] = doc;
      self._titleKeys(doc.title).forEach(function (key) {
        if (!self.byNormTitle[key]) self.byNormTitle[key] = [];
        self.byNormTitle[key].push(doc);
      });
    });
  };

  // sourceList: array of { issn, eissn, title, active, coverage, sourceType } — mis. dari Scopus
  // Source List (Elsevier, gratis, publik).
  ScopusDatabase.prototype.loadSourceList = function (sourceList) {
    var self = this;
    (sourceList || []).forEach(function (src) {
      self.sourceCount++;
      var nissn = normalizeISSN(src.issn);
      var neissn = normalizeISSN(src.eissn);
      if (nissn) self.bySourceISSN[nissn] = src;
      if (neissn) self.bySourceISSN[neissn] = src;
      if (src.title) self.bySourceTitle[CE.normalizeTitle(src.title)] = src;
    });
  };

  // Versi hemat-memori dari loadSourceList: menerima array-of-array ringkas persis format yang
  // dihasilkan dari Scopus Source List resmi (kolom: ISSN, EISSN, Source Title, Active or
  // Inactive, Coverage, Source Type) — [issn, eissn, title, active(0/1), coverage, sourceType].
  // Lebih murah dibanding array-of-object untuk dataset ~49 ribu baris.
  ScopusDatabase.prototype.loadSourceListCompact = function (compactArray) {
    var self = this;
    (compactArray || []).forEach(function (row) {
      self.sourceCount++;
      var issn = row[0], eissn = row[1], title = row[2], active = row[3], coverage = row[4], sourceType = row[5];
      var src = { issn: issn, eissn: eissn, title: title, active: !!active, coverage: coverage, sourceType: sourceType };
      var nissn = normalizeISSN(issn);
      var neissn = normalizeISSN(eissn);
      if (nissn) self.bySourceISSN[nissn] = src;
      if (neissn) self.bySourceISSN[neissn] = src;
      if (title) self.bySourceTitle[CE.normalizeTitle(title)] = src;
    });
  };

  // proceedings: array of { isbn, title, year, publisher } — mis. dari sheet "All Conf.
  // Proceedings" pada Scopus Source List resmi. Satu ISBN = satu VOLUME prosiding (bukan makalah
  // individual), jadi ini mengonfirmasi "prosiding ini terindeks Scopus", sama levelnya dengan
  // Source List jurnal (level-sumber, bukan level-dokumen).
  ScopusDatabase.prototype.loadProceedings = function (proceedings) {
    var self = this;
    (proceedings || []).forEach(function (p) {
      self.proceedingsCount++;
      var n = normalizeISBN(p.isbn);
      if (n) self.byISBN[n] = p;
    });
  };

  // Versi ringkas: [isbn, title, year, publisher] — sesuai format sheet "All Conf. Proceedings".
  ScopusDatabase.prototype.loadProceedingsCompact = function (compactArray) {
    var self = this;
    (compactArray || []).forEach(function (row) {
      self.proceedingsCount++;
      var isbn = row[0], title = row[1], year = row[2], publisher = row[3];
      var n = normalizeISBN(isbn);
      if (n) self.byISBN[n] = { isbn: isbn, title: title, year: year, publisher: publisher };
    });
  };

  ScopusDatabase.prototype.findByDOI = function (doi) {
    var n = normalizeDOI(doi);
    return n ? (this.byDOI[n] || null) : null;
  };

  ScopusDatabase.prototype.findBySourceISSN = function (issn) {
    var n = normalizeISSN(issn);
    return n ? (this.bySourceISSN[n] || null) : null;
  };

  ScopusDatabase.prototype.findBySourceTitle = function (title) {
    if (!title) return null;
    return this.bySourceTitle[CE.normalizeTitle(title)] || null;
  };

  ScopusDatabase.prototype.findByISBN = function (isbn) {
    var n = normalizeISBN(isbn);
    return n ? (this.byISBN[n] || null) : null;
  };

  // Kandidat kasar berbasis kata-kata distingtif judul (murah), penyaringan presisi (bigram)
  // dilakukan belakangan oleh checkReference — cara umum "blocking" sebelum perbandingan detail
  // supaya tidak perlu membandingkan SATU referensi ke SELURUH database setiap kali.
  ScopusDatabase.prototype.findCandidatesByTitle = function (title) {
    var self = this;
    var keys = this._titleKeys(title);
    var seen = {}, results = [];
    keys.forEach(function (key) {
      (self.byNormTitle[key] || []).forEach(function (doc) {
        var id = normalizeDOI(doc.doi) || doc.title;
        if (!seen[id]) { seen[id] = true; results.push(doc); }
      });
    });
    return results;
  };

  // ---------- Algoritma pencocokan utama ----------
  //
  // Persis skema yang diusulkan di review: DOI exact dulu (paling kuat), baru metadata scoring
  // kalau DOI tidak ada/tidak cocok. Threshold SCOPUS_MATCH_THRESHOLD bisa dikalibrasi ulang
  // pakai dataset pengujian nyata begitu database asli tersedia.
  var SCOPUS_MATCH_THRESHOLD = 0.93;
  var PROBABLE_MATCH_THRESHOLD = 0.80;

  function checkReference(ref, database) {
    if (!ref) return { status: STATUS.UNKNOWN, confidence: 0, method: 'NO_REFERENCE' };

    // LEVEL 1 — DOI adalah identifier terkuat, cocok persis = pasti.
    if (ref.doi) {
      var byDoi = database.findByDOI(ref.doi);
      if (byDoi) {
        return { status: STATUS.SCOPUS, confidence: 1, method: 'DOI_EXACT', matchedDocument: byDoi };
      }
    }

    // LEVEL 2 — cocokkan lewat judul + metadata lain.
    var candidates = database.findCandidatesByTitle(ref.title);
    var best = null;
    candidates.forEach(function (candidate) {
      var titleScore = CE.bigramSimilarity(ref.title || '', candidate.title || '');
      var authorScore = compareAuthor(ref.firstAuthor, candidate.firstAuthor);
      var yearScore = compareYear(ref.year, candidate.year);
      var journalScore = CE.bigramSimilarity(ref.journal || '', candidate.journal || '');
      var volumeScore = compareVolumePages(ref, candidate);
      var score = 0.60 * titleScore + 0.15 * authorScore + 0.10 * journalScore + 0.10 * yearScore + 0.05 * volumeScore;
      if (!best || score > best.score) best = { candidate: candidate, score: score };
    });

    if (best && best.score >= SCOPUS_MATCH_THRESHOLD) {
      return { status: STATUS.SCOPUS, confidence: best.score, method: 'METADATA_MATCH', matchedDocument: best.candidate };
    }
    if (best && best.score >= PROBABLE_MATCH_THRESHOLD) {
      return { status: STATUS.PROBABLE_SCOPUS, confidence: best.score, method: 'METADATA_MATCH_PARTIAL', matchedDocument: best.candidate };
    }

    // LEVEL 3 — dokumen tidak ketemu, tapi JURNALNYA sendiri ada di Source List Scopus (kalau
    // sudah dimuat)? Coba ISSN dulu (paling pasti kalau referensinya mencantumkannya — jarang),
    // baru nama jurnal (lebih umum tersedia, karena hampir semua gaya sitasi mencantumkan nama
    // jurnal tapi jarang ISSN-nya). Kalau ketemu, cek juga apakah TAHUN referensi ini benar jatuh
    // dalam rentang cakupan Scopus jurnal tersebut — jurnal bisa saja terindeks Scopus tapi TIDAK
    // untuk tahun spesifik yang disitasi (cakupan bisa berjeda, atau baru mulai/berhenti tahun
    // tertentu), jadi status "sumber diketahui" tidak seharusnya diberikan kalau tahunnya jelas
    // di luar rentang.
    var src = null;
    if (ref.issn || ref.eissn) {
      src = database.findBySourceISSN(ref.issn) || database.findBySourceISSN(ref.eissn);
    }
    if (!src && ref.journal) {
      src = database.findBySourceTitle(ref.journal);
    }
    if (src) {
      var yearCovered = isYearInCoverage(src.coverage, ref.year);
      if (yearCovered === false) {
        return { status: STATUS.UNKNOWN, confidence: best ? best.score : 0, method: 'JOURNAL_FOUND_YEAR_NOT_COVERED', matchedSource: src };
      }
      return { status: STATUS.SCOPUS_SOURCE_ONLY, confidence: best ? best.score : 0, method: 'JOURNAL_IN_SOURCE_LIST', matchedSource: src };
    }

    return { status: STATUS.UNKNOWN, confidence: best ? best.score : 0, method: 'NO_RELIABLE_MATCH' };
  }

  function checkAllReferences(references, database) {
    return (references || []).map(function (ref) {
      var result = checkReference(ref, database);
      result.ref = ref;
      return result;
    });
  }

  var ScopusMatcher = {
    STATUS: STATUS,
    ScopusDatabase: ScopusDatabase,
    checkReference: checkReference,
    checkAllReferences: checkAllReferences,
    normalizeDOI: normalizeDOI,
    normalizeISSN: normalizeISSN,
    normalizeISBN: normalizeISBN,
    parseCoverage: parseCoverage,
    isYearInCoverage: isYearInCoverage,
    compareAuthor: compareAuthor,
    compareYear: compareYear,
    compareVolumePages: compareVolumePages,
    SCOPUS_MATCH_THRESHOLD: SCOPUS_MATCH_THRESHOLD,
    PROBABLE_MATCH_THRESHOLD: PROBABLE_MATCH_THRESHOLD,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScopusMatcher;
  } else {
    global.ScopusMatcher = ScopusMatcher;
  }
})(typeof window !== 'undefined' ? window : globalThis);
