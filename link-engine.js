/* ============================================================
   LINK ENGINE — menautkan in-text citation ke entri referensinya
   di dalam file .docx, TANPA mengubah teks/format apa pun.

   Bergantung pada window.CitationEngine (lihat engine.js) untuk:
   - deteksi gaya sitasi (APA7/MLA9/Chicago/Harvard/IEEE/Vancouver)
   - parsing baris referensi -> {authors, firstAuthor, year, isInstitutional, numLabel, ...}
   - ekstraksi sitasi in-text -> extractAuthorDateCitations / extractNumericCitations

   Bagian yang KHUSUS untuk .docx (baca/tulis word/document.xml via JSZip+DOMParser,
   bookmarkStart/End, w:hyperlink internal via w:anchor) hidup di file ini saja, supaya
   engine.js tetap murni "teks masuk, data terstruktur keluar" dan tidak tahu apa-apa
   soal OOXML — sama seperti pemisahan yang sudah dipakai upload.js untuk highlight+comment.
   ============================================================ */
(function (global) {
  var CE = global.CitationEngine;
  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';

  var HEADING_RE = /(references|reference\s+list|bibliography|works\s+cited|literature\s+cited|daftar\s+pustaka|daftar\s+referensi|referensi)/i;

  // ---------- kunci pencocokan penulis(surname)+tahun, konsisten kedua sisi ----------
  // Sitasi in-text kadang ditulis "H. Zhang" (inisial + nama belakang) — bukan bagian dari
  // engine.js publik, jadi diimplementasikan ulang di sini (fungsi murni, ~8 baris, sama
  // persis logikanya dengan surnameFromCitationToken internal engine.js).
  function surnameFromCitationToken(token) {
    var s = (token || '').trim();
    if (!s) return '';
    var toks = s.split(/\s+/);
    if (toks.length === 1) return s;
    var leading = toks.slice(0, -1);
    var isInitial = function (t) { return /^\p{Lu}\.?$/u.test(t) || /^\p{Lu}{2,4}$/u.test(t); };
    if (leading.every(isInitial)) return toks[toks.length - 1];
    return s;
  }

  function keyOf(name, year, isInstitutional) {
    return CE.normalizeKeyName(name, !!isInstitutional) + '_' + String(year || '').replace(/[a-z]$/, '');
  }

  // ---------- baca semua paragraf top-level dari document.xml ----------
  function buildParagraphList(xmlDoc) {
    var pNodes = xmlDoc.getElementsByTagName('w:p');
    var paras = [];
    for (var i = 0; i < pNodes.length; i++) {
      var p = pNodes[i];
      var wts = p.getElementsByTagName('w:t');
      var text = '';
      for (var j = 0; j < wts.length; j++) text += wts[j].textContent;
      paras.push({ el: p, text: text });
    }
    return paras;
  }

  function findHeadingIndex(paras) {
    for (var i = 0; i < paras.length; i++) {
      var t = paras[i].text.trim();
      if (t.length > 0 && t.length <= 60 && HEADING_RE.test(t)) {
        var stripped = t.replace(/^[\dIVXLC]+[.)]\s*/i, '').replace(/[:.\s]+$/, '');
        if (HEADING_RE.test(stripped) && stripped.split(/\s+/).length <= 4) return i;
      }
    }
    return -1;
  }

  // ---------- run-splitting yang aman-format (pola sama seperti upload.js) ----------
  // PENTING: harus menelusuri SEMUA <w:r>, termasuk yang sudah bersarang di dalam
  // <w:hyperlink>/<w:ins>/<w:del> dsb. (lazim ada di naskah yang sitasinya dibuat lewat
  // Mendeley/Zotero/EndNote) — bukan cuma anak langsung <w:p>. Kalau tidak, posisi karakter
  // di sini akan "geser" dibanding teks-polos paragraf (yang dihitung dari SEMUA <w:t>
  // lewat getElementsByTagName di buildParagraphList), dan setiap sitasi SETELAH bagian
  // yang bersarang itu akan salah tautan atau gagal total.
  // Setiap info run juga menyimpan apakah dia "spliceable" — anak langsung <w:p> (aman
  // dipecah/disisipi w:hyperlink baru) atau bukan (sudah di dalam wrapper lain; menyisipkan
  // w:hyperlink baru di situ akan jadi hyperlink bersarang yang tidak valid di OOXML, jadi
  // match yang menyentuh run ini akan dilewati & dilaporkan, bukan dipaksakan).
  function getRunInfos(p) {
    var runNodes = p.getElementsByTagName('w:r');
    var text = '', infos = [];
    for (var i = 0; i < runNodes.length; i++) {
      var r = runNodes[i];
      var wts = r.getElementsByTagName('w:t');
      var t = '';
      for (var j = 0; j < wts.length; j++) t += wts[j].textContent;
      infos.push({ run: r, start: text.length, end: text.length + t.length, text: t, spliceable: r.parentNode === p });
      text += t;
    }
    return { text: text, infos: infos };
  }

  function createRun(xmlDoc, rPrEl, text) {
    var r = xmlDoc.createElementNS(W_NS, 'w:r');
    if (rPrEl) r.appendChild(rPrEl.cloneNode(true));
    var t = xmlDoc.createElementNS(W_NS, 'w:t');
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t.textContent = text;
    r.appendChild(t);
    return r;
  }

  // Opsional: mewarnai teks sitasi yang jadi link (mis. biru khas hyperlink), TANPA menyentuh
  // atribut format lain (bold/italic/font tetap seperti aslinya) — cukup timpa/ tambah <w:color>.
  // colorHex tanpa '#', mis. "0563C1" (biru default hyperlink Word).
  function applyColorToRun(xmlDoc, runEl, colorHex) {
    if (!colorHex) return;
    var rPrList = runEl.getElementsByTagName('w:rPr');
    var rPr;
    if (rPrList.length) rPr = rPrList[0];
    else { rPr = xmlDoc.createElementNS(W_NS, 'w:rPr'); runEl.insertBefore(rPr, runEl.firstChild); }
    var colorList = rPr.getElementsByTagName('w:color');
    var colorEl;
    if (colorList.length) colorEl = colorList[0];
    else { colorEl = xmlDoc.createElementNS(W_NS, 'w:color'); rPr.appendChild(colorEl); }
    colorEl.setAttributeNS(W_NS, 'w:val', colorHex.replace('#', ''));
  }

  // Membungkus rentang [s,e) teks paragraf dengan <w:hyperlink w:anchor="...">, memecah
  // hanya run yang tersentuh dan menjaga rPr asli tiap run — run lain tidak disentuh sama sekali.
  // colorHex (opsional) diterapkan HANYA ke run yang masuk hyperlink, bukan ke potongan
  // before/after di luar hyperlink — supaya cuma teks sitasinya yang berubah warna.
  function wrapWithHyperlink(xmlDoc, p, s, e, anchorName, colorHex) {
    var info = getRunInfos(p);
    var overlapping = info.infos.filter(function (inf) { return inf.end > s && inf.start < e; });
    if (overlapping.length === 0) return false;
    // Jangan pernah menyisipkan w:hyperlink baru bersarang di dalam wrapper yang sudah ada
    // (hyperlink lama, tracked-change, dst.) — itu OOXML tidak valid. Lewati saja match ini.
    if (overlapping.some(function (inf) { return !inf.spliceable; })) return false;

    var hl = xmlDoc.createElementNS(W_NS, 'w:hyperlink');
    hl.setAttributeNS(W_NS, 'w:anchor', anchorName);
    hl.setAttributeNS(W_NS, 'w:history', '1');

    var beforeRun = null, afterRun = null, matchRuns = [];
    overlapping.forEach(function (inf, idx) {
      var rPrList = inf.run.getElementsByTagName('w:rPr');
      var rPr = rPrList.length ? rPrList[0] : null;
      var localS = Math.max(s, inf.start) - inf.start;
      var localE = Math.min(e, inf.end) - inf.start;
      var beforeText = inf.text.slice(0, localS);
      var matchText = inf.text.slice(localS, localE);
      var afterText = inf.text.slice(localE);
      if (idx === 0 && beforeText) beforeRun = createRun(xmlDoc, rPr, beforeText);
      if (matchText) {
        var mRun = createRun(xmlDoc, rPr, matchText);
        applyColorToRun(xmlDoc, mRun, colorHex);
        matchRuns.push(mRun);
      }
      if (idx === overlapping.length - 1 && afterText) afterRun = createRun(xmlDoc, rPr, afterText);
    });
    matchRuns.forEach(function (r) { hl.appendChild(r); });

    var insertBefore = overlapping[0].run;
    if (beforeRun) p.insertBefore(beforeRun, insertBefore);
    p.insertBefore(hl, insertBefore);
    if (afterRun) p.insertBefore(afterRun, insertBefore);
    overlapping.forEach(function (inf) { p.removeChild(inf.run); });
    return true;
  }

  // Kalau referensi ini SUDAH punya bookmark (lazim di naskah yang sitasinya dibuat lewat
  // Mendeley/Zotero/EndNote — biasanya bernama seperti nama belakang penulis, mis. "Aini",
  // "Winarno2016", dst.), pakai ulang bookmark itu alih-alih bikin baru. Bookmark internal
  // Word sendiri (nama diawali "_", mis. "_Toc..."/"_heading=...") diabaikan.
  function findExistingBookmarkName(p) {
    var bms = p.getElementsByTagName('w:bookmarkStart');
    for (var i = 0; i < bms.length; i++) {
      var nm = bms[i].getAttribute('w:name');
      if (nm && nm.charAt(0) !== '_') return nm;
    }
    return null;
  }

  // Cari <w:hyperlink> pembungkus terdekat dari sebuah run (null kalau run itu anak langsung <w:p>
  // atau bersarang di wrapper lain yang bukan hyperlink, mis. tracked-change <w:ins>/<w:del>).
  function findWrapperHyperlink(runEl, p) {
    var node = runEl.parentNode;
    while (node && node !== p) {
      if (node.tagName === 'w:hyperlink') return node;
      node = node.parentNode;
    }
    return null;
  }

  // Menaut sebuah match [s,e) ke bookmarkName. Kasus nyata paling umum di naskah yang sitasinya
  // dibuat lewat Mendeley/Zotero/EndNote: HANYA SEBAGIAN teks sitasi (biasanya cuma tahunnya)
  // yang sudah dibungkus <w:hyperlink> lama, sisanya (nama penulis, tanda kurung) masih run polos
  // — jadi satu match sering "campur": sebagian spliceable, sebagian sudah di dalam hyperlink lain.
  // Match dipecah per-segmen berdasarkan wrapper-nya:
  //  - segmen run polos (anak langsung <w:p>)      -> dibungkus <w:hyperlink> BARU (jalur umum lama)
  //  - segmen yang sudah di dalam SATU <w:hyperlink> -> anchor hyperlink itu DIPERBAIKI di tempat
  //    (tidak perlu bongkar-pasang run sama sekali; kalau anchor-nya sudah benar, tidak disentuh)
  //  - segmen di dalam wrapper lain (tracked-change dst.) -> dilewati (tidak diubah)
  // Karena penambahan wrapper TIDAK PERNAH mengubah isi teks, posisi karakter [s,e) tetap valid
  // sepanjang proses ini walau dipanggil berkali-kali pada paragraf yang sama.
  function wrapOrRetarget(xmlDoc, p, s, e, bookmarkName, colorHex) {
    var info = getRunInfos(p);
    var overlapping = info.infos.filter(function (inf) { return inf.end > s && inf.start < e; });
    if (overlapping.length === 0) return { ok: false, mode: 'unsupported' };

    var groups = [];
    overlapping.forEach(function (inf) {
      var key = inf.spliceable ? 'SPLICE' : findWrapperHyperlink(inf.run, p);
      var last = groups[groups.length - 1];
      if (last && last.key === key) last.infos.push(inf);
      else groups.push({ key: key, infos: [inf] });
    });

    var anyOk = false, anyRetarget = false, anyFail = false;
    groups.forEach(function (g) {
      var segStart = Math.max(s, g.infos[0].start);
      var segEnd = Math.min(e, g.infos[g.infos.length - 1].end);
      if (g.key === 'SPLICE') {
        if (wrapWithHyperlink(xmlDoc, p, segStart, segEnd, bookmarkName, colorHex)) anyOk = true;
        else anyFail = true;
      } else if (g.key && g.key.tagName === 'w:hyperlink') {
        var already = g.key.getAttribute('w:anchor') === bookmarkName;
        if (!already) {
          g.key.setAttributeNS(W_NS, 'w:anchor', bookmarkName);
          g.key.setAttributeNS(W_NS, 'w:history', '1');
          anyRetarget = true;
        }
        if (colorHex) {
          var innerRuns = g.key.getElementsByTagName('w:r');
          for (var ri = 0; ri < innerRuns.length; ri++) applyColorToRun(xmlDoc, innerRuns[ri], colorHex);
        }
        anyOk = true;
      } else {
        anyFail = true; // wrapper selain hyperlink (tracked-change dst.) — dilewati apa adanya
      }
    });

    if (!anyOk) return { ok: false, mode: 'unsupported' };
    return { ok: true, mode: anyRetarget ? 'retargeted' : (anyFail ? 'partial' : 'new') };
  }

  function insertBookmark(xmlDoc, p, name, id) {
    var bmStart = xmlDoc.createElementNS(W_NS, 'w:bookmarkStart');
    bmStart.setAttributeNS(W_NS, 'w:id', String(id));
    bmStart.setAttributeNS(W_NS, 'w:name', name);
    var bmEnd = xmlDoc.createElementNS(W_NS, 'w:bookmarkEnd');
    bmEnd.setAttributeNS(W_NS, 'w:id', String(id));
    var pPrList = p.getElementsByTagName('w:pPr');
    var pPr = pPrList.length ? pPrList[0] : null;
    if (pPr && pPr.nextSibling) p.insertBefore(bmStart, pPr.nextSibling);
    else if (pPr) p.appendChild(bmStart);
    else if (p.firstChild) p.insertBefore(bmStart, p.firstChild);
    else p.appendChild(bmStart);
    p.appendChild(bmEnd);
  }

  // ---------- deteksi teks yang sudah di-highlight manual oleh pengguna ----------
  // Kalau pengguna sudah menandai (highlight warna apa saja, via tombol Highlight di Word)
  // sebagian dari sebuah sitasi — misalnya cuma tahunnya saja — maka link yang dibuat akan
  // dipersempit ke bagian yang di-highlight itu saja, bukan seluruh teks sitasi. Ini dibaca
  // langsung dari <w:highlight>/<w:shd> pada rPr tiap run, dengan pola baca atribut yang sama
  // seperti checkReferenceFormatting() di engine.js / upload.js (getAttribute('w:val') dsb.).
  function isRunHighlighted(runEl) {
    var rPrList = runEl.getElementsByTagName('w:rPr');
    if (!rPrList.length) return false;
    var rPr = rPrList[0];
    var hlList = rPr.getElementsByTagName('w:highlight');
    if (hlList.length) {
      var val = hlList[0].getAttribute('w:val');
      if (val && val.toLowerCase() !== 'none') return true;
    }
    var shdList = rPr.getElementsByTagName('w:shd');
    if (shdList.length) {
      var fill = shdList[0].getAttribute('w:fill');
      if (fill && fill.toLowerCase() !== 'auto' && fill.toLowerCase() !== 'ffffff') return true;
    }
    return false;
  }

  // Rentang [start,end) (koordinat teks-polos paragraf) yang di-highlight, digabung kalau
  // ada run highlighted yang bersebelahan (mis. highlight dipecah jadi 2 run karena alasan lain).
  function buildHighlightRanges(pEl) {
    var info = getRunInfos(pEl);
    var ranges = [];
    info.infos.forEach(function (inf) {
      if (!isRunHighlighted(inf.run) || !inf.text) return;
      var last = ranges[ranges.length - 1];
      if (last && last.end === inf.start) last.end = inf.end;
      else ranges.push({ start: inf.start, end: inf.end });
    });
    return ranges;
  }


  // ============================================================
  // MAIN: linkDocx(xmlDoc, options) -> mutasi xmlDoc in-place + laporan
  // options.linkScope         ('full' default | 'year') : pilih dari WEBSITE, tidak perlu
  //                                              highlight manual di Word — 'year' menautkan
  //                                              hanya token tahunnya, 'full' seluruh sitasi.
  // options.narrowToHighlight (default true)  : kalau sitasi punya bagian ter-highlight DI FILE
  //                                              WORD-nya sendiri, persempit link ke situ saja
  //                                              (diterapkan SETELAH linkScope, opsional/independen).
  // options.onlyHighlighted   (default false) : lewati sitasi yang SAMA SEKALI tidak
  //                                              punya highlight (untuk kontrol manual penuh).
  // options.linkColor         (default null)  : opsional — hex warna (mis. "0563C1", biru khas
  //                                              hyperlink) untuk teks sitasi yang ditautkan.
  //                                              null/kosong = format asli TIDAK diubah sama sekali.
  // ============================================================
  function linkDocx(xmlDoc, options) {
    options = options || {};
    var narrowToHighlight = options.narrowToHighlight !== false;
    var onlyHighlighted = !!options.onlyHighlighted;
    var linkScope = options.linkScope === 'year' ? 'year' : 'full'; // 'full' (default) | 'year'
    var linkColor = options.linkColor || null; // null = format asli tidak diubah; atau hex mis. "0563C1"

    var paras = buildParagraphList(xmlDoc);
    var headingIdx = findHeadingIndex(paras);
    if (headingIdx === -1) return { error: 'NO_HEADING' };

    var bodyParas = paras.slice(0, headingIdx);
    var refParas = paras.slice(headingIdx + 1);
    var highlightRangesByPara = bodyParas.map(function (p) { return buildHighlightRanges(p.el); });
    var docHasHighlight = highlightRangesByPara.some(function (r) { return r.length > 0; });

    var articleText = bodyParas.map(function (p) { return p.text; }).join('\n');
    var referenceText = refParas.map(function (p) { return p.text; }).join('\n');

    var styleId = options.styleId;
    var detected = null;
    if (!styleId || styleId === 'auto') {
      detected = CE.FormatDetector.detect(articleText, referenceText);
      styleId = detected.styleId;
    }
    var style = CE.STYLES[styleId];

    var parsed = CE.parseReferenceListDetailed(referenceText, styleId);

    var refIndex = {};   // key(surname/acronym + tahun) -> bookmarkName  (gaya penulis-tahun)
    var numIndex = {};   // nomor -> bookmarkName                         (gaya numerik)
    var bookmarkSeq = 5000;
    var refCount = 0;
    var ordinal = 0;

    parsed.references.forEach(function (ref) {
      var paraObj = refParas[ref.lineNumber - 1];
      if (!paraObj) return;
      ordinal++;
      refCount++;
      var bookmarkName = findExistingBookmarkName(paraObj.el);
      if (!bookmarkName) {
        var id = bookmarkSeq++;
        bookmarkName = 'ref_' + id;
        insertBookmark(xmlDoc, paraObj.el, bookmarkName, id);
      }

      if (style.family === 'numeric') {
        var label = ref.numLabel || ordinal;
        numIndex[label] = bookmarkName;
        return;
      }
      if (!ref.year || !ref.firstAuthor) return;
      var surname = ref.isInstitutional ? ref.firstAuthor : CE.surnameOf(ref.firstAuthor, styleId);
      var key = keyOf(surname, ref.year, ref.isInstitutional);
      if (!(key in refIndex)) refIndex[key] = bookmarkName;
      if (ref.isInstitutional) {
        var acr = CE.acronymOf(ref.firstAuthor);
        if (acr) {
          var akey = keyOf(acr, ref.year, false);
          if (!(akey in refIndex)) refIndex[akey] = bookmarkName;
        }
      }
    });

    // ---------- kumpulkan sitasi in-text, petakan posisi absolut -> (paragraf, offset) ----------
    function locate(pos) {
      var acc = 0;
      for (var i = 0; i < bodyParas.length; i++) {
        var len = bodyParas[i].text.length;
        if (pos <= acc + len) return { paraIndex: i, offset: pos - acc };
        acc += len + 1; // +1 untuk penyambung '\n'
      }
      return null;
    }

    var matchesByPara = {};
    var unmatched = [];
    function addMatch(startAbs, endAbs, bookmarkName, raw, yearText) {
      var a = locate(startAbs), b = locate(endAbs);
      if (!a || !b || a.paraIndex !== b.paraIndex) { unmatched.push(raw); return; }
      var pi = a.paraIndex;
      if (!matchesByPara[pi]) matchesByPara[pi] = [];
      matchesByPara[pi].push({ start: a.offset, end: b.offset, bookmarkName: bookmarkName, raw: raw, yearText: yearText || null });
    }

    if (style.family === 'numeric') {
      CE.extractNumericCitations(articleText).forEach(function (c) {
        var bm = null;
        for (var k = 0; k < c.numbers.length; k++) {
          if (numIndex[c.numbers[k]]) { bm = numIndex[c.numbers[k]]; break; }
        }
        addMatch(c.position, c.position + c.raw.length, bm, c.raw, null);
      });
    } else {
      CE.extractAuthorDateCitations(articleText).forEach(function (c) {
        if (c.type === 'parenthetical') {
          // raw = m[0] asli persis dari teks dokumen -> panjang akurat.
          // Kalau kurungnya berisi beberapa sitasi dipisah ';' (mis. "(Jones & Brown, 2019;
          // Aditya et al., 2021)"), setiap sitasi ditautkan ke referensinya SENDIRI-SENDIRI,
          // bukan cuma seluruh blok ke satu referensi pertama.
          var segments = c.content.split(';');
          if (segments.length === c.parts.length) {
            var offset = 0;
            segments.forEach(function (segText, idx) {
              var segStartAbs = c.position + 1 + offset; // +1 lompati '('
              var segEndAbs = segStartAbs + segText.length;
              offset += segText.length + 1; // +1 untuk ';'
              var part = c.parts[idx];
              var bmSeg = null;
              if (part && part.firstAuthor) {
                var keySeg = keyOf(surnameFromCitationToken(part.firstAuthor), part.year, false);
                bmSeg = refIndex[keySeg] || null;
              }
              // trim spasi di tepi segmen supaya link tidak "makan" spasi pemisah
              var leadWs = segText.match(/^\s*/)[0].length;
              var trailWs = segText.match(/\s*$/)[0].length;
              addMatch(segStartAbs + leadWs, segEndAbs - trailWs, bmSeg, segText.trim(), part ? part.year : null);
            });
          } else {
            // Bentuk tak umum (mis. sitasi tahun-ganda "Smith, 2019, 2021" dalam satu kurung)
            // — tautkan seluruh blok ke referensi pertama yang cocok, lebih aman daripada menebak.
            var bm = null, bmYear = null;
            for (var i = 0; i < c.parts.length; i++) {
              var part2 = c.parts[i];
              if (!part2.firstAuthor) continue;
              var key = keyOf(surnameFromCitationToken(part2.firstAuthor), part2.year, false);
              if (refIndex[key]) { bm = refIndex[key]; bmYear = part2.year; break; }
            }
            addMatch(c.position, c.position + c.raw.length, bm, c.raw, bmYear);
          }
        } else if (c.type === 'narrative') {
          // raw di sini direkonstruksi engine ("Penulis (Tahun)"), panjangnya bisa sedikit
          // beda dari teks asli (spasi/tanda baca) -> cari ulang batas akhir match yang
          // sesungguhnya: tahun selalu diikuti langsung oleh ',' atau ')' pada posisi itu.
          var firstTok = c.authors.split(/\s*(?:&|,|\band\b|\bdan\b|\bet\s+al\.?)\s*/i)[0];
          var key2 = keyOf(surnameFromCitationToken(firstTok), c.year, false);
          var bm2 = refIndex[key2] || null;
          var yearIdx = articleText.indexOf(c.year, c.position);
          var endAbs = yearIdx >= 0 ? yearIdx + c.year.length + 1 : c.position + c.raw.length;
          addMatch(c.position, endAbs, bm2, c.raw, c.year);
        }
      });
    }


    var linkedList = [];
    var narrowedCount = 0, skippedNotHighlighted = 0;
    var newCount = 0, retargetedCount = 0, alreadyCount = 0;
    Object.keys(matchesByPara).forEach(function (piStr) {
      var pi = parseInt(piStr, 10);
      var list = matchesByPara[pi];
      // buang tumpang-tindih (jaga-jaga) sebelum menyunting DOM
      list.sort(function (a, b) { return a.start - b.start; });
      var accepted = [];
      list.forEach(function (m) {
        var overlap = accepted.some(function (a) { return m.start < a.end && m.end > a.start; });
        if (!overlap) accepted.push(m);
      });

      var ranges = highlightRangesByPara[pi] || [];
      accepted.forEach(function (m) {
        if (!m.bookmarkName) return; // ditangani di bawah sebagai unmatched, penyempitan tidak relevan

        // Mode "hanya tahun" — dipilih langsung dari website, TIDAK butuh highlight manual di
        // Word sama sekali. Persempit dulu ke token tahun (kalau ketemu) sebelum highlight-narrowing.
        if (linkScope === 'year' && m.yearText) {
          var paraText = bodyParas[pi].text;
          var yIdx = paraText.indexOf(m.yearText, m.start);
          if (yIdx !== -1 && yIdx + m.yearText.length <= m.end) {
            m.start = yIdx; m.end = yIdx + m.yearText.length;
          }
        }

        var overlapRanges = ranges.filter(function (r) { return r.start < m.end && r.end > m.start; });
        if (overlapRanges.length) {
          if (narrowToHighlight) {
            var newStart = Math.max(m.start, Math.min.apply(null, overlapRanges.map(function (r) { return r.start; })));
            var newEnd = Math.min(m.end, Math.max.apply(null, overlapRanges.map(function (r) { return r.end; })));
            if (newStart < newEnd && (newStart !== m.start || newEnd !== m.end)) {
              narrowedCount++;
              m.start = newStart; m.end = newEnd;
            }
          }
        } else if (onlyHighlighted) {
          skippedNotHighlighted++;
          m.skip = true;
        }
      });

      // proses dari belakang supaya offset match sebelumnya tetap valid
      accepted.sort(function (a, b) { return b.start - a.start; });
      accepted.forEach(function (m) {
        if (m.skip) return;
        if (m.bookmarkName) {
          var r = wrapOrRetarget(xmlDoc, bodyParas[pi].el, m.start, m.end, m.bookmarkName, linkColor);
          if (r.ok) {
            linkedList.push(m.raw);
            if (r.mode === 'already') alreadyCount++;
            else if (r.mode === 'retargeted') retargetedCount++;
            else newCount++;
          } else {
            unmatched.push(m.raw + ' (struktur run tidak didukung — kemungkinan bagian dari hyperlink/format khusus lain)');
          }
        } else {
          unmatched.push(m.raw);
        }
      });
    });

    return {
      styleId: styleId,
      styleName: style.name,
      detected: detected,
      refCount: refCount,
      linked: linkedList.length,
      linkedList: linkedList,
      unmatched: unmatched,
      refParseFailed: parsed.failedLines,
      docHasHighlight: docHasHighlight,
      narrowedToHighlight: narrowedCount,
      skippedNotHighlighted: skippedNotHighlighted,
      newlyLinked: newCount,
      retargeted: retargetedCount,
      alreadyLinked: alreadyCount
    };
  }

  var CitationLinker = { linkDocx: linkDocx };
  if (typeof module !== 'undefined' && module.exports) module.exports = CitationLinker;
  if (typeof window !== 'undefined') window.CitationLinker = CitationLinker;
  else if (typeof self !== 'undefined') self.CitationLinker = CitationLinker;
})(typeof window !== 'undefined' ? window : this);
