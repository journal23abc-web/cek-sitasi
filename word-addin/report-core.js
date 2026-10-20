/* ============================================================
   REPORT CORE — "laporan dalam bentuk komentar" (setara fitur web "Naskah Asli dengan
   Highlight + Komentar Word" di cek-sitasi/upload.js).

   Mengubah hasil pemeriksaan (saran Validator, tahun referensi di luar rentang, DOI
   bermasalah) menjadi daftar komentar yang ditempel di lokasinya masing-masing:
     { paraIndex, offset, length, text, occurrence | whole | head/tail, color, comment }
   Bridge Word lalu menyorot rentang itu dan menyisipkan komentar Word asli
   (Tinjau › Komentar), atau DocxCommenter menuliskannya ke salinan .docx.

   Bagian yang dikelola Zotero/Mendeley tidak pernah disorot dan komentarnya tidak
   ditempel DI DALAM field-nya: komentar dipindah ke kata tepat sebelum/sesudah sitasi
   (atau ke judul daftar pustaka), supaya field pengelola sitasi tetap utuh.

   Murni: tanpa Office.js. Diuji di test/report.test.js.
   ============================================================ */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports;
  var AC = isNode ? require('./addin-core.js') : root.AddinCore;
  var CM = isNode ? require('./citation-managers.js') : root.CitationManagers;

  var PREFIX = '[Cek Sitasi]';
  // Warna sorotan sama dengan versi web: merah = perlu diperbaiki, kuning = tahun/DOI, sian = saran.
  var COLOR = { error: 'Red', year: 'Yellow', doi: 'Yellow', doiBad: 'Red', suggestion: 'Turquoise' };
  var RANK = { Red: 3, Yellow: 2, Turquoise: 1 };
  var MAX_PART = 700;

  function clip(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  function sentence(t) { t = String(t || '').trim(); return t && !/[.!?…]$/.test(t) ? t + '.' : t; }

  function suggestionComment(s) {
    var label = s.severity === 'error' ? 'Perlu diperbaiki' : 'Saran';
    var parts = [sentence(s.title)];
    if (s.reasons && s.reasons.length > 1) parts.push('Temuan: ' + s.reasons.map(function (r) { return r.title; }).join('; ') + '.');
    if (s.description) parts.push(sentence(s.description));
    if (s.replacement) parts.push('Saran perbaikan: ' + clip(s.replacement, 420));
    else if (s.hint) parts.push('Saran perbaikan: ' + clip(s.hint, 300));
    return label + ' — ' + clip(parts.join(' '), MAX_PART);
  }

  // Rentang [offset, offset+length) dipindah keluar dari field/content control pengelola sitasi.
  function anchorOutside(st, managed, item) {
    var span = CM.managedAt(managed, item.paraIndex, item.offset, item.offset + item.length);
    if (!span) return item;
    var text = st.paragraphs[item.paraIndex].text;
    var quoted = clip(text.slice(Math.max(span.start, item.offset), Math.min(span.end, item.offset + item.length)) || text.slice(span.start, span.end), 90);
    var where = span.kind === 'bibliography' ? 'Pada referensi “' + quoted + '” (daftar pustaka ' + CM.nameOf(span.manager) + ')'
      : 'Pada sitasi “' + quoted + '” (dikelola ' + CM.nameOf(span.manager) + ')';
    var how = ' Perbaiki lewat ' + CM.nameOf(span.manager) + ': ' + CM.fixFor(span.manager, span.kind === 'bibliography' ? 'bibliography' : 'citation') + '.';
    function tryRange(p, s0, e0) {
      if (e0 <= s0 || CM.managedAt(managed, p, s0, e0)) return null;
      return Object.assign({}, item, { paraIndex: p, offset: s0, length: e0 - s0, color: null, managed: span.manager,
        comment: where + ': ' + sentence(item.comment) + how });
    }
    var before = /(\S+)\s*$/.exec(text.slice(0, span.start));
    var got = before ? tryRange(item.paraIndex, before.index, before.index + before[1].length) : null;
    if (!got) {
      var after = /^(\s*)(\S+)/.exec(text.slice(span.end));
      if (after) got = tryRange(item.paraIndex, span.end + after[1].length, span.end + after[1].length + after[2].length);
    }
    if (!got && st.headingIndex >= 0) {
      var h = st.paragraphs[st.headingIndex].text, lead = h.length - h.replace(/^\s+/, '').length;
      got = tryRange(st.headingIndex, lead, h.replace(/\s+$/, '').length);
    }
    return got || Object.assign({}, item, { unanchored: true, managed: span.manager });
  }

  // opts: { includeErrors, includeSuggestions, includeYears, includeDoi, years, references, online,
  //         styleId, managed, rawTexts }
  function build(st, suggestions, opts) {
    var o = opts || {};
    var raw = [], counts = { error: 0, suggestion: 0, year: 0, doi: 0, documentLevel: 0 };
    function push(it, what) { if (it.length > 0 && st.paragraphs[it.paraIndex]) { raw.push(it); counts[what]++; } }
    function refSpan(r) { return { paraIndex: r.paraIndex, offset: r.leading, length: Math.max(1, r.text.replace(/\s+$/, '').length - r.leading) }; }

    // 1) Saran Validator (yang sudah diabaikan tidak ikut — disaring pemanggil).
    (suggestions || []).forEach(function (s) {
      var isErr = s.severity === 'error';
      if (isErr ? o.includeErrors === false : o.includeSuggestions === false) return;
      var loc = null;
      if (s.paraIndex != null && s.length > 0) loc = { paraIndex: s.paraIndex, offset: s.offset || 0, length: s.length };
      else if (st.headingIndex >= 0) { var h = st.paragraphs[st.headingIndex].text; loc = { paraIndex: st.headingIndex, offset: h.length - h.replace(/^\s+/, '').length, length: h.trim().length }; counts.documentLevel++; }
      if (!loc) return;
      push(Object.assign(loc, { color: isErr ? COLOR.error : COLOR.suggestion, comment: suggestionComment(s), source: s.id }), isErr ? 'error' : 'suggestion');
    });

    // 2) Tahun referensi di luar rentang / tidak terdeteksi.
    if (o.includeYears !== false && o.references && o.references.length) {
      var yr = AC.yearRange(o.references, o.years || 10);
      var range = (o.years || 10) + ' tahun terakhir (' + yr.from + '–' + yr.to + ')';
      yr.outRange.forEach(function (x) {
        var idx = AC.refIndexOfRaw(st, x.ref.raw); if (idx < 0) return;
        var r = st.refs[idx], m = new RegExp('(^|[^\\d])(' + x.y + '[a-z]?)(?!\\d)').exec(r.text);
        var loc = m ? { paraIndex: r.paraIndex, offset: m.index + m[1].length, length: m[2].length } : refSpan(r);
        push(Object.assign(loc, { color: COLOR.year, comment: 'Tahun referensi — tahun ' + x.y + ' berada di luar rentang ' + range + '. Pertimbangkan sumber yang lebih baru, atau abaikan bila memang sengaja mengacu sumber klasik/teori dasar.' }), 'year');
      });
      yr.unknown.forEach(function (ref) {
        var idx = AC.refIndexOfRaw(st, ref.raw); if (idx < 0) return;
        var r = st.refs[idx], first = r.text.slice(r.leading).split(/\s+/).slice(0, 4).join(' ');
        push({ paraIndex: r.paraIndex, offset: r.leading, length: first.length, color: COLOR.year,
          comment: 'Tahun referensi — tahun untuk referensi ini tidak terdeteksi otomatis. Periksa manual apakah masih dalam rentang ' + range + '.' }, 'year');
      });
    }

    // 3) DOI bermasalah menurut CrossRef (hanya bila cek online sudah berjalan).
    if (o.includeDoi !== false && o.online && o.references) {
      o.references.forEach(function (ref) {
        var rec = o.online[(o.styleId || '') + '|' + ref.raw];
        if (!rec || (rec.status !== 'mismatch' && rec.status !== 'notfound')) return;
        var idx = AC.refIndexOfRaw(st, ref.raw); if (idx < 0) return;
        var r = st.refs[idx], at = rec.doi ? r.text.toLowerCase().indexOf(String(rec.doi).toLowerCase()) : -1;
        var loc = at >= 0 ? { paraIndex: r.paraIndex, offset: at, length: rec.doi.length } : refSpan(r);
        var diff = (rec.fields || []).filter(function (f) { return !f.ok && !f.info; }).map(function (f) { return f.field + ': naskah “' + clip(f.naskah || '–', 80) + '”, CrossRef “' + clip(f.crossref || '–', 80) + '”'; });
        push(Object.assign(loc, { color: rec.status === 'mismatch' ? COLOR.doiBad : COLOR.doi,
          comment: 'DOI bermasalah — ' + sentence(rec.note || (rec.status === 'mismatch' ? 'DOI tampaknya milik karya lain.' : 'DOI tidak ditemukan di CrossRef.')) + (diff.length ? ' ' + diff.join('; ') + '.' : '') }), 'doi');
      });
    }

    // 4) Lindungi bagian Zotero/Mendeley: pindahkan jangkar komentar keluar dari field-nya.
    var unanchored = 0, managedCount = 0;
    var placed = raw.map(function (it) { return o.managed && o.managed.found ? anchorOutside(st, o.managed, it) : it; }).filter(function (it) {
      if (it.managed) managedCount++;
      if (it.unanchored) { unanchored++; return false; }
      return true;
    });

    // 5) Gabungkan komentar yang rentangnya bertumpang tindih (satu kotak komentar per lokasi).
    placed.sort(function (a, b) { return (a.paraIndex - b.paraIndex) || (a.offset - b.offset) || (b.length - a.length); });
    var items = [];
    placed.forEach(function (it) {
      var last = items[items.length - 1];
      if (last && last.paraIndex === it.paraIndex && it.offset < last.offset + last.length) {
        if (last.comments.indexOf(it.comment) < 0) last.comments.push(it.comment);
        last.length = Math.max(last.offset + last.length, it.offset + it.length) - last.offset;
        if ((RANK[it.color] || 0) > (RANK[last.color] || 0)) last.color = it.color;
        if (it.managed) last.managed = last.managed || it.managed;
        return;
      }
      items.push({ paraIndex: it.paraIndex, offset: it.offset, length: it.length, color: it.color || null, comments: [it.comment], managed: it.managed || null });
    });

    // 6) Teks pencarian untuk Word (memakai teks paragraf asli dari Word bila ada).
    items.forEach(function (it) {
      var text = (o.rawTexts && o.rawTexts[it.paraIndex] != null ? o.rawTexts[it.paraIndex] : st.paragraphs[it.paraIndex].text);
      it.text = text.substr(it.offset, it.length);
      it.comment = PREFIX + ' ' + (it.comments.length > 1 ? it.comments.map(function (c, i) { return (i + 1) + ') ' + c; }).join('\n') : it.comments[0]);
      var trimmedStart = text.length - text.replace(/^\s+/, '').length, trimmedEnd = text.replace(/\s+$/, '').length;
      it.whole = it.offset <= trimmedStart && it.offset + it.length >= trimmedEnd;
      if (it.whole) return;
      if (it.length <= 240) { it.occurrence = AC.occurrenceIndex(text, it.text, it.offset, false); return; }
      it.head = text.substr(it.offset, 100); it.headOccurrence = AC.occurrenceIndex(text, it.head, it.offset, false);
      var ts = it.offset + it.length - 100;
      it.tail = text.substr(ts, 100); it.tailOccurrence = AC.occurrenceIndex(text, it.tail, ts, false);
    });

    return { items: items, counts: counts, total: raw.length, unanchored: unanchored, managed: managedCount };
  }

  function isReportComment(text) { return String(text || '').replace(/^\s+/, '').indexOf(PREFIX) === 0; }

  var api = { build: build, PREFIX: PREFIX, COLOR: COLOR, isReportComment: isReportComment, suggestionComment: suggestionComment };
  if (isNode) module.exports = api;
  root.ReportCore = api;
})(typeof window !== 'undefined' ? window : this);
