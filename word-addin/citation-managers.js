/* ============================================================
   CITATION MANAGERS — mengenali sitasi & daftar pustaka yang dikelola Zotero, Mendeley,
   EndNote, Citavi, RefWorks, atau fitur sitasi bawaan Word, lalu melindunginya.

   Masalahnya: sitasi buatan pengelola referensi adalah FIELD (Zotero, Mendeley Desktop,
   EndNote) atau CONTENT CONTROL (Mendeley Cite, Citavi). Bila add-in menulis langsung ke
   dalamnya (Terima saran, Konversi, Urutkan, Tautkan), field-nya rusak atau isinya ditimpa
   lagi saat pengelola sitasi "Refresh" — dan Zotero/Mendeley lalu menanyakan apakah
   perubahan manual mau dipertahankan. Modul ini:
     1. memindai OOXML badan dokumen (body.getOoxml(), tersedia sejak Word 2016) dan
        mencatat teks mana yang berada di dalam field/content control pengelola sitasi;
     2. memetakan temuan itu ke paragraf Word (dicocokkan lewat teks, bukan offset internal);
     3. menandai saran, rencana tautan, dan rencana konversi yang menyentuh bagian tersebut
        supaya tidak diterapkan otomatis — cukup dilaporkan, dengan petunjuk perbaikan
        lewat pengelola sitasinya.

   Murni: tanpa Office.js dan tanpa DOM, bisa diuji di Node (test/citation-managers.test.js).
   ============================================================ */
