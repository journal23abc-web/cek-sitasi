/* ============================================================
   DOCX LINKER — penautan lewat file .docx, memakai link-engine.js versi web apa adanya.

   Dipakai bila Word tidak bisa membuat bookmark lewat add-in (WordApi < 1.4), dan juga
   sebagai mode "lengkap" untuk semua versi Word: alurnya identik dengan halaman
   "Tautkan Sitasi" di cek-sitasi (link-upload.js) — sitasi ↔ referensi, URL/DOI referensi,
   perbaikan tautan eksternal, Figure/Table, field Zotero/Mendeley dipertahankan, dan
   pemeriksaan integritas OOXML sebelum hasil dipakai.

   Murni: tidak memanggil Office.js. Bisa diuji di Node (lihat test/docx-linker.test.js).
   ============================================================ */
(function (root) {
  'use strict';

  var DEFAULTS = {
    styleId: 'auto', linkScope: 'full', safeMode: true, preserveCitationControls: true,
    linkColor: null, narrowToHighlight: true, onlyHighlighted: false,
    linkReferenceUrls: true, repairExternalLinks: false, linkFiguresTables: false
  };

  function env(e) {
    e = e || {};
    var g = typeof window !== 'undefined' ? window : root;
    return {
      JSZip: e.JSZip || g.JSZip,
      DOMParser: e.DOMParser || g.DOMParser,
      XMLSerializer: e.XMLSerializer || g.XMLSerializer,
      CitationLinker: e.CitationLinker || g.CitationLinker
    };
  }

  // input: ArrayBuffer / Uint8Array berisi .docx. Hasil: { base64, result } — base64 siap
  // dibuka sebagai dokumen baru di Word (Word.Application.createDocument, WordApi 1.3).
  function linkDocxBuffer(input, options, environment) {
    var E = env(environment);
    if (!E.JSZip) return Promise.reject(new Error('Pustaka JSZip belum dimuat.'));
    if (!E.CitationLinker) return Promise.reject(new Error('Mesin tautan (link-engine.js) belum dimuat.'));
    var opt = {};
    Object.keys(DEFAULTS).forEach(function (k) { opt[k] = options && options[k] !== undefined ? options[k] : DEFAULTS[k]; });

    return E.JSZip.loadAsync(input).then(function (zip) {
      ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].forEach(function (part) {
        if (!zip.file(part)) throw new Error('Paket DOCX tidak lengkap: ' + part + ' tidak ditemukan.');
      });
      var relsFile = zip.file('word/_rels/document.xml.rels');
      return Promise.all([zip.file('word/document.xml').async('string'), relsFile ? relsFile.async('string') : Promise.resolve(null)])
        .then(function (parts) { return { zip: zip, xmlStr: parts[0], relsStr: parts[1] }; });
    }).then(function (bundle) {
      var xmlDoc = new E.DOMParser().parseFromString(bundle.xmlStr, 'application/xml');
      if (xmlDoc.getElementsByTagName('parsererror').length) throw new Error('Gagal membaca XML dokumen.');
      var relsStr = bundle.relsStr || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      var relsXmlDoc = new E.DOMParser().parseFromString(relsStr, 'application/xml');
      var linkOpts = Object.assign({}, opt, { relsXmlDoc: relsXmlDoc });
      var result = E.CitationLinker.linkDocx(xmlDoc, linkOpts);
      if (result.error === 'NO_HEADING') {
        throw new Error('Heading daftar pustaka tidak ditemukan. Pastikan ada paragraf tersendiri bertuliskan "References" / "Daftar Pustaka" sebelum daftar referensi.');
      }
      if (result.integrity && !result.integrity.ok) {
        throw new Error('Pemeriksaan integritas dokumen gagal (' + result.integrity.issues.join(', ') + '). Hasil dibatalkan agar naskah tetap aman.');
      }
      var ser = new E.XMLSerializer();
      bundle.zip.file('word/document.xml', ser.serializeToString(xmlDoc));
      if (result.urlsLinked > 0 || result.externalLinksRepaired > 0) bundle.zip.file('word/_rels/document.xml.rels', ser.serializeToString(relsXmlDoc));
      return bundle.zip.generateAsync({ type: 'base64', compression: 'DEFLATE' }).then(function (b64) { return { base64: b64, result: result }; });
    });
  }

  // Ringkasan laporan yang sama isinya dengan laporan web, dalam bentuk data.
  function summarize(result) {
    return {
      style: result.styleName + (result.detected ? ' (terdeteksi, ' + result.detected.confidence + '%)' : ''),
      references: result.refCount, linked: result.linked, unmatched: (result.unmatched || []).length,
      review: result.reviewRequired || 0, protectedControls: result.protectedControlsSkipped || 0,
      urls: result.urlsLinked || 0, repaired: result.externalLinksRepaired || 0, trackingCleaned: result.externalTrackingCleaned || 0,
      figuresLinked: result.figuresTablesLinked || 0, captions: result.figuresTablesCaptionsFound || 0,
      alreadyLinked: result.alreadyLinked || 0, retargeted: result.retargeted || 0,
      narrowed: result.narrowedToHighlight || 0, skippedNotHighlighted: result.skippedNotHighlighted || 0
    };
  }

  var api = { linkDocxBuffer: linkDocxBuffer, summarize: summarize, DEFAULTS: DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DocxLinker = api;
})(typeof window !== 'undefined' ? window : this);
