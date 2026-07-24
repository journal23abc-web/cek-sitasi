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
    parseStatusBanner: document.getElementById('parseStatusBanner'),
    yearRangeSummary: document.getElementById('yearRangeSummary'),
    reportPreview: document.getElementById('reportPreview'),
    downloadBtn: document.getElementById('downloadBtn'),
    downloadStatus: document.getElementById('downloadStatus'),
    originalHlPanel: document.getElementById('originalHlPanel'),
    downloadOriginalBtn: document.getElementById('downloadOriginalBtn'),
    downloadOriginalStatus: document.getElementById('downloadOriginalStatus'),
    citationMapPanel: document.getElementById('citationMapPanel'),
    jrMinCountEnabled: document.getElementById('jrMinCountEnabled'),
    jrMinCountValue: document.getElementById('jrMinCountValue'),
    jrYearRangeEnabled: document.getElementById('jrYearRangeEnabled'),
    jrYearRangeMinPercent: document.getElementById('jrYearRangeMinPercent'),
    jrYearRangeYears: document.getElementById('jrYearRangeYears'),
    jrSourceTypeEnabled: document.getElementById('jrSourceTypeEnabled'),
    jrSourceTypeMinPercent: document.getElementById('jrSourceTypeMinPercent'),
    jrSourceTypeType: document.getElementById('jrSourceTypeType'),
    jrOriginEnabled: document.getElementById('jrOriginEnabled'),
    jrOriginMinPercent: document.getElementById('jrOriginMinPercent'),
    jrApplyBtn: document.getElementById('jrApplyBtn'),
    jrResultsPanel: document.getElementById('jrResultsPanel'),
  };

  var state = {
    fileText: null,
    fileName: null,
    originalFile: null, // the raw File object, kept only for .docx uploads (needed to preserve original formatting on export)
    yearRange: CE.YearRange.presetToRange(5),
    lastResult: null,
    lastDoiIssues: [],
    lastStyleId: null,
    lastConfidence: null,
    lastValidator: null,
    jrOverrides: {}, // { referenceIndex: 'local'|'international' } — resets per new validation run
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
    state.fileText = null; state.fileName = null; state.originalFile = null;
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

  var MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — generous for a text-heavy manuscript, guards against pathological uploads freezing the tab
  var WARN_FILE_SIZE = 8 * 1024 * 1024; // 8MB — still fine, but slower; let the user know what to expect

  function handleFile(file) {
    var name = file.name.toLowerCase();
    if (!name.endsWith('.docx') && !name.endsWith('.txt')) {
      setStatus('⚠️ Format tidak didukung. Gunakan file .docx atau .txt.', 'err');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setStatus('⚠️ File terlalu besar (' + formatSize(file.size) + ', maksimum ' + formatSize(MAX_FILE_SIZE) + '). File sebesar ini berisiko membuat browser macet. Coba pisah naskah jadi beberapa bagian, atau hapus gambar/lampiran besar dari dokumen dulu.', 'err');
      return;
    }
    setStatus('Membaca file...', 'info');
    if (file.size > WARN_FILE_SIZE) setStatus('Membaca file besar (' + formatSize(file.size) + ')... mungkin perlu beberapa detik.', 'info');
    els.processBtn.disabled = true;
    state.originalFile = null;

    var reader = new FileReader();
    reader.onerror = function() { setStatus('⚠️ Gagal membaca file.', 'err'); };

    if (name.endsWith('.docx')) {
      state.originalFile = file;
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

  // Large documents (long article + many references) can make parsing/matching noticeably
  // slow. Offload that step to a Web Worker so the tab stays responsive — falls back to the
  // main thread automatically if Workers aren't available, fail to start, error out, or take
  // too long (so a worker hiccup never leaves the user stuck with no result).
  var WORKER_THRESHOLD = 50000; // combined article+reference character count
  var WORKER_TIMEOUT_MS = 20000;
  var validatorWorker = null;
  function getWorker() {
    if (validatorWorker) return validatorWorker;
    try { validatorWorker = new Worker('validator-worker.js?v=1'); return validatorWorker; }
    catch (e) { return null; }
  }
  function runValidation(articleText, referenceText, styleId) {
    var combined = (articleText || '').length + (referenceText || '').length;
    function runOnMainThread() {
      var validator = new CE.MultiFormatValidator(articleText, referenceText, styleId);
      var result = validator.validate();
      state.lastValidator = validator; // needed by renderCitationMap() for matched/unmatched lookups
      return result;
    }
    if (combined < WORKER_THRESHOLD || typeof Worker === 'undefined') {
      return Promise.resolve(runOnMainThread());
    }
    var worker = getWorker();
    if (!worker) return Promise.resolve(runOnMainThread());
    // A Web Worker only gives back plain serialized data, never a live class instance with
    // methods — so state.lastValidator can't be populated on this path. renderCitationMap()
    // treats a null validator the same way it already does before any validation has run
    // (falls back to "matched"), so this only affects the map's coloring for very large
    // documents, not the actual validation results.
    state.lastValidator = null;
    return new Promise(function(resolve) {
      var settled = false;
      var timeoutId = setTimeout(function() {
        if (settled) return;
        settled = true;
        resolve(runOnMainThread());
      }, WORKER_TIMEOUT_MS);
      worker.onmessage = function(e) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(e.data && e.data.ok ? e.data.result : runOnMainThread());
      };
      worker.onerror = function() {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(runOnMainThread());
      };
      worker.postMessage({ articleText: articleText, referenceText: referenceText, styleId: styleId });
    });
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
    runValidation(articleText, referenceText, styleId).then(function(result) {
      state.lastResult = result;
      state.lastStyleId = styleId;
      state.lastConfidence = confidence;
      state.lastDoiIssues = [];
      state.jrOverrides = {};

      els.results.classList.add('active');
      renderResults(result, []);

      if (state.originalFile) {
        checkDocxReferenceFormatting(styleId).then(function(fmtIssues) {
          fmtIssues.forEach(function(fi) {
            result.suggestions.push({
              title: fi.field === 'italic' ? 'Format italic referensi' : 'Format huruf besar/kecil judul',
              description: fi.message,
              code: fi.ref.raw.substring(0, 150),
            });
          });
          if (fmtIssues.length > 0) renderResults(result, state.lastDoiIssues);
        });
      }

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
    });
  }

  function runDoiChecks(references) {
    var doiIssues = [];
    var chain = Promise.resolve();
    references.forEach(function(ref) {
      chain = chain.then(function() {
        if (!ref.doi) {
          if (CE.DOI_NOT_EXPECTED_TYPES[ref.sourceType]) return; // book/thesis/report/website — DOI normally absent, not a problem
          doiIssues.push({ ref: ref, status: 'no_doi', severity: 'info', title: 'Tanpa DOI', description: '"' + (ref.firstAuthor || '-') + (ref.year ? ' (' + ref.year + ')' : '') + '" tidak memiliki DOI yang terdeteksi.' });
          return;
        }
        return CE.DOIChecker.validateViaCrossRef(ref.doi).then(function(res) {
          if (res.status === 'network_error' || res.status === 'error') {
            doiIssues.push({ ref: ref, doi: ref.doi, status: 'unverified', severity: 'warning', title: 'DOI tidak dapat diverifikasi', description: 'DOI "' + ref.doi + '" tidak dapat diverifikasi.', code: 'https://doi.org/' + ref.doi });
          } else if (!res.exists) {
            doiIssues.push({ ref: ref, doi: ref.doi, status: 'fake', severity: 'error', title: 'DOI tidak ditemukan', description: 'DOI "' + ref.doi + '" tidak ditemukan di CrossRef.', code: 'https://doi.org/' + ref.doi });
          } else {
            var cmp = CE.DOIChecker.compareMetadata(ref, res.data);
            if (cmp.mismatches.length > 0) {
              var noteTexts = cmp.mismatches.map(function(m){ return m.note; }).filter(Boolean);
              doiIssues.push({ ref: ref, doi: ref.doi, status: 'mismatch', severity: 'warning', title: 'DOI valid, metadata tidak sesuai', description: cmp.mismatches.map(function(m){return m.field + ' (referensi: ' + m.ref + ', CrossRef: ' + m.cr + ')';}).join('; ') + ' tidak cocok dengan data CrossRef.' + (noteTexts.length ? ' ' + noteTexts.join(' ') : ''), code: 'https://doi.org/' + ref.doi });
            } else {
              doiIssues.push({ ref: ref, doi: ref.doi, status: 'valid', severity: 'success', title: 'DOI valid & metadata sesuai', description: 'DOI "' + ref.doi + '" terverifikasi.', code: 'https://doi.org/' + ref.doi });
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

  function renderParseStatus(result) {
    var stats = result.parseStats || { totalFound: result.references.length, succeededCount: result.references.length, failedCount: 0 };
    var failed = result.failedLines || [];
    var el = els.parseStatusBanner;
    if (!el) return;
    if (stats.failedCount === 0) {
      el.innerHTML = '<div class="parse-banner ok"><div class="pb-title">✅ Semua baris referensi berhasil dianalisis</div><div class="pb-stats">Ditemukan: ' + stats.totalFound + ' · Berhasil dianalisis: ' + stats.succeededCount + ' · Gagal: 0</div></div>';
      return;
    }
    var html = '<div class="parse-banner fail">';
    html += '<div class="pb-title">⚠️ ' + stats.failedCount + ' baris referensi GAGAL dianalisis — hasil di bawah ini belum lengkap</div>';
    html += '<div class="pb-stats">Ditemukan: ' + stats.totalFound + ' · Berhasil dianalisis: ' + stats.succeededCount + ' · Gagal: ' + stats.failedCount + '</div>';
    html += '<div>Baris berikut tidak dikenali polanya dan <b>tidak ikut divalidasi sama sekali</b>:</div><div class="pb-failed-list">';
    failed.forEach(function(f) {
      html += '<div class="pb-failed-item"><b>Baris ' + f.lineNumber + ':</b> ' + esc(f.text.slice(0, 160)) + (f.text.length > 160 ? '…' : '') + '<br><span style="color:var(--text-faint);">↳ ' + esc(f.reason) + '</span></div>';
    });
    html += '</div></div>';
    el.innerHTML = html;
  }

  function renderResults(result, doiIssues) {
    renderParseStatus(result);
    var style = STYLES[result.styleId];
    var doiValid = doiIssues.filter(function(d){return d.status==='valid';}).length;
    var doiTotal = doiIssues.filter(function(d){return d.status!=='no_doi';}).length;
    els.summaryGrid.innerHTML =
      '<div class="sum-card fmt"><div class="n">' + esc(style.name) + '</div><div class="l">Gaya' + (state.lastConfidence!=null ? ' ('+state.lastConfidence+'%)' : '') + '</div></div>' +
      '<div class="sum-card err"><div class="n">' + result.errors.length + '</div><div class="l">Perlu Diperbaiki</div></div>' +
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
    els.originalHlPanel.style.display = state.originalFile ? '' : 'none';
    els.downloadOriginalStatus.textContent = state.originalFile ? '' : '(Hanya tersedia untuk file .docx yang diunggah — file .txt tidak punya format asli untuk dipertahankan.)';
    renderCitationMap(result);
  }

  // ---------- Peta Sitasi (citation map) with click-to-jump cross-linking ----------
  function mapLinkKey(author, year) {
    // Reference firstAuthor is often "Surname, Initial" while a citation's parsed firstAuthor
    // is just "Surname" — strip anything after a comma so both sides normalize to the same key.
    var surnameOnly = String(author || '').split(',')[0];
    return surnameOnly.toLowerCase().replace(/[^a-z0-9]+/g, '') + '|' + String(year || '');
  }

  function splitFirstToken(authorsStr) {
    if (!authorsStr) return authorsStr;
    var cleaned = authorsStr.replace(/\s*et\s+al\.?/i, '');
    var arr = CE.splitOnSeparators(cleaned);
    return arr[0] || cleaned;
  }

  function renderCitationMap(result) {
    var style = STYLES[result.styleId];
    var panel = els.citationMapPanel;
    if (!panel) return;
    if (style.family === 'numeric') {
      var refByNum = {};
      result.references.forEach(function(r){ if (r.numLabel!=null) refByNum[r.numLabel]=r; });
      var citedNums = new Set();
      result.citations.forEach(function(c){ c.numbers.forEach(function(n){citedNums.add(n);}); });
      var citeItems = Array.from(citedNums).sort(function(a,b){return a-b;}).map(function(n){
        return { label: '[' + n + ']', matched: !!refByNum[n], linkKey: 'num|' + n };
      });
      var refItems = result.references.map(function(r){
        return { label: '[' + r.numLabel + '] ' + (r.firstAuthor||'-') + (r.year?' ('+r.year+')':''), matched: citedNums.has(r.numLabel), linkKey: 'num|' + r.numLabel };
      });
      panel.innerHTML = mapHTML('In-Text Citations', citeItems, 'Reference List', refItems);
      wireMapLinks(panel);
      return;
    }

    // author-date / author-page: use the validator's real match index when available (main
    // thread path) — falls back to "matched" (green) for very large documents that ran through
    // the Web Worker, same as before any validation has run. See runValidation() for why.
    var lastValidator = state.lastValidator;
    var citeItems = [];
    var seenCiteLabels = new Set();
    result.citations.forEach(function(c) {
      if (c.parts) {
        c.parts.forEach(function(p) {
          var label = (p.firstAuthor||'-') + (p.year ? ', ' + p.year : (p.page ? ' p.' + p.page : ''));
          if (seenCiteLabels.has(label)) return;
          seenCiteLabels.add(label);
          var matched = lastValidator ? lastValidator.isCitationMatched(p.firstAuthor, p.year || null) : null;
          citeItems.push({ label: label, matched: matched !== false, linkKey: mapLinkKey(p.firstAuthor, p.year) });
        });
      } else {
        var label2 = (c.authors||'-') + (c.year ? ', ' + c.year : '');
        if (seenCiteLabels.has(label2)) return;
        seenCiteLabels.add(label2);
        var firstTok = splitFirstToken(c.authors);
        var matched2 = lastValidator ? lastValidator.isCitationMatched(firstTok, c.year || null) : null;
        citeItems.push({ label: label2, matched: matched2 !== false, linkKey: mapLinkKey(firstTok, c.year) });
      }
    });
    var refItems = result.references.map(function(r){
      var cited = lastValidator ? lastValidator.isReferenceCited(r) : null;
      return { label: (r.firstAuthor||'-') + (r.year ? ' ('+r.year+')' : '') + (r.isInstitutional ? ' 🏛' : ''), matched: cited !== false, linkKey: mapLinkKey(r.firstAuthor, r.year) };
    });
    panel.innerHTML = mapHTML('In-Text Citations', citeItems, 'Reference List', refItems);
    wireMapLinks(panel);
  }

  // Clicking a matched citation jumps to & flashes its matched reference (and vice versa).
  // Only "matched" items get a clickable counterpart — unmatched ones have nothing to jump to.
  function wireMapLinks(panel) {
    panel.querySelectorAll('.map-item.matched[data-link-key]').forEach(function(el) {
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('title', 'Klik untuk lompat ke pasangannya');
      el.addEventListener('click', function() { jumpToMapPair(panel, el); });
      el.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpToMapPair(panel, el); }
      });
    });
  }

  function jumpToMapPair(panel, sourceEl) {
    var key = sourceEl.getAttribute('data-link-key');
    var side = sourceEl.getAttribute('data-side');
    var targets = panel.querySelectorAll('.map-item[data-link-key="' + CSS.escape(key) + '"][data-side="' + (side === 'cite' ? 'ref' : 'cite') + '"]');
    if (!targets.length) return;
    var target = targets[0];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('flash'); void target.offsetWidth; // restart animation if clicked repeatedly
    target.classList.add('flash');
    target.focus({ preventScroll: true });
  }

  function mapHTML(labelA, itemsA, labelB, itemsB) {
    function uniq(items) {
      var seen = new Map();
      items.forEach(function(i){ seen.set(i.label, i); });
      return Array.from(seen.values());
    }
    function itemHTML(i, side) {
      var keyAttr = i.matched ? ' data-link-key="' + esc(i.linkKey) + '" data-side="' + side + '"' : '';
      return '<div class="map-item ' + (i.matched?'matched':'unmatched') + '"' + keyAttr + '><span class="d"></span>' + esc(i.label) + '</div>';
    }
    var a = uniq(itemsA), b = uniq(itemsB);
    return '<h3 style="font-family:\'Space Grotesk\',sans-serif;font-size:15px;margin:0 0 14px;">📊 Peta Sitasi ↔ Referensi</h3>' +
      '<p style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);margin:-6px 0 14px;">💡 Klik entri berwarna hijau untuk lompat ke pasangannya.</p>' +
      '<div class="map-grid">' +
      '<div class="map-col"><h4>' + labelA + ' (' + a.length + ')</h4>' +
      (a.length===0?'<p style="color:var(--text-dim);font-size:12px;">Tidak ada sitasi terdeteksi</p>':'') +
      a.map(function(i){return itemHTML(i, 'cite');}).join('') +
      '</div><div class="map-col"><h4>' + labelB + ' (' + b.length + ')</h4>' +
      (b.length===0?'<p style="color:var(--text-dim);font-size:12px;">Tidak ada referensi</p>':'') +
      b.map(function(i){return itemHTML(i, 'ref');}).join('') +
      '</div></div>';
  }

  // ---------- Aturan Jurnal Custom (optional) ----------
  function readJournalRulesConfig() {
    return {
      minCount: { enabled: els.jrMinCountEnabled.checked, value: parseInt(els.jrMinCountValue.value, 10) || 0 },
      yearRange: { enabled: els.jrYearRangeEnabled.checked, years: parseInt(els.jrYearRangeYears.value, 10) || 10, minPercent: parseInt(els.jrYearRangeMinPercent.value, 10) || 0 },
      sourceType: { enabled: els.jrSourceTypeEnabled.checked, type: els.jrSourceTypeType.value, minPercent: parseInt(els.jrSourceTypeMinPercent.value, 10) || 0 },
      origin: { enabled: els.jrOriginEnabled.checked, minInternationalPercent: parseInt(els.jrOriginMinPercent.value, 10) || 0 },
    };
  }

  function renderJournalRules() {
    if (!state.lastResult) return;
    var JR = window.JournalRulesEngine;
    var rules = readJournalRulesConfig();
    var evalResult = JR.evaluateRules(state.lastResult.references, rules, state.jrOverrides);
    var classified = JR.classifyReferencesOrigin(state.lastResult.references, state.jrOverrides);

    var html = '';
    if (evalResult.totalRules === 0) {
      html += '<p style="color:var(--text-dim);font-size:12px;">Aktifkan minimal satu aturan di atas, lalu klik "Terapkan Aturan".</p>';
    } else {
      html += '<div class="jr-summary ' + (evalResult.overallPass ? 'pass' : 'fail') + '">' +
        (evalResult.overallPass ? '✅' : '⚠️') + ' ' + evalResult.passCount + ' dari ' + evalResult.totalRules + ' aturan terpenuhi' + '</div>';
      evalResult.checks.forEach(function(c) {
        html += '<div class="jr-check ' + (c.pass ? 'pass' : 'fail') + '">' +
          '<span class="ic">' + (c.pass ? '✅' : '❌') + '</span>' +
          '<div><div class="t">' + esc(c.label) + '</div><div class="d">' + c.detail + '</div></div>' +
          '</div>';
      });
    }

    html += '<div class="field-label" style="margin-top:18px;">Klasifikasi Asal Referensi (bisa dikoreksi manual)</div>' +
      '<table class="jr-origin-table"><thead><tr><th>Referensi</th><th>Asal</th><th>Keyakinan</th></tr></thead><tbody>';
    classified.forEach(function(c) {
      var label = (c.ref.firstAuthor || '-') + (c.ref.year ? ' (' + c.ref.year + ')' : '');
      html += '<tr>' +
        '<td>' + esc(label) + (c.signal ? '<br><span style="color:var(--text-faint);font-size:10.5px;">' + esc(c.signal) + '</span>' : '') + '</td>' +
        '<td><select data-ref-index="' + c.index + '">' +
          '<option value="international"' + (c.origin === 'international' ? ' selected' : '') + '>🌍 Internasional</option>' +
          '<option value="local"' + (c.origin === 'local' ? ' selected' : '') + '>🇮🇩 Lokal (Indonesia)</option>' +
        '</select></td>' +
        '<td><span class="jr-conf ' + c.confidence + '">' + (c.confidence === 'manual' ? 'Manual' : c.confidence === 'high' ? 'Tinggi' : 'Rendah') + '</span></td>' +
        '</tr>';
    });
    html += '</tbody></table>';

    els.jrResultsPanel.innerHTML = html;

    els.jrResultsPanel.querySelectorAll('select[data-ref-index]').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var idx = parseInt(sel.getAttribute('data-ref-index'), 10);
        state.jrOverrides[idx] = sel.value;
        renderJournalRules(); // re-evaluate live so the origin-percentage check updates immediately
        if (state.lastResult) renderReportPreview(state.lastResult, state.lastDoiIssues);
      });
    });
  }

  els.jrApplyBtn.addEventListener('click', function() {
    renderJournalRules();
    if (state.lastResult) renderReportPreview(state.lastResult, state.lastDoiIssues);
  });

  // ---------- HTML report preview + print-to-PDF export ----------
  function getSelectedReportSections() {
    var boxes = document.querySelectorAll('#reportSections input:checked');
    return Array.prototype.slice.call(boxes).map(function(b) { return b.value; });
  }

  function renderReportPreview(result, doiIssues) {
    var sections = getSelectedReportSections();
    var style = STYLES[result.styleId];
    var stats = CE.YearRange.compute(result.references, state.yearRange.from, state.yearRange.to);
    var confidence = state.lastConfidence;
    var html = '';

    html += '<h1>Laporan Validasi Sitasi</h1>';
    html += '<div class="rp-meta">Gaya sitasi: <b>' + esc(style.name) + '</b>' + (confidence != null ? ' (auto-detect, keyakinan ' + confidence + '%)' : '') + '</div>';
    html += '<div class="rp-meta">Sumber dokumen: ' + esc(state.fileName || '-') + '  |  Dibuat: ' + esc(new Date().toLocaleString('id-ID')) + '</div>';

    if (sections.indexOf('summary') !== -1) {
      html += '<h2>Ringkasan</h2><table>';
      html += row('Total sitasi terdeteksi', countCitations(result.citations));
      html += row('Total referensi terdeteksi', result.references.length);
      html += row('Perlu Diperbaiki / Saran', result.errors.length + ' / ' + result.suggestions.length);
      html += row('Rentang tahun diperiksa', state.yearRange.label);
      html += row('Dalam rentang / Di luar rentang / Tahun tak diketahui', stats.inRange.length + ' / ' + stats.outRange.length + ' / ' + stats.unknown.length);
      html += row('Persentase dalam rentang (dari yang bertahun jelas)', stats.pctOfKnown + '%');
      html += '</table>';
    }

    if (sections.indexOf('yearrange') !== -1) {
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
    }

    if (sections.indexOf('errors') !== -1) html += issueSection('Perlu Diperbaiki', result.errors, 'error', 'hl-red');
    if (sections.indexOf('suggestions') !== -1) html += issueSection('Saran', result.suggestions, 'suggestion', 'hl-cyan');

    if (sections.indexOf('doi') !== -1 && doiIssues && doiIssues.length > 0) {
      html += '<h2>Validasi DOI (CrossRef)</h2><ul>';
      doiIssues.forEach(function(d) {
        var cls = d.status === 'fake' ? 'hl-red' : (d.status === 'mismatch' || d.status === 'unverified') ? 'hl-yellow' : d.status === 'valid' ? 'hl-green' : null;
        html += '<li>' + (cls ? '<mark class="' + cls + '">[' + esc(d.status.toUpperCase()) + ']</mark>' : '[' + esc(d.status.toUpperCase()) + ']') + ' ' + esc(d.title) + ' — ' + esc(d.description) + '</li>';
      });
      html += '</ul>';
    }

    if (sections.indexOf('journalrules') !== -1 && window.JournalRulesEngine) {
      var jrConfig = readJournalRulesConfig();
      var jrEval = window.JournalRulesEngine.evaluateRules(result.references, jrConfig, state.jrOverrides);
      if (jrEval.totalRules > 0) {
        html += '<h2>Aturan Jurnal Custom</h2>';
        html += '<p class="rp-meta">' + (jrEval.overallPass ? '✅' : '⚠️') + ' ' + jrEval.passCount + ' dari ' + jrEval.totalRules + ' aturan terpenuhi</p><ul>';
        jrEval.checks.forEach(function(c) {
          html += '<li>' + (c.pass ? '<mark class="hl-green">[LOLOS]</mark>' : '<mark class="hl-red">[TIDAK LOLOS]</mark>') + ' <b>' + esc(c.label) + '</b> — ' + c.detail + '</li>';
        });
        html += '</ul>';
      }
    }

    html += '<div class="rp-foot">Laporan ini dihasilkan otomatis berdasarkan pola teks (heuristik), bukan pemeriksaan tata bahasa penuh atau penilaian editorial. Bagian yang di-highlight menandai hal yang perlu diperiksa ulang secara manual, bukan kesalahan pasti. Selalu tinjau kembali sebelum mengirimkan naskah ke jurnal.</div>';

    els.reportPreview.innerHTML = html;
  }

  document.querySelectorAll('#reportSections input').forEach(function(box) {
    box.addEventListener('change', function() {
      if (state.lastResult) renderReportPreview(state.lastResult, state.lastDoiIssues || []);
    });
  });

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
      html += '<div class="t">' + (i + 1) + '. ' + esc(issue.title) + (issue.location ? ' <span class="loc">📍 Baris ' + issue.location.line + ' (' + (issue.location.source === 'reference' ? 'referensi' : 'artikel') + ')</span>' : '') + '</div>';
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

  // ---------- Highlight problems directly inside the ORIGINAL .docx (format preserved) ----------
  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Builds a whitespace-flexible, case-insensitive RegExp from a plain-text search phrase.
  function flexiblePattern(term, flags) {
    var t = (term || '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    var pattern = t.split(' ').map(escapeRegex).join('\\s+');
    try { return new RegExp(pattern, flags || 'i'); } catch (e) { return null; }
  }

  // Concatenates every <w:t> node's text (document order) into one string, keeping a
  // position -> node map so we can later find exactly which run(s) a text match touches.
  function buildDocxTextIndex(xmlDoc) {
    var segments = [];
    var text = '';
    var paragraphs = xmlDoc.getElementsByTagName('w:p');
    for (var p = 0; p < paragraphs.length; p++) {
      var wts = paragraphs[p].getElementsByTagName('w:t');
      for (var i = 0; i < wts.length; i++) {
        var node = wts[i];
        var t = node.textContent || '';
        if (t.length === 0) continue;
        segments.push({ start: text.length, end: text.length + t.length, node: node });
        text += t;
      }
      text += '\n';
    }
    return { text: text, segments: segments };
  }

  function makeRun(xmlDoc, templateRunEl, textValue, color) {
    if (!textValue) return null;
    var newRun = templateRunEl.cloneNode(true);
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
    if (color) {
      var rPrList = newRun.getElementsByTagName('w:rPr');
      var rPr;
      if (rPrList.length > 0) { rPr = rPrList[0]; }
      else { rPr = xmlDoc.createElementNS(W_NS, 'w:rPr'); newRun.insertBefore(rPr, newRun.firstChild); }
      var existingHl = rPr.getElementsByTagName('w:highlight');
      for (var j = existingHl.length - 1; j >= 0; j--) existingHl[j].parentNode.removeChild(existingHl[j]);
      var hl = xmlDoc.createElementNS(W_NS, 'w:highlight');
      hl.setAttributeNS(W_NS, 'w:val', color);
      rPr.appendChild(hl);
    }
    return newRun;
  }

  // Applies a set of {start,end,color} matches (in the index's coordinate space) onto the
  // live XML DOM, splitting/cloning runs as needed so every OTHER run/formatting stays untouched.
  function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  // Applies highlight AND inserts real Word review-comment anchors (commentRangeStart/End +
  // commentReference) around each match, so the "why" shows up in Word's Comments pane
  // instead of being a mystery-colored highlight. Matches must be pre-sorted & non-overlapping.
  function applyHighlightsAndComments(xmlDoc, index, matches) {
    var comments = [];
    var nextId = 0;
    matches.forEach(function(m) {
      var touched = index.segments.filter(function(seg) { return seg.start < m.end && seg.end > m.start; });
      if (touched.length === 0) return;
      var firstHlRun = null, lastHlRun = null, ok = true;
      touched.forEach(function(seg) {
        var runEl = seg.node.parentNode;
        if (!runEl || !runEl.parentNode) { ok = false; return; }
        var fullText = seg.node.textContent;
        var s = Math.max(m.start, seg.start) - seg.start;
        var e = Math.min(m.end, seg.end) - seg.start;
        var before = fullText.slice(0, s), mid = fullText.slice(s, e), after = fullText.slice(e);
        var beforeRun = makeRun(xmlDoc, runEl, before, null);
        var hlRun = makeRun(xmlDoc, runEl, mid, m.color);
        var afterRun = makeRun(xmlDoc, runEl, after, null);
        var parent = runEl.parentNode;
        if (beforeRun) parent.insertBefore(beforeRun, runEl);
        parent.insertBefore(hlRun, runEl);
        if (afterRun) parent.insertBefore(afterRun, runEl);
        parent.removeChild(runEl);
        if (!firstHlRun) firstHlRun = hlRun;
        lastHlRun = hlRun;
      });
      if (!ok || !firstHlRun || !m.comment) return;
      var id = nextId++;
      var startEl = xmlDoc.createElementNS(W_NS, 'w:commentRangeStart'); startEl.setAttributeNS(W_NS, 'w:id', String(id));
      var endEl = xmlDoc.createElementNS(W_NS, 'w:commentRangeEnd'); endEl.setAttributeNS(W_NS, 'w:id', String(id));
      var refRun = xmlDoc.createElementNS(W_NS, 'w:r');
      var refRPr = xmlDoc.createElementNS(W_NS, 'w:rPr');
      var rStyle = xmlDoc.createElementNS(W_NS, 'w:rStyle'); rStyle.setAttributeNS(W_NS, 'w:val', 'CommentReference');
      refRPr.appendChild(rStyle);
      refRun.appendChild(refRPr);
      var refEl = xmlDoc.createElementNS(W_NS, 'w:commentReference'); refEl.setAttributeNS(W_NS, 'w:id', String(id));
      refRun.appendChild(refEl);

      firstHlRun.parentNode.insertBefore(startEl, firstHlRun);
      var insertPoint = lastHlRun.nextSibling;
      lastHlRun.parentNode.insertBefore(endEl, insertPoint);
      lastHlRun.parentNode.insertBefore(refRun, insertPoint);

      comments.push({ id: id, text: m.comment });
    });
    return comments;
  }

  function buildCommentsXml(comments) {
    var body = comments.map(function(c) {
      return '<w:comment w:id="' + c.id + '" w:author="Validator Sitasi" w:initials="VS" w:date="' + new Date().toISOString() + '"><w:p><w:r><w:t xml:space="preserve">' + escapeXml(c.text) + '</w:t></w:r></w:p></w:comment>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:comments xmlns:w="' + W_NS + '">' + body + '</w:comments>';
  }

  // Registers word/comments.xml with the package if it isn't already wired up
  // ([Content_Types].xml override + word/_rels/document.xml.rels relationship).
  function ensureCommentsInfrastructure(zip) {
    var ctPath = '[Content_Types].xml';
    return zip.file(ctPath).async('string').then(function(ctXml) {
      if (!/PartName="\/word\/comments\.xml"/.test(ctXml)) {
        ctXml = ctXml.replace('</Types>', '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>');
        zip.file(ctPath, ctXml);
      }
      var relsPath = 'word/_rels/document.xml.rels';
      var relsFile = zip.file(relsPath);
      var relsPromise = relsFile ? relsFile.async('string') : Promise.resolve('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
      return relsPromise.then(function(relsXml) {
        if (!/Target="comments\.xml"/.test(relsXml)) {
          var ids = (relsXml.match(/Id="rId(\d+)"/g) || []).map(function(s) { return parseInt(s.replace(/\D/g, ''), 10); });
          var nextNum = (ids.length ? Math.max.apply(null, ids) : 0) + 1;
          var relId = 'rId' + nextNum;
          relsXml = relsXml.replace('</Relationships>', '<Relationship Id="' + relId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>');
          zip.file(relsPath, relsXml);
        }
      });
    });
  }

  // Locates every non-overlapping match of `regex` (must have 'g' flag) inside text[from:) and
  // returns absolute {start,end,color} objects.
  function findAllMatches(text, from, regex, color) {
    var out = [];
    regex.lastIndex = from;
    var m;
    while ((m = regex.exec(text))) {
      if (m[0].length === 0) { regex.lastIndex++; continue; }
      out.push({ start: m.index, end: m.index + m[0].length, color: color });
    }
    return out;
  }

  function buildYearRegexForRef(yearRaw) {
    if (!yearRaw) return null;
    var num = String(yearRaw).match(/(\d{4})/);
    if (!num) return null;
    return new RegExp('\\(?\\b' + num[1] + '[a-z]?\\b\\)?', 'i');
  }

  // Extracts reference-list paragraphs directly from the uploaded .docx's own XML (with
  // real italic info per run), independent of mammoth's plain-text extraction — this is
  // what makes the italic/case format check accurate: it reads the actual OOXML formatting
  // instead of relying on clipboard paste fidelity.
  function checkDocxReferenceFormatting(styleId) {
    if (!state.originalFile) return Promise.resolve([]);
    return state.originalFile.arrayBuffer()
      .then(function(buf) { return JSZip.loadAsync(buf); })
      .then(function(zip) {
        var docPath = 'word/document.xml';
        if (!zip.file(docPath)) return [];
        return zip.file(docPath).async('string').then(function(xmlString) {
          var xmlDoc = new DOMParser().parseFromString(xmlString, 'application/xml');
          var paragraphs = xmlDoc.getElementsByTagName('w:p');
          var richLines = [];
          for (var p = 0; p < paragraphs.length; p++) {
            var runs = paragraphs[p].getElementsByTagName('w:r');
            var segs = [];
            for (var r = 0; r < runs.length; r++) {
              var run = runs[r];
              var rPrList = run.getElementsByTagName('w:rPr');
              var rPr = rPrList.length > 0 ? rPrList[0] : null;
              var italic = false;
              if (rPr) {
                var iList = rPr.getElementsByTagName('w:i');
                if (iList.length > 0) {
                  var val = iList[0].getAttribute('w:val');
                  italic = (val === null || val === '' || val === '1' || val === 'true' || val === 'on');
                }
              }
              var tNodes = run.getElementsByTagName('w:t');
              var text = '';
              for (var t = 0; t < tNodes.length; t++) text += tNodes[t].textContent;
              if (!text) continue;
              var last = segs[segs.length - 1];
              if (last && last.italic === italic) last.text += text;
              else segs.push({ text: text, italic: italic });
            }
            richLines.push(segs);
          }
          function toPlain(l) { return l.map(function(s) { return s.text; }).join(''); }
          var fullText = richLines.map(toPlain).join('\n');
          var heading = CE.findReferencesHeading(fullText);
          if (!heading) return [];
          var refRichLines = richLines.slice(heading.lineIndex + 1).filter(function(l) { return toPlain(l).trim(); });
          var refText = refRichLines.map(toPlain).join('\n');
          var references = CE.parseReferenceList(refText, styleId);
          return CE.checkReferenceFormatting(refRichLines, references, styleId);
        });
      })
      .catch(function(err) { console.error('Formatting check failed:', err); return []; });
  }

  function buildHighlightedOriginalDocx(result, doiIssues, yearRange) {
    var file = state.originalFile;
    return file.arrayBuffer()
      .then(function(buf) { return JSZip.loadAsync(buf); })
      .then(function(zip) {
        var docPath = 'word/document.xml';
        if (!zip.file(docPath)) throw new Error('word/document.xml tidak ditemukan di dalam file .docx.');
        return zip.file(docPath).async('string').then(function(xmlString) {
          var xmlDoc = new DOMParser().parseFromString(xmlString, 'application/xml');
          if (xmlDoc.getElementsByTagName('parsererror').length > 0) throw new Error('Gagal membaca struktur XML .docx.');
          var index = buildDocxTextIndex(xmlDoc);
          var fullText = index.text;

          // Find where the reference list starts, so year-highlighting only searches there,
          // and issue-code highlighting only searches the article body before it.
          var headingInfo = CE.findReferencesHeading(fullText);
          var refZoneStart = headingInfo ? headingInfo.offset : Math.floor(fullText.length / 2);

          var matches = [];

          // 1) Reference year problems (within the selected range only, as requested)
          var cursor = refZoneStart;
          result.references.forEach(function(r) {
            var anchorTerm = (r.raw || r.firstAuthor || '').split(/\s+/).slice(0, 8).join(' ');
            var anchorRe = flexiblePattern(anchorTerm, 'i');
            if (!anchorRe) return;
            var slice = fullText.slice(cursor);
            var localMatch = slice.match(anchorRe);
            if (!localMatch) return;
            var anchorStart = cursor + localMatch.index;
            var anchorEnd = anchorStart + localMatch[0].length;
            cursor = anchorEnd;

            var y = CE.YearRange.getRefYear(r);
            var outOfRange = y != null && (y < yearRange.from || y > yearRange.to);
            var unknown = y == null;
            if (!outOfRange && !unknown) return;

            if (!unknown) {
              var yearRe = buildYearRegexForRef(r.year);
              var window_ = fullText.slice(anchorStart, anchorEnd + 220);
              var ym = yearRe ? window_.match(yearRe) : null;
              if (ym) {
                var ys = anchorStart + ym.index;
                matches.push({
                  start: ys, end: ys + ym[0].length, color: 'red',
                  comment: '⚠ Tahun referensi ' + ym[0] + ' berada di LUAR rentang yang diperiksa (' + yearRange.label + '). Pertimbangkan mengganti dengan sumber yang lebih baru, atau abaikan jika memang sengaja mengacu pada sumber lama (mis. teori dasar/klasik).'
                });
                return;
              }
            }
            // Unknown year, or year token not found near the anchor: flag the anchor itself.
            matches.push({
              start: anchorStart, end: anchorEnd, color: 'yellow',
              comment: '❔ Tahun untuk referensi ini tidak dapat dideteksi otomatis oleh sistem. Mohon periksa manual apakah masih dalam rentang ' + yearRange.label + '.'
            });
          });

          // 2) In-text issues (errors/suggestions) with a findable "code" snippet
          function collectIssueMatches(issues, color) {
            issues.forEach(function(issue) {
              if (!issue.code) return;
              var re = flexiblePattern(issue.code, 'gi');
              if (!re) return;
              var found = findAllMatches(fullText.slice(0, refZoneStart), 0, re, color);
              var commentText = issue.title + ' — ' + issue.description + (issue.correction ? ' | Saran perbaikan: ' + issue.correction : '');
              found.forEach(function(f) { f.comment = commentText; });
              matches = matches.concat(found);
            });
          }
          collectIssueMatches(result.errors, 'red');
          collectIssueMatches(result.suggestions, 'cyan');

          // Sort and drop overlaps (keep the first-encountered match).
          matches.sort(function(a, b) { return a.start - b.start; });
          var clean = [];
          var lastEnd = -1;
          matches.forEach(function(m) {
            if (m.start >= lastEnd) { clean.push(m); lastEnd = m.end; }
          });

          if (clean.length === 0) return { blob: null, count: 0 };

          var comments = applyHighlightsAndComments(xmlDoc, index, clean);
          // Serialize the root element (not the whole Document) — serializing a full XML
          // Document in some browsers auto-prepends its own <?xml ...?> declaration, and
          // adding ours on top produces two declarations, which Word refuses to open.
          var newXml = new XMLSerializer().serializeToString(xmlDoc.documentElement);
          if (!/^\s*<\?xml/i.test(newXml)) newXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + newXml;
          zip.file(docPath, newXml);

          var infraPromise = comments.length > 0 ? ensureCommentsInfrastructure(zip) : Promise.resolve();
          return infraPromise.then(function() {
            if (comments.length > 0) zip.file('word/comments.xml', buildCommentsXml(comments));
            return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
              .then(function(blob) { return { blob: blob, count: clean.length, commentCount: comments.length }; });
          });
        });
      });
  }

  els.downloadOriginalBtn.addEventListener('click', function() {
    if (!state.lastResult || !state.originalFile) return;
    if (typeof JSZip === 'undefined') {
      els.downloadOriginalStatus.textContent = '⚠️ Library JSZip gagal dimuat (masalah jaringan/CDN). Coba muat ulang halaman.';
      els.downloadOriginalStatus.className = 'status err';
      return;
    }
    els.downloadOriginalBtn.disabled = true;
    els.downloadOriginalStatus.textContent = 'Memproses & menandai naskah asli...';
    els.downloadOriginalStatus.className = 'status info';
    buildHighlightedOriginalDocx(state.lastResult, state.lastDoiIssues, state.yearRange)
      .then(function(res) {
        els.downloadOriginalBtn.disabled = false;
        if (!res.blob) {
          els.downloadOriginalStatus.textContent = 'Tidak ditemukan kalimat/tahun yang cocok untuk di-highlight secara otomatis di teks aslinya.';
          els.downloadOriginalStatus.className = 'status warn';
          return;
        }
        var url = URL.createObjectURL(res.blob);
        var a = document.createElement('a');
        var dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = (state.fileName || 'naskah').replace(/\.docx$/i, '') + '-HIGHLIGHT-' + dateStr + '.docx';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 4000);
        els.downloadOriginalStatus.textContent = '✅ Berhasil — ' + res.count + ' bagian di-highlight, ' + res.commentCount + ' komentar Word ditambahkan (buka panel Review > Comments di Word untuk membaca alasannya). Format asli dipertahankan.';
        els.downloadOriginalStatus.className = 'status ok';
      })
      .catch(function(err) {
        els.downloadOriginalBtn.disabled = false;
        els.downloadOriginalStatus.textContent = '⚠️ Gagal memproses: ' + err.message;
        els.downloadOriginalStatus.className = 'status err';
      });
  });
  // Debug/test-only hook — does not affect normal page behavior.
  window.__uploadInternal = {
    setResultForTesting: function(result, styleId, confidence) {
      state.lastResult = result;
      state.lastStyleId = styleId;
      state.lastConfidence = confidence;
      state.lastDoiIssues = [];
      state.jrOverrides = {};
      els.results.classList.add('active');
      renderResults(result, []);
    },
  };
})();
