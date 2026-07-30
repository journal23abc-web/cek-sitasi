(function () {
  'use strict';
  var TCE = window.TermConsistencyEngine;

  var els = {
    articleText: document.getElementById('articleText'),
    processBtn: document.getElementById('processBtn'),
    statusMsg: document.getElementById('statusMsg'),
    results: document.getElementById('results'),
    summaryGrid: document.getElementById('summaryGrid'),
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

  var state = { mode: 'paste', file: null, tableRows: [] };

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function setStatus(msg, kind) {
    els.statusMsg.textContent = msg || '';
    els.statusMsg.className = 'status ' + (kind || 'info');
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  // ---------- mode toggle ----------
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

  // ---------- file selection (mirrors link-upload.js's dropzone pattern) ----------
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
  });

  function selectFile(f) {
    if (!/\.docx$/i.test(f.name)) {
      setStatus('⚠️ Mohon pilih file .docx', 'warn');
      return;
    }
    state.file = f;
    els.fileName.textContent = f.name;
    els.fileSize.textContent = formatSize(f.size);
    els.fileChip.classList.add('show');
    setStatus('', 'info');
  }

  // ---------- processing ----------
  els.processBtn.addEventListener('click', function () {
    if (state.mode === 'upload') {
      processUpload();
    } else {
      processPastedText();
    }
  });

  function processPastedText() {
    var text = els.articleText.value.trim();
    if (!text) {
      setStatus('⚠️ Tempel teks naskah terlebih dahulu.', 'warn');
      return;
    }
    if (text.split(/\s+/).length < 30) {
      setStatus('⚠️ Teks terlalu pendek untuk dianalisis dengan andal.', 'warn');
      return;
    }
    runAnalysis(text, []);
  }

  function processUpload() {
    if (!state.file) {
      setStatus('⚠️ Pilih file .docx terlebih dahulu.', 'warn');
      return;
    }
    if (typeof JSZip === 'undefined' || typeof mammoth === 'undefined') {
      setStatus('⚠️ Library JSZip/mammoth gagal dimuat (masalah jaringan/CDN). Coba muat ulang halaman.', 'err');
      return;
    }
    els.processBtn.disabled = true;
    setStatus('⏳ Membaca file .docx...', 'info');
    var file = state.file;
    var reader = new FileReader();
    reader.onerror = function () {
      setStatus('⚠️ Gagal membaca file.', 'err');
      els.processBtn.disabled = false;
    };
    reader.onload = function () {
      var buf = reader.result;
      Promise.all([
        mammoth.extractRawText({ arrayBuffer: buf }),
        JSZip.loadAsync(buf).then(function (zip) {
          var docFile = zip.file('word/document.xml');
          if (!docFile) return null;
          return docFile.async('string');
        }),
      ])
      .then(function (parts) {
        var text = parts[0].value;
        var xmlStr = parts[1];
        var tableRows = [];
        if (xmlStr) {
          try {
            var xmlDoc = new DOMParser().parseFromString(xmlStr, 'application/xml');
            if (!xmlDoc.getElementsByTagName('parsererror').length) {
              tableRows = TCE.extractDocxTableRows(xmlDoc);
            }
          } catch (err) {
            console.error('Gagal membaca tabel dari .docx:', err);
          }
        }
        if (!text || text.split(/\s+/).length < 30) {
          setStatus('⚠️ Teks dalam file terlalu pendek atau tidak terbaca.', 'warn');
          els.processBtn.disabled = false;
          return;
        }
        setStatus(tableRows.length ? '⏳ Menganalisis (' + tableRows.length + ' baris tabel statistik ditemukan)...' : '⏳ Menganalisis...', 'info');
        setTimeout(function () { runAnalysis(text, tableRows); }, 30);
      })
      .catch(function (err) {
        console.error(err);
        setStatus('❌ Gagal membaca file: ' + err.message, 'err');
        els.processBtn.disabled = false;
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function runAnalysis(text, tableRows) {
    setStatus('⏳ Menganalisis...', 'info');
    els.processBtn.disabled = true;
    // Run on next tick so the "Menganalisis..." status actually paints before the (synchronous,
    // potentially slow-ish on very long text) analysis runs.
    setTimeout(function () {
      try {
        var result = TCE.buildConceptDictionary(text, { tableRows: tableRows });
        render(result, tableRows.length);
        setStatus(tableRows.length ? '✅ Selesai — ' + tableRows.length + ' baris tabel statistik ikut dipertimbangkan.' : '✅ Selesai.', 'ok');
      } catch (err) {
        console.error(err);
        setStatus('❌ Gagal menganalisis: ' + err.message, 'err');
      } finally {
        els.processBtn.disabled = false;
      }
    }, 30);
  }

  function render(result, tableRowCount) {
    els.results.classList.add('active');
    var conceptList = Object.keys(result.concepts).map(function (k) { return result.concepts[k]; });

    els.summaryGrid.innerHTML =
      '<div class="sum-card info"><div class="n">' + conceptList.length + '</div><div class="l">Konsep Terdeteksi</div></div>' +
      '<div class="sum-card warn"><div class="n">' + result.inconsistentTerms.length + '</div><div class="l">Tidak Konsisten</div></div>' +
      '<div class="sum-card warn"><div class="n">' + result.undefinedImportantTerms.length + '</div><div class="l">Belum Didefinisikan</div></div>' +
      '<div class="sum-card"><div class="n">' + result.possibleAliases.length + '</div><div class="l">Kemungkinan Alias</div></div>' +
      '<div class="sum-card ok"><div class="n">' + result.acronymAliases.length + '</div><div class="l">Pasangan Akronim</div></div>' +
      (tableRowCount ? '<div class="sum-card ok"><div class="n">' + tableRowCount + '</div><div class="l">Baris Tabel Statistik</div></div>' : '');

    // ---------- Inconsistent terms ----------
    if (result.inconsistentTerms.length === 0) {
      els.inconsistentPanel.innerHTML = '<p class="empty-note">Tidak ditemukan istilah yang ditulis dengan lebih dari satu variasi bentuk (huruf besar/kecil, tanda hubung, tunggal/jamak).</p>';
    } else {
      var html = '<p style="font-size:11.5px;color:var(--text-dim);margin:0 0 12px;">Istilah berikut tampaknya merujuk pada konsep yang sama, tapi ditulis dengan lebih dari satu cara di naskah. Pertimbangkan menyeragamkan penulisannya.</p>';
      result.inconsistentTerms.forEach(function (c) {
        html += '<div class="tc-issue"><div class="tc-term">' + esc(c.canonicalSurface) + '</div>' +
          '<div class="tc-variants">' + c.surfaceVariants.map(function (v) {
            return '<span class="tc-variant">' + esc(v.text) + ' <span style="color:var(--text-faint);">×' + v.count + '</span></span>';
          }).join('') + '</div></div>';
      });
      els.inconsistentPanel.innerHTML = html;
    }

    // ---------- Undefined but important terms ----------
    if (result.undefinedImportantTerms.length === 0) {
      els.undefinedPanel.innerHTML = '<p class="empty-note">Semua istilah yang terlihat seperti variabel penelitian ditemukan memiliki definisi.</p>';
    } else {
      var html2 = '<p style="font-size:11.5px;color:var(--text-dim);margin:0 0 12px;">Istilah berikut sering muncul dan tampak berfungsi sebagai variabel penelitian (diukur/dihipotesiskan), tapi tidak ditemukan kalimat definisinya di naskah.</p>';
      result.undefinedImportantTerms.forEach(function (term) {
        html2 += '<div class="tc-issue"><div class="tc-term">' + esc(term) + '</div></div>';
      });
      els.undefinedPanel.innerHTML = html2;
    }

    // ---------- Possible aliases (never auto-merged) ----------
    if (result.possibleAliases.length === 0) {
      els.aliasPanel.innerHTML = '<p class="empty-note">Tidak ada pasangan istilah dengan kemiripan cukup tinggi untuk ditandai.</p>';
    } else {
      var html3 = '<p style="font-size:11.5px;color:var(--text-dim);margin:0 0 12px;">Pasangan berikut punya kemiripan kata/ukuran yang cukup tinggi — <b>TIDAK digabung otomatis</b>. Periksa manual apakah keduanya benar-benar konsep yang sama.</p>';
      result.possibleAliases.forEach(function (p) {
        html3 += '<div class="tc-issue review"><div class="tc-term">' + esc(p.termA) + ' ↔ ' + esc(p.termB) + '</div>' +
          '<div class="tc-meta">skor kemiripan: ' + p.score + ' · ' + esc(p.reason) + '</div></div>';
      });
      els.aliasPanel.innerHTML = html3;
    }

    // ---------- Full concept dictionary ----------
    var html4 = '<table class="tc-table"><thead><tr><th>Istilah</th><th>Tipe</th><th>Peran</th><th>Akronim</th><th>Indikator</th><th>Skor Variabel</th><th>Definisi</th></tr></thead><tbody>';
    conceptList.sort(function (a, b) { return b.variableScore - a.variableScore; }).forEach(function (c) {
      html4 += '<tr>' +
        '<td>' + esc(c.canonicalSurface) + (c.consistencyIssue ? ' <span style="color:var(--amber);">⚠️</span>' : '') + (c.hasTableStatEvidence ? ' <span title="Skor didukung bukti tabel statistik" style="color:var(--cyan);">📊</span>' : '') + '</td>' +
        '<td><span class="tc-type ' + c.type + '">' + c.type.replace(/_/g, ' ') + '</span></td>' +
        '<td>' + (c.roles && c.roles.length ? esc(c.roles.join(', ')) : '—') + '</td>' +
        '<td>' + (c.aliasAcronyms.length ? esc(c.aliasAcronyms.join(', ')) : '—') + '</td>' +
        '<td>' + (c.indicators && c.indicators.length ? esc(c.indicators.join(', ')) : '—') + '</td>' +
        '<td>' + c.variableScore + '</td>' +
        '<td>' + (c.definitions.length ? c.definitions.map(function (d) { return '<div style="margin-bottom:4px;"><b>' + d.type + '</b>: ' + esc(d.text.slice(0, 100)) + (d.text.length > 100 ? '…' : '') + '</div>'; }).join('') : '<span style="color:var(--text-faint);">tidak ditemukan</span>') + '</td>' +
        '</tr>';
    });
    html4 += '</tbody></table>';
    els.dictionaryPanel.innerHTML = html4;

    // ---------- Relation graph ----------
    var relPanel = document.getElementById('relationsPanel');
    if (relPanel) {
      if (!result.relations.length) {
        relPanel.innerHTML = '<p class="empty-note">Tidak ditemukan pola hubungan eksplisit ("X memprediksi Y", "X memediasi hubungan antara Y dan Z", dsb.) antar istilah yang terdeteksi.</p>';
      } else {
        var html5 = '<p style="font-size:11.5px;color:var(--text-dim);margin:0 0 12px;">Hubungan sebab-akibat/mediasi yang terdeteksi dari kalimat naskah — dipakai juga untuk mencegah dua istilah yang jelas berbeda (dihubungkan panah sebab-akibat) tertandai sebagai "kemungkinan alias" di atas. Ini heuristik berbasis posisi kata, bisa meleset untuk kalimat sangat kompleks — bukan pengganti pembacaan model penelitian secara manual.</p>';
        var typeLabel = { PREDICTS: '→ memprediksi →', MEDIATES: '⤳ memediasi antara', RELATED_TO: '↔ berhubungan dengan' };
        result.relations.forEach(function (r) {
          var display = r.type === 'MEDIATES'
            ? esc(r.subject) + ' ' + typeLabel[r.type] + ' ' + esc(r.between.join(' & '))
            : esc(r.subject) + ' ' + typeLabel[r.type] + ' ' + esc(r.object);
          html5 += '<div class="tc-issue" style="border-left-color:var(--cyan);"><div class="tc-term" style="font-size:12.5px;">' + display + (r.inferred ? ' <span style="color:var(--text-faint);font-family:var(--font-mono);font-size:10px;">(tersirat dari mediasi)</span>' : '') + '</div></div>';
        });
        relPanel.innerHTML = html5;
      }
    }
  }

  // Debug/test-only hook — does not affect normal page behavior.
  window.__termConsistencyInternal = {
    render: render,
    runAnalysisForTesting: function (text, tableRows) { runAnalysis(text, tableRows || []); },
  };
})();
