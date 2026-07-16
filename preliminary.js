(function () {
  'use strict';
  var DS = window.DocStatsEngine;

  var els = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    fileChip: document.getElementById('fileChip'),
    fileName: document.getElementById('fileName'),
    fileSize: document.getElementById('fileSize'),
    removeFile: document.getElementById('removeFile'),
    processBtn: document.getElementById('processBtn'),
    includeReferences: document.getElementById('includeReferences'),
    statusMsg: document.getElementById('statusMsg'),
    results: document.getElementById('results'),
    dashboardBody: document.getElementById('dashboardBody'),
    checklistBody: document.getElementById('checklistBody'),
    exportBtn: document.getElementById('exportBtn'),
    exportStatus: document.getElementById('exportStatus'),
    reportPage: document.getElementById('reportPage'),
  };

  var state = { file: null, result: null };
  var MAX_FILE_SIZE = 25 * 1024 * 1024;

  function esc(t) {
    return (t == null ? '' : String(t)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function setStatus(msg, cls) { els.statusMsg.textContent = msg; els.statusMsg.className = 'status ' + (cls || 'info'); }

  // ---- File handling ----
  els.dropzone.addEventListener('click', function () { els.fileInput.click(); });
  els.dropzone.addEventListener('dragover', function (e) { e.preventDefault(); els.dropzone.classList.add('drag'); });
  els.dropzone.addEventListener('dragleave', function () { els.dropzone.classList.remove('drag'); });
  els.dropzone.addEventListener('drop', function (e) {
    e.preventDefault(); els.dropzone.classList.remove('drag');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  els.fileInput.addEventListener('change', function () {
    if (els.fileInput.files && els.fileInput.files[0]) handleFile(els.fileInput.files[0]);
  });
  els.removeFile.addEventListener('click', function (e) {
    e.stopPropagation();
    state.file = null;
    els.fileChip.classList.remove('show');
    els.processBtn.disabled = true;
    els.fileInput.value = '';
    setStatus('', 'info');
  });

  function handleFile(file) {
    var name = file.name.toLowerCase();
    if (!name.endsWith('.docx')) { setStatus('⚠️ Hanya file .docx yang didukung.', 'err'); return; }
    if (file.size > MAX_FILE_SIZE) { setStatus('⚠️ File terlalu besar (' + formatSize(file.size) + ', maksimum ' + formatSize(MAX_FILE_SIZE) + ').', 'err'); return; }
    state.file = file;
    els.fileName.textContent = file.name;
    els.fileSize.textContent = formatSize(file.size);
    els.fileChip.classList.add('show');
    els.processBtn.disabled = false;
    setStatus('Siap dianalisis.', 'info');
  }

  // ---- docx -> {paragraphs, tableCount, imageCount} ----
  function extractDocStructure(file) {
    return file.arrayBuffer().then(function (buf) { return JSZip.loadAsync(buf); }).then(function (zip) {
      var docPromise = zip.file('word/document.xml').async('string');
      var mediaFiles = Object.keys(zip.files).filter(function (path) {
        return /^word\/media\//.test(path) && /\.(png|jpe?g|gif|bmp|emf|wmf|tiff?)$/i.test(path);
      });
      return docPromise.then(function (xmlString) {
        var xmlDoc = new DOMParser().parseFromString(xmlString, 'application/xml');
        var paragraphs = xmlDoc.getElementsByTagName('w:p');
        var lines = [];
        for (var p = 0; p < paragraphs.length; p++) {
          var tNodes = paragraphs[p].getElementsByTagName('w:t');
          var text = '';
          for (var t = 0; t < tNodes.length; t++) text += tNodes[t].textContent;
          lines.push(text);
        }
        var tableCount = xmlDoc.getElementsByTagName('w:tbl').length;
        return { paragraphs: lines, tableCount: tableCount, imageCount: mediaFiles.length };
      });
    });
  }

  els.processBtn.addEventListener('click', function () {
    if (!state.file) return;
    els.processBtn.disabled = true;
    setStatus('Membaca & menganalisis naskah...', 'info');
    var includeRefs = els.includeReferences.checked;
    extractDocStructure(state.file).then(function (doc) {
      var result = DS.analyzeDocument(doc);
      result.referencesIncluded = includeRefs;
      state.result = result;
      renderDashboard(result);
      renderChecklist(result);
      els.results.style.display = 'block';
      setStatus('✅ Analisis selesai.', 'ok');
      els.processBtn.disabled = false;
      els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) {
      console.error(err);
      setStatus('⚠️ Gagal membaca file: ' + err.message, 'err');
      els.processBtn.disabled = false;
    });
  });

  // ---- Dashboard rendering ----
  function renderDashboard(r) {
    var html = '';
    html += '<div class="db-grid">';
    html += statCard(r.titleWords, 'Kata dalam Judul');
    html += statCard(r.abstractWords, 'Kata dalam Abstrak', r.abstractFound ? null : 'bad');
    html += statCard(r.keywordCount, 'Kata Kunci', r.keywordsFound ? null : 'warn');
    html += statCard(r.totalWords.toLocaleString('id-ID'), 'Total Kata Naskah');
    html += statCard(r.totalSentences.toLocaleString('id-ID'), 'Total Kalimat');
    if (r.referencesIncluded) html += statCard(r.referenceCount, 'Total Referensi', r.referenceCount < 20 ? 'warn' : null);
    html += statCard(r.tableCount, 'Tabel');
    html += statCard(r.imageCount, 'Gambar');
    html += '</div>';

    html += '<div class="db-section"><div class="db-section-title">Judul Terdeteksi</div><div class="db-text-block">' + (r.title ? esc(r.title) : '<i>Tidak terdeteksi</i>') + '</div></div>';

    if (r.abstractFound) {
      html += '<div class="db-section"><div class="db-section-title">Abstrak Terdeteksi (cuplikan)</div><div class="db-text-block">' + esc(r.abstractPreview || '-') + '</div></div>';
      html += '<div class="db-section"><div class="db-section-title">Kata Kunci Terdeteksi</div><div class="db-text-block">' + (r.keywordList.length ? r.keywordList.map(esc).join(', ') : '<i>Tidak terdeteksi</i>') + '</div></div>';
    }

    html += '<div class="db-section"><div class="db-section-title">Struktur IMRAD (jumlah kata per bagian)</div>';
    if (r.imradSections.length === 0) {
      html += '<div class="db-text-block">Tidak ada bagian IMRAD yang terdeteksi.</div>';
    } else {
      var maxWords = Math.max.apply(null, r.imradSections.map(function (s) { return s.words; }));
      r.imradSections.forEach(function (s) {
        var pct = maxWords ? Math.round((s.words / maxWords) * 100) : 0;
        html += '<div class="db-imrad-row"><span class="db-imrad-label">' + esc(s.label) + '</span><div class="db-imrad-track"><div class="db-imrad-fill" style="width:' + pct + '%"></div></div><span class="db-imrad-count">' + s.words + ' kata</span></div>';
      });
      html += '<div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">';
      r.imradSections.forEach(function (s) {
        html += '<div style="font-size:11px;color:var(--text-faint);"><b style="color:var(--text-dim);">' + esc(s.label) + ':</b> "' + esc(s.preview || '-') + '"</div>';
      });
      html += '</div>';
    }
    if (r.missingImrad.length > 0) {
      html += '<div class="db-text-block" style="margin-top:10px;border-left:3px solid var(--red);">⚠️ Bagian tidak terdeteksi: ' + r.missingImrad.map(esc).join(', ') + '</div>';
    }
    html += '</div>';

    if (r.referencesIncluded) {
      html += '<div class="db-section"><div class="db-section-title">Kebaruan Referensi</div><div class="db-text-block">';
      if (r.referenceRecency.totalWithYear > 0) {
        html += r.referenceRecency.recentPct + '% referensi (' + r.referenceRecency.recentCount + ' dari ' + r.referenceRecency.totalWithYear + ') terbit dalam ' + r.referenceRecency.thresholdYears + ' tahun terakhir.';
        if (r.referenceRecency.totalWithoutYear > 0) html += ' (' + r.referenceRecency.totalWithoutYear + ' referensi tidak terbaca tahunnya.)';
      } else {
        html += '<i>Tahun referensi tidak terbaca.</i>';
      }
      html += '</div></div>';
    }

    els.dashboardBody.innerHTML = html;

    var refExportCheckbox = document.querySelector('#exportOptions input[value="references"]');
    if (refExportCheckbox) {
      refExportCheckbox.disabled = !r.referencesIncluded;
      refExportCheckbox.checked = r.referencesIncluded;
      refExportCheckbox.closest('label').style.opacity = r.referencesIncluded ? '1' : '.5';
    }
  }

  function statCard(value, label, tone) {
    return '<div class="db-stat' + (tone ? ' ' + tone : '') + '"><div class="v">' + value + '</div><div class="l">' + esc(label) + '</div></div>';
  }

  // ---- Checklist (informational thresholds, explicitly framed as common convention) ----
  function buildChecklist(r) {
    var items = [];

    items.push(r.title
      ? { status: r.titleWords <= 20 ? 'ok' : 'warn', title: 'Judul: ' + r.titleWords + ' kata', desc: r.titleWords <= 20 ? 'Panjang wajar.' : 'Cukup panjang — banyak jurnal menyarankan judul ringkas (umumnya ≤ 15–20 kata).' }
      : { status: 'bad', title: 'Judul tidak terdeteksi', desc: 'Periksa manual — mungkin format naskah tidak lazim.' });

    if (!r.abstractFound) {
      items.push({ status: 'bad', title: 'Abstrak tidak terdeteksi', desc: 'Pastikan ada heading "Abstract"/"Abstrak" yang jelas.' });
    } else {
      var inRange = r.abstractWords >= 150 && r.abstractWords <= 250;
      items.push({ status: inRange ? 'ok' : 'warn', title: 'Abstrak: ' + r.abstractWords + ' kata', desc: inRange ? 'Dalam rentang umum (150–250 kata).' : 'Di luar rentang umum 150–250 kata — banyak jurnal Scopus mensyaratkan rentang ini, tapi selalu cek panduan penulis jurnal tujuan.' });
    }

    if (!r.keywordsFound) {
      items.push({ status: 'warn', title: 'Kata kunci tidak terdeteksi', desc: 'Pastikan ada baris "Keywords:"/"Kata Kunci:" yang jelas.' });
    } else {
      var kwOk = r.keywordCount >= 3 && r.keywordCount <= 6;
      items.push({ status: kwOk ? 'ok' : 'warn', title: 'Kata kunci: ' + r.keywordCount, desc: kwOk ? 'Jumlah wajar (3–6 kata kunci).' : 'Di luar rentang umum 3–6 kata kunci.' });
    }

    if (r.missingImrad.length === 0) {
      items.push({ status: 'ok', title: 'Struktur IMRAD lengkap', desc: 'Pendahuluan, Metode, Hasil, Pembahasan, dan Kesimpulan semua terdeteksi.' });
    } else {
      items.push({ status: 'bad', title: 'Struktur IMRAD tidak lengkap', desc: 'Bagian tidak terdeteksi: ' + r.missingImrad.join(', ') + '. Periksa apakah heading-nya memang tidak ada, atau cuma tidak terbaca sistem.' });
    }

    items.push({ status: r.referencesIncluded ? (r.referenceCount >= 20 ? 'ok' : 'warn') : 'info',
      title: r.referencesIncluded ? ('Jumlah referensi: ' + r.referenceCount) : 'Analisis referensi tidak disertakan',
      desc: r.referencesIncluded ? (r.referenceCount >= 20 ? 'Memenuhi ambang umum (≥20).' : 'Di bawah ambang umum yang sering disyaratkan jurnal terindeks Scopus (≥20 referensi) — cek ketentuan jurnal tujuan.') : 'Anda memilih untuk tidak menyertakan analisis referensi.' });

    if (r.referencesIncluded && r.referenceRecency.totalWithYear > 0) {
      var recencyOk = r.referenceRecency.recentPct >= 50;
      items.push({ status: recencyOk ? 'ok' : 'warn', title: 'Kebaruan referensi: ' + r.referenceRecency.recentPct + '% dari 10 tahun terakhir', desc: recencyOk ? 'Mayoritas referensi relatif baru.' : 'Kurang dari separuh referensi berasal dari 10 tahun terakhir — banyak jurnal meminta referensi yang lebih mutakhir.' });
    }

    items.push({ status: r.hasAuthorEmail ? 'ok' : 'warn', title: r.hasAuthorEmail ? 'Email korespondensi terdeteksi' : 'Email korespondensi tidak terdeteksi', desc: 'Cek manual apakah info kontak penulis sudah lengkap.' });
    items.push({ status: r.hasAffiliation ? 'ok' : 'warn', title: r.hasAffiliation ? 'Afiliasi penulis terdeteksi' : 'Afiliasi penulis tidak terdeteksi', desc: 'Cek manual apakah afiliasi institusi sudah dicantumkan.' });

    items.push({ status: 'info', title: 'Tabel: ' + r.tableCount + ' · Gambar: ' + r.imageCount, desc: 'Informasi jumlah aset visual — bandingkan dengan batas jurnal tujuan jika ada.' });

    return items;
  }

  var STATUS_ICON = { ok: '✅', warn: '⚠️', bad: '❌', info: 'ℹ️' };

  function renderChecklist(r) {
    var items = buildChecklist(r);
    var html = '<div class="checklist">';
    items.forEach(function (it) {
      html += '<div class="cl-item ' + it.status + '"><span class="cl-icon">' + STATUS_ICON[it.status] + '</span><div class="cl-body"><div class="cl-title">' + esc(it.title) + '</div><div class="cl-desc">' + esc(it.desc) + '</div></div></div>';
    });
    html += '</div>';
    html += '<div class="disclaimer">📌 Checklist ini memakai acuan umum yang sering dipakai jurnal terindeks Scopus — bukan aturan mutlak semua jurnal, dan bukan jaminan naskah akan diterima. Selalu cek panduan penulis (author guidelines) jurnal tujuan Anda.</div>';
    els.checklistBody.innerHTML = html;
  }

  // ---- Export (print-to-PDF, selectable sections) ----
  els.exportBtn.addEventListener('click', function () {
    if (!state.result) return;
    var selected = Array.prototype.slice.call(document.querySelectorAll('#exportOptions input:checked')).map(function (c) { return c.value; });
    if (selected.length === 0) { els.exportStatus.textContent = 'Pilih minimal satu bagian.'; els.exportStatus.className = 'status err'; return; }
    els.reportPage.innerHTML = buildReportHtml(state.result, selected);
    window.print();
  });

  function buildReportHtml(r, sections) {
    var html = '<h1>Laporan Preliminary Check</h1>';
    html += '<div class="rp-meta">Dihasilkan ' + new Date().toLocaleString('id-ID') + ' — Journal Tools</div>';

    if (sections.indexOf('identity') !== -1) {
      html += '<h2>Judul & Info Dasar</h2><table>';
      html += row('Judul', (r.title || '-') + ' (' + r.titleWords + ' kata)');
      html += row('Total Kata Naskah', r.totalWords.toLocaleString('id-ID'));
      html += row('Total Kalimat', r.totalSentences.toLocaleString('id-ID'));
      html += row('Total Paragraf', r.paragraphCount.toLocaleString('id-ID'));
      html += row('Email Korespondensi Terdeteksi', r.hasAuthorEmail ? 'Ya' : 'Tidak');
      html += row('Afiliasi Terdeteksi', r.hasAffiliation ? 'Ya' : 'Tidak');
      html += '</table>';
    }

    if (sections.indexOf('abstract') !== -1) {
      html += '<h2>Abstrak & Kata Kunci</h2><table>';
      html += row('Abstrak Ditemukan', r.abstractFound ? 'Ya' : 'Tidak');
      html += row('Jumlah Kata Abstrak', r.abstractWords);
      html += row('Jumlah Kata Kunci', r.keywordCount);
      html += row('Daftar Kata Kunci', r.keywordList.join(', ') || '-');
      html += '</table>';
    }

    if (sections.indexOf('imrad') !== -1) {
      html += '<h2>Struktur IMRAD</h2><table>';
      r.imradSections.forEach(function (s) { html += row(s.label, s.words + ' kata, ' + s.sentences + ' kalimat'); });
      if (r.missingImrad.length) html += row('Bagian Tidak Terdeteksi', r.missingImrad.join(', '));
      html += '</table>';
    }

    if (sections.indexOf('references') !== -1 && r.referencesIncluded) {
      html += '<h2>Statistik Referensi</h2><table>';
      html += row('Total Referensi', r.referenceCount);
      html += row('Referensi dari ' + r.referenceRecency.thresholdYears + ' Tahun Terakhir', r.referenceRecency.recentPct + '% (' + r.referenceRecency.recentCount + '/' + r.referenceRecency.totalWithYear + ')');
      html += '</table>';
    }

    if (sections.indexOf('assets') !== -1) {
      html += '<h2>Tabel & Gambar</h2><table>';
      html += row('Jumlah Tabel', r.tableCount);
      html += row('Jumlah Gambar', r.imageCount);
      html += '</table>';
    }

    if (sections.indexOf('checklist') !== -1) {
      html += '<h2>Checklist Preliminary</h2>';
      buildChecklist(r).forEach(function (it) {
        html += '<div class="rp-cl"><b>' + STATUS_ICON[it.status] + '</b>' + esc(it.title) + ' — ' + esc(it.desc) + '</div>';
      });
    }

    return html;
  }

  function row(label, value) { return '<tr><td>' + esc(label) + '</td><td>' + esc(value) + '</td></tr>'; }
})();
