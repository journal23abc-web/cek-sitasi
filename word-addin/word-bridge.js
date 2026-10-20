/* ============================================================
   WORD BRIDGE — semua interaksi Office.js (baca/tulis dokumen Word).
   Lokasi selalu ditentukan sebagai { paraIndex, teks, kemunculan ke-n } lalu dicari
   ulang di Word, jadi tidak bergantung pada offset internal Word.
   ============================================================ */
(function (root) {
  'use strict';

  function supports(v) {
    try { return !!(root.Office && Office.context && Office.context.requirements && Office.context.requirements.isSetSupported('WordApi', v)); }
    catch (e) { return false; }
  }
  var capsCache = null;
  function caps() {
    if (!capsCache) capsCache = { api13: supports('1.3'), api14: supports('1.4'), api16: supports('1.6'), annotations: supports('1.7'), popup: supports('1.8'), comments: supports('1.4') };
    return capsCache;
  }

  function escapeSearch(t) { return String(t).replace(/\^/g, '^^'); }

  // ---------- BACA ----------
  function readParagraphs() {
    return Word.run(function (ctx) {
      var ps = ctx.document.body.paragraphs;
      ps.load(caps().api13 ? 'items/text,items/isListItem,items/tableNestingLevel' : 'items/text');
      return ctx.sync().then(function () {
        var lists = [];
        var out = ps.items.map(function (p, i) {
          var o = { text: p.text, isListItem: !!p.isListItem, inTable: p.tableNestingLevel > 0 };
          if (p.isListItem) { var li = p.listItemOrNullObject; li.load('listString'); lists.push([i, li]); }
          return o;
        });
        if (!lists.length) return out;
        return ctx.sync().then(function () {
          lists.forEach(function (x) { if (!x[1].isNullObject) out[x[0]].listString = x[1].listString; });
          return out;
        }).catch(function () { return out; });
      });
    });
  }

  function loadParas(ctx) {
    var ps = ctx.document.body.paragraphs;
    ps.load('items/text');
    return ctx.sync().then(function () { return ps; });
  }

  // Pastikan paragraf di posisi yang direncanakan masih berisi teks yang sama.
  function checkSnapshot(ps, snapshot) {
    if (!snapshot) return;
    var bad = Object.keys(snapshot).filter(function (i) { return !ps.items[i] || ps.items[i].text !== snapshot[i]; });
    if (bad.length) throw new Error('Dokumen sudah berubah sejak diperiksa. Klik "Periksa" lalu ulangi.');
  }

  // Antrekan pencarian untuk banyak item, satu kali sync. item: { paraIndex, text, occurrence, wholeWord }
  function queueSearches(ps, items) {
    return items.map(function (it) {
      var p = ps.items[it.paraIndex];
      if (!p || !it.text || it.text.length > 255) return null;
      var res = p.search(escapeSearch(it.text), { matchCase: true, matchWholeWord: !!it.wholeWord });
      res.load('items/text');
      return res;
    });
  }
  function pick(res, occurrence) {
    if (!res || !res.items || !res.items.length) return null;
    var i = occurrence >= 0 ? occurrence : 0;
    return res.items[Math.min(i, res.items.length - 1)];
  }

  function withTracking(ctx, track, fn) {
    if (!track || !caps().api14) return fn();
    var doc = ctx.document;
    doc.load('changeTrackingMode');
    var prev;
    return ctx.sync().then(function () {
      prev = doc.changeTrackingMode;
      doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
      return ctx.sync();
    }).then(fn).then(function (v) {
      doc.changeTrackingMode = prev; return ctx.sync().then(function () { return v; });
    }, function (err) {
      doc.changeTrackingMode = prev; return ctx.sync().then(function () { throw err; });
    });
  }

  // Tulis ulang isi paragraf dengan runs [{text, italic}] — format paragraf tetap.
  function writeRuns(para, runs) {
    var list = runs.filter(function (r) { return r.text; });
    if (!list.length) { para.insertText('', 'Replace'); return; }
    var first = para.insertText(list[0].text, 'Replace');
    first.font.italic = !!list[0].italic;
    for (var i = 1; i < list.length; i++) {
      var r = para.insertText(list[i].text, 'End');
      r.font.italic = !!list[i].italic;
    }
  }

  function keepBookmarks(ctx, paras) {
    if (!caps().api14) return Promise.resolve(paras.map(function () { return []; }));
    var results = paras.map(function (p) { return p.getRange('Whole').getBookmarks(true, false); });
    return ctx.sync().then(function () { return results.map(function (r) { return (r.value || []).filter(function (n) { return /^_CS_REF_/.test(n); }); }); })
      .catch(function () { return paras.map(function () { return []; }); });
  }
  function restoreBookmarks(paras, names) {
    if (!caps().api14) return;
    paras.forEach(function (p, i) { (names[i] || []).forEach(function (n) { p.getRange('Content').insertBookmark(n); }); });
  }

  // ---------- NAVIGASI ----------
  function select(item) {
    return Word.run(function (ctx) {
      return loadParas(ctx).then(function (ps) {
        var p = ps.items[item.paraIndex];
        if (!p) return;
        if (item.kind === 'replace' && item.original) {
          var res = queueSearches(ps, [{ paraIndex: item.paraIndex, text: item.original, occurrence: item.occurrence }])[0];
          return ctx.sync().then(function () {
            var r = pick(res, item.occurrence);
            (r || p.getRange('Content')).select();
            return ctx.sync();
          });
        }
        p.getRange('Content').select();
        return ctx.sync();
      });
    });
  }

  // ---------- TERAPKAN SARAN ----------
  function applySuggestion(s, opts) {
    var o = opts || {};
    return Word.run(function (ctx) {
      return withTracking(ctx, o.track, function () {
        return loadParas(ctx).then(function (ps) {
          var p = ps.items[s.paraIndex];
          if (!p) throw new Error('Paragraf tidak ditemukan. Klik "Periksa" lalu ulangi.');
          if (s.kind === 'replace') {
            if (p.text.indexOf(s.original) < 0) throw new Error('Teks "' + s.original + '" tidak ditemukan lagi — dokumen mungkin sudah diedit. Klik "Periksa" lalu ulangi.');
            var res = queueSearches(ps, [{ paraIndex: s.paraIndex, text: s.original, occurrence: s.occurrence }])[0];
            return ctx.sync().then(function () {
              var r = pick(res, s.occurrence);
              if (!r) throw new Error('Teks asli tidak dapat ditemukan di Word.');
              r.insertText(s.replacement, 'Replace');
              return ctx.sync();
            });
          }
          if (s.kind === 'paragraph') {
            var expected = s.compareOriginal || s.original;
            if (AddinCoreNorm(p.text) !== AddinCoreNorm(expected) && AddinCoreNorm(p.text) !== AddinCoreNorm(s.original)) throw new Error('Isi referensi sudah berubah. Klik "Periksa" lalu ulangi.');
            return keepBookmarks(ctx, [p]).then(function (names) {
              writeRuns(p, s.replacementRuns || [{ text: s.replacement, italic: false }]);
              restoreBookmarks([p], names);
              return ctx.sync();
            });
          }
          if (s.kind === 'append') {
            if (s.stripTrailingPeriod) {
              var dots = p.search('.', { matchCase: true });
              dots.load('items');
              return ctx.sync().then(function () {
                var last = dots.items[dots.items.length - 1];
                if (last) last.insertText(s.appendText, 'Replace'); else p.insertText(s.appendText, 'End');
                return ctx.sync();
              });
            }
            p.getRange('Content').insertText(s.appendText, 'End');
            return ctx.sync();
          }
          if (s.kind === 'italic') {
            var searches = queueSearches(ps, s.segments.map(function (t) { return { paraIndex: s.paraIndex, text: t.text, occurrence: t.occurrence }; }));
            return ctx.sync().then(function () {
              searches.forEach(function (res, i) { var r = pick(res, s.segments[i].occurrence); if (r) r.font.italic = true; });
              return ctx.sync();
            });
          }
          throw new Error('Jenis saran tidak dikenal.');
        });
      });
    });
  }
  function AddinCoreNorm(t) { return String(t || '').replace(/^\s*(?:\[\d+\]|\d+\.)\s*/, '').replace(/[\s ]+/g, ' ').trim(); }

  // Terapkan banyak saran "replace" sekaligus (satu batch; rentang Word tetap valid antar edit).
  function applyMany(list, opts) {
    var o = opts || {};
    var replaces = list.filter(function (s) { return s.kind === 'replace'; });
    var others = list.filter(function (s) { return s.kind !== 'replace'; });
    var done = 0, failed = 0;
    return Word.run(function (ctx) {
      return withTracking(ctx, o.track, function () {
        return loadParas(ctx).then(function (ps) {
          // hindari dua saran yang menimpa teks yang sama
          var taken = {};
          var chosen = replaces.filter(function (s) {
            var k = s.paraIndex + ':' + s.offset;
            for (var x = s.offset; x < s.offset + s.length; x++) if (taken[s.paraIndex + ':' + x]) return false;
            for (var y = s.offset; y < s.offset + s.length; y++) taken[s.paraIndex + ':' + y] = true;
            return !!k;
          });
          failed += replaces.length - chosen.length;
          var searches = queueSearches(ps, chosen.map(function (s) { return { paraIndex: s.paraIndex, text: s.original, occurrence: s.occurrence }; }));
          return ctx.sync().then(function () {
            chosen.forEach(function (s, i) { var r = pick(searches[i], s.occurrence); if (r) { r.insertText(s.replacement, 'Replace'); done++; } else failed++; });
            return ctx.sync();
          });
        });
      });
    }).then(function () {
      var chain = Promise.resolve();
      others.forEach(function (s) { chain = chain.then(function () { return applySuggestion(s, o).then(function () { done++; }, function () { failed++; }); }); });
      return chain.then(function () { return { done: done, failed: failed }; });
    });
  }

  // ---------- CETAK MIRING ----------
  function checkItalics(plan) {
    if (!plan || !plan.length) return Promise.resolve([]);
    return Word.run(function (ctx) {
      return loadParas(ctx).then(function (ps) {
        var flat = [];
        plan.forEach(function (it) { it.segments.forEach(function (seg) { flat.push({ it: it, seg: seg }); }); });
        var res = queueSearches(ps, flat.map(function (f) { return { paraIndex: f.it.paraIndex, text: f.seg.text, occurrence: f.seg.occurrence }; }));
        return ctx.sync().then(function () {
          var ranges = res.map(function (r, i) { var x = pick(r, flat[i].seg.occurrence); if (x) x.load('font/italic'); return x; });
          return ctx.sync().then(function () {
            var bad = {};
            flat.forEach(function (f, i) {
              var r = ranges[i];
              if (r && r.font.italic !== true) { (bad[f.it.refIndex] = bad[f.it.refIndex] || { refIndex: f.it.refIndex, paraIndex: f.it.paraIndex, segments: [] }).segments.push(f.seg); }
            });
            return Object.keys(bad).map(function (k) { return bad[k]; });
          });
        });
      });
    });
  }

  // ---------- URUTKAN REFERENSI (pertahankan cetak miring/tebal per kata) ----------
  function captureRuns(ctx, paras) {
    if (!caps().api13) return Promise.resolve(paras.map(function (p) { return [{ text: p.text, italic: false }]; }));
    var trs = paras.map(function (p) { var t = p.getRange('Content').getTextRanges([' '], false); t.load('items/text,items/font/italic'); return t; });
    return ctx.sync().then(function () {
      return trs.map(function (t, i) {
        var runs = [];
        function push(text, italic) { if (!text) return; var l = runs[runs.length - 1]; if (l && l.italic === italic) l.text += text; else runs.push({ text: text, italic: italic }); }
        t.items.forEach(function (w) {
          if (w.font.italic === true) push(w.text, true);
          else if (w.font.italic === null) { var m = w.text.match(/^(.*?)([\s.,;:)\]]*)$/); push(m[1], true); push(m[2], false); }
          else push(w.text, false);
        });
        var joined = runs.map(function (r) { return r.text; }).join('');
        return joined.replace(/\s+/g, ' ').trim() === paras[i].text.replace(/\s+/g, ' ').trim() ? runs : [{ text: paras[i].text, italic: false }];
      });
    });
  }

  function reorderParagraphs(paraIndexes, order, snapshot, opts) {
    var o = opts || {};
    return Word.run(function (ctx) {
      return withTracking(ctx, o.track, function () {
        return loadParas(ctx).then(function (ps) {
          checkSnapshot(ps, snapshot);
          var paras = paraIndexes.map(function (i) { return ps.items[i]; });
          return Promise.all([captureRuns(ctx, paras), keepBookmarks(ctx, paras)]).then(function (x) {
            var runs = x[0], marks = x[1];
            paras.forEach(function (p, slot) { writeRuns(p, runs[order[slot]]); });
            restoreBookmarks(paras, order.map(function (src) { return marks[src]; }));
            return ctx.sync();
          });
        });
      });
    });
  }

  // ---------- KONVERSI ----------
  function applyConversion(plan, snapshot, opts) {
    var o = opts || {};
    return Word.run(function (ctx) {
      return withTracking(ctx, o.track, function () {
        return loadParas(ctx).then(function (ps) {
          checkSnapshot(ps, snapshot);
          var edits = plan.edits.filter(function (e) { return !e.crossesParagraph && e.occurrence >= 0; });
          var searches = queueSearches(ps, edits.map(function (e) { return { paraIndex: e.paraIndex, text: e.original, occurrence: e.occurrence }; }));
          var refParas = plan.references.paraIndexes.map(function (i) { return ps.items[i]; });
          if (caps().api13) refParas.forEach(function (p) { p.load('isListItem'); });
          return ctx.sync().then(function () {
            var applied = 0;
            edits.forEach(function (e, i) { var r = pick(searches[i], e.occurrence); if (r) { r.insertText(e.replacement, 'Replace'); applied++; } });
            var lines = plan.references.lines;
            var n = Math.min(lines.length, refParas.length);
            for (var k = 0; k < n; k++) {
              var p = refParas[k];
              if (plan.references.detachList && p.isListItem) { try { p.detachFromList(); } catch (e1) { /* versi lama */ } }
              writeRuns(p, lines[k].runs);
              if (lines[k].risky) { try { p.getRange('Content').font.highlightColor = 'Yellow'; } catch (e2) { /* abaikan */ } }
              if (o.hangingIndent && !(plan.references.keepListNumbering && p.isListItem)) {
                p.leftIndent = plan.target === 'ieee' ? 25 : 36; p.firstLineIndent = plan.target === 'ieee' ? -25 : -36;
              }
            }
            (plan.references.flagParaIndexes || []).forEach(function (i) { if (ps.items[i]) { try { ps.items[i].getRange('Content').font.highlightColor = 'Yellow'; } catch (e3) { /* abaikan */ } } });
            var last = refParas[refParas.length - 1];
            for (var m = n; m < lines.length && last; m++) { last = last.insertParagraph('', 'After'); writeRuns(last, lines[m].runs); }
            for (var d = n; d < refParas.length; d++) refParas[d].delete();
            return ctx.sync().then(function () { return { applied: applied, skipped: plan.edits.length - applied }; });
          });
        });
      });
    });
  }

  // ---------- TAUTAN ----------
  // Bookmark tanpa WordApi 1.4 (Word 2016/2019): disisipkan sebagai OOXML di awal paragraf
  // referensi. insertOoxml tersedia sejak WordApi 1.1.
  function bookmarkOoxml(name, id) {
    return '<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">' +
      '<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' +
      '</pkg:xmlData></pkg:part>' +
      '<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"><pkg:xmlData>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>' +
      '<w:bookmarkStart w:id="' + id + '" w:name="' + name + '"/><w:bookmarkEnd w:id="' + id + '"/>' +
      '</w:p></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>';
  }

  function insertBookmarks(ctx, ps, bookmarks) {
    if (caps().api14) {
      bookmarks.forEach(function (b) { ps.items[b.paraIndex].getRange('Content').insertBookmark(b.name); });
      return ctx.sync().then(function () { return { mode: 'api' }; });
    }
    // Mode kompatibilitas. Diperiksa sesudahnya: bila Word menambah paragraf kosong (versi
    // tertentu memperlakukan OOXML sebagai paragraf baru), paragraf itu dihapus lagi dan
    // pengguna diberi alternatif yang jelas — dokumen tidak dibiarkan berubah bentuk.
    var before = ps.items.length;
    var base = 7000 + Math.floor(Math.random() * 1000) * 10;
    bookmarks.forEach(function (b, i) { ps.items[b.paraIndex].insertOoxml(bookmarkOoxml(b.name, base + i), 'Start'); });
    return ctx.sync().then(function () {
      var after = ctx.document.body.paragraphs;
      after.load('items/text');
      return ctx.sync().then(function () {
        if (after.items.length === before) return { mode: 'ooxml' };
        // Hapus paragraf kosong yang baru muncul tepat sebelum paragraf referensi.
        var targets = {}; bookmarks.forEach(function (b) { targets[ps.items[b.paraIndex].text] = true; });
        for (var i = after.items.length - 1; i > 0; i--) {
          if (!after.items[i - 1].text && targets[after.items[i].text]) after.items[i - 1].delete();
        }
        return ctx.sync().then(function () { return { mode: 'unsupported' }; });
      });
    });
  }

  function applyLinks(plan, snapshot, opts) {
    var o = opts || {};
    return Word.run(function (ctx) {
      return loadParas(ctx).then(function (ps) {
        checkSnapshot(ps, snapshot);
        if (!caps().api13) {
          var e0 = new Error('Versi Word ini terlalu lama untuk membuat tautan lewat add-in.'); e0.code = 'LinkUnsupported'; throw e0;
        }
        var wantCitations = o.citations !== false;
        var bm = wantCitations ? plan.bookmarks : [];
        return insertBookmarks(ctx, ps, bm).then(function (bmRes) {
          if (bmRes.mode === 'unsupported') {
            var e1 = new Error('Word versi ini belum bisa membuat penanda (bookmark) lewat add-in.'); e1.code = 'LinkUnsupported'; throw e1;
          }
          // Paragraf dimuat ulang: penyisipan OOXML membuat objek paragraf lama tidak berlaku.
          return loadParas(ctx).then(function (ps2) {
            var items = (wantCitations ? plan.citationLinks : []).concat(o.external === false ? [] : plan.externalLinks);
            var searches = queueSearches(ps2, items);
            return ctx.sync().then(function () {
              var ranges = items.map(function (it, i) { var r = pick(searches[i], it.occurrence); if (r && o.keepLook !== false) r.load('font/color,font/underline'); return r; });
              return ctx.sync().then(function () {
                var linked = 0, missed = 0;
                items.forEach(function (it, i) {
                  var r = ranges[i];
                  if (!r) { missed++; return; }
                  var color = r.font.color, underline = r.font.underline;
                  r.hyperlink = it.bookmark ? '#' + it.bookmark : it.href;
                  if (o.keepLook !== false && it.bookmark) { if (color) r.font.color = color; if (underline) r.font.underline = underline; }
                  linked++;
                });
                return ctx.sync().then(function () { return { linked: linked, missed: missed, bookmarks: bm.length, mode: bmRes.mode }; });
              });
            });
          });
        });
      });
    });
  }

  // ---------- MODE FILE (tanpa bookmark API) ----------
  // Membaca dokumen yang sedang terbuka sebagai .docx utuh (Common API "File", Word 2013+ di
  // Windows/Mac). Potongan 4 MB digabung menjadi satu Uint8Array.
  function canReadFile() {
    try { return !!(Office.context.document && Office.context.document.getFileAsync); } catch (e) { return false; }
  }
  function readDocxFile() {
    return new Promise(function (resolve, reject) {
      Office.context.document.getFileAsync(Office.FileType.Compressed, { sliceSize: 4194304 }, function (res) {
        if (res.status !== Office.AsyncResultStatus.Succeeded) { reject(new Error('Word tidak mengizinkan add-in membaca file dokumen (' + (res.error && res.error.message || 'tidak didukung') + ').')); return; }
        var file = res.value, count = file.sliceCount, slices = [], got = 0;
        function done(err) { file.closeAsync(function () { if (err) reject(err); else {
          var total = slices.reduce(function (n, x) { return n + x.length; }, 0), out = new Uint8Array(total), at = 0;
          slices.forEach(function (x) { out.set(x, at); at += x.length; }); resolve(out); } }); }
        function next(i) {
          file.getSliceAsync(i, function (sr) {
            if (sr.status !== Office.AsyncResultStatus.Succeeded) { done(new Error('Gagal membaca bagian dokumen ' + (i + 1) + '/' + count + '.')); return; }
            slices[i] = new Uint8Array(sr.value.data); got++;
            if (got === count) done(); else next(i + 1);
          });
        }
        if (!count) done(new Error('Dokumen kosong.')); else next(0);
      });
    });
  }
  // Membuka .docx (base64) sebagai dokumen Word baru — WordApi 1.3.
  function openNewDocument(base64) {
    return Word.run(function (ctx) {
      var created = ctx.application.createDocument(base64);
      created.open();
      return ctx.sync();
    });
  }

  function removeLinks() {
    return Word.run(function (ctx) {
      var whole = ctx.document.body.getRange('Whole');
      var links = whole.getHyperlinkRanges();
      links.load('items/hyperlink,items/text,items/font/color,items/font/underline');
      var marks = caps().api14 ? whole.getBookmarks(true, true) : null;
      return ctx.sync().then(function () {
        var ours = links.items.filter(function (r) { return /#_CS_REF_\d+$/.test(r.hyperlink || ''); });
        ours.forEach(function (r) { r.hyperlink = ''; });
        return ctx.sync().catch(function () {
          // Beberapa versi Word menolak string kosong: tulis ulang teksnya tanpa tautan.
          ours.forEach(function (r) { var c = r.font.color, u = r.font.underline; var n = r.insertText(r.text, 'Replace'); n.font.color = c; n.font.underline = u; });
          return ctx.sync();
        }).then(function () {
          var names = marks ? (marks.value || []).filter(function (n) { return /^_CS_REF_/.test(n); }) : [];
          names.forEach(function (n) { ctx.document.deleteBookmark(n); });
          return ctx.sync().then(function () { return { removed: ours.length, bookmarks: names.length }; });
        });
      });
    });
  }

  // ---------- SISIP REFERENSI BARU ----------
  function insertReference(point, runs, opts) {
    var o = opts || {};
    return Word.run(function (ctx) {
      return withTracking(ctx, o.track, function () {
        return loadParas(ctx).then(function (ps) {
          var anchor;
          if (point.paraIndex == null || point.paraIndex < 0) {
            anchor = ctx.document.body.insertParagraph(o.headingText || 'Daftar Pustaka', 'End');
            anchor = anchor.insertParagraph('', 'After');
          } else {
            anchor = ps.items[point.paraIndex].insertParagraph('', point.where || 'After');
          }
          anchor.getRange('Whole').font.highlightColor = null;
          runs.forEach(function (r) { var x = anchor.insertText(r.text, 'End'); x.font.italic = !!r.italic; });
          anchor.select();
          return ctx.sync();
        });
      });
    });
  }

  // ---------- ANOTASI (garis bawah ala Paperpal, Word M365) ----------
  var COLOR = { error: 'Red', suggestion: 'Blue', online: 'Lavender', info: 'Berry' };
  function annotate(items, useResources) {
    if (!caps().annotations) return Promise.resolve({ supported: false, ids: {} });
    return Word.run(function (ctx) {
      return loadParas(ctx).then(function (ps) {
        var results = [];
        items.forEach(function (it) {
          var p = ps.items[it.paraIndex];
          if (!p || it.length <= 0) return;
          var crit = { colorScheme: COLOR[it.color] || 'Blue', start: it.offset, length: it.length };
          if (useResources && caps().popup && it.popup && it.popup.length) {
            crit.popupOptions = { brandingTextResourceId: 'CS.Brand', titleResourceId: 'CS.Title', subtitleResourceId: 'CS.Subtitle', suggestions: it.popup };
          }
          results.push({ id: it.id, res: p.insertAnnotations({ critiques: [crit] }) });
        });
        return ctx.sync().then(function () {
          var map = {};
          results.forEach(function (r) { (r.res.value || []).forEach(function (annId) { map[annId] = r.id; }); });
          return { supported: true, ids: map };
        });
      });
    }).catch(function (err) {
      if (useResources) return annotate(items, false);
      // Tanpa langganan Microsoft 365 layanan anotasi menolak — jangan dicoba lagi tiap pemeriksaan.
      if (capsCache) capsCache.annotations = false;
      return { supported: false, ids: {}, error: err && err.message };
    });
  }
  function clearAnnotations(ids) {
    if (!caps().annotations || !ids || !ids.length) return Promise.resolve();
    return Word.run(function (ctx) {
      ids.forEach(function (id) { try { var a = ctx.document.getAnnotationById(id); a.delete(); } catch (e) { /* sudah hilang */ } });
      return ctx.sync();
    }).catch(function () { /* anotasi lama mungkin sudah tidak ada */ });
  }
  function onAnnotationEvents(handlers) {
    if (!caps().annotations) return Promise.resolve(false);
    return Word.run(function (ctx) {
      if (handlers.clicked) ctx.document.onAnnotationClicked.add(function (a) { handlers.clicked(a.id); return Promise.resolve(); });
      if (handlers.popup && caps().popup) ctx.document.onAnnotationPopupAction.add(function (a) { handlers.popup(a.id, a.action, a.critiqueSuggestion); return Promise.resolve(); });
      return ctx.sync().then(function () { return true; });
    }).catch(function () { return false; });
  }

  // ---------- DETEKSI PERUBAHAN DOKUMEN ----------
  function onDocumentChanged(cb) {
    if (caps().api16) {
      return Word.run(function (ctx) {
        var h = function () { cb(); return Promise.resolve(); };
        ctx.document.onParagraphChanged.add(h);
        ctx.document.onParagraphAdded.add(h);
        ctx.document.onParagraphDeleted.add(h);
        return ctx.sync();
      }).catch(function () { return fallback(); });
    }
    return fallback();
    function fallback() {
      return new Promise(function (resolve) {
        Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, function () { cb({ selectionOnly: true }); }, function () { resolve(); });
      });
    }
  }

  // ---------- PENGELOLA SITASI (Zotero/Mendeley/EndNote) ----------
  // OOXML badan dokumen (WordApi 1.1, Word 2016+) dipindai oleh citation-managers.js.
  function scanCitationManagers() {
    if (!root.CitationManagers) return Promise.resolve(null);
    return Word.run(function (ctx) {
      var ox = ctx.document.body.getOoxml();
      return ctx.sync().then(function () { return root.CitationManagers.scanOoxml(ox.value); });
    });
  }

  // ---------- LAPORAN KOMENTAR (WordApi 1.4) ----------
  // Track Changes dimatikan sementara supaya sorotan tidak tercatat sebagai revisi format.
  function withoutTracking(ctx, fn) {
    var doc = ctx.document, prev = null;
    doc.load('changeTrackingMode');
    return ctx.sync().then(function () {
      prev = doc.changeTrackingMode;
      if (prev !== 'Off') { doc.changeTrackingMode = 'Off'; return ctx.sync(); }
    }).catch(function () { prev = null; }).then(fn).then(function (v) {
      if (prev && prev !== 'Off') { doc.changeTrackingMode = prev; return ctx.sync().then(function () { return v; }); }
      return v;
    }, function (err) {
      if (prev && prev !== 'Off') { doc.changeTrackingMode = prev; return ctx.sync().then(function () { throw err; }); }
      throw err;
    });
  }

  var OUR_HL = { '#FF0000': 1, '#FFFF00': 1, '#00FFFF': 1, RED: 1, YELLOW: 1, TURQUOISE: 1 };
  function isOurHighlight(c) { return !!c && !!OUR_HL[String(c).toUpperCase()]; }

  function removeReportIn(ctx) {
    var comments = ctx.document.body.getComments();
    comments.load('items/content');
    return ctx.sync().then(function () {
      var ours = comments.items.filter(function (c) { return root.ReportCore && root.ReportCore.isReportComment(c.content); });
      var ranges = ours.map(function (c) { var r = c.getRange(); r.load('font/highlightColor'); return r; });
      return ctx.sync().then(function () {
        ours.forEach(function (c, i) { if (isOurHighlight(ranges[i].font.highlightColor)) ranges[i].font.highlightColor = null; c.delete(); });
        return ctx.sync().then(function () { return ours.length; });
      }, function () {
        ours.forEach(function (c) { c.delete(); });
        return ctx.sync().then(function () { return ours.length; });
      });
    });
  }

  function removeReport() {
    if (!caps().comments) { var e = new Error('Word versi ini belum mendukung API komentar (butuh Word 2021 / Microsoft 365 / Word di web).'); e.code = 'CommentsUnsupported'; return Promise.reject(e); }
    return Word.run(function (ctx) { return withoutTracking(ctx, function () { return removeReportIn(ctx); }); });
  }

  // items: ReportCore.build(...).items. opts: { highlight, replace }
  function locateQueue(ps, it) {
    var p = ps.items[it.paraIndex];
    if (!p) return null;
    if (it.whole) return { p: p };
    if (it.head) {
      var h = p.search(escapeSearch(it.head), { matchCase: true }), t = p.search(escapeSearch(it.tail), { matchCase: true });
      h.load('items'); t.load('items');
      return { p: p, head: h, tail: t };
    }
    if (!it.text || it.text.length > 255 || /[\t\u000b\r\u0007]/.test(it.text)) return { p: p };
    var r = p.search(escapeSearch(it.text), { matchCase: true }); r.load('items');
    return { p: p, res: r };
  }
  // → { range, exact }  (exact=false: pencarian gagal, komentar ditempel di seluruh paragraf)
  function resolveRange(x, it) {
    if (it.whole) return { range: x.p.getRange('Content'), exact: true };
    var r = null;
    if (x.res) r = pick(x.res, it.occurrence);
    else if (x.head) { var a = pick(x.head, it.headOccurrence), b = pick(x.tail, it.tailOccurrence); r = a && b ? a.expandTo(b) : null; }
    return r ? { range: r, exact: true } : { range: x.p.getRange('Content'), exact: false };
  }
  function place(range, exact, it, o) {
    if (o.highlight !== false && it.color && exact) range.font.highlightColor = it.color;
    range.insertComment(it.comment);
  }

  function insertReport(items, opts) {
    var o = opts || {};
    if (!caps().comments) { var e = new Error('Word versi ini belum mendukung API komentar (butuh Word 2021 / Microsoft 365 / Word di web).'); e.code = 'CommentsUnsupported'; return Promise.reject(e); }
    return Word.run(function (ctx) {
      return withoutTracking(ctx, function () {
        var stats = { added: 0, failed: 0, approximate: 0, removed: 0 };
        var pre = o.replace === false ? Promise.resolve(0) : removeReportIn(ctx);
        return pre.then(function (n) { stats.removed = n; return loadParas(ctx); }).then(function (ps) {
          var list = items.slice();
          // Satu per satu: dipakai bila Word menolak satu batch (mis. ada content control terkunci).
          function single(it) {
            var x = locateQueue(ps, it);
            if (!x) { stats.failed++; return Promise.resolve(); }
            var got;
            return ctx.sync().then(function () {
              got = resolveRange(x, it);
              // Batch yang gagal bisa sudah menempelkan sebagian komentar: jangan dobel.
              var existing = got.range.getComments(); existing.load('items/content');
              return ctx.sync().then(function () { return existing.items.some(function (c) { return c.content === it.comment; }); }, function () { return false; });
            }).then(function (already) {
              if (!already) place(got.range, got.exact, it, o);
              return ctx.sync().then(function () { stats.added++; if (!got.exact) stats.approximate++; });
            }).catch(function () { stats.failed++; });
          }
          function chunk() {
            var part = list.splice(0, 40);
            if (!part.length) return Promise.resolve(stats);
            var q = part.map(function (it) { return locateQueue(ps, it); });
            return ctx.sync().then(function () {
              var approx = 0, missing = 0;
              part.forEach(function (it, i) {
                if (!q[i]) { missing++; return; }
                var got = resolveRange(q[i], it);
                if (!got.exact) approx++;
                place(got.range, got.exact, it, o);
              });
              return ctx.sync().then(function () {
                stats.added += part.length - missing; stats.failed += missing; stats.approximate += approx;
              }, function () {
                var chain = Promise.resolve();
                part.forEach(function (it) { chain = chain.then(function () { return single(it); }); });
                return chain;
              });
            }, function () {
              var chain = Promise.resolve();
              part.forEach(function (it) { chain = chain.then(function () { return single(it); }); });
              return chain;
            }).then(chunk);
          }
          return chunk();
        });
      });
    });
  }

  root.WordBridge = {
    caps: caps, readParagraphs: readParagraphs, select: select, applySuggestion: applySuggestion, applyMany: applyMany,
    checkItalics: checkItalics, reorderParagraphs: reorderParagraphs, applyConversion: applyConversion,
    applyLinks: applyLinks, removeLinks: removeLinks, insertReference: insertReference,
    canReadFile: canReadFile, readDocxFile: readDocxFile, openNewDocument: openNewDocument,
    annotate: annotate, clearAnnotations: clearAnnotations, onAnnotationEvents: onAnnotationEvents, onDocumentChanged: onDocumentChanged,
    scanCitationManagers: scanCitationManagers, insertReport: insertReport, removeReport: removeReport
  };
})(typeof window !== 'undefined' ? window : this);
