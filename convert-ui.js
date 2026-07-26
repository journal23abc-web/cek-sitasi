(function() {
  var CE = window.CitationEngine;
  var CC = window.CitationConverter;
  var STYLES = CE.STYLES;
  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';

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
  };

  function esc(s) { return CE.esc ? CE.esc(s) : String(s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

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
  els.btnResetArticle.addEventListener('click', function() { els.convertedArticleOut.value = state.autoConvertedArticle; showToast('Dikembalikan ke hasil otomatis'); });
  els.btnResetRefs.addEventListener('click', function() { els.convertedRefsOut.value = state.autoConvertedRefs; showToast('Dikembalikan ke hasil otomatis'); });

  // ---------- Summary / unmatched / preview rendering ----------
  function renderSummary(result) {
    var cards = [
      { n: result.totalCitationsFound, l: 'Sitasi Terdeteksi', cls: '' },
      { n: result.changedCount, l: 'Berhasil Dikonversi', cls: 'ok' },
      { n: result.unmatched.length, l: 'Tidak Diubah', cls: result.unmatched.length > 0 ? 'warn' : '' },
      { n: result.referenceLines.length, l: 'Entri Referensi', cls: '' },
      { n: result.uncitedCount, l: 'Referensi Tak Disitasi', cls: result.uncitedCount > 0 ? 'warn' : '' },
      { n: STYLES[result.sourceStyleId].name + ' → ' + STYLES[result.targetStyleId].name, l: 'Arah Konversi', cls: 'fmt' },
    ];
    els.summaryGrid.innerHTML = cards.map(function(c) {
      return '<div class="sum-card ' + c.cls + '"><div class="n">' + esc(String(c.n)) + '</div><div class="l">' + esc(c.l) + '</div></div>';
    }).join('');
  }

  function renderUnmatched(result) {
    els.unmatchedCount.textContent = result.unmatched.length;
    if (result.unmatched.length === 0) {
      els.unmatchedList.innerHTML = '<div style="font-size:12px;color:var(--text-dim);font-style:italic;">Semua sitasi berhasil dikonversi.</div>';
      els.unmatchedDetails.open = false;
      return;
    }
    els.unmatchedList.innerHTML = result.unmatched.map(function(u) {
      return '<div class="issue-item"><div class="raw">' + esc(u.raw) + '</div><div class="note">' + esc(u.note) + '</div></div>';
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
        result = CC.convert(articleText, referenceText, sourceStyleId, targetStyleId);
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
      els.btnExportDocxOriginal.disabled = !(state.originalFile && state.docxOriginalArticleText != null);

      if (els.results.scrollIntoView) els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 10);
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
    els.fileChip.classList.remove('show');
    els.fileInput.value = '';
    els.uploadStatus.textContent = '';
    els.btnExportDocxOriginal.disabled = true;
  });

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

    loadDocxTextIndex(file)
      .then(function(index) {
        var fullText = index.text;
        var split = CE.splitDocumentByReferences(fullText);
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

        els.fileIcon.textContent = '📘';
        els.fileName.textContent = file.name;
        els.fileSize.textContent = '(' + formatSize(file.size) + ')';
        els.fileChip.classList.add('show');
        setUploadStatus('✅ Terpisah pada heading "' + split.headingText + '" — dipindah ke tab "Isi Manual", silakan periksa/sunting sebelum klik Konversi.', 'ok');
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
    var paragraphs = xmlDoc.getElementsByTagName('w:p');
    for (var p = 0; p < paragraphs.length; p++) {
      var paraStart = text.length;
      var wts = paragraphs[p].getElementsByTagName('w:t');
      for (var i = 0; i < wts.length; i++) {
        var node = wts[i];
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
    var first = valid[0];
    var parent = first.parentNode;
    if (!parent) return 0;
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
          return buildDocxTextIndex(xmlDoc);
        });
      });
  }

  function makeRun(xmlDoc, templateRunEl, textValue) {
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
    return newRun;
  }

  // Replaces each {start,end,text} span (in the index's coordinate space) directly in the live
  // XML DOM, splitting runs as needed so every OTHER run/formatting stays untouched. Matches
  // must be pre-sorted & non-overlapping (caller's responsibility).
  function applyPlainReplacements(xmlDoc, index, matches) {
    var applied = 0;
    matches.forEach(function(m) {
      var touched = index.segments.filter(function(seg) { return seg.start < m.end && seg.end > m.start; });
      if (touched.length === 0) return;
      var wroteReplacement = false;
      touched.forEach(function(seg) {
        var runEl = seg.node.parentNode;
        if (!runEl || !runEl.parentNode) return;
        var fullText = seg.node.textContent;
        var s = Math.max(m.start, seg.start) - seg.start;
        var e = Math.min(m.end, seg.end) - seg.start;
        var before = fullText.slice(0, s), after = fullText.slice(e);
        var mid = wroteReplacement ? '' : m.text; // only insert the replacement once, on the first touched run
        wroteReplacement = true;
        var beforeRun = makeRun(xmlDoc, runEl, before);
        var midRun = makeRun(xmlDoc, runEl, mid);
        var afterRun = makeRun(xmlDoc, runEl, after);
        var parent = runEl.parentNode;
        if (beforeRun) parent.insertBefore(beforeRun, runEl);
        if (midRun) parent.insertBefore(midRun, runEl);
        if (afterRun) parent.insertBefore(afterRun, runEl);
        parent.removeChild(runEl);
      });
      applied++;
    });
    return applied;
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

  // ---------- Export: .docx with original formatting preserved ----------
  els.btnExportDocxOriginal.addEventListener('click', function() {
    if (!state.originalFile || state.docxOriginalArticleText == null) return;
    if (typeof JSZip === 'undefined') { setExportStatus('⚠️ Library JSZip gagal dimuat.', 'err'); return; }

    var sourceStyleId = els.sourceStyleSelect.value === 'auto'
      ? CE.FormatDetector.detect(state.docxOriginalArticleText, state.docxOriginalReferenceText).styleId
      : els.sourceStyleSelect.value;
    var targetStyleId = els.targetStyleSelect.value;

    var result;
    try {
      result = CC.convert(state.docxOriginalArticleText, state.docxOriginalReferenceText, sourceStyleId, targetStyleId);
    } catch (err) {
      setExportStatus('⚠️ ' + err.message, 'err');
      return;
    }

    setExportStatus('Memproses file .docx...', 'info');
    els.btnExportDocxOriginal.disabled = true;

    state.originalFile.arrayBuffer()
      .then(function(buf) { return JSZip.loadAsync(buf); })
      .then(function(zip) {
        var docPath = 'word/document.xml';
        return zip.file(docPath).async('string').then(function(xmlString) {
          var xmlDoc = new DOMParser().parseFromString(xmlString, 'application/xml');
          var index = buildDocxTextIndex(xmlDoc);
          var fullText = index.text;

          // Citation spans were computed against `state.docxOriginalArticleText` (the ARTICLE
          // portion only), but the XML index covers the WHOLE document — re-locate the
          // article's offset within the full text so span coordinates line up.
          var articleOffset = fullText.indexOf(state.docxOriginalArticleText.slice(0, 200));
          var matches = [];
          if (articleOffset !== -1) {
            result.citationSpans.forEach(function(s) {
              if (!s.matched) return;
              matches.push({ start: articleOffset + s.start, end: articleOffset + s.end, text: s.replacement });
            });
          }

          // Reference list: find each original reference line verbatim in the reference zone,
          // swap in the converted line (numbering/author format), AND remember which <w:p> it
          // lives in — captured BEFORE any text mutation, using the ORIGINAL positions, so the
          // paragraph elements can be physically reordered afterward to match `referenceLines`'
          // target order (numbering isn't just text — the printed order has to match it too).
          var headingInfo = CE.findReferencesHeading(fullText);
          var refZoneStart = headingInfo ? headingInfo.offset : (articleOffset !== -1 ? articleOffset + state.docxOriginalArticleText.length : 0);
          var refParagraphsInTargetOrder = [];
          result.referenceLines.forEach(function(rl) {
            var idx = fullText.indexOf(rl.original, refZoneStart);
            if (idx === -1) { refParagraphsInTargetOrder.push(null); return; }
            matches.push({ start: idx, end: idx + rl.original.length, text: rl.line });
            refParagraphsInTargetOrder.push(paragraphAtOffset(index, idx));
          });

          matches.sort(function(a, b) { return a.start - b.start; });
          var clean = [], lastEnd = -1;
          matches.forEach(function(m) { if (m.start >= lastEnd) { clean.push(m); lastEnd = m.end; } });

          if (clean.length === 0) return { blob: null, count: 0, reordered: 0 };

          var count = applyPlainReplacements(xmlDoc, index, clean);
          // Physically move the reference paragraphs into the new target order (harmless if
          // they already happen to be in that order — reorderParagraphs is a no-op-equivalent
          // in that case, just re-inserting each element where an equivalent one already was).
          var locatedCount = refParagraphsInTargetOrder.filter(Boolean).length;
          var reorderedCount = locatedCount >= 2 ? reorderParagraphs(xmlDoc, refParagraphsInTargetOrder) : 0;

          var newXml = new XMLSerializer().serializeToString(xmlDoc.documentElement);
          if (!/^\s*<\?xml/i.test(newXml)) newXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + newXml;
          zip.file(docPath, newXml);
          return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
            .then(function(blob) { return { blob: blob, count: count, reordered: reorderedCount, totalRefs: result.referenceLines.length }; });
        });
      })
      .then(function(res) {
        els.btnExportDocxOriginal.disabled = false;
        if (!res.blob) { setExportStatus('⚠️ Tidak ada bagian yang bisa dicocokkan/diganti di file aslinya.', 'warn'); return; }
        var dateStr = new Date().toISOString().slice(0, 10);
        triggerDownload(res.blob, (state.originalFile.name || 'naskah').replace(/\.docx$/i, '') + '-KONVERSI-' + dateStr + '.docx');
        var msg = '✅ Berhasil — ' + res.count + ' bagian diganti di dalam file asli (format tetap terjaga).';
        if (res.reordered > 0) {
          msg += ' Urutan paragraf referensi disesuaikan (' + res.reordered + '/' + res.totalRefs + ' entri ditemukan & diurutkan ulang) supaya penomoran berurut dari 1 sesuai urutan tampil.';
          if (res.reordered < res.totalRefs) msg += ' Sisanya tidak ditemukan persis di teks aslinya — cek posisinya manual.';
        }
        setExportStatus(msg, 'ok');
      })
      .catch(function(err) {
        els.btnExportDocxOriginal.disabled = false;
        setExportStatus('⚠️ Gagal memproses: ' + err.message, 'err');
      });
  });

  // ---------- Export: fresh plain .docx built from current (possibly edited) textareas ----------
  function buildMinimalDocx(articleText, referenceText) {
    var paragraphs = [];
    articleText.split(/\n+/).forEach(function(line) { if (line.trim()) paragraphs.push(line.trim()); });
    paragraphs.push('');
    paragraphs.push('REFERENCES');
    referenceText.split(/\n+/).forEach(function(line) { if (line.trim()) paragraphs.push(line.trim()); });

    function xesc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    var body = paragraphs.map(function(line) {
      return '<w:p><w:r><w:t xml:space="preserve">' + xesc(line) + '</w:t></w:r></w:p>';
    }).join('');

    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<w:document xmlns:w="' + W_NS + '"><w:body>' + body + '<w:sectPr/></w:body></w:document>';
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
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  els.btnExportDocxPlain.addEventListener('click', function() {
    if (typeof JSZip === 'undefined') { setExportStatus('⚠️ Library JSZip gagal dimuat.', 'err'); return; }
    var article = els.convertedArticleOut.value.trim();
    var refs = els.convertedRefsOut.value.trim();
    if (!article) { setExportStatus('⚠️ Belum ada hasil konversi untuk diekspor.', 'warn'); return; }
    setExportStatus('Membuat file .docx...', 'info');
    buildMinimalDocx(article, refs)
      .then(function(blob) {
        var dateStr = new Date().toISOString().slice(0, 10);
        triggerDownload(blob, 'sitasi-konversi-' + dateStr + '.docx');
        setExportStatus('✅ File .docx (teks polos) berhasil diunduh.', 'ok');
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
    var dateStr = new Date().toISOString().slice(0, 10);
    triggerDownload(blob, 'sitasi-konversi-' + dateStr + '.txt');
    setExportStatus('✅ File .txt berhasil diunduh.', 'ok');
  });
})();
