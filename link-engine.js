/* ============================================================
   LINK ENGINE — menautkan in-text citation ke entri referensinya
   di dalam file .docx, TANPA mengubah teks/format apa pun.

   Bergantung pada window.CitationEngine (lihat engine.js) untuk:
   - deteksi gaya sitasi (APA7/MLA9/Chicago/Harvard/IEEE/Vancouver)
   - parsing baris referensi -> {authors, firstAuthor, year, isInstitutional, numLabel, ...}
   - ekstraksi sitasi in-text -> extractAuthorDateCitations / extractNumericCitations

   Bagian yang KHUSUS untuk .docx (baca/tulis word/document.xml via JSZip+DOMParser,
   bookmarkStart/End, w:hyperlink internal via w:anchor) hidup di file ini saja, supaya
   engine.js tetap murni "teks masuk, data terstruktur keluar" dan tidak tahu apa-apa
   soal OOXML — sama seperti pemisahan yang sudah dipakai upload.js untuk highlight+comment.
   ============================================================ */
(function (global) {
  var CE = global.CitationEngine;
  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';

  var HEADING_RE = /(\breferences?\b|reference\s+list|bibliography|works\s+cited|literature\s+cited|daftar\s+pustaka|daftar\s+referensi|referensi)/i;

  // ---------- kunci pencocokan penulis(surname)+tahun, konsisten kedua sisi ----------
  // Sitasi in-text kadang ditulis "H. Zhang" (inisial + nama belakang) — bukan bagian dari
  // engine.js publik, jadi diimplementasikan ulang di sini (fungsi murni, ~8 baris, sama
  // persis logikanya dengan surnameFromCitationToken internal engine.js).
  function surnameFromCitationToken(token) {
    var s = (token || '').trim();
    if (!s) return '';
    // A trailing possessive ('s / 's) is grammar, not part of the name — "Bandura's (1986)
    // theory" must match the reference "Bandura, A. (1986)" the same as plain "Bandura (1986)"
    // would. Same fix as engine.js's own surnameFromCitationToken (separate copy here since
    // link-engine.js works with lower-level parsing).
    s = s.replace(/['\u2019]s$/, '');
    var toks = s.split(/\s+/);
    if (toks.length === 1) return s;
    var leading = toks.slice(0, -1);
    var isInitial = function (t) { return /^\p{Lu}\.?$/u.test(t) || /^\p{Lu}{2,4}$/u.test(t); };
    if (leading.every(isInitial)) return toks[toks.length - 1];
    return s;
  }

  function keyOf(name, year, isInstitutional) {
    return CE.normalizeKeyName(name, !!isInstitutional) + '_' + String(year || '').toLowerCase();
  }

  // Resolves a bookmark for a citation "part" that may actually be a joint institutional
  // reference split by "&" (e.g. "Institute of International Finance & Deloitte") rather than
  // two separate personal co-authors — citation-text extraction alone can't tell these apart.
  // Tries the normal single-first-author key first, then the full "&"-joined form, then (for a
  // bare acronym like "BSP") its resolved full institutional name, as fallbacks.
  function resolveBookmarkForPart(firstAuthor, allAuthorNames, year, refIndex, acronymMap, refTargets, styleId, safeMode) {
    // Prefer the shared, reference-aware resolver from engine.js.  It handles derived
    // institutional acronyms, conservative shortened institution names, and -- critically --
    // returns ALL candidates so an ambiguous same-name/same-year citation is never linked to
    // whichever reference happened to appear first in the list.
    if (CE.resolveAuthorDateReference && refTargets) {
      var refs = refTargets.map(function(t) { return t.ref; });
      var decision = CE.resolveAuthorDateReference(firstAuthor, allAuthorNames, year, refs, styleId, acronymMap);
      if (decision.status === 'matched' && decision.autoSafe) {
        for (var rt = 0; rt < refTargets.length; rt++) {
          if (refTargets[rt].ref === decision.ref) {
            return { bookmarkName: refTargets[rt].bookmarkName, status: decision.status, reason: decision.reason, confidence: decision.confidence };
          }
        }
      }
      if (safeMode === false && decision.status === 'review' && decision.candidates.length === 1) {
        for (var weakIdx = 0; weakIdx < refTargets.length; weakIdx++) {
          if (refTargets[weakIdx].ref === decision.candidates[0]) {
            return { bookmarkName: refTargets[weakIdx].bookmarkName, status: 'matched', reason: decision.reason, confidence: decision.confidence, lowConfidence: true };
          }
        }
      }
      // Safe mode abstains on ambiguity and weak fuzzy similarity.  The diagnostic decision is
      // still returned so the report can tell the user exactly why a link was not created.
      if (safeMode !== false || decision.status !== 'nomatch') {
        return { bookmarkName: null, status: decision.status, reason: decision.reason, confidence: decision.confidence, candidates: decision.candidates };
      }
    }
    // Compatibility fallback for callers that explicitly disable safe mode.  New/default flows
    // never use these first-hit indexes because they cannot represent ambiguity.
    var key = keyOf(surnameFromCitationToken(firstAuthor), year, false);
    if (refIndex[key]) return { bookmarkName: refIndex[key], status: 'matched', reason: 'legacy-exact', confidence: 0.80 };
    if (allAuthorNames && allAuthorNames.length === 2 && CE.isInstitutionalAuthor(firstAuthor)) {
      var altKey = keyOf(allAuthorNames.join(' & '), year, true);
      if (refIndex[altKey]) return { bookmarkName: refIndex[altKey], status: 'matched', reason: 'legacy-joint-institution', confidence: 0.80 };
    }
    if (CE.isInstitutionalAuthor(firstAuthor)) {
      // Kasus paling umum & sederhana: satu penulis institusi tunggal, dikutip apa adanya
      // dengan nama lengkapnya sendiri (bukan akronim, bukan gabungan 2 institusi) — mis.
      // "The Douglas Fir Group, 2016". Coba ini SEBELUM resolusi akronim, karena akronim cuma
      // relevan kalau firstAuthor memang singkatan (mis. "BSP"), bukan nama lengkap yang sudah
      // institusional dari awal.
      var directInstKey = keyOf(firstAuthor, year, true);
      if (refIndex[directInstKey]) return { bookmarkName: refIndex[directInstKey], status: 'matched', reason: 'legacy-institution', confidence: 0.80 };
      var resolved = CE.resolveInstitutionalNameFromMap(firstAuthor, acronymMap);
      if (resolved && resolved !== firstAuthor) {
        var resolvedKey = keyOf(resolved, year, true);
        if (refIndex[resolvedKey]) return { bookmarkName: refIndex[resolvedKey], status: 'matched', reason: 'legacy-acronym', confidence: 0.80 };
      }
    }
    return { bookmarkName: null, status: 'nomatch', reason: 'no-match', confidence: 0 };
  }

  // Word bookmark names: must start with a letter, contain only letters/digits/underscores (no
  // spaces, no symbols, no accented characters), max 40 chars. A raw surname like "Müller",
  // "O'Brien", or "van der Berg" would produce an INVALID bookmark if used as-is — Word either
  // silently mangles it or rejects the whole bookmark. Normalize accents to their base letter
  // first (so "Müller" -> "Muller", not just "mller") so the result stays a recognizable single
  // word, matching what the user sees when they open the hyperlink/bookmark dialog (Ctrl+K).
  function sanitizeBookmarkWord(raw) {
    var s = (raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip diacritic marks, keep base letter
    s = s.replace(/[^a-zA-Z0-9]/g, ''); // drop everything else (apostrophes, hyphens, spaces, ...)
    if (!s) s = 'Ref';
    if (!/^[a-zA-Z]/.test(s)) s = 'B' + s; // bookmark names must start with a letter
    return s.slice(0, 30); // leave room for a year + disambiguation suffix within the 40-char limit
  }

  // ---------- baca semua paragraf top-level dari document.xml ----------
  function buildParagraphList(xmlDoc) {
    var pNodes = xmlDoc.getElementsByTagName('w:p');
    var paras = [];
    for (var i = 0; i < pNodes.length; i++) {
      var p = pNodes[i];
      var wts = p.getElementsByTagName('w:t');
      var text = '';
      for (var j = 0; j < wts.length; j++) text += wts[j].textContent;
      paras.push({ el: p, text: text });
    }
    return paras;
  }

  function documentVisibleText(xmlDoc) {
    return buildParagraphList(xmlDoc).map(function(p) { return p.text; }).join('\n');
  }

  function scanDocumentStructure(xmlDoc) {
    var names = {}, startIds = {}, endIds = {}, nestedHyperlinks = 0;
    var starts = xmlDoc.getElementsByTagName('w:bookmarkStart');
    var ends = xmlDoc.getElementsByTagName('w:bookmarkEnd');
    var links = xmlDoc.getElementsByTagName('w:hyperlink');
    var i;
    for (i = 0; i < starts.length; i++) {
      var name = starts[i].getAttribute('w:name');
      var startId = starts[i].getAttribute('w:id');
      if (name) names[name] = (names[name] || 0) + 1;
      if (startId) startIds[startId] = (startIds[startId] || 0) + 1;
    }
    for (i = 0; i < ends.length; i++) {
      var endId = ends[i].getAttribute('w:id');
      if (endId) endIds[endId] = (endIds[endId] || 0) + 1;
    }
    for (i = 0; i < links.length; i++) {
      var parent = links[i].parentNode;
      while (parent) {
        if (parent.tagName === 'w:hyperlink') { nestedHyperlinks++; break; }
        parent = parent.parentNode;
      }
    }
    var duplicateBookmarkNames = Object.keys(names).filter(function(n) { return names[n] > 1; });
    var unbalancedBookmarkIds = Object.keys(startIds).concat(Object.keys(endIds)).filter(function(id, idx, all) {
      return all.indexOf(id) === idx && (startIds[id] || 0) !== (endIds[id] || 0);
    });
    return { duplicateBookmarkNames: duplicateBookmarkNames, unbalancedBookmarkIds: unbalancedBookmarkIds, nestedHyperlinks: nestedHyperlinks };
  }

  function auditDocumentIntegrity(xmlDoc, beforeText, beforeStructure) {
    var after = scanDocumentStructure(xmlDoc);
    beforeStructure = beforeStructure || { duplicateBookmarkNames: [], unbalancedBookmarkIds: [], nestedHyperlinks: 0 };
    var newDuplicates = after.duplicateBookmarkNames.filter(function(n) { return beforeStructure.duplicateBookmarkNames.indexOf(n) === -1; });
    var newUnbalanced = after.unbalancedBookmarkIds.filter(function(id) { return beforeStructure.unbalancedBookmarkIds.indexOf(id) === -1; });
    var textPreserved = documentVisibleText(xmlDoc) === beforeText;
    var newNested = Math.max(0, after.nestedHyperlinks - beforeStructure.nestedHyperlinks);
    var issues = [];
    if (!textPreserved) issues.push('visible-text-changed');
    if (newDuplicates.length) issues.push('duplicate-bookmark-name');
    if (newUnbalanced.length) issues.push('unbalanced-bookmark');
    if (newNested) issues.push('nested-hyperlink');
    return { ok: issues.length === 0, textPreserved: textPreserved, issues: issues, newDuplicateBookmarkNames: newDuplicates, newUnbalancedBookmarkIds: newUnbalanced, newNestedHyperlinks: newNested };
  }

  function findHeadingIndex(paras) {
    var candidates = [];
    for (var i = 0; i < paras.length; i++) {
      var t = paras[i].text.trim();
      if (t.length > 0 && t.length <= 60) {
        var stripped = t.replace(/^[\dIVXLC]+[.)]\s*/i, '').replace(/[:.\s]+$/, '');
        var words = stripped.split(/\s+/).filter(Boolean);
        var isExactMatch = HEADING_RE.test(stripped) && words.length <= 4;
        // Same typo tolerance as the paste-text validator (CE.isFuzzyHeadingWord) — a single-
        // word heading like "Refernces"/"Bibliograpy" is still recognized. DOCX-sourced
        // headings are less prone to copy-paste typos than pasted PDF text, but a document
        // that genuinely has a misspelled heading shouldn't silently fail to link at all.
        var isTypoMatch = !isExactMatch && words.length === 1 && CE.isFuzzyHeadingWord && CE.isFuzzyHeadingWord(stripped);
        if (isExactMatch || isTypoMatch) candidates.push(i);
      }
    }
    if (candidates.length === 0) return -1;
    // Prefer the LAST matching heading that is followed by substantial content — guards
    // against picking a spurious SHORT "References"-looking line elsewhere in the document
    // that is NOT the real bibliography heading. A very common real-world case: bibliometric/
    // corpus-statistics tables (common in review papers analyzing citation data) often have a
    // table row/cell literally labeled just "References" showing a stat like the total
    // citation count across the studied corpus — that reads exactly like a heading by the
    // short-line-with-the-word-"references" check above, but it's the WRONG one; the genuine
    // bibliography heading, near the actual end of the document, is what should be used.
    for (var c = candidates.length - 1; c >= 0; c--) {
      var afterText = paras.slice(candidates[c] + 1).map(function (p) { return p.text; }).join('\n').trim();
      if (afterText.length >= 30) return candidates[c];
    }
    // Nothing had substantial trailing content (unusual) — fall back to the last candidate.
    return candidates[candidates.length - 1];
  }

  // ---------- run-splitting yang aman-format (pola sama seperti upload.js) ----------
  // PENTING: harus menelusuri SEMUA <w:r>, termasuk yang sudah bersarang di dalam
  // <w:hyperlink>/<w:ins>/<w:del> dsb. (lazim ada di naskah yang sitasinya dibuat lewat
  // Mendeley/Zotero/EndNote) — bukan cuma anak langsung <w:p>. Kalau tidak, posisi karakter
  // di sini akan "geser" dibanding teks-polos paragraf (yang dihitung dari SEMUA <w:t>
  // lewat getElementsByTagName di buildParagraphList), dan setiap sitasi SETELAH bagian
  // yang bersarang itu akan salah tautan atau gagal total.
  // Setiap info run juga menyimpan apakah dia "spliceable" — anak langsung <w:p> (aman
  // dipecah/disisipi w:hyperlink baru) atau bukan (sudah di dalam wrapper lain; menyisipkan
  // w:hyperlink baru di situ akan jadi hyperlink bersarang yang tidak valid di OOXML, jadi
  // match yang menyentuh run ini akan dilewati & dilaporkan, bukan dipaksakan).
  // PENTING (kelas bug lain): naskah akademik SANGAT umum memakai fitur Word "Insert Caption"
  // (penomoran otomatis) dan "Insert Cross-reference" untuk menyebut "Table 1"/"Figure 1" di
  // teks — ini BUKAN teks polos, tapi FIELD CODE kompleks: serangkaian <w:r> berurutan berisi
  // fldChar type="begin" -> instrText (mis. " SEQ Table \* ARABIC " / " REF _Ref123 ") ->
  // fldChar type="separate" -> HASIL CACHE (w:t berisi angka, mis. "1") -> fldChar type="end".
  // Field ini WAJIB jadi satu rangkaian run yang utuh tanpa jeda — menyisipkan elemen lain
  // (w:hyperlink) DI TENGAH rangkaian ini menghasilkan OOXML tidak valid yang membuat Word
  // menampilkan "unreadable content" lalu diam-diam MEMBUANG hyperlink yang rusak saat pemulihan
  // (persis gejala yang dilaporkan: file "sudah ditautkan" tapi setelah dibuka ternyata tidak).
  // Setiap run yang berada di DALAM rentang begin..end (termasuk run hasil cache seperti "1"
  // itu sendiri) ditandai TIDAK BOLEH disisipi/dipecah — match yang menyentuhnya dilewati &
  // dilaporkan, sama seperti hyperlink/tracked-changes yang sudah ada sebelumnya.
  function getRunInfos(p) {
    var runNodes = p.getElementsByTagName('w:r');
    var text = '', infos = [];
    var insideField = false;
    var pastSeparate = false; // sudah lewat fldChar separate -> run w:t berikutnya adalah HASIL CACHE (teks biasa, aman displit), bukan bagian struktural field
    var fieldGroupId = null;
    var nextFieldGroupId = 0;
    for (var i = 0; i < runNodes.length; i++) {
      var r = runNodes[i];
      var fldCharList = r.getElementsByTagName('w:fldChar');
      var fldType = fldCharList.length ? fldCharList[0].getAttribute('w:fldCharType') : null;
      var isInstrText = r.getElementsByTagName('w:instrText').length > 0;
      if (fldType === 'begin') { insideField = true; pastSeparate = false; fieldGroupId = nextFieldGroupId++; }
      // Penanda struktural (fldChar itu sendiri, ATAU instrText, ATAU masih di dalam field
      // sebelum lewat "separate") -> TIDAK boleh dipecah/disisipi, itu bisa merusak field.
      // Run w:t BIASA yang kebetulan ada di antara "separate" dan "end" (hasil cache field,
      // mis. teks sitasi yang terlihat) BUKAN penanda struktural -> aman displit seperti biasa.
      var isStructuralMarker = fldType != null || isInstrText || (insideField && !pastSeparate);
      var wts = r.getElementsByTagName('w:t');
      var t = '';
      for (var j = 0; j < wts.length; j++) t += wts[j].textContent;
      infos.push({
        run: r, start: text.length, end: text.length + t.length, text: t,
        spliceable: (r.parentNode === p) && !isStructuralMarker,
        fieldGroupId: insideField ? fieldGroupId : null,
        isStructuralMarker: isStructuralMarker,
      });
      text += t;
      if (fldType === 'separate') pastSeparate = true;
      if (fldType === 'end') { insideField = false; pastSeparate = false; fieldGroupId = null; }
    }
    return { text: text, infos: infos };
  }

  function createRun(xmlDoc, rPrEl, text) {
    var r = xmlDoc.createElementNS(W_NS, 'w:r');
    if (rPrEl) r.appendChild(rPrEl.cloneNode(true));
    var t = xmlDoc.createElementNS(W_NS, 'w:t');
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t.textContent = text;
    r.appendChild(t);
    return r;
  }

  // Opsional: mewarnai teks sitasi yang jadi link (mis. biru khas hyperlink), TANPA menyentuh
  // atribut format lain (bold/italic/font tetap seperti aslinya) — cukup timpa/ tambah <w:color>.
  // colorHex tanpa '#', mis. "0000FF" (biru default hyperlink Word).
  function applyColorToRun(xmlDoc, runEl, colorHex) {
    if (!colorHex) return;
    var rPrList = runEl.getElementsByTagName('w:rPr');
    var rPr;
    if (rPrList.length) rPr = rPrList[0];
    else { rPr = xmlDoc.createElementNS(W_NS, 'w:rPr'); runEl.insertBefore(rPr, runEl.firstChild); }
    var colorList = rPr.getElementsByTagName('w:color');
    var colorEl;
    if (colorList.length) colorEl = colorList[0];
    else { colorEl = xmlDoc.createElementNS(W_NS, 'w:color'); rPr.appendChild(colorEl); }
    colorEl.setAttributeNS(W_NS, 'w:val', colorHex.replace('#', ''));
  }

  // Underline standar khas hyperlink — dipakai untuk link URL eksternal baru (lihat
  // wrapWithExternalHyperlink), bukan untuk sitasi internal yang formatnya sengaja dijaga apa
  // adanya secara default.
  function applyUnderlineToRun(xmlDoc, runEl) {
    var rPrList = runEl.getElementsByTagName('w:rPr');
    var rPr;
    if (rPrList.length) rPr = rPrList[0];
    else { rPr = xmlDoc.createElementNS(W_NS, 'w:rPr'); runEl.insertBefore(rPr, runEl.firstChild); }
    var uList = rPr.getElementsByTagName('w:u');
    var uEl;
    if (uList.length) uEl = uList[0];
    else { uEl = xmlDoc.createElementNS(W_NS, 'w:u'); rPr.appendChild(uEl); }
    uEl.setAttributeNS(W_NS, 'w:val', 'single');
  }

  // Kalau match [s,e) menyentuh PENANDA STRUKTURAL field (fldChar/instrText, bukan sekadar teks
  // hasil cache-nya yang terlihat), penanda itu HANYA boleh diikutsertakan kalau SELURUH
  // rentang field-nya tercakup penuh oleh [s,e) — field yang cuma tersentuh SEBAGIAN tetap
  // ditolak demi keamanan, karena batas match tidak sejalan dengan struktur field-nya.
  function fieldGroupsFullyContained(infos, overlapping, s, e) {
    var touchedGroups = {};
    overlapping.forEach(function (inf) { if (inf.fieldGroupId != null && inf.isStructuralMarker) touchedGroups[inf.fieldGroupId] = true; });
    return Object.keys(touchedGroups).every(function (gid) {
      var groupRuns = infos.filter(function (inf) { return inf.fieldGroupId != null && String(inf.fieldGroupId) === gid; });
      var gs = Math.min.apply(null, groupRuns.map(function (r) { return r.start; }));
      var ge = Math.max.apply(null, groupRuns.map(function (r) { return r.end; }));
      return gs >= s && ge <= e;
    });
  }

  // Membungkus rentang [s,e) teks paragraf dengan <w:hyperlink w:anchor="...">, memecah
  // hanya run yang tersentuh dan menjaga rPr asli tiap run — run lain tidak disentuh sama sekali.
  // colorHex (opsional) diterapkan HANYA ke run yang masuk hyperlink, bukan ke potongan
  // before/after di luar hyperlink — supaya cuma teks sitasinya yang berubah warna.
  //
  // Kalau match menyentuh field code Word (mis. cross-reference "Table [REF]" bawaan Word) DAN
  // field itu tercakup PENUH oleh match (bukan kepotong sebagian) — run ASLI field itu (fldChar
  // begin/instrText/separate/hasil/end) dipindah UTUH sebagai satu kesatuan ke dalam hyperlink,
  // TIDAK direkonstruksi ulang lewat createRun (itu akan menghancurkan struktur field/instrText-
  // nya). Hyperlink boleh membungkus field yang utuh (sama seperti Ctrl+K manual di Word pada
  // teks yang mengandung field) — yang TIDAK boleh cuma memotong/menyisip DI TENGAH field-nya.
  function wrapWithHyperlink(xmlDoc, p, s, e, anchorName, colorHex, allowedContainer) {
    var info = getRunInfos(p);
    var overlapping = info.infos.filter(function (inf) { return inf.end > s && inf.start < e; });
    if (overlapping.length === 0) return false;
    // Perluasan & verifikasi HANYA diperlukan kalau match menyentuh PENANDA STRUKTURAL field
    // (fldChar/instrText) — match yang cuma menyentuh teks hasil cache field (mis. teks sitasi
    // yang terlihat dari field ADDIN CSL_CITATION Mendeley) sama sekali TIDAK perlu ini, karena
    // teks hasil cache aman dipecah seperti run biasa mana pun (bukan bagian field yang rawan).
    var verifiedGroups = {};
    var touchedMarkerGroups = {};
    overlapping.forEach(function (inf) { if (inf.fieldGroupId != null && inf.isStructuralMarker) touchedMarkerGroups[inf.fieldGroupId] = true; });
    if (Object.keys(touchedMarkerGroups).length > 0) {
      // Perluas ke SEMUA run milik grup yang tersentuh — termasuk run zero-width (mis. fldChar
      // end) yang posisinya PERSIS di ujung match, yang lolos dari deteksi overlap ketat di
      // atas (start===end pas di batas e, gagal `< e`). Field WAJIB diikutsertakan SEBAGAI SATU
      // KESATUAN utuh — kalau run terakhirnya (fldChar end) ketinggalan, field jadi "belum
      // ditutup" dan dokumennya tidak valid.
      overlapping = info.infos.filter(function (inf) {
        return (inf.end > s && inf.start < e) || (inf.fieldGroupId != null && touchedMarkerGroups[inf.fieldGroupId]);
      });
      if (!fieldGroupsFullyContained(info.infos, overlapping, s, e)) return false;
      verifiedGroups = touchedMarkerGroups;
    }
    // Run yang TIDAK spliceable ditolak, KECUALI penanda struktural dari grup yang baru saja
    // terverifikasi aman tercakup penuh di atas.
    if (overlapping.some(function (inf) {
      if (inf.spliceable || (allowedContainer && inf.run.parentNode === allowedContainer && !inf.isStructuralMarker)) return false;
      if (inf.fieldGroupId != null && verifiedGroups[inf.fieldGroupId]) return false;
      return true;
    })) return false;

    var hl = xmlDoc.createElementNS(W_NS, 'w:hyperlink');
    hl.setAttributeNS(W_NS, 'w:anchor', anchorName);
    hl.setAttributeNS(W_NS, 'w:history', '1');

    var beforeRun = null, afterRun = null, movedNodes = [];
    overlapping.forEach(function (inf, idx) {
      if (inf.fieldGroupId != null && verifiedGroups[inf.fieldGroupId] && inf.isStructuralMarker) {
        // Penanda struktural dari grup terverifikasi -> pindahkan run ASLI-nya apa adanya
        // (zero-width, tidak punya teks untuk dipecah before/after). Warna tetap diterapkan —
        // tidak berefek apa-apa untuk run tanpa teks terlihat, tapi aman & konsisten.
        applyColorToRun(xmlDoc, inf.run, colorHex);
        movedNodes.push(inf.run);
        return;
      }
      // Run spliceable NORMAL — baik teks biasa mana pun MAUPUN teks hasil cache field (yang
      // ada di antara fldChar separate dan end) — diproses sama persis: pecah jadi
      // before/match/after berdasarkan rPr aslinya.
      var rPrList = inf.run.getElementsByTagName('w:rPr');
      var rPr = rPrList.length ? rPrList[0] : null;
      var localS = Math.max(s, inf.start) - inf.start;
      var localE = Math.min(e, inf.end) - inf.start;
      var beforeText = inf.text.slice(0, localS);
      var matchText = inf.text.slice(localS, localE);
      var afterText = inf.text.slice(localE);
      if (idx === 0 && beforeText) beforeRun = createRun(xmlDoc, rPr, beforeText);
      if (matchText) {
        var mRun = createRun(xmlDoc, rPr, matchText);
        applyColorToRun(xmlDoc, mRun, colorHex);
        movedNodes.push(mRun);
      }
      if (idx === overlapping.length - 1 && afterText) afterRun = createRun(xmlDoc, rPr, afterText);
    });
    movedNodes.forEach(function (r) { hl.appendChild(r); }); // appendChild otomatis "memindahkan" node yang masih terpasang di parent lama

    var insertBefore = overlapping[0].run;
    var parent = insertBefore.parentNode;
    if (beforeRun) parent.insertBefore(beforeRun, insertBefore);
    parent.insertBefore(hl, insertBefore);
    if (afterRun) parent.insertBefore(afterRun, insertBefore);
    overlapping.forEach(function (inf) { if (inf.run.parentNode === parent) parent.removeChild(inf.run); });
    return true;
  }

  // Sama seperti wrapWithHyperlink, tapi untuk URL EKSTERNAL (link ke luar dokumen, mis. DOI/
  // halaman jurnal) — pakai r:id yang menunjuk ke entri di word/_rels/document.xml.rels, bukan
  // w:anchor yang menunjuk ke bookmark internal. colorHex default biru+underline khas hyperlink
  // kalau tidak diberikan, karena ini benar-benar link baru yang sebelumnya tidak bisa diklik
  // sama sekali — beda dari sitasi internal yang formatnya sengaja dijaga apa adanya by default.
  function wrapWithExternalHyperlink(xmlDoc, p, s, e, rId, colorHex) {
    var info = getRunInfos(p);
    var overlapping = info.infos.filter(function (inf) { return inf.end > s && inf.start < e; });
    if (overlapping.length === 0) return false;
    if (overlapping.some(function (inf) { return !inf.spliceable; })) return false;

    var hl = xmlDoc.createElementNS(W_NS, 'w:hyperlink');
    hl.setAttributeNS(R_NS, 'r:id', rId);
    hl.setAttributeNS(W_NS, 'w:history', '1');

    var beforeRun = null, afterRun = null, matchRuns = [];
    overlapping.forEach(function (inf, idx) {
      var rPrList = inf.run.getElementsByTagName('w:rPr');
      var rPr = rPrList.length ? rPrList[0] : null;
      var localS = Math.max(s, inf.start) - inf.start;
      var localE = Math.min(e, inf.end) - inf.start;
      var beforeText = inf.text.slice(0, localS);
      var matchText = inf.text.slice(localS, localE);
      var afterText = inf.text.slice(localE);
      if (idx === 0 && beforeText) beforeRun = createRun(xmlDoc, rPr, beforeText);
      if (matchText) {
        var mRun = createRun(xmlDoc, rPr, matchText);
        applyColorToRun(xmlDoc, mRun, colorHex || '0563C1');
        applyUnderlineToRun(xmlDoc, mRun);
        matchRuns.push(mRun);
      }
      if (idx === overlapping.length - 1 && afterText) afterRun = createRun(xmlDoc, rPr, afterText);
    });
    matchRuns.forEach(function (r) { hl.appendChild(r); });

    var insertBefore = overlapping[0].run;
    if (beforeRun) p.insertBefore(beforeRun, insertBefore);
    p.insertBefore(hl, insertBefore);
    if (afterRun) p.insertBefore(afterRun, insertBefore);
    overlapping.forEach(function (inf) { p.removeChild(inf.run); });
    return true;
  }

  // Kalau referensi ini SUDAH punya bookmark (lazim di naskah yang sitasinya dibuat lewat
  // Mendeley/Zotero/EndNote — biasanya bernama seperti nama belakang penulis, mis. "Aini",
  // "Winarno2016", dst.), pakai ulang bookmark itu alih-alih bikin baru. Bookmark internal
  // Word sendiri (nama diawali "_", mis. "_Toc..."/"_heading=...") diabaikan.
  // Sebagian plugin sitasi (bukan Mendeley/Zotero yang membungkus dengan <w:hyperlink>, tapi
  // integrasi lain — termasuk beberapa versi EndNote/Word Citations) membungkus tiap in-text
  // citation dengan <w:sdt><w:sdtContent>...</w:sdtContent></w:sdt> (content control), bukan
  // hyperlink. Run di dalam w:sdtContent bukan anak langsung <w:p>, jadi tidak "spliceable" dan
  // sebelumnya dilaporkan sebagai "struktur run tidak didukung" untuk SEMUA sitasi yang naskahnya
  // dibuat dengan plugin semacam ini. <w:sdt> selalu anak langsung <w:p> (turunan OOXML valid),
  // jadi cukup aman untuk "dibongkar" — pindahkan seluruh isi <w:sdtContent> jadi anak langsung
  // <w:p> tepat di posisi <w:sdt> semula, lalu buang wrapper <w:sdt>/<w:sdtPr>/<w:sdtEndPr>-nya.
  // Teks, urutan run, dan format SETIAP run tetap identik — hanya nesting-nya yang berubah, jadi
  // ini tidak memengaruhi hitungan posisi karakter (articleText) yang sudah dihitung sebelumnya.
  function unwrapSdtElements(p) {
    var sdtNodes = p.getElementsByTagName('w:sdt');
    var sdtArr = [];
    for (var i = 0; i < sdtNodes.length; i++) sdtArr.push(sdtNodes[i]);
    sdtArr.forEach(function (sdt) {
      if (sdt.parentNode !== p) return; // sdt bersarang di dalam sdt lain — kasus langka, dilewati demi keamanan
      var contentList = sdt.getElementsByTagName('w:sdtContent');
      if (!contentList.length) { p.removeChild(sdt); return; }
      var content = contentList[0];
      while (content.firstChild) p.insertBefore(content.firstChild, sdt);
      p.removeChild(sdt);
    });
  }

  function findExistingBookmarkName(p) {
    var bms = p.getElementsByTagName('w:bookmarkStart');
    for (var i = 0; i < bms.length; i++) {
      var nm = bms[i].getAttribute('w:name');
      if (nm && nm.charAt(0) !== '_') return nm;
    }
    // Kasus lebih jarang tapi nyata (dijumpai di naskah bersitasi Mendeley/Zotero): bookmark bisa
    // MELINTASI batas paragraf — bookmarkStart-nya duduk sebagai elemen "mengambang" SEBELUM
    // paragraf ini (bukan di dalamnya), sementara bookmarkEnd-nya ada DI DALAM paragraf ini. Cek
    // ini juga dulu apa itu terjadi, lewat bookmarkEnd -> cocokkan w:id-nya ke bookmarkStart di
    // MANA PUN posisinya di dokumen — supaya tidak dikira "belum ada bookmark" dan bikin bookmark
    // baru bernama sama persis (nama bookmark WAJIB unik di OOXML; nama duplikat merusak file).
    var bmEnds = p.getElementsByTagName('w:bookmarkEnd');
    if (bmEnds.length === 0) return null;
    var doc = p.ownerDocument || p;
    var allStarts = doc.getElementsByTagName('w:bookmarkStart');
    for (var j = 0; j < bmEnds.length; j++) {
      var endId = bmEnds[j].getAttribute('w:id');
      if (!endId) continue;
      for (var k = 0; k < allStarts.length; k++) {
        if (allStarts[k].getAttribute('w:id') === endId) {
          var nm2 = allStarts[k].getAttribute('w:name');
          if (nm2 && nm2.charAt(0) !== '_') return nm2;
        }
      }
    }
    return null;
  }

  // Cari <w:hyperlink> pembungkus terdekat dari sebuah run (null kalau run itu anak langsung <w:p>
  // atau bersarang di wrapper lain yang bukan hyperlink, mis. tracked-change <w:ins>/<w:del>).
  function findWrapperHyperlink(runEl, p) {
    var node = runEl.parentNode;
    while (node && node !== p) {
      if (node.tagName === 'w:hyperlink') return node;
      node = node.parentNode;
    }
    return null;
  }

  function isInsideContentControl(runEl, p) {
    var node = runEl.parentNode;
    while (node && node !== p) {
      if (node.tagName === 'w:sdt') return true;
      node = node.parentNode;
    }
    return false;
  }

  // A run-level content control can safely keep all of its metadata while its visible runs are
  // wrapped INSIDE w:sdtContent.  This is materially safer than deleting the whole w:sdt wrapper:
  // Zotero/Mendeley/EndNote can still recognize and update the citation later (an update may
  // overwrite our hyperlink, but it will not detach the citation from its manager).
  function directContentControlContainer(runEl, p) {
    var node = runEl.parentNode;
    while (node && node !== p) {
      if (node.tagName === 'w:sdtContent') return runEl.parentNode === node ? node : null;
      node = node.parentNode;
    }
    return null;
  }

  // Menaut sebuah match [s,e) ke bookmarkName. Kasus nyata paling umum di naskah yang sitasinya
  // dibuat lewat Mendeley/Zotero/EndNote: HANYA SEBAGIAN teks sitasi (biasanya cuma tahunnya)
  // yang sudah dibungkus <w:hyperlink> lama, sisanya (nama penulis, tanda kurung) masih run polos
  // — jadi satu match sering "campur": sebagian spliceable, sebagian sudah di dalam hyperlink lain.
  // Match dipecah per-segmen berdasarkan wrapper-nya:
  //  - segmen run polos (anak langsung <w:p>)      -> dibungkus <w:hyperlink> BARU (jalur umum lama)
  //  - segmen yang sudah di dalam SATU <w:hyperlink> -> anchor hyperlink itu DIPERBAIKI di tempat
  //    (tidak perlu bongkar-pasang run sama sekali; kalau anchor-nya sudah benar, tidak disentuh)
  //  - segmen di dalam wrapper lain (tracked-change dst.) -> dilewati (tidak diubah)
  // Karena penambahan wrapper TIDAK PERNAH mengubah isi teks, posisi karakter [s,e) tetap valid
  // sepanjang proses ini walau dipanggil berkali-kali pada paragraf yang sama.
  function wrapOrRetarget(xmlDoc, p, s, e, bookmarkName, colorHex) {
    var info = getRunInfos(p);
    var overlapping = info.infos.filter(function (inf) { return inf.end > s && inf.start < e; });
    if (overlapping.length === 0) return { ok: false, mode: 'unsupported' };

    var groups = [];
    overlapping.forEach(function (inf) {
      var key = inf.spliceable ? 'SPLICE' : (findWrapperHyperlink(inf.run, p) || directContentControlContainer(inf.run, p) || (isInsideContentControl(inf.run, p) ? 'PROTECTED_SDT' : null));
      var last = groups[groups.length - 1];
      if (last && last.key === key) last.infos.push(inf);
      else groups.push({ key: key, infos: [inf] });
    });

    var anyOk = false, anyNew = false, anyRetarget = false, anyAlready = false, anyFail = false, anyProtected = false;
    groups.forEach(function (g) {
      var segStart = Math.max(s, g.infos[0].start);
      var segEnd = Math.min(e, g.infos[g.infos.length - 1].end);
      if (g.key === 'SPLICE') {
        if (wrapWithHyperlink(xmlDoc, p, segStart, segEnd, bookmarkName, colorHex)) { anyOk = true; anyNew = true; }
        else anyFail = true;
      } else if (g.key && g.key.tagName === 'w:sdtContent') {
        if (wrapWithHyperlink(xmlDoc, p, segStart, segEnd, bookmarkName, colorHex, g.key)) { anyOk = true; anyNew = true; }
        else { anyFail = true; anyProtected = true; }
      } else if (g.key && g.key.tagName === 'w:hyperlink') {
        var already = g.key.getAttribute('w:anchor') === bookmarkName;
        if (!already) {
          g.key.setAttributeNS(W_NS, 'w:anchor', bookmarkName);
          g.key.setAttributeNS(W_NS, 'w:history', '1');
          anyRetarget = true;
        } else anyAlready = true;
        if (colorHex) {
          var innerRuns = g.key.getElementsByTagName('w:r');
          for (var ri = 0; ri < innerRuns.length; ri++) applyColorToRun(xmlDoc, innerRuns[ri], colorHex);
        }
        anyOk = true;
      } else {
        if (g.key === 'PROTECTED_SDT') anyProtected = true;
        anyFail = true; // wrapper selain hyperlink (tracked-change dst.) — dilewati apa adanya
      }
    });

    if (!anyOk) return { ok: false, mode: anyProtected ? 'protected-control' : 'unsupported' };
    return { ok: true, mode: anyRetarget ? 'retargeted' : (anyFail ? 'partial' : (anyNew ? 'new' : (anyAlready ? 'already' : 'new'))) };
  }

  function insertBookmark(xmlDoc, p, name, id) {
    var bmStart = xmlDoc.createElementNS(W_NS, 'w:bookmarkStart');
    bmStart.setAttributeNS(W_NS, 'w:id', String(id));
    bmStart.setAttributeNS(W_NS, 'w:name', name);
    var bmEnd = xmlDoc.createElementNS(W_NS, 'w:bookmarkEnd');
    bmEnd.setAttributeNS(W_NS, 'w:id', String(id));
    var pPrList = p.getElementsByTagName('w:pPr');
    var pPr = pPrList.length ? pPrList[0] : null;
    if (pPr && pPr.nextSibling) p.insertBefore(bmStart, pPr.nextSibling);
    else if (pPr) p.appendChild(bmStart);
    else if (p.firstChild) p.insertBefore(bmStart, p.firstChild);
    else p.appendChild(bmStart);
    p.appendChild(bmEnd);
  }

  function nextAvailableBookmarkId(xmlDoc, minimum) {
    var next = minimum || 1;
    var starts = xmlDoc.getElementsByTagName('w:bookmarkStart');
    for (var i = 0; i < starts.length; i++) {
      var n = parseInt(starts[i].getAttribute('w:id'), 10);
      if (!isNaN(n)) next = Math.max(next, n + 1);
    }
    return next;
  }

  // ---------- deteksi teks yang sudah di-highlight manual oleh pengguna ----------
  // Kalau pengguna sudah menandai (highlight warna apa saja, via tombol Highlight di Word)
  // sebagian dari sebuah sitasi — misalnya cuma tahunnya saja — maka link yang dibuat akan
  // dipersempit ke bagian yang di-highlight itu saja, bukan seluruh teks sitasi. Ini dibaca
  // langsung dari <w:highlight>/<w:shd> pada rPr tiap run, dengan pola baca atribut yang sama
  // seperti checkReferenceFormatting() di engine.js / upload.js (getAttribute('w:val') dsb.).
  function isRunHighlighted(runEl) {
    var rPrList = runEl.getElementsByTagName('w:rPr');
    if (!rPrList.length) return false;
    var rPr = rPrList[0];
    var hlList = rPr.getElementsByTagName('w:highlight');
    if (hlList.length) {
      var val = hlList[0].getAttribute('w:val');
      if (val && val.toLowerCase() !== 'none') return true;
    }
    var shdList = rPr.getElementsByTagName('w:shd');
    if (shdList.length) {
      var fill = shdList[0].getAttribute('w:fill');
      if (fill && fill.toLowerCase() !== 'auto' && fill.toLowerCase() !== 'ffffff') return true;
    }
    return false;
  }

  // Rentang [start,end) (koordinat teks-polos paragraf) yang di-highlight, digabung kalau
  // ada run highlighted yang bersebelahan (mis. highlight dipecah jadi 2 run karena alasan lain).
  function buildHighlightRanges(pEl) {
    var info = getRunInfos(pEl);
    var ranges = [];
    info.infos.forEach(function (inf) {
      if (!isRunHighlighted(inf.run) || !inf.text) return;
      var last = ranges[ranges.length - 1];
      if (last && last.end === inf.start) last.end = inf.end;
      else ranges.push({ start: inf.start, end: inf.end });
    });
    return ranges;
  }


  // ============================================================
  // MAIN: linkDocx(xmlDoc, options) -> mutasi xmlDoc in-place + laporan
  // options.linkScope         ('full' default | 'year') : pilih dari WEBSITE, tidak perlu
  //                                              highlight manual di Word — 'year' menautkan
  //                                              hanya token tahunnya, 'full' seluruh sitasi.
  // options.narrowToHighlight (default true)  : kalau sitasi punya bagian ter-highlight DI FILE
  //                                              WORD-nya sendiri, persempit link ke situ saja
  //                                              (diterapkan SETELAH linkScope, opsional/independen).
  // options.onlyHighlighted   (default false) : lewati sitasi yang SAMA SEKALI tidak
  //                                              punya highlight (untuk kontrol manual penuh).
  // options.linkColor         (default null)  : opsional — hex warna (mis. "0000FF", biru khas
  //                                              hyperlink) untuk teks sitasi yang ditautkan.
  //                                              null/kosong = format asli TIDAK diubah sama sekali.
  // ============================================================
  // ---------- Auto-link URL/DOI polos di daftar referensi ----------
  // Banyak naskah punya URL/DOI di entri referensi yang cuma teks BIASA (bukan hyperlink asli,
  // sering karena tempel-dari-Word-lain atau autoformat gagal) — jadi tidak bisa diklik sama
  // sekali. Bagian ini mendeteksi pola URL/DOI dalam teks referensi dan membuatnya bisa diklik,
  // memakai <w:hyperlink r:id="..."> yang menunjuk ke entri BARU di word/_rels/document.xml.rels
  // (link ke luar dokumen — beda dari w:anchor yang dipakai sitasi in-text untuk lompat internal).
  var URL_RE = /\bhttps?:\/\/[^\s<>\[\]{}"'\u2018\u2019\u201c\u201d]+/gi;
  var BARE_DOI_RE = /\b(?:doi\s*[:.]?\s*)(10\.\d{4,9}\/[^\s<>\[\]{}"'\u2018\u2019\u201c\u201d,;]+)/gi;

  // URL yang diakhiri tanda baca kalimat (titik/koma penutup kalimat, kurung tutup tanpa
  // pasangan, dst.) hampir selalu bukan bagian dari URL itu sendiri — potong dari belakang.
  function trimTrailingPunctuation(url) {
    var out = url;
    while (out.length && /[.,;:!?)\]]/.test(out.charAt(out.length - 1))) {
      // kurung tutup ")" cuma dipotong kalau tidak ada kurung buka "(" yang belum tertutup di
      // dalam URL itu sendiri (beberapa URL Wikipedia/DOI sah memuat "(" "..." ")").
      if (out.charAt(out.length - 1) === ')' && (out.match(/\(/g) || []).length > (out.match(/\)/g) || []).length - 1) break;
      out = out.slice(0, -1);
    }
    return out;
  }

  function findExternalUrlMatches(text) {
    var matches = [];
    var seen = {}; // hindari overlap kalau URL_RE & BARE_DOI_RE kebetulan tumpang tindih di posisi yang sama
    var m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text)) !== null) {
      var trimmed = trimTrailingPunctuation(m[0]);
      if (trimmed.length < 10) continue; // terlalu pendek untuk URL sungguhan, kemungkinan salah tangkap
      matches.push({ start: m.index, end: m.index + trimmed.length, url: trimmed });
      for (var i = m.index; i < m.index + trimmed.length; i++) seen[i] = true;
    }
    BARE_DOI_RE.lastIndex = 0;
    while ((m = BARE_DOI_RE.exec(text)) !== null) {
      var doiStart = m.index + m[0].indexOf(m[1]);
      var doiEnd = doiStart + m[1].length;
      if (seen[doiStart]) continue; // sudah tercakup match URL_RE (mis. "https://doi.org/10.xxxx")
      var trimmedDoi = trimTrailingPunctuation(m[1]);
      matches.push({ start: doiStart, end: doiStart + trimmedDoi.length, url: 'https://doi.org/' + trimmedDoi });
    }
    matches.sort(function (a, b) { return a.start - b.start; });
    return matches;
  }

  // Kembalikan rId yang sudah ada untuk URL ini kalau sudah pernah ditambahkan (mis. dua
  // referensi berbeda kebetulan mengarah ke domain/DOI landing page yang sama), atau buat entri
  // Relationship baru di file .rels dan kembalikan rId barunya.
  function ensureExternalRelationship(relsXmlDoc, url) {
    var root = relsXmlDoc.documentElement;
    var rels = root.getElementsByTagName('Relationship');
    var maxNum = 0;
    for (var i = 0; i < rels.length; i++) {
      if (rels[i].getAttribute('Target') === url && rels[i].getAttribute('TargetMode') === 'External') {
        return rels[i].getAttribute('Id');
      }
      var m = /^rId(\d+)$/.exec(rels[i].getAttribute('Id') || '');
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    var newId = 'rId' + (maxNum + 1);
    var newRel = relsXmlDoc.createElement('Relationship');
    newRel.setAttribute('Id', newId);
    newRel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink');
    newRel.setAttribute('Target', url);
    newRel.setAttribute('TargetMode', 'External');
    root.appendChild(newRel);
    return newId;
  }

  // Menaut setiap URL/DOI polos yang ditemukan di paragraf REFERENSI (bukan badan artikel —
  // link internal sitasi sudah ditangani terpisah). Melewati URL yang sudah di dalam
  // <w:hyperlink> (sudah bisa diklik, tidak perlu disentuh).
  function linkifyReferenceUrls(xmlDoc, relsXmlDoc, refParas) {
    var linked = 0;
    refParas.forEach(function (paraObj) {
      var p = paraObj.el;
      var info = getRunInfos(p);
      var matches = findExternalUrlMatches(info.text);
      // proses dari BELAKANG ke DEPAN: membungkus satu match mengubah struktur run tapi TIDAK
      // mengubah teks, jadi posisi karakter match lain di paragraf yang SAMA tetap valid — kecuali
      // urutan pemrosesan harus mundur supaya insert/remove run untuk satu match tidak membuat
      // referensi DOM match berikutnya (yang sudah dihitung dari p yang sama) jadi basi.
      matches.slice().reverse().forEach(function (mt) {
        var overlapping = info.infos.filter(function (inf) { return inf.end > mt.start && inf.start < mt.end; });
        if (overlapping.length === 0) return;
        var alreadyLinked = overlapping.every(function (inf) { return !!findWrapperHyperlink(inf.run, p); });
        if (alreadyLinked) return; // URL ini sudah bisa diklik, tidak perlu disentuh
        if (overlapping.some(function (inf) { return !inf.spliceable; })) return; // sebagian di wrapper lain (tracked-change dst.) — lewati demi aman
        var rId = ensureExternalRelationship(relsXmlDoc, mt.url);
        if (wrapWithExternalHyperlink(xmlDoc, p, mt.start, mt.end, rId)) linked++;
      });
    });
    return linked;
  }

  // ---------- Opsional: tautkan sebutan "Figure N" / "Table N" ke gambar/tabelnya ----------
  // Beda dari sitasi & URL referensi di atas: ini FITUR OPSIONAL (default nonaktif), diaktifkan
  // lewat options.linkFiguresTables. Caption ("Figure 1. Contoh...") dikenali dari paragraf yang
  // TEKSNYA DIAWALI pola "Figure N"/"Table N" (mengabaikan spasi di depan) — paragraf itu diberi
  // bookmark, lalu setiap kemunculan "Figure N"/"Table N" LAIN di badan artikel (bukan caption-nya
  // sendiri) yang merujuk nomor yang sama ditautkan ke bookmark itu.
  var CAPTION_START_RE = /^\s*(Figure|Fig\.?|Gambar|Table|Tabel)\s*\.?\s*(\d+)\s*[.:)\-–—]/i;
  var FIGTBL_MENTION_RE = /\b(Figure|Fig\.?|Gambar|Table|Tabel)\s*\.?\s*(\d+)\b/gi;

  function figTblType(label) {
    return /^(table|tabel)/i.test(label) ? 'tbl' : 'fig';
  }

  // Menyusun daftar caption (paragraf yang DIAWALI "Figure N"/"Table N") beserta posisi absolut
  // tiap paragraf di dalam teks gabungan seluruh badan artikel (sama seperti articleText di
  // linkDocx) — dibutuhkan supaya kemunculan in-text bisa dicocokkan lintas paragraf memakai satu
  // sistem koordinat yang konsisten.
  function findFigureTableCaptions(bodyParas) {
    var captions = []; // { type, number, paraIndex, start (posisi absolut label "Figure N" di teks gabungan) }
    var offset = 0;
    bodyParas.forEach(function (p, idx) {
      var m = CAPTION_START_RE.exec(p.text);
      if (m) {
        captions.push({
          type: figTblType(m[1]),
          number: m[2],
          paraIndex: idx,
          start: offset + m.index,
          end: offset + m.index + m[0].length,
        });
      }
      offset += p.text.length + 1; // +1 untuk pemisah '\n' yang dipakai saat menggabungkan paragraf jadi satu teks
    });
    return captions;
  }

  // Menautkan setiap kemunculan "Figure N"/"Table N" LAIN (bukan caption-nya sendiri) ke bookmark
  // caption yang sesuai. Butuh bodyParas + articleText (posisi absolut) dari linkDocx supaya bisa
  // memetakan balik posisi match ke paragraf & offset lokalnya masing-masing.
  function linkFigureTableReferences(xmlDoc, bodyParas, articleText, bookmarkSeqStart, colorHex) {
    var captions = findFigureTableCaptions(bodyParas);
    if (captions.length === 0) return { linked: 0, captionsFound: 0 };

    // Beri tiap caption bookmark unik (dibuat SEKALI per nomor+tipe — kalau ada dua caption
    // dengan nomor sama, mis. penomoran ulang di draft, yang PERTAMA ditemukan dipakai). Kalau
    // paragraf caption ini SUDAH punya bookmark (mis. dari proses "Tautkan" sebelumnya yang
    // pernah dijalankan di naskah yang sama), PAKAI ULANG nama itu alih-alih bikin baru — nama
    // bookmark WAJIB unik di OOXML; bikin bookmark baru dengan nama sama ("figtbl_tbl_1" lagi)
    // menghasilkan nama duplikat yang merusak file, persis kelas bug yang sama seperti pada
    // bookmark sitasi.
    var bookmarkOf = {}; // 'fig_1' -> nama bookmark
    var bmId = bookmarkSeqStart;
    captions.forEach(function (c) {
      var key = c.type + '_' + c.number;
      if (bookmarkOf[key]) return; // nomor duplikat, sudah ada bookmark dari caption pertama
      var paraEl = bodyParas[c.paraIndex].el;
      var name = 'figtbl_' + key;
      var existingName = findExistingBookmarkName(paraEl);
      if (existingName === name) {
        bookmarkOf[key] = existingName;
        return;
      }
      insertBookmark(xmlDoc, paraEl, name, bmId++);
      bookmarkOf[key] = name;
    });

    // Hitung offset absolut awal tiap paragraf (sama seperti findFigureTableCaptions di atas)
    // supaya posisi match dari regex full-text bisa dipetakan balik ke [paraIndex, localOffset].
    var paraOffsets = [];
    var running = 0;
    bodyParas.forEach(function (p) { paraOffsets.push(running); running += p.text.length + 1; });
    function paraIndexAt(absPos) {
      for (var i = paraOffsets.length - 1; i >= 0; i--) {
        if (absPos >= paraOffsets[i]) return i;
      }
      return 0;
    }

    var captionSpans = captions.map(function (c) { return { start: c.start, end: c.end }; });
    function isCaptionSelfMention(matchStart, matchEnd) {
      return captionSpans.some(function (s) { return matchStart >= s.start && matchEnd <= s.end; });
    }

    var linked = 0;
    var m;
    FIGTBL_MENTION_RE.lastIndex = 0;
    // Kumpulkan dulu semua match SEBELUM membungkus siapa pun — membungkus satu match mengubah
    // struktur run paragrafnya (walau tidak mengubah teks), jadi lebih aman memproses per-PARAGRAF
    // dari BELAKANG ke DEPAN agar match lain dalam paragraf yang sama tidak jadi basi posisinya.
    var matchesByPara = {};
    while ((m = FIGTBL_MENTION_RE.exec(articleText)) !== null) {
      if (isCaptionSelfMention(m.index, m.index + m[0].length)) continue;
      var type = figTblType(m[1]);
      var key = type + '_' + m[2];
      var bookmarkName = bookmarkOf[key];
      if (!bookmarkName) continue; // sebut "Figure 9" tapi tidak ada caption Figure 9 -> lewati, jangan tebak
      var pIdx = paraIndexAt(m.index);
      var localStart = m.index - paraOffsets[pIdx];
      var localEnd = localStart + m[0].length;
      if (!matchesByPara[pIdx]) matchesByPara[pIdx] = [];
      matchesByPara[pIdx].push({ start: localStart, end: localEnd, bookmarkName: bookmarkName });
    }
    Object.keys(matchesByPara).forEach(function (pIdxStr) {
      var pIdx = parseInt(pIdxStr, 10);
      var p = bodyParas[pIdx].el;
      matchesByPara[pIdxStr].slice().reverse().forEach(function (mt) {
        if (wrapWithHyperlink(xmlDoc, p, mt.start, mt.end, mt.bookmarkName, colorHex)) linked++;
      });
    });

    return { linked: linked, captionsFound: captions.length };
  }

  function linkDocx(xmlDoc, options) {
    options = options || {};
    var narrowToHighlight = options.narrowToHighlight !== false;
    var onlyHighlighted = !!options.onlyHighlighted;
    var linkScope = options.linkScope === 'year' ? 'year' : 'full'; // 'full' (default) | 'year'
    var linkColor = options.linkColor || null; // null = format asli tidak diubah; atau hex mis. "0000FF"
    var safeMode = options.safeMode !== false;
    // Zotero/Mendeley/EndNote content controls may contain live citation metadata.  Preserve
    // them by default; users can explicitly opt into the destructive compatibility path.
    var preserveCitationControls = options.preserveCitationControls !== false;
    var visibleTextBefore = documentVisibleText(xmlDoc);
    var structureBefore = scanDocumentStructure(xmlDoc);

    var paras = buildParagraphList(xmlDoc);
    var headingIdx = findHeadingIndex(paras);
    if (headingIdx === -1) return { error: 'NO_HEADING' };

    var bodyParas = paras.slice(0, headingIdx);
    var refParas = paras.slice(headingIdx + 1);
    if (!preserveCitationControls) bodyParas.forEach(function (p) { unwrapSdtElements(p.el); });
    var highlightRangesByPara = bodyParas.map(function (p) { return buildHighlightRanges(p.el); });
    var docHasHighlight = highlightRangesByPara.some(function (r) { return r.length > 0; });

    var articleText = bodyParas.map(function (p) { return p.text; }).join('\n');
    var referenceText = refParas.map(function (p) { return p.text; }).join('\n');

    // Apa pun sebelum heading "Introduction"/"Pendahuluan" (metadata, kotak "How to Cite",
    // abstrak) dikecualikan dari penautan — bagian itu sering memuat pola "Nama, A. (Tahun)"
    // yang KEBETULAN persis berbentuk sitasi (paling umum: kotak "To cite this article: ...")
    // tapi bukan sitasi sungguhan. Sama seperti perlakuan di engine.js's validate().
    var introHeading = CE.findIntroductionHeading ? CE.findIntroductionHeading(articleText) : null;
    var introOffset = introHeading ? introHeading.offset + introHeading.lineLength : 0;

    var styleId = options.styleId;
    var detected = null;
    if (!styleId || styleId === 'auto') {
      detected = CE.FormatDetector.detect(articleText, referenceText);
      styleId = detected.styleId;
    }
    var style = CE.STYLES[styleId];
    var acronymMap = CE.buildAcronymMapFromText(articleText + '\n' + referenceText);

    var parsed = CE.parseReferenceListDetailed(referenceText, styleId);

    var refIndex = {};   // key(surname/acronym + tahun) -> bookmarkName  (gaya penulis-tahun)
    var numIndex = {};   // nomor -> bookmarkName                         (gaya numerik)
    var refTargets = []; // parsed ref object -> bookmark; shared resolver keeps ambiguity explicit
    var bookmarkSeq = nextAvailableBookmarkId(xmlDoc, 5000);
    var usedBookmarkNames = {};
    var refCount = 0;
    var ordinal = 0;

    var allExistingBookmarkStarts = xmlDoc.getElementsByTagName('w:bookmarkStart');
    for (var existingIdx = 0; existingIdx < allExistingBookmarkStarts.length; existingIdx++) {
      var existingName = allExistingBookmarkStarts[existingIdx].getAttribute('w:name');
      if (existingName) usedBookmarkNames[existingName] = true;
    }

    parsed.references.forEach(function (ref) {
      var paraObj = refParas[ref.lineNumber - 1];
      if (!paraObj) return;
      ordinal++;
      refCount++;
      var bookmarkName = findExistingBookmarkName(paraObj.el);
      if (!bookmarkName) {
        var id = bookmarkSeq++;
        // Prefer a readable "Surname2020"-style name (what shows up in Word's Ctrl+K bookmark
        // list) over an opaque "ref_5000"; fall back to that opaque form only when there's no
        // usable author name to build one from (e.g. some numeric-style or malformed entries).
        var baseWord = null;
        if (ref.firstAuthor) {
          var surnameForName = ref.isInstitutional ? ref.firstAuthor : CE.surnameOf(ref.firstAuthor, styleId);
          baseWord = sanitizeBookmarkWord(surnameForName) + String(ref.year || '').replace(/[^0-9a-zA-Z]/g, '');
        }
        if (!baseWord) baseWord = 'ref' + id;
        bookmarkName = baseWord;
        var suffix = 2;
        while (usedBookmarkNames[bookmarkName]) { bookmarkName = baseWord + '_' + suffix; suffix++; } // e.g. two different papers that both normalize to "Smith2020"
        usedBookmarkNames[bookmarkName] = true;
        insertBookmark(xmlDoc, paraObj.el, bookmarkName, id);
      } else {
        usedBookmarkNames[bookmarkName] = true;
      }
      refTargets.push({ ref: ref, bookmarkName: bookmarkName });

      if (style.family === 'numeric') {
        var label = ref.numLabel || ordinal;
        numIndex[label] = bookmarkName;
        return;
      }
      if (!ref.year || !ref.firstAuthor) return;
      var surname = ref.isInstitutional ? ref.firstAuthor : CE.surnameOf(ref.firstAuthor, styleId);
      var key = keyOf(surname, ref.year, ref.isInstitutional);
      if (!(key in refIndex)) refIndex[key] = bookmarkName;
      if (ref.isInstitutional) {
        var acr = CE.acronymOf(ref.firstAuthor);
        if (acr) {
          var akey = keyOf(acr, ref.year, false);
          if (!(akey in refIndex)) refIndex[akey] = bookmarkName;
        }
      }
    });

    // ---------- kumpulkan sitasi in-text, petakan posisi absolut -> (paragraf, offset) ----------
    function locate(pos) {
      var acc = 0;
      for (var i = 0; i < bodyParas.length; i++) {
        var len = bodyParas[i].text.length;
        if (pos <= acc + len) return { paraIndex: i, offset: pos - acc };
        acc += len + 1; // +1 untuk penyambung '\n'
      }
      return null;
    }

    var matchesByPara = {};
    var unmatched = [];
    var unmatchedDetails = [];
    function addMatch(startAbs, endAbs, resolution, raw, yearText) {
      resolution = resolution && typeof resolution === 'object'
        ? resolution
        : { bookmarkName: resolution || null, status: resolution ? 'matched' : 'nomatch', reason: resolution ? 'numeric-exact' : 'no-match', confidence: resolution ? 1 : 0 };
      var a = locate(startAbs), b = locate(endAbs);
      if (!a || !b || a.paraIndex !== b.paraIndex) {
        unmatched.push(raw);
        unmatchedDetails.push({ raw: raw, status: 'unsupported', reason: 'cross-paragraph', confidence: 0 });
        return;
      }
      var pi = a.paraIndex;
      if (!matchesByPara[pi]) matchesByPara[pi] = [];
      matchesByPara[pi].push({ start: a.offset, end: b.offset, bookmarkName: resolution.bookmarkName, resolution: resolution, raw: raw, yearText: yearText || null });
    }

    if (style.family === 'numeric') {
      CE.extractNumericCitations(articleText).filter(function (c) { return c.position >= introOffset; }).forEach(function (c) {
        var bm = null;
        for (var k = 0; k < c.numbers.length; k++) {
          if (numIndex[c.numbers[k]]) { bm = numIndex[c.numbers[k]]; break; }
        }
        addMatch(c.position, c.position + c.raw.length, { bookmarkName: bm, status: bm ? 'matched' : 'nomatch', reason: bm ? 'numeric-exact' : 'no-match', confidence: bm ? 1 : 0 }, c.raw, null);
      });
    } else {
      // Tracks, per shared author-position, where the previously-linked span for a grouped
      // multi-year narrative citation ("BSP (2020, 2024, 2025, 2026a)") ended — see the
      // narrative branch below for why this is needed.
      var narrativeGroupEnd = {};
      CE.extractAuthorDateCitations(articleText).filter(function (c) { return c.position >= introOffset; }).forEach(function (c) {
        if (c.type === 'parenthetical') {
          // raw = m[0] asli persis dari teks dokumen -> panjang akurat.
          // Kalau kurungnya berisi beberapa sitasi dipisah ';' (mis. "(Jones & Brown, 2019;
          // Aditya et al., 2021)"), setiap sitasi ditautkan ke referensinya SENDIRI-SENDIRI,
          // bukan cuma seluruh blok ke satu referensi pertama.
          var segments = c.content.split(';');
          if (segments.length === c.parts.length) {
            var offset = 0;
            segments.forEach(function (segText, idx) {
              var segStartAbs = c.position + 1 + offset; // +1 lompati '('
              var segEndAbs = segStartAbs + segText.length;
              offset += segText.length + 1; // +1 untuk ';'
              var part = c.parts[idx];
              var bmSeg = { bookmarkName: null, status: 'nomatch', reason: 'no-match', confidence: 0 };
              if (part && part.firstAuthor) {
                bmSeg = resolveBookmarkForPart(part.firstAuthor, part.authors, part.year, refIndex, acronymMap, refTargets, styleId, safeMode);
              }
              // trim spasi di tepi segmen supaya link tidak "makan" spasi pemisah
              var leadWs = segText.match(/^\s*/)[0].length;
              var trailWs = segText.match(/\s*$/)[0].length;
              var linkStart = segStartAbs + leadWs;
              var linkEnd = segEndAbs - trailWs;
              // Sertakan '(' pembuka pada segmen PERTAMA dan ')' penutup pada segmen TERAKHIR,
              // supaya seluruh "(...)" ikut terbookmark/ter-hyperlink, bukan cuma teks penulis+
              // tahun di dalamnya. Segmen tengah (dipisah ';') tidak dapat kurungnya sendiri.
              if (idx === 0) linkStart = c.position;
              if (idx === segments.length - 1) linkEnd = c.position + c.raw.length;
              addMatch(linkStart, linkEnd, bmSeg, segText.trim(), part ? part.year : null);
            });
          } else {
            // Bentuk tak umum (mis. sitasi tahun-ganda "Smith, 2019, 2021" dalam satu kurung)
            // — tautkan seluruh blok ke referensi pertama yang cocok, lebih aman daripada menebak.
            var bm = { bookmarkName: null, status: 'nomatch', reason: 'no-match', confidence: 0 }, bmYear = null;
            for (var i = 0; i < c.parts.length; i++) {
              var part2 = c.parts[i];
              if (!part2.firstAuthor) continue;
              var bmFound = resolveBookmarkForPart(part2.firstAuthor, part2.authors, part2.year, refIndex, acronymMap, refTargets, styleId, safeMode);
              if (bmFound.bookmarkName) { bm = bmFound; bmYear = part2.year; break; }
            }
            addMatch(c.position, c.position + c.raw.length, bm, c.raw, bmYear);
          }
        } else if (c.type === 'narrative') {
          // engine.js kadang men-strip kata sambung di depan (mis. "However, Prawida (2021)"
          // -> authors jadi cuma "Prawida") supaya pencarian referensi tidak salah, TAPI
          // `position`/`raw` yang dikembalikan tetap dari match ASLI termasuk kata sambungnya.
          // Kalau dipakai apa adanya, "However," ikut kebungkus hyperlink. Cari ulang posisi
          // awal SESUNGGUHNYA dari `authors` yang sudah bersih itu di dalam teks.
          var narrativeAuthorTokens = c.authors.split(/\s*(?:&|,|\band\b|\bdan\b|\bet\s+al\.?)\s*/i).filter(Boolean);
          var firstTok = narrativeAuthorTokens[0];
          var bm2 = resolveBookmarkForPart(firstTok, narrativeAuthorTokens, c.year, refIndex, acronymMap, refTargets, styleId, safeMode);
          var authorIdx = articleText.indexOf(c.authors, c.position);
          var realStart = authorIdx >= 0 && authorIdx <= c.position + c.raw.length ? authorIdx : c.position;
          // Grouped multi-year citation for the SAME author, e.g. "BSP (2020, 2024, 2025,
          // 2026a)", produces several citation objects that all share this SAME realStart.
          // Without tracking where the PREVIOUS year's span ended, every subsequent year would
          // re-search from realStart again, producing fully overlapping spans ("BSP (2020",
          // "BSP (2020, 2024", "BSP (2020, 2024, 2025", ...) — the overlap-dedup step later on
          // then keeps only the first and silently drops the rest. Search (and start the new
          // span) from right after the previous one instead.
          var searchFrom = narrativeGroupEnd[realStart] || realStart;
          var yearIdx = articleText.indexOf(c.year, searchFrom);
          var endAbs = yearIdx >= 0 ? yearIdx + c.year.length + 1 : searchFrom + c.raw.length;
          var matchStart = narrativeGroupEnd[realStart] ? narrativeGroupEnd[realStart] : realStart;
          addMatch(matchStart, endAbs, bm2, c.raw, c.year);
          narrativeGroupEnd[realStart] = endAbs;
        }
      });
    }


    var linkedList = [];
    var linkedDetails = [];
    var matchBreakdown = {};
    var narrowedCount = 0, skippedNotHighlighted = 0;
    var newCount = 0, retargetedCount = 0, alreadyCount = 0, protectedControlsSkipped = 0;
    function countReason(reason) {
      reason = reason || 'unknown';
      matchBreakdown[reason] = (matchBreakdown[reason] || 0) + 1;
    }
    Object.keys(matchesByPara).forEach(function (piStr) {
      var pi = parseInt(piStr, 10);
      var list = matchesByPara[pi];
      // buang tumpang-tindih (jaga-jaga) sebelum menyunting DOM
      list.sort(function (a, b) { return a.start - b.start; });
      var accepted = [];
      list.forEach(function (m) {
        var overlap = accepted.some(function (a) { return m.start < a.end && m.end > a.start; });
        if (!overlap) accepted.push(m);
      });

      var ranges = highlightRangesByPara[pi] || [];
      accepted.forEach(function (m) {
        if (!m.bookmarkName) return; // ditangani di bawah sebagai unmatched, penyempitan tidak relevan

        // Mode "hanya tahun" — dipilih langsung dari website, TIDAK butuh highlight manual di
        // Word sama sekali. Persempit dulu ke token tahun (kalau ketemu) sebelum highlight-narrowing.
        if (linkScope === 'year' && m.yearText) {
          var paraText = bodyParas[pi].text;
          var yIdx = paraText.indexOf(m.yearText, m.start);
          if (yIdx !== -1 && yIdx + m.yearText.length <= m.end) {
            m.start = yIdx; m.end = yIdx + m.yearText.length;
          }
        }

        var overlapRanges = ranges.filter(function (r) { return r.start < m.end && r.end > m.start; });
        if (overlapRanges.length) {
          if (narrowToHighlight) {
            var newStart = Math.max(m.start, Math.min.apply(null, overlapRanges.map(function (r) { return r.start; })));
            var newEnd = Math.min(m.end, Math.max.apply(null, overlapRanges.map(function (r) { return r.end; })));
            if (newStart < newEnd && (newStart !== m.start || newEnd !== m.end)) {
              narrowedCount++;
              m.start = newStart; m.end = newEnd;
            }
          }
        } else if (onlyHighlighted) {
          skippedNotHighlighted++;
          m.skip = true;
        }
      });

      // proses dari belakang supaya offset match sebelumnya tetap valid
      accepted.sort(function (a, b) { return b.start - a.start; });
      accepted.forEach(function (m) {
        if (m.skip) return;
        if (m.bookmarkName) {
          var r = wrapOrRetarget(xmlDoc, bodyParas[pi].el, m.start, m.end, m.bookmarkName, linkColor);
          if (r.ok) {
            linkedList.push(m.raw);
            linkedDetails.push({ raw: m.raw, reason: m.resolution.reason, confidence: m.resolution.confidence, mode: r.mode });
            countReason(m.resolution.reason);
            if (r.mode === 'already') alreadyCount++;
            else if (r.mode === 'retargeted') retargetedCount++;
            else newCount++;
          } else {
            var protectedControl = r.mode === 'protected-control';
            if (protectedControl) protectedControlsSkipped++;
            unmatched.push(m.raw + (protectedControl
              ? ' (dilewati: berada di field/content-control pengelola sitasi)'
              : ' (struktur run tidak didukung — kemungkinan bagian dari hyperlink/format khusus lain)'));
            unmatchedDetails.push({ raw: m.raw, status: 'unsupported', reason: protectedControl ? 'protected-citation-control' : 'unsupported-run-structure', confidence: m.resolution.confidence || 0 });
          }
        } else {
          unmatched.push(m.raw);
          unmatchedDetails.push({ raw: m.raw, status: m.resolution.status || 'nomatch', reason: m.resolution.reason || 'no-match', confidence: m.resolution.confidence || 0, candidateCount: m.resolution.candidates ? m.resolution.candidates.length : 0 });
          countReason(m.resolution.reason);
        }
      });
    });

    // URL/DOI polos di daftar referensi -> jadi bisa diklik. Default AKTIF (kebanyakan orang
    // mau ini otomatis); butuh relsXmlDoc (word/_rels/document.xml.rels, sudah di-parse) yang
    // dikirim si pemanggil, karena link eksternal perlu entri Relationship baru yang TIDAK bisa
    // dibuat cukup dari document.xml saja.
    var urlsLinked = 0;
    if (options.linkReferenceUrls !== false && options.relsXmlDoc) {
      urlsLinked = linkifyReferenceUrls(xmlDoc, options.relsXmlDoc, refParas);
    }

    // Sebutan "Figure N"/"Table N" -> tautkan ke gambar/tabel aslinya. Fitur OPSIONAL, default
    // NONAKTIF — beda dari dua fitur di atas, ini cuma jalan kalau eksplisit diminta.
    var figTblResult = { linked: 0, captionsFound: 0 };
    if (options.linkFiguresTables) {
      figTblResult = linkFigureTableReferences(xmlDoc, bodyParas, articleText, nextAvailableBookmarkId(xmlDoc, 8000), linkColor);
    }

    var integrity = auditDocumentIntegrity(xmlDoc, visibleTextBefore, structureBefore);

    return {
      styleId: styleId,
      styleName: style.name,
      detected: detected,
      refCount: refCount,
      linked: linkedList.length,
      linkedList: linkedList,
      linkedDetails: linkedDetails,
      unmatched: unmatched,
      unmatchedDetails: unmatchedDetails,
      matchBreakdown: matchBreakdown,
      reviewRequired: unmatchedDetails.filter(function(d) { return d.status === 'review' || d.status === 'ambiguous'; }).length,
      safeMode: safeMode,
      preserveCitationControls: preserveCitationControls,
      protectedControlsSkipped: protectedControlsSkipped,
      refParseFailed: parsed.failedLines,
      docHasHighlight: docHasHighlight,
      narrowedToHighlight: narrowedCount,
      skippedNotHighlighted: skippedNotHighlighted,
      newlyLinked: newCount,
      retargeted: retargetedCount,
      alreadyLinked: alreadyCount,
      urlsLinked: urlsLinked,
      figuresTablesLinked: figTblResult.linked,
      figuresTablesCaptionsFound: figTblResult.captionsFound,
      integrity: integrity
    };
  }

  var CitationLinker = {
    linkDocx: linkDocx,
    findExternalUrlMatches: findExternalUrlMatches,
    ensureExternalRelationship: ensureExternalRelationship,
    linkifyReferenceUrls: linkifyReferenceUrls,
    findFigureTableCaptions: findFigureTableCaptions,
    linkFigureTableReferences: linkFigureTableReferences,
    documentVisibleText: documentVisibleText,
    scanDocumentStructure: scanDocumentStructure,
    auditDocumentIntegrity: auditDocumentIntegrity,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CitationLinker;
  if (typeof window !== 'undefined') window.CitationLinker = CitationLinker;
  else if (typeof self !== 'undefined') self.CitationLinker = CitationLinker;
})(typeof window !== 'undefined' ? window : this);
