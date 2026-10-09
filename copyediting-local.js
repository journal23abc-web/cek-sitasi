(function () {
  'use strict';
  var E = window.CopyeditingEngine, D = window.CopyeditingDocx;
  var BUILD = '20261009-local3';
  var bootStatus = document.getElementById('statusMsg');
  if (!E || !D || E.BUILD !== BUILD || D.BUILD !== BUILD || typeof window.JSZip === 'undefined') {
    bootStatus.textContent = 'File aplikasi belum lengkap atau versinya berbeda. Unggah semua file dari ZIP Lokal v3 ke lokasi yang sama, lalu buka ulang halaman.';
    bootStatus.className = 'status err';
    return;
  }
  // Start in Indonesian even if the browser restores an old form value.
  document.getElementById('reportLanguage').value = 'id';
  var ids = ['fileInput','dropzone','fileLabel','fileMeta','manuscriptId','reportLanguage','abstractMax','referenceMin','manuscriptMax','includeExtra','rulesSummary','auditBtn','resetRulesBtn','removeBtn','cancelBtn','statusMsg','progress','results','metrics','coverage','warnings','abstractStart','abstractEnd','referenceStart','applyBoundariesBtn','abstractPreview','fullText','verifyBtn','refStatus','referenceSummary','referenceList','issuesSummary','issueSection','issueParagraph','issueQuote','issueTitle','issueComment','issueAction','issueAltTitle','issueAltProblem','issueAltAction','manualLanguageLabel','alternativeLabel','addIssueBtn','manualStatus','issueList','editorConfirmed','highlightWord','pdfBtn','wordBtn','exportStatus','reportPage','letterMode','boundaryDetails'];
  var el = {}; ids.forEach(function (id) { el[id] = document.getElementById(id); });
  var state = { file:null, doc:null, result:null, epoch:0, busy:false, controller:null, overrides:{}, localSelection:false, formLanguage:'id', createdAt:null };
  var RULE_KEY = 'copyeditingJournalRules_v1';
  var resultButtons = ['verifyBtn','applyBoundariesBtn','wordBtn','pdfBtn','addIssueBtn'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function short(s, length) { s = E.normalize(s); return s.length > length ? s.slice(0,length - 1) + '…' : s; }
  function lang() { return el.reportLanguage.value === 'en' ? 'en' : 'id'; }
  function status(message, tone, target) { target = target || el.statusMsg; target.textContent = message; target.className = 'status ' + (tone || 'info'); }
  function rules() { return E.settings({abstractMax:el.abstractMax.value,referenceMin:el.referenceMin.value,manuscriptMax:el.manuscriptMax.value}); }
  function saveRules(r) { try { localStorage.setItem(RULE_KEY,JSON.stringify(r)); } catch (err) {} }
  function updateRuleSummary() { el.rulesSummary.textContent = 'Aturan jurnal: ' + el.abstractMax.value + ' kata abstrak · ' + el.referenceMin.value + ' referensi · ' + Number(el.manuscriptMax.value).toLocaleString('id-ID') + ' kata naskah'; }
  try { var saved = E.settings(JSON.parse(localStorage.getItem(RULE_KEY) || '{}')); ['abstractMax','referenceMin','manuscriptMax'].forEach(function (k) { el[k].value = saved[k]; }); } catch (err) {}
  updateRuleSummary();
  function busy(on) {
    state.busy = on; el.cancelBtn.hidden = !on; el.dropzone.disabled = on; el.fileInput.disabled = on;
    el.auditBtn.disabled = on || !state.file; el.removeBtn.disabled = on || !state.file; el.resetRulesBtn.disabled = on;
    resultButtons.forEach(function (id) { el[id].disabled = on || !state.result; });
    ['abstractMax','referenceMin','manuscriptMax','manuscriptId','reportLanguage','includeExtra','editorConfirmed','highlightWord'].forEach(function (id) { el[id].disabled = on; });
    el.results.querySelectorAll('input,select,textarea,[data-ref-save]').forEach(function (input) { input.disabled = on; });
    if (!on) { el.progress.hidden = true; state.controller = null; updateReport(); }
  }
  function clearResult() {
    if (state.controller) state.controller.abort(); state.epoch++; state.result = null; state.doc = null; state.overrides = {}; el.results.hidden = true; el.editorConfirmed.checked = false; busy(false);
  }
  function setFile(file, local) {
    if (!file) return;
    if (!/\.docx$/i.test(file.name) || file.size > 25 * 1024 * 1024) { status('Pilih file .docx dengan ukuran maksimum 25 MB.','err'); return; }
    if (local) state.localSelection = true;
    clearResult(); state.file = file; el.fileLabel.textContent = file.name; el.fileMeta.textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB - siap diperiksa';
    var explicitId = file.name.match(/\b(?:ID|Manuscript)[ _:-]*(\d[\w-]*)/i);
    if (!E.normalize(el.manuscriptId.value) && explicitId) el.manuscriptId.value = explicitId[1];
    busy(false); status('File siap. Pastikan ID naskah benar, lalu klik Periksa Naskah.');
  }
  el.dropzone.addEventListener('click',function () { el.fileInput.click(); });
  el.fileInput.addEventListener('change',function () { setFile(el.fileInput.files[0],true); });
  el.dropzone.addEventListener('dragover',function (event) { event.preventDefault(); el.dropzone.classList.add('drag'); });
  el.dropzone.addEventListener('dragleave',function () { el.dropzone.classList.remove('drag'); });
  el.dropzone.addEventListener('drop',function (event) { event.preventDefault(); el.dropzone.classList.remove('drag'); if (!state.busy) setFile(event.dataTransfer.files[0],true); });
  el.removeBtn.addEventListener('click',function () {
    clearResult(); state.file = null; state.localSelection = true; el.fileInput.value = ''; el.fileLabel.textContent = 'Klik atau seret file .docx ke sini'; el.fileMeta.textContent = 'Maks. 25 MB.';
    if (window.SharedFile) window.SharedFile.clear().catch(function () {}); busy(false); status('File dihapus dari sesi ini.');
  });
  if (window.SharedFile) window.SharedFile.load().then(function (savedFile) { if (!state.localSelection && savedFile && savedFile.file) setFile(savedFile.file,false); }).catch(function () {});
  el.cancelBtn.addEventListener('click',function () { if (state.controller) state.controller.abort(); state.epoch++; busy(false); status('Proses dibatalkan. Hasil yang belum selesai tidak diterapkan.'); });
  el.resetRulesBtn.addEventListener('click',function () {
    ['abstractMax','referenceMin','manuscriptMax'].forEach(function (k) { el[k].value = E.DEFAULTS[k]; }); el.includeExtra.checked = true; saveRules(rules()); updateRuleSummary(); if (state.result) clearResult(); status('Aturan kembali ke default. Klik Periksa Naskah untuk menerapkannya.');
  });
  ['abstractMax','referenceMin','manuscriptMax','includeExtra'].forEach(function (key) { el[key].addEventListener('change',function () {
    try { saveRules(rules()); updateRuleSummary(); if (state.result) clearResult(); status('Aturan hitungan berubah. Klik Periksa Naskah untuk memperbarui hasil.'); } catch (err) { status(err.message,'err'); }
  }); });
  el.manuscriptId.addEventListener('input',function () { el.editorConfirmed.checked = false; updateReport(); });
  function fillSelect(select, records, blank, selected) {
    select.replaceChildren(); var first = document.createElement('option'); first.value = ''; first.textContent = blank; select.appendChild(first);
    records.forEach(function (r) { var opt = document.createElement('option'); opt.value = r.id; opt.textContent = 'Paragraf ' + (state.result.zones.records.indexOf(r) + 1) + ': ' + short(r.text,75); select.appendChild(opt); }); select.value = selected || '';
  }
  function renderBoundaries() {
    var r = state.result, main = r.zones.main.filter(function (p) { return ['body','textbox','table'].includes(p.kind); });
    var first = r.zones.abstractRecords[0], last = r.zones.abstractRecords[r.zones.abstractRecords.length - 1];
    var refHeading = r.zones.main.find(function (p) { return p.section === 'references' && !r.zones.referenceRecords.includes(p); });
    fillSelect(el.abstractStart,main,'Deteksi otomatis',first && first.id); fillSelect(el.abstractEnd,main,'Deteksi otomatis',r.zones.abstractBounded && last ? last.id : ''); fillSelect(el.referenceStart,main,'Deteksi otomatis',refHeading && refHeading.id);
    fillSelect(el.issueParagraph,r.zones.records,'Pilih paragraf',''); el.issueQuote.value = '';
    el.abstractPreview.textContent = r.zones.abstractText || 'Belum terdeteksi. Tentukan awal dan akhir abstrak.'; el.fullText.textContent = r.doc.fullText;
    el.boundaryDetails.open = !!(r.abstractUncertain || !r.zones.referenceFound);
  }
  async function runAudit(useDoc) {
    if (!state.file) return;
    if (!E.normalize(el.manuscriptId.value)) { status('Isi ID naskah terlebih dahulu.','err'); el.manuscriptId.focus(); return; }
    if (typeof JSZip === 'undefined') { status('Pembaca Word belum dimuat. Periksa koneksi dan muat ulang halaman.','err'); return; }
    var journalRules; try { journalRules = rules(); } catch (err) { status(err.message,'err'); return; }
    var epoch = ++state.epoch; busy(true); status('Membaca dan memeriksa naskah…');
    try {
      var doc = useDoc && state.doc ? state.doc : await D.read(state.file); if (epoch !== state.epoch) return;
      await new Promise(function (resolve) { requestAnimationFrame(function () { resolve(); }); });
      var result = E.audit(doc,{rules:journalRules,overrides:state.overrides,countOptions:{includeExtra:el.includeExtra.checked}}); if (epoch !== state.epoch) return;
      state.doc = doc; state.result = result; state.createdAt = new Date().toISOString(); el.editorConfirmed.checked = false; el.results.hidden = false;
      status('','info',el.refStatus); status('','info',el.manualStatus); status('','info',el.exportStatus);
      renderAll(); saveRules(journalRules); status('Pemeriksaan selesai. Laporan siap diunduh.','ok');
    } catch (err) { if (epoch === state.epoch) status('Pemeriksaan gagal: ' + err.message,'err'); }
    finally { if (epoch === state.epoch) busy(false); }
  }
  el.auditBtn.addEventListener('click',function () { state.overrides = {}; runAudit(false); });
  el.applyBoundariesBtn.addEventListener('click',function () { state.overrides = {abstractStartId:el.abstractStart.value,abstractEndId:el.abstractEnd.value,referenceStartId:el.referenceStart.value}; runAudit(true); });
  function renderMetrics() {
    var r = state.result, facts = [[r.manuscriptWords.toLocaleString('id-ID'),'Kata naskah (perkiraan) / batas ' + r.rules.manuscriptMax.toLocaleString('id-ID')],[r.abstractUncertain ? 'Perlu cek' : r.abstractWords,'Kata abstrak / batas ' + r.rules.abstractMax],[r.zones.referenceFound ? r.references.length : 'Perlu cek','Referensi / minimum ' + r.rules.referenceMin],[r.sync.occurrences,'Kemunculan sitasi']];
    el.metrics.innerHTML = facts.map(function (f) { return '<div class="metric"><b>' + esc(f[0]) + '</b><span>' + esc(f[1]) + '</span></div>'; }).join('');
  }
  function renderCoverage() {
    if (!state.result) return;
    var r = state.result, selected = E.report(r,{manuscriptId:E.normalize(el.manuscriptId.value) || '-',language:lang()}).groups.reduce(function (n,g) { return n + g.items.length; },0);
    el.coverage.textContent = r.zones.records.length + ' paragraf dibaca. ' + selected + ' temuan disertakan; temuan yang belum pasti diberi label “Perlu ditinjau”. Metode, etik, mutu bahasa, dan relevansi sumber tetap memerlukan editor.';
    if (r.doc.wordStatistics && r.doc.wordStatistics.isMicrosoftWord) el.coverage.textContent += ' Statistik tersimpan Microsoft Word: ' + r.doc.wordStatistics.savedWords.toLocaleString('id-ID') + ' kata (dapat belum diperbarui).';
    var warnings = (r.doc.warnings || []).slice();
    if (r.abstractUncertain) warnings.push('Batas abstrak belum pasti. Perbaiki pembacaan melalui menu di bawah.');
    if (!r.zones.referenceFound) warnings.push('Daftar referensi belum terdeteksi. Pilih heading sebelum referensi melalui menu di bawah.');
    if (r.sync.unresolvedReferences.length) warnings.push(r.sync.unresolvedReferences.length + ' referensi belum terbaca atau belum berpasangan secara unik.');
    el.warnings.replaceChildren(); warnings.forEach(function (w) { var li = document.createElement('li'); li.textContent = w; el.warnings.appendChild(li); }); el.warnings.hidden = !warnings.length;
  }
  function renderIssues() {
    var r = state.result, names = lang() === 'en' ? E.SECTIONS : E.SECTIONS_ID, t = E.LABELS[lang()], html = '', number = 0;
    names.forEach(function (name,i) {
      var items = r.issues.filter(function (it) { return it.section === i + 1; }); if (!items.length) return;
      html += '<h3>' + esc(name) + '</h3>';
      items.forEach(function (issue) {
        var view = E.displayIssue(issue,r,lang());
        html += '<div class="issue"><input type="checkbox" data-issue="' + esc(issue.id) + '" aria-label="Sertakan temuan ini" ' + (issue.selected ? 'checked' : '') + '><div><h4>' + (++number) + '. ' + esc(view.title) + '</h4><span class="pill">' + esc(issue.review ? t.review : t.confirmed) + '</span><p>' + esc(view.problem) + '</p>';
        if (view.action) html += '<p><b>' + esc(t.action) + ':</b> ' + esc(view.action) + '</p>';
        if (view.correction) html += '<p><b>' + esc(t.correction) + ':</b> ' + esc(view.correction) + '</p>';
        if (view.untranslated) html += '<p>' + esc(t.translation) + '</p>';
        (issue.evidence || []).slice(0,3).forEach(function (e) { html += '<blockquote>' + esc(short(e.quote,500)) + '</blockquote>'; }); html += '</div></div>';
      });
    });
    el.issuesSummary.textContent = 'Sesuaikan temuan dalam laporan (' + r.issues.length + ')';
    el.issueList.innerHTML = html || '<p class="empty">Tidak ada temuan otomatis yang memerlukan koreksi.</p>';
    el.issueList.querySelectorAll('[data-issue]').forEach(function (checkbox) { checkbox.addEventListener('change',function () {
      var issue = r.issues.find(function (it) { return it.id === checkbox.dataset.issue; }); issue.selected = checkbox.checked; el.editorConfirmed.checked = false; renderCoverage(); updateReport();
    }); });
  }
  function renderReferences() {
    var r = state.result, html = '';
    el.referenceSummary.textContent = 'Lihat status ' + r.references.length + ' referensi';
    r.references.forEach(function (ref,i) {
      var v = r.verification[i], good = ['metadata_verified','editor_verified','verified_no_doi'].includes(v.status);
      html += '<div class="ref"><p><b>' + esc(ref.id) + '</b> ' + esc(ref.raw) + '</p><p class="ref-status' + (good ? ' good' : '') + '">' + esc((E.STATUSES[v.status] || E.STATUSES.unverified).id) + '</p><p>' + esc(E.reasonText(v,'id')) + '</p>';
      if (v.sourceUrl) html += '<p><a href="' + esc(v.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(v.sourceUrl) + '</a></p>';
      (v.differences || []).forEach(function (d) { html += '<p><b>' + esc(E.fieldName(d.field,'id')) + ':</b> naskah “' + esc(d.provided) + '”; sumber “' + esc(d.official) + '”.</p>'; });
      if ((v.missingFields || []).length) html += '<p>Belum dibandingkan: ' + esc(v.missingFields.map(function (f) { return E.fieldName(f,'id'); }).join(', ')) + '.</p>';
      html += '<details><summary>Catat pemeriksaan editor (opsional)</summary><div><div class="grid"><label class="field">Status sumber<select data-ref-status="' + i + '"><option value="unverified">Belum terverifikasi</option><option value="editor_verified">Sumber dan metadata cocok</option><option value="verified_no_doi">Sumber nyata tanpa DOI</option></select></label><label class="field">URL resmi yang telah diperiksa<input type="url" data-ref-url="' + i + '" value="' + esc(v.sourceUrl || '') + '" placeholder="https://..."></label></div><label class="field wide">Bukti pemeriksaan / alasan tanpa DOI<input type="text" data-ref-reason="' + i + '" value="' + esc(v.lookup === 'editor' ? v.reason : '') + '" placeholder="Tulis sesuai bahasa laporan"></label><div class="actions"><button class="ghost" type="button" data-ref-save="' + i + '">Simpan Konfirmasi</button></div><p data-ref-error="' + i + '" class="error-box" role="status"></p></div></details></div>';
    });
    el.referenceList.innerHTML = html || '<p class="empty">Referensi belum terdeteksi.</p>';
    el.referenceList.querySelectorAll('[data-ref-status]').forEach(function (select) { var v = r.verification[Number(select.dataset.refStatus)]; if (v.lookup === 'editor') select.value = v.status; });
    el.referenceList.querySelectorAll('[data-ref-save]').forEach(function (button) { button.addEventListener('click',function () {
      var i = Number(button.dataset.refSave), select = el.referenceList.querySelector('[data-ref-status="' + i + '"]'), urlInput = el.referenceList.querySelector('[data-ref-url="' + i + '"]'), reasonInput = el.referenceList.querySelector('[data-ref-reason="' + i + '"]'), error = el.referenceList.querySelector('[data-ref-error="' + i + '"]');
      try {
        var url = urlInput.value.trim(), reason = E.normalize(reasonInput.value), chosen = select.value;
        if (url) { var sourceURL = new URL(url); if (sourceURL.protocol !== 'https:' || sourceURL.username || sourceURL.password) throw new Error('Gunakan URL HTTPS dari sumber resmi.'); }
        if (chosen !== 'unverified') {
          var parsed = new URL(url);
          if (parsed.protocol !== 'https:' || parsed.username || parsed.password || /(^|\.)(?:researchgate\.net|scholar\.google\.[a-z.]+)$/i.test(parsed.hostname) || !reason) throw new Error('Isi URL HTTPS dari sumber resmi yang telah diperiksa dan bukti atau alasan keputusan Anda.');
        }
        var ref = r.references[i], doi = chosen === 'editor_verified' ? (window.CitationEngine.extractDOI(url) || ref.doi || '') : '';
        r.verification[i] = {refId:ref.id,status:chosen,checked:chosen !== 'unverified',checkedAt:new Date().toISOString(),sourceUrl:url,reason:reason,reasonLanguage:lang(),fields:[],differences:[],missingFields:[],doi:doi,identityMatches:chosen === 'editor_verified',lookup:'editor'};
        el.editorConfirmed.checked = false; renderReferences(); renderCoverage(); updateReport();
      } catch (err) { error.textContent = err.message; }
    }); });
  }
  function currentReport() { return E.report(state.result,{manuscriptId:el.manuscriptId.value,language:lang(),editorConfirmed:el.editorConfirmed.checked,createdAt:state.createdAt}); }
  function updateReport() {
    if (!state.result) return;
    var hasId = !!E.normalize(el.manuscriptId.value); el.pdfBtn.disabled = state.busy || !hasId; el.wordBtn.disabled = state.busy || !hasId;
    if (!hasId) { el.reportPage.textContent = 'Isi ID naskah untuk menampilkan laporan.'; return; }
    var report = currentReport(); state.report = report; state.letter = E.reportText(report); el.reportPage.innerHTML = E.renderReport(report); el.reportPage.lang = report.language; el.letterMode.textContent = report.language === 'id' ? 'Bahasa Indonesia' : 'English';
    status(report.hasUntranslated ? 'Sebagian komentar editor belum memiliki terjemahan. Versi asli diberi label pada laporan.' : '', 'info', document.getElementById('translationStatus'));
  }
  function renderAll() { renderBoundaries(); renderMetrics(); renderCoverage(); renderIssues(); renderReferences(); updateReport(); }
  function updateManualLanguage(swap) {
    var next = lang();
    if (swap && next !== state.formLanguage) [['issueTitle','issueAltTitle'],['issueComment','issueAltProblem'],['issueAction','issueAltAction']].forEach(function (ids) { var tmp = el[ids[0]].value; el[ids[0]].value = el[ids[1]].value; el[ids[1]].value = tmp; });
    state.formLanguage = next;
    el.manualLanguageLabel.textContent = next === 'id' ? 'Komentar akan ditulis dalam bahasa Indonesia.' : 'Tulis komentar dalam bahasa Inggris sesuai bahasa laporan.';
    el.alternativeLabel.textContent = next === 'id' ? 'Versi bahasa Inggris untuk komentar ini (opsional)' : 'Versi bahasa Indonesia untuk komentar ini (opsional)';
    var selected = el.issueSection.value || '1'; el.issueSection.innerHTML = (next === 'id' ? E.SECTIONS_ID : E.SECTIONS).map(function (s,i) { return '<option value="' + (i + 1) + '">' + esc(s) + '</option>'; }).join(''); el.issueSection.value = selected;
  }
  el.reportLanguage.addEventListener('change',function () { updateManualLanguage(true); if (state.result) { renderIssues(); updateReport(); } });
  updateManualLanguage(false);
  el.editorConfirmed.addEventListener('change',function () { renderCoverage(); updateReport(); });
  el.verifyBtn.addEventListener('click',async function () {
    if (!state.result) return;
    if (!state.result.references.length) { status('Referensi belum terdeteksi. Perbaiki pembacaan terlebih dahulu.','err',el.refStatus); return; }
    var epoch = ++state.epoch, r = state.result; busy(true); state.controller = new AbortController(); el.progress.hidden = false; el.progress.max = r.references.length; el.progress.value = 0;
    status('Memeriksa metadata referensi melalui Crossref…','info',el.refStatus);
    try {
      var verified = await E.verifyReferences(r,{signal:state.controller.signal,onProgress:function (done,total) { if (epoch === state.epoch) { el.progress.value = done; status('Memeriksa referensi ' + done + ' dari ' + total + '…','info',el.refStatus); } }});
      if (epoch !== state.epoch) return;
      r.verification = verified; el.editorConfirmed.checked = false; renderReferences(); renderCoverage(); updateReport();
      var matched = verified.filter(function (v) { return v.status === 'metadata_verified'; }).length;
      status('Selesai: ' + matched + ' dari ' + verified.length + ' referensi cocok pada seluruh bidang yang diperiksa. Lihat status lainnya di bawah.','ok',el.refStatus);
    } catch (err) { if (epoch === state.epoch) status('Pemeriksaan belum selesai: ' + err.message,'err',el.refStatus); }
    finally { if (epoch === state.epoch) busy(false); }
  });
  el.issueParagraph.addEventListener('change',function () { var r = state.result && state.result.zones.records.find(function (p) { return p.id === el.issueParagraph.value; }); el.issueQuote.value = r ? r.text : ''; });
  el.addIssueBtn.addEventListener('click',function () {
    if (!state.result) return;
    try {
      if (!E.normalize(el.issueAction.value)) throw new Error('Isi tindakan perbaikan agar komentar dapat ditindaklanjuti.');
      var chosen = lang(), other = chosen === 'id' ? 'en' : 'id', texts = {};
      texts[chosen] = {title:E.normalize(el.issueTitle.value) || (chosen === 'id' ? 'Temuan editor' : 'Editor’s finding'),problem:E.normalize(el.issueComment.value),action:E.normalize(el.issueAction.value)};
      if (E.normalize(el.issueAltProblem.value) || E.normalize(el.issueAltAction.value)) {
        if (!E.normalize(el.issueAltProblem.value) || !E.normalize(el.issueAltAction.value)) throw new Error('Lengkapi masalah dan tindakan dalam versi alternatif, atau kosongkan keduanya.');
        texts[other] = {title:E.normalize(el.issueAltTitle.value) || (other === 'id' ? 'Temuan editor' : 'Editor’s finding'),problem:E.normalize(el.issueAltProblem.value),action:E.normalize(el.issueAltAction.value)};
      }
      var issue = E.validateIssue({section:Number(el.issueSection.value),comment:el.issueComment.value + ' ' + el.issueAction.value,texts:texts,commentLanguage:chosen,evidence:[{paragraphId:el.issueParagraph.value,quote:el.issueQuote.value}],source:'editor'},state.result);
      if (!texts[chosen].problem) throw new Error('Isi masalah yang ditemukan.');
      // Validate the optional translation as well; a different language cannot introduce an unchecked DOI.
      if (texts[other]) E.validateIssue(Object.assign({},issue,{comment:texts[other].problem + ' ' + texts[other].action}),state.result);
      issue.id = 'editor-' + Date.now() + '-' + state.result.issues.length; state.result.issues.push(issue); el.editorConfirmed.checked = false;
      ['issueTitle','issueComment','issueAction','issueAltTitle','issueAltProblem','issueAltAction'].forEach(function (id) { el[id].value = ''; }); renderIssues(); renderCoverage(); updateReport(); status('Komentar ditambahkan pada laporan dan paragraf Word yang sesuai.','ok',el.manualStatus);
    } catch (err) { status(err.message,'err',el.manualStatus); }
  });
  function fileBase() { return 'Manuscript-' + E.normalize(el.manuscriptId.value).replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,90); }
  function download(blob,name) { var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); },1000); }
  el.pdfBtn.addEventListener('click',function () {
    if (!state.result) return; updateReport(); var old = document.title; document.title = fileBase() + '-' + (lang() === 'id' ? 'Laporan-Editorial-Lokal-v3-ID' : 'Editorial-Report-Local-v3-EN');
    window.addEventListener('afterprint',function restore() { document.title = old; window.removeEventListener('afterprint',restore); }); window.print();
  });
  el.wordBtn.addEventListener('click',async function () {
    if (!state.result || !state.file) return;
    updateReport(); var epoch = ++state.epoch, r = state.result, report = state.report, letter = state.letter; busy(true); status('Membuat salinan Word dengan komentar…','info',el.exportStatus);
    try {
      var output = await D.annotatedBlob(state.file,r,letter,{highlight:el.highlightWord.checked,report:report}); if (epoch !== state.epoch) return;
      download(output.blob,fileBase() + '-' + (report.language === 'id' ? 'Komentar-Editorial-Lokal-v3-ID' : 'Editorial-Comments-Local-v3-EN') + '.docx');
      status('Word siap: ' + output.commentCount + ' komentar baru. Ringkasan laporan ada pada komentar pertama; temuan lainnya ditautkan ke paragraf yang sesuai.','ok',el.exportStatus);
    } catch (err) { if (epoch === state.epoch) status('Ekspor Word gagal: ' + err.message,'err',el.exportStatus); }
    finally { if (epoch === state.epoch) busy(false); }
  });
  busy(false);
})();
