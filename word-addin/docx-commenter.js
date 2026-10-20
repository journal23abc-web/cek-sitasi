/* ============================================================
   DOCX COMMENTER — "Salinan berkomentar": menulis laporan (sorotan + komentar Word asli)
   ke salinan .docx. Dipakai di Word 2016/2019 yang belum punya API komentar (WordApi 1.4),
   dan bila pengguna memilih agar naskah aslinya tidak diubah sama sekali.

   Diturunkan dari buildHighlightedOriginalDocx di cek-sitasi (upload.js), dengan tiga
   perbaikan penting:
     - komentar lama di naskah TIDAK ditimpa (comments.xml digabung, id dilanjutkan);
     - run dipecah dengan aman (tab, break, dan elemen lain dalam run tidak terduplikasi);
     - teks di dalam field Zotero/Mendeley/EndNote tidak pernah disentuh — lokasi komentar
       sudah dipindah keluar oleh ReportCore, dan setiap lokasi diverifikasi ulang di sini.

   items: hasil ReportCore.build(...).items (offset dalam teks paragraf Word).
   wordTexts: teks paragraf Word (WordBridge.readParagraphs) untuk memetakan paragraf.
   Murni (JSZip + DOMParser), tanpa Office.js.
   ============================================================ */
(function (root) {
  'use strict';
  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var XMLNS = 'http://www.w3.org/XML/1998/namespace';
  var HL = { Red: 'red', Yellow: 'yellow', Turquoise: 'cyan', Pink: 'magenta', BrightGreen: 'green' };

  function env(e) {
    e = e || {};
    var g = typeof window !== 'undefined' ? window : root;
    var CM = e.CitationManagers || g.CitationManagers || (typeof require === 'function' ? require('./citation-managers.js') : null);
    return { JSZip: e.JSZip || g.JSZip, DOMParser: e.DOMParser || g.DOMParser, XMLSerializer: e.XMLSerializer || g.XMLSerializer, CM: CM };
  }
  function kids(el) { var out = []; for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c); return out; }
  function isW(el, name) { return el && el.nodeType === 1 && el.namespaceURI === W && el.localName === name; }
  function key(t) { return String(t || '').replace(/[\s\u0000-\u001f\u00a0\u200b-\u200d\u2028\u2029\ufeff]+/g, ''); }

  // Paragraf badan dokumen dengan urutan yang sama seperti body.paragraphs di Word.
  function bodyParagraphs(xmlDoc) {
    var body = xmlDoc.getElementsByTagNameNS(W, 'body')[0];
    var out = [];
    (function walk(el) {
      kids(el).forEach(function (c) {
        if (isW(c, 'txbxContent') || (c.localName === 'Fallback')) return;
        if (isW(c, 'p')) { out.push(c); return; }
        walk(c);
      });
    })(body);
    return out;
  }

  // Indeks teks sebuah paragraf: setiap w:t (dan tab/break 1 karakter) dengan posisinya.
  // Kode field (antara fldChar begin–separate) dilewati, sama seperti teks paragraf di Word.
  function indexParagraph(p, fieldState) {
    var segs = [], text = '', st = fieldState || { depth: [] };
    function visible() { return st.depth.every(function (f) { return f === 'result'; }); }
    (function walk(el, run) {
      kids(el).forEach(function (c) {
        if (isW(c, 'txbxContent') || c.localName === 'Fallback' || isW(c, 'pPr') || isW(c, 'rPr') || isW(c, 'del') || isW(c, 'moveFrom')) return;
        if (isW(c, 'r')) { walk(c, c); return; }
        if (isW(c, 'fldChar')) {
          var t = c.getAttributeNS(W, 'fldCharType') || c.getAttribute('w:fldCharType');
          if (t === 'begin') st.depth.push('code'); else if (t === 'separate' && st.depth.length) st.depth[st.depth.length - 1] = 'result'; else if (t === 'end') st.depth.pop();
          return;
        }
        if (run && visible()) {
          if (isW(c, 't')) { var v = c.textContent || ''; if (v) { segs.push({ start: text.length, end: text.length + v.length, node: c, run: run, isText: true }); text += v; } return; }
          if (isW(c, 'tab')) { segs.push({ start: text.length, end: text.length + 1, node: c, run: run }); text += '\t'; return; }
          if (isW(c, 'br') || isW(c, 'cr')) { segs.push({ start: text.length, end: text.length + 1, node: c, run: run }); text += '\u000b'; return; }
          if (isW(c, 'noBreakHyphen')) { segs.push({ start: text.length, end: text.length + 1, node: c, run: run }); text += '-'; return; }
        }
        if (!run) walk(c, null);
      });
    })(p, null);
    return { text: text, segs: segs };
  }

  function hasContentBefore(run, node) {
    for (var c = node.previousSibling; c; c = c.previousSibling) if (c.nodeType === 1 && !isW(c, 'rPr')) return true;
    return false;
  }
  function hasContentAfter(node) {
    for (var c = node.nextSibling; c; c = c.nextSibling) if (c.nodeType === 1) return true;
    return false;
  }
  function preserve(t) { t.setAttributeNS(XMLNS, 'xml:space', 'preserve'); }

  // Run baru dengan format (rPr) yang sama; node `from` dan semua saudara sesudahnya dipindah.
  function moveTail(xmlDoc, run, from) {
    var nr = xmlDoc.createElementNS(W, 'w:r');
    kids(run).forEach(function (c) { if (isW(c, 'rPr')) nr.appendChild(c.cloneNode(true)); });
    var n = from;
    while (n) { var next = n.nextSibling; nr.appendChild(n); n = next; }
    run.parentNode.insertBefore(nr, run.nextSibling);
    return nr;
  }

  // Pastikan ada batas run tepat di posisi `pos` (teks paragraf).
  function splitAt(xmlDoc, p, pos) {
    var idx = indexParagraph(p);
    for (var i = 0; i < idx.segs.length; i++) {
      var s = idx.segs[i];
      if (pos > s.start && pos < s.end && s.isText) {
        var k = pos - s.start, t = s.node, v = t.textContent;
        var t2 = t.cloneNode(false); t2.textContent = v.slice(k); preserve(t2);
        t.textContent = v.slice(0, k); preserve(t);
        t.parentNode.insertBefore(t2, t.nextSibling);
        moveTail(xmlDoc, s.run, t2);
        return;
      }
      if (pos === s.start) { if (hasContentBefore(s.run, s.node)) moveTail(xmlDoc, s.run, s.node); return; }
    }
  }

  function setHighlight(xmlDoc, run, color) {
    var rPr = kids(run).filter(function (c) { return isW(c, 'rPr'); })[0];
    if (!rPr) { rPr = xmlDoc.createElementNS(W, 'w:rPr'); run.insertBefore(rPr, run.firstChild); }
    kids(rPr).forEach(function (c) { if (isW(c, 'highlight')) rPr.removeChild(c); });
    var hl = xmlDoc.createElementNS(W, 'w:highlight'); hl.setAttributeNS(W, 'w:val', color);
    // Urutan skema CT_RPr: highlight sesudah sz/szCs dan sebelum u/effect/... — letakkan
    // sebelum elemen yang memang harus sesudahnya.
    var AFTER = { u: 1, effect: 1, bdr: 1, shd: 1, fitText: 1, vertAlign: 1, rtl: 1, cs: 1, em: 1, lang: 1, eastAsianLayout: 1, specVanish: 1, oMath: 1, rPrChange: 1 };
    var ref = kids(rPr).filter(function (c) { return c.namespaceURI === W && AFTER[c.localName]; })[0] || null;
    rPr.insertBefore(hl, ref);
  }

  function annotate(xmlDoc, p, start, end, color, id) {
    splitAt(xmlDoc, p, end); splitAt(xmlDoc, p, start);
    var idx = indexParagraph(p), runs = [];
    idx.segs.forEach(function (s) { if (s.start >= start && s.end <= end && runs.indexOf(s.run) < 0) runs.push(s.run); });
    if (!runs.length) return false;
    if (color) runs.forEach(function (r) { setHighlight(xmlDoc, r, HL[color] || 'yellow'); });
    var first = runs[0], last = runs[runs.length - 1];
    var cs = xmlDoc.createElementNS(W, 'w:commentRangeStart'); cs.setAttributeNS(W, 'w:id', String(id));
    var ce = xmlDoc.createElementNS(W, 'w:commentRangeEnd'); ce.setAttributeNS(W, 'w:id', String(id));
    var rr = xmlDoc.createElementNS(W, 'w:r'), rp = xmlDoc.createElementNS(W, 'w:rPr'), rs = xmlDoc.createElementNS(W, 'w:rStyle');
    rs.setAttributeNS(W, 'w:val', 'CommentReference'); rp.appendChild(rs); rr.appendChild(rp);
    var cr = xmlDoc.createElementNS(W, 'w:commentReference'); cr.setAttributeNS(W, 'w:id', String(id)); rr.appendChild(cr);
    first.parentNode.insertBefore(cs, first);
    last.parentNode.insertBefore(ce, last.nextSibling);
    last.parentNode.insertBefore(rr, ce.nextSibling);
    return true;
  }

  function escapeXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function commentXml(c, date) {
    var paras = String(c.text).split(/\n/).map(function (line, i) {
      return '<w:p>' + (i === 0 ? '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' : '') +
        '<w:r><w:t xml:space="preserve">' + escapeXml(line) + '</w:t></w:r></w:p>';
    }).join('');
    return '<w:comment w:id="' + c.id + '" w:author="Cek Sitasi" w:initials="CS" w:date="' + date + '">' + paras + '</w:comment>';
  }

  function ensureParts(zip) {
    return Promise.all([zip.file('[Content_Types].xml').async('string'), zip.file('word/_rels/document.xml.rels') ? zip.file('word/_rels/document.xml.rels').async('string') : Promise.resolve(null)]).then(function (x) {
      var ct = x[0], rels = x[1] || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      if (!/PartName="\/word\/comments\.xml"/.test(ct)) {
        ct = ct.replace('</Types>', '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>');
        zip.file('[Content_Types].xml', ct);
      }
      if (!/relationships\/comments"/.test(rels)) {
        var ids = (rels.match(/Id="rId(\d+)"/g) || []).map(function (s) { return parseInt(s.replace(/\D/g, ''), 10); });
        var rid = 'rId' + ((ids.length ? Math.max.apply(null, ids) : 0) + 1);
        rels = rels.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>');
        zip.file('word/_rels/document.xml.rels', rels);
      }
    });
  }

  // Hasil: Promise<{ base64, added, failed }>
  function commentDocx(input, items, wordTexts, environment) {
    var E = env(environment);
    if (!E.JSZip) return Promise.reject(new Error('Pustaka JSZip belum dimuat.'));
    var zip, docXml, commentsXml;
    return E.JSZip.loadAsync(input).then(function (z) {
      zip = z;
      if (!zip.file('word/document.xml')) throw new Error('Paket DOCX tidak lengkap: word/document.xml tidak ditemukan.');
      return Promise.all([zip.file('word/document.xml').async('string'), zip.file('word/comments.xml') ? zip.file('word/comments.xml').async('string') : Promise.resolve(null)]);
    }).then(function (parts) {
      docXml = parts[0]; commentsXml = parts[1];
      var xmlDoc = new E.DOMParser().parseFromString(docXml, 'application/xml');
      if (xmlDoc.getElementsByTagName('parsererror').length) throw new Error('Gagal membaca XML dokumen.');
      var paras = bodyParagraphs(xmlDoc);
      // Teks setiap paragraf (status field dibawa antarparagraf, mis. daftar pustaka Zotero).
      var fs = { depth: [] };
      var texts = paras.map(function (p) { return indexParagraph(p, fs).text; });
      var texts2 = (wordTexts || []).map(function (t) { return typeof t === 'string' ? t : (t && t.text) || ''; });
      var align = E.CM ? E.CM.alignTexts(texts2, texts) : texts2.map(function (t, i) { return key(texts[i]) === key(t) ? i : -1; });

      var startId = 0;
      if (commentsXml) {
        var ids = (commentsXml.match(/<w:comment\b[^>]*\bw:id="(\d+)"/g) || []).map(function (s) { return parseInt(s.match(/w:id="(\d+)"/)[1], 10); });
        startId = ids.length ? Math.max.apply(null, ids) + 1 : 0;
      }
      var added = [], failed = 0, nextId = startId;
      // Dari belakang ke depan per paragraf supaya offset item sebelumnya tidak bergeser.
      items.slice().sort(function (a, b) { return (a.paraIndex - b.paraIndex) || (b.offset - a.offset); }).forEach(function (it) {
        var j = align[it.paraIndex];
        if (j == null || j < 0) { failed++; return; }
        var p = paras[j], idx = indexParagraph(p), start = it.offset, want = it.text || '';
        if (key(idx.text.substr(start, it.length)) !== key(want)) {
          // Teks sedikit berbeda (mis. pemisah tak terlihat): cari kemunculan terdekat.
          var best = -1, at = idx.text.indexOf(want);
          while (want && at >= 0) { if (best < 0 || Math.abs(at - start) < Math.abs(best - start)) best = at; at = idx.text.indexOf(want, at + 1); }
          if (best < 0) { failed++; return; }
          start = best;
        }
        var id = nextId++;
        if (annotate(xmlDoc, p, start, start + it.length, it.color, id)) added.push({ id: id, text: it.comment });
        else { failed++; nextId--; }
      });

      var ser = new E.XMLSerializer();
      var out = ser.serializeToString(xmlDoc.documentElement);
      if (!/^\s*<\?xml/i.test(out)) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + out;
      zip.file('word/document.xml', out);
      if (!added.length) return { added: 0, failed: failed };
      var date = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      var newXml = added.sort(function (a, b) { return a.id - b.id; }).map(function (c) { return commentXml(c, date); }).join('');
      if (commentsXml) zip.file('word/comments.xml', commentsXml.replace(/<\/w:comments>\s*$/, newXml + '</w:comments>'));
      else zip.file('word/comments.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:comments xmlns:w="' + W + '">' + newXml + '</w:comments>');
      return ensureParts(zip).then(function () { return { added: added.length, failed: failed }; });
    }).then(function (res) {
      return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' }).then(function (b64) { return { base64: b64, added: res.added, failed: res.failed }; });
    });
  }

  var api = { commentDocx: commentDocx, indexParagraph: indexParagraph, bodyParagraphs: bodyParagraphs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DocxCommenter = api;
})(typeof window !== 'undefined' ? window : this);
