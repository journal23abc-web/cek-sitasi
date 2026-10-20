/* ============================================================
   ADDIN CORE — logika murni (tanpa Office.js) untuk add-in Word "Cek Sitasi".

   Menerjemahkan isi dokumen Word (daftar paragraf) menjadi:
     - saran perbaikan ala Paperpal (teks asli → teks pengganti, lokasi paragraf + offset)
     - rencana penautan sitasi ↔ referensi (bookmark + hyperlink internal)
     - rencana konversi APA 7 ↔ IEEE
     - pencarian & verifikasi online lewat CrossRef

   Semua parsing, pencocokan, dan format memakai ulang mesin cek-sitasi yang sama
   (engine.js, bibliography-engine.js, converter-engine.js) supaya hasil add-in selalu
   sepakat dengan versi web. File ini bisa diuji di Node (lihat test/addin-core.test.js).
   ============================================================ */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var CE = isNode ? require('../engine.js') : root.CitationEngine;
  var BE = isNode ? require('../bibliography-engine.js') : root.BibliographyEngine;
  var CC = isNode ? require('../converter-engine.js') : root.CitationConverter;
  if (!CE || !BE || !CC) throw new Error('Mesin cek-sitasi belum dimuat (engine.js, bibliography-engine.js, converter-engine.js).');

  var SUPPORTED = { apa7: 'APA 7', ieee: 'IEEE' };

  // ---------- STRUKTUR DOKUMEN ----------
  var HEADING_RE = /^\s*(?:(?:[IVXLC]+|\d+(?:\.\d+)*)[.)]?\s+)?(references?|reference\s+list|bibliography|daftar\s+pustaka|daftar\s+referensi|daftar\s+rujukan|referensi|rujukan|pustaka\s+acuan|kepustakaan|literature\s+cited|works\s+cited)\s*:?\s*$/i;
  var END_RE = /^\s*(?:(?:[IVXLC]+|\d+|[A-Z])[.)]?\s+)?(lampiran|appendix|appendices|biodata|riwayat\s+hidup|about\s+the\s+authors?|author\s+biograph(?:y|ies)|tentang\s+penulis|biographies)\b/i;

  // Karakter kontrol Word diganti spasi SATU-banding-SATU supaya offset tetap sama dengan
  // paragraph.text yang dipakai saat mencari/menyorot di Word.
  function cleanText(t) {
    return String(t == null ? '' : t).replace(/[\u000b\u000c\u0007\r ]/g, function (c) { return c === ' ' ? ' ' : ' '; });
  }
  function norm(s) { return String(s || '').replace(/[\s ]+/g, ' ').trim(); }

  // paragraphs: [{ text, listString?, isListItem?, inTable? }]
  function structure(paragraphs) {
    var paras = (paragraphs || []).map(function (p, i) {
      var o = typeof p === 'string' ? { text: p } : p;
      return { index: i, text: cleanText(o.text), listString: o.listString || '', isListItem: !!o.isListItem, inTable: !!o.inTable };
    });
    var headingIndex = -1;
    for (var i = paras.length - 1; i >= 0; i--) {
      var t = paras[i].text.trim();
      if (t.length && t.length < 60 && !paras[i].inTable && HEADING_RE.test(t)) { headingIndex = i; break; }
    }
    var endIndex = paras.length;
    if (headingIndex >= 0) {
      for (var j = headingIndex + 1; j < paras.length; j++) {
        var tj = paras[j].text.trim();
        if (tj.length && tj.length < 80 && END_RE.test(tj)) { endIndex = j; break; }
      }
    }
    var articleEnd = headingIndex >= 0 ? headingIndex : paras.length;
    var articleParas = paras.slice(0, articleEnd);
    var paraStart = [], cursor = 0;
    articleParas.forEach(function (p) { paraStart.push(cursor); cursor += p.text.length + 1; });
    var articleText = articleParas.map(function (p) { return p.text; }).join('\n');

    var refs = [];
    if (headingIndex >= 0) {
      for (var k = headingIndex + 1; k < endIndex; k++) {
        var p = paras[k];
        if (!p.text.trim()) continue;
        var label = '';
        var ls = (p.listString || '').trim();
        // Penomoran otomatis Word ("[1]" atau "1.") tidak ikut di paragraph.text —
        // ditambahkan di depan agar mesin IEEE tetap mengenali nomornya.
        if (p.isListItem && /^\[?\d{1,4}[\].)]?$/.test(ls)) label = (/^\d+$/.test(ls) ? '[' + ls + ']' : ls.replace(/\)$/, '.')) + ' ';
        var body = p.text.replace(/^\s+/, '');
        refs.push({ paraIndex: k, label: label, labelFromList: !!label, leading: p.text.length - body.length, line: (label + body).replace(/\s+$/, ''), text: p.text });
      }
    }
    var refText = refs.map(function (r) { return r.line; }).join('\n');
    return {
      paragraphs: paras, headingIndex: headingIndex, endIndex: endIndex,
      articleText: articleText, paraStart: paraStart, articleParaCount: articleParas.length,
      refs: refs, refText: refText
    };
  }

  // Offset global pada articleText → { paraIndex, offset }
  function locateArticleOffset(st, globalOffset) {
    var lo = 0, hi = st.paraStart.length - 1, ans = 0;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (st.paraStart[mid] <= globalOffset) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return { paraIndex: ans, offset: globalOffset - st.paraStart[ans] };
  }

  function isWordChar(c) { return !!c && /[\p{L}\p{N}_]/u.test(c); }
  function isWholeAt(text, idx, len) { return !isWordChar(text[idx - 1]) && !isWordChar(text[idx + len]); }

  // Indeks kemunculan ke-berapa (0-based) `needle` yang dimulai tepat di `offset`, dihitung
  // dengan cara yang sama seperti hasil pencarian Word (tidak tumpang tindih, kiri ke kanan).
  function occurrenceIndex(text, needle, offset, wholeWord) {
    if (!needle) return -1;
    var count = 0, i = 0;
    while (i <= text.length) {
      var j = text.indexOf(needle, i);
      if (j < 0 || j > offset) return -1;
      if (!wholeWord || isWholeAt(text, j, needle.length)) {
        if (j === offset) return count;
        count++; i = j + needle.length;
      } else i = j + 1;
    }
    return -1;
  }

  function findAllIndexes(text, needle) {
    var out = [], i = 0;
    if (!needle) return out;
    while (true) { var j = text.indexOf(needle, i); if (j < 0) break; out.push(j); i = j + needle.length; }
    return out;
  }

  function refIndexOfRaw(st, raw) {
    var n = norm(raw);
    for (var i = 0; i < st.refs.length; i++) if (norm(st.refs[i].line) === n) return i;
    for (var k = 0; k < st.refs.length; k++) {
      var l = norm(st.refs[k].line);
      if (l && (n.indexOf(l) === 0 || l.indexOf(n) === 0)) return k;
    }
    return -1;
  }

  // ---------- DETEKSI GAYA (dibatasi ke APA 7 / IEEE) ----------
  function detectStyle(st) {
    if (!st.articleText.trim() && !st.refText.trim()) return { styleId: 'apa7', confidence: 0, detected: null, note: 'Dokumen kosong.' };
    var det = CE.FormatDetector.detect(st.articleText, st.refText);
    var fam = CE.STYLES[det.styleId] ? CE.STYLES[det.styleId].family : 'author-date';
    var styleId = fam === 'numeric' ? 'ieee' : 'apa7';
    var note = null;
    if (!SUPPORTED[det.styleId]) note = 'Terdeteksi mirip ' + CE.STYLES[det.styleId].name + '; add-in ini memeriksa sebagai ' + SUPPORTED[styleId] + '.';
    return { styleId: styleId, confidence: det.confidence, detected: det.styleId, note: note };
  }

  // ---------- UTIL KONVERSI AMAN ----------
  function safeConvert(st, source, target, options) {
    try { return { out: CC.convert(st.articleText, st.refText, source, target, options || {}), error: null }; }
    catch (e) { return { out: null, error: e.message || String(e) }; }
  }

  var LABEL_RE = /^\s*(?:\[\d{1,4}\]|\d{1,4}\.)\s*/;
  // Ganti/lepas label "[n] " di depan runs hasil render.
  function relabelRuns(runs, newLabel) {
    var out = runs.map(function (r) { return { text: r.text, italic: !!r.italic }; });
    while (out.length && !out[0].text) out.shift();
    if (out.length) {
      var m = out[0].text.match(LABEL_RE);
      if (m) out[0].text = out[0].text.slice(m[0].length);
      if (!out[0].text) out.shift();
    }
    if (newLabel) out.unshift({ text: newLabel, italic: false });
    return out;
  }
  function runsText(runs) { return runs.map(function (r) { return r.text; }).join(''); }

  // Kata (≥2 huruf/angka) pada teks asli yang hilang dari saran. Kata format gaya
  // (and/doi/vol/pp/…) diabaikan. Dipakai sebagai pengaman: saran yang membuang isi
  // referensi TIDAK boleh diterapkan otomatis.
  var STYLE_WORDS = /^(?:and|dan|doi|https?|org|dx|vol|no|nos|pp|in|eds?|retrieved|from|available|online|accessed|art|article|et|al|n|d)$/i;
  function initialCount(line) {
    var t = String(line || '').replace(LABEL_RE, '');
    var cut = t.search(/\(\s*(?:\d{4}|n\.d\.|in press)|["“]/i);
    return ((cut > 0 ? t.slice(0, cut) : t).match(/(?:^|[\s,(-])\p{Lu}\./gu) || []).length;
  }
  function lostTokens(original, replacement) {
    var rep = {};
    (replacement.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).forEach(function (t) { rep[t] = (rep[t] || 0) + 1; });
    var lost = [];
    (original.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).forEach(function (t) {
      if (t.length < 2 || STYLE_WORDS.test(t)) return;
      if (rep[t] > 0) rep[t]--; else if (lost.indexOf(t) < 0) lost.push(t);
    });
    return lost;
  }

  // ---------- DIFF KATA (untuk tampilan saran) ----------
  function wordDiff(a, b) {
    var A = String(a).match(/\s+|[^\s]+/g) || [], B = String(b).match(/\s+|[^\s]+/g) || [];
    var n = A.length, m = B.length;
    if (n * m > 250000) return [{ op: 'del', text: a }, { op: 'ins', text: b }];
    var dp = []; for (var i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (var x = n - 1; x >= 0; x--) for (var y = m - 1; y >= 0; y--) dp[x][y] = A[x] === B[y] ? dp[x + 1][y + 1] + 1 : Math.max(dp[x + 1][y], dp[x][y + 1]);
    var ops = [], p = 0, q = 0;
    function push(op, t) { var last = ops[ops.length - 1]; if (last && last.op === op) last.text += t; else ops.push({ op: op, text: t }); }
    while (p < n && q < m) {
      if (A[p] === B[q]) { push('eq', A[p]); p++; q++; }
      else if (dp[p + 1][q] >= dp[p][q + 1]) { push('del', A[p]); p++; }
      else { push('ins', B[q]); q++; }
    }
    while (p < n) push('del', A[p++]);
    while (q < m) push('ins', B[q++]);
    return ops;
  }

  // Ringkasan perubahan yang terlihat pada saran referensi (untuk judul kartu).
  function describeChange(a, b) {
    var notes = [];
    var ops = wordDiff(a, b).filter(function (o) { return o.op !== 'eq'; });
    var del = ops.filter(function (o) { return o.op === 'del'; }).map(function (o) { return o.text; }).join(' ');
    var ins = ops.filter(function (o) { return o.op === 'ins'; }).map(function (o) { return o.text; }).join(' ');
    if (/\d-\d/.test(del) && /\d–\d/.test(ins)) notes.push('Rentang angka memakai tanda pisah en (–), bukan tanda hubung (-)');
    if (/doi:/i.test(del) && /doi\.org|doi: 10/i.test(ins)) notes.push('Format DOI disesuaikan');
    if (/\band\b/.test(del) && /&/.test(ins)) notes.push('Gunakan & sebelum penulis terakhir');
    if (/&/.test(del) && /\band\b/.test(ins)) notes.push('Gunakan "and" sebelum penulis terakhir');
    if (/["“”]/.test(ins) && !/["“”]/.test(del)) notes.push('Judul diberi tanda kutip');
    if (/\.$/.test(b.trim()) && !/\.$/.test(a.trim())) notes.push('Entri diakhiri titik');
    if (/\bArticle\b/.test(ins) && !/\bArticle\b/.test(del)) notes.push('Nomor artikel diawali kata "Article"');
    if (/\b(?:vol|no|pp)\./.test(ins) && !/\b(?:vol|no|pp)\./.test(del)) notes.push('Label vol./no./pp. ditambahkan');
    return notes;
  }

  // ---------- VALIDATOR → SARAN ----------
  var NON_TEXT_CORRECTION = /→|Urutan yang benar|^Gunakan|^Tambahkan|^Periksa|^Pastikan|^Hapus|^Ganti/i;

  // "[2, 4]" → "[2], [4]";  "[5]-[6]" → "[5], [6]";  "[3, 4, 5]" → "[3]–[5]" (IEEE 2025).
  function ieeeGroup(code) {
    var cits = CE.extractNumericCitations(code, 'ieee');
    var nums = [];
    cits.forEach(function (c) { (c.numbers || []).forEach(function (n) { if (nums.indexOf(n) < 0) nums.push(n); }); });
    if (!nums.length) return null;
    nums.sort(function (a, b) { return a - b; });
    var out = [], i = 0;
    while (i < nums.length) {
      var j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      if (j - i >= 2) out.push('[' + nums[i] + ']–[' + nums[j] + ']');
      else for (var k = i; k <= j; k++) out.push('[' + nums[k] + ']');
      i = j + 1;
    }
    var res = out.join(', ');
    return res === code ? null : res;
  }

  function makeKey(parts) { return parts.join('§').slice(0, 400); }

  function validate(st, styleId, opts) {
    var options = opts || {};
    var v = new CE.MultiFormatValidator(st.articleText, st.refText, styleId, {});
    var result = v.validate();
    var suggestions = [];
    var codeCounters = {};
    var refCards = {}; // refIdx → card

    function addArticleIssue(issue) {
      var code = issue.code;
      if (!code) return false;
      var correction = issue.correction || null;
      if (!correction && styleId === 'ieee' && /Kelompok sitasi IEEE|Kurung sitasi IEEE/i.test(issue.title)) correction = ieeeGroup(code);
      var original = code;
      // Kode di-anchor ke teks yang benar-benar ada di naskah; koreksi kadang membawa
      // tanda kurung sementara kode tidak (bagian dari grup sitasi).
      var positions = findAllIndexes(st.articleText, code);
      if (correction && /^\(.*\)$/.test(correction) && !/^\(/.test(code)) {
        var wrapped = findAllIndexes(st.articleText, '(' + code + ')');
        if (wrapped.length) { original = '(' + code + ')'; positions = wrapped; }
        else correction = correction.slice(1, -1);
      }
      if (!positions.length) return false;
      var counterKey = original + '§' + issue.title;
      var nth = codeCounters[counterKey] || 0; codeCounters[counterKey] = nth + 1;
      var gpos = positions[Math.min(nth, positions.length - 1)];
      var loc = locateArticleOffset(st, gpos);
      var paraText = st.paragraphs[loc.paraIndex].text;
      var applicable = !!(correction && correction !== original && correction.length < 400 && !NON_TEXT_CORRECTION.test(correction));
      suggestions.push({
        id: 'a' + suggestions.length,
        key: makeKey(['art', issue.title, original, nth]),
        kind: 'replace', category: /tidak ada di|tidak pernah|merujuk nomor|ambigu|tidak disitasi/i.test(issue.title) ? 'match' : 'citation',
        severity: issue.severity === 'error' ? 'error' : 'suggestion',
        title: issue.title, description: issue.description || '',
        paraIndex: loc.paraIndex, offset: loc.offset, length: original.length,
        occurrence: occurrenceIndex(paraText, original, loc.offset, false),
        original: original, replacement: applicable ? correction : null,
        hint: !applicable && issue.correction ? issue.correction : null,
        canApply: applicable,
        searchable: /tidak ada di daftar referensi/i.test(issue.title) && styleId === 'apa7',
        sourceUrl: issue.sourceUrl || null
      });
      return true;
    }

    function refCard(idx) {
      if (refCards[idx]) return refCards[idx];
      var r = st.refs[idx];
      var card = {
        id: 'r' + idx, key: makeKey(['ref', idx, norm(r.line)]),
        kind: 'paragraph', category: 'reference', severity: 'suggestion',
        title: 'Format referensi ' + SUPPORTED[styleId], description: '',
        reasons: [], paraIndex: r.paraIndex, offset: r.leading, length: Math.max(1, r.text.trim().length),
        refIndex: idx, original: r.line, replacement: null, replacementRuns: null, canApply: false
      };
      refCards[idx] = card;
      return card;
    }

    var unread = (result.failedLines || []).map(function (f) { return { text: f.text }; });
    var all = (result.errors || []).map(function (x) { return x; }).concat(result.suggestions || []);
    all = all.map(function (issue) {
      if (!/tidak ada di daftar referensi/i.test(issue.title) || !issue.code) return issue;
      var hit = failedFor(unread, issue.code);
      return hit ? Object.assign({}, issue, { description: issue.description + ' Kemungkinan referensinya ada, tetapi entri "' + hit.text.slice(0, 40) + '…" tidak terbaca — perbaiki entri itu dulu.' }) : issue;
    });
    var docLevel = [];
    all.forEach(function (issue) {
      var isRef = (issue.location && issue.location.source === 'reference') || /^bibliography\./.test(issue.ruleId || '');
      if (isRef && issue.code) {
        var idx = refIndexOfRaw(st, issue.code);
        if (idx >= 0) {
          var c = refCard(idx);
          if (issue.severity === 'error') c.severity = 'error';
          if (!c.reasons.some(function (x) { return x.title === issue.title; })) c.reasons.push({ title: issue.title, description: issue.description || '', sourceUrl: issue.sourceUrl || null, severity: issue.severity });
          if (/tidak disitasi|tidak pernah disitasi/i.test(issue.title)) c.uncited = true;
          return;
        }
      }
      if (!isRef && addArticleIssue(issue)) return;
      docLevel.push(issue);
    });

    // Normalisasi satu-gaya → saran per entri referensi (teks lengkap, dengan cetak miring).
    var normalized = safeConvert(usableState(st, styleId).st, styleId, styleId);
    var sortOrder = null, italicPlan = [];
    if (normalized.out) {
      normalized.out.referenceLines.forEach(function (rl) {
        var idx = refIndexOfRaw(st, rl.original || '');
        if (idx < 0) return;
        var r = st.refs[idx];
        var originalLabel = (r.line.match(LABEL_RE) || [''])[0];
        var newLabel = styleId === 'ieee' && !r.labelFromList ? (originalLabel.trim() ? originalLabel.trim() + ' ' : '') : '';
        var runs = relabelRuns(rl.runs || [{ text: rl.line, italic: false }], newLabel);
        var replacementText = runsText(runs);
        var current = r.labelFromList ? r.line.replace(LABEL_RE, '') : r.line;
        if (norm(replacementText) === norm(current)) {
          // Teks sudah benar → periksa cetak miring langsung di Word (bridge.checkItalics).
          // Setiap run miring dicek sendiri (tanda baca di antaranya diabaikan); kemunculan ke-n
          // dihitung dari posisinya, supaya volume "20" tidak tertukar dengan tahun "2020".
          var rendered = runsText(runs), offsetShift = Math.max(0, r.text.length - rendered.length), cursor = 0;
          var segs = runs.map(function (x) {
            var at = cursor; cursor += x.text.length;
            if (!x.italic) return null;
            var t = x.text.trim().replace(/^[,.;:]\s*|[,.;:]$/g, '').trim();
            if (t.length < 1 || !/[\p{L}\p{N}]/u.test(t)) return null;
            var want = at + x.text.indexOf(t) + offsetShift;
            var hits = findAllIndexes(r.text, t);
            if (!hits.length) return null;
            var best = 0; hits.forEach(function (h, i) { if (Math.abs(h - want) < Math.abs(hits[best] - want)) best = i; });
            return { text: t, occurrence: best };
          }).filter(Boolean);
          if (segs.length) italicPlan.push({ refIndex: idx, paraIndex: r.paraIndex, segments: segs });
          return;
        }
        var lost = lostTokens(current, replacementText);
        // Inisial yang hilang = penulis yang hilang (mis. penulis bernama keluarga satu huruf "T., R.").
        var dropped = initialCount(current) - initialCount(replacementText);
        if (dropped > 0) lost = lost.concat([dropped + ' inisial/penulis']);
        var c = refCard(idx);
        c.replacement = replacementText; c.replacementRuns = runs;
        c.compareOriginal = current;
        c.changeNotes = describeChange(current, replacementText);
        c.canApply = lost.length === 0;
        if (lost.length) c.blockedReason = 'Saran otomatis berisiko menghilangkan: ' + lost.slice(0, 6).join(', ') + '. Perbaiki manual.';
      });
      if (styleId === 'apa7') {
        sortOrder = normalized.out.referenceLines.map(function (rl) { return refIndexOfRaw(st, rl.original || ''); });
        // Entri tak terbaca disisipkan menurut teksnya agar urutan tetap lengkap.
        st.refs.forEach(function (r, i) {
          if (sortOrder.indexOf(i) >= 0) return;
          var key = r.line.toLowerCase(), pos = sortOrder.findIndex(function (j) { return j >= 0 && st.refs[j].line.toLowerCase().localeCompare(key) > 0; });
          if (pos < 0) sortOrder.push(i); else sortOrder.splice(pos, 0, i);
        });
        if (sortOrder.some(function (x) { return x < 0; }) || new Set(sortOrder).size !== st.refs.length) sortOrder = null;
      }
    }

    Object.keys(refCards).map(Number).sort(function (a, b) { return a - b; }).forEach(function (idx) {
      var c = refCards[idx];
      if (!c.reasons.length && !c.replacement) return;
      // Saran yang diblokir tanpa temuan validator = keraguan parser, bukan kesalahan naskah.
      if (c.blockedReason && !c.reasons.length) return;
      // Catatan "pastikan jenis sumber" hanya keraguan klasifikasi, bukan kesalahan: tampil
      // tenang (hanya di filter Referensi) kecuali ada saran perbaikan nyata.
      if (!c.replacement && c.reasons.every(function (x) { return /Pastikan jenis sumber|perlu diverifikasi/i.test(x.title + ' ' + x.description) && !/tidak disitasi/i.test(x.title); })) c.quiet = true;
      if (!c.reasons.length) {
        var notes = c.changeNotes || [];
        c.reasons.push({ title: notes[0] || 'Tanda baca / susunan unsur belum sesuai ' + SUPPORTED[styleId], description: (notes.length > 1 ? notes.join('; ') + '. ' : '') + 'Disusun ulang mengikuti templat ' + SUPPORTED[styleId] + ' dari unsur yang terbaca.' });
      }
      c.title = c.uncited && c.reasons.length === 1 ? c.reasons[0].title : c.reasons[0].title + (c.reasons.length > 1 ? ' (+' + (c.reasons.length - 1) + ')' : '');
      c.description = c.reasons.map(function (x) { return x.description; }).filter(Boolean)[0] || '';
      if (c.uncited && !c.replacement) c.category = 'match';
      suggestions.push(c);
    });

    // Masalah tingkat dokumen (urutan, konsistensi) → kartu aksi khusus.
    docLevel.forEach(function (issue, i) {
      var s = { id: 'd' + i, key: makeKey(['doc', issue.title]), kind: 'info', category: 'consistency',
        severity: issue.severity === 'error' ? 'error' : 'suggestion', title: issue.title,
        description: issue.description || '', hint: issue.correction || null, canApply: false, paraIndex: null };
      if (/tidak alfabetis/i.test(issue.title) && /Daftar referensi/i.test(issue.title) && sortOrder) {
        s.kind = 'sort'; s.order = sortOrder; s.canApply = true; s.actionLabel = 'Urutkan daftar referensi';
      } else if (styleId === 'ieee' && /urutan kemunculan|tidak berurutan/i.test(issue.title)) {
        s.kind = 'restyle'; s.canApply = true; s.actionLabel = 'Nomori ulang otomatis';
      } else if (/Gaya sitasi tidak konsisten/i.test(issue.title)) {
        s.kind = 'restyle'; s.canApply = true; s.actionLabel = 'Seragamkan ke ' + SUPPORTED[styleId];
      }
      if (issue.code) s.original = issue.code;
      suggestions.push(s);
    });

    // Entri daftar pustaka yang tidak terbaca → kartu tersendiri (tidak ikut diperiksa/dikonversi).
    (result.failedLines || []).forEach(function (f, i) {
      var idx = refIndexOfRaw(st, f.text);
      if (idx < 0) return;
      var r = st.refs[idx];
      suggestions.push({ id: 'f' + i, key: makeKey(['unread', norm(r.line)]), kind: 'info', category: 'reference', severity: 'error',
        title: 'Referensi tidak terbaca', original: r.line, paraIndex: r.paraIndex, offset: r.leading, length: Math.max(1, r.text.trim().length), refIndex: idx,
        description: (f.reason || 'Pola penulis/tahun tidak dikenali') + '. Entri ini tidak ikut diperiksa dan tidak bisa dikonversi. ' +
          (styleId === 'apa7' ? 'Pastikan susunannya: Penulis, A. A. (Tahun). Judul. Sumber.' : 'Pastikan susunannya: [n] A. A. Penulis, "Judul," Sumber, tahun.'),
        canApply: false });
    });

    var stats = {
      errors: suggestions.filter(function (s) { return s.severity === 'error'; }).length,
      suggestions: suggestions.filter(function (s) { return s.severity !== 'error'; }).length,
      citations: countCitations(result.citations),
      references: result.references.length,
      failedLines: (result.failedLines || []).length
    };
    return { styleId: styleId, suggestions: suggestions, stats: stats, references: result.references, failedLines: result.failedLines || [], normalizeError: normalized.error, italicPlan: italicPlan };
  }

  function countCitations(cits) {
    var n = 0;
    (cits || []).forEach(function (c) { n += c.parts ? c.parts.length : (c.numbers ? c.numbers.length : 1); });
    return n;
  }

  // ---------- TAUTAN ----------
  function bookmarkName(i) { return '_CS_REF_' + (i + 1); }

  function planLinks(st, styleId, opts) {
    var options = opts || {};
    var usable = usableState(st, styleId);
    var conv = safeConvert(usable.st, styleId, styleId);
    var citationLinks = [], unmatched = [], externalLinks = [];
    if (conv.out) {
      conv.out.citationSpans.forEach(function (span) {
        if (!span.matched) { unmatched.push({ text: span.original, note: span.note }); return; }
        var spanText = st.articleText.slice(span.start, span.end);
        var searchFrom = 0;
        (span.linkTargets || []).forEach(function (t) {
          var rel = -1;
          if (t.wholeWord) {
            var re = new RegExp('(^|[^\\p{L}\\p{N}_])' + t.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'gu');
            re.lastIndex = searchFrom; var m = re.exec(spanText);
            if (m) rel = m.index + m[1].length;
          } else rel = spanText.indexOf(t.text, searchFrom);
          if (rel < 0) return; // mis. nomor tengah dalam rentang [3]–[5] tidak tampak
          searchFrom = rel + t.text.length;
          var refIdx = refIndexOfRaw(st, t.refRaw);
          if (refIdx < 0) return;
          var loc = locateArticleOffset(st, span.start + rel);
          var paraText = st.paragraphs[loc.paraIndex].text;
          citationLinks.push({ paraIndex: loc.paraIndex, offset: loc.offset, length: t.text.length, text: t.text,
            wholeWord: !!t.wholeWord, occurrence: occurrenceIndex(paraText, t.text, loc.offset, !!t.wholeWord),
            refIndex: refIdx, bookmark: bookmarkName(refIdx) });
        });
      });
    }
    if (options.external !== false) {
      st.refs.forEach(function (r, i) {
        var text = r.text, re = /(https?:\/\/[^\s<>"]+)|(\bdoi\s*:\s*)(10\.\d{4,9}\/[^\s<>"]+)/gi, m;
        while ((m = re.exec(text))) {
          var display, href, offset;
          if (m[1]) { display = m[1].replace(/[.,;)\]]+$/, ''); href = display; offset = m.index; }
          else { display = m[3].replace(/[.,;)\]]+$/, ''); href = 'https://doi.org/' + display; offset = m.index + m[2].length; }
          externalLinks.push({ paraIndex: r.paraIndex, offset: offset, length: display.length, text: display, href: href,
            occurrence: occurrenceIndex(text, display, offset, false), refIndex: i });
        }
      });
    }
    var bookmarks = st.refs.map(function (r, i) { return { paraIndex: r.paraIndex, name: bookmarkName(i), refIndex: i }; });
    var used = {}; citationLinks.forEach(function (l) { used[l.refIndex] = true; });
    return { citationLinks: citationLinks, externalLinks: externalLinks, bookmarks: bookmarks.filter(function (b) { return used[b.refIndex]; }),
      unmatched: unmatched, failedRefs: usable.failed, error: conv.error };
  }

  // ---------- KONVERSI ----------
  // Entri yang tidak terbaca oleh parser gaya sumber. Dipakai Konversi (entri dikecualikan,
  // tidak diubah, dan dilaporkan satu per satu) dan Validator (kartu "Referensi tidak terbaca").
  function unreadableReferences(st, source) {
    if (!st.refs.length) return [];
    var v = new CE.MultiFormatValidator(st.articleText, st.refText, source, {});
    var r = v.validate();
    return (r.failedLines || []).map(function (f) {
      var idx = refIndexOfRaw(st, f.text);
      return { refIndex: idx, paraIndex: idx >= 0 ? st.refs[idx].paraIndex : null, text: f.text, reason: f.reason || 'Pola penulis/tahun tidak dikenali' };
    });
  }

  // Sitasi tak cocok yang nama penulisnya cocok dengan awal entri tak terbaca.
  function failedFor(failed, citation) {
    var m = String(citation || '').replace(/^[(\[]\s*/, '').match(/^[\p{L}'’-]{2,}/u);
    if (!m) return null;
    var name = m[0].toLowerCase();
    return failed.find(function (f) { return f.text.replace(/^\s*(?:\[\d+\]|\d+\.)\s*/, '').toLowerCase().indexOf(name) === 0; }) || null;
  }

  // Salinan struktur tanpa entri yang tidak terbaca — mesin konversi menolak daftar yang
  // mengandung entri tak terbaca, jadi Tautan/Konversi/saran format memakai salinan ini.
  function usableState(st, styleId, failed) {
    var f = failed || unreadableReferences(st, styleId);
    var skip = {}; f.forEach(function (x) { if (x.refIndex >= 0) skip[x.refIndex] = true; });
    var keptIdx = st.refs.map(function (r, i) { return i; }).filter(function (i) { return !skip[i]; });
    return { failed: f, st: Object.assign({}, st, {
      refs: keptIdx.map(function (i) { return st.refs[i]; }),
      refText: keptIdx.map(function (i) { return st.refs[i].line; }).join('\n')
    }) };
  }

  function planConversion(st, source, target, opts) {
    var options = opts || {};
    // 1) Entri yang tidak terbaca dikeluarkan dulu supaya sisanya tetap bisa dikonversi.
    var failed = unreadableReferences(st, source);
    if (failed.some(function (f) { return f.refIndex < 0; })) {
      return { error: 'Beberapa entri daftar pustaka tidak terbaca dan tidak bisa dipetakan ke paragrafnya.', failedRefs: failed };
    }
    var stUse = usableState(st, source, failed).st;
    var conv = safeConvert(stUse, source, target, options.metadata ? { metadata: options.metadata } : {});
    if (!conv.out) return { error: conv.error, failedRefs: failed };
    var out = conv.out;

    // 2) Sitasi: yang diubah dan yang tidak (dengan lokasi untuk tombol "Lihat").
    function located(s) {
      var loc = locateArticleOffset(st, s.start);
      var paraText = st.paragraphs[loc.paraIndex].text;
      return { paraIndex: loc.paraIndex, offset: loc.offset, length: (s.original || '').length, original: s.original,
        occurrence: occurrenceIndex(paraText, s.original, loc.offset, false), crossesParagraph: st.articleText.slice(s.start, s.end).indexOf('\n') >= 0 };
    }
    var edits = out.citationSpans.filter(function (s) { return s.matched && s.original !== s.replacement && s.original; }).map(function (s) {
      var e = located(s); e.replacement = s.replacement; return e;
    });
    var unmatched = out.citationSpans.filter(function (s) { return !s.matched && s.original; }).map(function (s) {
      var u = located(s); u.raw = s.original; u.note = s.note || 'Tidak cocok dengan referensi mana pun.';
      var hit = failedFor(failed, s.original);
      if (hit) u.note = 'Referensinya kemungkinan ada, tetapi entri "' + hit.text.slice(0, 40) + '…" tidak terbaca (lihat di atas). Perbaiki entri itu, lalu konversi ulang.';
      u.crossFamily = !!s.crossFamily; return u;
    });

    // 3) Daftar pustaka: status per entri (dikonversi / perlu dicek / berisiko), dengan catatannya.
    var enrichedBy = {};
    (options.metadata && options.metadata.entries || []).forEach(function (e) { enrichedBy[norm(e.line)] = e.changes || []; });
    var notesBy = {};
    (out.referenceIssues || []).forEach(function (n) { var k = norm(n.raw); (notesBy[k] = notesBy[k] || []).push(n.note); });
    var useListNumbering = target === 'ieee' && st.refs.length > 0 && st.refs.every(function (r) { return r.labelFromList; });
    var lines = out.referenceLines.map(function (rl, i) {
      var runs = rl.runs || [{ text: rl.line, italic: false }];
      var lostNames = lostAuthorTokens(rl.original || '', rl.line || '', rl.model && rl.model.title);
      var label = target === 'ieee' && !useListNumbering ? '[' + (i + 1) + '] ' : '';
      runs = relabelRuns(runs, label);
      var refIdx = refIndexOfRaw(st, rl.original || '');
      var notes = (notesBy[norm(rl.original || '')] || []).slice();
      var risky = lostNames.length > 0;
      if (risky) {
        // Entri yang terbaca keliru tidak ditulis ulang: teks asli dipertahankan & disorot.
        runs = [{ text: (rl.original || '').replace(LABEL_RE, ''), italic: false }];
        if (label) runs.unshift({ text: label, italic: false });
      }
      // Catatan singkatan jurnal bersifat informatif; status "perlu dicek" hanya untuk catatan substantif.
      var serious = notes.filter(function (n) { return !/Singkatan jurnal dibentuk dari daftar kata IEEE|Pastikan jenis sumber/i.test(n); });
      var status = risky ? 'risky' : serious.length ? 'review' : 'ok';
      return { text: runsText(runs), runs: runs, wasCited: rl.wasCited !== false, fullyFormatted: rl.fullyFormatted !== false,
        original: rl.original || '', refIndex: refIdx, paraIndex: refIdx >= 0 ? st.refs[refIdx].paraIndex : null,
        risky: risky, lostNames: lostNames, notes: notes, status: status, enriched: enrichedBy[norm(rl.original || '')] || [] };
    });
    return {
      source: source, target: target,
      edits: edits,
      skippedEdits: edits.filter(function (e) { return e.crossesParagraph || e.occurrence < 0; }).length,
      references: { paraIndexes: stUse.refs.map(function (r) { return r.paraIndex; }), lines: lines, detachList: target === 'apa7', keepListNumbering: useListNumbering,
        flagParaIndexes: failed.map(function (f) { return f.paraIndex; }) },
      failedRefs: failed, unmatched: unmatched, notes: out.referenceIssues || [],
      counts: {
        total: st.refs.length, converted: lines.filter(function (l) { return l.status === 'ok'; }).length,
        review: lines.filter(function (l) { return l.status === 'review'; }).length,
        risky: lines.filter(function (l) { return l.status === 'risky'; }).length, failed: failed.length
      },
      changedCount: out.changedCount, totalCitations: out.totalCitationsFound, uncitedCount: out.uncitedCount,
      mixedFixed: out.mixedStyleFixedCount, mixedUnresolved: out.mixedStyleUnresolvedCount
    };
  }

  // Nama penulis (kata berhuruf kapital sebelum judul) yang hilang setelah konversi →
  // tanda entri gagal dibaca dengan benar; entri seperti itu tidak boleh ditulis ulang otomatis.
  function lostAuthorTokens(original, converted, title) {
    var src = String(original || '').replace(LABEL_RE, '');
    var cut = title ? src.indexOf(title) : -1;
    if (cut < 0) { var y = src.search(/\(\d{4}|["“]/); cut = y > 0 ? y : Math.min(src.length, 80); }
    var scope = src.slice(0, cut);
    var names = scope.match(/\p{Lu}[\p{Ll}'’-]{1,}/gu) || [];
    var conv = String(converted || '');
    var months = /^(?:January|February|March|April|May|June|July|August|September|October|November|December|Januari|Februari|Maret|Mei|Juni|Juli|Agustus|Oktober|Desember|Spring|Summer|Fall|Autumn|Winter)$/;
    names = names.map(function (n) { return n.replace(/-$/, ''); }).filter(function (n) { return n.length > 1 && !/^(?:And|Dan|Et|Eds?|Ed)$/.test(n) && !months.test(n); });
    // IEEE menyingkat >6 penulis menjadi "Penulis pertama et al." — nama sisanya memang tidak
    // ditulis, jadi hanya penulis pertama yang wajib ada.
    if (/\bet al\./.test(conv) && names.length) names = names.slice(0, 1);
    return names.filter(function (n) { return conv.indexOf(n) < 0; });
  }

  // ---------- CROSSREF: PENCARIAN & VERIFIKASI ----------
  var CROSSREF = 'https://api.crossref.org/works';
  // "AI & SOCIETY" (gaya kapital CrossRef) → "AI & Society"; singkatan pendek tetap kapital.
  function tidyCaps(s) {
    if (!s || s !== s.toUpperCase() || !/[A-Z]{4,}/.test(s)) return s;
    var small = /^(?:of|the|and|in|on|for|to|a|an|at|by|with|de|du|des|la|le|di|dan|und|für)$/;
    var acronyms = /^(?:AI|IEEE|ACM|IET|IEE|SIAM|PLOS|ACS|IOP|SPIE|AAAI|BMC|NPJ|ISPRS|IFAC|ASME|ASCE|AIP|APS|RSC|SAE|MDPI|USA|UK|EU|ICT|IT|IOT|ML|NLP|HCI|STEM)$/;
    return s.split(/(\s+)/).map(function (w, i) {
      if (/^\s+$/.test(w) || /^[^A-Za-z]+$/.test(w)) return w;
      var core = w.replace(/[^A-Za-z]/g, '');
      if (acronyms.test(core)) return w;
      var lw = w.toLowerCase();
      return i > 0 && small.test(lw) ? lw : lw.charAt(0).toUpperCase() + lw.slice(1);
    }).join('');
  }
  function stripTags(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
  function initialsOf(given) {
    return String(given || '').split(/\s+/).filter(Boolean).map(function (part) {
      return part.split('-').map(function (p) { var c = p.replace(/[^\p{L}]/gu, ''); return c ? c[0].toUpperCase() + '.' : ''; }).filter(Boolean).join('-');
    }).filter(Boolean).join(' ');
  }
  function crYear(item) {
    var d = item.issued || item['published-print'] || item['published-online'] || item.published || item.created;
    return d && d['date-parts'] && d['date-parts'][0] && d['date-parts'][0][0] ? String(d['date-parts'][0][0]) : null;
  }
  function apaAuthors(list) {
    var a = (list || []).filter(function (x) { return x.family || x.name; }).map(function (x) {
      if (!x.family) return x.name;
      var ini = initialsOf(x.given);
      return x.family + (ini ? ', ' + ini : '');
    });
    if (!a.length) return '';
    if (a.length === 1) return a[0];
    if (a.length <= 20) return a.slice(0, -1).join(', ') + ', & ' + a[a.length - 1];
    return a.slice(0, 19).join(', ') + ', . . . ' + a[a.length - 1];
  }
  // Menyusun entri APA 7 dari metadata CrossRef (dipakai juga sebagai bahan konversi ke IEEE).
  function crossrefToApaLine(item) {
    var authors = apaAuthors(item.author);
    var editors = (item.editor || []).map(function (x) { var ini = initialsOf(x.given); return (ini ? ini + ' ' : '') + (x.family || x.name || ''); }).filter(Boolean);
    var year = crYear(item) || 'n.d.';
    var title = stripTags(item.title && item.title[0]);
    var container = tidyCaps(stripTags(item['container-title'] && item['container-title'][0]));
    var pages = item.page ? String(item.page).replace(/-/g, '–') : null;
    var doi = item.DOI ? 'https://doi.org/' + item.DOI : (item.URL || '');
    var type = item.type || '';
    var head = (authors || title) + ' (' + year + '). ';
    var body;
    if (/^book$|monograph|edited-book/.test(type)) {
      body = (authors ? title + '. ' : '') + (item.publisher ? stripTags(item.publisher) + '.' : '');
    } else if (/book-chapter|proceedings-article|book-section|reference-entry/.test(type)) {
      body = (authors ? title + '. ' : '') + 'In ' + (editors.length ? (editors.length > 2 ? editors.slice(0, -1).join(', ') + ', & ' + editors[editors.length - 1] : editors.join(' & ')) + (editors.length > 1 ? ' (Eds.), ' : ' (Ed.), ') : '') +
        (container || '') + (pages ? ' (pp. ' + pages + ')' : '') + '.' + (item.publisher ? ' ' + stripTags(item.publisher) + '.' : '');
    } else {
      body = (authors ? title + '. ' : '') + (container || '') + (item.volume ? ', ' + item.volume + (item.issue ? '(' + item.issue + ')' : '') : '') +
        (pages ? ', ' + pages : (item['article-number'] ? ', Article ' + item['article-number'] : '')) + '.';
    }
    return (head + body + (doi ? ' ' + doi : '')).replace(/\s+/g, ' ').replace(/\.\./g, '.').trim();
  }
  // Entri siap-sisip dalam gaya target (runs bercetak miring) dari item CrossRef.
  function formatCrossrefReference(item, styleId, number) {
    var apaLine = crossrefToApaLine(item);
    try {
      var out = CC.convert('', apaLine, 'apa7', styleId, {});
      var rl = out.referenceLines[0];
      if (rl) {
        var runs = relabelRuns(rl.runs || [{ text: rl.line, italic: false }], styleId === 'ieee' ? '[' + (number || 1) + '] ' : '');
        return { text: runsText(runs), runs: runs, apaLine: apaLine };
      }
    } catch (e) { /* jatuh ke teks polos */ }
    return { text: apaLine, runs: [{ text: apaLine, italic: false }], apaLine: apaLine };
  }

  function fetchJson(url, fetchImpl) {
    var f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return Promise.reject(new Error('fetch tidak tersedia'));
    return f(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (r.status === 404) return { notFound: true };
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function firstSurname(ref, styleId) {
    var m = ref.bibliographicModel;
    if (m && m.authors && m.authors[0] && m.authors[0].last) return m.authors[0].last;
    return ref.firstAuthor ? CE.surnameOf(ref.firstAuthor, styleId) : '';
  }

  // ---- pembanding toleran (CrossRef vs naskah) ----
  function foldText(s) {
    return stripTags(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  }
  function mainTitle(s) { return stripTags(s).split(/\s*[:?!]\s+|\.\s+/)[0]; }
  function titlesAgree(a, b) {
    var x = foldText(a), y = foldText(b);
    if (!x || !y || x === y) return true;
    if (x.indexOf(y) >= 0 || y.indexOf(x) >= 0) return true;
    var mx = foldText(mainTitle(a)), my = foldText(mainTitle(b));
    if (mx && my && (mx === my || (mx.length > 20 && (x.indexOf(my) === 0 || y.indexOf(mx) === 0)))) return true;
    return CE.bigramSimilarity(x, y) >= 0.75;
  }
  function crYears(item) {
    var out = [];
    ['issued', 'published-print', 'published-online', 'published', 'posted', 'accepted'].forEach(function (k) {
      var d = item[k]; var y = d && d['date-parts'] && d['date-parts'][0] && d['date-parts'][0][0];
      if (y && out.indexOf(String(y)) < 0) out.push(String(y));
    });
    if (item['journal-issue'] && item['journal-issue']['published-print']) {
      var jy = item['journal-issue']['published-print']['date-parts'][0][0]; if (jy && out.indexOf(String(jy)) < 0) out.push(String(jy));
    }
    return out;
  }
  // Toleransi ±1 tahun: terbit daring lebih dulu (online-first) lalu cetak di tahun berikutnya.
  function yearAgrees(refYear, years) {
    var y = parseInt(String(refYear || '').slice(0, 4), 10);
    if (!y || !years.length) return true;
    return years.some(function (c) { return Math.abs(+c - y) <= 1; });
  }
  function authorAgrees(surname, item) {
    var me = foldText(surname);
    var list = (item.author || []).map(function (a) { return foldText(a.family || a.name || ''); }).filter(Boolean);
    if (!me || !list.length) return true;
    return list.some(function (f) { return f === me || f.indexOf(me) >= 0 || me.indexOf(f) >= 0 || CE.bigramSimilarity(f, me) >= 0.75; });
  }

  // Verifikasi satu referensi: DOI → cek metadata; tanpa DOI → cari kandidat DOI.
  function verifyReference(st, styleId, ref, fetchImpl) {
    var idx = refIndexOfRaw(st, ref.raw);
    if (idx < 0) return Promise.resolve(null);
    var r = st.refs[idx];
    var base = { refIndex: idx, paraIndex: r.paraIndex, category: 'online', original: r.line, offset: r.leading, length: Math.max(1, r.text.trim().length) };
    var title = (ref.bibliographicModel && ref.bibliographicModel.title) || ref.title || '';
    function result(extra) { var o = {}; Object.keys(base).forEach(function (k) { o[k] = base[k]; }); Object.keys(extra).forEach(function (k) { o[k] = extra[k]; }); o.key = makeKey(['online', idx, extra.kind, extra.title]); o.id = 'o' + idx + extra.kind; return o; }

    if (ref.doi) {
      return fetchJson(CROSSREF + '/' + encodeURIComponent(ref.doi), fetchImpl).then(function (json) {
        if (json.notFound || !json.message || !(json.message.DOI || json.message.title)) {
          return result({ kind: 'info', severity: 'suggestion', title: 'DOI tidak terdaftar di CrossRef',
            description: 'DOI "' + ref.doi + '" tidak ada di CrossRef. Bisa jadi salah ketik, atau DOI-nya terdaftar di agensi lain (mis. DataCite) sehingga tetap valid. Klik "Buka DOI" untuk memastikan.',
            link: 'https://doi.org/' + ref.doi, canApply: false });
        }
        var item = json.message, crT = stripTags(item.title && item.title[0]);
        var titleOk = titlesAgree(title, crT);
        var authorOk = authorAgrees(firstSurname(ref, styleId), item);
        var yearOk = yearAgrees(ref.year, crYears(item));
        var crFirst = item.author && item.author[0] ? (item.author[0].family || item.author[0].name || '') : '';
        // CrossRef BUKAN acuan kebenaran: data di situs penerbit bisa sudah diperbarui
        // (judul, tahun cetak vs online, kapitalisasi). Hanya ketidakcocokan besar — DOI yang
        // tampaknya milik karya lain — yang dilaporkan, dan tidak pernah ditimpa otomatis.
        if (!titleOk && !authorOk) {
          return result({ kind: 'info', severity: 'error', title: 'DOI tampaknya milik karya lain',
            description: 'Di CrossRef, DOI ini tercatat untuk "' + crT + '"' + (crFirst ? ' (' + crFirst + (crYears(item)[0] ? ', ' + crYears(item)[0] : '') + ')' : '') + ', bukan "' + title + '". Periksa apakah DOI tertukar dengan referensi lain.',
            link: 'https://doi.org/' + ref.doi, canApply: false });
        }
        if (titleOk && authorOk && yearOk) return result({ kind: 'verified', severity: 'ok', title: 'DOI terverifikasi', description: 'Cocok dengan CrossRef.', canApply: false, link: 'https://doi.org/' + ref.doi });
        var diffs = [];
        if (!titleOk) diffs.push('judul (CrossRef: "' + crT + '")');
        if (!authorOk) diffs.push('penulis pertama (CrossRef: ' + crFirst + ')');
        if (!yearOk) diffs.push('tahun (CrossRef: ' + crYears(item).join('/') + ')');
        return result({ kind: 'info', severity: 'suggestion', quiet: true, verifiedLike: true, title: 'Sedikit berbeda dengan CrossRef',
          description: 'DOI cocok dengan karya ini, tetapi ' + diffs.join('; ') + ' berbeda. Ini sering terjadi (judul diperbarui, tahun online vs cetak). Tidak perlu diubah bila sudah sesuai dengan situs penerbit.',
          link: 'https://doi.org/' + ref.doi, canApply: false });
      });
    }
    var expectsDoi = !(CE.DOI_NOT_EXPECTED_TYPES && CE.DOI_NOT_EXPECTED_TYPES[ref.sourceType]);
    if (!title || !expectsDoi) return Promise.resolve(null);
    var q = [title, firstSurname(ref, styleId), ref.year].filter(Boolean).join(' ');
    return fetchJson(CROSSREF + '?rows=5&query.bibliographic=' + encodeURIComponent(q), fetchImpl).then(function (json) {
      var items = (json && json.message && json.message.items) || [];
      var best = null;
      items.forEach(function (it) {
        if (!it.DOI) return;
        var t = stripTags(it.title && it.title[0]);
        var tOk = titlesAgree(title, t), aOk = authorAgrees(firstSurname(ref, styleId), it), yOk = yearAgrees(ref.year, crYears(it));
        var score = (tOk ? 60 : Math.round(CE.bigramSimilarity(foldText(title), foldText(t)) * 40)) + (aOk ? 25 : 0) + (yOk ? 15 : 0);
        if (!best || score > best.score) best = { item: it, score: score, title: t, year: crYears(it)[0], sure: tOk && aOk && yOk };
      });
      if (!best || best.score < 70) return result({ kind: 'info', severity: 'suggestion', quiet: true, title: 'DOI tidak ditemukan', description: 'Pencarian CrossRef tidak menemukan padanan yang meyakinkan untuk "' + title + '". Bila sumber memang punya DOI, tambahkan manual.', canApply: false, searchUrl: 'https://search.crossref.org/?q=' + encodeURIComponent(q) });
      var doi = best.item.DOI;
      var append = styleId === 'apa7' ? ' https://doi.org/' + doi : ', doi: ' + doi + '.';
      var current = r.text.replace(/\s+$/, '');
      var newText = styleId === 'apa7' ? current + append : current.replace(/\.$/, '') + append;
      return result({ kind: 'append', severity: best.sure ? 'suggestion' : 'info', quiet: !best.sure,
        title: best.sure ? 'DOI ditemukan via CrossRef' : 'Kandidat DOI (perlu dicek)',
        description: (best.sure ? 'Judul, penulis, dan tahun cocok' : 'Kecocokan belum pasti') + ' dengan "' + best.title + '"' + (best.year ? ' (' + best.year + ')' : '') + '. DOI: ' + doi + '. Klik "Buka DOI" untuk memastikan di situs penerbit sebelum menambahkan.',
        appendText: append, stripTrailingPeriod: styleId === 'ieee' && /\.$/.test(current),
        replacement: newText, compareOriginal: current, canApply: true, actionLabel: 'Tambahkan DOI', link: 'https://doi.org/' + doi, score: best.score });
    });
  }

  // ================= METADATA (setara tab DOI/Scopus/Tahun di cek-sitasi web) =================
  // Status DOI: valid | minor | mismatch | notfound | nodoi | notexpected | error
  function refLabel(ref) { return (ref.firstAuthor || '-') + (ref.year ? ' (' + ref.year + ')' : ''); }
  function doiTextIn(text, doi) {
    if (!doi) return null;
    var lower = text.toLowerCase(), i = lower.indexOf(String(doi).toLowerCase());
    return i < 0 ? null : { offset: i, text: text.substr(i, doi.length) };
  }

  function checkMetadata(st, styleId, ref, fetchImpl) {
    var idx = refIndexOfRaw(st, ref.raw);
    if (idx < 0) return Promise.resolve(null);
    var r = st.refs[idx];
    var title = (ref.bibliographicModel && ref.bibliographicModel.title) || ref.title || '';
    var base = { refIndex: idx, paraIndex: r.paraIndex, label: refLabel(ref), title: title, doi: ref.doi || null, year: ref.year || null, sourceType: ref.sourceType, raw: r.line };
    function out(extra) { return Object.assign({}, base, extra); }
    if (!ref.doi) {
      var expects = !(CE.DOI_NOT_EXPECTED_TYPES && CE.DOI_NOT_EXPECTED_TYPES[ref.sourceType]);
      return Promise.resolve(out(expects
        ? { status: 'nodoi', note: 'Tidak ada DOI. Artikel/prosiding biasanya punya DOI — gunakan "Cari DOI".' }
        : { status: 'notexpected', note: 'Jenis sumber ini (' + (ref.sourceType || 'lainnya') + ') umumnya memang tanpa DOI.' }));
    }
    return fetchJson(CROSSREF + '/' + encodeURIComponent(ref.doi), fetchImpl).then(function (json) {
      if (json.notFound || !json.message || !(json.message.DOI || json.message.title)) {
        return out({ status: 'notfound', link: 'https://doi.org/' + ref.doi,
          note: 'DOI tidak ada di CrossRef. Bisa salah ketik, atau terdaftar di agensi lain (mis. DataCite) sehingga tetap valid — klik "Buka DOI" untuk memastikan, atau "Cari DOI yang benar".' });
      }
      var item = json.message, crT = stripTags(item.title && item.title[0]), years = crYears(item);
      var crFirst = item.author && item.author[0] ? (item.author[0].family || item.author[0].name || '') + (item.author[0].given ? ', ' + item.author[0].given : '') : '';
      var tOk = titlesAgree(title, crT), aOk = ref.isInstitutional ? true : authorAgrees(firstSurname(ref, styleId), item), yOk = yearAgrees(ref.year, years);
      var exactYear = !ref.year || !years.length || years.indexOf(String(ref.year).slice(0, 4)) >= 0;
      var fields = [
        { field: 'Judul', naskah: title, crossref: crT, ok: tOk },
        { field: 'Penulis pertama', naskah: ref.firstAuthor || '', crossref: crFirst, ok: aOk },
        { field: 'Tahun', naskah: ref.year || '', crossref: years.join(' / '), ok: yOk, note: yOk && !exactYear ? 'Selisih 1 tahun — biasanya terbit daring vs cetak.' : null }
      ];
      var container = stripTags(item['container-title'] && item['container-title'][0]);
      if (container) fields.push({ field: 'Jurnal / sumber', naskah: ref.journal || '', crossref: tidyCaps(container), ok: true, info: true });
      var status = !tOk && !aOk ? 'mismatch' : (tOk && aOk && yOk ? 'valid' : 'minor');
      var note = status === 'valid' ? 'DOI terverifikasi dan cocok dengan CrossRef.'
        : status === 'minor' ? 'DOI cocok dengan karya ini, tetapi ada detail yang berbeda. Sering terjadi (judul diperbarui, tahun daring vs cetak) — tidak perlu diubah bila sudah sesuai situs penerbit.'
        : 'Judul dan penulis berbeda: DOI ini tampaknya milik karya lain. Periksa apakah DOI tertukar, atau gunakan "Cari DOI yang benar".';
      return out({ status: status, fields: fields, note: note, link: 'https://doi.org/' + ref.doi });
    }).catch(function (e) {
      return out({ status: 'error', note: 'Tidak bisa menghubungi CrossRef (' + (e && e.message || 'jaringan') + ').', link: 'https://doi.org/' + ref.doi });
    });
  }

  // Kandidat DOI dari CrossRef, diberi skor & tanda "pasti" (judul+penulis+tahun cocok).
  function searchDoiCandidates(ref, styleId, fetchImpl) {
    var title = (ref.bibliographicModel && ref.bibliographicModel.title) || ref.title || '';
    var surname = firstSurname(ref, styleId);
    var q = [title, surname, ref.year].filter(Boolean).join(' ');
    if (!q.trim()) return Promise.resolve([]);
    return fetchJson(CROSSREF + '?rows=6&query.bibliographic=' + encodeURIComponent(q), fetchImpl).then(function (json) {
      var items = (json && json.message && json.message.items) || [];
      return items.filter(function (it) { return it.DOI && String(it.DOI).toLowerCase() !== String(ref.doi || '').toLowerCase(); }).map(function (it) {
        var t = stripTags(it.title && it.title[0]);
        var tOk = titlesAgree(title, t), aOk = authorAgrees(surname, it), yOk = yearAgrees(ref.year, crYears(it));
        var score = (tOk ? 60 : Math.round(CE.bigramSimilarity(foldText(title), foldText(t)) * 40)) + (aOk ? 25 : 0) + (yOk ? 15 : 0);
        return { doi: it.DOI, title: t, year: crYears(it)[0] || '', score: score, sure: tOk && aOk && yOk,
          authors: (it.author || []).slice(0, 3).map(function (a) { return a.family || a.name; }).join(', ') + ((it.author || []).length > 3 ? ' dkk.' : ''),
          container: tidyCaps(stripTags(it['container-title'] && it['container-title'][0])) };
      }).sort(function (a, b) { return b.score - a.score; }).slice(0, 5);
    });
  }

  // Suntingan untuk memakai DOI pilihan: ganti DOI lama, atau tambahkan di akhir entri.
  function doiEdit(st, styleId, rec, newDoi) {
    var r = st.refs[rec.refIndex];
    if (!r) return null;
    var found = rec.doi ? doiTextIn(r.text, rec.doi) : null;
    if (found) {
      return { kind: 'replace', paraIndex: r.paraIndex, offset: found.offset, length: found.text.length, original: found.text, replacement: newDoi,
        occurrence: occurrenceIndex(r.text, found.text, found.offset, false) };
    }
    var current = r.text.replace(/\s+$/, '');
    var append = styleId === 'apa7' ? ' https://doi.org/' + newDoi : ', doi: ' + newDoi + '.';
    return { kind: 'append', paraIndex: r.paraIndex, appendText: append, stripTrailingPeriod: styleId === 'ieee' && /\.$/.test(current),
      original: r.line, compareOriginal: current };
  }

  // Status Scopus memakai scopus-engine.js versi web apa adanya.
  // Nama jurnal di naskah sering berbeda tipis dari Scopus Source List: "The …", "&" vs "and",
  // subjudul, atau nama lama yang lebih panjang. Varian dicoba berurutan sebelum menyerah.
  function journalVariants(name) {
    var out = [];
    function add(v) { v = String(v || '').replace(/[.\s]+$/, '').trim(); if (v && out.indexOf(v) < 0) out.push(v); }
    add(name);
    add(String(name || '').replace(/^the\s+/i, ''));
    add(String(name || '').replace(/\s*&\s*/g, ' and '));
    add(String(name || '').replace(/^the\s+/i, '').replace(/\s*&\s*/g, ' and '));
    add(String(name || '').split(/\s*:\s*/)[0]);
    return out;
  }
  function findSource(db, name) {
    var vs = journalVariants(name);
    for (var i = 0; i < vs.length; i++) if (db.findBySourceTitle(vs[i])) return vs[i];
    // Prefiks terpanjang (≥ 3 kata): "Administration and Policy in Mental Health and Mental
    // Health Services Research" → "Administration and Policy in Mental Health".
    var key = CE.normalizeTitle(vs[vs.length > 3 ? 3 : vs.length - 1] || name);
    if (!db._prefixKeys) db._prefixKeys = Object.keys(db.bySourceTitle || {}).filter(function (k) { return k.split(' ').length >= 3; });
    var best = null;
    db._prefixKeys.forEach(function (k) { if (key.indexOf(k + ' ') === 0 && (!best || k.length > best.length)) best = k; });
    return best ? db.bySourceTitle[best].title : null;
  }
  function scopusStatuses(references, db, matcher) {
    var SM = matcher || (isNode ? null : root.ScopusMatcher);
    if (!SM || !db) return null;
    return references.map(function (ref) {
      var m = ref.bibliographicModel || {};
      var probe = Object.assign({}, ref, { title: m.title || ref.title, journal: m.journal || ref.journal });
      if (probe.journal && !db.findBySourceTitle(probe.journal)) { var hit = findSource(db, probe.journal); if (hit) probe.journal = hit; }
      var res = SM.checkReference(probe, db);
      res.ref = ref;
      return res;
    });
  }

  // Rentang tahun (setara panel "Analisis Rentang Tahun Referensi" di web).
  function yearRange(references, lastYears, nowYear) {
    var to = nowYear || new Date().getFullYear(), from = to - (lastYears || 10) + 1;
    var res = CE.YearRange.compute(references, from, to);
    var known = res.inRange.length + res.outRange.length;
    return { from: from, to: to, inRange: res.inRange, outRange: res.outRange, unknown: res.unknown,
      percent: known ? Math.round(res.inRange.length / known * 100) : null };
  }

  // Cari kandidat referensi untuk sitasi yang belum ada di daftar (penulis + tahun + kata kunci).
  function searchCandidates(query, fetchImpl) {
    var q = query || {};
    var parts = ['rows=6'];
    if (q.author) parts.push('query.author=' + encodeURIComponent(q.author));
    if (q.keywords) parts.push('query.bibliographic=' + encodeURIComponent(q.keywords));
    if (q.year && /^\d{4}$/.test(q.year)) parts.push('filter=' + encodeURIComponent('from-pub-date:' + q.year + ',until-pub-date:' + q.year));
    return fetchJson(CROSSREF + '?' + parts.join('&'), fetchImpl).then(function (json) {
      return ((json && json.message && json.message.items) || []).map(function (it) {
        return { item: it, doi: it.DOI || null, title: stripTags(it.title && it.title[0]), year: crYear(it),
          authors: (it.author || []).slice(0, 3).map(function (a) { return a.family || a.name; }).join(', ') + ((it.author || []).length > 3 ? ' dkk.' : ''),
          container: stripTags(it['container-title'] && it['container-title'][0]) };
      });
    });
  }

  // Posisi sisip entri baru: APA → alfabetis; IEEE → paling akhir.
  function insertionPoint(st, styleId, newApaLine) {
    if (!st.refs.length) return { paraIndex: st.headingIndex, where: 'After' };
    if (styleId === 'ieee') return { paraIndex: st.refs[st.refs.length - 1].paraIndex, where: 'After', number: st.refs.length + 1 };
    var key = newApaLine.toLowerCase();
    for (var i = 0; i < st.refs.length; i++) {
      if (st.refs[i].line.toLowerCase().localeCompare(key) > 0) return { paraIndex: st.refs[i].paraIndex, where: 'Before' };
    }
    return { paraIndex: st.refs[st.refs.length - 1].paraIndex, where: 'After' };
  }

  // Metadata pengayaan untuk konversi: nama jurnal lengkap, DOI, dan penulis lengkap dari CrossRef.
  function buildEnrichmentMetadata(st, source, fetchImpl, onProgress) {
    var v = new CE.MultiFormatValidator(st.articleText, st.refText, source, {});
    var res = v.validate();
    var entries = [], done = 0, total = res.references.length;
    var chain = Promise.resolve();
    res.references.forEach(function (ref) {
      chain = chain.then(function () {
        var vr = BE.validateReference(ref, source, {});
        var model = vr.model;
        if (!model || !model.title) return;
        var p = ref.doi ? fetchJson(CROSSREF + '/' + encodeURIComponent(ref.doi), fetchImpl).then(function (j) { return j && j.message ? j.message : null; })
          : fetchJson(CROSSREF + '?rows=3&query.bibliographic=' + encodeURIComponent([model.title, firstSurname(ref, source), ref.year].filter(Boolean).join(' ')), fetchImpl).then(function (j) {
            var items = (j && j.message && j.message.items) || [];
            var hit = items.find(function (it) { return CE.bigramSimilarity(model.title, stripTags(it.title && it.title[0])) >= 0.9 && (!ref.year || crYear(it) === String(ref.year).slice(0, 4)); });
            return hit || null;
          });
        return p.then(function (item) {
          if (!item) return;
          var m = JSON.parse(JSON.stringify(model)), changed = false;
          var changes = [];
          var container = tidyCaps(stripTags(item['container-title'] && item['container-title'][0]));
          // Hanya melengkapi yang memang belum ada/masih singkatan — data naskah tidak ditimpa.
          if (container && /^(?:journal-article|conference|book-chapter)$/.test(m.type) && (!m.journal || /\.\s|\.$/.test(m.journal)) && foldText(container) !== foldText(m.journal)) { m.journal = container; changed = true; changes.push('nama lengkap jurnal/prosiding'); }
          if (!m.doi && item.DOI) { m.doi = item.DOI; changed = true; changes.push('DOI'); }
          if (!m.completeAuthors && item.author && item.author.length) {
            m.authors = item.author.filter(function (a) { return a.family; }).map(function (a) { return { last: a.family, given: initialsOf(a.given).split(' ').filter(Boolean), institutional: false }; });
            m.completeAuthors = true; m.ellipsis = false; m.authorCount = m.authors.length; changed = true; changes.push('daftar penulis lengkap');
          }
          if (!m.volume && item.volume) { m.volume = item.volume; changed = true; changes.push('volume'); }
          if (!m.issue && item.issue) { m.issue = item.issue; changed = true; changes.push('nomor terbitan'); }
          if (!m.pages && !m.articleNumber && item.page) { m.pages = String(item.page).replace(/-/g, '–'); changed = true; changes.push('halaman'); }
          var shortTitle = stripTags(item['short-container-title'] && item['short-container-title'][0]);
          if (shortTitle && /\./.test(shortTitle) && m.type === 'journal-article' && !m.journalAbbreviation) { m.journalAbbreviation = shortTitle; changed = true; changes.push('singkatan jurnal'); }
          if (changed) { m.schema = 2; entries.push({ line: BE.bindingLine(ref.raw), model: m, changes: changes }); }
        }).catch(function () { /* jaringan gagal: lewati entri ini */ });
      }).then(function () { done++; if (onProgress) onProgress(done, total); });
    });
    return chain.then(function () { return entries.length ? { version: 1, styleId: source, entries: entries } : null; });
  }

  var AddinCore = {
    SUPPORTED: SUPPORTED, structure: structure, detectStyle: detectStyle, validate: validate,
    planLinks: planLinks, planConversion: planConversion, verifyReference: verifyReference,
    searchCandidates: searchCandidates, formatCrossrefReference: formatCrossrefReference,
    checkMetadata: checkMetadata, searchDoiCandidates: searchDoiCandidates, doiEdit: doiEdit, scopusStatuses: scopusStatuses, yearRange: yearRange,
    crossrefToApaLine: crossrefToApaLine, unreadableReferences: unreadableReferences, titlesAgree: titlesAgree, tidyCaps: tidyCaps, insertionPoint: insertionPoint, buildEnrichmentMetadata: buildEnrichmentMetadata,
    wordDiff: wordDiff, describeChange: describeChange, occurrenceIndex: occurrenceIndex, locateArticleOffset: locateArticleOffset,
    relabelRuns: relabelRuns, lostTokens: lostTokens, refIndexOfRaw: refIndexOfRaw, norm: norm, bookmarkName: bookmarkName
  };
  if (isNode) module.exports = AddinCore;
  root.AddinCore = AddinCore;
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
