(function () {
  'use strict';

  var els = {
    dropzoneBefore: document.getElementById('dropzoneBefore'),
    dropzoneAfter: document.getElementById('dropzoneAfter'),
    fileInputBefore: document.getElementById('fileInputBefore'),
    fileInputAfter: document.getElementById('fileInputAfter'),
    fileChipBefore: document.getElementById('fileChipBefore'),
    fileChipAfter: document.getElementById('fileChipAfter'),
    fileNameBefore: document.getElementById('fileNameBefore'),
    fileNameAfter: document.getElementById('fileNameAfter'),
    fileSizeBefore: document.getElementById('fileSizeBefore'),
    fileSizeAfter: document.getElementById('fileSizeAfter'),
    fileRemoveBefore: document.getElementById('fileRemoveBefore'),
    fileRemoveAfter: document.getElementById('fileRemoveAfter'),
    compareBtn: document.getElementById('compareBtn'),
    statusMsg: document.getElementById('statusMsg'),
    results: document.getElementById('results'),
    summaryGrid: document.getElementById('summaryGrid'),
    diffPreview: document.getElementById('diffPreview'),
    downloadBtn: document.getElementById('downloadBtn'),
    downloadStatus: document.getElementById('downloadStatus'),
    toast: document.getElementById('toast'),
  };

  var state = { fileBefore: null, fileAfter: null, lastDiff: null };
  var MAX_SIZE = 25 * 1024 * 1024;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function showToast(msg) {
    els.toast.textContent = '✅ ' + msg;
    els.toast.classList.add('show');
    setTimeout(function () { els.toast.classList.remove('show'); }, 2000);
  }

  // ---------- Ekstraksi paragraf dari .docx (baca XML langsung, bukan pakai mammoth, supaya
  // batas paragraf presisi & konsisten dengan cara tool lain di sistem ini membaca .docx) ----------
  function extractParagraphsFromDocx(file) {
    return file.arrayBuffer()
      .then(function (buf) { return JSZip.loadAsync(buf); })
      .then(function (zip) {
        var docPath = 'word/document.xml';
        if (!zip.file(docPath)) throw new Error('word/document.xml tidak ditemukan di dalam file .docx — pastikan ini file Word yang valid.');
        return zip.file(docPath).async('string');
      })
      .then(function (xmlString) {
        var xmlDoc = new DOMParser().parseFromString(xmlString, 'application/xml');
        if (xmlDoc.getElementsByTagName('parsererror').length > 0) throw new Error('Gagal membaca struktur XML .docx.');
        var paraEls = xmlDoc.getElementsByTagName('w:p');
        var paragraphs = [];
        for (var i = 0; i < paraEls.length; i++) {
          var wts = paraEls[i].getElementsByTagName('w:t');
          var t = '';
          for (var j = 0; j < wts.length; j++) t += wts[j].textContent;
          t = t.trim();
          if (t) paragraphs.push(t);
        }
        return paragraphs;
      });
  }

  // ---------- Upload handling (2 slot) ----------
  function setupSlot(key, dropzoneEl, inputEl, chipEl, nameEl, sizeEl, removeEl) {
    function handleFile(file) {
      if (!file) return;
      if (!/\.docx$/i.test(file.name)) {
        els.statusMsg.textContent = '⚠️ Cuma menerima file .docx.';
        els.statusMsg.className = 'status err';
        return;
      }
      if (file.size > MAX_SIZE) {
        els.statusMsg.textContent = '⚠️ Ukuran file maksimum 25MB.';
        els.statusMsg.className = 'status err';
        return;
      }
      state[key] = file;
      nameEl.textContent = file.name;
      sizeEl.textContent = '(' + fmtSize(file.size) + ')';
      chipEl.classList.add('show');
      dropzoneEl.style.display = 'none';
      els.statusMsg.textContent = '';
      updateCompareBtn();
    }

    dropzoneEl.addEventListener('click', function () { inputEl.click(); });
    dropzoneEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputEl.click(); } });
    dropzoneEl.addEventListener('dragover', function (e) { e.preventDefault(); dropzoneEl.classList.add('drag'); });
    dropzoneEl.addEventListener('dragleave', function () { dropzoneEl.classList.remove('drag'); });
    dropzoneEl.addEventListener('drop', function (e) {
      e.preventDefault();
      dropzoneEl.classList.remove('drag');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    inputEl.addEventListener('change', function () { if (inputEl.files && inputEl.files[0]) handleFile(inputEl.files[0]); });
    removeEl.addEventListener('click', function () {
      state[key] = null;
      inputEl.value = '';
      chipEl.classList.remove('show');
      dropzoneEl.style.display = '';
      updateCompareBtn();
    });
  }

  function updateCompareBtn() {
    els.compareBtn.disabled = !(state.fileBefore && state.fileAfter);
  }

  setupSlot('fileBefore', els.dropzoneBefore, els.fileInputBefore, els.fileChipBefore, els.fileNameBefore, els.fileSizeBefore, els.fileRemoveBefore);
  setupSlot('fileAfter', els.dropzoneAfter, els.fileInputAfter, els.fileChipAfter, els.fileNameAfter, els.fileSizeAfter, els.fileRemoveAfter);

  // ---------- Proses & render ----------
  els.compareBtn.addEventListener('click', function () {
    els.compareBtn.disabled = true;
    els.statusMsg.innerHTML = '<span class="spinner"></span>Membaca & membandingkan kedua file...';
    els.statusMsg.className = 'status info';

    Promise.all([extractParagraphsFromDocx(state.fileBefore), extractParagraphsFromDocx(state.fileAfter)])
      .then(function (res) {
        var oldParas = res[0], newParas = res[1];
        if (oldParas.length === 0 || newParas.length === 0) {
          throw new Error('Salah satu file tidak mengandung teks yang bisa dibaca — pastikan bukan file kosong atau hasil scan gambar.');
        }
        var diff = window.CompareEngine.diffParagraphs(oldParas, newParas);
        state.lastDiff = diff;
        renderResults(diff);
        els.statusMsg.textContent = '✅ Perbandingan selesai — ' + oldParas.length + ' paragraf (sebelum) vs ' + newParas.length + ' paragraf (sesudah).';
        els.statusMsg.className = 'status ok';
        els.results.classList.add('active');
        els.compareBtn.disabled = false;
        try { els.results.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
      })
      .catch(function (err) {
        els.statusMsg.textContent = '❌ ' + err.message;
        els.statusMsg.className = 'status err';
        els.compareBtn.disabled = false;
      });
  });

  function renderResults(diff) {
    var summary = window.CompareEngine.summarize(diff);
    els.summaryGrid.innerHTML =
      '<div class="sum-card del"><div class="n">' + summary.deleted + '</div><div class="l">Dihapus</div></div>' +
      '<div class="sum-card add"><div class="n">' + summary.added + '</div><div class="l">Ditambah</div></div>' +
      '<div class="sum-card mod"><div class="n">' + summary.modified + '</div><div class="l">Diedit</div></div>' +
      '<div class="sum-card same"><div class="n">' + summary.unchanged + '</div><div class="l">Tidak Berubah</div></div>';

    var html = '<h1>Perbandingan Revisi Naskah</h1>';
    html += '<p class="rp-meta">Versi sebelum: ' + esc(state.fileBefore.name) + '</p>';
    html += '<p class="rp-meta">Versi sesudah: ' + esc(state.fileAfter.name) + '</p>';
    html += '<p class="rp-meta">' + summary.deleted + ' paragraf dihapus &middot; ' + summary.added + ' paragraf ditambah &middot; ' + summary.modified + ' paragraf diedit &middot; ' + summary.unchanged + ' paragraf tidak berubah</p>';
    html += '<h2>Detail Perubahan</h2>';

    if (summary.totalChanges === 0) {
      html += '<p class="rp-empty">Tidak ada perbedaan terdeteksi — kedua versi naskah identik.</p>';
    } else {
      diff.forEach(function (d) {
        if (d.type === 'same') {
          html += '<p class="diff-para">' + esc(d.oldText) + '</p>';
        } else if (d.type === 'del') {
          html += '<p class="diff-para del"><span class="diff-tag">Dihapus</span>' + esc(d.oldText) + '</p>';
        } else if (d.type === 'add') {
          html += '<p class="diff-para add"><span class="diff-tag">Ditambah</span>' + esc(d.newText) + '</p>';
        } else if (d.type === 'modified') {
          var wordDiff = window.CompareEngine.diffWords(d.oldText, d.newText);
          var inline = wordDiff.map(function (op) {
            if (op.type === 'same') return esc(op.text);
            if (op.type === 'del') return '<del>' + esc(op.text) + '</del>';
            return '<ins>' + esc(op.text) + '</ins>';
          }).join('');
          html += '<p class="diff-para mod"><span class="diff-tag">Diedit</span>' + inline + '</p>';
        }
      });
    }
    html += '<div class="rp-foot">Dibuat oleh Cek Sitasi — Bandingkan Revisi Naskah. Deteksi perubahan berbasis algoritma diff teks (LCS); paragraf yang dipindah urutannya bisa muncul sebagai gabungan dihapus+ditambah, bukan "dipindah", tergantung seberapa mirip isinya dengan paragraf di sekitarnya.</div>';

    els.diffPreview.innerHTML = html;
  }

  els.downloadBtn.addEventListener('click', function () {
    if (!state.lastDiff) return;
    window.print();
  });
})();
