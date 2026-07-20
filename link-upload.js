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
    narrowToHighlight: document.getElementById('narrowToHighlight'),
    onlyHighlighted: document.getElementById('onlyHighlighted'),
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
        var docFile = zip.file('word/document.xml');
        if (!docFile) throw new Error('word/document.xml tidak ditemukan — file mungkin bukan .docx yang valid.');
        return docFile.async('string').then(function (xmlStr) { return { zip: zip, xmlStr: xmlStr }; });
      })
      .then(function (bundle) {
        var xmlDoc = new DOMParser().parseFromString(bundle.xmlStr, 'application/xml');
        if (xmlDoc.getElementsByTagName('parsererror').length) {
          throw new Error('Gagal mem-parsing XML dokumen.');
        }
        var styleId = els.styleSelect.value;
        var result = window.CitationLinker.linkDocx(xmlDoc, {
          styleId: styleId,
          narrowToHighlight: els.narrowToHighlight.checked,
          onlyHighlighted: els.onlyHighlighted.checked
        });
        if (result.error === 'NO_HEADING') {
          throw new Error('Heading daftar referensi tidak ditemukan. Pastikan ada paragraf tersendiri bertuliskan "References" / "Daftar Pustaka" / "Bibliography" sebelum daftar referensi dimulai.');
        }
        var serializer = new XMLSerializer();
        var newXmlStr = serializer.serializeToString(xmlDoc);
        bundle.zip.file('word/document.xml', newXmlStr);
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

    var bannerClass = result.unmatched.length === 0 ? 'ok' : 'ok';
    var styleLabel = result.styleName + (result.detected ? ' (auto-detect, keyakinan ' + result.detected.confidence + '%)' : ' (dipilih manual)');
    var hlNote = '';
    if (result.docHasHighlight) {
      hlNote = '<div class="pb-stats" style="margin-top:4px;">🖍️ ';
      if (result.narrowedToHighlight) hlNote += result.narrowedToHighlight + ' sitasi dipersempit ke bagian yang di-highlight';
      if (result.skippedNotHighlighted) hlNote += (result.narrowedToHighlight ? ' &middot; ' : '') + result.skippedNotHighlighted + ' sitasi dilewati (tidak di-highlight)';
      if (!result.narrowedToHighlight && !result.skippedNotHighlighted) hlNote += 'Ada highlight di naskah, tapi tidak beririsan dengan sitasi manapun';
      hlNote += '</div>';
    }
    els.parseBanner.innerHTML =
      '<div class="parse-banner ' + bannerClass + '">' +
      '<div class="pb-title">Gaya sitasi: ' + escHtml(styleLabel) + '</div>' +
      '<div class="pb-stats">' + result.refCount + ' referensi terdeteksi &middot; ' + result.linked + ' sitasi tertaut &middot; ' + result.unmatched.length + ' tidak cocok</div>' +
      hlNote +
      '</div>';

    els.summaryGrid.innerHTML =
      '<div class="sum-card"><div class="n">' + result.refCount + '</div><div class="l">Referensi</div></div>' +
      '<div class="sum-card ok"><div class="n">' + result.linked + '</div><div class="l">Tertaut</div></div>' +
      '<div class="sum-card ' + (result.unmatched.length ? 'warn' : 'ok') + '"><div class="n">' + result.unmatched.length + '</div><div class="l">Tidak Cocok</div></div>' +
      '<div class="sum-card fmt"><div class="n">' + escHtml(result.styleName) + '</div><div class="l">Gaya</div></div>';

    var html = '';
    if (result.unmatched.length) {
      html += '<h3>Sitasi yang tidak berhasil ditautkan — cek manual</h3>';
      result.unmatched.slice(0, 40).forEach(function (u) {
        html += '<div class="cite-row"><span>' + escHtml(u) + '</span><span class="tag bad">tidak cocok</span></div>';
      });
      if (result.unmatched.length > 40) html += '<div class="more-note">...dan ' + (result.unmatched.length - 40) + ' lainnya.</div>';
    }
    if (result.linkedList.length) {
      html += '<h3>Contoh sitasi yang berhasil ditautkan</h3>';
      result.linkedList.slice(0, 15).forEach(function (l) {
        html += '<div class="cite-row"><span>' + escHtml(l) + '</span><span class="tag ok">tertaut</span></div>';
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
