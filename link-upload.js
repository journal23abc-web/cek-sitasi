(function() {
  var CE = window.CitationEngine;
  var STYLES = CE.STYLES;
  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';

  var els = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    fileChip: document.getElementById('fileChip'),
    fileName: document.getElementById('fileName'),
    fileSize: document.getElementById('fileSize'),
    fileRemove: document.getElementById('fileRemove'),
    styleSelect: document.getElementById('styleSelect'),
    processBtn: document.getElementById('processBtn'),
    statusMsg: document.getElementById('statusMsg'),
    results: document.getElementById('results'),
    summaryGrid: document.getElementById('summaryGrid'),
    unmatchedSection: document.getElementById('unmatchedSection'),
    downloadBtn: document.getElementById('downloadBtn'),
    downloadStatus: document.getElementById('downloadStatus'),
  };

  var state = {
    file: null,
    lastLinkedBlob: null,
    lastStats: null,
  };

  function esc(t) { return CE.esc(t); }

  function setStatus(msg, kind) {
    els.statusMsg.textContent = msg || '';
    els.statusMsg.className = 'status ' + (kind || 'info');
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ---------- File selection ----------
  els.dropzone.addEventListener('click', function() { els.fileInput.click(); });
  els.dropzone.addEventListener('dragover', function(e) { e.preventDefault(); els.dropzone.classList.add('drag'); });
  els.dropzone.addEventListener('dragleave', function() { els.dropzone.classList.remove('drag'); });
  els.dropzone.addEventListener('drop', function(e) {
    e.preventDefault();
    els.dropzone.classList.remove('drag');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  els.fileInput.addEventListener('change', function() {
    if (els.fileInput.files && els.fileInput.files[0]) handleFile(els.fileInput.files[0]);
  });
  els.fileRemove.addEventListener('click', function(e) {
    e.stopPropagation();
    state.file = null;
    els.fileChip.classList.remove('show');
    els.processBtn.disabled = true;
    els.fileInput.value = '';
    setStatus('', 'info');
  });

  function handleFile(file) {
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setStatus('⚠️ Hanya file .docx yang didukung (dibutuhkan struktur XML asli untuk menulis hyperlink internal).', 'err');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setStatus('⚠️ Ukuran file melebihi batas 25MB.', 'err');
      return;
    }
    state.file = file;
    els.fileName.textContent = file.name;
    els.fileSize.textContent = '(' + formatSize(file.size) + ')';
    els.fileChip.classList.add('show');
    els.processBtn.disabled = false;
    els.results.classList.remove('active');
    setStatus('✅ File siap diproses. Klik "Tautkan Sitasi ke Referensi".', 'ok');
  }

  // ---------- DOCX XML helpers (same technique used by upload.js's highlighted-export) ----------
  function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
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

  // Wraps the run(s) touched by [start,end) in a <w:hyperlink w:anchor="bookmarkName"> element,
  // splitting the boundary runs so every OTHER run/formatting stays byte-for-byte untouched —
  // same split-and-clone technique upload.js uses for highlighting, but wrapping in a hyperlink
  // element instead of recoloring, so the visible text/formatting never changes.
  function wrapRangeInHyperlink(xmlDoc, index, start, end, bookmarkName) {
    var touched = index.segments.filter(function(seg) { return seg.start < end && seg.end > start; });
    if (touched.length === 0) return false;
    var hyperlinkRuns = [];
    var containerParagraph = null;
    touched.forEach(function(seg) {
      var runEl = seg.node.parentNode;
      if (!runEl || !runEl.parentNode) return;
      var fullText = seg.node.textContent;
      var s = Math.max(start, seg.start) - seg.start;
      var e = Math.min(end, seg.end) - seg.start;
      var before = fullText.slice(0, s), mid = fullText.slice(s, e), after = fullText.slice(e);
      var beforeRun = makeRun(xmlDoc, runEl, before);
      var midRun = makeRun(xmlDoc, runEl, mid);
      var afterRun = makeRun(xmlDoc, runEl, after);
      var parent = runEl.parentNode;
      if (beforeRun) parent.insertBefore(beforeRun, runEl);
      if (midRun) { parent.insertBefore(midRun, runEl); hyperlinkRuns.push(midRun); containerParagraph = parent; }
      if (afterRun) parent.insertBefore(afterRun, runEl);
      parent.removeChild(runEl);
    });
    if (hyperlinkRuns.length === 0 || !containerParagraph) return false;
    var hyperlinkEl = xmlDoc.createElementNS(W_NS, 'w:hyperlink');
    hyperlinkEl.setAttributeNS(W_NS, 'w:anchor', bookmarkName);
    hyperlinkEl.setAttributeNS(W_NS, 'w:history', '1');
    var firstRun = hyperlinkRuns[0];
    containerParagraph.insertBefore(hyperlinkEl, firstRun);
    hyperlinkRuns.forEach(function(r) { hyperlinkEl.appendChild(r); });
    return true;
  }

  // Inserts a zero-width bookmark (start immediately followed by end) right before the run
  // touching `at` — enough for Word to navigate to, without needing to split/wrap any text.
  function insertBookmarkAt(xmlDoc, index, at, id, name) {
    var seg = index.segments.find(function(s) { return at >= s.start && at < s.end; }) || index.segments.find(function(s) { return at <= s.end; });
    if (!seg) return false;
    var runEl = seg.node.parentNode;
    if (!runEl || !runEl.parentNode) return false;
    var startEl = xmlDoc.createElementNS(W_NS, 'w:bookmarkStart');
    startEl.setAttributeNS(W_NS, 'w:id', String(id));
    startEl.setAttributeNS(W_NS, 'w:name', name);
    var endEl = xmlDoc.createElementNS(W_NS, 'w:bookmarkEnd');
    endEl.setAttributeNS(W_NS, 'w:id', String(id));
    runEl.parentNode.insertBefore(startEl, runEl);
    runEl.parentNode.insertBefore(endEl, runEl);
    return true;
  }

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function flexiblePattern(term, flags) {
    var t = (term || '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    var pattern = t.split(' ').map(escapeRegex).join('\\s+');
    try { return new RegExp(pattern, flags || 'i'); } catch (e) { return null; }
  }

  function splitFirstToken(authorsStr) {
    if (!authorsStr) return authorsStr;
    var cleaned = authorsStr.replace(/\s*et\s+al\.?/i, '');
    var arr = CE.splitOnSeparators(cleaned);
    return arr[0] || cleaned;
  }

  // ---------- Core: build the citation<->reference link plan, then write it into the XML ----------
  function buildLinkedDocx(file, styleId) {
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

          var split = CE.splitDocumentByReferences(fullText);
          if (!split.references) throw new Error('Heading daftar referensi tidak terdeteksi otomatis di naskah ini.');
          var articleText = split.article; // starts at offset 0 of fullText
          var referencesText = split.references;
          var refZoneStart = fullText.indexOf(referencesText);
          if (refZoneStart === -1) throw new Error('Gagal menentukan lokasi daftar referensi di dalam dokumen.');

          var actualStyleId = styleId;
          var confidence = null;
          if (styleId === 'auto') {
            var detection = CE.FormatDetector.detect(articleText, referencesText);
            actualStyleId = detection.styleId;
            confidence = detection.confidence;
          }

          var validator = new CE.MultiFormatValidator(articleText, referencesText, actualStyleId);
          var result = validator.validate();
          var style = STYLES[actualStyleId];

          // 1) Locate each reference's absolute position in fullText (sequential cursor keeps
          //    entries in document order even if two references share very similar wording).
          var cursor = refZoneStart;
          var refPositions = result.references.map(function(r) {
            var anchorTerm = (r.raw || r.firstAuthor || '').split(/\s+/).slice(0, 8).join(' ');
            var anchorRe = flexiblePattern(anchorTerm, 'i');
            if (!anchorRe) return null;
            var slice = fullText.slice(cursor);
            var localMatch = slice.match(anchorRe);
            if (!localMatch) return null;
            var absStart = cursor + localMatch.index;
            cursor = absStart + localMatch[0].length;
            return { ref: r, start: absStart };
          });

          // 2) Build a lookup from a normalized "surname|year" key to that reference's position —
          //    same key shape the Peta Sitasi cross-link feature uses, so behavior stays consistent.
          function linkKey(author, year) {
            var surnameOnly = String(author || '').split(',')[0];
            return surnameOnly.toLowerCase().replace(/[^a-z0-9]+/g, '') + '|' + String(year || '');
          }
          var refByKey = {};
          refPositions.forEach(function(rp) {
            if (!rp) return;
            refByKey[linkKey(rp.ref.firstAuthor, rp.ref.year)] = rp;
          });
          var refByNum = {};
          result.references.forEach(function(r, i) {
            if (r.numLabel != null) refByNum[r.numLabel] = refPositions[i];
          });

          // 3) Walk every in-text citation, resolve it to a reference position, and record a
          //    {citeStart, citeEnd, refPosition} link job. Collected first, applied after (in
          //    reverse document order) so earlier edits never shift the offsets of later ones.
          var jobs = [];
          function addJob(citeStart, citeEnd, refPos) {
            if (!refPos) return;
            jobs.push({ citeStart: citeStart, citeEnd: citeEnd, refPos: refPos });
          }

          if (style.family === 'numeric') {
            result.citations.forEach(function(c) {
              var raw = c.raw || '';
              var start = c.position, end = c.position + raw.length;
              // A single "[3, 5, 7]" style citation can reference multiple numbers — link the
              // WHOLE bracketed citation to the first number's reference (linking each individual
              // number separately would require splitting inside the brackets, which risks
              // corrupting the visible punctuation for a rarely-needed edge case).
              var firstNum = c.numbers && c.numbers[0];
              if (firstNum != null && refByNum[firstNum]) addJob(start, end, refByNum[firstNum]);
            });
          } else {
            result.citations.forEach(function(c) {
              var raw = c.raw || '';
              var start = c.position, end = c.position + raw.length;
              if (c.parts) {
                // Parenthetical, possibly multiple "; "-separated authors — link the whole
                // parenthetical to the FIRST author's reference (same reasoning as numeric above).
                var first = c.parts[0];
                if (first) addJob(start, end, refByKey[linkKey(first.firstAuthor, first.year)]);
              } else {
                var firstTok = splitFirstToken(c.authors);
                addJob(start, end, refByKey[linkKey(firstTok, c.year)]);
              }
            });
          }

          // 4) Assign one bookmark per REFERENCE (not per citation — several citations can point
          //    at the same reference and should share one bookmark), then apply hyperlinks.
          var bookmarkNameByRefStart = {};
          var nextBookmarkId = 0;
          var linkedCount = 0, skippedOverlap = 0;

          // Apply in reverse document order so each edit's DOM splitting never invalidates the
          // still-pending offsets of earlier matches.
          jobs.sort(function(a, b) { return b.citeStart - a.citeStart; });
          var seenSpans = [];
          jobs.forEach(function(job) {
            // Guard against overlapping citation spans (e.g. mis-detected nested matches).
            var overlaps = seenSpans.some(function(s) { return job.citeStart < s.end && job.citeEnd > s.start; });
            if (overlaps) { skippedOverlap++; return; }
            seenSpans.push({ start: job.citeStart, end: job.citeEnd });

            var refStart = job.refPos.start;
            var bookmarkName = bookmarkNameByRefStart[refStart];
            if (!bookmarkName) {
              bookmarkName = 'cite_ref_' + (nextBookmarkId + 1);
              var ok = insertBookmarkAt(xmlDoc, index, refStart, nextBookmarkId, bookmarkName);
              if (!ok) return;
              bookmarkNameByRefStart[refStart] = bookmarkName;
              nextBookmarkId++;
            }
            var wrapped = wrapRangeInHyperlink(xmlDoc, index, job.citeStart, job.citeEnd, bookmarkName);
            if (wrapped) linkedCount++;
          });

          var totalCitations = result.citations.length;
          var unmatchedCount = Math.max(0, totalCitations - linkedCount);

          var newXml = new XMLSerializer().serializeToString(xmlDoc.documentElement);
          if (!/^\s*<\?xml/i.test(newXml)) newXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + newXml;
          zip.file(docPath, newXml);

          return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
            .then(function(blob) {
              return {
                blob: blob,
                styleName: style.name,
                confidence: confidence,
                totalCitations: totalCitations,
                totalReferences: result.references.length,
                linkedCount: linkedCount,
                unmatchedCount: unmatchedCount,
                skippedOverlap: skippedOverlap,
              };
            });
        });
      });
  }

  els.processBtn.addEventListener('click', function() {
    if (!state.file) return;
    els.processBtn.disabled = true;
    setStatus('⏳ Membaca struktur .docx dan menautkan sitasi...', 'info');
    els.results.classList.remove('active');

    buildLinkedDocx(state.file, els.styleSelect.value)
      .then(function(stats) {
        state.lastLinkedBlob = stats.blob;
        state.lastStats = stats;
        setStatus('✅ Selesai. ' + stats.linkedCount + ' dari ' + stats.totalCitations + ' sitasi berhasil ditautkan.', 'ok');
        renderResults(stats);
        els.results.classList.add('active');
      })
      .catch(function(err) {
        console.error(err);
        setStatus('❌ Gagal memproses: ' + (err && err.message ? err.message : String(err)), 'err');
      })
      .finally(function() {
        els.processBtn.disabled = false;
      });
  });

  function renderResults(stats) {
    els.summaryGrid.innerHTML =
      '<div class="sum-card fmt"><div class="n">' + esc(stats.styleName) + '</div><div class="l">Gaya' + (stats.confidence != null ? ' (' + stats.confidence + '%)' : '') + '</div></div>' +
      '<div class="sum-card ok"><div class="n">' + stats.linkedCount + '</div><div class="l">Sitasi Ditautkan</div></div>' +
      '<div class="sum-card warn"><div class="n">' + stats.unmatchedCount + '</div><div class="l">Tidak Ditautkan</div></div>' +
      '<div class="sum-card ok"><div class="n">' + stats.totalReferences + '</div><div class="l">Referensi</div></div>';

    if (stats.unmatchedCount > 0) {
      els.unmatchedSection.innerHTML =
        '<div class="field-label" style="margin-top:16px;">Kenapa Ada yang Tidak Tertaut?</div>' +
        '<div class="unmatched-item">Sitasi yang tidak punya pasangan jelas di daftar referensi (nama/tahun tidak cocok persis) sengaja TIDAK ditautkan secara paksa — daripada menautkan ke referensi yang salah, sistem membiarkannya seperti semula. Cek dengan Validator Sitasi untuk detail sitasi mana saja yang tidak cocok.</div>';
    } else {
      els.unmatchedSection.innerHTML = '';
    }
  }

  els.downloadBtn.addEventListener('click', function() {
    if (!state.lastLinkedBlob) return;
    var a = document.createElement('a');
    var baseName = (state.file.name || 'naskah').replace(/\.docx$/i, '');
    a.href = URL.createObjectURL(state.lastLinkedBlob);
    a.download = baseName + '-tertaut.docx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    els.downloadStatus.textContent = '✅ Diunduh sebagai "' + a.download + '"';
    els.downloadStatus.className = 'status ok';
  });

  // Debug/test-only hook — does not affect normal page behavior.
  window.__linkUploadInternal = { buildLinkedDocx: buildLinkedDocx };
})();
