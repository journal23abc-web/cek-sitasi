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
  function getRunInfos(p) {
    var runs = [];
    for (var c = p.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.tagName === 'w:r') runs.push(c);
    }
    var text = '', infos = [];
    runs.forEach(function (r) {
      var wts = r.getElementsByTagName('w:t');
      var t = '';
      for (var i = 0; i < wts.length; i++) t += wts[i].textContent;
      infos.push({ run: r, start: text.length, end: text.length + t.length, text: t });
      text += t;
    });
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

  // Membungkus rentang [s,e) teks paragraf dengan <w:hyperlink w:anchor="...">, memecah
  // hanya run yang tersentuh dan menjaga rPr asli tiap run — run lain tidak disentuh sama sekali.
  function wrapWithHyperlink(xmlDoc, p, s, e, anchorName) {
    var info = getRunInfos(p);
    var overlapping = info.infos.filter(function (inf) { return inf.end > s && inf.start < e; });
    if (overlapping.length === 0) return false;

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
      if (matchText) matchRuns.push(createRun(xmlDoc, rPr, matchText));
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

  // ============================================================
  // MAIN: linkDocx(xmlDoc, options) -> mutasi xmlDoc in-place + laporan
  // ============================================================
  function linkDocx(xmlDoc, options) {
    options = options || {};
    var paras = buildParagraphList(xmlDoc);
    var headingIdx = findHeadingIndex(paras);
    if (headingIdx === -1) return { error: 'NO_HEADING' };

    var bodyParas = paras.slice(0, headingIdx);
    var refParas = paras.slice(headingIdx + 1);

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
      var id = bookmarkSeq++;
      var bookmarkName = 'ref_' + id;
      insertBookmark(xmlDoc, paraObj.el, bookmarkName, id);

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
    function addMatch(startAbs, endAbs, bookmarkName, raw) {
      var a = locate(startAbs), b = locate(endAbs);
      if (!a || !b || a.paraIndex !== b.paraIndex) { unmatched.push(raw); return; }
      var pi = a.paraIndex;
      if (!matchesByPara[pi]) matchesByPara[pi] = [];
      matchesByPara[pi].push({ start: a.offset, end: b.offset, bookmarkName: bookmarkName, raw: raw });
    }

    if (style.family === 'numeric') {
      CE.extractNumericCitations(articleText).forEach(function (c) {
        var bm = null;
        for (var k = 0; k < c.numbers.length; k++) {
          if (numIndex[c.numbers[k]]) { bm = numIndex[c.numbers[k]]; break; }
        }
        addMatch(c.position, c.position + c.raw.length, bm, c.raw);
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
              addMatch(segStartAbs + leadWs, segEndAbs - trailWs, bmSeg, segText.trim());
            });
          } else {
            // Bentuk tak umum (mis. sitasi tahun-ganda "Smith, 2019, 2021" dalam satu kurung)
            // — tautkan seluruh blok ke referensi pertama yang cocok, lebih aman daripada menebak.
            var bm = null;
            for (var i = 0; i < c.parts.length; i++) {
              var part2 = c.parts[i];
              if (!part2.firstAuthor) continue;
              var key = keyOf(surnameFromCitationToken(part2.firstAuthor), part2.year, false);
              if (refIndex[key]) { bm = refIndex[key]; break; }
            }
            addMatch(c.position, c.position + c.raw.length, bm, c.raw);
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
          addMatch(c.position, endAbs, bm2, c.raw);
        }
      });
    }

    var linkedList = [];
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
      // proses dari belakang supaya offset match sebelumnya tetap valid
      accepted.sort(function (a, b) { return b.start - a.start; });
      accepted.forEach(function (m) {
        if (m.bookmarkName) {
          var ok = wrapWithHyperlink(xmlDoc, bodyParas[pi].el, m.start, m.end, m.bookmarkName);
          if (ok) linkedList.push(m.raw);
          else unmatched.push(m.raw + ' (struktur run tidak didukung)');
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
      refParseFailed: parsed.failedLines
    };
  }

  var CitationLinker = { linkDocx: linkDocx };
  if (typeof module !== 'undefined' && module.exports) module.exports = CitationLinker;
  if (typeof window !== 'undefined') window.CitationLinker = CitationLinker;
  else if (typeof self !== 'undefined') self.CitationLinker = CitationLinker;
})(typeof window !== 'undefined' ? window : this);
