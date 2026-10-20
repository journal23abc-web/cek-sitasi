/* ============================================================
   TASK PANE UI — Cek Sitasi untuk Word
   Validator (saran ala Paperpal) · Tautan · Konversi APA 7 ↔ IEEE · cek online CrossRef
   ============================================================ */
(function () {
  'use strict';
  var AC = window.AddinCore;
  var WB = window.WordBridge;
  var CM = window.CitationManagers;
  var RC = window.ReportCore;
  var $ = function (id) { return document.getElementById(id); };

  var CAT_LABEL = { citation: 'Sitasi', reference: 'Referensi', match: 'Kecocokan', online: 'Online', consistency: 'Dokumen' };
  var STYLE_NAME = { apa7: 'APA 7', ieee: 'IEEE' };

  var state = {
    paras: null, st: null, styleId: null, detect: null, result: null,
    suggestions: [], online: {}, onlineRun: 0, onlineTotal: 0, onlineDone: 0,
    filter: 'all', openId: null, busy: false, pending: false, lastHash: null,
    annMap: {}, annIds: [], suppressUntil: 0, convPlan: null, convSnapshot: null, linkPlan: null,
    metaFilter: 'all', scopusDb: null, scopusLoading: false, scopus: null,
    managedScan: null, managedAt: 0, managedCount: -1, managed: null, report: null, lastReportBase64: null
  };

  // ---------- pengaturan (tersimpan per perangkat) ----------
  var SETTINGS_KEY = 'cekSitasi.settings.v1';
  var settings = { auto: true, underline: true, online: true, track: false, years: 10, scopus: false, linkMode: '', reportMode: '', reportHl: true };
  try { var saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); Object.keys(saved).forEach(function (k) { settings[k] = saved[k]; }); } catch (e) { /* storage tidak tersedia */ }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* abaikan */ } }
  var DISMISS_KEY = 'cekSitasi.dismissed.v1';
  var dismissed = new Set();
  try { (JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')).forEach(function (k) { dismissed.add(k); }); } catch (e) { /* abaikan */ }
  function saveDismissed() { try { localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(dismissed).slice(-500))); } catch (e) { /* abaikan */ } }

  // ---------- util ----------
  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; }
  function setStatus(msg, kind) {
    var el = $('status');
    el.className = 'status' + (kind === 'err' ? ' err' : '');
    el.innerHTML = (kind === 'busy' ? '<span class="spin"></span>' : '') + esc(msg || '');
  }
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function hashParas(paras) {
    var h = 0, s = paras.map(function (p) { return p.text; }).join('\u0001');
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return h + ':' + s.length;
  }
  function snapshotOf(indexes) {
    var snap = {};
    indexes.forEach(function (i) { if (state.paras[i]) snap[i] = state.paras[i].text; });
    return snap;
  }
  function errMsg(e) { return (e && (e.message || e.debugInfo && e.debugInfo.message)) || String(e); }

  // ---------- tab ----------
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(function (b) {
      var on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    ['validator', 'link', 'meta', 'convert', 'report'].forEach(function (n) { $('tab-' + n).hidden = n !== name; });
    if (name === 'convert') syncConvertTab();
    if (name === 'report') renderReportCounts();
    if (name === 'meta') { renderMeta(); if (settings.scopus) loadScopus(); }
  }

  // ================= PEMERIKSAAN =================
  function runCheck(opts) {
    var o = opts || {};
    if (state.busy) { state.pending = true; return Promise.resolve(); }
    state.busy = true;
    if (!o.silent) setStatus('Memeriksa dokumen…', 'busy');
    return WB.readParagraphs().then(function (paras) {
      var hash = hashParas(paras);
      if (!o.force && hash === state.lastHash) { if (!o.silent) setStatus(statusLine()); return; }
      state.lastHash = hash;
      state.paras = paras;
      return refreshManaged(paras, o.force).then(function () { return analyse(paras); });
    }).catch(function (e) {
      setStatus('Gagal membaca dokumen: ' + errMsg(e), 'err');
    }).then(function () {
      state.busy = false;
      if (state.pending) { state.pending = false; runCheck({ silent: true }); }
    });

    function analyse(paras) {
      // Kode field Zotero/Mendeley yang sedang ditampilkan (Alt+F9) tidak ikut dibaca.
      var masked = CM ? paras.map(function (p) { var t = CM.maskFieldCodes(p.text); return t === p.text ? p : Object.assign({}, p, { text: t }); }) : paras;
      state.st = AC.structure(masked);
      state.detect = AC.detectStyle(state.st);
      var sel = $('styleSel').value;
      state.styleId = sel === 'auto' ? state.detect.styleId : sel;
      state.result = AC.validate(state.st, state.styleId);
      state.suggestions = state.result.suggestions.slice();
      renderBadge();
      return WB.checkItalics(state.result.italicPlan).then(function (bad) {
        bad.forEach(function (b) {
          var r = state.st.refs[b.refIndex];
          state.suggestions.push({
            id: 'it' + b.refIndex, key: 'italic§' + AC.norm(r.line).slice(0, 200), kind: 'italic', category: 'reference', severity: 'suggestion',
            title: 'Cetak miring belum sesuai ' + STYLE_NAME[state.styleId],
            description: 'Bagian berikut seharusnya dicetak miring: ' + b.segments.map(function (g) { return g.text; }).join('; ') + '.',
            paraIndex: r.paraIndex, offset: r.leading, length: Math.max(1, r.text.trim().length), refIndex: b.refIndex,
            segments: b.segments, original: r.line, canApply: true, actionLabel: 'Cetak miring'
          });
        });
      }).catch(function () { /* versi Word lama: lewati cek cetak miring */ }).then(function () {
        if (CM) state.suggestions = CM.protectSuggestions(state.suggestions, state.managed, state.st);
        renderAll();
        if (!o.silent) setStatus(statusLine());
        if (settings.underline) refreshAnnotations();
        runOnline();
        if (state.scopusDb) state.scopus = AC.scopusStatuses(state.result.references, state.scopusDb);
        if (!$('tab-report').hidden) renderReportCounts();
      });
    }
  }

  // ---------- Zotero / Mendeley / EndNote ----------
  // Pindaian OOXML diulang bila diminta, bila jumlah paragraf berubah, atau setelah 30 detik;
  // di antaranya hasil pindaian lama dipetakan ulang ke paragraf lewat teksnya.
  function refreshManaged(paras, force) {
    if (!CM) return Promise.resolve();
    // Dokumen besar (banyak gambar) membuat pindaian lambat → jarak pindai otomatis diperpanjang.
    var every = state.managedCost > 1500 ? 120000 : 30000;
    var need = force || !state.managedScan || state.managedCount !== paras.length || Date.now() - state.managedAt > every;
    var t0 = Date.now();
    var scan = need && WB.scanCitationManagers ? WB.scanCitationManagers().then(function (res) {
      state.managedScan = res || { paragraphs: [], managers: {}, found: false };
    }, function () {
      if (!state.managedScan) state.managedScan = { paragraphs: [], managers: {}, found: false, failed: true };
    }).then(function () { state.managedAt = Date.now(); state.managedCost = Date.now() - t0; state.managedCount = paras.length; }) : Promise.resolve();
    return scan.then(function () { state.managed = CM.mapToWord(paras.map(function (p) { return p.text; }), state.managedScan); });
  }
  // Dipanggil tepat sebelum menulis ke dokumen: pastikan peta bagian terkelola masih baru.
  function freshManaged() {
    if (!CM || Date.now() - state.managedAt < 4000) return Promise.resolve();
    return WB.readParagraphs().then(function (paras) { return refreshManaged(paras, true); }).catch(function () { /* pakai peta lama */ });
  }
  function managedBlockError(s) {
    if (!CM || !s) return null;
    var again = CM.protectSuggestions([s], state.managed, state.st)[0];
    return again.managedBy && !again.canApply ? new Error(again.blockedReason) : null;
  }

  function statusLine() {
    if (!state.st) return '';
    var st = state.st;
    var t = st.refs.length + ' referensi · ' + (state.result ? state.result.stats.citations : 0) + ' sitasi';
    if (st.headingIndex < 0) t = 'Heading daftar pustaka tidak ditemukan';
    return t + ' · diperiksa ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  function renderBadge() {
    var b = $('styleBadge'), d = state.detect;
    b.hidden = false;
    var auto = $('styleSel').value === 'auto';
    b.textContent = auto ? 'Terdeteksi ' + STYLE_NAME[state.styleId] + (d && d.confidence ? ' · ' + d.confidence + '%' : '') : 'Manual: ' + STYLE_NAME[state.styleId];
    b.title = d && d.note ? d.note : '';
  }

  // ---------- cek metadata online (CrossRef) ----------
  // Hasil disimpan per (gaya|teks referensi) supaya tidak diulang saat dokumen diedit.
  function runOnline() {
    if (!state.result || !settings.online) { renderSummary(); renderMeta(); return; }
    var run = ++state.onlineRun;
    var refs = state.result.references, styleId = state.styleId, st = state.st;
    var queue = refs.filter(function (r) { return !state.online[styleId + '|' + r.raw]; });
    state.onlineTotal = refs.length; state.onlineDone = refs.length - queue.length;
    renderSummary(); renderMeta();
    var workers = [0, 1, 2].map(function () {
      return (function next() {
        if (run !== state.onlineRun || !queue.length) return Promise.resolve();
        var ref = queue.shift();
        return AC.checkMetadata(st, styleId, ref).then(function (rec) {
          state.online[styleId + '|' + ref.raw] = rec || { status: 'none' };
        }).catch(function (e) {
          state.online[styleId + '|' + ref.raw] = { status: 'error', note: errMsg(e) };
        }).then(function () {
          if (run !== state.onlineRun) return;
          state.onlineDone++;
          renderSummary(); renderMeta(true);
          if (!$('tab-report').hidden) renderReportCounts();
          return next();
        });
      })();
    });
    return Promise.all(workers);
  }

  // Satu baris metadata per referensi (DOI + Scopus + tahun), dihitung ulang terhadap dokumen terkini.
  function metaRows() {
    if (!state.result) return [];
    var yr = AC.yearRange(state.result.references, settings.years);
    var old = new Set(yr.outRange.map(function (x) { return x.ref; }));
    var scop = state.scopus || [];
    return state.result.references.map(function (ref, i) {
      var rec = state.online[state.styleId + '|' + ref.raw] || null;
      var idx = AC.refIndexOfRaw(state.st, ref.raw);
      var sc = scop.find(function (x) { return x.ref === ref; }) || null;
      return { i: i, ref: ref, rec: rec, refIndex: idx, paraIndex: idx >= 0 ? state.st.refs[idx].paraIndex : null, old: old.has(ref), scopus: sc };
    });
  }
  function metaCounts(rows) {
    var c = { ok: 0, bad: 0, nodoi: 0, pending: 0, error: 0 };
    rows.forEach(function (r) {
      var st = r.rec ? r.rec.status : 'pending';
      if (st === 'valid' || st === 'minor') c.ok++;
      else if (st === 'mismatch' || st === 'notfound') c.bad++;
      else if (st === 'nodoi') c.nodoi++;
      else if (st === 'error') c.error++;
      else if (st === 'pending') c.pending++;
    });
    return c;
  }

  function allSuggestions() {
    return { list: state.suggestions.filter(function (s) { return !dismissed.has(s.key) && (!s.quiet || state.filter === s.category); }) };
  }

  // ================= RENDER VALIDATOR =================
  function renderSummary() {
    var all = allSuggestions();
    var list = all.list;
    $('summary').hidden = false;
    $('sumErr').textContent = list.filter(function (s) { return s.severity === 'error'; }).length;
    $('sumSug').textContent = list.filter(function (s) { return s.severity !== 'error'; }).length;
    var c = metaCounts(metaRows());
    if (!settings.online) $('sumOnl').textContent = 'Mati';
    else if (state.onlineTotal && state.onlineDone < state.onlineTotal) $('sumOnl').textContent = state.onlineDone + '/' + state.onlineTotal;
    else if (c.error && !c.ok) { $('sumOnl').textContent = 'Gagal'; $('sumOnl').title = 'CrossRef tidak dapat dihubungi'; }
    else $('sumOnl').textContent = c.ok + '/' + (c.ok + c.bad + c.error) + (c.bad ? ' !' : '');
    var n = list.length;
    $('tabCount').textContent = n ? (n > 99 ? '99+' : n) : '';
  }

  function renderAll(fromOnline) {
    if (!state.st) return;
    var all = allSuggestions();
    renderSummary();
    var notice = [];
    if (state.st.headingIndex < 0) notice.push('Heading daftar pustaka (mis. "Daftar Pustaka" / "References") tidak ditemukan di paragraf tersendiri — hanya sitasi di teks yang diperiksa.');
    if (state.detect && state.detect.note && $('styleSel').value === 'auto') notice.push(state.detect.note);
    if (state.result && state.result.failedLines.length) notice.push(state.result.failedLines.length + ' baris daftar pustaka tidak dapat dibaca dan tidak ikut diperiksa.');
    $('notice').hidden = !notice.length; $('notice').innerHTML = notice.map(esc).join('<br>');
    var m = state.managed, mn = $('mgrNotice');
    if (m && m.found) {
      var nMan = state.suggestions.filter(function (x) { return x.managedBy && !dismissed.has(x.key); }).length;
      mn.innerHTML = '<b>Terdeteksi ' + esc(CM.summary(m)) + '.</b> Bagian yang dibuat pengelola sitasi tidak diubah otomatis oleh add-in agar field-nya tidak rusak' +
        (nMan ? ' — ' + nMan + ' saran pada bagian itu hanya ditampilkan, lengkap dengan cara memperbaikinya.' : '.') +
        ' Laporan komentar tetap bisa dibuat.' + (m.codesVisible ? '<br>Kode field sedang ditampilkan — tekan <b>Alt+F9</b> untuk menyembunyikannya.' : '');
      mn.hidden = false;
    } else mn.hidden = true;
    $('reportCta').hidden = !all.list.length;

    var counts = { all: all.list.length };
    all.list.forEach(function (s) { counts[s.category] = (counts[s.category] || 0) + 1; });
    $('filters').hidden = !all.list.length && !fromOnline;
    document.querySelectorAll('#filters .chip').forEach(function (c) {
      var f = c.dataset.filter;
      c.innerHTML = esc(c.textContent.replace(/\s*\d+$/, '')) + (counts[f] ? ' <span class="n">' + counts[f] + '</span>' : '');
      c.classList.toggle('active', f === state.filter);
    });

    var visible = all.list.filter(function (s) { return state.filter === 'all' || s.category === state.filter; });
    visible.sort(function (a, b) {
      var sa = a.severity === 'error' ? 0 : 1, sb = b.severity === 'error' ? 0 : 1;
      if (a.paraIndex == null && b.paraIndex != null) return 1;
      if (b.paraIndex == null && a.paraIndex != null) return -1;
      return (a.paraIndex - b.paraIndex) || ((a.offset || 0) - (b.offset || 0)) || (sa - sb);
    });
    state.visible = visible;
    var applicable = visible.filter(function (s) { return s.canApply && (s.kind === 'replace' || s.kind === 'paragraph' || s.kind === 'italic' || s.kind === 'append'); });
    $('bulkBar').hidden = applicable.length < 2;
    $('bulkText').textContent = applicable.length + ' saran bisa diterapkan otomatis';

    var host = $('cards');
    // simpan panel pencarian yang sedang terbuka agar tidak hilang saat hasil online masuk
    var openSearch = host.querySelector('.search:not([hidden])');
    var openSearchId = openSearch ? openSearch.closest('.card').dataset.id : null;
    if (openSearchId && fromOnline) return;
    host.innerHTML = visible.map(cardHtml).join('');
    $('empty').hidden = visible.length > 0;
    if (!visible.length) {
      $('empty').innerHTML = all.list.length ? 'Tidak ada saran di kategori ini.' :
        '<span class="big">✓</span>Tidak ada masalah sitasi yang terdeteksi.';
    }
  }

  function diffHtml(a, b) {
    return AC.wordDiff(a, b).map(function (op) {
      if (op.op === 'eq') return '<span class="ctx">' + esc(op.text) + '</span>';
      return '<span class="' + (op.op === 'del' ? 'del' : 'ins') + '">' + esc(op.text) + '</span>';
    }).join('');
  }
  function runsHtml(runs) { return runs.map(function (r) { return r.italic ? '<i>' + esc(r.text) + '</i>' : esc(r.text); }).join(''); }

  function cardHtml(s) {
    var cls = 'card sev-' + (s.severity || 'suggestion') + ' cat-' + s.category + (state.openId === s.id ? ' open focus' : '');
    var h = '<article class="' + cls + '" data-id="' + esc(s.id) + '">';
    h += '<div class="card-head" data-act="toggle"><span class="cat">' + esc(CAT_LABEL[s.category] || '') + '</span><span class="card-title">' + esc(s.title) + '</span>' +
      (s.managedBy ? '<span class="mgr" title="Dibuat oleh ' + esc(CM.nameOf(s.managedBy)) + '">' + esc(s.managedBy) + '</span>' : '') + '</div>';
    if (s.kind === 'replace' && s.original) {
      h += '<div class="diff compact"><span class="' + (s.replacement ? 'del' : 'ctx') + '">' + esc(s.original) + '</span>';
      if (s.replacement) h += '<span class="to">→</span><span class="ins">' + esc(s.replacement) + '</span>';
      h += '</div>';
    } else if ((s.kind === 'paragraph' || s.kind === 'append') && s.replacement) {
      h += '<div class="diff">' + diffHtml(s.compareOriginal || s.original, s.replacement) + '</div>';
    } else if (s.original && s.kind !== 'sort' && s.kind !== 'restyle') {
      h += '<div class="diff ctx">' + esc(s.original.length > 220 ? s.original.slice(0, 220) + '…' : s.original) + '</div>';
    }
    h += '<div class="more">';
    if (s.description) h += '<p class="desc">' + esc(s.description) + '</p>';
    if (s.reasons && s.reasons.length > 1) h += '<ul class="reasons">' + s.reasons.map(function (r) { return '<li>' + esc(r.title) + (r.description ? ' — ' + esc(r.description) : '') + '</li>'; }).join('') + '</ul>';
    if (s.hint) h += '<p class="desc">' + esc(s.hint) + '</p>';
    if (s.kind === 'paragraph' && s.replacementRuns && s.replacementRuns.some(function (r) { return r.italic; })) h += '<p class="desc">Hasil: ' + runsHtml(s.replacementRuns) + '</p>';
    h += '</div>';
    if (s.blockedReason) h += '<div class="blocked' + (s.managedBy ? ' info' : '') + '">' + esc(s.blockedReason) + '</div>';
    h += '<div class="actions">';
    if (s.canApply) h += '<button class="accept" data-act="accept">' + esc(s.actionLabel || 'Terima') + '</button>';
    if (s.searchable) h += '<button class="ghost small" data-act="search">Cari referensi online</button>';
    if (s.paraIndex != null) h += '<button class="ghost small" data-act="locate">Lihat</button>';
    h += '<button class="ghost small" data-act="dismiss">Abaikan</button>';
    if (s.link) h += '<a class="link" href="' + esc(s.link) + '" target="_blank" rel="noopener">Buka DOI ↗</a>';
    if (s.searchUrl) h += '<a class="link" href="' + esc(s.searchUrl) + '" target="_blank" rel="noopener">Cari manual ↗</a>';
    if (s.sourceUrl) h += '<a class="link" href="' + esc(s.sourceUrl) + '" target="_blank" rel="noopener">Pedoman ↗</a>';
    h += '</div>';
    if (s.searchable) h += searchPanelHtml(s);
    h += '</article>';
    return h;
  }

  // ---------- panel cari referensi untuk sitasi yang belum ada di daftar pustaka ----------
  var STOP = /^(?:yang|dan|di|ke|dari|pada|untuk|dengan|dalam|ini|itu|juga|atau|oleh|sebagai|adalah|akan|telah|bahwa|the|a|an|of|and|in|on|for|to|with|by|is|are|was|were|that|this|as|at|from|also|et|al|menurut|studi|penelitian|terbaru|lain|hal|serupa|relevan|ada|pula|showed|study|studies|research)$/i;
  function searchPanelHtml(s) {
    var m = (s.original || '').match(/^\(?\s*([\p{L}'’ .-]+?)(?:\s+(?:et\s+al\.?|&|and|dan)\b.*?)?,?\s+(\d{4})/u);
    var author = m ? m[1].trim() : '', year = m ? m[2] : '';
    var para = state.st && state.st.paragraphs[s.paraIndex] ? state.st.paragraphs[s.paraIndex].text : '';
    var before = para.slice(Math.max(0, s.offset - 160), s.offset);
    var sentence = before.split(/[.!?]\s/).pop() || '';
    var kw = (sentence.match(/[\p{L}-]{4,}/gu) || []).filter(function (w) { return !STOP.test(w); }).slice(-6).join(' ');
    return '<div class="search" hidden>' +
      '<div class="grid"><input data-f="author" placeholder="Penulis" value="' + esc(author) + '"><input data-f="year" placeholder="Tahun" value="' + esc(year) + '">' +
      '<input class="kw" data-f="kw" placeholder="Kata kunci judul/topik" value="' + esc(kw) + '"></div>' +
      '<div class="actions"><button class="accept" data-act="dosearch">Cari di CrossRef</button></div><div class="cands"></div></div>';
  }

  function doSearch(card, s) {
    var panel = card.querySelector('.search');
    var q = { author: panel.querySelector('[data-f=author]').value.trim(), year: panel.querySelector('[data-f=year]').value.trim(), keywords: panel.querySelector('[data-f=kw]').value.trim() };
    var out = panel.querySelector('.cands');
    out.innerHTML = '<div class="desc"><span class="spin"></span>Mencari…</div>';
    AC.searchCandidates(q).then(function (cands) {
      if (!cands.length) { out.innerHTML = '<div class="desc">Tidak ada hasil. Coba ubah kata kunci atau kosongkan tahun.</div>'; return; }
      panel._cands = cands;
      var mref = CM ? CM.managedReferences(state.managed, state.st) : null;
      if (mref) {
        out.innerHTML = '<div class="blocked info">Daftar pustaka dibuat oleh ' + esc(CM.nameOf(mref.manager)) + ', jadi referensi tidak disisipkan langsung. Tambahkan item ini ke ' + esc(CM.nameOf(mref.manager)) + ' (mis. lewat DOI-nya), lalu sisipkan sitasinya dari ' + esc(CM.nameOf(mref.manager)) + ' — daftar pustaka akan diperbarui otomatis.</div>' +
          cands.map(function (c) {
            return '<div class="cand"><div class="t">' + esc(c.title || '(tanpa judul)') + '</div><div class="m">' + esc([c.authors, c.year, c.container].filter(Boolean).join(' · ')) + '</div>' +
              (c.doi ? '<div class="actions"><span class="fine">DOI: <b>' + esc(c.doi) + '</b></span><a class="link" href="https://doi.org/' + esc(c.doi) + '" target="_blank" rel="noopener">Buka ↗</a></div>' : '') + '</div>';
          }).join('');
        return;
      }
      out.innerHTML = cands.map(function (c, i) {
        var f = AC.formatCrossrefReference(c.item, state.styleId, state.st.refs.length + 1);
        c.formatted = f;
        return '<div class="cand"><div class="t">' + esc(c.title || '(tanpa judul)') + '</div>' +
          '<div class="m">' + esc([c.authors, c.year, c.container].filter(Boolean).join(' · ')) + '</div>' +
          '<div class="preview">' + runsHtml(f.runs) + '</div>' +
          '<div class="actions"><button class="accept" data-act="insertref" data-i="' + i + '">Sisipkan ke daftar pustaka</button>' +
          (c.doi ? '<a class="link" href="https://doi.org/' + esc(c.doi) + '" target="_blank" rel="noopener">DOI ↗</a>' : '') + '</div></div>';
      }).join('');
    }).catch(function (e) { out.innerHTML = '<div class="desc">Pencarian gagal: ' + esc(errMsg(e)) + '</div>'; });
  }

  // ---------- aksi kartu ----------
  function findSuggestion(id) { return (state.visible || []).find(function (s) { return s.id === id; }) || allSuggestions().list.find(function (s) { return s.id === id; }); }

  function accept(s) {
    return freshManaged().then(function () {
      var blocked = managedBlockError(s);
      if (blocked) { renderAll(); throw blocked; }
      return acceptNow(s);
    });
  }
  function acceptNow(s) {
    var opts = { track: settings.track };
    var st = state.st;
    var p;
    if (s.kind === 'sort') p = WB.reorderParagraphs(st.refs.map(function (r) { return r.paraIndex; }), s.order, snapshotOf(st.refs.map(function (r) { return r.paraIndex; })), opts);
    else if (s.kind === 'restyle') {
      var plan = AC.planConversion(st, state.styleId, state.styleId);
      if (plan.error) return Promise.reject(new Error(plan.error));
      p = WB.applyConversion(plan, snapshotOf(planParas(plan)), Object.assign({ hangingIndent: false }, opts));
    } else p = WB.applySuggestion(s, opts);
    state.suppressUntil = Date.now() + 2500;
    return p.then(function () { toast('Diterapkan'); return runCheck({ force: true, silent: true }); });
  }

  function planParas(plan) {
    var set = {};
    plan.edits.forEach(function (e) { set[e.paraIndex] = 1; });
    plan.references.paraIndexes.forEach(function (i) { set[i] = 1; });
    return Object.keys(set).map(Number);
  }

  function onCardClick(ev) {
    var btn = ev.target.closest('[data-act]');
    var card = ev.target.closest('.card');
    if (!card) return;
    var s = findSuggestion(card.dataset.id);
    if (!s) return;
    var act = btn ? btn.dataset.act : 'toggle';
    if (act === 'toggle') {
      state.openId = state.openId === s.id ? null : s.id;
      document.querySelectorAll('.card').forEach(function (c) { var on = c.dataset.id === state.openId; c.classList.toggle('open', on); c.classList.toggle('focus', on); });
      if (state.openId && s.paraIndex != null) WB.select(s).catch(function () {});
      return;
    }
    if (act === 'locate') { WB.select(s).catch(function (e) { setStatus(errMsg(e), 'err'); }); return; }
    if (act === 'dismiss') { dismissed.add(s.key); saveDismissed(); renderAll(); refreshAnnotations(); toast('Diabaikan'); return; }
    if (act === 'accept') {
      card.classList.add('applying');
      accept(s).catch(function (e) { card.classList.remove('applying'); setStatus(errMsg(e), 'err'); });
      return;
    }
    if (act === 'search') { var panel = card.querySelector('.search'); panel.hidden = !panel.hidden; if (!panel.hidden) doSearch(card, s); return; }
    if (act === 'dosearch') { doSearch(card, s); return; }
    if (act === 'insertref') {
      var c = card.querySelector('.search')._cands[+btn.dataset.i];
      var point = AC.insertionPoint(state.st, state.styleId, c.formatted.apaLine);
      var f = state.styleId === 'ieee' ? AC.formatCrossrefReference(c.item, 'ieee', point.number || state.st.refs.length + 1) : c.formatted;
      btn.disabled = true;
      state.suppressUntil = Date.now() + 2500;
      WB.insertReference(point, f.runs, { track: settings.track, headingText: 'Daftar Pustaka' }).then(function () {
        toast('Referensi disisipkan — periksa kembali isinya');
        return runCheck({ force: true, silent: true });
      }).catch(function (e) { btn.disabled = false; setStatus(errMsg(e), 'err'); });
    }
  }

  function acceptAll() {
    var list = (state.visible || []).filter(function (s) { return s.canApply && (s.kind === 'replace' || s.kind === 'paragraph' || s.kind === 'italic' || s.kind === 'append'); });
    if (!list.length) return;
    setStatus('Menerapkan ' + list.length + ' saran…', 'busy');
    freshManaged().then(function () {
      list = list.filter(function (s) { return !managedBlockError(s); });
      state.suppressUntil = Date.now() + 4000;
      return WB.applyMany(list, { track: settings.track });
    }).then(function (r) {
      toast(r.done + ' saran diterapkan' + (r.failed ? ', ' + r.failed + ' dilewati' : ''));
      return runCheck({ force: true });
    }).catch(function (e) { setStatus(errMsg(e), 'err'); });
  }

  // ---------- anotasi di dokumen ----------
  function refreshAnnotations() {
    var old = state.annIds; state.annIds = []; state.annMap = {};
    var clear = WB.clearAnnotations(old);
    if (!settings.underline || !state.st) return clear;
    var items = allSuggestions().list.filter(function (s) { return s.paraIndex != null && s.length > 0; }).slice(0, 250).map(function (s) {
      return { id: s.id, paraIndex: s.paraIndex, offset: s.offset || 0, length: s.length,
        color: s.severity === 'error' ? 'error' : 'suggestion',
        popup: s.canApply && s.kind === 'replace' && s.replacement && s.replacement.length < 120 ? [s.replacement] : null };
    });
    return clear.then(function () { return WB.annotate(items, true); }).then(function (res) {
      if (!res || !res.supported) return;
      state.annMap = res.ids; state.annIds = Object.keys(res.ids);
    }).catch(function () { /* anotasi opsional */ });
  }
  function onAnnotationClicked(annId) {
    var sid = state.annMap[annId]; if (!sid) return;
    showTab('validator');
    state.openId = sid; state.filter = 'all'; renderAll();
    var el = document.querySelector('.card[data-id="' + sid + '"]'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function onAnnotationPopup(annId, action) {
    var sid = state.annMap[annId]; if (!sid) return;
    var s = findSuggestion(sid); if (!s) return;
    if (action === 'Accept' && s.canApply) accept(s).catch(function (e) { setStatus(errMsg(e), 'err'); });
    else if (action === 'Reject') { dismissed.add(s.key); saveDismissed(); renderAll(); }
  }

  // ================= METADATA =================
  var DOI_BADGE = {
    valid: ['DOI ✓', 'ok', 'DOI valid & cocok'], minor: ['DOI ✓', 'ok', 'DOI valid, detail sedikit berbeda'],
    mismatch: ['DOI ≠', 'bad', 'DOI tampaknya milik karya lain'], notfound: ['DOI ?', 'bad', 'DOI tidak ada di CrossRef'],
    nodoi: ['Tanpa DOI', 'warn', 'Tanpa DOI'], notexpected: ['—', 'muted', 'Umumnya tanpa DOI'],
    error: ['Offline', 'muted', 'CrossRef tidak terjangkau'], pending: ['…', 'muted', 'Sedang dicek']
  };
  var SCOPUS_BADGE = { SCOPUS: ['Scopus', 'ok'], PROBABLE_SCOPUS: ['Scopus?', 'ok'], SCOPUS_SOURCE_ONLY: ['Source only', 'warn'], UNKNOWN: ['Scopus –', 'muted'] };

  function renderMeta(fromOnline) {
    if ($('tab-meta').hidden && fromOnline) return;
    var rows = metaRows(), c = metaCounts(rows);
    var yr = state.result ? AC.yearRange(state.result.references, settings.years) : null;
    $('mDoiOk').textContent = settings.online ? c.ok : '–';
    $('mDoiBad').textContent = settings.online ? c.bad : '–';
    $('mNoDoi').textContent = settings.online ? c.nodoi : '–';
    $('mRecent').textContent = yr && yr.percent != null ? yr.percent + '%' : '–';
    $('mRecentLbl').textContent = '≤ ' + settings.years + ' thn (' + (yr ? yr.from + '–' + yr.to : '') + ')';
    var counts = { all: rows.length, issue: 0, nodoi: 0, old: 0, scopus: 0 };
    rows.forEach(function (r) {
      var st = r.rec ? r.rec.status : 'pending';
      if (st === 'mismatch' || st === 'notfound' || st === 'minor') counts.issue++;
      if (st === 'nodoi') counts.nodoi++;
      if (r.old) counts.old++;
      if (r.scopus && /SCOPUS/.test(r.scopus.status) && r.scopus.status !== 'UNKNOWN') counts.scopus++;
    });
    document.querySelectorAll('#mFilters .chip').forEach(function (ch) {
      var f = ch.dataset.mf; ch.classList.toggle('active', f === state.metaFilter);
      ch.innerHTML = esc(ch.textContent.replace(/\s*\d+$/, '')) + (counts[f] ? ' <span class="n">' + counts[f] + '</span>' : '');
    });
    var list = rows.filter(function (r) {
      var st = r.rec ? r.rec.status : 'pending';
      switch (state.metaFilter) {
        case 'issue': return st === 'mismatch' || st === 'notfound' || st === 'minor';
        case 'nodoi': return st === 'nodoi';
        case 'old': return r.old;
        case 'scopus': return !!r.scopus;
        default: return true;
      }
    });
    var host = $('metaList');
    if (fromOnline && host.querySelector('.mcands:not(:empty)')) { return; }
    if (!settings.online && state.metaFilter !== 'old' && state.metaFilter !== 'scopus') {
      host.innerHTML = '<div class="empty">Cek online dimatikan di Pengaturan.</div>'; return;
    }
    host.innerHTML = list.length ? list.map(metaRowHtml).join('') : '<div class="empty">Tidak ada referensi di kategori ini.</div>';
  }

  function metaRowHtml(r) {
    var rec = r.rec || { status: 'pending' }, b = DOI_BADGE[rec.status] || DOI_BADGE.pending;
    var h = '<article class="mrow" data-i="' + r.i + '"><div class="mhead">';
    h += '<span class="tag ' + b[1] + '" title="' + esc(b[2]) + '">' + esc(b[0]) + '</span>';
    var periodical = /^(?:journal-article|conference|book-chapter|magazine-article)$/.test(r.ref.sourceType || '') || !!r.ref.journal && r.ref.sourceType !== 'website' && r.ref.sourceType !== 'book';
    if (r.scopus && (periodical || r.scopus.status !== 'UNKNOWN')) { var sb = SCOPUS_BADGE[r.scopus.status] || SCOPUS_BADGE.UNKNOWN; h += '<span class="tag ' + sb[1] + '">' + esc(sb[0]) + '</span>'; }
    if (r.old) h += '<span class="tag warn" title="Di luar ' + settings.years + ' tahun terakhir">Usang</span>';
    h += '<span class="mlabel">' + esc(r.ref.firstAuthor || '-') + (r.ref.year ? ' (' + esc(r.ref.year) + ')' : '') + '</span></div>';
    h += '<div class="mtitle">' + esc((rec.title || r.ref.title || r.ref.raw).slice(0, 160)) + '</div>';
    if (rec.note && rec.status !== 'valid') h += '<div class="prob-why">' + esc(rec.note) + '</div>';
    if (rec.fields && rec.status !== 'valid') {
      h += '<table class="mcmp"><tr><th></th><th>Naskah</th><th>CrossRef</th></tr>' + rec.fields.map(function (f) {
        return '<tr class="' + (f.ok ? 'fok' : 'fbad') + '"><td>' + esc(f.field) + (f.info ? '' : f.ok ? ' ✓' : ' ✕') + '</td><td>' + esc(f.naskah || '–') + '</td><td>' + esc(f.crossref || '–') + (f.note ? '<div class="fine">' + esc(f.note) + '</div>' : '') + '</td></tr>';
      }).join('') + '</table>';
    }
    if (r.scopus && (periodical || r.scopus.status !== 'UNKNOWN')) h += '<div class="prob-why">' + esc(scopusExplain(r.scopus, r.ref)) + '</div>';
    h += '<div class="actions">';
    if (rec.status === 'nodoi') h += '<button class="accept" data-mact="find">Cari DOI</button>';
    if (rec.status === 'notfound' || rec.status === 'mismatch') h += '<button class="ghost small" data-mact="find">Cari DOI yang benar</button>';
    if (r.paraIndex != null) h += '<button class="ghost small" data-mact="goto">Lihat</button>';
    if (rec.link) h += '<a class="link" href="' + esc(rec.link) + '" target="_blank" rel="noopener">Buka DOI ↗</a>';
    h += '</div><div class="mcands"></div></article>';
    return h;
  }
  function scopusExplain(sc, ref) {
    var pct = Math.round((sc.confidence || 0) * 100);
    if (sc.status === 'SCOPUS') return sc.method === 'DOI_EXACT' ? 'Dokumen ditemukan lewat DOI yang cocok persis.' : 'Dokumen ditemukan lewat kecocokan metadata ' + pct + '%.';
    if (sc.status === 'PROBABLE_SCOPUS') return 'Metadata cukup mirip (' + pct + '%) dengan satu dokumen, belum cukup pasti.';
    if (sc.status === 'SCOPUS_SOURCE_ONLY') return 'Jurnal "' + ((sc.matchedSource && sc.matchedSource.title) || ref.journal || '-') + '" terindeks Scopus; dokumen ini belum terverifikasi.' + (sc.discontinuedWarning ? ' Perhatian: jurnal ini berstatus "Discontinued by Scopus".' : '');
    if (sc.method === 'JOURNAL_FOUND_YEAR_NOT_COVERED') return 'Jurnal ada di Scopus, tetapi tahun ' + (ref.year || '-') + ' di luar cakupannya (' + ((sc.matchedSource && sc.matchedSource.coverage) || '-') + ').';
    return 'Belum ditemukan bukti di data Scopus yang dimuat (bukan berarti pasti non-Scopus).';
  }

  function onMetaClick(ev) {
    var btn = ev.target.closest('[data-mact]'); if (!btn) return;
    var rowEl = ev.target.closest('.mrow'); var r = metaRows()[+rowEl.dataset.i]; if (!r) return;
    var act = btn.dataset.mact;
    if (act === 'goto') { WB.select({ kind: 'paragraph', paraIndex: r.paraIndex }).catch(function (e) { setStatus(errMsg(e), 'err'); }); return; }
    if (act === 'find') {
      var out = rowEl.querySelector('.mcands');
      out.innerHTML = '<div class="desc"><span class="spin"></span>Mencari di CrossRef…</div>';
      AC.searchDoiCandidates(r.ref, state.styleId).then(function (cands) {
        if (!cands.length) { out.innerHTML = '<div class="desc">Tidak ada kandidat. <a class="link" target="_blank" rel="noopener" href="https://search.crossref.org/?q=' + encodeURIComponent((r.ref.title || '') + ' ' + (r.ref.firstAuthor || '')) + '">Cari manual ↗</a></div>'; return; }
        out._cands = cands;
        out.innerHTML = cands.map(function (c, k) {
          return '<div class="cand' + (c.sure ? ' sure' : '') + '"><div class="t">' + esc(c.title || '(tanpa judul)') + '</div>' +
            '<div class="m">' + esc([c.authors, c.year, c.container].filter(Boolean).join(' · ')) + ' · <b>' + c.score + '%</b>' + (c.sure ? ' · judul, penulis & tahun cocok' : '') + '</div>' +
            (c.score < 50 ? '<div class="prob-why bad-t">Kecocokan rendah — kemungkinan besar bukan karya yang sama.</div>' : '') +
            '<div class="actions"><button class="' + (c.score < 50 ? 'ghost small' : 'accept') + '" data-mact="use" data-k="' + k + '">Pakai DOI ini</button><a class="link" href="https://doi.org/' + esc(c.doi) + '" target="_blank" rel="noopener">' + esc(c.doi) + ' ↗</a></div></div>';
        }).join('');
      }).catch(function (e) { out.innerHTML = '<div class="desc">Pencarian gagal: ' + esc(errMsg(e)) + '</div>'; });
      return;
    }
    if (act === 'use') {
      var cand = rowEl.querySelector('.mcands')._cands[+btn.dataset.k];
      var rec = r.rec || { refIndex: r.refIndex, doi: r.ref.doi };
      var edit = AC.doiEdit(state.st, state.styleId, Object.assign({ refIndex: r.refIndex }, rec), cand.doi);
      if (!edit) return;
      var mp = CM && r.paraIndex != null ? CM.managedPara(state.managed, r.paraIndex) : null;
      if (mp) {
        rowEl.querySelector('.mcands').insertAdjacentHTML('afterbegin', '<div class="blocked info">Referensi ini dibuat oleh ' + esc(CM.nameOf(mp.manager)) + '. Isikan DOI <b>' + esc(cand.doi) + '</b> pada item tersebut di ' + esc(CM.nameOf(mp.manager)) + ', lalu perbarui daftar pustaka (Refresh).</div>');
        return;
      }
      btn.disabled = true;
      state.suppressUntil = Date.now() + 2500;
      WB.applySuggestion(edit, { track: settings.track }).then(function () {
        toast('DOI dipasang'); rowEl.querySelector('.mcands').innerHTML = '';
        return runCheck({ force: true, silent: true });
      }).catch(function (e) { btn.disabled = false; setStatus(errMsg(e), 'err'); });
    }
  }

  // Scopus Source List: dicari dulu di repo add-in, lalu di situs cek-sitasi (data yang sama).
  var SCOPUS_URLS = [['../scopus_sources.json', '../scopus_proceedings.json'],
    ['https://journal23abc-web.github.io/cek-sitasi/scopus_sources.json', 'https://journal23abc-web.github.io/cek-sitasi/scopus_proceedings.json']];
  function loadScopus() {
    if (!state.result) return;
    if (state.scopusDb) { state.scopus = AC.scopusStatuses(state.result.references, state.scopusDb); renderMeta(); return; }
    if (state.scopusLoading || !window.ScopusMatcher) return;
    state.scopusLoading = true;
    $('scopusStatus').textContent = 'Memuat Scopus Source List (±18 MB, sekali saja)…';
    function getJson(u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    function attempt(i) {
      if (i >= SCOPUS_URLS.length) return Promise.resolve(null);
      return Promise.all(SCOPUS_URLS[i].map(getJson)).then(function (d) { return d[0] || d[1] ? d : attempt(i + 1); });
    }
    attempt(0).then(function (d) {
      state.scopusLoading = false;
      if (!d) { $('scopusStatus').textContent = 'Data Scopus tidak dapat dimuat (periksa koneksi).'; return; }
      var db = new window.ScopusMatcher.ScopusDatabase();
      if (d[0]) db.loadSourceListCompact(d[0]);
      if (d[1]) db.loadProceedingsCompact(d[1]);
      state.scopusDb = db;
      $('scopusStatus').textContent = 'Status Scopus dari Scopus Source List (data publik Elsevier, sama dengan versi web).';
      if (state.result) state.scopus = AC.scopusStatuses(state.result.references, db);
      renderMeta();
    });
  }

  // ================= TAUTAN =================
  // Dua cara: (1) "copy" — mesin link-engine.js versi web pada salinan .docx, dibuka sebagai
  // dokumen baru (tidak butuh bookmark API); (2) "inplace" — langsung di dokumen via Office.js.
  function linkMode() { var r = document.querySelector('input[name=lkMode]:checked'); return r ? r.value : 'copy'; }
  function syncLinkMode() {
    var m = linkMode();
    $('lkCopyOpts').hidden = m !== 'copy'; $('lkInplaceOpts').hidden = m !== 'inplace';
    $('btnLinkPreview').hidden = m !== 'inplace';
    $('btnLinkApply').textContent = m === 'copy' ? 'Buat salinan tertaut' : 'Tautkan sekarang';
    $('linkResult').innerHTML = '';
  }
  function linkOpts() { return { citations: $('lkCit').checked, external: $('lkExt').checked, keepLook: $('lkLook').checked }; }
  function copyOpts() {
    return { styleId: state.styleId || 'auto', linkScope: $('lkScope').value, linkColor: $('lkColor').value || null,
      safeMode: $('lkSafe').checked, preserveCitationControls: $('lkPreserve').checked,
      narrowToHighlight: $('lkNarrow').checked, onlyHighlighted: $('lkOnlyHl').checked,
      linkReferenceUrls: $('lkRefUrls').checked, repairExternalLinks: $('lkRepair').checked, linkFiguresTables: $('lkFig').checked };
  }
  function ensureFresh() { return state.st ? runCheck({ silent: true }) : runCheck({ force: true }); }

  function linkPreview() {
    return ensureFresh().then(function () {
      var plan = AC.planLinks(state.st, state.styleId, { external: $('lkExt').checked });
      if (CM) plan = CM.filterLinkPlan(plan, state.managed);
      state.linkPlan = plan;
      var o = linkOpts();
      var h = '<div class="stat-row"><span class="stat"><b>' + (o.citations ? plan.citationLinks.length : 0) + '</b> tautan sitasi</span>' +
        '<span class="stat"><b>' + plan.bookmarks.length + '</b> referensi tujuan</span>' +
        '<span class="stat"><b>' + (o.external ? plan.externalLinks.length : 0) + '</b> DOI/URL</span></div>';
      if (plan.error) h += '<div class="blocked">' + esc(plan.error) + '</div>';
      var ms = plan.managedSkipped;
      if (ms && (ms.citations || ms.bookmarks || ms.external)) {
        h += '<div class="blocked info">' + (ms.citations ? ms.citations + ' sitasi ' : '') + (ms.citations && ms.bookmarks ? 'dan ' : '') + (ms.bookmarks ? ms.bookmarks + ' entri daftar pustaka ' : '') +
          (!ms.citations && !ms.bookmarks ? ms.external + ' DOI/URL ' : '') + 'dibuat oleh ' + esc(CM.nameOf(ms.manager)) + ' dan dilewati agar field-nya tidak rusak. ' +
          'Untuk menautkan semuanya, pakai <b>Salinan tertaut</b> — mesin versi web mempertahankan field Zotero/Mendeley.</div>';
      }
      if (plan.unmatched.length) {
        h += '<div class="h">Tidak ditautkan (' + plan.unmatched.length + ')</div><div class="list">' + plan.unmatched.map(function (u) {
          return '<div class="it warn"><b>' + esc(u.text) + '</b> — ' + esc(u.note || '') + '</div>';
        }).join('') + '</div>';
      }
      if (plan.citationLinks.length && o.citations) {
        h += '<div class="h">Contoh</div><div class="list">' + plan.citationLinks.slice(0, 30).map(function (l) {
          var r = state.st.refs[l.refIndex];
          return '<div class="it"><b>' + esc(l.text) + '</b> → ' + esc(r.line.slice(0, 90)) + (r.line.length > 90 ? '…' : '') + '</div>';
        }).join('') + '</div>';
      }
      $('linkResult').innerHTML = h;
      return plan;
    });
  }
  function linkApply() { return linkMode() === 'copy' ? linkCopy() : linkInplace(); }

  function linkInplace() {
    setStatus('Membuat tautan…', 'busy');
    return freshManaged().then(linkPreview).then(function (plan) {
      if (!plan.citationLinks.length && !plan.externalLinks.length) throw new Error(plan.managedSkipped ? 'Tidak ada yang bisa ditautkan langsung tanpa menyentuh field pengelola sitasi. Gunakan "Salinan tertaut".' : 'Tidak ada sitasi yang bisa ditautkan.');
      var idx = plan.citationLinks.map(function (l) { return l.paraIndex; }).concat(plan.externalLinks.map(function (l) { return l.paraIndex; }), plan.bookmarks.map(function (b) { return b.paraIndex; }));
      state.suppressUntil = Date.now() + 3000;
      return WB.applyLinks(plan, snapshotOf(idx), linkOpts());
    }).then(function (r) {
      setStatus(r.linked + ' tautan dibuat' + (r.missed ? ', ' + r.missed + ' tidak ditemukan di Word' : '') + (r.mode === 'ooxml' ? ' (mode kompatibilitas Word lama)' : '') + '.');
      toast('Tautan dibuat — Ctrl+klik sitasi untuk melompat');
    }).catch(function (e) {
      if (e && e.code === 'LinkUnsupported') {
        // Beralih otomatis ke cara salinan, yang tidak memerlukan bookmark API.
        var r = document.querySelector('input[name=lkMode][value=copy]'); r.checked = true; syncLinkMode();
        $('linkResult').innerHTML = '<div class="blocked">' + esc(e.message) + ' Dokumen tidak diubah. Gunakan <b>Salinan tertaut</b> (sudah dipilih) — klik "Buat salinan tertaut".</div>';
        setStatus('Beralih ke cara salinan tertaut.', 'err'); return;
      }
      setStatus(errMsg(e), 'err');
    });
  }

  function linkCopy() {
    var out = $('linkResult');
    if (!WB.canReadFile || !WB.canReadFile()) { out.innerHTML = '<div class="blocked">Word versi ini tidak mengizinkan add-in membaca file dokumen. Gunakan <a href="' + WEB_LINKER + '" target="_blank" rel="noopener">Tautkan Sitasi versi web</a>.</div>'; return Promise.resolve(); }
    $('btnLinkApply').disabled = true;
    setStatus('Membaca dokumen…', 'busy');
    return ensureFresh().then(function () { return WB.readDocxFile(); }).then(function (bytes) {
      setStatus('Menautkan dengan mesin cek-sitasi…', 'busy');
      return window.DocxLinker.linkDocxBuffer(bytes, copyOpts());
    }).then(function (o) {
      var sum = window.DocxLinker.summarize(o.result);
      out.innerHTML = linkReportHtml(sum, o.result);
      setStatus('Membuka salinan tertaut…', 'busy');
      return WB.openNewDocument(o.base64).then(function () {
        setStatus('Salinan tertaut dibuka di jendela baru — simpan dengan nama baru.');
        out.insertAdjacentHTML('afterbegin', '<div class="verified">Salinan tertaut sudah dibuka di jendela Word baru. Simpan dengan nama baru (mis. <i>naskah-tertaut.docx</i>). Naskah ini tidak diubah.</div>');
      }, function (err) {
        state.lastLinkedBase64 = o.base64;
        setStatus('Word tidak bisa membuka dokumen baru otomatis.', 'err');
        out.insertAdjacentHTML('afterbegin', '<div class="blocked">Word menolak membuka dokumen baru (' + esc(errMsg(err)) + '). <button class="ghost small" id="btnDlLinked" type="button">Unduh .docx tertaut</button></div>');
      });
    }).catch(function (e) {
      setStatus(errMsg(e), 'err');
      out.innerHTML = '<div class="blocked">' + esc(errMsg(e)) + '</div>';
    }).then(function () { $('btnLinkApply').disabled = false; });
  }

  function linkReportHtml(s, result) {
    var h = '<div class="conv-summary">Gaya: <b>' + esc(s.style) + '</b> · ' + s.references + ' referensi</div>';
    h += '<div class="stat-row"><span class="stat"><b>' + s.linked + '</b> sitasi tertaut</span>' +
      '<span class="stat"><b>' + s.unmatched + '</b> tidak cocok</span>' +
      (s.review ? '<span class="stat"><b>' + s.review + '</b> perlu ditinjau</span>' : '') +
      (s.alreadyLinked ? '<span class="stat"><b>' + s.alreadyLinked + '</b> sudah tertaut</span>' : '') +
      (s.urls ? '<span class="stat"><b>' + s.urls + '</b> URL referensi</span>' : '') +
      (s.repaired ? '<span class="stat"><b>' + s.repaired + '</b> target URL diperbaiki</span>' : '') +
      (s.figuresLinked || s.captions ? '<span class="stat"><b>' + s.figuresLinked + '</b> Figure/Table (' + s.captions + ' caption)</span>' : '') +
      (s.protectedControls ? '<span class="stat"><b>' + s.protectedControls + '</b> field sitasi dilindungi</span>' : '') + '</div>';
    var un = result.unmatched || [];
    if (un.length) {
      h += '<div class="h">Tidak ditautkan (' + un.length + ')</div><div class="list">' + un.slice(0, 40).map(function (u) {
        var t = typeof u === 'string' ? u : (u.raw || u.text || u.citation || JSON.stringify(u));
        var why = typeof u === 'object' ? (u.reason || u.note || '') : '';
        return '<div class="it warn"><b>' + esc(t) + '</b>' + (why ? ' — ' + esc(why) : '') + '</div>';
      }).join('') + '</div>';
    }
    return h;
  }
  function downloadLinked() {
    if (!state.lastLinkedBase64) return;
    var bin = atob(state.lastLinkedBase64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    var a = document.createElement('a'); a.href = url; a.download = 'naskah-tertaut.docx'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }
  var WEB_LINKER = 'https://journal23abc-web.github.io/cek-sitasi/link-upload.html';

  function unlink() {
    setStatus('Menghapus tautan…', 'busy');
    state.suppressUntil = Date.now() + 3000;
    WB.removeLinks().then(function (r) { setStatus(r.removed + ' tautan sitasi & ' + r.bookmarks + ' bookmark dihapus.'); })
      .catch(function (e) { setStatus(errMsg(e), 'err'); });
  }

  // ================= KONVERSI =================
  function syncConvertTab() {
    var from = state.styleId || 'apa7';
    $('cvFrom').textContent = STYLE_NAME[from];
    if ($('cvTo').value === from) $('cvTo').value = from === 'apa7' ? 'ieee' : 'apa7';
  }
  function convPreview() {
    $('btnConvApply').disabled = true;
    var out = $('convResult');
    return ensureFresh().then(function () {
      syncConvertTab();
      var source = state.styleId, target = $('cvTo').value;
      var st = state.st;
      var meta = Promise.resolve(null);
      if ($('cvEnrich').checked && st.refs.length) {
        out.innerHTML = '<div class="desc">Melengkapi data dari CrossRef…</div><div class="progress"><div id="cvProg"></div></div>';
        meta = AC.buildEnrichmentMetadata(st, source, null, function (d, t) { var b = $('cvProg'); if (b) b.style.width = Math.round(d / t * 100) + '%'; }).catch(function () { return null; });
      }
      return meta.then(function (metadata) {
        if (st !== state.st) throw new Error('Dokumen berubah saat pratinjau dibuat. Ulangi.');
        var plan = AC.planConversion(st, source, target, { metadata: metadata });
        if (CM) plan = CM.guardConversion(plan, state.managed, st);
        if (plan.error) { out.innerHTML = '<div class="blocked">' + esc(plan.error) + '</div>' + (plan.failedRefs && plan.failedRefs.length ? problemList(plan.failedRefs.map(failedItem)) : ''); return; }
        plan.enriched = metadata ? metadata.entries.length : 0;
        state.convPlan = plan; state.convSnapshot = snapshotOf(planParas(plan));
        renderConvPlan(plan);
        $('btnConvApply').disabled = !!plan.managedBlock || !(plan.edits.length || plan.references.lines.length) || source === target && !plan.edits.length;
      });
    }).catch(function (e) { out.innerHTML = '<div class="blocked">' + esc(errMsg(e)) + '</div>'; });
  }
  // Item daftar "Perlu perhatian" — selalu menyebut entri, alasannya, dan tombol Lihat.
  function failedItem(f) {
    return { badge: 'Tidak terbaca', tone: 'bad', text: f.text, reason: f.reason + '. Entri ini tidak diubah dan akan disorot kuning.', para: f.paraIndex };
  }
  function problemList(items) {
    return '<div class="list problems">' + items.map(function (it) {
      var loc = it.para != null ? ' data-para="' + it.para + '"' + (it.orig ? ' data-orig="' + esc(it.orig) + '" data-occ="' + (it.occ || 0) + '"' : '') : '';
      return '<div class="it prob ' + it.tone + '"><div class="prob-head"><span class="tag ' + it.tone + '">' + esc(it.badge) + '</span>' +
        (it.para != null ? '<button class="ghost small" data-act="goto"' + loc + '>Lihat</button>' : '') + '</div>' +
        '<div class="prob-text">' + esc(it.text.length > 180 ? it.text.slice(0, 180) + '…' : it.text) + '</div>' +
        '<div class="prob-why">' + esc(it.reason) + '</div></div>';
    }).join('') + '</div>';
  }
  function renderConvPlan(plan) {
    var c = plan.counts, L = plan.references.lines;
    var problems = [];
    (plan.failedRefs || []).forEach(function (f) { problems.push(failedItem(f)); });
    L.filter(function (l) { return l.status === 'risky'; }).forEach(function (l) {
      problems.push({ badge: 'Gagal dibaca dengan benar', tone: 'bad', text: l.original, para: l.paraIndex,
        reason: 'Nama penulis "' + l.lostNames.join(', ') + '" hilang saat dibaca, jadi entri ini TIDAK dikonversi (teks asli dipertahankan & disorot kuning). Biasanya karena format penulisnya campuran.' });
    });
    plan.unmatched.forEach(function (u) {
      problems.push({ badge: u.crossFamily ? 'Gaya campuran' : 'Sitasi tak cocok', tone: 'warn', text: u.raw, para: u.paraIndex, orig: u.raw, occ: u.occurrence,
        reason: (u.note || '') + ' Sitasi ini dibiarkan seperti aslinya.' });
    });
    L.filter(function (l) { return l.status === 'review'; }).forEach(function (l) {
      problems.push({ badge: 'Perlu dicek', tone: 'warn', text: l.original, para: l.paraIndex,
        reason: l.notes.filter(function (n) { return !/Singkatan jurnal dibentuk|Pastikan jenis sumber/.test(n); }).join(' ') + ' Entri tetap dikonversi.' });
    });
    if (plan.skippedEdits) problems.push({ badge: 'Dilewati', tone: 'warn', text: plan.skippedEdits + ' sitasi', reason: 'Sitasi melintasi batas paragraf sehingga tidak bisa diganti otomatis.' });

    var h = '';
    if (plan.managedBlock) h += '<div class="blocked info">' + esc(plan.managedBlock.message) + '</div>';
    else if (plan.managedNote) h += '<div class="blocked info">' + esc(plan.managedNote) + '</div>';
    h += '<div class="conv-summary"><b>' + c.converted + ' dari ' + c.total + '</b> referensi ' + (plan.managedBlock ? 'bisa dikonversi oleh pengelola sitasinya' : 'siap dikonversi') +
      (c.review ? ' · <span class="warn-t">' + c.review + ' perlu dicek</span>' : '') +
      (c.risky + c.failed ? ' · <span class="bad-t">' + (c.risky + c.failed) + ' tidak dikonversi</span>' : '') + '</div>';
    h += '<div class="stat-row"><span class="stat"><b>' + plan.edits.length + '</b> sitasi diubah</span>' +
      (plan.unmatched.length ? '<span class="stat"><b>' + plan.unmatched.length + '</b> sitasi tak cocok</span>' : '') +
      (plan.enriched ? '<span class="stat"><b>' + plan.enriched + '</b> dilengkapi CrossRef</span>' : '') + '</div>';
    if (problems.length) h += '<div class="h">Perlu perhatian (' + problems.length + ')</div>' + problemList(problems);
    else h += '<div class="verified">Semua referensi dan sitasi bisa dikonversi.</div>';
    if (plan.edits.length) {
      h += '<details class="sect"><summary class="h">Sitasi dalam teks (' + plan.edits.length + ')</summary><div class="list">' + plan.edits.map(function (e) {
        return '<div class="it"><span class="del">' + esc(e.original) + '</span> <span class="to">→</span> <span class="ins">' + esc(e.replacement) + '</span></div>';
      }).join('') + '</div></details>';
    }
    var STAT = { ok: ['✓', 'Siap'], review: ['!', 'Perlu dicek'], risky: ['✕', 'Tidak dikonversi'] };
    h += '<details class="sect" open><summary class="h">Daftar pustaka ' + STYLE_NAME[plan.target] + ' (' + L.length + ')</summary><div class="list">' + L.map(function (l) {
      var st = STAT[l.status];
      return '<div class="it ref-' + l.status + '"><span class="dot ' + l.status + '" title="' + st[1] + '">' + st[0] + '</span> ' + runsHtml(l.runs) +
        (l.wasCited ? '' : ' <em class="ctx">(tidak disitasi)</em>') +
        (l.enriched.length ? '<div class="enr">Dilengkapi CrossRef: ' + esc(l.enriched.join(', ')) + ' — cek di situs penerbit bila ragu.</div>' : '') + '</div>';
    }).join('') + (plan.failedRefs || []).map(function (f) {
      return '<div class="it ref-risky"><span class="dot risky" title="Tidak terbaca">✕</span> <span class="ctx">' + esc(f.text) + '</span></div>';
    }).join('') + '</div></details>';
    $('convResult').innerHTML = h;
  }
  function convApply() {
    var plan = state.convPlan; if (!plan || plan.managedBlock) return;
    $('btnConvApply').disabled = true;
    setStatus('Menerapkan konversi…', 'busy');
    freshManaged().then(function () {
      var again = CM ? CM.guardConversion(plan, state.managed, state.st) : plan;
      if (again.managedBlock) throw new Error(again.managedBlock.message);
      plan = again;
      state.suppressUntil = Date.now() + 5000;
      return WB.applyConversion(plan, state.convSnapshot, { track: settings.track, hangingIndent: $('cvHang').checked });
    }).then(function (r) {
      toast('Konversi ke ' + STYLE_NAME[plan.target] + ' selesai');
      $('styleSel').value = plan.target;
      state.convPlan = null;
      var notConv = plan.counts.risky + plan.counts.failed;
      $('convResult').innerHTML = '<div class="verified">' + r.applied + ' sitasi dan ' + (plan.references.lines.length - plan.counts.risky) + ' referensi dikonversi ke ' + STYLE_NAME[plan.target] + '.' +
        (r.skipped ? ' ' + r.skipped + ' sitasi dilewati.' : '') + '</div>' +
        (notConv ? '<div class="blocked">' + notConv + ' referensi tidak dikonversi dan disorot kuning di dokumen. Perbaiki penulisannya, lalu jalankan konversi lagi — tab Validator menunjukkan entri yang masih bermasalah.</div>' : '');
      return runCheck({ force: true }).then(function () { if ($('cvLink').checked) return linkApply(); });
    }).catch(function (e) { setStatus(errMsg(e), 'err'); $('btnConvApply').disabled = false; });
  }

  // ================= LAPORAN KOMENTAR =================
  function reportMode() { var r = document.querySelector('input[name=rpMode]:checked'); return r ? r.value : 'inplace'; }
  function reportSuggestions() { return state.suggestions.filter(function (s) { return !dismissed.has(s.key) && !s.quiet; }); }
  function buildReport() {
    if (!state.st || !RC) return null;
    return RC.build(state.st, reportSuggestions(), {
      includeErrors: $('rpErr').checked, includeSuggestions: $('rpSug').checked, includeYears: $('rpYear').checked, includeDoi: $('rpDoi').checked,
      years: settings.years, references: state.result ? state.result.references : [], online: settings.online ? state.online : null,
      styleId: state.styleId, managed: state.managed, rawTexts: state.paras ? state.paras.map(function (p) { return p.text; }) : null
    });
  }
  function renderReportCounts() {
    var rep = buildReport();
    var c = rep ? rep.counts : null;
    $('rpErrN').textContent = c ? c.error : '–'; $('rpSugN').textContent = c ? c.suggestion : '–';
    $('rpYearN').textContent = c ? c.year : '–';
    $('rpDoiN').textContent = !settings.online ? 'Mati' : state.onlineTotal && state.onlineDone < state.onlineTotal ? state.onlineDone + '/' + state.onlineTotal : (c ? c.doi : '–');
    return rep;
  }
  var SW = { Red: 'red', Yellow: 'yellow', Turquoise: 'cyan' };
  function reportPreviewHtml(rep) {
    var h = '<div class="stat-row"><span class="stat"><b>' + rep.items.length + '</b> komentar</span>' +
      (rep.total !== rep.items.length ? '<span class="stat"><b>' + rep.total + '</b> temuan (lokasi sama digabung)</span>' : '') +
      (rep.managed ? '<span class="stat"><b>' + rep.managed + '</b> di luar field ' + esc(CM.nameOf(state.managed.primary)) + '</span>' : '') + '</div>';
    if (settings.online && state.onlineTotal && state.onlineDone < state.onlineTotal && $('rpDoi').checked) h += '<div class="blocked info">Cek DOI masih berjalan (' + state.onlineDone + '/' + state.onlineTotal + '). DOI yang belum selesai dicek tidak ikut di laporan ini.</div>';
    if (rep.unanchored) h += '<div class="blocked">' + rep.unanchored + ' temuan tidak bisa ditempel tanpa menyentuh field pengelola sitasi, jadi tidak dimasukkan.</div>';
    if (!rep.items.length) return h + '<div class="empty">Tidak ada temuan untuk kategori yang dicentang.</div>';
    h += '<div class="list">' + rep.items.slice(0, 80).map(function (it, i) {
      var body = it.comment.replace(RC.PREFIX, '').trim();
      return '<div class="it rp-item"><span class="sw ' + (it.color ? SW[it.color] || 'yellow' : 'none') + '" title="' + (it.color ? 'Disorot' : 'Tidak disorot') + '"></span>' +
        '<div class="rp-body"><div class="rp-anchor">“' + esc(it.text.length > 70 ? it.text.slice(0, 70) + '…' : it.text) + '”</div><div class="rp-text">' + esc(body.length > 320 ? body.slice(0, 320) + '…' : body) + '</div></div>' +
        '<button class="ghost small" data-rp="' + i + '" type="button">Lihat</button></div>';
    }).join('') + (rep.items.length > 80 ? '<div class="it ctx">… dan ' + (rep.items.length - 80) + ' komentar lainnya</div>' : '') + '</div>';
    return h;
  }
  function reportPreview() {
    return ensureFresh().then(function () {
      var rep = renderReportCounts();
      state.report = rep;
      $('reportResult').innerHTML = rep ? reportPreviewHtml(rep) : '';
      return rep;
    });
  }
  function reportApply() {
    var out = $('reportResult'), btn = $('btnReportApply');
    btn.disabled = true;
    setStatus('Menyiapkan laporan…', 'busy');
    var mode = reportMode();
    ensureFresh().then(freshManaged).then(function () {
      var rep = renderReportCounts();
      state.report = rep;
      if (!rep || !rep.items.length) { out.innerHTML = rep ? reportPreviewHtml(rep) : ''; setStatus('Tidak ada temuan untuk dijadikan komentar.'); return; }
      var hl = $('rpHl').checked;
      if (mode === 'copy') return reportCopy(rep, hl);
      setStatus('Menambahkan ' + rep.items.length + ' komentar…', 'busy');
      state.suppressUntil = Date.now() + 6000;
      return WB.insertReport(rep.items, { highlight: hl, replace: true }).then(function (r) {
        setStatus(r.added + ' komentar ditambahkan.');
        out.innerHTML = '<div class="verified">' + r.added + ' komentar ditambahkan ke dokumen ini' + (r.removed ? ' (menggantikan ' + r.removed + ' komentar Cek Sitasi sebelumnya)' : '') +
          '. Buka <b>Tinjau › Tampilkan Komentar</b> untuk membacanya.</div>' +
          (r.approximate ? '<div class="blocked">' + r.approximate + ' komentar ditempel di seluruh paragraf karena teks persisnya tidak ditemukan.</div>' : '') +
          (r.failed ? '<div class="blocked">' + r.failed + ' komentar gagal ditambahkan.</div>' : '') + reportPreviewHtml(rep);
        toast('Laporan komentar dibuat');
      }, function (e) {
        if (e && e.code === 'CommentsUnsupported') {
          var r = document.querySelector('input[name=rpMode][value=copy]');
          if (r && !r.disabled) { r.checked = true; settings.reportMode = 'copy'; saveSettings(); out.innerHTML = '<div class="blocked">' + esc(e.message) + ' Dokumen tidak diubah — <b>Salinan berkomentar</b> sudah dipilih, klik lagi "Buat laporan komentar".</div>'; setStatus('Beralih ke salinan berkomentar.', 'err'); return; }
        }
        throw e;
      });
    }).catch(function (e) {
      setStatus(errMsg(e), 'err');
      out.insertAdjacentHTML('afterbegin', '<div class="blocked">' + esc(errMsg(e)) + '</div>');
    }).then(function () { btn.disabled = false; });
  }
  function reportCopy(rep, hl) {
    var out = $('reportResult');
    if (!WB.canReadFile || !WB.canReadFile()) throw new Error('Word versi ini tidak mengizinkan add-in membaca file dokumen. Pilih "Dokumen ini".');
    setStatus('Membaca dokumen…', 'busy');
    var items = hl ? rep.items : rep.items.map(function (it) { return Object.assign({}, it, { color: null }); });
    return WB.readDocxFile().then(function (bytes) {
      setStatus('Menulis komentar ke salinan…', 'busy');
      return window.DocxCommenter.commentDocx(bytes, items, state.paras);
    }).then(function (res) {
      state.lastReportBase64 = res.base64;
      var info = '<div class="verified">' + res.added + ' komentar ditulis ke salinan' + (res.failed ? ' (' + res.failed + ' lokasi tidak ditemukan)' : '') + '. Naskah ini tidak diubah.</div>';
      setStatus('Membuka salinan berkomentar…', 'busy');
      return WB.openNewDocument(res.base64).then(function () {
        setStatus('Salinan berkomentar dibuka di jendela baru — simpan dengan nama baru.');
        out.innerHTML = info + '<p class="fine">Salinan dibuka di jendela Word baru. Simpan dengan nama baru (mis. <i>naskah-berkomentar.docx</i>).</p>' + reportPreviewHtml(rep);
        toast('Salinan berkomentar dibuka');
      }, function (err) {
        setStatus('Word tidak bisa membuka dokumen baru otomatis.', 'err');
        out.innerHTML = info + '<div class="blocked">Word menolak membuka dokumen baru (' + esc(errMsg(err)) + '). <button class="ghost small" id="btnDlReport" type="button">Unduh .docx berkomentar</button></div>' + reportPreviewHtml(rep);
      });
    });
  }
  function reportRemove() {
    setStatus('Menghapus komentar…', 'busy');
    state.suppressUntil = Date.now() + 4000;
    WB.removeReport().then(function (n) {
      setStatus(n ? n + ' komentar Cek Sitasi dihapus.' : 'Tidak ada komentar Cek Sitasi di dokumen ini.');
      $('reportResult').innerHTML = '';
    }).catch(function (e) { setStatus(errMsg(e), 'err'); });
  }
  function downloadBase64(b64, name) {
    if (!b64) return;
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }
  function onReportClick(e) {
    if (e.target && e.target.id === 'btnDlReport') { downloadBase64(state.lastReportBase64, 'naskah-berkomentar.docx'); return; }
    var b = e.target.closest('[data-rp]'); if (!b || !state.report) return;
    var it = state.report.items[+b.dataset.rp]; if (!it) return;
    var sel = it.whole || !it.text ? { kind: 'paragraph', paraIndex: it.paraIndex } : { kind: 'replace', paraIndex: it.paraIndex, original: it.head || it.text, occurrence: it.head ? it.headOccurrence : it.occurrence };
    WB.select(sel).catch(function (err) { setStatus(errMsg(err), 'err'); });
  }
  function syncReportMode() {
    $('btnReportApply').textContent = reportMode() === 'copy' ? 'Buat salinan berkomentar' : 'Buat laporan komentar';
  }

  // ================= INISIALISASI =================
  var debounceTimer;
  function onDocChanged(info) {
    if (!settings.auto || Date.now() < state.suppressUntil) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { runCheck({ silent: true }); }, info && info.selectionOnly ? 2500 : 1500);
  }

  function bind() {
    $('btnCheck').addEventListener('click', function () { runCheck({ force: true }); });
    $('styleSel').addEventListener('change', function () { state.online = {}; runCheck({ force: true }); });
    document.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });
    document.querySelector('.tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var tabs = Array.from(document.querySelectorAll('.tab')); var i = tabs.indexOf(document.activeElement); if (i < 0) return;
      var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); showTab(n.dataset.tab);
    });
    $('filters').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (!c) return; state.filter = c.dataset.filter; renderAll(); });
    $('cards').addEventListener('click', onCardClick);
    $('btnAcceptAll').addEventListener('click', acceptAll);
    $('btnLinkPreview').addEventListener('click', function () { linkPreview().catch(function (e) { setStatus(errMsg(e), 'err'); }); });
    $('btnLinkApply').addEventListener('click', linkApply);
    document.querySelectorAll('input[name=lkMode]').forEach(function (r) { r.addEventListener('change', function () { settings.linkMode = linkMode(); saveSettings(); syncLinkMode(); }); });
    $('linkResult').addEventListener('click', function (e) { if (e.target && e.target.id === 'btnDlLinked') downloadLinked(); });
    $('metaList').addEventListener('click', onMetaClick);
    $('mFilters').addEventListener('click', function (e) { var c = e.target.closest('.chip'); if (!c) return; state.metaFilter = c.dataset.mf; renderMeta(); });
    $('mYears').value = String(settings.years);
    $('mYears').addEventListener('change', function () { settings.years = +$('mYears').value; $('rpYears').value = String(settings.years); saveSettings(); renderMeta(); });
    $('btnScopus').addEventListener('click', function () { settings.scopus = true; saveSettings(); loadScopus(); });
    $('sumOnlBtn').addEventListener('click', function () { showTab('meta'); });
    $('btnUnlink').addEventListener('click', unlink);
    $('btnConvPreview').addEventListener('click', convPreview);
    $('btnConvApply').addEventListener('click', convApply);
    $('convResult').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act=goto]'); if (!b) return;
      var item = b.dataset.orig ? { kind: 'replace', paraIndex: +b.dataset.para, original: b.dataset.orig, occurrence: +b.dataset.occ } : { kind: 'paragraph', paraIndex: +b.dataset.para };
      WB.select(item).catch(function (err) { setStatus(errMsg(err), 'err'); });
    });
    $('cvTo').addEventListener('change', function () { state.convPlan = null; $('btnConvApply').disabled = true; });
    $('btnReportShortcut').addEventListener('click', function () { showTab('report'); reportPreview().catch(function (e) { setStatus(errMsg(e), 'err'); }); });
    $('btnReportPreview').addEventListener('click', function () { reportPreview().catch(function (e) { setStatus(errMsg(e), 'err'); }); });
    $('btnReportApply').addEventListener('click', reportApply);
    $('btnReportRemove').addEventListener('click', reportRemove);
    $('reportResult').addEventListener('click', onReportClick);
    ['rpErr', 'rpSug', 'rpYear', 'rpDoi'].forEach(function (id) { $(id).addEventListener('change', function () { renderReportCounts(); if ($('reportResult').innerHTML) reportPreview(); }); });
    $('rpHl').checked = settings.reportHl !== false;
    $('rpHl').addEventListener('change', function () { settings.reportHl = $('rpHl').checked; saveSettings(); });
    $('rpYears').value = String(settings.years);
    $('rpYears').addEventListener('change', function () { settings.years = +$('rpYears').value; $('mYears').value = String(settings.years); saveSettings(); renderReportCounts(); renderMeta(); });
    document.querySelectorAll('input[name=rpMode]').forEach(function (r) { r.addEventListener('change', function () { settings.reportMode = reportMode(); saveSettings(); syncReportMode(); }); });
    [['setAuto', 'auto'], ['setUnderline', 'underline'], ['setOnline', 'online'], ['setTrack', 'track']].forEach(function (x) {
      var el = $(x[0]); el.checked = !!settings[x[1]];
      el.addEventListener('change', function () {
        settings[x[1]] = el.checked; saveSettings();
        if (x[1] === 'underline') refreshAnnotations();
        if (x[1] === 'online') { renderAll(); runOnline(); }
      });
    });
  }

  function start(hostOk) {
    bind();
    if (!hostOk) { setStatus('Buka panel ini dari Microsoft Word.', 'err'); return; }
    var caps = WB.caps();
    if (!caps.api14) {
      var tr = $('setTrack'); tr.checked = false; tr.disabled = true; settings.track = false;
      tr.parentNode.appendChild(document.createTextNode(' — butuh Word 2021 / Microsoft 365'));
      $('inplaceNote').textContent = 'Word versi ini belum punya bookmark API (WordApi 1.4); dicoba lewat mode kompatibilitas — bila gagal, otomatis beralih ke salinan tertaut.';
    }
    // Word di web tidak bisa membaca file .docx lewat add-in → pakai cara langsung.
    var canCopy = WB.canReadFile ? WB.canReadFile() : false;
    var mode = settings.linkMode || (caps.api14 && !canCopy ? 'inplace' : (caps.api14 ? 'inplace' : 'copy'));
    if (!canCopy) { mode = 'inplace'; document.querySelector('input[name=lkMode][value=copy]').disabled = true; }
    document.querySelector('input[name=lkMode][value=' + mode + ']').checked = true;
    syncLinkMode();
    // Laporan komentar: langsung di dokumen butuh API komentar (WordApi 1.4); kalau tidak, salinan.
    var rpMode = settings.reportMode || (caps.comments ? 'inplace' : 'copy');
    if (!caps.comments) {
      rpMode = 'copy';
      document.querySelector('input[name=rpMode][value=inplace]').disabled = true;
      $('rpInplaceNote').textContent = 'Butuh Word 2021 / Microsoft 365 / Word di web (API komentar). Di Word ini, pakai salinan berkomentar.';
      $('btnReportRemove').disabled = true;
    }
    if (!canCopy) {
      rpMode = caps.comments ? 'inplace' : rpMode;
      document.querySelector('input[name=rpMode][value=copy]').disabled = true;
      $('rpCopyNote').textContent = 'Word ini tidak mengizinkan add-in membaca file .docx (mis. Word di web) — pakai "Dokumen ini".';
    }
    document.querySelector('input[name=rpMode][value=' + rpMode + ']').checked = true;
    syncReportMode();
    WB.onAnnotationEvents({ clicked: onAnnotationClicked, popup: onAnnotationPopup });
    WB.onDocumentChanged(onDocChanged);
    runCheck({ force: true });
  }

  if (window.Office && Office.onReady && !window.CEK_SITASI_DEMO) {
    Office.onReady(function (info) {
      // Tema selalu terang, apa pun tema Office/sistem operasi.
      document.documentElement.dataset.theme = 'light';
      start(info.host === Office.HostType.Word);
    });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { start(true); });
  } else start(true);
})();
