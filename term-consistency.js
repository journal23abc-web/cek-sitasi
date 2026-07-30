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
  };

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function setStatus(msg, kind) {
    els.statusMsg.textContent = msg || '';
    els.statusMsg.className = 'status ' + (kind || 'info');
  }

  els.processBtn.addEventListener('click', function () {
    var text = els.articleText.value.trim();
    if (!text) {
      setStatus('⚠️ Tempel teks naskah terlebih dahulu.', 'warn');
      return;
    }
    if (text.split(/\s+/).length < 30) {
      setStatus('⚠️ Teks terlalu pendek untuk dianalisis dengan andal.', 'warn');
      return;
    }
    setStatus('⏳ Menganalisis...', 'info');
    els.processBtn.disabled = true;
    // Run on next tick so the "Menganalisis..." status actually paints before the (synchronous,
    // potentially slow-ish on very long text) analysis runs.
    setTimeout(function () {
      try {
        var result = TCE.buildConceptDictionary(text);
        render(result);
        setStatus('✅ Selesai.', 'ok');
      } catch (err) {
        console.error(err);
        setStatus('❌ Gagal menganalisis: ' + err.message, 'err');
      } finally {
        els.processBtn.disabled = false;
      }
    }, 30);
  });

  function render(result) {
    els.results.classList.add('active');
    var conceptList = Object.keys(result.concepts).map(function (k) { return result.concepts[k]; });

    els.summaryGrid.innerHTML =
      '<div class="sum-card info"><div class="n">' + conceptList.length + '</div><div class="l">Konsep Terdeteksi</div></div>' +
      '<div class="sum-card warn"><div class="n">' + result.inconsistentTerms.length + '</div><div class="l">Tidak Konsisten</div></div>' +
      '<div class="sum-card warn"><div class="n">' + result.undefinedImportantTerms.length + '</div><div class="l">Belum Didefinisikan</div></div>' +
      '<div class="sum-card"><div class="n">' + result.possibleAliases.length + '</div><div class="l">Kemungkinan Alias</div></div>' +
      '<div class="sum-card ok"><div class="n">' + result.acronymAliases.length + '</div><div class="l">Pasangan Akronim</div></div>';

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
    var html4 = '<table class="tc-table"><thead><tr><th>Istilah</th><th>Tipe</th><th>Akronim</th><th>Skor Variabel</th><th>Definisi</th></tr></thead><tbody>';
    conceptList.sort(function (a, b) { return b.variableScore - a.variableScore; }).forEach(function (c) {
      html4 += '<tr>' +
        '<td>' + esc(c.canonicalSurface) + (c.consistencyIssue ? ' <span style="color:var(--amber);">⚠️</span>' : '') + '</td>' +
        '<td><span class="tc-type ' + c.type + '">' + c.type.replace(/_/g, ' ') + '</span></td>' +
        '<td>' + (c.aliasAcronyms.length ? esc(c.aliasAcronyms.join(', ')) : '—') + '</td>' +
        '<td>' + c.variableScore + '</td>' +
        '<td>' + (c.definitions.length ? c.definitions.map(function (d) { return '<div style="margin-bottom:4px;"><b>' + d.type + '</b>: ' + esc(d.text.slice(0, 100)) + (d.text.length > 100 ? '…' : '') + '</div>'; }).join('') : '<span style="color:var(--text-faint);">tidak ditemukan</span>') + '</td>' +
        '</tr>';
    });
    html4 += '</tbody></table>';
    els.dictionaryPanel.innerHTML = html4;
  }

  // Debug/test-only hook — does not affect normal page behavior.
  window.__termConsistencyInternal = { render: render };
})();