(function (root) {
  'use strict';

  // Urutan penting: aturan daftar pustaka dicek sebelum aturan sitasi.
  var RULES = [
    [/ZOTERO_BIBL/i, 'Zotero', 'bibliography'],
    [/ZOTERO_/i, 'Zotero', 'citation'],
    [/Mendeley\s+Bibliography|CSL_BIBLIOGRAPHY|MENDELEY_BIBLIOGRAPHY/i, 'Mendeley', 'bibliography'],
    [/MENDELEY|CSL_CITATION/i, 'Mendeley', 'citation'],
    [/EN\.REFLIST/i, 'EndNote', 'bibliography'],
    [/EN\.CITE/i, 'EndNote', 'citation'],
    [/CITAVI[._]?BIBLIOGRAPHY|CitaviBibliography/i, 'Citavi', 'bibliography'],
    [/CITAVI/i, 'Citavi', 'citation'],
    [/RW\.BIB|REFWORKS[._]?BIB/i, 'RefWorks', 'bibliography'],
    [/RW\.CITE|REFWORKS/i, 'RefWorks', 'citation'],
    [/PAPERS2_/i, 'Papers', 'citation'],
    [/^\s*BIBLIOGRAPHY\b/, 'Word', 'bibliography'],
    [/^\s*CITATION\b/, 'Word', 'citation']
  ];
  function classify(code) {
    var s = String(code || '');
    if (!s.trim()) return null;
    for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(s)) return { manager: RULES[i][1], kind: RULES[i][2] };
    return null;
  }

  var MANAGER_NAME = { Zotero: 'Zotero', Mendeley: 'Mendeley', EndNote: 'EndNote', Citavi: 'Citavi', RefWorks: 'RefWorks', Papers: 'Papers', Word: 'fitur Sitasi bawaan Word' };

  // Petunjuk perbaikan per pengelola sitasi.
  var FIX = {
    Zotero: { citation: 'klik sitasinya, lalu tab Zotero → Add/Edit Citation; atau perbaiki data item di pustaka Zotero lalu klik Refresh', bibliography: 'perbaiki data item di pustaka Zotero (penulis, judul, jurnal, DOI), lalu klik Refresh di tab Zotero', style: 'tab Zotero → Document Preferences → pilih gaya APA 7th atau IEEE' },
    Mendeley: { citation: 'edit sitasinya lewat Mendeley Cite (atau tab References → Mendeley Cite-O-Matic), lalu Refresh', bibliography: 'perbaiki data referensinya di Mendeley, lalu perbarui daftar pustaka lewat Mendeley Cite (Refresh)', style: 'Mendeley Cite → Citation Style → pilih APA 7th edition atau IEEE' },
    EndNote: { citation: 'tab EndNote → Edit & Manage Citation(s)', bibliography: 'perbaiki data referensinya di pustaka EndNote, lalu tab EndNote → Update Citations and Bibliography', style: 'tab EndNote → Style → pilih APA 7th atau IEEE' },
    Citavi: { citation: 'edit sitasinya lewat Citavi Assistant', bibliography: 'perbaiki data referensinya di proyek Citavi, lalu perbarui dokumen lewat Citavi Assistant', style: 'Citavi Assistant → pilih gaya sitasi APA 7 atau IEEE' },
    RefWorks: { citation: 'edit sitasinya lewat RefWorks Citation Manager', bibliography: 'perbaiki data referensinya di RefWorks, lalu perbarui daftar pustaka', style: 'RefWorks Citation Manager → pilih gaya APA 7 atau IEEE' },
    Papers: { citation: 'edit sitasinya lewat Papers', bibliography: 'perbaiki data referensinya di Papers, lalu perbarui daftar pustaka', style: 'pilih gaya APA 7 atau IEEE di Papers' },
    Word: { citation: 'klik sitasinya → Edit Citation, atau References → Manage Sources (Kelola Sumber)', bibliography: 'References → Manage Sources (Kelola Sumber), lalu klik daftar pustaka → Update Citations and Bibliography', style: 'References → Style → pilih APA atau IEEE' }
  };
  function fixFor(manager, what) { return (FIX[manager] || FIX.Zotero)[what]; }
  function nameOf(manager) { return MANAGER_NAME[manager] || manager; }

  // Catatan singkat per kartu saran; alasan lengkapnya ada di pemberitahuan atas panel.
  function advice(manager, kind) {
    var n = nameOf(manager);
    if (kind === 'bibliography') return 'Daftar pustaka buatan ' + n + ' — tidak diubah otomatis agar tidak ditimpa saat Refresh. Perbaiki: ' + fixFor(manager, 'bibliography') + '.';
    return 'Sitasi buatan ' + n + ' — tidak diubah otomatis agar field-nya tidak rusak. Perbaiki: ' + fixFor(manager, 'citation') + '.';
  }

  // ---------- PEMINDAI OOXML (berbasis string, tanpa DOM) ----------
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function decode(s) {
    return s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === '#') { var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isNaN(n) ? m : String.fromCodePoint(n); }
      return ENT[e] != null ? ENT[e] : m;
    });
  }
  function attr(attrs, name) {
    var m = new RegExp('\\b' + name.replace(/[.:]/g, '\\$&') + '="([^"]*)"').exec(attrs) || new RegExp('\\b' + name.replace(/[.:]/g, '\\$&') + "='([^']*)'").exec(attrs);
    return m ? decode(m[1]) : null;
  }

  // Hasil: { paragraphs: [{ text, segs: [{ start, end, text, manager, kind }] }],
  //          managers: { Zotero: { citations, bibliography } }, found }
  // Paragraf dihitung dengan urutan yang sama seperti body.paragraphs di Word: termasuk
  // paragraf di tabel & content control, tanpa kotak teks (w:txbxContent) dan tanpa
  // salinan cadangan (mc:Fallback).
  function scanOoxml(xml) {
    var src = String(xml || '');
    var b0 = src.indexOf('<w:body'), b1 = src.lastIndexOf('</w:body>');
    if (b0 >= 0) src = src.slice(b0, b1 > b0 ? b1 : src.length);
    var TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.-]*(?::[\w.-]+)?)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
    var paras = [], cur = null, skip = 0, inRun = 0, inText = false, inInstr = false, inSdtPr = 0;
    var fields = [], sdts = [], bookmarks = {}, managers = {};
    function note(c) {
      if (!c) return;
      var m = managers[c.manager] || (managers[c.manager] = { citations: 0, bibliography: false });
      if (c.kind === 'bibliography') m.bibliography = true; else m.citations++;
    }
    function active() {
      var best = null;
      function consider(c) { if (c && (!best || c.kind === 'bibliography')) best = c; }
      fields.forEach(function (f) { consider(f.cls); });
      sdts.forEach(function (s) { consider(s.cls); });
      Object.keys(bookmarks).forEach(function (k) { consider(bookmarks[k]); });
      return best;
    }
    function visible() { for (var i = 0; i < fields.length; i++) if (fields[i].phase !== 'result') return false; return true; }
    function addText(t) {
      if (!cur || !t || !visible()) return;
      var c = active(), start = cur.text.length;
      cur.text += t;
      if (!c) return;
      var last = cur.segs[cur.segs.length - 1];
      if (last && last.end === start && last.manager === c.manager && last.kind === c.kind) { last.end += t.length; last.text += t; }
      else cur.segs.push({ start: start, end: start + t.length, text: t, manager: c.manager, kind: c.kind });
    }
    var m;
    while ((m = TOKEN.exec(src))) {
      if (m[5] != null) {
        if (skip) continue;
        if (inText) addText(decode(m[5]));
        else if (inInstr && fields.length) fields[fields.length - 1].code += decode(m[5]);
        continue;
      }
      if (!m[2]) continue; // komentar / instruksi pemrosesan
      var close = m[1] === '/', name = m[2], attrs = m[3] || '', selfClose = m[4] === '/';
      if (name === 'w:txbxContent' || name === 'mc:Fallback') {
        if (selfClose) continue;
        skip += close ? -1 : 1; if (skip < 0) skip = 0;
        continue;
      }
      if (skip) continue;
      switch (name) {
        case 'w:p':
          if (close) { if (cur) { paras.push(cur); cur = null; } }
          else if (selfClose) paras.push({ text: '', segs: [] });
          else cur = { text: '', segs: [] };
          break;
        case 'w:r':
          if (!selfClose) inRun += close ? -1 : 1;
          break;
        case 'w:t':
          inText = !close && !selfClose;
          break;
        case 'w:instrText':
          inInstr = !close && !selfClose;
          break;
        case 'w:tab':
          if (inRun && !close) addText('\t');
          break;
        case 'w:br': case 'w:cr':
          if (inRun && !close) addText('\u000b');
          break;
        case 'w:noBreakHyphen':
          if (inRun && !close) addText('-');
          break;
        case 'w:fldChar':
          var type = attr(attrs, 'w:fldCharType');
          if (type === 'begin') fields.push({ code: '', phase: 'code', cls: null, counted: false });
          else if (type === 'separate' && fields.length) {
            var f = fields[fields.length - 1]; f.phase = 'result'; f.cls = classify(f.code);
            if (!f.counted) { note(f.cls); f.counted = true; }
          } else if (type === 'end' && fields.length) {
            var g = fields.pop(); if (!g.counted) note(classify(g.code));
          }
          break;
        case 'w:fldSimple':
          if (selfClose) { note(classify(attr(attrs, 'w:instr'))); break; }
          if (close) { if (fields.length) fields.pop(); }
          else { var cs = classify(attr(attrs, 'w:instr')); note(cs); fields.push({ code: attr(attrs, 'w:instr') || '', phase: 'result', cls: cs, counted: true }); }
          break;
        case 'w:sdt':
          if (close) { var s = sdts.pop(); if (s && s.cls && !s.counted) note(s.cls); }
          else if (!selfClose) sdts.push({ cls: null, counted: false });
          break;
        case 'w:sdtPr':
          if (!selfClose) inSdtPr += close ? -1 : 1;
          break;
        case 'w:tag': case 'w:alias':
          if (inSdtPr && sdts.length && !close) { var top = sdts[sdts.length - 1], c2 = classify(attr(attrs, 'w:val')); if (c2 && (!top.cls || c2.kind === 'bibliography')) top.cls = c2; }
          break;
        case 'w:citation':
          if (inSdtPr && sdts.length && !sdts[sdts.length - 1].cls) sdts[sdts.length - 1].cls = { manager: 'Word', kind: 'citation' };
          break;
        case 'w:bibliography':
          if (inSdtPr && sdts.length) sdts[sdts.length - 1].cls = { manager: 'Word', kind: 'bibliography' };
          break;
        case 'w:docPartGallery':
          if (inSdtPr && sdts.length && /Bibliograph/i.test(attr(attrs, 'w:val') || '')) sdts[sdts.length - 1].cls = { manager: 'Word', kind: 'bibliography' };
          break;
        case 'w:bookmarkStart':
          var bn = attr(attrs, 'w:name') || '';
          if (/^ZOTERO_/i.test(bn)) { var bc = { manager: 'Zotero', kind: /BIBL/i.test(bn) ? 'bibliography' : 'citation' }; bookmarks[attr(attrs, 'w:id')] = bc; note(bc); }
          break;
        case 'w:bookmarkEnd':
          delete bookmarks[attr(attrs, 'w:id')];
          break;
      }
    }
    if (cur) paras.push(cur);
    return { paragraphs: paras, managers: managers, found: Object.keys(managers).length > 0 };
  }

  // ---------- PEMETAAN KE PARAGRAF WORD ----------
  function key(t) { return String(t || '').replace(/[\s\u0000-\u001f\u00a0\u200b-\u200d\u2028\u2029\ufeff]+/g, ''); }

  // Pasangkan setiap paragraf Word dengan paragraf hasil pindaian (urutan sama, teks sama).
  // Hasil: array sepanjang wordTexts berisi indeks paragraf pindaian, atau -1.
  function alignTexts(wordTexts, scanTexts) {
    var keys = scanTexts.map(key), out = [], j = 0;
    wordTexts.forEach(function (t) {
      var k = key(t), hit = -1;
      for (var x = j; x < Math.min(keys.length, j + 60); x++) if (keys[x] === k) { hit = x; break; }
      if (hit >= 0) j = hit + 1;
      out.push(hit);
    });
    return out;
  }

  var ADDIN_RE = /\bADDIN\s+(?:ZOTERO_|CSL_|Mendeley|EN\.|CITAVI|RW\.|PAPERS2_)/i;

  // managed: { found, managers, primary, spans: { paraIndex: [{start,end,manager,kind}] }, codesVisible, mapped, unmapped }
  function mapToWord(wordTexts, scan) {
    var res = { found: false, managers: {}, primary: null, spans: {}, codesVisible: false, mapped: 0, unmapped: 0 };
    var texts = (wordTexts || []).map(function (t) { return typeof t === 'string' ? t : (t && t.text) || ''; });
    texts.forEach(function (t, i) {
      if (ADDIN_RE.test(t)) { res.codesVisible = true; res.spans[i] = [{ start: 0, end: t.length, manager: managerFromCode(t), kind: 'citation', codes: true }]; }
    });
    if (!scan || !scan.found) { res.found = res.codesVisible; finalize(res, scan); return res; }
    var align = alignTexts(texts, scan.paragraphs.map(function (p) { return p.text; }));
    align.forEach(function (j, i) {
      if (res.spans[i]) return;
      if (j < 0) { res.unmapped++; return; }
      var sp = scan.paragraphs[j], text = texts[i];
      if (!sp.segs.length) { res.mapped++; return; }
      var out = [], cursor = 0;
      sp.segs.forEach(function (sg) {
        var at = text.indexOf(sg.text, cursor);
        if (at < 0 && sg.text.trim()) at = text.indexOf(sg.text.trim(), cursor);
        if (at < 0) { out.push({ start: 0, end: text.length, manager: sg.manager, kind: sg.kind, approx: true }); return; }
        var len = at === text.indexOf(sg.text, cursor) ? sg.text.length : sg.text.trim().length;
        out.push({ start: at, end: at + len, manager: sg.manager, kind: sg.kind });
        cursor = at + len;
      });
      res.spans[i] = merge(out);
      res.mapped++;
    });
    finalize(res, scan);
    return res;
  }
  function managerFromCode(t) { var c = classify(String(t).replace(/^[\s\S]*?ADDIN\s+/i, '')); return c ? c.manager : 'Zotero'; }
  function merge(list) {
    list.sort(function (a, b) { return a.start - b.start; });
    var out = [];
    list.forEach(function (s) {
      var l = out[out.length - 1];
      if (l && s.start <= l.end && s.manager === l.manager) { l.end = Math.max(l.end, s.end); if (s.kind === 'bibliography') l.kind = 'bibliography'; }
      else out.push(Object.assign({}, s));
    });
    return out;
  }
  function finalize(res, scan) {
    var m = scan && scan.managers ? scan.managers : {};
    Object.keys(m).forEach(function (k) { res.managers[k] = Object.assign({}, m[k]); });
    Object.keys(res.spans).forEach(function (i) {
      res.spans[i].forEach(function (s) { if (!res.managers[s.manager]) res.managers[s.manager] = { citations: 0, bibliography: false }; });
    });
    var names = Object.keys(res.managers);
    names.sort(function (a, b) { return (res.managers[b].citations + (res.managers[b].bibliography ? 1000 : 0)) - (res.managers[a].citations + (res.managers[a].bibliography ? 1000 : 0)); });
    res.primary = names[0] || null;
    res.found = names.length > 0;
    res.bibliographyManager = names.filter(function (n) { return res.managers[n].bibliography; })[0] || null;
  }

  // ---------- KUERI ----------
  function spansIn(managed, paraIndex) { return managed && managed.spans && managed.spans[paraIndex] || []; }
  // Rentang terkelola yang bertumpang tindih dengan [start, end) di paragraf, atau null.
  function managedAt(managed, paraIndex, start, end) {
    var list = spansIn(managed, paraIndex);
    var e = end == null ? start + 1 : Math.max(end, start + 1);
    for (var i = 0; i < list.length; i++) if (list[i].start < e && list[i].end > start) return list[i];
    return null;
  }
  function managedPara(managed, paraIndex) { var l = spansIn(managed, paraIndex); return l.length ? l[0] : null; }

  // Paragraf daftar pustaka yang dikelola (sekurang-kurangnya satu entri) → pengelolanya.
  function managedReferences(managed, st) {
    if (!managed || !managed.found || !st) return null;
    for (var i = 0; i < st.refs.length; i++) { var s = managedPara(managed, st.refs[i].paraIndex); if (s) return s; }
    return null;
  }

  // Ganti teks kode field yang tampil (Alt+F9) dengan spasi supaya tidak dibaca sebagai
  // sitasi/referensi. Panjang teks tetap sama sehingga offset paragraf tidak bergeser.
  function maskFieldCodes(text) {
    var t = String(text || '');
    if (!ADDIN_RE.test(t)) return t;
    var out = t.split(''), re = /\bADDIN\s+\S+/gi, m;
    while ((m = re.exec(t))) {
      var i = m.index + m[0].length;
      // lompati teks sampai JSON pertama, lalu cari kurung kurawal penutupnya
      var j = t.indexOf('{', i), endAt = i;
      if (j >= 0 && j - i < 200) {
        var depth = 0, inStr = false;
        for (var k = j; k < t.length; k++) {
          var ch = t[k];
          if (inStr) { if (ch === '\\') k++; else if (ch === '"') inStr = false; continue; }
          if (ch === '"') inStr = true;
          else if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (!depth) { endAt = k + 1; break; } }
        }
        if (depth) endAt = t.length;
      }
      var tail = /^\s*(?:\\[*@#]\s*\S+\s*)*/.exec(t.slice(endAt));
      endAt += tail ? tail[0].length : 0;
      for (var p = m.index; p < endAt; p++) out[p] = ' ';
      re.lastIndex = endAt;
    }
    return out.join('');
  }

  // ---------- PERLINDUNGAN ----------
  var EDIT_KINDS = { replace: 1, paragraph: 1, italic: 1, append: 1 };
  // Tandai saran yang menyentuh bagian terkelola: tidak bisa "Terima", diberi petunjuk.
  function protectSuggestions(list, managed, st) {
    if (!managed || !managed.found) return list;
    var refManaged = managedReferences(managed, st);
    return list.map(function (s) {
      var hit = null;
      if (s.kind === 'replace' && s.paraIndex != null) hit = managedAt(managed, s.paraIndex, s.offset || 0, (s.offset || 0) + (s.length || 1));
      else if (EDIT_KINDS[s.kind] && s.paraIndex != null) hit = managedPara(managed, s.paraIndex);
      else if (s.kind === 'sort' || s.kind === 'restyle') hit = refManaged || (s.kind === 'restyle' && anyCitationManaged(managed) ? firstSpan(managed) : null);
      else if (s.paraIndex != null) hit = managedPara(managed, s.paraIndex);
      if (!hit) return s;
      var c = Object.assign({}, s);
      c.managedBy = hit.manager; c.managedKind = hit.kind;
      if (c.canApply || EDIT_KINDS[s.kind] || s.kind === 'sort' || s.kind === 'restyle') {
        c.canApply = false;
        c.blockedReason = s.kind === 'sort' ? 'Urutan daftar pustaka diatur oleh ' + nameOf(hit.manager) + ' sesuai gaya yang dipilih. Atur gayanya lewat ' + fixFor(hit.manager, 'style') + ', lalu perbarui.'
          : s.kind === 'restyle' ? 'Sitasi/daftar pustaka dikelola ' + nameOf(hit.manager) + ', jadi penomoran/gaya tidak diubah oleh add-in. Atur lewat ' + fixFor(hit.manager, 'style') + ', lalu perbarui.'
          : advice(hit.manager, hit.kind);
      }
      if (c.searchable) c.searchManaged = true;
      return c;
    });
  }
  function anyCitationManaged(managed) { return Object.keys(managed.spans || {}).some(function (k) { return managed.spans[k].some(function (s) { return s.kind === 'citation'; }); }); }
  function firstSpan(managed) { var k = Object.keys(managed.spans || {})[0]; return k != null ? managed.spans[k][0] : null; }

  // Rencana tautan langsung: lewati sitasi/entri terkelola (field-nya tidak disentuh).
  function filterLinkPlan(plan, managed) {
    if (!managed || !managed.found || !plan) return plan;
    var bookmarks = plan.bookmarks.filter(function (b) { return !managedPara(managed, b.paraIndex); });
    var ok = {}; bookmarks.forEach(function (b) { ok[b.refIndex] = true; });
    var skippedCitations = 0, skippedTargets = 0;
    var citationLinks = plan.citationLinks.filter(function (l) {
      if (managedAt(managed, l.paraIndex, l.offset, l.offset + l.length)) { skippedCitations++; return false; }
      if (!ok[l.refIndex]) { skippedTargets++; return false; }
      return true;
    });
    var externalLinks = plan.externalLinks.filter(function (l) { return !managedPara(managed, l.paraIndex); });
    var used = {}; citationLinks.forEach(function (l) { used[l.refIndex] = true; });
    return Object.assign({}, plan, {
      citationLinks: citationLinks, externalLinks: externalLinks,
      bookmarks: bookmarks.filter(function (b) { return used[b.refIndex]; }),
      managedSkipped: { citations: skippedCitations + skippedTargets, external: plan.externalLinks.length - externalLinks.length, bookmarks: plan.bookmarks.length - bookmarks.length, manager: managed.primary }
    });
  }

  // Rencana konversi: daftar pustaka terkelola → konversi diblokir (ubah gaya di pengelolanya);
  // sitasi terkelola → dilewati dan dilaporkan.
  function guardConversion(plan, managed, st) {
    if (!managed || !managed.found || !plan || plan.error) return plan;
    var refHit = managedReferences(managed, st);
    var kept = [], skipped = [];
    plan.edits.forEach(function (e) { (managedAt(managed, e.paraIndex, e.offset, e.offset + e.length) ? skipped : kept).push(e); });
    var out = Object.assign({}, plan, { edits: kept, managedSkippedEdits: skipped });
    if (refHit) {
      out.managedBlock = { manager: refHit.manager,
        message: 'Daftar pustaka naskah ini dibuat oleh ' + nameOf(refHit.manager) + '. Konversi langsung akan ditimpa saat ' + nameOf(refHit.manager) + ' memperbarui dokumen, dan bisa merusak field-nya. Ganti gayanya lewat ' + fixFor(refHit.manager, 'style') + ' — sitasi dan daftar pustaka akan dikonversi otomatis oleh ' + nameOf(refHit.manager) + '.' };
    } else if (skipped.length) {
      out.managedNote = skipped.length + ' sitasi dibuat oleh ' + nameOf(managed.primary) + ' dan tidak diubah. Ganti gayanya lewat ' + fixFor(managed.primary, 'style') + '.';
    }
    return out;
  }

  function summary(managed) {
    if (!managed || !managed.found) return '';
    var parts = Object.keys(managed.managers).map(function (k) {
      var m = managed.managers[k], bits = [];
      if (m.citations) bits.push(m.citations + ' sitasi');
      if (m.bibliography) bits.push('daftar pustaka');
      return nameOf(k) + (bits.length ? ' (' + bits.join(' + ') + ')' : '');
    });
    return parts.join(', ');
  }

  var api = {
    classify: classify, scanOoxml: scanOoxml, alignTexts: alignTexts, mapToWord: mapToWord,
    managedAt: managedAt, managedPara: managedPara, managedReferences: managedReferences, maskFieldCodes: maskFieldCodes,
    protectSuggestions: protectSuggestions, filterLinkPlan: filterLinkPlan, guardConversion: guardConversion,
    advice: advice, fixFor: fixFor, nameOf: nameOf, summary: summary, textKey: key
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CitationManagers = api;
})(typeof window !== 'undefined' ? window : this);
