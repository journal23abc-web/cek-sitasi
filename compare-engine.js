// compare-engine.js — mesin pembanding 2 versi naskah (sebelum/sesudah revisi).
// Murni fungsi diff teks (LCS-based), tanpa dependensi DOM — bisa diuji langsung di Node.js
// sebelum disambungkan ke UI, dan dipakai ulang persis sama di browser nanti.
(function (global) {
  'use strict';

  // ---------- Diff level-kata (LCS / Longest Common Subsequence) ----------
  // Memecah teks jadi token kata+spasi/tanda-baca (bukan cuma kata polos) supaya spasi dan
  // tanda baca ikut terpelihara persis saat direkonstruksi ulang di tampilan.
  function tokenizeWords(text) {
    return text.match(/\S+|\s+/g) || [];
  }

  // LCS klasik via dynamic programming — cukup cepat untuk paragraf (puluhan-ratusan token).
  // Untuk dokumen SANGAT panjang, dipanggil per-paragraf (bukan per-dokumen), jadi ukuran
  // array yang dibandingkan tetap kecil.
  function diffTokens(oldTokens, newTokens) {
    var n = oldTokens.length, m = newTokens.length;
    // dp[i][j] = panjang LCS antara oldTokens[i:] dan newTokens[j:]
    var dp = new Array(n + 1);
    for (var i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = oldTokens[i] === newTokens[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var ops = [];
    i = 0; var jj = 0;
    while (i < n && jj < m) {
      if (oldTokens[i] === newTokens[jj]) { ops.push({ type: 'same', text: oldTokens[i] }); i++; jj++; }
      else if (dp[i + 1][jj] >= dp[i][jj + 1]) { ops.push({ type: 'del', text: oldTokens[i] }); i++; }
      else { ops.push({ type: 'add', text: newTokens[jj] }); jj++; }
    }
    while (i < n) { ops.push({ type: 'del', text: oldTokens[i] }); i++; }
    while (jj < m) { ops.push({ type: 'add', text: newTokens[jj] }); jj++; }
    // Gabungkan token berurutan dengan tipe sama jadi satu potongan (rapi utk render & lebih
    // ringkas), mis. beberapa kata "add" berturut jadi satu <ins> bukan banyak <ins> kecil.
    var merged = [];
    ops.forEach(function (op) {
      var last = merged[merged.length - 1];
      if (last && last.type === op.type) last.text += op.text;
      else merged.push({ type: op.type, text: op.text });
    });
    return merged;
  }

  function diffWords(oldText, newText) {
    return diffTokens(tokenizeWords(oldText), tokenizeWords(newText));
  }

  // ---------- Diff level-paragraf ----------
  // Kesamaan dua paragraf (0..1) berdasar rasio LCS token terhadap panjang gabungan —
  // dipakai untuk memutuskan "paragraf A di versi lama itu SAMA DENGAN paragraf B di versi
  // baru (mungkin sedikit diedit)" vs "paragraf ini genuinely dihapus/genuinely baru".
  function paraSimilarity(a, b) {
    if (a === b) return 1;
    var ta = tokenizeWords(a), tb = tokenizeWords(b);
    if (ta.length === 0 && tb.length === 0) return 1;
    if (ta.length === 0 || tb.length === 0) return 0;
    var ops = diffTokens(ta, tb);
    var same = 0, total = 0;
    ops.forEach(function (op) {
      var len = op.text.length;
      total += len;
      if (op.type === 'same') same += len;
    });
    return total === 0 ? 1 : same / total;
  }

  // LCS di level PARAGRAF (bukan token) untuk mencocokkan paragraf lama<->baru berdasarkan
  // KESAMAAN PERSIS dulu (paragraf yang sama sekali tidak berubah), sisanya (di antara dua
  // paragraf yang cocok persis) dicocokkan lagi berdasar similarity tertinggi (>= threshold)
  // supaya paragraf yang CUMA SEDIKIT diedit ditampilkan sebagai "diedit" (dengan word-diff
  // inline), bukan sebagai "paragraf lama dihapus total + paragraf baru ditambah total".
  function diffParagraphs(oldParas, newParas) {
    var n = oldParas.length, m = newParas.length;
    var dp = new Array(n + 1);
    for (var i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = oldParas[i] === newParas[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    // Bangun urutan blok "sama persis" dan "beda" (kandidat area edit) di antaranya.
    var blocks = []; // {type:'same', oldIdx, newIdx} atau {type:'diff', oldStart, oldEnd, newStart, newEnd}
    i = 0; var jj = 0;
    var pendingOldStart = 0, pendingNewStart = 0;
    function flushPending(oldEnd, newEnd) {
      if (oldEnd > pendingOldStart || newEnd > pendingNewStart) {
        blocks.push({ type: 'diffgroup', oldStart: pendingOldStart, oldEnd: oldEnd, newStart: pendingNewStart, newEnd: newEnd });
      }
    }
    while (i < n && jj < m) {
      if (oldParas[i] === newParas[jj]) {
        flushPending(i, jj);
        blocks.push({ type: 'same', oldIdx: i, newIdx: jj });
        i++; jj++;
        pendingOldStart = i; pendingNewStart = jj;
      } else if (dp[i + 1][jj] >= dp[i][jj + 1]) { i++; }
      else { jj++; }
    }
    flushPending(n, m);

    // Untuk tiap "diffgroup" (rentang paragraf lama vs baru yang sama sekali tidak match
    // persis), cocokkan sebisa mungkin berdasar similarity tertinggi (greedy) — pasangan
    // dengan similarity >= SIM_THRESHOLD dianggap "paragraf yang sama, diedit", sisanya
    // dianggap genuinely dihapus (cuma ada di lama) atau genuinely ditambah (cuma ada di baru).
    var SIM_THRESHOLD = 0.3;
    var result = [];
    blocks.forEach(function (b) {
      if (b.type === 'same') {
        result.push({ type: 'same', oldIndex: b.oldIdx, newIndex: b.newIdx, oldText: oldParas[b.oldIdx], newText: newParas[b.newIdx] });
        return;
      }
      var oldSlice = [];
      for (var oi = b.oldStart; oi < b.oldEnd; oi++) oldSlice.push({ idx: oi, text: oldParas[oi], used: false });
      var newSlice = [];
      for (var ni = b.newStart; ni < b.newEnd; ni++) newSlice.push({ idx: ni, text: newParas[ni], used: false });

      // Pengaman performa: kalau satu blok "beda total" ini terlalu besar (banyak paragraf
      // sama sekali tidak punya titik jangkar/anchor paragraf identik), pencocokan similarity
      // berpasangan (O(lama × baru)) bisa jadi lambat untuk dokumen ekstrem (ratusan paragraf
      // yang semuanya beda). Di atas ambang ini, lewati pencocokan "modified" dan anggap semua
      // sebagai dihapus+ditambah murni — dokumen nyata HAMPIR SELALU punya cukup paragraf yang
      // sama persis (heading, kalimat tak berubah) sebagai jangkar, jadi ini jarang tersentuh.
      var MAX_PAIRWISE_SIZE = 80;
      if (oldSlice.length > MAX_PAIRWISE_SIZE && newSlice.length > MAX_PAIRWISE_SIZE) {
        oldSlice.forEach(function (o) { result.push({ type: 'del', oldIndex: o.idx, oldText: o.text }); });
        newSlice.forEach(function (nItem) { result.push({ type: 'add', newIndex: nItem.idx, newText: nItem.text }); });
        return;
      }

      // Hitung similarity semua pasangan, urutkan turun, pasangkan greedy (yang paling mirip
      // duluan) — mencegah 2 paragraf pendek yang kebetulan agak mirip "mencuri" pasangan dari
      // paragraf yang harusnya berpasangan lebih tepat.
      var pairs = [];
      oldSlice.forEach(function (o) {
        newSlice.forEach(function (nItem) {
          var sim = paraSimilarity(o.text, nItem.text);
          if (sim >= SIM_THRESHOLD) pairs.push({ o: o, n: nItem, sim: sim });
        });
      });
      pairs.sort(function (a, c) { return c.sim - a.sim; });
      var matched = [];
      pairs.forEach(function (p) {
        if (p.o.used || p.n.used) return;
        p.o.used = true; p.n.used = true;
        matched.push({ oldIdx: p.o.idx, newIdx: p.n.idx });
      });
      matched.sort(function (a, c) { return a.oldIdx - c.oldIdx; });
      var matchedByOld = {}; matched.forEach(function (mt) { matchedByOld[mt.oldIdx] = mt.newIdx; });

      // Urutkan output blok diff ini persis sesuai urutan asli paragraf lama, menyisipkan
      // paragraf baru yang TIDAK match apa pun tepat sebelum posisi lama berikutnya yang cocok
      // urutannya — pendekatan sederhana: proses old secara berurutan, sisipkan new yang belum
      // dipakai begitu urutannya pas.
      var newCursor = b.newStart;
      oldSlice.forEach(function (o) {
        // sisipkan dulu paragraf BARU yang belum dipakai & urutannya SEBELUM pasangan (mis)
        while (newCursor < b.newEnd && !newSlice[newCursor - b.newStart].used && matchedByOld[o.idx] !== newCursor) {
          // hanya sisip kalau memang tidak match SIAPA PUN (paragraf genuinely baru)
          if (Object.keys(matchedByOld).some(function (k) { return matchedByOld[k] === newCursor; })) break;
          result.push({ type: 'add', newIndex: newCursor, newText: newParas[newCursor] });
          newSlice[newCursor - b.newStart].used = true;
          newCursor++;
        }
        if (matchedByOld[o.idx] !== undefined) {
          result.push({ type: 'modified', oldIndex: o.idx, newIndex: matchedByOld[o.idx], oldText: o.text, newText: newParas[matchedByOld[o.idx]] });
          newCursor = Math.max(newCursor, matchedByOld[o.idx] + 1);
        } else {
          result.push({ type: 'del', oldIndex: o.idx, oldText: o.text });
        }
      });
      // paragraf baru sisa (belum kepakai sama sekali) di akhir blok ini
      for (var rem = b.newStart; rem < b.newEnd; rem++) {
        if (!newSlice[rem - b.newStart].used) {
          result.push({ type: 'add', newIndex: rem, newText: newParas[rem] });
          newSlice[rem - b.newStart].used = true;
        }
      }
    });
    return result;
  }

  function summarize(diffResult) {
    var added = 0, deleted = 0, modified = 0, unchanged = 0;
    diffResult.forEach(function (d) {
      if (d.type === 'same') unchanged++;
      else if (d.type === 'add') added++;
      else if (d.type === 'del') deleted++;
      else if (d.type === 'modified') modified++;
    });
    return { added: added, deleted: deleted, modified: modified, unchanged: unchanged, totalChanges: added + deleted + modified };
  }

  var API = { diffWords: diffWords, diffParagraphs: diffParagraphs, paraSimilarity: paraSimilarity, tokenizeWords: tokenizeWords, summarize: summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.CompareEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
