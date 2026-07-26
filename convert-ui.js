(function() {
  var CE = window.CitationEngine;
  var CC = window.CitationConverter;
  var STYLES = CE.STYLES;

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
    convertedArticleOut: document.getElementById('convertedArticleOut'),
    convertedRefsOut: document.getElementById('convertedRefsOut'),
    btnCopyArticle: document.getElementById('btnCopyArticle'),
    btnCopyRefs: document.getElementById('btnCopyRefs'),
    toast: document.getElementById('toast'),
  };

  function esc(s) { return CE.esc ? CE.esc(s) : String(s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

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

  els.convertBtn.addEventListener('click', function() {
    var articleText = els.articleText.value.trim();
    var referenceText = els.referenceText.value.trim();
    if (!articleText) { alert('Silakan masukkan teks artikel (tab "Isi Manual", atau pakai "Pisahkan Otomatis" di tab sebelah).'); return; }
    if (!referenceText) { alert('Silakan masukkan daftar referensi — dibutuhkan untuk mencocokkan setiap sitasi.'); return; }

    els.loading.classList.add('active');
    els.results.classList.remove('active');
    els.confBadge.classList.remove('show');

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

      renderSummary(result);
      renderUnmatched(result);
      els.convertedArticleOut.value = result.convertedArticle;
      els.convertedRefsOut.value = result.referenceLines.map(function(l) { return l.line; }).join('\n');

      if (els.results.scrollIntoView) els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 10);
  });
})();
