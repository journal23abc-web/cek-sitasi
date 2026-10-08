(function () {
  'use strict';
  var E = window.CopyeditingEngine, D = window.CopyeditingDocx, AI = window.CopyeditingAI;
  var ids = ['fileInput', 'dropzone', 'fileLabel', 'fileMeta', 'manuscriptId', 'abstractMax', 'referenceMin', 'manuscriptMax', 'authorNames', 'auditBtn', 'resetRulesBtn', 'removeBtn', 'cancelBtn', 'statusMsg', 'progress', 'results', 'metrics', 'coverage', 'warnings', 'abstractStart', 'abstractEnd', 'referenceStart', 'applyBoundariesBtn', 'abstractPreview', 'abstractElements', 'fullText', 'verifyBtn', 'refStatus', 'referenceSummary', 'referenceList', 'promptBtn', 'importBtn', 'reviewInput', 'aiEndpoint', 'aiModel', 'aiToken', 'aiBtn', 'semanticStatus', 'issueSection', 'issueParagraph', 'issueQuote', 'issueComment', 'addIssueBtn', 'manualStatus', 'issueList', 'editorConfirmed', 'highlightWord', 'pdfBtn', 'wordBtn', 'exportStatus', 'reportPage', 'letterMode'];
  var el = {}; ids.forEach(function (id) { el[id] = document.getElementById(id); });
  var state = { file: null, doc: null, result: null, epoch: 0, busy: false, controller: null, overrides: {}, localSelection: false };
  var RULE_KEY = 'copyeditingJournalRules_v1', buttonIds = ['auditBtn', 'verifyBtn', 'promptBtn', 'importBtn', 'aiBtn', 'applyBoundariesBtn', 'wordBtn', 'pdfBtn', 'addIssueBtn', 'resetRulesBtn', 'removeBtn'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function short(s, length) { s = E.normalize(s); return s.length > length ? s.slice(0, length - 1) + '…' : s; }
  function status(message, tone, target) { target = target || el.statusMsg; target.textContent = message; target.className = 'status ' + (tone || 'info'); }
  function rules() { return E.settings({ abstractMax: el.abstractMax.value, referenceMin: el.referenceMin.value, manuscriptMax: el.manuscriptMax.value }); }
  function saveRules(r) { try { localStorage.setItem(RULE_KEY, JSON.stringify(r)); } catch (err) {} }
  try { var saved = E.settings(JSON.parse(localStorage.getItem(RULE_KEY) || '{}')); ['abstractMax', 'referenceMin', 'manuscriptMax'].forEach(function (key) { el[key].value = saved[key]; }); } catch (err) {}
  function busy(on) {
    state.busy = on; el.cancelBtn.hidden = !on;
    buttonIds.forEach(function (id) { el[id].disabled = on || (id === 'auditBtn' || id === 'removeBtn' ? !state.file : id === 'resetRulesBtn' ? false : !state.result); });
    ['abstractMax', 'referenceMin', 'manuscriptMax', 'authorNames', 'manuscriptId', 'editorConfirmed'].forEach(function (id) { el[id].disabled = on; });
    if (!on) { el.progress.hidden = true; state.controller = null; }
  }
  function invalidateSemantic(message) {
    if (!state.result) return;
    state.result.semantic = { complete: false, source: null, reviewedIds: [], elements: {} };
    state.result.issues = state.result.issues.filter(function (it) { return it.source !== 'ai'; });
    el.editorConfirmed.checked = false;
    if (message) status(message, 'info', el.semanticStatus);
  }
  function clearResult() {
    if (state.controller) state.controller.abort(); state.epoch++; state.result = null; state.doc = null; state.overrides = {}; el.results.hidden = true; el.editorConfirmed.checked = false; busy(false);
  }
  function setFile(file, local) {
    if (!file) return;
    if (!/\.docx$/i.test(file.name) || file.size > 25 * 1024 * 1024) { status('Pilih file .docx dengan ukuran maksimum 25 MB.', 'err'); return; }
    if (local) state.localSelection = true;
    clearResult(); state.file = file; el.fileLabel.textContent = file.name; el.fileLabel.className = 'file-name'; el.fileMeta.textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB — siap diaudit'; busy(false); status('Naskah dimuat. Isi Manuscript ID dan jalankan audit lokal.');
  }
  el.dropzone.addEventListener('click', function () { el.fileInput.click(); });
  el.fileInput.addEventListener('change', function () { setFile(el.fileInput.files[0], true); });
  el.dropzone.addEventListener('dragover', function (event) { event.preventDefault(); el.dropzone.classList.add('drag'); });
  el.dropzone.addEventListener('dragleave', function () { el.dropzone.classList.remove('drag'); });
  el.dropzone.addEventListener('drop', function (event) { event.preventDefault(); el.dropzone.classList.remove('drag'); setFile(event.dataTransfer.files[0], true); });
  el.removeBtn.addEventListener('click', function () { clearResult(); state.file = null; state.localSelection = true; el.fileInput.value = ''; el.fileLabel.textContent = 'Pilih atau letakkan naskah .docx di sini'; el.fileLabel.className = ''; el.fileMeta.textContent = 'Maksimum 25 MB.'; if (window.SharedFile) window.SharedFile.clear(); busy(false); status('Naskah telah dihapus dari sesi ini.'); });
  if (window.SharedFile) window.SharedFile.load().then(function (savedFile) { if (!state.localSelection && savedFile && savedFile.file) setFile(savedFile.file, false); });
  el.cancelBtn.addEventListener('click', function () { if (state.controller) state.controller.abort(); state.epoch++; busy(false); status('Proses dibatalkan. Hasil yang belum selesai tidak diterapkan.'); });
  el.resetRulesBtn.addEventListener('click', function () { ['abstractMax', 'referenceMin', 'manuscriptMax'].forEach(function (key) { el[key].value = E.DEFAULTS[key]; }); saveRules(rules()); if (state.result) clearResult(); status('Aturan dikembalikan ke 250 / 35 / 9.000. Jalankan audit untuk menerapkannya.'); });
  ['abstractMax', 'referenceMin', 'manuscriptMax'].forEach(function (key) { el[key].addEventListener('change', function () { try { saveRules(rules()); if (state.result) clearResult(); status('Aturan berubah. Jalankan audit ulang untuk memperbarui hasil.'); } catch (err) { status(err.message, 'err'); } }); });
  el.authorNames.addEventListener('change', function () { invalidateSemantic('Daftar author berubah. Tinjau ulang kontribusi author atau jalankan review AI kembali.'); if (state.result) { renderIssues(); renderCoverage(); renderElements(); updateLetter(); } });
  el.manuscriptId.addEventListener('input', function () { el.editorConfirmed.checked = false; updateLetter(); });
  function fillSelect(select, records, blank, selected) {
    select.replaceChildren(); var option = document.createElement('option'); option.value = ''; option.textContent = blank; select.appendChild(option);
    records.forEach(function (r) { var opt = document.createElement('option'); opt.value = r.id; opt.textContent = r.id + ' — ' + short(r.text, 85); select.appendChild(opt); });
    select.value = selected || '';
  }
  function renderBoundaries() {
    var r = state.result, main = r.zones.main.filter(function (p) { return ['body', 'textbox', 'table'].includes(p.kind); });
    var firstAbstract = r.zones.abstractRecords[0], lastAbstract = r.zones.abstractRecords[r.zones.abstractRecords.length - 1];
    var refHeading = r.zones.main.find(function (p) { return p.section === 'references' && !r.zones.referenceRecords.includes(p); });
    fillSelect(el.abstractStart, main, 'Deteksi otomatis', firstAbstract && firstAbstract.id);
    fillSelect(el.abstractEnd, main, 'Deteksi otomatis', r.zones.abstractBounded && lastAbstract ? lastAbstract.id : '');
    fillSelect(el.referenceStart, main, 'Deteksi otomatis', refHeading && refHeading.id);
    fillSelect(el.issueParagraph, r.zones.records, 'Pilih paragraf bukti', ''); el.issueQuote.value = '';
    el.abstractPreview.textContent = r.zones.abstractText || 'Belum terdeteksi. Tentukan batas abstrak di atas.';
    el.fullText.textContent = r.doc.fullText;
  }
  async function runAudit(useDoc) {
    if (!state.file) return;
    if (!E.normalize(el.manuscriptId.value)) { status('Isi Manuscript ID sebelum menjalankan audit.', 'err'); el.manuscriptId.focus(); return; }
    if (typeof JSZip === 'undefined') { status('Pembaca Word tidak berhasil dimuat. Periksa koneksi dan muat ulang halaman.', 'err'); return; }
    var journalRules;
    try { journalRules = rules(); } catch (err) { status(err.message, 'err'); return; }
    var epoch = ++state.epoch; busy(true); status('Membaca seluruh teks, tabel, catatan, header, dan footer Word…');
    try {
      var doc = useDoc && state.doc ? state.doc : await D.read(state.file);
      if (epoch !== state.epoch) return;
      // Yield for status painting; heavy citation checks do not silently truncate input.
      await new Promise(function (resolve) { requestAnimationFrame(function () { resolve(); }); });
      var result = E.audit(doc, { rules: journalRules, overrides: state.overrides });
      if (epoch !== state.epoch) return;
      state.doc = doc; state.result = result; el.editorConfirmed.checked = false; el.results.hidden = false;
      status('', 'info', el.refStatus); status('Review substansi dan bahasa belum dijalankan.', 'info', el.semanticStatus); status('', 'info', el.manualStatus); status('', 'info', el.exportStatus);
      renderAll(); saveRules(journalRules); status('Audit lokal selesai. Verifikasi referensi dan tinjau temuan sebelum ekspor.', 'ok');
    } catch (err) { if (epoch === state.epoch) status('Audit gagal: ' + err.message, 'err'); }
    finally { if (epoch === state.epoch) busy(false); }
  }
  el.auditBtn.addEventListener('click', function () { state.overrides = {}; runAudit(false); });
  el.applyBoundariesBtn.addEventListener('click', function () { state.overrides = { abstractStartId: el.abstractStart.value, abstractEndId: el.abstractEnd.value, referenceStartId: el.referenceStart.value }; runAudit(true); });
  function renderCoverage() {
    var r = state.result; if (!r) return;
    var confirmed = el.editorConfirmed.checked, issues = r.issues.filter(function (it) { return it.selected; }).length;
    var verified = r.verification.filter(function (v) { return ['metadata_verified', 'editor_verified', 'verified_no_doi'].includes(v.status); }).length;
    el.coverage.className = 'coverage' + (confirmed ? ' complete' : '');
    el.coverage.textContent = r.zones.records.length + ' paragraf dibaca, termasuk ' + r.doc.tableCount + ' tabel dan ' + r.doc.images.length + ' penempatan gambar. ' + issues + ' temuan dipilih. ' + verified + '/' + r.references.length + ' referensi memiliki pencocokan metadata lengkap atau konfirmasi editor. ' + (r.semantic.complete ? 'JSON review mencakup seluruh ID paragraf; kualitas penilaian AI tetap perlu ditinjau.' : 'Substansi, etik, kontribusi author, grammar menyeluruh, dan relevansi sumber belum dikonfirmasi otomatis.') + (confirmed ? ' Editor telah mengonfirmasi catatan ini.' : ' Ekspor masih diberi label draf sampai editor mengonfirmasi tinjauan lengkap.');
    var warnings = (r.doc.warnings || []).slice();
    if (r.abstractUncertain) warnings.push('Batas abstrak belum pasti. Konfirmasi awal dan akhir sebelum menyatakan jumlah kata final.');
    if (!r.zones.referenceFound) warnings.push('Heading daftar referensi tidak ditemukan. Tentukan batas bagian referensi.');
    if (r.sync.unresolvedReferences.length) warnings.push(r.sync.unresolvedReferences.length + ' referensi belum terurai atau belum berpasangan secara unik. Hitungan sinkronisasi memerlukan pemeriksaan manual.');
    el.warnings.replaceChildren(); warnings.forEach(function (w) { var li = document.createElement('li'); li.textContent = w; el.warnings.appendChild(li); });
  }
  function renderMetrics() {
    var r = state.result;
    var facts = [[r.manuscriptWords.toLocaleString('id-ID'), 'Kata seluruh draft / batas ' + r.rules.manuscriptMax.toLocaleString('id-ID')], [r.abstractUncertain ? 'Perlu cek' : r.abstractWords, 'Kata abstrak / batas ' + r.rules.abstractMax], [r.zones.referenceFound ? r.references.length : 'Perlu cek', 'Entri referensi / minimum ' + r.rules.referenceMin], [r.sync.occurrences, 'Kemunculan sitasi terdeteksi']];
    el.metrics.innerHTML = facts.map(function (f) { return '<div class="metric"><b>' + esc(f[0]) + '</b><span>' + esc(f[1]) + '</span></div>'; }).join('');
  }
  function renderElements() {
    var elements = state.result.semantic.elements || {}, labels = { purpose: 'Purpose', methods: 'Methods', findings: 'Findings', researchImplications: 'Research implications', originality: 'Originality' }, statuses = { present: 'ada', missing: 'belum terpenuhi', unclear: 'belum jelas' };
    el.abstractElements.innerHTML = Object.keys(labels).map(function (key) { var e = elements[key]; return '<span class="pill" title="' + esc(e && e.reason || 'Memerlukan pemeriksaan makna; pencarian kata kunci tidak cukup.') + '">' + esc(labels[key]) + ': ' + esc(e ? statuses[e.status] : 'perlu tinjauan') + '</span>'; }).join('');
  }
  function renderIssues() {
    var r = state.result, groups = E.SECTIONS.map(function () { return []; });
    r.issues.forEach(function (issue) { groups[issue.section - 1].push(issue); });
    var html = '';
    groups.forEach(function (list, i) {
      if (!list.length) return;
      html += '<h3>' + (i + 1) + ' ' + esc(E.SECTIONS[i]) + '</h3>';
      list.forEach(function (issue) {
        html += '<div class="issue"><input type="checkbox" data-issue="' + esc(issue.id) + '" aria-label="Sertakan temuan ini dalam catatan author" ' + (issue.selected ? 'checked' : '') + '><div><span class="pill">' + esc(issue.source === 'ai' ? 'Review AI · tinjau bukti' : issue.source === 'editor' ? 'Temuan editor' : issue.review ? 'Heuristik · perlu konfirmasi' : 'Pemeriksaan lokal') + '</span><p lang="en">' + esc(issue.comment) + '</p>';
        (issue.evidence || []).forEach(function (e) { html += '<blockquote>' + esc(e.paragraphId) + ': ' + esc(short(e.quote, 600)) + '</blockquote>'; });
        html += '</div></div>';
      });
    });
    el.issueList.innerHTML = html || '<p class="empty">Tidak ada temuan lokal yang memerlukan koreksi. Bagian yang membutuhkan penilaian makna tetap harus ditinjau.</p>';
    el.issueList.querySelectorAll('[data-issue]').forEach(function (checkbox) { checkbox.addEventListener('change', function () { var issue = r.issues.find(function (it) { return it.id === checkbox.dataset.issue; }); issue.selected = checkbox.checked; el.editorConfirmed.checked = false; renderCoverage(); updateLetter(); }); });
  }
  var statusLabels = { not_checked: 'Belum diperiksa online', unverified: 'Unverified reference', metadata_mismatch: 'Metadata berbeda', partial_match: 'Metadata cocok sebagian', metadata_verified: 'Metadata cocok pada seluruh field yang diperiksa', editor_verified: 'Sumber dikonfirmasi editor', verified_no_doi: 'Sumber tanpa DOI dikonfirmasi editor' };
  function renderReferences() {
    var r = state.result;
    el.referenceSummary.textContent = r.references.length + ' entri referensi — lihat status & bukti sumber';
    var html = '';
    r.references.forEach(function (ref, i) {
      var v = r.verification[i], good = ['metadata_verified', 'editor_verified', 'verified_no_doi'].includes(v.status);
      html += '<div class="ref"><p><b>' + ref.id + '</b> ' + esc(ref.raw) + '</p><p class="ref-status' + (good ? ' good' : '') + '">' + esc(statusLabels[v.status]) + '</p><p>' + esc(v.reason) + '</p>';
      if (v.sourceUrl) html += '<a href="' + esc(v.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(v.sourceUrl) + '</a>';
      if (v.doi) html += '<p><a href="https://doi.org/' + esc(v.doi) + '" target="_blank" rel="noopener noreferrer">https://doi.org/' + esc(v.doi) + '</a></p>';
      if ((v.fields || []).length) html += '<div class="ref-fields">' + v.fields.map(function (f) { return esc(f.field) + ': ' + (f.matches ? 'cocok' : 'berbeda') + ' · naskah “' + esc(f.provided) + '” · sumber “' + esc(f.official) + '”'; }).join('<br>') + '</div>';
      if ((v.missingFields || []).length) html += '<p>Belum dibandingkan: ' + esc(v.missingFields.join(', ')) + '.</p>';
      html += '<details><summary>Catat pemeriksaan manual sumber resmi</summary><div><div class="grid"><label class="field">Keputusan editor<select data-ref-status="' + i + '"><option value="unverified">Belum terverifikasi</option value="editor_verified">Sumber &amp; metadata telah cocok</option value="verified_no_doi">Sumber nyata, tidak memiliki DOI</option value="metadata_mismatch">Metadata perlu dikoreksi</option></select></label><label class="field">URL resmi yang telah diperiksa<input type="url" data-ref-url="' + i + '" value="' + esc(v.sourceUrl || '') + '" placeholder="https://..."></label><label class="field">Bukti / alasan (bahasa Inggris)<input type="text" data-ref-reason="' + i + '" placeholder="Untuk tanpa DOI, jelaskan dasar kesimpulannya"></label></div><div class="actions"><button class="ghost" type="button" data-ref-save="' + i + '">Simpan konfirmasi editor</button></div><p data-ref-error="' + i + '" class="error-box" role="status"></p></div></details></div>';
    });
    el.referenceList.innerHTML = html || '<p class="empty">Belum ada entri referensi yang dapat ditampilkan. Periksa batas bagian referensi.</p>';
    el.referenceList.querySelectorAll('[data-ref-save]').forEach(function (button) { button.addEventListener('click', function () {
      var i = Number(button.dataset.refSave), select = el.referenceList.querySelector('[data-ref-status="' + i + '"]'), urlInput = el.referenceList.querySelector('[data-ref-url="' + i + '"]'), reasonInput = el.referenceList.querySelector('[data-ref-reason="' + i + '"]'), error = el.referenceList.querySelector('[data-ref-error="' + i + '"]');
      try {
        var url = urlInput.value.trim(), reason = E.normalize(reasonInput.value), statusValue = select.value;
        if (statusValue !== 'unverified') {
          var parsedUrl = new URL(url);
          if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || /(^|\.)(?:researchgate\.net|scholar\.google\.[a-z.]+)$/i.test(parsedUrl.hostname) || !reason) throw new Error('Isi URL HTTPS dari sumber resmi yang sudah Anda periksa dan penjelasan bukti berbahasa Inggris.');
        }
        if (statusValue === 'metadata_mismatch') throw new Error('Untuk metadata yang perlu dikoreksi, tambahkan temuan editor dengan kutipan dan detail perbaikannya; jangan tandai sumber sebagai terverifikasi.');
        var ref = r.references[i], doi = statusValue === 'editor_verified' ? (window.CitationEngine.extractDOI(url) || ref.doi || '') : '';
        r.verification[i] = { refId: ref.id, status: statusValue, checked: statusValue !== 'unverified', checkedAt: new Date().toISOString(), sourceUrl: url, reason: reason || 'The editor has not established source validity.', fields: [], differences: [], missingFields: [], doi: doi, identityMatches: statusValue === 'editor_verified', lookup: 'editor' };
        invalidateSemantic('Bukti referensi berubah. Tinjau ulang penilaian dukungan sumber terhadap klaim.'); renderReferences(); renderIssues(); renderCoverage(); renderElements(); updateLetter();
      } catch (err) { error.textContent = err.message; }
    }); });
  }
  function updateLetter() {
    if (!state.result) return;
    var hasId = !!E.normalize(el.manuscriptId.value);
    el.pdfBtn.disabled = state.busy || !hasId; el.wordBtn.disabled = state.busy || !hasId;
    if (!hasId) { el.reportPage.textContent = 'Isi Manuscript ID untuk menampilkan catatan editorial.'; return; }
    var confirmed = el.editorConfirmed.checked;
    state.letter = E.createLetter(state.result, { manuscriptId: el.manuscriptId.value, editorConfirmed: confirmed });
    el.reportPage.innerHTML = state.letter.split(/\n\s*\n/).map(function (block) { return /^[1-7] /.test(block) ? '<h2>' + esc(block) + '</h2>' : '<p>' + esc(block).replace(/\n/g, '<br>') + '</p>'; }).join('');
    el.letterMode.textContent = confirmed ? 'Dikonfirmasi editor' : 'Draf otomatis';
    el.pdfBtn.textContent = confirmed ? 'Laporan PDF' : 'Laporan PDF (draf)'; el.wordBtn.textContent = confirmed ? 'Word berkomentar' : 'Word berkomentar (draf)';
  }
  function renderAll() { renderMetrics(); renderCoverage(); renderBoundaries(); renderReferences(); renderElements(); renderIssues(); updateLetter(); }
  el.editorConfirmed.addEventListener('change', function () { renderCoverage(); updateLetter(); });
  el.verifyBtn.addEventListener('click', async function () {
    if (!state.result || !state.result.references.length) { status('Tidak ada referensi untuk diperiksa.', 'err', el.refStatus); return; }
    var r = state.result, epoch = ++state.epoch; busy(true); state.controller = new AbortController(); el.progress.hidden = false; el.progress.max = r.references.length; el.progress.value = 0; status('Mencocokkan metadata seluruh referensi melalui Crossref…', 'info', el.refStatus);
    try {
      var verification = await E.verifyReferences(r, { signal: state.controller.signal, onProgress: function (n, total) { if (epoch === state.epoch) { el.progress.value = n; status(n + '/' + total + ' referensi diperiksa. Kegagalan tidak dianggap sebagai verifikasi.', 'info', el.refStatus); } } });
      if (epoch !== state.epoch) return;
      r.verification = verification; invalidateSemantic('Metadata terbaru tersedia. Gunakan metadata ini untuk tinjauan relevansi sumber.'); renderReferences(); renderIssues(); renderCoverage(); renderElements(); updateLetter();
      var completed = verification.filter(function (v) { return v.checked; }).length; status('Selesai: ' + completed + '/' + verification.length + ' referensi menghasilkan pemeriksaan metadata; lihat status masing-masing entri.', 'ok', el.refStatus);
    } catch (err) { if (epoch === state.epoch) status(err.message, 'err', el.refStatus); }
    finally { if (epoch === state.epoch) { busy(false); updateLetter(); } }
  });
  function download(blob, name) { var url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 30000); }
  function fileBase() { return 'Manuscript-' + E.normalize(el.manuscriptId.value).replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 120); }
  el.promptBtn.addEventListener('click', function () { if (state.result) { download(new Blob([AI.prompt(state.result, el.authorNames.value)], { type: 'text/plain;charset=utf-8' }), fileBase() + '-Editorial-Review-Prompt.txt'); status('Prompt berisi seluruh teks naskah. Hasil review perlu diimpor sebagai JSON dan diperiksa terhadap bukti.', 'info', el.semanticStatus); } });
  el.importBtn.addEventListener('click', function () { el.reviewInput.value = ''; el.reviewInput.click(); });
  function applyReview(payload) {
    var accepted = E.acceptSemantic(payload, state.result);
    state.result.issues = state.result.issues.filter(function (it) { return it.source !== 'ai'; }).concat(accepted.issues); state.result.semantic = accepted.semantic; el.editorConfirmed.checked = false;
    renderIssues(); renderElements(); renderCoverage(); updateLetter(); status('Review mencakup semua ' + accepted.semantic.reviewedIds.length + ' ID paragraf. ' + accepted.issues.length + ' temuan menunggu konfirmasi editor; kesesuaian kutipan bukan jaminan ketepatan penilaian.', 'ok', el.semanticStatus);
  }
  el.reviewInput.addEventListener('change', async function () {
    var file = el.reviewInput.files[0], r = state.result; if (!file || !r) return;
    try { if (file.size > 5 * 1024 * 1024) throw new Error('JSON review maksimum 5 MB.'); var payload = AI.parseResponse(await file.text()); if (r !== state.result) throw new Error('Naskah berubah sebelum impor selesai.'); applyReview(payload); } catch (err) { status('Review ditolak: ' + err.message, 'err', el.semanticStatus); }
  });
  el.aiBtn.addEventListener('click', async function () {
    if (!state.result) return;
    var r = state.result, epoch = ++state.epoch; busy(true); state.controller = new AbortController(); status('Mengirim seluruh teks ke layanan editor dan menunggu review. Naskah tidak dipotong.', 'info', el.semanticStatus);
    var token = el.aiToken.value; el.aiToken.value = '';
    try { var payload = await AI.review(r, { endpoint: el.aiEndpoint.value.trim(), model: el.aiModel.value.trim(), sessionToken: token, authorNames: el.authorNames.value, signal: state.controller.signal }); if (epoch === state.epoch) applyReview(payload); }
    catch (err) { if (epoch === state.epoch) status('Review tidak diterapkan: ' + err.message, 'err', el.semanticStatus); }
    finally { token = ''; if (epoch === state.epoch) { busy(false); updateLetter(); } }
  });
  el.issueParagraph.addEventListener('change', function () { var r = state.result && state.result.zones.records.find(function (p) { return p.id === el.issueParagraph.value; }); el.issueQuote.value = r ? r.text : ''; });
  el.addIssueBtn.addEventListener('click', function () {
    if (!state.result) return;
    try { var issue = E.validateIssue({ section: Number(el.issueSection.value), comment: el.issueComment.value, evidence: [{ paragraphId: el.issueParagraph.value, quote: el.issueQuote.value }], source: 'editor' }, state.result); issue.id = 'editor-' + Date.now() + '-' + state.result.issues.length; issue.selected = true; state.result.issues.push(issue); el.editorConfirmed.checked = false; el.issueComment.value = ''; renderIssues(); renderCoverage(); updateLetter(); status('Temuan ditambahkan dengan bukti yang cocok.', 'ok', el.manualStatus); }
    catch (err) { status(err.message, 'err', el.manualStatus); }
  });
  el.pdfBtn.addEventListener('click', function () { if (!state.result) return; updateLetter(); var old = document.title; document.title = fileBase() + '-Editorial-Note' + (el.editorConfirmed.checked ? '' : '-DRAFT'); window.addEventListener('afterprint', function restore() { document.title = old; window.removeEventListener('afterprint', restore); }); window.print(); });
  el.wordBtn.addEventListener('click', async function () {
    if (!state.result || !state.file) return;
    updateLetter(); var epoch = ++state.epoch, r = state.result, letter = state.letter; busy(true); status('Membuat salinan Word dengan komentar, mempertahankan teks dan komentar lama…', 'info', el.exportStatus);
    try {
      var exported = await D.annotatedBlob(state.file, r, letter, { highlight: el.highlightWord.checked });
      if (epoch !== state.epoch) return;
      download(exported.blob, fileBase() + '-Editorial-Comments' + (el.editorConfirmed.checked ? '' : '-DRAFT') + '.docx');
      status('Word siap: ' + exported.commentCount + ' komentar editorial baru. Catatan lengkap berada pada komentar pertama; temuan berlokasi pada paragraf bukti.' + (exported.fallbackCount ? ' ' + exported.fallbackCount + ' temuan pada catatan/header/footer dijelaskan dalam komentar tingkat dokumen.' : ''), 'ok', el.exportStatus);
    } catch (err) { if (epoch === state.epoch) status('Ekspor Word dibatalkan: ' + err.message, 'err', el.exportStatus); }
    finally { if (epoch === state.epoch) { busy(false); updateLetter(); } }
  });
  busy(false);
})();
