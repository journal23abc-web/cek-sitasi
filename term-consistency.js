(function () {
  'use strict';

  var TCE = window.TermConsistencyEngine;
  var MAX_FILE_SIZE = 25 * 1024 * 1024;
  var MAX_TEXT_CHARS = 2 * 1024 * 1024;
  var MAX_ZIP_ENTRIES = 5000;
  var MAX_UNCOMPRESSED_SIZE = 120 * 1024 * 1024;
  var REVIEW_STORAGE_PREFIX = 'termConsistencyReviews:v2:';

  var els = {
    articleText: document.getElementById('articleText'),
    glossaryInput: document.getElementById('glossaryInput'),
    processBtn: document.getElementById('processBtn'),
    exportBtn: document.getElementById('exportBtn'),
    clearReviewsBtn: document.getElementById('clearReviewsBtn'),
    statusMsg: document.getElementById('statusMsg'),
    results: document.getElementById('results'),
    summaryGrid: document.getElementById('summaryGrid'),
    analysisMetaPanel: document.getElementById('analysisMetaPanel'),
    inconsistentPanel: document.getElementById('inconsistentPanel'),
    undefinedPanel: document.getElementById('undefinedPanel'),
    aliasPanel: document.getElementById('aliasPanel'),
    dictionaryPanel: document.getElementById('dictionaryPanel'),
    modePasteBtn: document.getElementById('modePasteBtn'),
    modeUploadBtn: document.getElementById('modeUploadBtn'),
    pasteModePanel: document.getElementById('pasteModePanel'),
    uploadModePanel: document.getElementById('uploadModePanel'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    fileChip: document.getElementById('fileChip'),
    fileName: document.getElementById('fileName'),
    fileSize: document.getElementById('fileSize'),
    fileRemove: document.getElementById('fileRemove'),
  };

  var state = {
    mode: 'paste',
    file: null,
    rawResult: null,
    resolvedResult: null,
    reviewDecisions: {},
    fingerprint: null,
    tableRowCount: 0,
    worker: null,
    requestId: 0,
  };

  function esc(value) {
    var d = document.createElement('div');
    d.textContent = value == null ? '' : String(value);
    return d.innerHTML;
  }

  function setStatus(message, kind) {
    els.statusMsg.textContent = message || '';
    els.statusMsg.className = 'status ' + (kind || 'info');
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function setMode(mode) {
    state.mode = mode;
    els.modePasteBtn.classList.toggle('active', mode === 'paste');
    els.modeUploadBtn.classList.toggle('active', mode === 'upload');
    els.pasteModePanel.style.display = mode === 'paste' ? '' : 'none';
    els.uploadModePanel.style.display = mode === 'upload' ? '' : 'none';
    setStatus('', 'info');
  }

  els.modePasteBtn.addEventListener('click', function () { setMode('paste'); });
  els.modeUploadBtn.addEventListener('click', function () { setMode('upload'); });

  function openFilePicker() { els.fileInput.click(); }
  els.dropzone.addEventListener('click', openFilePicker);
  els.dropzone.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFilePicker();
    }
  });
  els.dropzone.addEventListener('dragover', function (event) {
    event.preventDefault();
    els.dropzone.classList.add('drag');
  });
  els.dropzone.addEventListener('dragleave', function () { els.dropzone.classList.remove('drag'); });
  els.dropzone.addEventListener('drop', function (event) {
    event.preventDefault();
    els.dropzone.classList.remove('drag');
    if (event.dataTransfer.files.length) selectFile(event.dataTransfer.files[0]);
  });
  els.fileInput.addEventListener('change', function (event) {
    if (event.target.files.length) selectFile(event.target.files[0]);
  });
  els.fileRemove.addEventListener('click', function (event) {
    event.stopPropagation();
    state.file = null;
    els.fileInput.value = '';
    els.fileChip.classList.remove('show');
    setStatus('', 'info');
  });

  if (window.SharedFile) {
    window.SharedFile.load().then(function (result) {
      if (result && result.file) selectFile(result.file);
    });
  }

  function selectFile(file) {
    if (!/\.docx$/i.test(file.name)) {
      setStatus('⚠️ Mohon pilih file .docx.', 'warn');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setStatus('⚠️ File terlalu besar. Batas maksimum 25 MB.', 'warn');
      return;
    }
    state.file = file;
    els.fileName.textContent = file.name;
    els.fileSize.textContent = formatSize(file.size);
    els.fileChip.classList.add('show');
    setStatus('', 'info');
  }

  els.processBtn.addEventListener('click', function () {
    if (state.mode === 'upload') processUpload();
    else processPastedText();
  });

  function validateText(text) {
    if (!text || text.trim().split(/\s+/).length < 30) throw new Error('Teks terlalu pendek untuk dianalisis dengan andal.');
    if (text.length > MAX_TEXT_CHARS) throw new Error('Teks melebihi batas 2 juta karakter. Pecah naskah menjadi beberapa bagian.');
  }

  function processPastedText() {
    try {
      var text = els.articleText.value.trim();
      validateText(text);
      runAnalysis(text, []);
    } catch (error) {
      setStatus('⚠️ ' + error.message, 'warn');
    }
  }

  function validateZipPackage(zip) {
    var names = Object.keys(zip.files);
    if (names.length > MAX_ZIP_ENTRIES) throw new Error('Paket DOCX memiliki terlalu banyak bagian dan ditolak untuk keamanan.');
    var total = 0;
    names.forEach(function (name) {
      var entry = zip.files[name];
      if (entry && entry._data && Number.isFinite(entry._data.uncompressedSize)) total += entry._data.uncompressedSize;
    });
    if (total > MAX_UNCOMPRESSED_SIZE) throw new Error('Isi DOCX setelah diekstrak terlalu besar dan ditolak untuk keamanan.');
    if (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) throw new Error('Struktur DOCX tidak valid atau tidak lengkap.');
  }

  function processUpload() {
    if (!state.file) {
      setStatus('⚠️ Pilih file .docx terlebih dahulu.', 'warn');
      return;
    }
    if (typeof JSZip === 'undefined' || typeof mammoth === 'undefined') {
      setStatus('⚠️ Komponen pembaca DOCX gagal dimuat. Muat ulang halaman.', 'err');
      return;
    }
    els.processBtn.disabled = true;
    setStatus('⏳ Memeriksa dan membaca DOCX...', 'info');
    var reader = new FileReader();
    reader.onerror = function () {
      setStatus('❌ File tidak dapat dibaca.', 'err');
      els.processBtn.disabled = false;
    };
    reader.onload = function () {
      var buffer = reader.result;
      JSZip.loadAsync(buffer).then(function (zip) {
        validateZipPackage(zip);
        return Promise.all([
          mammoth.extractRawText({ arrayBuffer: buffer }),
          zip.file('word/document.xml').async('string'),
        ]);
      }).then(function (parts) {
        var text = parts[0].value || '';
        validateText(text);
        var xmlDoc = new DOMParser().parseFromString(parts[1], 'application/xml');
        if (xmlDoc.getElementsByTagName('parsererror').length) throw new Error('XML utama di dalam DOCX tidak valid.');
        var tableRows = TCE.extractDocxTableRows(xmlDoc);
        runAnalysis(text, tableRows);
      }).catch(function (error) {
        console.error(error);
        setStatus('❌ Gagal membaca DOCX: ' + error.message, 'err');
        els.processBtn.disabled = false;
      });
    };
    reader.readAsArrayBuffer(state.file);
  }

  function loadReviewDecisions(fingerprint) {
    try {
      return JSON.parse(localStorage.getItem(REVIEW_STORAGE_PREFIX + fingerprint) || '{}');
    } catch (error) {
      return {};
    }
  }

  function saveReviewDecisions() {
    if (!state.fingerprint) return;
    try {
      localStorage.setItem(REVIEW_STORAGE_PREFIX + state.fingerprint, JSON.stringify(state.reviewDecisions));
    } catch (error) {}
  }

  function finishAnalysis(result, tableRowCount) {
    state.rawResult = result;
    state.tableRowCount = tableRowCount;
    render(result, tableRowCount);
    var notes = [];
    if (result.analysisMeta.referenceSectionFound) notes.push('bagian referensi dikeluarkan');
    if (tableRowCount) notes.push(tableRowCount + ' baris tabel statistik dipertimbangkan');
    if (result.analysisMeta.glossaryGroupsApplied) notes.push(result.analysisMeta.glossaryGroupsApplied + ' aturan kamus diterapkan');
    setStatus('✅ Selesai' + (notes.length ? ' — ' + notes.join('; ') : '') + '.', 'ok');
    els.processBtn.disabled = false;
    els.exportBtn.disabled = false;
    els.clearReviewsBtn.disabled = false;
  }

  function runAnalysis(text, tableRows) {
    if (state.worker) {
      state.worker.terminate();
      state.worker = null;
    }
    state.requestId++;
    var requestId = state.requestId;
    var glossary = els.glossaryInput ? els.glossaryInput.value : '';
    state.fingerprint = TCE.fingerprintText(text + '\n#glossary\n' + glossary);
    state.reviewDecisions = loadReviewDecisions(state.fingerprint);
    els.processBtn.disabled = true;
    setStatus('⏳ Menganalisis istilah di proses latar...', 'info');
    var options = { tableRows: tableRows, glossary: glossary, excludeReferences: true };

    if (typeof Worker !== 'undefined') {
      var worker = new Worker('term-consistency-worker.js?v=1');
      state.worker = worker;
      worker.onmessage = function (event) {
        var message = event.data || {};
        if (message.requestId !== requestId) return;
        worker.terminate();
        state.worker = null;
        if (message.type === 'error') {
          setStatus('❌ Gagal menganalisis: ' + message.message, 'err');
          els.processBtn.disabled = false;
          return;
        }
        finishAnalysis(message.result, tableRows.length);
      };
      worker.onerror = function (event) {
        worker.terminate();
        state.worker = null;
        console.error(event);
        runAnalysisFallback(text, options, tableRows.length);
      };
      worker.postMessage({ type: 'analyze', requestId: requestId, text: text, options: options });
    } else {
      runAnalysisFallback(text, options, tableRows.length);
    }
  }

  function runAnalysisFallback(text, options, tableRowCount) {
    setTimeout(function () {
      try {
        finishAnalysis(TCE.buildConceptDictionary(text, options), tableRowCount);
      } catch (error) {
        console.error(error);
        setStatus('❌ Gagal menganalisis: ' + error.message, 'err');
        els.processBtn.disabled = false;
      }
    }, 20);
  }

  function issueTypeLabel(types) {
    var labels = { HYPHENATION: 'tanda hubung', PUNCTUATION: 'tanda baca' };
    return (types || []).map(function (type) { return labels[type] || type; }).join(', ');
  }

  function conceptByName(result, name) {
    var keys = Object.keys(result.concepts);
    for (var i = 0; i < keys.length; i++) {
      if (result.concepts[keys[i]].canonicalSurface === name) return result.concepts[keys[i]];
    }
    return null;
  }

  function render(rawResult, tableRowCount) {
    var result = TCE.applyReviewDecisions(rawResult, state.reviewDecisions);
    state.resolvedResult = result;
    els.results.classList.add('active');
    var conceptList = Object.keys(result.concepts).map(function (key) { return result.concepts[key]; });
    var pendingReviews = rawResult.possibleAliases.filter(function (pair) { return !state.reviewDecisions[pair.pairKey]; }).length;

    els.summaryGrid.innerHTML =
      '<div class="sum-card info"><div class="n">' + conceptList.length + '</div><div class="l">Konsep Terdeteksi</div></div>' +
      '<div class="sum-card warn"><div class="n">' + result.inconsistentTerms.length + '</div><div class="l">Perlu Diseragamkan</div></div>' +
      '<div class="sum-card warn"><div class="n">' + result.undefinedImportantTerms.length + '</div><div class="l">Belum Didefinisikan</div></div>' +
      '<div class="sum-card"><div class="n">' + pendingReviews + '</div><div class="l">Review Alias Tersisa</div></div>' +
      '<div class="sum-card ok"><div class="n">' + (result.reviewSummary ? result.reviewSummary.mergedByUser : 0) + '</div><div class="l">Digabung Pengguna</div></div>' +
      (tableRowCount ? '<div class="sum-card ok"><div class="n">' + tableRowCount + '</div><div class="l">Baris Tabel Statistik</div></div>' : '');

    var meta = rawResult.analysisMeta || {};
    var metrics = rawResult.reviewMetrics || {};
    els.analysisMetaPanel.innerHTML =
      '<span>Karakter dianalisis: <b>' + (meta.analyzedCharacters || 0).toLocaleString('id-ID') + '</b></span>' +
      '<span>Referensi dikeluarkan: <b>' + (meta.referenceSectionFound ? 'ya' : 'tidak ditemukan') + '</b></span>' +
      '<span>Pasangan dihitung: <b>' + (metrics.candidatePairs || 0) + '</b> dari ' + (metrics.possiblePairs || 0) + '</span>' +
      '<span>Keputusan review: <b>' + (result.reviewSummary ? result.reviewSummary.decided : 0) + '/' + rawResult.possibleAliases.length + '</b></span>';

    if (!result.inconsistentTerms.length) {
      els.inconsistentPanel.innerHTML = '<p class="empty-note">Tidak ditemukan perbedaan tanda hubung atau tanda baca yang perlu diseragamkan. Perbedaan kapitalisasi normal dan tunggal/jamak tidak dianggap kesalahan.</p>';
    } else {
      var inconsistentHtml = '<p class="section-note">Hanya variasi ortografis yang dapat ditindaklanjuti yang ditampilkan. Kapitalisasi awal kalimat dan bentuk tunggal/jamak tidak otomatis dianggap salah.</p>';
      result.inconsistentTerms.forEach(function (concept) {
        inconsistentHtml += '<div class="tc-issue"><div class="tc-term">' + esc(concept.canonicalSurface) + '</div>' +
          '<div class="tc-meta">Jenis perbedaan: ' + esc(issueTypeLabel(concept.consistency && concept.consistency.issueTypes)) + '</div>' +
          '<div class="tc-variants">' + concept.surfaceVariants.map(function (variant) {
            return '<span class="tc-variant">' + esc(variant.text) + ' <span class="muted">×' + variant.count + '</span></span>';
          }).join('') + '</div></div>';
      });
      els.inconsistentPanel.innerHTML = inconsistentHtml;
    }

    if (!result.undefinedImportantTerms.length) {
      els.undefinedPanel.innerHTML = '<p class="empty-note">Semua istilah dengan bukti langsung sebagai variabel ditemukan memiliki definisi atau komposisi.</p>';
    } else {
      var undefinedHtml = '<p class="section-note">Daftar ini membutuhkan bukti langsung (pengukuran, hipotesis, relasi, atau statistik), bukan sekadar sering muncul.</p>';
      result.undefinedImportantTerms.forEach(function (term) {
        var concept = conceptByName(result, term);
        var evidence = concept && concept.variableEvidence;
        var evidenceLabels = [];
        if (evidence && evidence.measurement) evidenceLabels.push('pengukuran');
        if (evidence && evidence.hypothesis) evidenceLabels.push('hipotesis/relasi');
        if (evidence && evidence.statistics) evidenceLabels.push('statistik');
        undefinedHtml += '<div class="tc-issue"><div class="tc-term">' + esc(term) + '</div>' +
          '<div class="tc-meta">Bukti: ' + esc(evidenceLabels.join(', ') || 'indikasi terbatas') + '</div>' +
          (concept && concept.contexts && concept.contexts.length ? '<div class="tc-context">…' + esc(concept.contexts[0].text) + '…</div>' : '') + '</div>';
      });
      els.undefinedPanel.innerHTML = undefinedHtml;
    }

    renderAliasReviews(rawResult);
    renderDictionary(result, conceptList);
    renderRelations(result);
  }

  function renderAliasReviews(rawResult) {
    if (!rawResult.possibleAliases.length) {
      els.aliasPanel.innerHTML = '<p class="empty-note">Tidak ada pasangan yang memiliki bukti cukup untuk masuk antrean review. Sistem tidak memaksakan pasangan dari kemiripan kata yang lemah.</p>';
      return;
    }
    var html = '<p class="section-note"><b>Tidak ada penggabungan otomatis.</b> Pilih istilah utama hanya setelah membaca bukti dan konteks. Keputusan disimpan lokal untuk naskah ini.</p>';
    rawResult.possibleAliases.forEach(function (pair) {
      var decision = state.reviewDecisions[pair.pairKey];
      var status = '';
      if (decision) {
        if (decision.action === 'same') status = 'Digabung — istilah utama: ' + (decision.preferred === pair.normB ? pair.termB : pair.termA);
        else if (decision.action === 'different') status = 'Ditetapkan sebagai konsep berbeda';
        else status = 'Diabaikan dari review';
      }
      html += '<div class="tc-issue review ' + (decision ? 'decided' : '') + '" data-pair-card="' + esc(pair.pairKey) + '">' +
        '<div class="alias-head"><div><div class="tc-term">' + esc(pair.termA) + ' ↔ ' + esc(pair.termB) + '</div>' +
        '<div class="tc-meta">Prioritas ' + esc(pair.priority) + ' · skor ' + pair.score.toFixed(2) + ' · ' + esc(pair.reason) + '</div></div>' +
        (status ? '<span class="decision-badge">' + esc(status) + '</span>' : '') + '</div>' +
        '<div class="evidence-grid">' + Object.keys(pair.evidence || {}).map(function (key) {
          return '<span>' + esc(key) + ': <b>' + Number(pair.evidence[key]).toFixed(2) + '</b></span>';
        }).join('') + '</div>' +
        renderPairContexts(pair) +
        '<div class="review-actions">' +
          '<button type="button" data-review-action="same" data-preferred="' + esc(pair.normA) + '" data-pair="' + esc(pair.pairKey) + '">Sama — pakai “' + esc(pair.termA) + '”</button>' +
          '<button type="button" data-review-action="same" data-preferred="' + esc(pair.normB) + '" data-pair="' + esc(pair.pairKey) + '">Sama — pakai “' + esc(pair.termB) + '”</button>' +
          '<button type="button" data-review-action="different" data-pair="' + esc(pair.pairKey) + '">Konsep berbeda</button>' +
          '<button type="button" data-review-action="ignore" data-pair="' + esc(pair.pairKey) + '">Abaikan</button>' +
          (decision ? '<button type="button" data-review-action="clear" data-pair="' + esc(pair.pairKey) + '">Batalkan keputusan</button>' : '') +
        '</div></div>';
    });
    els.aliasPanel.innerHTML = html;
  }

  function renderPairContexts(pair) {
    var left = pair.contexts && pair.contexts.termA && pair.contexts.termA[0];
    var right = pair.contexts && pair.contexts.termB && pair.contexts.termB[0];
    if (!left && !right) return '';
    return '<div class="context-grid">' +
      '<div><b>' + esc(pair.termA) + '</b><p>' + esc(left ? left.text : 'Konteks tidak tersedia') + '</p></div>' +
      '<div><b>' + esc(pair.termB) + '</b><p>' + esc(right ? right.text : 'Konteks tidak tersedia') + '</p></div>' +
      '</div>';
  }

  els.aliasPanel.addEventListener('click', function (event) {
    var button = event.target.closest('[data-review-action]');
    if (!button || !state.rawResult) return;
    var pairKey = button.getAttribute('data-pair');
    var action = button.getAttribute('data-review-action');
    if (action === 'clear') delete state.reviewDecisions[pairKey];
    else state.reviewDecisions[pairKey] = { action: action, preferred: button.getAttribute('data-preferred') || null };
    saveReviewDecisions();
    render(state.rawResult, state.tableRowCount);
  });

  function renderDictionary(result, conceptList) {
    var html = '<div class="table-scroll"><table class="tc-table"><thead><tr><th>Istilah</th><th>Tipe</th><th>Peran</th><th>Alias</th><th>Skor &amp; bukti</th><th>Definisi</th></tr></thead><tbody>';
    conceptList.sort(function (a, b) { return b.variableScore - a.variableScore; }).forEach(function (concept) {
      var aliases = (concept.aliasAcronyms || []).concat(concept.userAliases || []);
      var evidence = concept.variableEvidence || {};
      var direct = [];
      if (evidence.measurement) direct.push('ukur');
      if (evidence.hypothesis) direct.push('relasi');
      if (evidence.statistics) direct.push('stat');
      html += '<tr><td><b>' + esc(concept.canonicalSurface) + '</b>' +
        (concept.mergedFrom && concept.mergedFrom.length ? '<div class="muted">digabung dari: ' + esc(concept.mergedFrom.join(', ')) + '</div>' : '') +
        (concept.consistencyIssue ? ' <span title="Perlu diseragamkan">⚠️</span>' : '') + '</td>' +
        '<td><span class="tc-type ' + esc(concept.type) + '">' + esc(concept.type.replace(/_/g, ' ')) + '</span></td>' +
        '<td>' + esc(concept.roles && concept.roles.length ? concept.roles.join(', ') : '—') + '</td>' +
        '<td>' + esc(aliases.length ? aliases.join(', ') : '—') + '</td>' +
        '<td><b>' + Number(concept.variableScore || 0).toFixed(2) + '</b><div class="muted">' + esc(direct.join(' · ') || 'tanpa bukti langsung') + (concept.hasTableStatEvidence ? ' · tabel' : '') + '</div></td>' +
        '<td>' + (concept.definitions && concept.definitions.length ? concept.definitions.map(function (definition) {
          return '<div class="definition"><b>' + esc(definition.type) + '</b> (' + esc(definition.confidence) + '): ' + esc(definition.text.slice(0, 130)) + (definition.text.length > 130 ? '…' : '') + '</div>';
        }).join('') : '<span class="muted">tidak ditemukan</span>') + '</td></tr>';
    });
    html += '</tbody></table></div>';
    els.dictionaryPanel.innerHTML = html;
  }

  function renderRelations(result) {
    var relPanel = document.getElementById('relationsPanel');
    if (!relPanel) return;
    if (!result.relations.length) {
      relPanel.innerHTML = '<p class="empty-note">Tidak ditemukan hubungan eksplisit yang cukup aman untuk ditampilkan.</p>';
      return;
    }
    var labelFor = function (norm) { return result.concepts[norm] ? result.concepts[norm].canonicalSurface : norm; };
    var labels = { PREDICTS: '→ memprediksi/berasosiasi →', MEDIATES: '⤳ memediasi antara', RELATED_TO: '↔ berhubungan dengan' };
    var html = '<p class="section-note">Graph hanya memakai verba relasi eksplisit. Kalimat kompleks tetap perlu dibaca manual.</p>';
    result.relations.forEach(function (relation) {
      var display = relation.type === 'MEDIATES'
        ? labelFor(relation.subject) + ' ' + labels[relation.type] + ' ' + relation.between.map(labelFor).join(' & ')
        : labelFor(relation.subject) + ' ' + labels[relation.type] + ' ' + labelFor(relation.object);
      html += '<div class="tc-issue relation"><div class="tc-term">' + esc(display) + (relation.inferred ? ' <span class="muted">(tersirat)</span>' : '') + '</div></div>';
    });
    relPanel.innerHTML = html;
  }

  els.clearReviewsBtn.addEventListener('click', function () {
    if (!state.rawResult) return;
    state.reviewDecisions = {};
    if (state.fingerprint) {
      try { localStorage.removeItem(REVIEW_STORAGE_PREFIX + state.fingerprint); } catch (error) {}
    }
    render(state.rawResult, state.tableRowCount);
  });

  els.exportBtn.addEventListener('click', function () {
    if (!state.resolvedResult) return;
    var payload = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      reviewDecisions: state.reviewDecisions,
      result: state.resolvedResult,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'hasil-konsistensi-istilah.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  window.__termConsistencyInternal = {
    render: render,
    runAnalysisForTesting: function (text, tableRows) { runAnalysis(text, tableRows || []); },
    getState: function () { return state; },
  };
})();
