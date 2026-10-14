(function() {
  var CE = window.CitationEngine;
  var CC = window.CitationConverter;
  var BE = window.BibliographyEngine;
  var STYLES = CE.STYLES;
  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';
  var METADATA_PATH = 'customXml/citation-converter.xml';
  var METADATA_NS = 'urn:cek-sitasi:citation-converter:v1';

  var els = {
    sourceStyleSelect: document.getElementById('sourceStyleSelect'),
    targetStyleSelect: document.getElementById('targetStyleSelect'),
    confBadge: document.getElementById('confBadge'),
    confText: document.getElementById('confText'),
    confFill: document.getElementById('confFill'),
    swapBtn: document.getElementById('swapBtn'),
    fullDocText: document.getElementById('fullDocText'),
    btnAutoSplit: document.getElementById('btnAutoSplit'),
    splitStatus: document.getElementById('splitStatus'),
    articleText: document.getElementById('articleText'),
    referenceText: document.getElementById('referenceText'),
    btnCompleteEtAl: document.getElementById('btnCompleteEtAl'),
    completeEtAlStatus: document.getElementById('completeEtAlStatus'),
    convertBtn: document.getElementById('convertBtn'),
    topStatus: document.getElementById('topStatus'),
    loading: document.getElementById('loading'),
    results: document.getElementById('results'),
    summaryGrid: document.getElementById('summaryGrid'),
    unmatchedDetails: document.getElementById('unmatchedDetails'),
    unmatchedCount: document.getElementById('unmatchedCount'),
    unmatchedList: document.getElementById('unmatchedList'),
    articlePreview: document.getElementById('articlePreview'),
    convertedArticleOut: document.getElementById('convertedArticleOut'),
    convertedRefsOut: document.getElementById('convertedRefsOut'),
    btnCopyArticle: document.getElementById('btnCopyArticle'),
    btnCopyRefs: document.getElementById('btnCopyRefs'),
    btnResetArticle: document.getElementById('btnResetArticle'),
    btnResetRefs: document.getElementById('btnResetRefs'),
    toast: document.getElementById('toast'),
    // upload tab
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    fileChip: document.getElementById('fileChip'),
    fileIcon: document.getElementById('fileIcon'),
    fileName: document.getElementById('fileName'),
    fileSize: document.getElementById('fileSize'),
    fileRemove: document.getElementById('fileRemove'),
    uploadStatus: document.getElementById('uploadStatus'),
    // export
    btnExportDocxOriginal: document.getElementById('btnExportDocxOriginal'),
    btnExportDocxPlain: document.getElementById('btnExportDocxPlain'),
    btnExportTxt: document.getElementById('btnExportTxt'),
    exportStatus: document.getElementById('exportStatus'),
  };

  var state = {
    originalFile: null,        // raw File, kept only for uploaded .docx (needed for format-preserving export)
    docxOriginalArticleText: null,   // article text exactly as extracted from the uploaded .docx's own XML (auto-split)
    docxOriginalReferenceText: null, // reference text exactly as extracted from the uploaded .docx's own XML (auto-split)
    autoConvertedArticle: '',  // last auto-generated (unedited) conversion output, for the "reset" buttons
    autoConvertedRefs: '',
    lastResult: null,
    lastSourceText: '',        // article text as it was at the moment "Konversi" was clicked (for the preview)
    metadata: null,
    lastDetailsJSON: '[]',
  };

  function esc(s) { return CE.esc ? CE.esc(s) : String(s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var detailsHost = document.getElementById('sourceDetails');
  function readSourceDetails() {
    return Array.from(detailsHost.querySelectorAll('[data-source-row]')).map(function(row) {
      var result = { line: row._referenceLine };
      row.querySelectorAll('[data-field]').forEach(function(input) {
        if (input.value.trim()) result[input.dataset.field] = input.value.trim();
      });
      return result;
    }).filter(function(item) { return Object.keys(item).length > 1; });
  }
  function showSourceDetails(result, supplied) {
    detailsHost.textContent = '';
    result.referenceLines.forEach(function(ref, i) {
      var extra = (supplied || []).find(function(x) { return x.line === ref.original; }) || {};
      var row = document.createElement('fieldset'); row.dataset.sourceRow = 'true'; row._referenceLine = ref.original;
      row.style.marginTop = '12px';
      var legend = document.createElement('legend'); legend.textContent = (i + 1) + '. ' + (ref.model.title || ref.original); row.appendChild(legend);
      var label = document.createElement('label'); label.textContent = 'Jenis sumber ';
      var select = document.createElement('select'); select.dataset.field = 'type';
      var auto = document.createElement('option'); auto.value = ''; auto.textContent = 'Deteksi: ' + (BE.TYPES[ref.model.type] || ref.model.type); select.appendChild(auto);
      Object.keys(BE.TYPES).forEach(function(type) { var o = document.createElement('option'); o.value = type; o.textContent = BE.TYPES[type]; select.appendChild(o); });
      select.value = extra.type || ''; label.appendChild(select); row.appendChild(label);
      [['place', 'Lokasi penerbit / institusi'], ['accessed', 'Tanggal akses (mis. 2024, July 10)'],
        ['journalAbbreviation', 'Singkatan jurnal terverifikasi'], ['journal', 'Nama lengkap jurnal terverifikasi'], ['publisher', 'Nama penerbit / instansi terverifikasi'], ['articleNumber', 'Nomor artikel terverifikasi'],
        ['date', 'Tanggal terbit edisi (mis. 2024, June 12)']].forEach(function(field) {
        var l = document.createElement('label'); l.style.display = 'block'; l.style.marginTop = '8px'; l.textContent = field[1] + ' ';
        var input = document.createElement('input'); input.type = 'text'; input.dataset.field = field[0];
        input.value = extra[field[0]] || ''; l.appendChild(input); row.appendChild(l);
      });
      detailsHost.appendChild(row);
    });
  }
  document.getElementById('btnSourceDetails').addEventListener('click', function() {
    try {
      var source = els.sourceStyleSelect.value === 'auto' ? CE.FormatDetector.detect(els.articleText.value, els.referenceText.value).styleId : els.sourceStyleSelect.value;
      var supplied = readSourceDetails();
      var result = CC.convert(els.articleText.value, els.referenceText.value, source, source, { metadata: state.metadata, referenceDetails: supplied });
      showSourceDetails(result, supplied);
    } catch (e) { els.topStatus.textContent = e.message; }
  });
  detailsHost.addEventListener('input', function() { refreshOriginalExportAvailability(); });
  detailsHost.addEventListener('change', function() { refreshOriginalExportAvailability(); });

  document.getElementById('btnUseResult').addEventListener('click', function() {
    var result = state.lastResult;
    if (!result) return;
    els.articleText.value = els.convertedArticleOut.value; els.referenceText.value = els.convertedRefsOut.value;
    state.metadata = result.metadata;
    els.sourceStyleSelect.value = result.targetStyleId; els.targetStyleSelect.value = result.sourceStyleId;
    state.originalFile = null; state.docxOriginalArticleText = null; state.docxOriginalReferenceText = null;
    state.lastResult = null; detailsHost.textContent = ''; els.fileChip.classList.remove('show');
    els.results.classList.remove('active'); setInputMode('manual'); refreshOriginalExportAvailability();
    els.topStatus.textContent = 'Hasil dipindahkan ke input beserta metadata. Klik Konversi Sitasi. Untuk mempertahankan tata letak Word, unduh DOCX lalu unggah kembali.';
  });

  document.getElementById('btnRunScenarios').addEventListener('click', async function() {
    var button = this, host = document.getElementById('scenarioResults'); button.disabled = true;
    host.textContent = 'Menguji contoh…';
    try {
      var response = await fetch('fixtures/apa-ieee-scenarios.json');
      if (!response.ok) throw new Error('Contoh uji tidak dapat dimuat.');
      var data = await response.json(), outcomes = [], passed = 0;
      for (var i = 0; i < data.cases.length; i++) {
        var sample = data.cases[i], article = sample.article, refs = sample.apa, metadata = null;
        var error = null;
        try {
          for (var cycle = 0; cycle < data.cycles; cycle++) {
            var ieee = CC.convert(article, refs, 'apa7', 'ieee', { metadata: metadata, referenceDetails: [Object.assign({ line: refs }, sample.details)] });
            if (ieee.unmatched.length || ieee.referenceLines[0].line !== sample.ieee) throw new Error('Keluaran IEEE berbeda dari acuan.');
            var apa = CC.convert(ieee.convertedArticle, ieee.referenceLines[0].line, 'ieee', 'apa7', { metadata: ieee.metadata });
            if (apa.unmatched.length || apa.convertedArticle !== sample.article || apa.referenceLines[0].line !== sample.expectedAPA || apa.restoredMetadataCount !== 1) throw new Error('Keluaran APA atau sitasi berbeda dari acuan.');
            article = apa.convertedArticle; refs = apa.referenceLines[0].line; metadata = apa.metadata;
          }
          passed++;
        } catch (e) { error = e.message; }
        outcomes.push({ sample: sample, error: error });
        if (i % 8 === 0) await new Promise(function(resolve) { setTimeout(resolve, 0); });
      }
      host.textContent = passed + '/' + data.cases.length + ' contoh lulus ' + data.cycles + ' putaran. Uji DOCX dan kasus batas juga tersedia dalam suite pengujian.';
      var list = document.createElement('ul');
      outcomes.forEach(function(outcome) {
        var li = document.createElement('li'), b = document.createElement('button'); b.className = 'ghost';
        li.textContent = (outcome.error ? 'GAGAL: ' + outcome.error : 'LULUS') + ' — ' + outcome.sample.id + (outcome.sample.review ? ' (adaptasi IEEE; tinjauan editorial)' : '') + ' ';
        b.textContent = 'Coba contoh'; b.addEventListener('click', function() {
          var sample = outcome.sample; els.articleText.value = sample.article; els.referenceText.value = sample.apa;
          state.metadata = null; state.lastResult = null; state.originalFile = null; els.sourceStyleSelect.value = 'apa7'; els.targetStyleSelect.value = 'ieee';
          var hints = [Object.assign({ line: sample.apa }, sample.details)];
          showSourceDetails(CC.convert(sample.article, sample.apa, 'apa7', 'apa7', { referenceDetails: hints }), hints);
          setInputMode('manual'); els.results.classList.remove('active'); refreshOriginalExportAvailability();
        }); li.appendChild(b); list.appendChild(li);
      }); host.appendChild(list);
    } catch (e) { host.textContent = e.message; }
    finally { button.disabled = false; }
  });

  // ---------- Tabs ----------
  function setInputMode(mode) {
    document.querySelectorAll('.input-mode-tab').forEach(function(btn) {
      var active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    ['paste', 'upload', 'manual'].forEach(function(m) {
      var pane = document.getElementById('pane-' + m);
      if (pane) pane.classList.toggle('active', m === mode);
    });
  }
  document.querySelectorAll('.input-mode-tab').forEach(function(btn) {
    btn.addEventListener('click', function() { setInputMode(btn.dataset.mode); });
  });

  els.btnAutoSplit.addEventListener('click', function() {
    var fullText = els.fullDocText.value;
    if (!fullText.trim()) {
      els.splitStatus.textContent = 'Tempel dokumennya dulu di kotak atas.';
      els.splitStatus.style.color = 'var(--red)';
      return;
    }
    var split = CE.splitDocumentByReferences(fullText);
    if (!split) {
      els.splitStatus.textContent = '⚠️ Heading referensi tidak terdeteksi (coba beri heading eksplisit seperti "References" atau "Daftar Pustaka" di baris tersendiri, atau isi manual di tab sebelah).';
      els.splitStatus.style.color = 'var(--amber)';
      return;
    }
    els.articleText.value = split.article;
    els.referenceText.value = split.references;
    els.splitStatus.textContent = '✅ Terpisah pada heading "' + split.headingText + '" — dipindah ke tab "Isi Manual", silakan periksa hasilnya sebelum konversi.';
    els.splitStatus.style.color = 'var(--green)';
    setInputMode('manual');
    if (els.articleText.scrollIntoView) els.articleText.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  els.swapBtn.addEventListener('click', function() {
    var src = els.sourceStyleSelect.value;
    var tgt = els.targetStyleSelect.value;
    if (src === 'auto') return; // nothing sensible to swap into
    if (STYLES[tgt]) els.sourceStyleSelect.value = tgt;
    els.targetStyleSelect.value = src;
  });

  // ---------- Toast / copy ----------
  function showToast(msg) {
    els.toast.textContent = '✅ ' + msg;
    els.toast.classList.add('show');
    setTimeout(function() { els.toast.classList.remove('show'); }, 2000);
  }
  function doCopy(text, btn) {
    function done() {
      if (btn) {
        var orig = btn.textContent;
        btn.textContent = '✅ Disalin';
        btn.classList.add('copied');
        setTimeout(function() { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
      }
      showToast('Disalin ke clipboard');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function() { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  els.btnCopyArticle.addEventListener('click', function() { doCopy(els.convertedArticleOut.value, els.btnCopyArticle); });
  els.btnCopyRefs.addEventListener('click', function() { doCopy(els.convertedRefsOut.value, els.btnCopyRefs); });
  els.btnResetArticle.addEventListener('click', function() { els.convertedArticleOut.value = state.autoConvertedArticle; refreshOriginalExportAvailability(); showToast('Dikembalikan ke hasil otomatis'); });
  els.btnResetRefs.addEventListener('click', function() { els.convertedRefsOut.value = state.autoConvertedRefs; refreshOriginalExportAvailability(); showToast('Dikembalikan ke hasil otomatis'); });

  // ---------- Summary / unmatched / preview rendering ----------
  function renderSummary(result) {
    var cards = [
      { n: result.totalCitationsFound, l: 'Sitasi Terdeteksi', cls: '' },
      { n: result.changedCount, l: 'Berhasil Dikonversi', cls: 'ok' },
      { n: result.unmatched.length, l: 'Tidak Diubah', cls: result.unmatched.length > 0 ? 'warn' : '' },
      { n: result.referenceLines.length, l: 'Entri Referensi', cls: '' },
      { n: (result.referenceIssues || []).length, l: 'Referensi Perlu Dicek', cls: (result.referenceIssues || []).length ? 'warn' : '' },
      { n: result.uncitedCount, l: 'Referensi Tak Disitasi', cls: result.uncitedCount > 0 ? 'warn' : '' },
      { n: STYLES[result.sourceStyleId].name + ' → ' + STYLES[result.targetStyleId].name, l: 'Arah Konversi', cls: 'fmt' },
    ];
    if (result.mixedStyleFoundCount > 0) {
      cards.push({
        n: result.mixedStyleFixedCount + '/' + result.mixedStyleFoundCount,
        l: 'Gaya Campuran Diperbaiki',
        cls: result.mixedStyleUnresolvedCount > 0 ? 'warn' : 'ok',
      });
    }
    els.summaryGrid.innerHTML = cards.map(function(c) {
      return '<div class="sum-card ' + c.cls + '"><div class="n">' + esc(String(c.n)) + '</div><div class="l">' + esc(c.l) + '</div></div>';
    }).join('');
  }

  function renderUnmatched(result) {
    var issues = result.unmatched.concat(result.referenceIssues || []);
    els.unmatchedCount.textContent = issues.length;
    if (issues.length === 0) {
      els.unmatchedList.innerHTML = '<div style="font-size:12px;color:var(--text-dim);font-style:italic;">Semua sitasi yang terdeteksi berhasil diproses.</div>';
      els.unmatchedDetails.open = false;
      return;
    }
    els.unmatchedList.innerHTML = issues.map(function(u) {
      var badge = u.crossFamily ? '<span class="mixed-badge">GAYA CAMPURAN</span> ' : '';
      return '<div class="issue-item"><div class="raw">' + badge + esc(u.raw) + '</div><div class="note">' + esc(u.note) + '</div></div>';
    }).join('');
    els.unmatchedDetails.open = true;
  }

  // Renders the source article text with each citation span highlighted: green (converted,
  // shows old -> new inline) or amber (left unchanged, flagged). Read-only, built once at
  // conversion time from `result.citationSpans` (article-text coordinates).
  function renderPreview(sourceText, result) {
    var out = '', cursor = 0;
    result.citationSpans.forEach(function(s) {
      out += esc(sourceText.slice(cursor, s.start));
      if (s.matched) {
        out += '<mark class="hit" title="Diubah dari: ' + esc(s.original) + '">' + esc(s.replacement) + '</mark>';
      } else {
        out += '<mark class="miss" title="' + esc(s.note || 'Tidak diubah') + '">' + esc(s.original) + '</mark>';
      }
      cursor = s.end;
    });
    out += esc(sourceText.slice(cursor));
    els.articlePreview.innerHTML = out || '<span style="color:var(--text-faint);font-style:italic;">(tidak ada sitasi terdeteksi)</span>';
  }

  // ---------- Convert ----------
  els.convertBtn.addEventListener('click', function() {
    var articleText = els.articleText.value.trim();
    var referenceText = els.referenceText.value.trim();
    if (!articleText) { alert('Silakan masukkan teks artikel (tab "Isi Manual", atau pakai "Pisahkan Otomatis"/"Upload .docx" di tab sebelah).'); return; }
    if (!referenceText) { alert('Silakan masukkan daftar referensi — dibutuhkan untuk mencocokkan setiap sitasi.'); return; }

    els.loading.classList.add('active');
    els.results.classList.remove('active');
    els.confBadge.classList.remove('show');
    els.exportStatus.textContent = '';

    setTimeout(function() {
      var selected = els.sourceStyleSelect.value;
      var sourceStyleId;
      if (selected === 'auto') {
        var detection = CE.FormatDetector.detect(articleText, referenceText);
        sourceStyleId = detection.styleId;
        els.confText.textContent = STYLES[sourceStyleId].name + ' (' + detection.confidence + '%)';
        els.confFill.style.width = detection.confidence + '%';
        els.confBadge.classList.add('show');
      } else {
        sourceStyleId = selected;
      }
      var targetStyleId = els.targetStyleSelect.value;

      var result;
      try {
        result = CC.convert(articleText, referenceText, sourceStyleId, targetStyleId, { metadata: state.metadata, referenceDetails: readSourceDetails() });
      } catch (err) {
        els.loading.classList.remove('active');
        els.topStatus.textContent = '⚠️ ' + err.message;
        els.topStatus.style.color = 'var(--red)';
        return;
      }

      els.loading.classList.remove('active');
      els.results.classList.add('active');
      els.topStatus.textContent = '';

      state.lastResult = result;
      state.lastDetailsJSON = JSON.stringify(readSourceDetails());
      state.lastSourceText = articleText;
      state.autoConvertedArticle = result.convertedArticle;
      state.autoConvertedRefs = result.referenceLines.map(function(l) { return l.line; }).join('\n');

      renderSummary(result);
      renderUnmatched(result);
      renderPreview(articleText, result);
      els.convertedArticleOut.value = state.autoConvertedArticle;
      els.convertedRefsOut.value = state.autoConvertedRefs;

      // The format-preserving .docx export only makes sense against the ORIGINAL uploaded
      // file's own text, not arbitrary pasted/manual text — enable it only when that lines up.
      refreshOriginalExportAvailability();

      if (els.results.scrollIntoView) els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 10);
  });

  // ---------- "Lengkapi et al. via CrossRef" (completing a source reference the manuscript
  // itself already truncated with "et al.", which is never valid in any target reference list —
  // see completeTruncatedAuthorsAsync in converter-engine.js for why) ----------
  els.btnCompleteEtAl.addEventListener('click', function() {
    var referenceText = els.referenceText.value.trim();
    if (!referenceText) {
      els.completeEtAlStatus.textContent = '⚠️ Isi daftar referensi dulu.';
      return;
    }
    var selected = els.sourceStyleSelect.value;
    var sourceStyleId = selected === 'auto'
      ? CE.FormatDetector.detect(els.articleText.value || '', referenceText).styleId
      : selected;

    els.btnCompleteEtAl.disabled = true;
    els.completeEtAlStatus.textContent = 'Memeriksa CrossRef untuk referensi yang terpotong "et al."...';

    CC.completeTruncatedAuthorsAsync(referenceText, sourceStyleId)
      .then(function(report) {
        els.btnCompleteEtAl.disabled = false;
        if (report.checked === 0) {
          els.completeEtAlStatus.textContent = 'Tidak ada referensi bergaya "et al." (dengan DOI) yang perlu dilengkapi.';
          return;
        }
        if (report.completed.length > 0) {
          els.referenceText.value = report.updatedReferenceText;
        }
        var msg = report.completed.length + '/' + report.checked + ' referensi berhasil dilengkapi via CrossRef.';
        if (report.skipped.length > 0) {
          var reasons = { 'crossref-lookup-failed': 'DOI tidak ditemukan/gagal diakses', 'crossref-not-more-complete': 'CrossRef tidak punya lebih banyak nama daripada yang sudah ada', 'title-mismatch': 'judul di CrossRef tidak cocok — kemungkinan DOI salah, periksa manual', 'could-not-locate-truncation-in-raw-text': 'tidak bisa menemukan lokasi "et al." di teks aslinya' };
          msg += ' ' + report.skipped.length + ' dilewati: ' + report.skipped.map(function(s) { return '[' + s.numLabel + '] ' + (reasons[s.reason] || s.reason); }).join('; ') + '.';
        }
        els.completeEtAlStatus.textContent = (report.completed.length > 0 ? '✅ ' : '') + msg;
      })
      .catch(function(err) {
        els.btnCompleteEtAl.disabled = false;
        els.completeEtAlStatus.textContent = '⚠️ Gagal: ' + err.message;
      });
  });

  // ==================================================================================
  // ---------- .docx upload ----------
  // ==================================================================================
  var MAX_FILE_SIZE = 25 * 1024 * 1024;

  els.dropzone.addEventListener('click', function() { els.fileInput.click(); });
  els.dropzone.addEventListener('dragover', function(e) { e.preventDefault(); els.dropzone.classList.add('drag'); });
  els.dropzone.addEventListener('dragleave', function() { els.dropzone.classList.remove('drag'); });
  els.dropzone.addEventListener('drop', function(e) {
    e.preventDefault(); els.dropzone.classList.remove('drag');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  els.fileInput.addEventListener('change', function() {
    if (els.fileInput.files && els.fileInput.files[0]) handleFile(els.fileInput.files[0]);
  });
  els.fileRemove.addEventListener('click', function(e) {
    e.stopPropagation();
    state.originalFile = null; state.docxOriginalArticleText = null; state.docxOriginalReferenceText = null;
    state.metadata = null; state.lastResult = null;
    els.fileChip.classList.remove('show');
    els.fileInput.value = '';
    els.uploadStatus.textContent = '';
    els.btnExportDocxOriginal.disabled = true;
  });

  // ---------- Auto-muat berkas dari Beranda (kalau sudah pernah upload di sana) ----------
  if (window.SharedFile) {
    window.SharedFile.load().then(function (result) {
      if (result && result.file) {
        var uploadTabBtn = document.getElementById('tab-btn-upload');
        if (uploadTabBtn) uploadTabBtn.click(); // pindah dari mode "Tempel" (default) ke "Upload"
        handleFile(result.file);
      }
    });
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function setUploadStatus(msg, kind) {
    els.uploadStatus.textContent = msg;
    els.uploadStatus.className = 'status ' + (kind || 'info');
  }

  function handleFile(file) {
    var name = file.name.toLowerCase();
    if (!name.endsWith('.docx')) { setUploadStatus('⚠️ Format tidak didukung. Gunakan file .docx.', 'err'); return; }
    if (file.size > MAX_FILE_SIZE) { setUploadStatus('⚠️ File terlalu besar (' + formatSize(file.size) + ', maksimum ' + formatSize(MAX_FILE_SIZE) + ').', 'err'); return; }
    if (typeof JSZip === 'undefined') { setUploadStatus('⚠️ Library JSZip gagal dimuat (masalah jaringan/CDN). Coba muat ulang halaman.', 'err'); return; }

    setUploadStatus('Membaca & mengekstrak isi .docx...', 'info');
    state.originalFile = file;
    state.docxOriginalArticleText = null;
    state.docxOriginalReferenceText = null;
    state.lastResult = null; state.metadata = null; detailsHost.textContent = '';
    els.btnExportDocxOriginal.disabled = true;

    loadDocxTextIndex(file)
      .then(function(index) {
        var fullText = index.text;
        var split = splitDocxIndex(index);
        if (!split) {
          setUploadStatus('⚠️ Isi berhasil dibaca, tapi heading referensi ("References"/"Daftar Pustaka") tidak terdeteksi otomatis. Tempel manual di tab "Isi Manual", atau beri heading eksplisit di baris tersendiri lalu unggah ulang.', 'warn');
          els.articleText.value = fullText;
          setInputMode('manual');
          return;
        }
        els.articleText.value = split.article;
        els.referenceText.value = split.references;
        state.docxOriginalArticleText = split.article;
        state.docxOriginalReferenceText = split.references;
        state.metadata = index.metadata || null;

        els.fileIcon.textContent = '📘';
        els.fileName.textContent = file.name;
        els.fileSize.textContent = '(' + formatSize(file.size) + ')';
        els.fileChip.classList.add('show');
        setUploadStatus('✅ Terpisah pada heading "' + split.headingText + '".' + (state.metadata ? ' Metadata konversi ditemukan untuk memulihkan penulis lengkap.' : '') + ' Silakan periksa sebelum konversi.', 'ok');
        setInputMode('manual');
        if (els.articleText.scrollIntoView) els.articleText.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(function(err) {
        setUploadStatus('⚠️ Gagal membaca .docx: ' + err.message, 'err');
        state.originalFile = null;
      });
  }

  // ==================================================================================
  // ---------- DOCX XML helpers (format-preserving read & write) ----------
  // Concatenates every <w:t> node's text (document order) into one flat string, keeping a
  // position -> node map, so citation offsets computed by CitationConverter (which operate on
  // this exact flat text) can be traced back to precisely which run(s) they touch, and edited
  // in place without disturbing any other formatting in the document.
  // ==================================================================================
  function buildDocxTextIndex(xmlDoc) {
    var segments = [];
    var paragraphInfo = [];
    var text = '';
    var paragraphs = xmlDoc.getElementsByTagNameNS(W_NS, 'p');
    for (var p = 0; p < paragraphs.length; p++) {
      var paraStart = text.length;
      var wts = paragraphs[p].getElementsByTagNameNS(W_NS, 't');
      for (var i = 0; i < wts.length; i++) {
        var node = wts[i];
        var owner = node.parentNode;
        while (owner && !(owner.localName === 'p' && owner.namespaceURI === W_NS)) owner = owner.parentNode;
        if (owner !== paragraphs[p]) continue; // nested text-box paragraphs are indexed once
        var t = node.textContent || '';
        if (t.length === 0) continue;
        segments.push({ start: text.length, end: text.length + t.length, node: node });
        text += t;
      }
      text += '\n';
      paragraphInfo.push({ element: paragraphs[p], start: paraStart, end: text.length });
    }
    return { text: text, segments: segments, paragraphs: paragraphInfo };
  }

  function splitDocxIndex(index) {
    var heading = CE.findReferencesHeading(index.text);
    if (!heading) return null;
    var refStart = heading.offset + heading.lineLength;
    var refEnd = CE.findReferencesListEnd(index.text, refStart);
    var before = index.text.slice(0, heading.offset);
    // DOCX already has real paragraph boundaries. PDF unwrapping would change its offsets.
    return { article: before.trim(), articleOffset: before.length - before.trimStart().length,
      references: index.text.slice(refStart, refEnd).split('\n').map(function(line) { return line.trim(); }).filter(Boolean).join('\n'),
      refStart: refStart, refEnd: refEnd, headingText: heading.text };
  }

  function readConversionMetadata(zip) {
    var part = zip.file(METADATA_PATH);
    if (!part) return Promise.resolve(null);
    return part.async('string').then(function(xml) {
      var root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
      if (root.namespaceURI !== METADATA_NS) return null;
      try { var data = JSON.parse(root.textContent); return data.version === 1 ? data : null; }
      catch (e) { return null; }
    });
  }

  function writeConversionMetadata(zip, metadata) {
    return readConversionMetadata(zip).then(function(existing) {
      if (zip.file(METADATA_PATH) && !existing) throw new Error('Bagian metadata bernama sama sudah ada dan bukan milik konverter. File tidak ditimpa.');
      var xml = document.implementation.createDocument(METADATA_NS, 'cc:metadata', null);
      xml.documentElement.textContent = JSON.stringify(metadata);
      zip.file(METADATA_PATH, new XMLSerializer().serializeToString(xml));
      var relPath = 'word/_rels/document.xml.rels';
      var relNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
      var relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml';
      return (zip.file(relPath) ? zip.file(relPath).async('string') : Promise.resolve('<Relationships xmlns="' + relNS + '"/>')).then(function(raw) {
        var relDoc = new DOMParser().parseFromString(raw, 'application/xml');
        var rels = Array.from(relDoc.getElementsByTagNameNS(relNS, 'Relationship'));
        var found = rels.some(function(r) { return r.getAttribute('Type') === relType && r.getAttribute('Target') === '../' + METADATA_PATH; });
        if (!found) {
          var id = 'rIdCitationConverterMetadata', n = 1;
          while (rels.some(function(r) { return r.getAttribute('Id') === id; })) id = 'rIdCitationConverterMetadata' + n++;
          var r = relDoc.createElementNS(relNS, 'Relationship');
          r.setAttribute('Id', id); r.setAttribute('Type', relType); r.setAttribute('Target', '../' + METADATA_PATH);
          relDoc.documentElement.appendChild(r);
          zip.file(relPath, new XMLSerializer().serializeToString(relDoc));
        }
        return zip.file('[Content_Types].xml').async('string');
      }).then(function(raw) {
        var types = new DOMParser().parseFromString(raw, 'application/xml');
        var ns = 'http://schemas.openxmlformats.org/package/2006/content-types';
        if (!Array.from(types.getElementsByTagNameNS(ns, 'Default')).some(function(d) { return d.getAttribute('Extension') === 'xml'; })) {
          var d = types.createElementNS(ns, 'Default'); d.setAttribute('Extension', 'xml'); d.setAttribute('ContentType', 'application/xml');
          types.documentElement.appendChild(d); zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(types));
        }
      });
    });
  }

  // Finds the <w:p> element whose text range contains a given offset into the flat index text.
  function paragraphAtOffset(index, offset) {
    for (var i = 0; i < index.paragraphs.length; i++) {
      var pi = index.paragraphs[i];
      if (offset >= pi.start && offset < pi.end) return pi.element;
    }
    return null;
  }

  // Physically reorders a set of <w:p> elements to match `orderedElements` (target order),
  // in place, right where the FIRST of them currently sits — so the printed/visible order in
  // Word matches the new numbering exactly (e.g. IEEE/Vancouver reference lists must read
  // [1], [2], [3]... top to bottom, not just have that text baked in while the paragraphs stay
  // in their original (e.g. alphabetical) order). Entries that couldn't be located in the
  // original document (null) are simply skipped — left wherever they were, same as before.
  function reorderParagraphs(xmlDoc, orderedElements) {
    var valid = orderedElements.filter(Boolean);
    if (valid.length === 0) return 0;
    var parents = new Set(valid.map(function(el) { return el.parentNode; }));
    if (parents.size !== 1 || new Set(valid).size !== valid.length) throw new Error('Referensi berada pada struktur yang berbeda atau span tumpang tindih. Urutan tidak diubah.');
    var first = valid[0];
    var parent = first.parentNode;
    if (!parent) return 0;
    for (var i = 0; i < parent.childNodes.length; i++) { if (valid.indexOf(parent.childNodes[i]) !== -1) { first = parent.childNodes[i]; break; } }
    var placeholder = xmlDoc.createComment('ref-reorder-anchor');
    parent.insertBefore(placeholder, first);
    valid.forEach(function(el) { if (el.parentNode) el.parentNode.removeChild(el); });
    valid.forEach(function(el) { parent.insertBefore(el, placeholder); });
    parent.removeChild(placeholder);
    return valid.length;
  }

  function loadDocxTextIndex(file) {
    return file.arrayBuffer()
      .then(function(buf) { return JSZip.loadAsync(buf); })
      .then(function(zip) {
        var docPath = 'word/document.xml';
        if (!zip.file(docPath)) throw new Error('word/document.xml tidak ditemukan di dalam file .docx.');
        return zip.file(docPath).async('string').then(function(xmlString) {
          var xmlDoc = new DOMParser().parseFromString(xmlString, 'application/xml');
          if (xmlDoc.getElementsByTagName('parsererror').length > 0) throw new Error('Gagal membaca struktur XML .docx.');
          return readConversionMetadata(zip).then(function(metadata) { var index = buildDocxTextIndex(xmlDoc); index.metadata = metadata; return index; });
        });
      });
  }

  function makeRun(xmlDoc, templateRunEl, textValue, forceItalic) {
    if (!textValue) return null;
    var newRun = xmlDoc.createElementNS(W_NS, 'w:r');
    var properties = templateRunEl.getElementsByTagNameNS(W_NS, 'rPr')[0];
    if (properties) newRun.appendChild(properties.cloneNode(true));
    // The template run is being reused PURELY for its formatting (rPr) — any actual content it
    // carried (a tab, a line break, a manual hyphen) must NOT be replicated into every new run
    // built from it, or a single hanging-indent tab meant to appear once, right at the start of
    // the paragraph, ends up duplicated into the middle of the text on every rebuilt run instead
    // (visually this can throw off far more than spacing — a stray mid-run tab character can
    // make a renderer jump to a tab stop and badly distort that run's apparent size/position).
    ['w:tab', 'w:br', 'w:cr', 'w:noBreakHyphen'].forEach(function(tag) {
      var els = newRun.getElementsByTagName(tag);
      for (var k = els.length - 1; k >= 0; k--) els[k].parentNode.removeChild(els[k]);
    });
    var tNodes = newRun.getElementsByTagName('w:t');
    var tNode = tNodes[0];
    if (!tNode) {
      tNode = xmlDoc.createElementNS(W_NS, 'w:t');
      newRun.appendChild(tNode);
    } else {
      for (var i = tNodes.length - 1; i >= 1; i--) tNodes[i].parentNode.removeChild(tNodes[i]);
    }
    tNode.textContent = textValue;
    tNode.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    // forceItalic (true/false) explicitly sets italic regardless of the template run's own
    // formatting — needed because a new italic span (the journal name, or the volume number)
    // often has to be MANUFACTURED from a template run that was never italic in the source at
    // all (see rewriteReferenceParagraphToApa7: many real reference lists never italicize the
    // journal name to begin with, so there's no existing italic run to clone formatting from).
    if (forceItalic === true || forceItalic === false) {
      var rPr = newRun.getElementsByTagName('w:rPr')[0];
      if (!rPr) {
        rPr = xmlDoc.createElementNS(W_NS, 'w:rPr');
        newRun.insertBefore(rPr, newRun.firstChild);
      }
      ['i', 'iCs'].forEach(function(tag) {
        var item = rPr.getElementsByTagNameNS(W_NS, tag)[0];
        if (!item) { item = xmlDoc.createElementNS(W_NS, 'w:' + tag); rPr.appendChild(item); }
        item.setAttributeNS(W_NS, 'w:val', forceItalic ? '1' : '0');
      });
    }
    return newRun;
  }

  function runIsItalic(runEl) {
    var rPr = runEl.getElementsByTagName('w:rPr')[0];
    var item = rPr && rPr.getElementsByTagName('w:i')[0];
    return !!(item && !/^(0|false|off)$/i.test(item.getAttributeNS(W_NS, 'val')));
  }

  function directChildRuns(paraEl) {
    var out = [];
    for (var i = 0; i < paraEl.childNodes.length; i++) {
      if (paraEl.childNodes[i].nodeType === 1 && paraEl.childNodes[i].tagName === 'w:r') out.push(paraEl.childNodes[i]);
    }
    return out;
  }

  // Some documents number their numeric-family (IEEE/Vancouver) reference list via Word's own
  // native numbered-list paragraph formatting (<w:numPr>, pointing at a list definition in
  // numbering.xml) rather than literal "[1] " text — the visible bracket number is then rendered
  // by Word itself from that list format, and never appears in the paragraph's own <w:t> runs at
  // all. Stripping literal "[N] " text runs (elsewhere in this file) does nothing for that case:
  // the reformatted paragraph would still visibly show "[1] Author, A. (2020)...", "[2] ...", "
  // because Word keeps auto-numbering it — a leftover numeric-style marker on what's now
  // supposed to be an un-numbered APA7 entry. Removing the <w:numPr> (if present) turns that
  // auto-numbering off for the paragraph.
  function removeListNumbering(paraEl) {
    var pPr = paraEl.getElementsByTagName('w:pPr')[0];
    if (!pPr) return;
    var numPr = pPr.getElementsByTagName('w:numPr')[0];
    if (numPr && numPr.parentNode) numPr.parentNode.removeChild(numPr);
  }

  function runText(runEl) {
    var t = runEl.getElementsByTagName('w:t')[0];
    return t ? (t.textContent || '') : '';
  }

  // Rewrites a numeric-source (IEEE/Vancouver) reference paragraph into a genuine APA7
  // bibliographic entry — not just the author-name swap the rest of this file limits itself to:
  // year moves into parentheses after the author(s), the quoted title loses its quote marks, the
  // volume number becomes italic (newly — it never was in IEEE), and "vol./no./pp./doi:" become
  // "16(1), 39" / "https://doi.org/...".
  //
  // Tries a TEXT-based approach first: ref.journal / ref.title were already extracted as plain
  // strings by parseReferenceLine, independent of any formatting, so locating that exact text
  // within the paragraph's own content tells us exactly where the italic span belongs — a NEW
  // italic run can simply be manufactured there (see makeRun's forceItalic) even when nothing in
  // the source was ever italicized at all. This matters because relying on the source ALREADY
  // having correct italic formatting (the only approach this used to have) leaves the entire
  // reference list stuck on the safe author-only fallback for any document that doesn't
  // italicize journal names in the first place — which real manuscripts do fairly often,
  // independent of anything else being wrong with them.
  //
  // Falls back to the OLDER, italic-run-based detection (rewriteReferenceParagraphViaItalicRuns)
  // if the text-based lookup can't find ref.journal/ref.title verbatim in the paragraph (rare —
  // e.g. a subtle whitespace or entity difference) — that method still helps on paragraphs that
  // DO have reliable italic formatting to go on. If neither works, the caller's own safe
  // author-only swap is what ends up in the output, same as before either of these existed.
  function rewriteReferenceParagraphToApa7(xmlDoc, paraEl, ref, authorApa) {
    var allOriginalRuns = directChildRuns(paraEl);
    var runs = allOriginalRuns.slice();
    function isNumberingOrEmptyRun(r) {
      var txt = runText(r);
      return /^\s*\[?\d+\]?\.?\s*$/.test(txt);
    }
    while (runs.length && isNumberingOrEmptyRun(runs[0])) runs.shift();
    if (runs.length === 0) return false;

    var templateRun = runs[0];
    var fullContentText = runs.map(runText).join('');
    var isBook = !/["“]/.test(ref.raw);
    var newNodes = null;

    if (ref.isBookChapter) {
      // Book chapter with a named editor — the italic span is the BOOK title (ref.journal, per
      // extractBibliographicFields' book-chapter detection), not the chapter title itself,
      // which stays plain like a journal article's title does. Editor name(s) need no
      // reformatting: APA7 keeps an editor in the SAME non-inverted "Initial. Surname" order
      // IEEE already writes them in (only regular authors get inverted), and an institutional
      // editor is used verbatim either way.
      var bookTitleForChapter = ref.journal ? ref.journal.replace(/^in\s+/i, '') : null;
      var chapterTitleIdx = bookTitleForChapter ? fullContentText.indexOf(bookTitleForChapter) : -1;
      if (chapterTitleIdx !== -1) {
        var editorSuffixDocx = ref.editorIsPlural ? ' (Eds.), ' : ' (Ed.), ';
        var pagesPartDocx = ref.pages ? ' (pp. ' + ref.pages + ')' : '';
        var chapterDoiPart = ref.doi ? ('https://doi.org/' + ref.doi) : null;
        newNodes = [
          makeRun(xmlDoc, templateRun, authorApa + ' (' + (ref.year || 'n.d.') + '). ' + (ref.title || '') + '. In ' + (ref.editor || '') + editorSuffixDocx, false),
          makeRun(xmlDoc, templateRun, bookTitleForChapter, true),
          makeRun(xmlDoc, templateRun, pagesPartDocx + '. ' + (ref.publisher || '') + (chapterDoiPart ? '. ' + chapterDoiPart : '.'), false),
        ];
      }
    } else if (isBook) {
      var bookTitle = ref.title;
      var titleIdx = bookTitle ? fullContentText.indexOf(bookTitle) : -1;
      if (titleIdx !== -1) {
        var beforeTitle = fullContentText.slice(0, titleIdx);
        var afterTitleText = fullContentText.slice(titleIdx + bookTitle.length);
        var publisher = CC._internal.deriveBookPublisher(afterTitleText, ref.year);
        var bookDoiPart = ref.doi ? ('https://doi.org/' + ref.doi) : null;
        newNodes = [
          makeRun(xmlDoc, templateRun, authorApa + ' (' + (ref.year || 'n.d.') + '). ', false),
          makeRun(xmlDoc, templateRun, bookTitle, true),
          makeRun(xmlDoc, templateRun, '. ' + publisher + (bookDoiPart ? '. ' + bookDoiPart : '.'), false),
        ];
      }
    } else {
      var journalRaw = ref.journal ? ref.journal.replace(/^in\s+/i, '') : null;
      var journalIdx = journalRaw ? fullContentText.indexOf(journalRaw) : -1;
      if (journalIdx !== -1) {
        var afterJournalText = fullContentText.slice(journalIdx + journalRaw.length);
        var tail = CC._internal.parseNumericReferenceTail(afterJournalText);
        var doiPart = tail.doi ? ('https://doi.org/' + tail.doi) : null;
        if (!tail.volume && tail.pages) {
          newNodes = [
            makeRun(xmlDoc, templateRun, authorApa + ' (' + (ref.year || 'n.d.') + '). ' + (ref.title || '') + '. In ', false),
            makeRun(xmlDoc, templateRun, journalRaw, true),
            makeRun(xmlDoc, templateRun, ' (pp. ' + tail.pages + ')' + (doiPart ? '. ' + doiPart : '.'), false),
          ];
        } else {
          newNodes = [
            makeRun(xmlDoc, templateRun, authorApa + ' (' + (ref.year || 'n.d.') + '). ' + (ref.title || '') + '. ', false),
            makeRun(xmlDoc, templateRun, journalRaw, true),
          ];
          if (tail.volume) {
            var afterVol = '';
            if (tail.issue) afterVol += '(' + tail.issue + ')';
            if (tail.pages) afterVol += ', ' + tail.pages;
            afterVol += doiPart ? '. ' + doiPart : '.';
            newNodes.push(makeRun(xmlDoc, templateRun, ', ', false));
            newNodes.push(makeRun(xmlDoc, templateRun, tail.volume, true));
            newNodes.push(makeRun(xmlDoc, templateRun, afterVol, false));
          } else {
            newNodes.push(makeRun(xmlDoc, templateRun, doiPart ? '. ' + doiPart : '.', false));
          }
        }
      }
    }

    if (!newNodes) return rewriteReferenceParagraphViaItalicRuns(xmlDoc, paraEl, ref, authorApa, allOriginalRuns, runs, isNumberingOrEmptyRun);

    var anchor = allOriginalRuns[0];
    newNodes.forEach(function(n) { if (n) paraEl.insertBefore(n, anchor); });
    allOriginalRuns.forEach(function(r) { if (r.parentNode) r.parentNode.removeChild(r); });
    return true;
  }

  // The ORIGINAL approach, kept as a fallback: locates the italic span by looking at which runs
  // the SOURCE document already italicized, rather than by matching ref.journal/ref.title text.
  // Only reached when the text-based lookup above can't find that text verbatim (see caller).
  function rewriteReferenceParagraphViaItalicRuns(xmlDoc, paraEl, ref, authorApa, allOriginalRuns, runs, isNumberingOrEmptyRun) {
    var italicIndices = [];
    for (var i = 0; i < runs.length; i++) {
      if (runIsItalic(runs[i]) && runText(runs[i]).trim()) italicIndices.push(i);
    }
    if (italicIndices.length === 0) return false; // no italic run at all — shape not recognized
    var italicStart = italicIndices[0], italicEnd = italicIndices[italicIndices.length - 1];
    for (var j = italicStart; j <= italicEnd; j++) {
      if (!runIsItalic(runs[j])) return false; // a non-italic run breaks up the italic block — genuinely ambiguous, not just fragmented
    }

    var beforeRuns = runs.slice(0, italicStart);
    var italicRuns = runs.slice(italicStart, italicEnd + 1); // the whole contiguous block, however fragmented
    var italicTemplateRun = italicRuns[0]; // formatting template for the NEW italic volume run below
    var afterRuns = runs.slice(italicEnd + 1);
    if (beforeRuns.length === 0 || afterRuns.length === 0) return false;
    var tailText = afterRuns.map(runText).join('');

    // "Book-like" (the italic run IS the title itself, not a separate journal/proceedings name
    // after a quoted title) is decided by whether the raw reference has ANY quote marks at all —
    // not by volume/pages/doi presence. Those can each be genuinely present OR absent on either
    // kind of reference (a report can have a DOI, like UNESCO's does here; a conference paper's
    // page range can fail to extract via ref.pages when there's no "vol." prefix before it — a
    // separate, known gap in parseReferenceLine's own field extraction, which is exactly why
    // parseNumericReferenceTail below re-derives volume/issue/pages/doi straight from the actual
    // tail text instead of trusting ref's fields for this). Quote-mark presence is a clean
    // structural signal neither of those gaps can confuse: IEEE always quotes an article's
    // title and never quotes a book's.
    var isBook = !/["“]/.test(ref.raw);
    var newNodes = [];
    if (isBook) {
      var publisher = CC._internal.deriveBookPublisher(tailText, ref.year);
      var bookDoiPart = ref.doi ? ('https://doi.org/' + ref.doi) : null;
      newNodes.push(makeRun(xmlDoc, beforeRuns[0], authorApa + ' (' + (ref.year || 'n.d.') + '). '));
      italicRuns.forEach(function(r) { newNodes.push(r.cloneNode(true)); }); // book title — already correct, untouched
      newNodes.push(makeRun(xmlDoc, afterRuns[0], '. ' + publisher + (bookDoiPart ? '. ' + bookDoiPart : '.')));
    } else {
      var tail = CC._internal.parseNumericReferenceTail(tailText);
      var doiPart = tail.doi ? ('https://doi.org/' + tail.doi) : null;
      if (!tail.volume && tail.pages) {
        // conference proceedings with no volume of its own -> "In <Proceedings> (pp. X-Y)."
        newNodes.push(makeRun(xmlDoc, beforeRuns[0], authorApa + ' (' + (ref.year || 'n.d.') + '). ' + (ref.title || '') + '. In '));
        italicRuns.forEach(function(r) { newNodes.push(r.cloneNode(true)); });
        newNodes.push(makeRun(xmlDoc, afterRuns[0], ' (pp. ' + tail.pages + ')' + (doiPart ? '. ' + doiPart : '.')));
      } else {
        newNodes.push(makeRun(xmlDoc, beforeRuns[0], authorApa + ' (' + (ref.year || 'n.d.') + '). ' + (ref.title || '') + '. '));
        italicRuns.forEach(function(r) { newNodes.push(r.cloneNode(true)); });
        if (tail.volume) {
          var afterVol = '';
          if (tail.issue) afterVol += '(' + tail.issue + ')';
          if (tail.pages) afterVol += ', ' + tail.pages;
          afterVol += doiPart ? '. ' + doiPart : '.';
          newNodes.push(makeRun(xmlDoc, afterRuns[0], ', '));
          newNodes.push(makeRun(xmlDoc, italicTemplateRun, tail.volume)); // clone italic formatting for the volume
          newNodes.push(makeRun(xmlDoc, afterRuns[0], afterVol));
        } else {
          newNodes.push(makeRun(xmlDoc, afterRuns[0], doiPart ? '. ' + doiPart : '.'));
        }
      }
    }

    var anchor = allOriginalRuns[0];
    newNodes.forEach(function(n) { if (n) paraEl.insertBefore(n, anchor); });
    allOriginalRuns.forEach(function(r) { if (r.parentNode) r.parentNode.removeChild(r); });
    return true;
  }

  // Replaces each {start,end,text} span (in the index's coordinate space) directly in the live
  // XML DOM, splitting runs as needed so every OTHER run/formatting stays untouched. Matches
  // must be pre-sorted & non-overlapping (caller's responsibility).
  //
  // Grouped by which original segment (<w:t> node) each match falls in, and every match in a
  // shared segment is applied together in one pass — NOT one match at a time against the same
  // static segment list. A single run can legitimately contain more than one citation to replace
  // (e.g. two adjacent bracket citations in one sentence sharing a paragraph-spanning run), and
  // conversely a SINGLE match (e.g. a whole reference-list entry being swapped as one span) can
  // legitimately spread across MULTIPLE segments — a plain reference line is often split into
  // several runs internally (a separately-styled "doi" label is common). A match's replacement
  // text must be written only ONCE across however many segments it touches; every segment after
  // the first just needs its portion of the ORIGINAL text removed, not the replacement inserted
  // again — writtenMatchKeys tracks that globally, since without it a match spanning N segments
  // ends up with its full replacement text duplicated N times (found via a real reference whose
  // "doi:" label sat in its own separately-styled run, tripling that reference's printed text).
  function applyPlainReplacements(xmlDoc, index, matches) {
    var segMatches = index.segments.map(function() { return []; });
    matches.forEach(function(m) {
      index.segments.forEach(function(seg, i) {
        if (seg.start < m.end && seg.end > m.start) segMatches[i].push(m);
      });
    });

    var appliedKeys = {};
    var writtenMatchKeys = {};
    index.segments.forEach(function(seg, i) {
      var ms = segMatches[i];
      if (ms.length === 0) return;
      if (!seg.node.parentNode) return;
      var fullText = seg.node.textContent;
      ms.sort(function(a, b) { return a.start - b.start; });
      var pieces = [];
      var cursor = 0;
      ms.forEach(function(m) {
        var key = m.start + ':' + m.end;
        var s = Math.max(m.start, seg.start) - seg.start;
        var e = Math.min(m.end, seg.end) - seg.start;
        if (s > cursor) pieces.push(fullText.slice(cursor, s));
        if (!writtenMatchKeys[key]) {
          pieces.push(m.text);
          writtenMatchKeys[key] = true;
        }
        cursor = e;
        appliedKeys[key] = true;
      });
      if (cursor < fullText.length) pieces.push(fullText.slice(cursor));
      // Edit only this text node. Cloning/deleting its run loses sibling <w:t>, tabs,
      // drawings, field markers and other non-text content sharing the same run.
      seg.node.textContent = pieces.join('');
      seg.node.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    });
    return Object.keys(appliedKeys).length;
  }

  // Date + time-of-day stamp (not just the date) so downloading more than once on the same day
  // always produces a distinct filename instead of silently overwriting the previous download.
  function fileTimestamp() {
    var now = new Date();
    var dateStr = now.toISOString().slice(0, 10);
    var timeStr = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(function(n) { return String(n).padStart(2, '0'); }).join('');
    return dateStr + '-' + timeStr;
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 4000);
  }

  function setExportStatus(msg, kind) {
    els.exportStatus.textContent = msg;
    els.exportStatus.className = 'status ' + (kind || 'info');
  }

  function refreshOriginalExportAvailability() {
    var result = state.lastResult;
    var ready = !!(state.originalFile && result &&
      els.articleText.value.trim() === state.docxOriginalArticleText &&
      els.referenceText.value.trim() === state.docxOriginalReferenceText &&
      els.convertedArticleOut.value === state.autoConvertedArticle &&
      els.convertedRefsOut.value === state.autoConvertedRefs &&
      (els.sourceStyleSelect.value === 'auto' || els.sourceStyleSelect.value === result.sourceStyleId) &&
      els.targetStyleSelect.value === result.targetStyleId &&
      JSON.stringify(readSourceDetails()) === state.lastDetailsJSON);
    els.btnExportDocxOriginal.disabled = !ready;
    return ready;
  }
  [els.articleText, els.referenceText, els.convertedArticleOut, els.convertedRefsOut,
    els.sourceStyleSelect, els.targetStyleSelect].forEach(function(el) {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function() {
      if (!refreshOriginalExportAvailability() && state.originalFile && state.lastResult) {
        setExportStatus('Input/gaya/hasil telah berubah. Jalankan konversi ulang; suntingan manual pada hasil tersedia dalam ekspor teks polos.', 'warn');
      }
    });
  });

  function writeReferenceRuns(xmlDoc, paraEl, richRuns, targetStyleId) {
    var originalRuns = Array.from(paraEl.getElementsByTagNameNS(W_NS, 'r'));
    if (!originalRuns.length) throw new Error('Paragraf referensi tidak mempunyai run teks.');
    if (paraEl.getElementsByTagNameNS(W_NS, 'fldChar').length || paraEl.getElementsByTagNameNS(W_NS, 'sdt').length ||
        paraEl.getElementsByTagNameNS(W_NS, 'drawing').length) {
      throw new Error('Referensi masih memiliki field/content control/gambar aktif. Gunakan salinan dengan referensi berupa teks statis sebelum konversi.');
    }
    var template = originalRuns[0];
    var content = Array.from(paraEl.childNodes).filter(function(node) {
      return node.nodeType === 1 && (node.localName === 'r' || node.localName === 'hyperlink');
    });
    var anchor = content[0];
    if (!anchor) throw new Error('Struktur paragraf referensi belum didukung.');
    richRuns.forEach(function(piece, index) {
      var value = piece.text;
      if (targetStyleId === 'ieee' && index === 0) {
        var label = value.match(/^\[\d+\] /);
        if (label) {
          var labelRun = makeRun(xmlDoc, template, label[0], false);
          labelRun.appendChild(xmlDoc.createElementNS(W_NS, 'w:tab'));
          paraEl.insertBefore(labelRun, anchor); value = value.slice(label[0].length);
        }
      }
      var r = makeRun(xmlDoc, template, value, piece.italic);
      if (r) paraEl.insertBefore(r, anchor);
    });
    content.forEach(function(node) { paraEl.removeChild(node); });
    var pPr = paraEl.getElementsByTagNameNS(W_NS, 'pPr')[0];
    if (!pPr) { pPr = xmlDoc.createElementNS(W_NS, 'w:pPr'); paraEl.insertBefore(pPr, paraEl.firstChild); }
    var numPr = pPr.getElementsByTagNameNS(W_NS, 'numPr')[0];
    if (!numPr) { numPr = xmlDoc.createElementNS(W_NS, 'w:numPr'); pPr.appendChild(numPr); }
    while (numPr.firstChild) numPr.removeChild(numPr.firstChild);
    var numId = xmlDoc.createElementNS(W_NS, 'w:numId'); numId.setAttributeNS(W_NS, 'w:val', '0'); numPr.appendChild(numId);
    // Disable inherited Word numbering too; IEEE numbers are already literal text.
    var ind = pPr.getElementsByTagNameNS(W_NS, 'ind')[0];
    if (!ind) { ind = xmlDoc.createElementNS(W_NS, 'w:ind'); pPr.appendChild(ind); }
    ['firstLine', 'firstLineChars', 'hangingChars', 'leftChars', 'rightChars', 'startChars', 'endChars', 'start', 'end'].forEach(function(attr) { ind.removeAttributeNS(W_NS, attr); });
    ind.setAttributeNS(W_NS, 'w:left', '720');
    ind.setAttributeNS(W_NS, 'w:hanging', '720');
    // A half-inch column also accommodates multi-digit labels at the source font size;
    // a quarter-inch stop can be overrun by [10] and send it to a different tab stop.
    var tabs = pPr.getElementsByTagNameNS(W_NS, 'tabs')[0];
    if (tabs) pPr.removeChild(tabs);
    if (targetStyleId === 'ieee') {
      tabs = xmlDoc.createElementNS(W_NS, 'w:tabs');
      var tab = xmlDoc.createElementNS(W_NS, 'w:tab');
      tab.setAttributeNS(W_NS, 'w:val', 'left'); tab.setAttributeNS(W_NS, 'w:pos', '720');
      tabs.appendChild(tab); pPr.appendChild(tabs);
    }
    var alignment = pPr.getElementsByTagNameNS(W_NS, 'jc')[0];
    if (!alignment) { alignment = xmlDoc.createElementNS(W_NS, 'w:jc'); pPr.appendChild(alignment); }
    alignment.setAttributeNS(W_NS, 'w:val', 'left');
    var spacing = pPr.getElementsByTagNameNS(W_NS, 'spacing')[0];
    if (!spacing) { spacing = xmlDoc.createElementNS(W_NS, 'w:spacing'); pPr.appendChild(spacing); }
    spacing.setAttributeNS(W_NS, 'w:line', targetStyleId === 'apa7' ? '480' : '240');
    spacing.setAttributeNS(W_NS, 'w:lineRule', 'auto');
    spacing.setAttributeNS(W_NS, 'w:before', '0'); spacing.setAttributeNS(W_NS, 'w:after', '0');
    spacing.setAttributeNS(W_NS, 'w:beforeAutospacing', '0'); spacing.setAttributeNS(W_NS, 'w:afterAutospacing', '0');
    var snap = pPr.getElementsByTagNameNS(W_NS, 'snapToGrid')[0];
    if (!snap) { snap = xmlDoc.createElementNS(W_NS, 'w:snapToGrid'); pPr.appendChild(snap); }
    snap.setAttributeNS(W_NS, 'w:val', '0');
    // Keep paragraph properties in OOXML schema order, including any original properties.
    var order = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
    var properties = Array.from(pPr.childNodes).filter(function(node) { return node.nodeType === 1; });
    properties.sort(function(a, b) { var ai = order.indexOf(a.localName), bi = order.indexOf(b.localName); return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi); });
    properties.forEach(function(node) { pPr.appendChild(node); });
  }

  // The exact same result supplies the preview, TXT, plain DOCX and formatted DOCX.
  // No hidden CrossRef request or alternate reference formatter runs during export.
  els.btnExportDocxOriginal.addEventListener('click', function() {
    if (!refreshOriginalExportAvailability()) return;
    if (typeof JSZip === 'undefined') { setExportStatus('JSZip gagal dimuat.', 'err'); return; }
    var result = state.lastResult;
    var originalFile = state.originalFile;
    setExportStatus('Memproses file .docx...', 'info');
    els.btnExportDocxOriginal.disabled = true;
    originalFile.arrayBuffer().then(function(buf) { return JSZip.loadAsync(buf); }).then(function(zip) {
      return zip.file('word/document.xml').async('string').then(function(xmlString) {
        var xmlDoc = new DOMParser().parseFromString(xmlString, 'application/xml');
        var index = buildDocxTextIndex(xmlDoc);
        var split = splitDocxIndex(index);
        if (!split || split.article !== state.lastSourceText || split.references !== state.docxOriginalReferenceText) {
          throw new Error('Teks sumber DOCX berbeda dari pratinjau. Unggah ulang dan jalankan konversi.');
        }
        var locations = result.referenceLines.map(function(rl) {
          var candidates = index.paragraphs.filter(function(pi) {
            return pi.start >= split.refStart && pi.start < split.refEnd && index.text.slice(pi.start, pi.end).trim() === rl.original;
          });
          if (candidates.length !== 1) throw new Error('Satu referensi tidak dapat dipetakan secara unik ke satu paragraf. Format asli belum dapat diekspor dengan aman.');
          return candidates[0].element;
        });
        var matches = result.citationSpans.filter(function(s) { return s.matched; }).map(function(s) {
          return { start: s.start + split.articleOffset, end: s.end + split.articleOffset, text: s.replacement };
        });
        var count = applyPlainReplacements(xmlDoc, index, matches);
        if (count !== matches.length) throw new Error('Tidak semua sitasi dapat diterapkan. File keluaran dibatalkan.');
        result.referenceLines.forEach(function(rl, i) {
          if (rl.runs) writeReferenceRuns(xmlDoc, locations[i], rl.runs, result.targetStyleId);
          else {
            var current = buildDocxTextIndex(xmlDoc);
            var pi = current.paragraphs.find(function(p) { return p.element === locations[i]; });
            var raw = current.text.slice(pi.start, pi.end);
            var offset = raw.indexOf(rl.original);
            applyPlainReplacements(xmlDoc, current, [{ start: pi.start + offset, end: pi.start + offset + rl.original.length, text: rl.line }]);
          }
        });
        reorderParagraphs(xmlDoc, locations);
        var verification = splitDocxIndex(buildDocxTextIndex(xmlDoc));
        if (verification.article !== result.convertedArticle || verification.references !== result.referenceLines.map(function(rl) { return rl.line; }).join('\n')) {
          throw new Error('Hasil DOCX tidak sama dengan pratinjau. File keluaran dibatalkan.');
        }
        zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + new XMLSerializer().serializeToString(xmlDoc.documentElement));
        return writeConversionMetadata(zip, result.metadata).then(function() {
          return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        });
      });
    }).then(function(blob) {
      triggerDownload(blob, originalFile.name.replace(/\.docx$/i, '') + '-' + result.targetStyleId.toUpperCase() + '-' + fileTimestamp() + '.docx');
      setExportStatus('✅ DOCX cocok dengan pratinjau: ' + result.changedCount + ' sitasi berubah, ' + result.referenceLines.length + ' referensi. Metadata penulis lengkap disimpan untuk konversi balik.' +
        (result.unmatched.length ? ' ' + result.unmatched.length + ' sitasi tanpa pasangan tetap dipertahankan.' : '') +
        ((result.referenceIssues || []).length ? ' Ada referensi yang perlu dicek manual.' : ''), result.unmatched.length ? 'warn' : 'ok');
    }).catch(function(err) { setExportStatus('⚠️ ' + err.message, 'err'); }).finally(refreshOriginalExportAvailability);
  });

  // ---------- Export: fresh plain .docx built from current (possibly edited) textareas ----------
  function buildMinimalDocx(articleText, referenceText, metadata) {
    var paragraphs = [];
    articleText.split(/\n+/).forEach(function(line) { if (line.trim()) paragraphs.push(line.trim()); });
    paragraphs.push('');
    var headingIndex = paragraphs.length;
    paragraphs.push(metadata && metadata.styleId === 'apa7' ? 'References' : 'REFERENCES');
    referenceText.split(/\n+/).forEach(function(line) { if (line.trim()) paragraphs.push(line.trim()); });

    function xesc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    var body = paragraphs.map(function(line, index) {
      var heading = index === headingIndex && metadata && (metadata.styleId === 'apa7' || metadata.styleId === 'ieee');
      return '<w:p>' + (heading ? '<w:pPr>' + (metadata.styleId === 'apa7' ? '<w:pageBreakBefore/>' : '') + '<w:jc w:val="center"/></w:pPr>' : '') +
        '<w:r>' + (heading ? '<w:rPr><w:b/></w:rPr>' : '') + '<w:t xml:space="preserve">' + xesc(line) + '</w:t></w:r></w:p>';
    }).join('');

    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<w:document xmlns:w="' + W_NS + '"><w:body>' + body + '<w:sectPr/></w:body></w:document>';
    // Plain export means a new document, without the manuscript's layout. References that
    // still match the conversion retain the target style's italics, spacing and indentation.
    if (metadata && (metadata.styleId === 'apa7' || metadata.styleId === 'ieee')) {
      var richDoc = new DOMParser().parseFromString(documentXml, 'application/xml');
      var ps = Array.from(richDoc.getElementsByTagNameNS(W_NS, 'p'));
      var referenceStart = headingIndex + 1;
      ps.slice(referenceStart).forEach(function(p, index) {
        var line = paragraphs[referenceStart + index];
        var entries = (metadata.entries || []).filter(function(e) { return e.line === line; });
        if (entries.length !== 1) return;
        var model = entries[0].model;
        var ref = { bibliography: model, isInstitutional: model.authors.every(function(a) { return a.institutional; }), authorCount: model.authorCount || model.authors.length };
        var label = line.match(/^\[(\d+)\]/);
        var rendered = CC._internal.renderBibliography(ref, metadata.styleId, label ? +label[1] : index + 1);
        if (rendered && rendered.line === line) writeReferenceRuns(richDoc, p, rendered.runs, metadata.styleId);
      });
      documentXml = new XMLSerializer().serializeToString(richDoc);
    }
    var contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';
    var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';

    var zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypesXml);
    zip.file('_rels/.rels', relsXml);
    zip.file('word/document.xml', documentXml);
    return (metadata ? writeConversionMetadata(zip, metadata) : Promise.resolve()).then(function() {
      return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    });
  }

  els.btnExportDocxPlain.addEventListener('click', function() {
    if (typeof JSZip === 'undefined') { setExportStatus('⚠️ Library JSZip gagal dimuat.', 'err'); return; }
    var article = els.convertedArticleOut.value.trim();
    var refs = els.convertedRefsOut.value.trim();
    if (!article) { setExportStatus('⚠️ Belum ada hasil konversi untuk diekspor.', 'warn'); return; }
    setExportStatus('Membuat file .docx...', 'info');
    buildMinimalDocx(article, refs, state.lastResult && state.lastResult.metadata)
      .then(function(blob) {
        var dateStr = fileTimestamp();
        triggerDownload(blob, 'sitasi-konversi-' + dateStr + '.docx');
        setExportStatus('✅ File .docx (dokumen baru) berhasil diunduh.', 'ok');
      })
      .catch(function(err) { setExportStatus('⚠️ Gagal membuat .docx: ' + err.message, 'err'); });
  });

  // ---------- Export: plain .txt ----------
  els.btnExportTxt.addEventListener('click', function() {
    var article = els.convertedArticleOut.value.trim();
    var refs = els.convertedRefsOut.value.trim();
    if (!article) { setExportStatus('⚠️ Belum ada hasil konversi untuk diekspor.', 'warn'); return; }
    var content = article + '\n\nREFERENCES\n' + refs + '\n';
    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    var dateStr = fileTimestamp();
    triggerDownload(blob, 'sitasi-konversi-' + dateStr + '.txt');
    setExportStatus('✅ File .txt berhasil diunduh.', 'ok');
  });
})();
