(function() {
  var CE = window.CitationEngine;
  var STYLES = CE.STYLES;

  var els = {
    styleSelect: document.getElementById('styleSelect'),
    confBadge: document.getElementById('confBadge'),
    confText: document.getElementById('confText'),
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
  };

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
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    document.getElementById('pane-paste').classList.toggle('active', mode === 'paste');
    document.getElementById('pane-manual').classList.toggle('active', mode === 'manual');
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

      els.loading.classList.remove('active');
      els.results.classList.add('active');
      renderAll(result, []);

      // DOI checking (async, progressive)
      var refsWithDoi = result.references.filter(function(r) { return r.doi; });
      var refsNoJournalDoi = result.references; // we still want to note missing DOIs for journal-like sources
      if (result.references.length > 0) {
        els.doiProgress.classList.add('active');
        runDoiChecks(result.references, styleId).then(function(doiIssues) {
          lastDoiIssues = doiIssues;
          els.doiProgress.classList.remove('active');
          renderAll(result, doiIssues);
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
                description: 'DOI ada, tetapi ' + cmp.mismatches.map(function(m){return m.field + ' (referensi: ' + m.ref + ', CrossRef: ' + m.cr + ')';}).join('; ') + ' tidak cocok dengan data CrossRef.' + (noteTexts.length ? ' ' + noteTexts.join(' ') : ''), code: ref.doi,
                metadata: { ref: { title: ref.title, authors: (ref.authors||[]).join(', '), year: ref.year }, crossref: { title: crTitle, authors: crAuthors, year: crYear }, mismatches: cmp.mismatches, matches: cmp.matches }
              });
            } else {
              doiIssues.push({
                ref: ref, doi: ref.doi, status: 'valid', severity: 'success', title: 'DOI valid & metadata sesuai',
                description: 'DOI "' + ref.doi + '" terverifikasi di CrossRef.', code: ref.doi,
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
    renderSummary(result, doiIssues);
    renderYearRange(result);
    renderCitationMap(result);
    renderDetected(result);
    renderIssueList('list-errors', result.errors);
    renderIssueList('list-suggestions', result.suggestions);
    renderDoiList(doiIssues);
    renderIssueList('list-all', result.errors.concat(result.suggestions));
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

  function setActivePreset(years) {
    document.querySelectorAll('.yr-preset').forEach(function(btn) {
      btn.classList.toggle('active', years != null && parseInt(btn.dataset.years, 10) === years);
    });
  }

  function applyYearPreset(years) {
    currentYearRange = CE.YearRange.presetToRange(years);
    els.yrFrom.value = ''; els.yrTo.value = '';
    setActivePreset(years);
    if (lastResult) renderYearRange(lastResult);
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
    if (lastResult) renderYearRange(lastResult);
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

  function renderCitationMap(result) {
    var style = STYLES[result.styleId];
    var panel = els.citationMapPanel;
    if (style.family === 'numeric') {
      var refByNum = {};
      result.references.forEach(function(r){ if (r.numLabel!=null) refByNum[r.numLabel]=r; });
      var citedNums = new Set();
      result.citations.forEach(function(c){ c.numbers.forEach(function(n){citedNums.add(n);}); });
      var citeItems = Array.from(citedNums).sort(function(a,b){return a-b;}).map(function(n){
        return { label: '[' + n + ']', matched: !!refByNum[n] };
      });
      var refItems = result.references.map(function(r){
        return { label: '[' + r.numLabel + '] ' + (r.firstAuthor||'-') + (r.year?' ('+r.year+')':''), matched: citedNums.has(r.numLabel) };
      });
      panel.innerHTML = mapHTML('In-Text Citations', citeItems, 'Reference List', refItems);
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
          citeItems.push({ label: label, matched: matched !== false });
        });
      } else {
        var label2 = (c.authors||'-') + (c.year ? ', ' + c.year : '');
        if (seenCiteLabels.has(label2)) return;
        seenCiteLabels.add(label2);
        var firstTok = splitFirstToken(c.authors);
        var matched2 = lastValidator ? lastValidator.isCitationMatched(firstTok, c.year || null) : null;
        citeItems.push({ label: label2, matched: matched2 !== false });
      }
    });
    var refItems = result.references.map(function(r){
      var cited = lastValidator ? lastValidator.isReferenceCited(r) : null;
      return { label: (r.firstAuthor||'-') + (r.year ? ' ('+r.year+')' : '') + (r.isInstitutional ? ' 🏛' : ''), matched: cited !== false };
    });
    panel.innerHTML = mapHTML('In-Text Citations', citeItems, 'Reference List', refItems);
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
    var a = uniq(itemsA), b = uniq(itemsB);
    return '<h3 style="font-family:\'Space Grotesk\',sans-serif;font-size:15px;margin:0 0 14px;">📊 Peta Sitasi ↔ Referensi</h3><div class="map-grid">' +
      '<div class="map-col"><h4>' + labelA + ' (' + a.length + ')</h4>' +
      (a.length===0?'<p style="color:var(--text-dim);font-size:12px;">Tidak ada sitasi terdeteksi</p>':'') +
      a.map(function(i){return '<div class="map-item '+(i.matched?'matched':'unmatched')+'"><span class="d"></span>'+esc(i.label)+'</div>';}).join('') +
      '</div><div class="map-col"><h4>' + labelB + ' (' + b.length + ')</h4>' +
      (b.length===0?'<p style="color:var(--text-dim);font-size:12px;">Tidak ada referensi</p>':'') +
      b.map(function(i){return '<div class="map-item '+(i.matched?'matched':'unmatched')+'"><span class="d"></span>'+esc(i.label)+'</div>';}).join('') +
      '</div></div>';
  }

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
          '<div class="sub">Judul: ' + esc(r.title||'-') + (r.doi ? ' | DOI: '+esc(r.doi) : '') + ' | ' + r.authorCount + ' penulis</div></div>';
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
    issues.forEach(function(issue) {
      var sc = issue.severity || 'error';
      var sl = sc === 'error' ? 'PERLU DIPERBAIKI' : sc === 'warning' ? 'WARNING' : 'SARAN';
      html += '<div class="issue-item ' + sc + '">';
      html += '<div class="issue-header"><span class="issue-sev">' + sl + '</span><span class="issue-title">' + esc(issue.title) + '</span></div>';
      html += '<div class="issue-desc">' + esc(issue.description) + '</div>';
      if (issue.code) html += '<div class="code-block code-issue" data-copy="' + escAttr(issue.code) + '">' + esc(issue.code) + '<button class="copy-inline">📋</button></div>';
      if (issue.correction) html += '<div class="code-block code-fix" data-copy="' + escAttr(issue.correction) + '">✓ ' + esc(issue.correction) + '<button class="copy-inline">📋</button></div>';
      html += '</div>';
    });
    el.innerHTML = html;
    bindCopyBlocks(el);
  }

  function renderDoiList(doiIssues) {
    var el = document.getElementById('list-doi');
    if (doiIssues.length === 0) {
      el.innerHTML = '<div class="no-issues">🔗 Belum ada data DOI (sedang diproses atau tidak ada referensi).</div>';
      return;
    }
    var html = '';
    doiIssues.forEach(function(issue) {
      var sc = issue.severity;
      var sl = sc === 'error' ? 'FIKTIF' : sc === 'warning' ? (issue.status==='mismatch'?'MISMATCH':'UNVERIFIED') : sc === 'success' ? 'VALID' : 'INFO';
      var instTag = issue.ref && issue.ref.isInstitutional ? '<span class="type-tag inst">INSTITUSI</span>' : '';
      html += '<div class="issue-item ' + (sc==='success'?'suggestion':sc) + '">';
      html += '<div class="issue-header"><span class="issue-sev">' + sl + '</span>' + instTag + '<span class="issue-title">' + esc(issue.title) + '</span></div>';
      html += '<div class="issue-desc">' + esc(issue.description) + '</div>';
      if (issue.code) html += '<div class="code-block code-issue" data-copy="' + escAttr(issue.code) + '">' + esc(issue.code) + '<button class="copy-inline">📋</button></div>';
      if (issue.correction) html += '<div class="code-block code-fix" data-copy="' + escAttr(issue.correction) + '">✓ ' + esc(issue.correction) + '<button class="copy-inline">📋</button></div>';
      if (issue.metadata) {
        var m = issue.metadata;
        html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10.5px;color:var(--text-dim);margin-top:8px;line-height:1.8;">';
        html += 'Ref Anda — Judul: ' + esc(m.ref.title||'-') + ' | Penulis: ' + esc(m.ref.authors||'-') + ' | Tahun: ' + esc(m.ref.year||'-') + '<br>';
        html += 'CrossRef — Judul: ' + esc(m.crossref.title||'-') + ' | Penulis: ' + esc(m.crossref.authors||'-') + ' | Tahun: ' + esc(m.crossref.year||'-');
        html += '</div>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
    bindCopyBlocks(el);
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
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(function(c){c.classList.remove('active');});
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

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
