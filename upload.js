(function() {
  var CE = window.CitationEngine;
  var STYLES = CE.STYLES;

  var els = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    fileChip: document.getElementById('fileChip'),
    fileIcon: document.getElementById('fileIcon'),
    fileName: document.getElementById('fileName'),
    fileSize: document.getElementById('fileSize'),
    fileRemove: document.getElementById('fileRemove'),
    styleSelect: document.getElementById('styleSelect'),
    yrFrom: document.getElementById('yrFrom'),
    yrTo: document.getElementById('yrTo'),
    yrApplyCustom: document.getElementById('yrApplyCustom'),
    includeDoi: document.getElementById('includeDoi'),
    processBtn: document.getElementById('processBtn'),
    statusMsg: document.getElementById('statusMsg'),
    manualFix: document.getElementById('manualFix'),
    manualArticle: document.getElementById('manualArticle'),
    manualReferences: document.getElementById('manualReferences'),
    manualProcessBtn: document.getElementById('manualProcessBtn'),
    results: document.getElementById('results'),
    summaryGrid: document.getElementById('summaryGrid'),
    yearRangeSummary: document.getElementById('yearRangeSummary'),
    reportPreview: document.getElementById('reportPreview'),
    downloadBtn: document.getElementById('downloadBtn'),
    downloadStatus: document.getElementById('downloadStatus'),
  };

  var state = {
    fileText: null,
    fileName: null,
    yearRange: CE.YearRange.presetToRange(5),
    lastResult: null,
    lastDoiIssues: [],
    lastStyleId: null,
    lastConfidence: null,
  };

  function setStatus(msg, kind) {
    els.statusMsg.textContent = msg || '';
    els.statusMsg.className = 'status ' + (kind || 'info');
  }

  function esc(t) { return CE.esc(t); }

  // ---------- File input handling ----------
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
    state.fileText = null; state.fileName = null;
    els.fileChip.classList.remove('show');
    els.fileInput.value = '';
    els.processBtn.disabled = true;
    setStatus('', 'info');
  });

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function handleFile(file) {
    var name = file.name.toLowerCase();
    if (!name.endsWith('.docx') && !name.endsWith('.txt')) {
      setStatus('⚠️ Format tidak didukung. Gunakan file .docx atau .txt.', 'err');
      return;
    }
    setStatus('Membaca file...', 'info');
    els.processBtn.disabled = true;

    var reader = new FileReader();
    reader.onerror = function() { setStatus('⚠️ Gagal membaca file.', 'err'); };

    if (name.endsWith('.docx')) {
      reader.onload = function() {
        mammoth.extractRawText({ arrayBuffer: reader.result })
          .then(function(res) {
            state.fileText = res.value;
            state.fileName = file.name;
            onFileReady(file);
          })
          .catch(function(err) {
            setStatus('⚠️ Gagal mengekstrak isi .docx: ' + err.message, 'err');
          });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = function() {
        state.fileText = String(reader.result);
        state.fileName = file.name;
        onFileReady(file);
      };
      reader.readAsText(file);
    }
  }

  function onFileReady(file) {
    els.fileIcon.textContent = file.name.toLowerCase().endsWith('.docx') ? '📘' : '📄';
    els.fileName.textContent = file.name;
    els.fileSize.textContent = '(' + formatSize(file.size) + ')';
    els.fileChip.classList.add('show');
    els.processBtn.disabled = false;
    setStatus('✅ File siap diproses. Klik "Proses & Buat Laporan".', 'ok');
    els.manualFix.classList.remove('show');
  }

  // ---------- Year range controls ----------
  function setActivePreset(years) {
    document.querySelectorAll('.yr-preset').forEach(function(btn) {
      btn.classList.toggle('active', years != null && parseInt(btn.dataset.years, 10) === years);
    });
  }
  document.querySelectorAll('.yr-preset').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var years = parseInt(btn.dataset.years, 10);
      state.yearRange = CE.YearRange.presetToRange(years);
      els.yrFrom.value = ''; els.yrTo.value = '';
      setActivePreset(years);
      if (state.lastResult) renderResults(state.lastResult, state.lastDoiIssues);
    });
  });
  els.yrApplyCustom.addEventListener('click', function() {
    var from = parseInt(els.yrFrom.value, 10);
    var to = parseInt(els.yrTo.value, 10);
    if (!from || !to) { setStatus('Isi kedua tahun (dari & sampai) untuk custom range.', 'warn'); return; }
    if (from > to) { var t = from; from = to; to = t; }
    state.yearRange = { from: from, to: to, label: 'Custom (' + from + '\u2013' + to + ')' };
    setActivePreset(null);
    if (state.lastResult) renderResults(state.lastResult, state.lastDoiIssues);
  });

  // ---------- Processing ----------
  els.processBtn.addEventListener('click', function() {
    if (!state.fileText) return;
    runPipeline(state.fileText);
  });

  els.manualProcessBtn.addEventListener('click', function() {
    var article = els.manualArticle.value.trim();
    var references = els.manualReferences.value.trim();
    if (!article) { setStatus('⚠️ Teks artikel tidak boleh kosong.', 'err'); return; }
    validateAndRender(article, references);
  });

  function runPipeline(fullText) {
    setStatus('Menganalisis struktur dokumen...', 'info');
    els.results.classList.remove('active');
    var split = CE.splitDocumentByReferences(fullText);
    if (!split) {
      els.manualArticle.value = fullText;
      els.manualReferences.value = '';
      els.manualFix.classList.add('show');
      setStatus('⚠️ Heading referensi tidak terdeteksi otomatis. Silakan potong manual di bawah (pisahkan artikel dan daftar referensi), lalu klik "Proses dari Teks Manual".', 'warn');
      if (els.manualFix.scrollIntoView) els.manualFix.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setStatus('✅ Terpisah otomatis pada heading "' + split.headingText + '".', 'ok');
    els.manualFix.classList.remove('show');
    validateAndRender(split.article, split.references);
  }

  function validateAndRender(articleText, referenceText) {
    setStatus('Memvalidasi sitasi...', 'info');
    var selected = els.styleSelect.value;
    var styleId, confidence = null;
    if (selected === 'auto') {
      var detection = CE.FormatDetector.detect(articleText, referenceText);
      styleId = detection.styleId;
      confidence = detection.confidence;
    } else {
      styleId = selected;
    }
    var validator = new CE.MultiFormatValidator(articleText, referenceText, styleId);
    var result = validator.validate();
    state.lastResult = result;
    state.lastStyleId = styleId;
    state.lastConfidence = confidence;
    state.lastDoiIssues = [];

    els.results.classList.add('active');
    renderResults(result, []);

    if (els.includeDoi.checked && result.references.length > 0) {
      setStatus('Memvalidasi DOI via CrossRef (' + result.references.length + ' referensi)...', 'info');
      runDoiChecks(result.references).then(function(doiIssues) {
        state.lastDoiIssues = doiIssues;
        renderResults(result, doiIssues);
        setStatus('✅ Selesai. Laporan siap diunduh.', 'ok');
      });
    } else {
      setStatus('✅ Selesai. Laporan siap diunduh.', 'ok');
    }
    if (els.results.scrollIntoView) els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function runDoiChecks(references) {
    var doiIssues = [];
    var chain = Promise.resolve();
    references.forEach(function(ref) {
      chain = chain.then(function() {
        if (!ref.doi) {
          doiIssues.push({ ref: ref, status: 'no_doi', severity: 'info', title: 'Tanpa DOI', description: '"' + (ref.firstAuthor || '-') + (ref.year ? ' (' + ref.year + ')' : '') + '" tidak memiliki DOI yang terdeteksi.' });
          return;
        }
        return CE.DOIChecker.validateViaCrossRef(ref.doi).then(function(res) {
          if (res.status === 'network_error' || res.status === 'error') {
            doiIssues.push({ ref: ref, doi: ref.doi, status: 'unverified', severity: 'warning', title: 'DOI tidak dapat diverifikasi', description: 'DOI "' + ref.doi + '" tidak dapat diverifikasi.' });
          } else if (!res.exists) {
            doiIssues.push({ ref: ref, doi: ref.doi, status: 'fake', severity: 'error', title: 'DOI tidak ditemukan', description: 'DOI "' + ref.doi + '" tidak ditemukan di CrossRef.' });
          } else {
            var cmp = CE.DOIChecker.compareMetadata(ref, res.data);
            if (cmp.mismatches.length > 0) {
              doiIssues.push({ ref: ref, doi: ref.doi, status: 'mismatch', severity: 'warning', title: 'DOI valid, metadata tidak sesuai', description: cmp.mismatches.map(function(m){return m.field;}).join(', ') + ' tidak cocok dengan data CrossRef.' });
            } else {
              doiIssues.push({ ref: ref, doi: ref.doi, status: 'valid', severity: 'success', title: 'DOI valid & metadata sesuai', description: 'DOI "' + ref.doi + '" terverifikasi.' });
            }
          }
        });
      });
    });
    return chain.then(function() { return doiIssues; });
  }

  function countCitations(citations) {
    var n = 0;
    citations.forEach(function(c) {
      if (c.numbers) n += c.numbers.length;
      else if (c.parts) n += c.parts.length;
      else n += 1;
    });
    return n;
  }

  function renderResults(result, doiIssues) {
    var style = STYLES[result.styleId];
    var doiValid = doiIssues.filter(function(d){return d.status==='valid';}).length;
    var doiTotal = doiIssues.filter(function(d){return d.status!=='no_doi';}).length;
    els.summaryGrid.innerHTML =
      '<div class="sum-card fmt"><div class="n">' + esc(style.name) + '</div><div class="l">Gaya' + (state.lastConfidence!=null ? ' ('+state.lastConfidence+'%)' : '') + '</div></div>' +
      '<div class="sum-card err"><div class="n">' + result.errors.length + '</div><div class="l">Error</div></div>' +
      '<div class="sum-card warn"><div class="n">' + result.warnings.length + '</div><div class="l">Warning</div></div>' +
      '<div class="sum-card sugg"><div class="n">' + result.suggestions.length + '</div><div class="l">Saran</div></div>' +
      '<div class="sum-card ok"><div class="n">' + countCitations(result.citations) + '</div><div class="l">Sitasi</div></div>' +
      '<div class="sum-card ok"><div class="n">' + result.references.length + '</div><div class="l">Referensi</div></div>' +
      (els.includeDoi.checked ? '<div class="sum-card sugg"><div class="n">' + doiValid + '/' + doiTotal + '</div><div class="l">DOI Valid</div></div>' : '');

    if (result.references.length > 0) {
      var stats = CE.YearRange.compute(result.references, state.yearRange.from, state.yearRange.to);
      var inW = stats.total ? (stats.inRange.length / stats.total * 100) : 0;
      var outW = stats.total ? (stats.outRange.length / stats.total * 100) : 0;
      var unkW = stats.total ? (stats.unknown.length / stats.total * 100) : 0;
      els.yearRangeSummary.innerHTML =
        '<div class="field-label" style="margin-top:4px;">Rentang Tahun Diperiksa: ' + esc(state.yearRange.label) + '</div>' +
        '<div class="yr-bar"><div class="yr-seg in" style="width:' + inW + '%"></div><div class="yr-seg out" style="width:' + outW + '%"></div><div class="yr-seg unk" style="width:' + unkW + '%"></div></div>' +
        '<div class="yr-legend">' +
        '<span><span class="d in"></span>Dalam rentang (' + stats.inRange.length + ')</span>' +
        '<span><span class="d out"></span>Di luar rentang (' + stats.outRange.length + ')</span>' +
        '<span><span class="d unk"></span>Tahun tidak diketahui (' + stats.unknown.length + ')</span>' +
        '</div>';
    } else {
      els.yearRangeSummary.innerHTML = '';
    }

    renderReportPreview(result, doiIssues);
  }

  // ---------- HTML report preview + print-to-PDF export ----------
  function renderReportPreview(result, doiIssues) {
    var style = STYLES[result.styleId];
    var stats = CE.YearRange.compute(result.references, state.yearRange.from, state.yearRange.to);
    var confidence = state.lastConfidence;
    var html = '';

    html += '<h1>Laporan Validasi Sitasi</h1>';
    html += '<div class="rp-meta">Gaya sitasi: <b>' + esc(style.name) + '</b>' + (confidence != null ? ' (auto-detect, keyakinan ' + confidence + '%)' : '') + '</div>';
    html += '<div class="rp-meta">Sumber dokumen: ' + esc(state.fileName || '-') + '  |  Dibuat: ' + esc(new Date().toLocaleString('id-ID')) + '</div>';

    // Ringkasan
    html += '<h2>Ringkasan</h2><table>';
    html += row('Total sitasi terdeteksi', countCitations(result.citations));
    html += row('Total referensi terdeteksi', result.references.length);
    html += row('Error / Warning / Saran', result.errors.length + ' / ' + result.warnings.length + ' / ' + result.suggestions.length);
    html += row('Rentang tahun diperiksa', state.yearRange.label);
    html += row('Dalam rentang / Di luar rentang / Tahun tak diketahui', stats.inRange.length + ' / ' + stats.outRange.length + ' / ' + stats.unknown.length);
    html += row('Persentase dalam rentang (dari yang bertahun jelas)', stats.pctOfKnown + '%');
    html += '</table>';

    // Rentang tahun
    html += '<h2>Analisis Rentang Tahun Referensi</h2>';
    var inW = stats.total ? (stats.inRange.length / stats.total * 100) : 0;
    var outW = stats.total ? (stats.outRange.length / stats.total * 100) : 0;
    var unkW = stats.total ? (stats.unknown.length / stats.total * 100) : 0;
    html += '<div class="rp-bar"><div class="rp-seg in" style="width:' + inW + '%"></div><div class="rp-seg out" style="width:' + outW + '%"></div><div class="rp-seg unk" style="width:' + unkW + '%"></div></div>';
    html += '<div class="rp-legend">🟩 Dalam rentang &nbsp; 🟥 Di luar rentang (' + esc(state.yearRange.label) + ') &nbsp; ⬜ Tahun tidak diketahui</div>';
    if (result.references.length === 0) {
      html += '<p class="rp-empty">Tidak ada referensi terdeteksi.</p>';
    } else {
      html += '<ul>';
      result.references.forEach(function(r) {
        var y = CE.YearRange.getRefYear(r);
        var outOfRange = y != null && (y < state.yearRange.from || y > state.yearRange.to);
        var unknown = y == null;
        var yearHtml;
        if (outOfRange) yearHtml = ' <mark class="hl-red">(' + esc(r.year || '-') + ')</mark>';
        else if (unknown) yearHtml = ' <mark class="hl-yellow">(tahun tidak terdeteksi)</mark>';
        else yearHtml = ' (' + esc(r.year) + ')';
        html += '<li><b>' + esc(r.firstAuthor || '-') + '</b>' + yearHtml + (r.title ? ' — ' + esc(r.title) : '') + '</li>';
      });
      html += '</ul>';
    }

    // Issues
    html += issueSection('Error', result.errors, 'error', 'hl-red');
    html += issueSection('Warning', result.warnings, 'warning', 'hl-yellow');
    html += issueSection('Saran', result.suggestions, 'suggestion', 'hl-cyan');

    // DOI
    if (doiIssues && doiIssues.length > 0) {
      html += '<h2>Validasi DOI (CrossRef)</h2><ul>';
      doiIssues.forEach(function(d) {
        var cls = d.status === 'fake' ? 'hl-red' : (d.status === 'mismatch' || d.status === 'unverified') ? 'hl-yellow' : d.status === 'valid' ? 'hl-green' : null;
        html += '<li>' + (cls ? '<mark class="' + cls + '">[' + esc(d.status.toUpperCase()) + ']</mark>' : '[' + esc(d.status.toUpperCase()) + ']') + ' ' + esc(d.title) + ' — ' + esc(d.description) + '</li>';
      });
      html += '</ul>';
    }

    html += '<div class="rp-foot">Laporan ini dihasilkan otomatis berdasarkan pola teks (heuristik), bukan pemeriksaan tata bahasa penuh atau penilaian editorial. Bagian yang di-highlight menandai hal yang perlu diperiksa ulang secara manual, bukan kesalahan pasti. Selalu tinjau kembali sebelum mengirimkan naskah ke jurnal.</div>';

    els.reportPreview.innerHTML = html;
  }

  function row(k, v) {
    return '<tr><td class="k">' + esc(String(k)) + '</td><td class="v">' + esc(String(v)) + '</td></tr>';
  }

  function issueSection(title, issues, sevClass, codeHl) {
    var html = '<h2>' + esc(title) + ' (' + issues.length + ')</h2>';
    if (issues.length === 0) {
      html += '<p class="rp-empty">Tidak ada masalah pada kategori ini.</p>';
      return html;
    }
    issues.forEach(function(issue, i) {
      html += '<div class="rp-issue ' + sevClass + '">';
      html += '<div class="t">' + (i + 1) + '. ' + esc(issue.title) + '</div>';
      html += '<div class="d">' + esc(issue.description) + '</div>';
      if (issue.code) html += '<div>Ditemukan: <mark class="' + codeHl + '">' + esc(issue.code) + '</mark></div>';
      if (issue.correction) html += '<div>Saran perbaikan: <mark class="hl-green">' + esc(issue.correction) + '</mark></div>';
      html += '</div>';
    });
    return html;
  }

  els.downloadBtn.addEventListener('click', function() {
    if (!state.lastResult) return;
    var style = STYLES[state.lastStyleId];
    var dateStr = new Date().toISOString().slice(0, 10);
    var suggestedName = 'Laporan-Validasi-Sitasi-' + style.name.replace(/[^\w]+/g, '-') + '-' + dateStr;
    var originalTitle = document.title;
    document.title = suggestedName;
    setStatus('', 'info');
    els.downloadStatus.textContent = 'Membuka dialog cetak... pilih tujuan "Simpan sebagai PDF".';
    els.downloadStatus.className = 'status info';
    window.print();
    setTimeout(function() { document.title = originalTitle; }, 1000);
  });
})();
