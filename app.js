(function() {
  var CE = window.CitationEngine;
  var STYLES = CE.STYLES;

  var els = {
    styleSelect: document.getElementById('styleSelect'),
    confBadge: document.getElementById('confBadge'),
    confText: document.getElementById('confText'),
    reportPreview: document.getElementById('reportPreview'),
    downloadBtn: document.getElementById('downloadBtn'),
    downloadStatus: document.getElementById('downloadStatus'),
    confFill: document.getElementById('confFill'),
    exampleToggle: document.getElementById('exampleToggle'),
    exampleBox: document.getElementById('exampleBox'),
    fullDocText: document.getElementById('fullDocText'),
    btnAutoSplit: document.getElementById('btnAutoSplit'),
    splitStatus: document.getElementById('splitStatus'),
    articleText: document.getElementById('articleText'),
    referenceText: document.getElementById('referenceText'),
    validateBtn: document.getElementById('validateBtn'),
    topStatus: document.getElementById('topStatus'),
    loading: document.getElementById('loading'),
    doiProgress: document.getElementById('doiProgress'),
    doiLabel: document.getElementById('doiLabel'),
    doiFill: document.getElementById('doiFill'),
    results: document.getElementById('results'),
    parseStatusBanner: document.getElementById('parseStatusBanner'),
    sortByPosition: document.getElementById('sortByPosition'),
    summaryGrid: document.getElementById('summaryGrid'),
    yearRangePanel: document.getElementById('yearRangePanel'),
    yearRangeBody: document.getElementById('yearRangeBody'),
    yrFrom: document.getElementById('yrFrom'),
    yrTo: document.getElementById('yrTo'),
    yrApplyCustom: document.getElementById('yrApplyCustom'),
    citationMapPanel: document.getElementById('citationMapPanel'),
    detectedContent: document.getElementById('detectedContent'),
    toast: document.getElementById('toast'),
    btnCopyReport: document.getElementById('btnCopyReport'),
    btnCopyFixes: document.getElementById('btnCopyFixes'),
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

  var jrOverrides = {}; // { referenceIndex: 'local'|'international' } — resets per new validation run

  var lastResult = null;
  var lastValidator = null;
  var lastDoiIssues = [];
  var lastStyleId = 'apa7';
  var lastConfidence = null;
  var currentYearRange = null; // { from: number, to: number, label: string }

  els.exampleToggle.addEventListener('click', function() {
    els.exampleBox.classList.toggle('show');
  });

  function setInputMode(mode) {
    document.querySelectorAll('.input-mode-tab').forEach(function(btn) {
      var active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    document.getElementById('pane-paste').classList.toggle('active', mode === 'paste');
    document.getElementById('pane-manual').classList.toggle('active', mode === 'manual');
  }
  document.querySelectorAll('.input-mode-tab').forEach(function(btn) {
    btn.addEventListener('click', function() { setInputMode(btn.dataset.mode); });
  });
  initTabKeyboardNav('.input-mode-tab');

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
    els.splitStatus.textContent = '✅ Terpisah pada heading "' + split.headingText + '" — dipindah ke tab "Isi Manual", silakan periksa hasilnya sebelum validasi.';
    els.splitStatus.style.color = 'var(--green)';
    setInputMode('manual');
    if (els.articleText.scrollIntoView) els.articleText.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  function showToast(msg) {
    els.toast.textContent = '✅ ' + msg;
    els.toast.classList.add('show');
    setTimeout(function() { els.toast.classList.remove('show'); }, 2000);
  }

  function doCopy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function() { return fallbackCopy(text); });
    }
    return fallbackCopy(text);
  }
  function fallbackCopy(text) {
    return new Promise(function(resolve) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); resolve();
    });
  }

  els.validateBtn.addEventListener('click', function() {
    var articleText = els.articleText.value.trim();
    var referenceText = els.referenceText.value.trim();
    if (!articleText) { alert('Silakan masukkan teks artikel.'); return; }

    els.loading.classList.add('active');
    els.results.classList.remove('active');
    els.doiProgress.classList.remove('active');
    els.confBadge.classList.remove('show');

    setTimeout(function() {
      var selected = els.styleSelect.value;
      var styleId, confidence = null;

      if (selected === 'auto') {
        var detection = CE.FormatDetector.detect(articleText, referenceText);
        styleId = detection.styleId;
        confidence = detection.confidence;
        els.confText.textContent = STYLES[styleId].name + ' (' + confidence + '%)';
        els.confFill.style.width = confidence + '%';
        els.confBadge.classList.add('show');
      } else {
        styleId = selected;
      }
      lastStyleId = styleId;
      lastConfidence = confidence;

      var validator = new CE.MultiFormatValidator(articleText, referenceText, styleId);
      var result = validator.validate();

      lastResult = result;
      lastValidator = validator;
      lastDoiIssues = [];
      jrOverrides = {};

      els.loading.classList.remove('active');
      els.results.classList.add('active');
      renderAll(result, []);
      renderReportPreview();

      // DOI checking (async, progressive)
      var refsWithDoi = result.references.filter(function(r) { return r.doi; });
      var refsNoJournalDoi = result.references; // we still want to note missing DOIs for journal-like sources
      if (result.references.length > 0) {
        els.doiProgress.classList.add('active');
        runDoiChecks(result.references, styleId).then(function(doiIssues) {
          lastDoiIssues = doiIssues;
          els.doiProgress.classList.remove('active');
          renderAll(result, doiIssues);
          renderReportPreview();
        });
      }
    }, 250);
  });

  function runDoiChecks(references, styleId) {
    var doiIssues = [];
    var total = references.length;
    var done = 0;
    var chain = Promise.resolve();
    references.forEach(function(ref) {
      chain = chain.then(function() {
        done++;
        var pct = Math.round((done / total) * 100);
        els.doiFill.style.width = pct + '%';
        els.doiLabel.textContent = 'Memvalidasi DOI... (' + done + '/' + total + ')';
        if (!ref.doi) {
          if (CE.DOI_NOT_EXPECTED_TYPES[ref.sourceType]) return; // book/thesis/report/website — DOI normally absent, not a problem
          doiIssues.push({ ref: ref, status: 'no_doi', severity: 'info', title: 'Tanpa DOI', description: '"' + (ref.firstAuthor || '-') + (ref.year ? ' (' + ref.year + ')' : '') + '" tidak memiliki DOI yang terdeteksi.', code: ref.raw.substring(0, 150) });
          return;
        }
        return CE.DOIChecker.validateViaCrossRef(ref.doi).then(function(res) {
          if (res.status === 'network_error' || res.status === 'error') {
            doiIssues.push({ ref: ref, doi: ref.doi, status: 'unverified', severity: 'warning', title: 'DOI tidak dapat diverifikasi', description: 'DOI "' + ref.doi + '" tidak dapat diverifikasi (' + (res.message || 'masalah jaringan') + ').', code: ref.doi });
          } else if (!res.exists) {
            doiIssues.push({ ref: ref, doi: ref.doi, status: 'fake', severity: 'error', title: 'DOI tidak ditemukan', description: 'DOI "' + ref.doi + '" tidak ditemukan di CrossRef. Mungkin salah ketik atau fiktif.', code: ref.doi, correction: 'https://doi.org/' + ref.doi });
          } else {
            var cmp = CE.DOIChecker.compareMetadata(ref, res.data);
            var crTitle = (res.data.title && res.data.title[0]) || null;
            var crAuthors = (res.data.author || []).map(function(a) { return (a.family || '') + (a.given ? ', ' + a.given : ''); }).join('; ');
            var crYear = null;
            if (res.data.published && res.data.published['date-parts'] && res.data.published['date-parts'][0]) crYear = String(res.data.published['date-parts'][0][0]);
            if (cmp.mismatches.length > 0) {
              var noteTexts = cmp.mismatches.map(function(m){ return m.note; }).filter(Boolean);
              doiIssues.push({
                ref: ref, doi: ref.doi, status: 'mismatch', severity: 'warning', title: 'DOI valid, metadata tidak sesuai',
                description: 'DOI ada, tetapi ' + cmp.mismatches.map(function(m){return m.field + ' (referensi: ' + m.ref + ', CrossRef: ' + m.cr + ')';}).join('; ') + ' tidak cocok dengan data CrossRef.' + (noteTexts.length ? ' ' + noteTexts.join(' ') : ''), code: 'https://doi.org/' + ref.doi,
                metadata: { ref: { title: ref.title, authors: (ref.authors||[]).join(', '), year: ref.year }, crossref: { title: crTitle, authors: crAuthors, year: crYear }, mismatches: cmp.mismatches, matches: cmp.matches }
              });
            } else {
              doiIssues.push({
                ref: ref, doi: ref.doi, status: 'valid', severity: 'success', title: 'DOI valid & metadata sesuai',
                description: 'DOI "' + ref.doi + '" terverifikasi di CrossRef.', code: 'https://doi.org/' + ref.doi,
                metadata: { ref: { title: ref.title, authors: (ref.authors||[]).join(', '), year: ref.year }, crossref: { title: crTitle, authors: crAuthors, year: crYear }, mismatches: [], matches: cmp.matches }
              });
            }
          }
        });
      });
    });
    return chain.then(function() { return doiIssues; });
  }

  function renderAll(result, doiIssues) {
    renderParseStatus(result);
    renderSummary(result, doiIssues);
    renderYearRange(result);
    renderCitationMap(result);
    renderDetected(result);
    renderIssueList('list-errors', result.errors);
    renderIssueList('list-suggestions', result.suggestions);
    renderDoiList(doiIssues);
    renderAllTab(result.errors.concat(result.suggestions));
  }

  function renderParseStatus(result) {
    var stats = result.parseStats || { totalFound: result.references.length, succeededCount: result.references.length, failedCount: 0 };
    var failed = result.failedLines || [];
    var el = els.parseStatusBanner;
    if (stats.failedCount === 0) {
      el.innerHTML = '<div class="parse-banner ok"><div class="pb-title">✅ Semua baris referensi berhasil dianalisis</div><div class="pb-stats">Ditemukan: ' + stats.totalFound + ' · Berhasil dianalisis: ' + stats.succeededCount + ' · Gagal: 0</div></div>';
      return;
    }
    var html = '<div class="parse-banner fail">';
    html += '<div class="pb-title">⚠️ ' + stats.failedCount + ' baris referensi GAGAL dianalisis — hasil di bawah ini belum lengkap</div>';
    html += '<div class="pb-stats">Ditemukan: ' + stats.totalFound + ' · Berhasil dianalisis: ' + stats.succeededCount + ' · Gagal: ' + stats.failedCount + '</div>';
    html += '<div>Baris berikut tidak dikenali polanya (penulis/tahun tidak terbaca) dan <b>tidak ikut divalidasi sama sekali</b> — periksa &amp; perbaiki manual sebelum menganggap hasil ini lengkap:</div>';
    html += '<div class="pb-failed-list">';
    failed.forEach(function(f) {
      html += '<div class="pb-failed-item"><b>Baris ' + f.lineNumber + ':</b> ' + esc(f.text.slice(0, 160)) + (f.text.length > 160 ? '…' : '') + '<br><span style="color:var(--text-faint);">↳ ' + esc(f.reason) + '</span></div>';
    });
    html += '</div></div>';
    el.innerHTML = html;
  }

  function renderSummary(result, doiIssues) {
    var doiValid = doiIssues.filter(function(d){return d.status==='valid';}).length;
    var doiTotal = doiIssues.filter(function(d){return d.status!=='no_doi';}).length;
    var totalCitations = countCitations(result.citations);
    var style = STYLES[result.styleId];
    els.summaryGrid.innerHTML =
      '<div class="sum-card fmt"><div class="n">' + esc(style.name) + '</div><div class="l">Gaya' + (lastConfidence!=null ? ' ('+lastConfidence+'%)' : '') + '</div></div>' +
      '<div class="sum-card err"><div class="n">' + result.errors.length + '</div><div class="l">Perlu Diperbaiki</div></div>' +
      '<div class="sum-card sugg"><div class="n">' + result.suggestions.length + '</div><div class="l">Saran</div></div>' +
      '<div class="sum-card ok"><div class="n">' + totalCitations + '</div><div class="l">Sitasi</div></div>' +
      '<div class="sum-card ok"><div class="n">' + result.references.length + '</div><div class="l">Referensi</div></div>' +
      '<div class="sum-card sugg"><div class="n">' + doiValid + '/' + doiTotal + '</div><div class="l">DOI Valid</div></div>';
  }

  var lastAllIssues = [];
  var activeFilter = 'all';

  function getIssueCategories(issue) {
    var t = (issue.title || '').toLowerCase();
    var cats = [];
    if (/duplikat/.test(t)) cats.push('duplikat');
    if (/tahun/.test(t)) cats.push('tahun');
    if (/format italic|huruf besar/.test(t)) cats.push('format');
    if (/alfabetis|gaya sitasi tidak konsisten/.test(t)) cats.push('gaya');
    if (/^referensi|nomor referensi|penomoran referensi/.test(t)) cats.push('referensi');
    if (/sitasi|et al|pemisah/.test(t)) cats.push('sitasi');
    if (cats.length === 0) cats.push('lainnya');
    return cats;
  }

  function renderAllTab(issues) {
    lastAllIssues = issues;
    applyFilterAndRender();
  }

  function applyFilterAndRender() {
    var filtered = activeFilter === 'all' ? lastAllIssues.slice() : lastAllIssues.filter(function(i) { return getIssueCategories(i).indexOf(activeFilter) !== -1; });
    if (els.sortByPosition && els.sortByPosition.checked) {
      filtered = filtered.slice().sort(function(a, b) {
        var la = a.location ? a.location.line : Infinity;
        var lb = b.location ? b.location.line : Infinity;
        var sa = a.location ? (a.location.source === 'article' ? 0 : 1) : 2;
        var sb = b.location ? (b.location.source === 'article' ? 0 : 1) : 2;
        if (sa !== sb) return sa - sb;
        return la - lb;
      });
    }
    renderIssueList('list-all', filtered);
  }

  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.querySelectorAll('.filter-chip').forEach(function(c) { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
      chip.classList.add('active');
      chip.setAttribute('aria-pressed', 'true');
      activeFilter = chip.getAttribute('data-filter');
      applyFilterAndRender();
    });
  });
  if (els.sortByPosition) els.sortByPosition.addEventListener('change', applyFilterAndRender);

  function countCitations(citations) {
    var n = 0;
    citations.forEach(function(c) {
      if (c.numbers) n += c.numbers.length;
      else if (c.parts) n += c.parts.length;
      else n += 1;
    });
    return n;
  }

  // ---------- Year-range recency analysis ----------
  function computeYearRange(references, from, to) {
    return CE.YearRange.compute(references, from, to);
  }

  // ---------- PDF report export (selectable sections) ----------
  function row(k, v) {
    return '<tr><td class="k">' + esc(String(k)) + '</td><td class="v">' + esc(String(v)) + '</td></tr>';
  }

  function issueSectionHtml(title, issues, sevClass, codeHl) {
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

  function getSelectedReportSections() {
    var boxes = document.querySelectorAll('#reportSections input:checked');
    return Array.prototype.slice.call(boxes).map(function(b) { return b.value; });
  }

  function renderReportPreview() {
    if (!els.reportPreview || !lastResult) return;
    var result = lastResult, doiIssues = lastDoiIssues || [];
    var sections = getSelectedReportSections();
    var style = STYLES[result.styleId];
    var yr = currentYearRange || CE.YearRange.presetToRange(5);
    var stats = computeYearRange(result.references, yr.from, yr.to);
    var html = '';

    html += '<h1>Laporan Validasi Sitasi</h1>';
    html += '<div class="rp-meta">Gaya sitasi: <b>' + esc(style.name) + '</b>' + (lastConfidence != null ? ' (auto-detect, keyakinan ' + lastConfidence + '%)' : '') + '</div>';
    html += '<div class="rp-meta">Dibuat: ' + esc(new Date().toLocaleString('id-ID')) + '</div>';

    if (sections.indexOf('summary') !== -1) {
      html += '<h2>Ringkasan</h2><table>';
      html += row('Total sitasi terdeteksi', countCitations(result.citations));
      html += row('Total referensi terdeteksi', result.references.length);
      html += row('Perlu Diperbaiki / Saran', result.errors.length + ' / ' + result.suggestions.length);
      html += row('Rentang tahun diperiksa', yr.label);
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
      html += '<div class="rp-legend">🟩 Dalam rentang &nbsp; 🟥 Di luar rentang (' + esc(yr.label) + ') &nbsp; ⬜ Tahun tidak diketahui</div>';
      if (result.references.length === 0) {
        html += '<p class="rp-empty">Tidak ada referensi terdeteksi.</p>';
      } else {
        html += '<ul>';
        result.references.forEach(function(r) {
          var y = CE.YearRange.getRefYear(r);
          var outOfRange = y != null && (y < yr.from || y > yr.to);
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

    if (sections.indexOf('errors') !== -1) html += issueSectionHtml('Perlu Diperbaiki', result.errors, 'error', 'hl-red');
    if (sections.indexOf('suggestions') !== -1) html += issueSectionHtml('Saran', result.suggestions, 'suggestion', 'hl-cyan');

    if (sections.indexOf('doi') !== -1 && doiIssues.length > 0) {
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

  document.querySelectorAll('#reportSections input').forEach(function(box) {
    box.addEventListener('change', renderReportPreview);
  });

  if (els.downloadBtn) {
    els.downloadBtn.addEventListener('click', function() {
      if (!lastResult) return;
      var style = STYLES[lastStyleId];
      var dateStr = new Date().toISOString().slice(0, 10);
      var suggestedName = 'Laporan-Validasi-Sitasi-' + style.name.replace(/[^\w]+/g, '-') + '-' + dateStr;
      var originalTitle = document.title;
      document.title = suggestedName;
      els.downloadStatus.textContent = 'Membuka dialog cetak... pilih tujuan "Simpan sebagai PDF".';
      els.downloadStatus.className = 'status info';
      window.print();
      setTimeout(function() { document.title = originalTitle; }, 1000);
    });
  }

  function setActivePreset(years) {
    document.querySelectorAll('.yr-preset').forEach(function(btn) {
      btn.classList.toggle('active', years != null && parseInt(btn.dataset.years, 10) === years);
    });
  }

  function applyYearPreset(years) {
    currentYearRange = CE.YearRange.presetToRange(years);
    els.yrFrom.value = ''; els.yrTo.value = '';
    setActivePreset(years);
    if (lastResult) { renderYearRange(lastResult); renderReportPreview(); }
  }

  document.querySelectorAll('.yr-preset').forEach(function(btn) {
    btn.addEventListener('click', function() {
      applyYearPreset(parseInt(btn.dataset.years, 10));
    });
  });

  els.yrApplyCustom.addEventListener('click', function() {
    var from = parseInt(els.yrFrom.value, 10);
    var to = parseInt(els.yrTo.value, 10);
    if (!from || !to) { showToast('Isi kedua tahun (dari & sampai)'); return; }
    if (from > to) { var t = from; from = to; to = t; }
    currentYearRange = { from: from, to: to, label: 'Custom (' + from + '–' + to + ')' };
    setActivePreset(null);
    if (lastResult) { renderYearRange(lastResult); renderReportPreview(); }
  });

  function renderYearRange(result) {
    if (!result.references || result.references.length === 0) {
      els.yearRangePanel.style.display = 'none';
      return;
    }
    els.yearRangePanel.style.display = '';
    if (!currentYearRange) {
      applyYearPreset(5); // default: 5 tahun terakhir (this call re-invokes renderYearRange)
      return;
    }
    var stats = computeYearRange(result.references, currentYearRange.from, currentYearRange.to);
    var pctClass = stats.pctOfKnown >= 70 ? '' : stats.pctOfKnown >= 40 ? 'mid' : 'low';
    var inW = stats.total ? (stats.inRange.length / stats.total * 100) : 0;
    var outW = stats.total ? (stats.outRange.length / stats.total * 100) : 0;
    var unkW = stats.total ? (stats.unknown.length / stats.total * 100) : 0;

    var html = '';
    html += '<div class="yr-summary">' +
      '<span class="yr-pct ' + pctClass + '">' + stats.pctOfKnown + '%</span>' +
      '<span class="yr-range-label">referensi (dengan tahun diketahui) berada dalam rentang <b style="color:var(--text);">' + currentYearRange.label + '</b> — ' +
      stats.inRange.length + ' dari ' + (stats.inRange.length + stats.outRange.length) + ' referensi bertahun jelas' +
      (stats.unknown.length ? ' (' + stats.unknown.length + ' tanpa tahun terdeteksi)' : '') + '</span>' +
      '</div>';
    html += '<div class="yr-bar">' +
      '<div class="yr-seg in" style="width:' + inW + '%"></div>' +
      '<div class="yr-seg out" style="width:' + outW + '%"></div>' +
      '<div class="yr-seg unk" style="width:' + unkW + '%"></div>' +
      '</div>';
    html += '<div class="yr-legend">' +
      '<span><span class="d in"></span>Dalam rentang (' + stats.inRange.length + ')</span>' +
      '<span><span class="d out"></span>Di luar rentang (' + stats.outRange.length + ')</span>' +
      '<span><span class="d unk"></span>Tahun tidak diketahui (' + stats.unknown.length + ')</span>' +
      '</div>';

    html += '<div class="yr-list-wrap">';
    html += '<div><h4>⛔ Di Luar Rentang (' + stats.outRange.length + ')</h4>';
    if (stats.outRange.length === 0) {
      html += '<p style="color:var(--text-dim);font-size:11.5px;">Tidak ada — semua referensi bertahun berada dalam rentang.</p>';
    } else {
      stats.outRange.forEach(function(item) {
        html += '<div class="yr-ref-item out"><span>' + esc(item.ref.firstAuthor || '-') + '</span><span class="yr-tag">' + esc(String(item.y)) + '</span></div>';
      });
    }
    html += '</div>';
    html += '<div><h4>❔ Tahun Tidak Diketahui (' + stats.unknown.length + ')</h4>';
    if (stats.unknown.length === 0) {
      html += '<p style="color:var(--text-dim);font-size:11.5px;">Tidak ada.</p>';
    } else {
      stats.unknown.forEach(function(r) {
        html += '<div class="yr-ref-item unk"><span>' + esc(r.firstAuthor || '-') + '</span><span class="yr-tag">' + esc(r.year || 'n/a') + '</span></div>';
      });
    }
    html += '</div></div>';

    els.yearRangeBody.innerHTML = html;
  }

  function esc(t) { return CE.esc(t); }

  function mapLinkKey(author, year) {
    // Reference firstAuthor is often "Surname, Initial" while a citation's parsed firstAuthor
    // is just "Surname" — strip anything after a comma so both sides normalize to the same key.
    var surnameOnly = String(author || '').split(',')[0];
    return surnameOnly.toLowerCase().replace(/[^a-z0-9]+/g, '') + '|' + String(year || '');
  }

  function renderCitationMap(result) {
    var style = STYLES[result.styleId];
    var panel = els.citationMapPanel;
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

    // author-date / author-page: use the validator's real match index (not a placeholder)
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

  function splitFirstToken(authorsStr) {
    if (!authorsStr) return authorsStr;
    var cleaned = authorsStr.replace(/\s*et\s+al\.?/i, '');
    var arr = CE.splitOnSeparators(cleaned);
    return arr[0] || cleaned;
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
    if (!lastResult) return;
    var JR = window.JournalRulesEngine;
    var rules = readJournalRulesConfig();
    var evalResult = JR.evaluateRules(lastResult.references, rules, jrOverrides);
    var classified = JR.classifyReferencesOrigin(lastResult.references, jrOverrides);

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
        jrOverrides[idx] = sel.value;
        renderJournalRules(); // re-evaluate live so the origin-percentage check updates immediately
      });
    });
  }

  els.jrApplyBtn.addEventListener('click', renderJournalRules);

  function renderDetected(result) {
    var html = '<h4 style="color:var(--text);margin:0 0 10px;font-size:12.5px;">📝 In-Text Citations:</h4>';
    if (result.citations.length === 0) {
      html += '<p style="color:var(--text-dim);font-size:11.5px;margin-bottom:16px;">Tidak ada sitasi terdeteksi</p>';
    } else {
      result.citations.forEach(function(c) {
        if (c.parts) {
          c.parts.forEach(function(p) {
            html += '<div class="det-item">' + esc(p.raw) + '<div class="sub">Penulis pertama: ' + esc(p.firstAuthor||'-') + (p.authorCount?' | '+p.authorCount+' penulis':'') + (p.hasEtAl?' (et al.)':'') + '</div></div>';
          });
        } else {
          html += '<div class="det-item">' + esc(c.raw) + '<div class="sub">Naratif</div></div>';
        }
      });
    }
    html += '<h4 style="color:var(--text);margin:18px 0 10px;font-size:12.5px;">📚 Referensi:</h4>';
    if (result.references.length === 0) {
      html += '<p style="color:var(--text-dim);font-size:11.5px;">Tidak ada referensi terdeteksi</p>';
    } else {
      result.references.forEach(function(r) {
        var tag = r.isInstitutional ? '<span class="type-tag inst">INSTITUSI</span>' : '';
        html += '<div class="det-item">' + (r.numLabel!=null ? '['+r.numLabel+'] ' : '') + esc(r.firstAuthor||'-') + (r.year?' ('+r.year+')':'') + tag +
          '<div class="sub">Judul: ' + esc(r.title||'-') + (r.doi ? ' | DOI: '+esc('https://doi.org/'+r.doi) : '') + ' | ' + r.authorCount + ' penulis</div></div>';
      });
    }
    els.detectedContent.innerHTML = html;
  }

  function renderIssueList(elId, issues) {
    var el = document.getElementById(elId);
    if (issues.length === 0) {
      el.innerHTML = '<div class="no-issues">✅ Tidak ada masalah di kategori ini.</div>';
      return;
    }
    var html = '';
    issues.forEach(function(issue, idx) {
      var sc = issue.severity || 'error';
      var sl = sc === 'error' ? 'PERLU DIPERBAIKI' : sc === 'warning' ? 'WARNING' : 'SARAN';
      html += '<div class="issue-item ' + sc + '">';
      html += '<div class="issue-header"><span class="issue-sev">' + sl + '</span><span class="issue-title">' + esc(issue.title) + '</span>';
      if (issue.location) {
        html += '<button class="loc-badge" data-loc-source="' + issue.location.source + '" data-loc-line="' + issue.location.line + '" title="Klik untuk lompat ke baris ini">📍 Baris ' + issue.location.line + ' (' + (issue.location.source === 'reference' ? 'referensi' : 'artikel') + ')</button>';
      }
      html += '</div>';
      html += '<div class="issue-desc">' + esc(issue.description) + '</div>';
      if (issue.code) html += '<div class="code-block code-issue" data-copy="' + escAttr(issue.code) + '">' + esc(issue.code) + '<button class="copy-inline" aria-label="Salin ke clipboard">📋</button></div>';
      if (issue.correction) html += '<div class="code-block code-fix" data-copy="' + escAttr(issue.correction) + '">✓ ' + esc(issue.correction) + '<button class="copy-inline" aria-label="Salin ke clipboard">📋</button></div>';
      html += '</div>';
    });
    el.innerHTML = html;
    bindCopyBlocks(el);
    bindLocationBadges(el);
  }

  function scrollToLocation(source, line) {
    var manualBtn = document.querySelector('.input-mode-tab[data-mode="manual"]');
    if (manualBtn) manualBtn.click();
    var el = source === 'reference' ? els.referenceText : els.articleText;
    if (!el) return;
    var text = el.value;
    var lines = text.split('\n');
    var start = 0;
    for (var i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
    var lineText = lines[line - 1] || '';
    var end = start + lineText.length;
    el.focus();
    try { el.setSelectionRange(start, end); } catch (e) {}
    // approximate scroll position so the selected line lands near the middle of the box
    var lineHeight = 21; // matches the 12.5px/1.7 line-height textarea font used across the app
    el.scrollTop = Math.max(0, (line - 1) * lineHeight - el.clientHeight / 2);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Melompat ke baris ' + line);
  }

  function bindLocationBadges(container) {
    container.querySelectorAll('.loc-badge').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        scrollToLocation(btn.getAttribute('data-loc-source'), parseInt(btn.getAttribute('data-loc-line'), 10));
      });
    });
  }

  function renderDoiList(doiIssues) {
    var el = document.getElementById('list-doi');
    if (doiIssues.length === 0) {
      el.innerHTML = '<div class="no-issues">🔗 Belum ada data DOI (sedang diproses atau tidak ada referensi).</div>';
      return;
    }
    var html = '';
    doiIssues.forEach(function(issue, idx) {
      var sc = issue.severity;
      var sl = sc === 'error' ? 'FIKTIF' : sc === 'warning' ? (issue.status==='mismatch'?'MISMATCH':'UNVERIFIED') : sc === 'success' ? 'VALID' : 'INFO';
      var instTag = issue.ref && issue.ref.isInstitutional ? '<span class="type-tag inst">INSTITUSI</span>' : '';
      html += '<div class="issue-item ' + (sc==='success'?'suggestion':sc) + '">';
      html += '<div class="issue-header"><span class="issue-sev">' + sl + '</span>' + instTag + '<span class="issue-title">' + esc(issue.title) + '</span></div>';
      html += '<div class="issue-desc">' + esc(issue.description) + '</div>';
      if (issue.code) html += '<div class="code-block code-issue" data-copy="' + escAttr(issue.code) + '">' + esc(issue.code) + '<button class="copy-inline" aria-label="Salin ke clipboard">📋</button></div>';
      if (issue.correction) html += '<div class="code-block code-fix" data-copy="' + escAttr(issue.correction) + '">✓ ' + esc(issue.correction) + '<button class="copy-inline" aria-label="Salin ke clipboard">📋</button></div>';
      if (issue.metadata) {
        var m = issue.metadata;
        html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10.5px;color:var(--text-dim);margin-top:8px;line-height:1.8;">';
        html += 'Ref Anda — Judul: ' + esc(m.ref.title||'-') + ' | Penulis: ' + esc(m.ref.authors||'-') + ' | Tahun: ' + esc(m.ref.year||'-') + '<br>';
        html += 'CrossRef — Judul: ' + esc(m.crossref.title||'-') + ' | Penulis: ' + esc(m.crossref.authors||'-') + ' | Tahun: ' + esc(m.crossref.year||'-');
        html += '</div>';
      }
      if (issue.status === 'no_doi' && issue.ref) {
        html += '<button class="doi-search-btn" data-doi-search-idx="' + idx + '" style="margin-top:8px;">🔍 Cari DOI</button>';
        html += '<div class="doi-search-results" id="doiSearchResults' + idx + '"></div>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
    bindCopyBlocks(el);
    bindDoiSearchButtons(el, doiIssues);
  }

  function bindDoiSearchButtons(container, doiIssues) {
    container.querySelectorAll('.doi-search-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.getAttribute('data-doi-search-idx'), 10);
        var issue = doiIssues[idx];
        var resultsEl = document.getElementById('doiSearchResults' + idx);
        btn.disabled = true;
        btn.textContent = '⏳ Mencari...';
        CE.DOIChecker.searchByMetadata(issue.ref.title, issue.ref.firstAuthor, issue.ref.year).then(function(res) {
          btn.disabled = false;
          btn.textContent = '🔍 Cari DOI Lagi';
          if (res.status !== 'ok') {
            resultsEl.innerHTML = '<div class="doi-cand-empty">⚠️ Pencarian gagal (' + (res.message || res.status) + '). Coba lagi atau cari manual di search.crossref.org.</div>';
            return;
          }
          if (res.candidates.length === 0) {
            resultsEl.innerHTML = '<div class="doi-cand-empty">Tidak ditemukan kandidat DOI yang cocok.</div>';
            return;
          }
          var html = '<div class="doi-cand-hint">Kandidat dari CrossRef — periksa kecocokannya sendiri sebelum dipakai, tidak diisi otomatis:</div>';
          res.candidates.forEach(function(c) {
            var confClass = c.score >= 75 ? 'high' : c.score >= 40 ? 'mid' : 'low';
            html += '<div class="doi-cand ' + confClass + '">';
            html += '<div class="doi-cand-score">' + c.score + '% cocok</div>';
            html += '<div class="doi-cand-body">';
            html += '<div class="doi-cand-title">' + esc(c.title || '(tanpa judul)') + '</div>';
            html += '<div class="doi-cand-meta">' + esc(c.author || '-') + (c.year ? ' · ' + esc(c.year) : '') + '</div>';
            if (c.doi) {
              var doiUrl = 'https://doi.org/' + c.doi;
              html += '<div class="code-block code-fix" data-copy="' + escAttr(doiUrl) + '">' + esc(doiUrl) + '<button class="copy-inline" aria-label="Salin ke clipboard">📋</button></div>';
            }
            html += '</div></div>';
          });
          resultsEl.innerHTML = html;
          bindCopyBlocks(resultsEl);
        });
      });
    });
  }

  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

  function bindCopyBlocks(container) {
    container.querySelectorAll('.code-block').forEach(function(block) {
      block.addEventListener('click', function() {
        var text = block.getAttribute('data-copy').replace(/^✓\s*/, '');
        var textDecoded = document.createElement('textarea');
        textDecoded.innerHTML = text;
        doCopy(textDecoded.value).then(function() {
          showToast('Disalin!');
        });
      });
    });
  }

  // Tabs
  function initTabKeyboardNav(tabSelector) {
    document.querySelectorAll(tabSelector).forEach(function(tab) {
      tab.addEventListener('keydown', function(e) {
        var tabs = Array.prototype.slice.call(document.querySelectorAll(tabSelector));
        var idx = tabs.indexOf(document.activeElement);
        if (idx === -1) return;
        var newIdx = null;
        if (e.key === 'ArrowRight') newIdx = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') newIdx = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') newIdx = 0;
        else if (e.key === 'End') newIdx = tabs.length - 1;
        if (newIdx !== null) {
          e.preventDefault();
          tabs[newIdx].focus();
          tabs[newIdx].click();
        }
      });
    });
  }
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tab-btn').forEach(function(b) {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
        b.tabIndex = -1;
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      btn.tabIndex = 0;
      document.querySelectorAll('.tab-content').forEach(function(c){c.classList.remove('active');});
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
  initTabKeyboardNav('.tab-btn');

  // Report generation
  els.btnCopyReport.addEventListener('click', function() {
    if (!lastResult) return;
    var r = lastResult;
    var style = STYLES[r.styleId];
    var rpt = '========================================\n  LAPORAN VALIDASI SITASI — ' + style.name.toUpperCase() + '\n========================================\n\n';
    rpt += 'RINGKASAN:\n  Perlu Diperbaiki: ' + r.errors.length + '\n  Saran: ' + r.suggestions.length + '\n  Referensi: ' + r.references.length + '\n\n';
    if (currentYearRange && r.references.length) {
      var yrStats = computeYearRange(r.references, currentYearRange.from, currentYearRange.to);
      rpt += 'RENTANG TAHUN REFERENSI (' + currentYearRange.label + '):\n  Dalam rentang: ' + yrStats.inRange.length + '\n  Di luar rentang: ' + yrStats.outRange.length + '\n  Tahun tidak diketahui: ' + yrStats.unknown.length + '\n  Persentase dalam rentang (dari yang bertahun jelas): ' + yrStats.pctOfKnown + '%\n\n';
    }
    rpt += '----------------------------------------\nREFERENSI TERDETEKSI:\n----------------------------------------\n';
    r.references.forEach(function(ref) {
      rpt += '  • ' + (ref.numLabel!=null?'['+ref.numLabel+'] ':'') + (ref.firstAuthor||'-') + (ref.year?' ('+ref.year+')':'') + (ref.isInstitutional?' [INSTITUSI]':'') + '\n';
      rpt += '    Judul: ' + (ref.title||'-') + '\n';
    });
    var allIssues = r.errors.concat(r.suggestions);
    if (allIssues.length > 0) {
      rpt += '\n----------------------------------------\nDETAIL MASALAH:\n----------------------------------------\n\n';
      if (r.errors.length) { rpt += '🔴 PERLU DIPERBAIKI (' + r.errors.length + '):\n'; r.errors.forEach(function(e,i){ rpt += '  ' + (i+1) + '. ' + e.title + '\n     ' + e.description + '\n'; if(e.code) rpt += '     Ditemukan: ' + e.code + '\n'; if(e.correction) rpt += '     Saran: ' + e.correction + '\n'; rpt += '\n'; }); }
      if (r.suggestions.length) { rpt += '🔵 SARAN (' + r.suggestions.length + '):\n'; r.suggestions.forEach(function(s,i){ rpt += '  ' + (i+1) + '. ' + s.title + '\n     ' + s.description + '\n\n'; }); }
    }
    if (lastDoiIssues.length) {
      rpt += '----------------------------------------\nVALIDASI DOI:\n----------------------------------------\n';
      lastDoiIssues.forEach(function(d,i){ rpt += '  ' + (i+1) + '. [' + d.status.toUpperCase() + '] ' + d.title + ' — ' + d.description + '\n'; });
    }
    rpt += '\n========================================\nGenerated by Validator Sitasi Multi-Format\n========================================\n';
    doCopy(rpt).then(function() {
      els.btnCopyReport.classList.add('copied'); els.btnCopyReport.textContent = '✅ Disalin!';
      showToast('Full report disalin!');
      setTimeout(function(){ els.btnCopyReport.classList.remove('copied'); els.btnCopyReport.textContent = '📋 Copy Full Report'; }, 2200);
    });
  });

  els.btnCopyFixes.addEventListener('click', function() {
    if (!lastResult) return;
    var all = lastResult.errors.concat(lastResult.suggestions).filter(function(i){return i.correction;});
    if (all.length === 0) { showToast('Tidak ada koreksi tersedia'); return; }
    var text = 'KOREKSI SITASI — ' + new Date().toLocaleDateString('id-ID') + '\n========================================\n\n';
    all.forEach(function(item, i) {
      text += (i+1) + '. ' + item.title + '\n';
      if (item.code) text += '   Ditemukan: ' + item.code + '\n';
      text += '   Koreksi: ' + item.correction + '\n\n';
    });
    doCopy(text).then(function() {
      els.btnCopyFixes.classList.add('copied'); els.btnCopyFixes.textContent = '✅ Disalin!';
      showToast('Semua koreksi disalin!');
      setTimeout(function(){ els.btnCopyFixes.classList.remove('copied'); els.btnCopyFixes.textContent = '✅ Copy Semua Koreksi'; }, 2200);
    });
  });
})();
