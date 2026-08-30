(function () {
  'use strict';

  var els = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    fileChip: document.getElementById('fileChip'),
    fileName: document.getElementById('fileName'),
    fileSize: document.getElementById('fileSize'),
    fileRemove: document.getElementById('fileRemove'),
    styleSelect: document.getElementById('styleSelect'),
    safeMode: document.getElementById('safeMode'),
    preserveCitationControls: document.getElementById('preserveCitationControls'),
    linkScope: document.getElementById('linkScope'),
    applyColor: document.getElementById('applyColor'),
    linkColor: document.getElementById('linkColor'),
    narrowToHighlight: document.getElementById('narrowToHighlight'),
    onlyHighlighted: document.getElementById('onlyHighlighted'),
    linkReferenceUrls: document.getElementById('linkReferenceUrls'),
    linkFiguresTables: document.getElementById('linkFiguresTables'),
    processBtn: document.getElementById('processBtn'),
    statusMsg: document.getElementById('statusMsg'),
    results: document.getElementById('results'),
    parseBanner: document.getElementById('parseBanner'),
    summaryGrid: document.getElementById('summaryGrid'),
    downloadBtn: document.getElementById('downloadBtn'),
    downloadStatus: document.getElementById('downloadStatus'),
    citeReport: document.getElementById('citeReport'),
  };

  var state = { file: null, outputBlob: null, outputName: 'naskah-tertaut.docx' };

  function setStatus(el, msg, kind) {
    el.textContent = msg || '';
    el.className = 'status ' + (kind || 'info');
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  els.applyColor.addEventListener('change', function () {
    els.linkColor.disabled = !els.applyColor.checked;
  });

  // ---------- file selection ----------
  els.dropzone.addEventListener('click', function () { els.fileInput.click(); });
  els.dropzone.addEventListener('dragover', function (e) { e.preventDefault(); els.dropzone.classList.add('drag'); });
  els.dropzone.addEventListener('dragleave', function () { els.dropzone.classList.remove('drag'); });
  els.dropzone.addEventListener('drop', function (e) {
    e.preventDefault(); els.dropzone.classList.remove('drag');
    if (e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]);
  });
  els.fileInput.addEventListener('change', function (e) {
    if (e.target.files.length) selectFile(e.target.files[0]);
  });
  els.fileRemove.addEventListener('click', function (e) {
    e.stopPropagation();
    state.file = null;
    els.fileChip.classList.remove('show');
    els.processBtn.disabled = true;
    els.results.classList.remove('active');
  });

  // ---------- Auto-muat berkas dari Beranda (kalau sudah pernah upload di sana) ----------
  if (window.SharedFile) {
    window.SharedFile.load().then(function (result) {
      if (result && result.file) selectFile(result.file);
    });
  }

  function selectFile(f) {
    if (!/\.docx$/i.test(f.name)) {
      setStatus(els.statusMsg, '⚠️ Mohon pilih file .docx', 'warn');
      return;
    }
    state.file = f;
    els.fileName.textContent = f.name;
    els.fileSize.textContent = formatSize(f.size);
    els.fileChip.classList.add('show');
    els.processBtn.disabled = false;
    els.results.classList.remove('active');
    setStatus(els.statusMsg, '', 'info');
  }

  // ---------- processing ----------
  els.processBtn.addEventListener('click', function () {
    if (!state.file) return;
    els.processBtn.disabled = true;
    setStatus(els.statusMsg, '', 'info');
    els.statusMsg.innerHTML = '<span class="spinner"></span>Memproses dokumen…';
    els.statusMsg.className = 'status info';

    if (typeof JSZip === 'undefined') {
      setStatus(els.statusMsg, '⚠️ Library JSZip gagal dimuat (masalah jaringan/CDN). Coba muat ulang halaman.', 'err');
      els.processBtn.disabled = false;
      return;
    }

    state.file.arrayBuffer()
      .then(function (buf) { return JSZip.loadAsync(buf); })
      .then(function (zip) {
        ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].forEach(function (requiredPart) {
          if (!zip.file(requiredPart)) throw new Error('Paket DOCX tidak lengkap: ' + requiredPart + ' tidak ditemukan.');
        });
        var docFile = zip.file('word/document.xml');
        var relsFile = zip.file('word/_rels/document.xml.rels');
        return Promise.all([
          docFile.async('string'),
          relsFile ? relsFile.async('string') : Promise.resolve(null),
        ]).then(function (parts) { return { zip: zip, xmlStr: parts[0], relsStr: parts[1] }; });
      })
      .then(function (bundle) {
        var xmlDoc = new DOMParser().parseFromString(bundle.xmlStr, 'application/xml');
        if (xmlDoc.getElementsByTagName('parsererror').length) {
          throw new Error('Gagal mem-parsing XML dokumen.');
        }
        // word/_rels/document.xml.rels seharusnya selalu ada di .docx yang valid (dipakai untuk
        // relasi ke styles.xml, dst.), tapi kalau entah kenapa tidak ada, buat kerangka minimal
        // supaya fitur auto-link URL referensi tetap bisa jalan alih-alih gagal total.
        var relsStr = bundle.relsStr || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
        var relsXmlDoc = new DOMParser().parseFromString(relsStr, 'application/xml');
        var styleId = els.styleSelect.value;
        var result = window.CitationLinker.linkDocx(xmlDoc, {
          styleId: styleId,
          linkScope: els.linkScope.value,
          safeMode: els.safeMode ? els.safeMode.checked : true,
          preserveCitationControls: els.preserveCitationControls ? els.preserveCitationControls.checked : true,
          linkColor: els.applyColor.checked ? els.linkColor.value : null,
          narrowToHighlight: els.narrowToHighlight.checked,
          onlyHighlighted: els.onlyHighlighted.checked,
          linkReferenceUrls: els.linkReferenceUrls ? els.linkReferenceUrls.checked : true,
          linkFiguresTables: els.linkFiguresTables ? els.linkFiguresTables.checked : false,
          relsXmlDoc: relsXmlDoc
        });
        if (result.error === 'NO_HEADING') {
          throw new Error('Heading daftar referensi tidak ditemukan. Pastikan ada paragraf tersendiri bertuliskan "References" / "Daftar Pustaka" / "Bibliography" sebelum daftar referensi dimulai.');
        }
        if (result.integrity && !result.integrity.ok) {
          throw new Error('Pemeriksaan integritas OOXML gagal (' + result.integrity.issues.join(', ') + '). File keluaran dibatalkan agar naskah asli tetap aman.');
        }
        var serializer = new XMLSerializer();
        var newXmlStr = serializer.serializeToString(xmlDoc);
        bundle.zip.file('word/document.xml', newXmlStr);
        if (result.urlsLinked > 0) {
          bundle.zip.file('word/_rels/document.xml.rels', serializer.serializeToString(relsXmlDoc));
        }
        return bundle.zip.generateAsync({
          type: 'blob',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }).then(function (blob) { return { blob: blob, result: result }; });
      })
      .then(function (out) {
        state.outputBlob = out.blob;
        state.outputName = state.file.name.replace(/\.docx$/i, '') + '-tertaut.docx';
        renderReport(out.result);
        setStatus(els.statusMsg, '✅ Selesai.', 'ok');
      })
      .catch(function (err) {
        console.error(err);
        setStatus(els.statusMsg, '❌ ' + err.message, 'err');
      })
      .finally(function () {
        els.processBtn.disabled = false;
      });
  });

  els.downloadBtn.addEventListener('click', function () {
    if (!state.outputBlob) return;
    var url = URL.createObjectURL(state.outputBlob);
    var a = document.createElement('a');
    a.href = url; a.download = state.outputName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  });

  // ---------- report rendering ----------
  function renderReport(result) {
    els.results.classList.add('active');

    var bannerClass = result.unmatched.length === 0 ? 'ok' : 'warn';
    var styleLabel = result.styleName + (result.detected ? ' (auto-detect, keyakinan ' + result.detected.confidence + '%)' : ' (dipilih manual)');
    var hlNote = '';
    if (result.docHasHighlight) {
      hlNote = '<div class="pb-stats" style="margin-top:4px;">🖍️ ';
      if (result.narrowedToHighlight) hlNote += result.narrowedToHighlight + ' sitasi dipersempit ke bagian yang di-highlight';
      if (result.skippedNotHighlighted) hlNote += (result.narrowedToHighlight ? ' &middot; ' : '') + result.skippedNotHighlighted + ' sitasi dilewati (tidak di-highlight)';
      if (!result.narrowedToHighlight && !result.skippedNotHighlighted) hlNote += 'Ada highlight di naskah, tapi tidak beririsan dengan sitasi manapun';
      hlNote += '</div>';
    }
    var figTblNote = '';
    if (els.linkFiguresTables && els.linkFiguresTables.checked) {
      if (result.figuresTablesCaptionsFound) {
        figTblNote = '<div class="pb-stats" style="margin-top:4px;">🖼️ ' + result.figuresTablesCaptionsFound + ' caption Figure/Table ditemukan &middot; ' + result.figuresTablesLinked + ' sebutan berhasil ditautkan' +
          (result.figuresTablesLinked === 0 ? ' — kalau naskah Anda punya sebutan "Figure N"/"Table N" di teks tapi angka ini 0, kemungkinan sebutannya dibuat lewat fitur "Insert Cross-reference" bawaan Word (field kode otomatis), yang sengaja TIDAK disentuh demi keamanan file (mencegah dokumen rusak) — link Cross-reference bawaan Word itu sendiri sudah bisa diklik-lompat, jadi tetap berfungsi' : '') +
          '</div>';
      } else {
        figTblNote = '<div class="pb-stats" style="margin-top:4px;">🖼️ Tidak ditemukan caption "Figure N."/"Table N." di naskah — tidak ada yang bisa ditautkan.</div>';
      }
    }
    els.parseBanner.innerHTML =
      '<div class="parse-banner ' + bannerClass + '">' +
      '<div class="pb-title">Gaya sitasi: ' + escHtml(styleLabel) + '</div>' +
      '<div class="pb-stats">' + result.refCount + ' referensi terdeteksi &middot; ' + result.linked + ' sitasi tertaut &middot; ' + result.unmatched.length + ' tidak cocok' +
      (result.reviewRequired ? ' &middot; ' + result.reviewRequired + ' perlu ditinjau' : '') +
      (result.protectedControlsSkipped ? ' &middot; ' + result.protectedControlsSkipped + ' field sitasi dilindungi' : '') + '</div>' +
      hlNote + figTblNote +
      '</div>';

    els.summaryGrid.innerHTML =
      '<div class="sum-card"><div class="n">' + result.refCount + '</div><div class="l">Referensi</div></div>' +
      '<div class="sum-card ok"><div class="n">' + result.linked + '</div><div class="l">Tertaut</div></div>' +
      '<div class="sum-card ' + (result.unmatched.length ? 'warn' : 'ok') + '"><div class="n">' + result.unmatched.length + '</div><div class="l">Tidak Cocok</div></div>' +
      (result.reviewRequired ? '<div class="sum-card warn"><div class="n">' + result.reviewRequired + '</div><div class="l">Perlu Ditinjau</div></div>' : '') +
      '<div class="sum-card fmt"><div class="n">' + escHtml(result.styleName) + '</div><div class="l">Gaya</div></div>' +
      (result.urlsLinked ? '<div class="sum-card ok"><div class="n">' + result.urlsLinked + '</div><div class="l">URL Referensi Ditautkan</div></div>' : '') +
      (els.linkFiguresTables && els.linkFiguresTables.checked ? '<div class="sum-card ok"><div class="n">' + result.figuresTablesLinked + '</div><div class="l">Figure/Table Tertaut</div></div>' : '') +
      (els.linkFiguresTables && els.linkFiguresTables.checked ? '<div class="sum-card"><div class="n">' + result.figuresTablesCaptionsFound + '</div><div class="l">Caption Figure/Table</div></div>' : '');

    var html = '';
    if (result.unmatched.length) {
      html += '<h3>Sitasi yang tidak berhasil ditautkan — cek manual</h3>';
      result.unmatched.slice(0, 40).forEach(function (u, idx) {
        var detail = result.unmatchedDetails && result.unmatchedDetails[idx];
        var reasonLabel = detail && window.CitationEngine.AUTHOR_DATE_MATCH_REASONS
          ? window.CitationEngine.AUTHOR_DATE_MATCH_REASONS[detail.reason]
          : null;
        var suffix = reasonLabel ? ' — ' + reasonLabel + (detail.confidence ? ' (' + Math.round(detail.confidence * 100) + '%)' : '') : '';
        html += '<div class="cite-row"><span>' + escHtml(u + suffix) + '</span><span class="tag bad">' + (detail && (detail.status === 'review' || detail.status === 'ambiguous') ? 'tinjau' : 'tidak cocok') + '</span></div>';
      });
      if (result.unmatched.length > 40) html += '<div class="more-note">...dan ' + (result.unmatched.length - 40) + ' lainnya.</div>';
    }
    if (result.linkedList.length) {
      html += '<h3>Contoh sitasi yang berhasil ditautkan</h3>';
      result.linkedList.slice(0, 15).forEach(function (l, idx) {
        var detail = result.linkedDetails && result.linkedDetails[idx];
        var reasonLabel = detail && window.CitationEngine.AUTHOR_DATE_MATCH_REASONS ? window.CitationEngine.AUTHOR_DATE_MATCH_REASONS[detail.reason] : null;
        html += '<div class="cite-row"><span>' + escHtml(l + (reasonLabel ? ' — ' + reasonLabel + ' (' + Math.round(detail.confidence * 100) + '%)' : '')) + '</span><span class="tag ok">tertaut</span></div>';
      });
      if (result.linkedList.length > 15) html += '<div class="more-note">...dan ' + (result.linkedList.length - 15) + ' lainnya.</div>';
    }
    if (result.refParseFailed && result.refParseFailed.length) {
      html += '<h3>Baris referensi yang tidak terbaca (gaya "' + escHtml(result.styleName) + '")</h3>';
      result.refParseFailed.slice(0, 20).forEach(function (f) {
        html += '<div class="cite-row"><span>' + escHtml(f.text) + '</span><span class="tag bad">baris ' + f.lineNumber + '</span></div>';
      });
    }
    els.citeReport.innerHTML = html;
  }
})();
