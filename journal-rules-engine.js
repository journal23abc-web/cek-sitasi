// journal-rules-engine.js — optional, user-configurable "journal submission rules" checker for
// reference lists (minimum reference count, recency percentage, source-type mix, international
// vs local origin mix, etc.). Pure JS, no DOM dependency — usable from Node (tests) or a browser
// <script> tag (attaches to window.JournalRulesEngine).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.JournalRulesEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Origin detection (heuristic — always shown to the user as editable, never final) ----------

  // Strong signals a reference is Indonesian ("local"): explicit country name, common Indonesian
  // journal-title words, well-known Indonesian city/university names, Indonesian-registry domains,
  // or an ISSN pair (Indonesian journals conventionally list P-ISSN/E-ISSN inline; this alone is
  // weak, so it's combined with other signals rather than used standalone).
  var LOCAL_KEYWORDS = [
    'indonesia', 'indonesian', 'universitas', 'sekolah tinggi', 'politeknik', 'fakultas',
    'lppm', 'kemdikbud', 'kemendikbud', 'kemenristek', 'kemenkeu', 'bappenas', 'lipi', 'brin',
    'bank indonesia', 'badan pusat statistik', 'bps ',
    // Common Indonesian cities/regions that show up in publisher/journal addresses.
    'yogyakarta', 'jakarta', 'bandung', 'surabaya', 'semarang', 'malang', 'medan', 'makassar',
    'denpasar', 'surakarta', 'solo', 'palembang', 'bogor', 'bekasi', 'tangerang', 'depok',
    'manado', 'padang', 'pekanbaru', 'banjarmasin', 'aceh', 'bali', 'jawa', 'sumatera',
    'kalimantan', 'sulawesi', 'papua',
  ];
  var LOCAL_DOMAIN_RE = /\.ac\.id\b|\.go\.id\b|\.or\.id\b|\.id\/[^\s]*$/i;
  var LOCAL_ISSN_RE = /\bp-?issn\b|\be-?issn\b/i;

  function normalizeForMatch(s) {
    return (s || '').toLowerCase();
  }

  // Returns { origin: 'local'|'international', confidence: 'high'|'low', signal: string|null }.
  // 'high' confidence = a positive local-language/institution/domain signal was actually found.
  // 'low' confidence = no local signal found, defaulting to international — genuinely uncertain,
  // and exactly the kind of guess the UI should let a person confirm or override, not the kind
  // of guess to silently trust.
  function detectOrigin(ref) {
    var text = normalizeForMatch(ref && (ref.raw || ''));
    if (!text) return { origin: 'international', confidence: 'low', signal: null };

    for (var i = 0; i < LOCAL_KEYWORDS.length; i++) {
      if (text.indexOf(LOCAL_KEYWORDS[i]) !== -1) {
        return { origin: 'local', confidence: 'high', signal: LOCAL_KEYWORDS[i] };
      }
    }
    if (LOCAL_DOMAIN_RE.test(text)) {
      return { origin: 'local', confidence: 'high', signal: 'domain .ac.id/.go.id/.or.id/.id' };
    }
    // ISSN mention alone is weak (some international journals list it too), so it only tips the
    // balance combined with the reference having no other strong international publisher signal.
    if (LOCAL_ISSN_RE.test(text) && !/\b(elsevier|springer|wiley|sage|taylor\s*&\s*francis|ieee|emerald|nature|science direct|mdpi|jstor)\b/i.test(text)) {
      return { origin: 'local', confidence: 'low', signal: 'P-ISSN/E-ISSN tanpa penanda penerbit internasional' };
    }
    return { origin: 'international', confidence: 'low', signal: null };
  }

  // Classifies every reference, applying any user overrides (keyed by reference index in the
  // array passed to evaluateRules — indices must line up with validator.references).
  function classifyReferencesOrigin(references, overrides) {
    overrides = overrides || {};
    return references.map(function (ref, i) {
      if (Object.prototype.hasOwnProperty.call(overrides, i)) {
        return { index: i, ref: ref, origin: overrides[i], confidence: 'manual', signal: 'dikoreksi manual', overridden: true };
      }
      var d = detectOrigin(ref);
      return { index: i, ref: ref, origin: d.origin, confidence: d.confidence, signal: d.signal, overridden: false };
    });
  }

  // ---------- Rule evaluation ----------

  // A rules config looks like:
  // {
  //   minCount: { enabled: true, value: 20 },
  //   yearRange: { enabled: true, years: 10, minPercent: 80 },
  //   sourceType: { enabled: true, type: 'journal-article', minPercent: 70 },
  //   origin: { enabled: true, minInternationalPercent: 50 },
  // }
  // Every rule is independently optional (enabled: false / omitted = skipped entirely), so a
  // person can turn on just the ones their target journal actually requires.

  function pct(n, total) {
    return total > 0 ? Math.round((n / total) * 1000) / 10 : 0; // one decimal place
  }

  var SOURCE_TYPE_LABELS = {
    'journal-article': 'Artikel Jurnal', 'book': 'Buku', 'book-chapter': 'Bab Buku',
    'thesis': 'Skripsi/Tesis/Disertasi', 'conference': 'Prosiding/Konferensi',
    'website': 'Situs Web', 'report': 'Laporan', 'unknown': 'Tidak Diketahui',
  };

  function evaluateRules(references, rules, overrides) {
    rules = rules || {};
    var total = references.length;
    var checks = [];
    var currentYear = new Date().getFullYear();

    if (rules.minCount && rules.minCount.enabled) {
      var required = Number(rules.minCount.value) || 0;
      var pass = total >= required;
      checks.push({
        id: 'minCount', label: 'Jumlah referensi minimal',
        pass: pass, actual: total, required: required,
        detail: total + ' referensi ditemukan, minimal ' + required + '.',
      });
    }

    if (rules.yearRange && rules.yearRange.enabled) {
      var years = Number(rules.yearRange.years) || 10;
      var minPercent = Number(rules.yearRange.minPercent) || 0;
      var cutoff = currentYear - years;
      var withYear = references.filter(function (r) { return /\d{4}/.test(String(r.year || '')); });
      var inRange = withYear.filter(function (r) {
        var y = parseInt(String(r.year).match(/\d{4}/)[0], 10);
        return y >= cutoff;
      });
      var actualPercent = pct(inRange.length, withYear.length);
      checks.push({
        id: 'yearRange', label: years + ' tahun terakhir (\u2265 ' + cutoff + ')',
        pass: actualPercent >= minPercent, actual: actualPercent, required: minPercent,
        detail: inRange.length + ' dari ' + withYear.length + ' referensi bertahun jelas (' + actualPercent + '%) berasal dari ' + years + ' tahun terakhir; minimal ' + minPercent + '%.' +
          (withYear.length < total ? ' (' + (total - withYear.length) + ' referensi tahunnya tidak terbaca, tidak ikut dihitung.)' : ''),
      });
    }

    if (rules.sourceType && rules.sourceType.enabled) {
      var type = rules.sourceType.type || 'journal-article';
      var stMinPercent = Number(rules.sourceType.minPercent) || 0;
      var ofType = references.filter(function (r) { return r.sourceType === type; });
      var stActualPercent = pct(ofType.length, total);
      var typeLabel = SOURCE_TYPE_LABELS[type] || type;
      checks.push({
        id: 'sourceType', label: 'Minimal ' + stMinPercent + '% ' + typeLabel,
        pass: stActualPercent >= stMinPercent, actual: stActualPercent, required: stMinPercent,
        detail: ofType.length + ' dari ' + total + ' referensi (' + stActualPercent + '%) adalah ' + typeLabel + '; minimal ' + stMinPercent + '%.',
      });
    }

    if (rules.origin && rules.origin.enabled) {
      var minIntlPercent = Number(rules.origin.minInternationalPercent) || 0;
      var classified = classifyReferencesOrigin(references, overrides);
      var intlCount = classified.filter(function (c) { return c.origin === 'international'; }).length;
      var originActualPercent = pct(intlCount, total);
      checks.push({
        id: 'origin', label: 'Minimal ' + minIntlPercent + '% referensi internasional',
        pass: originActualPercent >= minIntlPercent, actual: originActualPercent, required: minIntlPercent,
        detail: intlCount + ' dari ' + total + ' referensi (' + originActualPercent + '%) terklasifikasi internasional; minimal ' + minIntlPercent + '%. Klasifikasi ini heuristik — periksa &amp; koreksi di tabel di bawah bila perlu.',
      });
    }

    var enabledChecks = checks; // every pushed check is already for an enabled rule
    var passCount = enabledChecks.filter(function (c) { return c.pass; }).length;
    return {
      checks: checks,
      totalRules: enabledChecks.length,
      passCount: passCount,
      failCount: enabledChecks.length - passCount,
      overallPass: enabledChecks.length > 0 && passCount === enabledChecks.length,
    };
  }

  function defaultRules() {
    return {
      minCount: { enabled: false, value: 20 },
      yearRange: { enabled: false, years: 10, minPercent: 80 },
      sourceType: { enabled: false, type: 'journal-article', minPercent: 70 },
      origin: { enabled: false, minInternationalPercent: 50 },
    };
  }

  return {
    detectOrigin: detectOrigin,
    classifyReferencesOrigin: classifyReferencesOrigin,
    evaluateRules: evaluateRules,
    defaultRules: defaultRules,
    SOURCE_TYPE_LABELS: SOURCE_TYPE_LABELS,
  };
});
