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
    downloadWordBtn: document.getElementById('downloadWordBtn'),
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

  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  // ---------- Ekstraksi paragraf dari .docx (baca XML langsung, bukan pakai mammoth, supaya
  // batas paragraf presisi & konsisten dengan cara tool lain di sistem ini membaca .docx) ----------
  // PENTING: cuma paragraf yang jadi ANAK LANGSUNG <w:body> yang diambil untuk dibandingkan/
  // direkonstruksi (bukan getElementsByTagName('w:p') yang juga menjangkau paragraf DI DALAM
  // sel tabel) — supaya saat membangun ulang dokumen Track Changes, tabel di badan naskah tidak
  // ikut hilang/rusak. Tabel & elemen non-paragraf lain di badan naskah dipertahankan UTUH (tidak
  // ikut di-diff isinya), disisipkan kembali di posisi relatifnya semula.
  function loadDocxDetailed(file) {
    return file.arrayBuffer()
      .then(function (buf) { return JSZip.loadAsync(buf); })
      .then(function (zip) {
        var docPath = 'word/document.xml';
        if (!zip.file(docPath)) throw new Error('word/document.xml tidak ditemukan di dalam file .docx — pastikan ini file Word yang valid.');
        return zip.file(docPath).async('string').then(function (xmlString) { return { zip: zip, xmlString: xmlString }; });
      })
      .then(function (res) {
        var xmlDoc = new DOMParser().parseFromString(res.xmlString, 'application/xml');
        if (xmlDoc.getElementsByTagName('parsererror').length > 0) throw new Error('Gagal membaca struktur XML .docx.');
        var bodyList = xmlDoc.getElementsByTagName('w:body');
        if (!bodyList.length) throw new Error('Struktur <w:body> tidak ditemukan.');
        var body = bodyList[0];
        var paragraphs = []; // {el, text, runs, pPrXml, bodyChildIndex}
        var bodyChildren = []; // urutan ASLI semua anak ELEMEN langsung <w:body> — dipakai utk rekonstruksi posisi tabel dll. (node teks/whitespace antar elemen dilewati, tidak signifikan)
        for (var c = 0; c < body.childNodes.length; c++) {
          var node = body.childNodes[c];
          if (node.nodeType !== 1) continue; // lewati node teks/whitespace, cuma elemen yang dilacak
          var childIdx = bodyChildren.length;
          bodyChildren.push(node);
          if (node.tagName === 'w:p') {
            var runEls = node.getElementsByTagName('w:r');
            var runs = [];
            var flat = '';
            for (var j = 0; j < runEls.length; j++) {
              var wts = runEls[j].getElementsByTagName('w:t');
              var t = '';
              for (var k = 0; k < wts.length; k++) t += wts[k].textContent;
              if (t) {
                var rPrList = runEls[j].getElementsByTagName('w:rPr');
                runs.push({ text: t, rPrXml: rPrList.length ? new XMLSerializer().serializeToString(rPrList[0]) : null });
                flat += t;
              }
            }
            var trimmed = flat.trim();
            if (trimmed) {
              var pPrList = node.getElementsByTagName('w:pPr');
              paragraphs.push({ el: node, text: trimmed, runs: runs, pPrXml: pPrList.length ? new XMLSerializer().serializeToString(pPrList[0]) : null, bodyChildIndex: childIdx });
            }
          }
        }
        return { zip: res.zip, xmlDoc: xmlDoc, body: body, bodyChildren: bodyChildren, paragraphs: paragraphs };
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

    Promise.all([loadDocxDetailed(state.fileBefore), loadDocxDetailed(state.fileAfter)])
      .then(function (res) {
        state.beforeDetailed = res[0];
        state.afterDetailed = res[1];
        var oldParas = res[0].paragraphs.map(function (p) { return p.text; });
        var newParas = res[1].paragraphs.map(function (p) { return p.text; });
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

  // ---------- Ekspor Word dengan Track Changes sungguhan (format 100% terjaga) ----------
  function escXml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildRunXmlString(text, rPrXml, isDeleted) {
    var tTag = isDeleted ? 'w:delText' : 'w:t';
    return '<w:r>' + (rPrXml || '') + '<' + tTag + ' xml:space="preserve">' + escXml(text) + '</' + tTag + '></w:r>';
  }

  // Pecah tiap run jadi token kata+spasi (persis seperti CompareEngine.tokenizeWords), TAPI
  // tiap token tetap membawa rPrXml dari run ASALNYA — inilah yang memungkinkan bold/italic/
  // font run asli tetap terjaga persis sampai ke level kata, bukan cuma level paragraf.
  function tokenizeRunsToWords(runs) {
    var tokens = [];
    runs.forEach(function (run) {
      var parts = run.text.match(/\S+|\s+/g) || [];
      parts.forEach(function (part) { tokens.push({ text: part, rPrXml: run.rPrXml }); });
    });
    return tokens;
  }

  var trackChangeIdCounter = 9000;
  var TC_AUTHOR = ' w:author="Cek Sitasi \u2014 Bandingkan Revisi" w:date="' + new Date().toISOString() + '"';

  function buildDeletedParagraphXmlString(oldPara) {
    var runsXml = oldPara.runs.map(function (r) { return buildRunXmlString(r.text, r.rPrXml, true); }).join('');
    return '<w:p>' + (oldPara.pPrXml || '') + '<w:del w:id="' + (trackChangeIdCounter++) + '"' + TC_AUTHOR + '>' + runsXml + '</w:del></w:p>';
  }

  function buildAddedParagraphXmlString(newPara) {
    var runsXml = newPara.runs.map(function (r) { return buildRunXmlString(r.text, r.rPrXml, false); }).join('');
    return '<w:p>' + (newPara.pPrXml || '') + '<w:ins w:id="' + (trackChangeIdCounter++) + '"' + TC_AUTHOR + '>' + runsXml + '</w:ins></w:p>';
  }

  // Paragraf yang SAMA tapi diedit sebagian — diff level-kata (bukan seluruh paragraf sekaligus)
  // supaya cuma kata yang genuinely berubah yang ditandai, sisanya tampil normal (tidak ditandai
  // apa-apa), persis seperti Word Track Changes asli. Token dikelompokkan dulu (gabung token
  // berurutan dengan tipe+format SAMA) supaya tidak menghasilkan satu <w:r> terpisah per kata.
  function buildModifiedParagraphXmlString(oldPara, newPara) {
    var oldTokens = tokenizeRunsToWords(oldPara.runs);
    var newTokens = tokenizeRunsToWords(newPara.runs);
    var ops = window.CompareEngine.diffTokensGeneric(oldTokens, newTokens, function (t) { return t.text; });

    var groups = [];
    ops.forEach(function (op) {
      var item = op.type === 'del' ? op.oldItem : op.newItem;
      var key = op.type + '|' + (item.rPrXml || '');
      var last = groups[groups.length - 1];
      if (last && last.key === key) last.text += item.text;
      else groups.push({ key: key, type: op.type, text: item.text, rPrXml: item.rPrXml });
    });

    var body = newPara.pPrXml || '';
    groups.forEach(function (g) {
      if (g.type === 'same') {
        body += buildRunXmlString(g.text, g.rPrXml, false);
      } else if (g.type === 'del') {
        body += '<w:del w:id="' + (trackChangeIdCounter++) + '"' + TC_AUTHOR + '>' + buildRunXmlString(g.text, g.rPrXml, true) + '</w:del>';
      } else {
        body += '<w:ins w:id="' + (trackChangeIdCounter++) + '"' + TC_AUTHOR + '>' + buildRunXmlString(g.text, g.rPrXml, false) + '</w:ins>';
      }
    });
    return '<w:p>' + body + '</w:p>';
  }

  // Susun ulang seluruh badan dokumen berdasar hasil diff, mempertahankan elemen NON-paragraf
  // (tabel, dll.) dari versi SESUDAH apa adanya di posisi relatif aslinya — supaya tabel tidak
  // ikut hilang/rusak (isinya tidak ikut di-diff, di luar cakupan fitur ini untuk saat ini).
  function buildTrackedChangesXml(diff, beforeDetailed, afterDetailed) {
    var serializer = new XMLSerializer();
    var afterBodyChildren = afterDetailed.bodyChildren;
    var output = '';
    var lastEmittedIdx = -1;

    function emitNonParagraphsUpTo(targetIdx) {
      for (var i = lastEmittedIdx + 1; i < targetIdx; i++) {
        var node = afterBodyChildren[i];
        if (node.tagName !== 'w:p') output += serializer.serializeToString(node);
      }
    }

    diff.forEach(function (d) {
      if (d.type === 'same') {
        var p1 = afterDetailed.paragraphs[d.newIndex];
        emitNonParagraphsUpTo(p1.bodyChildIndex);
        output += serializer.serializeToString(p1.el);
        lastEmittedIdx = p1.bodyChildIndex;
      } else if (d.type === 'add') {
        var p2 = afterDetailed.paragraphs[d.newIndex];
        emitNonParagraphsUpTo(p2.bodyChildIndex);
        output += buildAddedParagraphXmlString(p2);
        lastEmittedIdx = p2.bodyChildIndex;
      } else if (d.type === 'modified') {
        var oldP = beforeDetailed.paragraphs[d.oldIndex];
        var newP = afterDetailed.paragraphs[d.newIndex];
        emitNonParagraphsUpTo(newP.bodyChildIndex);
        output += buildModifiedParagraphXmlString(oldP, newP);
        lastEmittedIdx = newP.bodyChildIndex;
      } else { // del — tidak punya posisi di dokumen SESUDAH, disisipkan di urutan hasil diff apa adanya
        output += buildDeletedParagraphXmlString(beforeDetailed.paragraphs[d.oldIndex]);
      }
    });
    emitNonParagraphsUpTo(afterBodyChildren.length); // sisa non-paragraf di akhir (mis. w:sectPr)
    return output;
  }

  function buildTrackedChangesDocxBlob(diff, beforeDetailed, afterDetailed) {
    trackChangeIdCounter = 9000;
    var newBodyXml = buildTrackedChangesXml(diff, beforeDetailed, afterDetailed);
    var serializer = new XMLSerializer();
    var docEl = afterDetailed.xmlDoc.documentElement;
    var docOpenTag = serializer.serializeToString(docEl).match(/^<w:document[^>]*>/)[0];
    var fullXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + docOpenTag + '<w:body>' + newBodyXml + '</w:body></w:document>';
    var zip = afterDetailed.zip;
    zip.file('word/document.xml', fullXml);
    // Setting yang mengaktifkan mode "tampilkan markup" saat file dibuka (opsional tapi
    // membantu — Word tetap bisa menampilkan w:ins/w:del walau setting ini tidak ada).
    return zip.generateAsync({ type: 'blob' });
  }


  els.downloadBtn.addEventListener('click', function () {
    if (!state.lastDiff) return;
    window.print();
  });

  els.downloadWordBtn.addEventListener('click', function () {
    if (!state.lastDiff) return;
    els.downloadWordBtn.disabled = true;
    els.downloadStatus.innerHTML = '<span class="spinner"></span>Menyusun file Word...';
    els.downloadStatus.className = 'status info';
    buildTrackedChangesDocxBlob(state.lastDiff, state.beforeDetailed, state.afterDetailed)
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var baseName = (state.fileAfter.name || 'naskah').replace(/\.docx$/i, '');
        a.href = url;
        a.download = baseName + '-perbandingan-track-changes.docx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        els.downloadStatus.textContent = '✅ File Word berhasil dibuat & diunduh.';
        els.downloadStatus.className = 'status ok';
        els.downloadWordBtn.disabled = false;
        showToast('File Word (Track Changes) berhasil diunduh.');
      })
      .catch(function (err) {
        els.downloadStatus.textContent = '❌ Gagal membuat file Word: ' + err.message;
        els.downloadStatus.className = 'status err';
        els.downloadWordBtn.disabled = false;
      });
  });
})();
