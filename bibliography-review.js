// Optional, exact-line-bound facts for both validator entry points. No network calls.
(function(root) {
  'use strict';
  var BE = root.BibliographyEngine;
  function read() {
    var host = document.getElementById('bibliographyReview');
    if (!host) return [];
    return Array.from(host.querySelectorAll('[data-reference-line]')).map(function(row) {
      var out = { line: row._referenceLine };
      row.querySelectorAll('[data-field]').forEach(function(input) { if (input.value.trim()) out[input.dataset.field] = input.value.trim(); });
      return out;
    }).filter(function(out) { return Object.keys(out).length > 1; });
  }
  function render(references) {
    var host = document.getElementById('bibliographyReview');
    if (!host) return;
    var existing = read(); host.textContent = '';
    references.forEach(function(ref, i) {
      var prior = existing.filter(function(d) { return d.line === ref.raw; });
      var facts = prior.length === 1 ? prior[0] : {};
      var row = document.createElement('details'); row.dataset.referenceLine = 'true'; row._referenceLine = ref.raw;
      row.style.margin = '10px 0';
      var summary = document.createElement('summary');
      summary.textContent = (i + 1) + '. ' + (ref.bibliographicModel && ref.bibliographicModel.title || ref.title || ref.raw) + ' (' + (BE.TYPES[ref.bibliographicType] || 'Belum ditentukan') + ')';
      row.appendChild(summary);
      var label = document.createElement('label'); label.textContent = 'Jenis sumber ';
      var select = document.createElement('select'); select.dataset.field = 'type';
      var auto = document.createElement('option'); auto.value = ''; auto.textContent = 'Gunakan deteksi otomatis'; select.appendChild(auto);
      Object.keys(BE.TYPES).forEach(function(type) { var option = document.createElement('option'); option.value = type; option.textContent = BE.TYPES[type]; select.appendChild(option); });
      select.value = facts.type || ''; label.appendChild(select); row.appendChild(label);
      [['institution', 'Institusi pemberi gelar'], ['degree', 'Jenis tesis / disertasi'], ['place', 'Lokasi penerbit / institusi'],
        ['accessed', 'Tanggal akses sebenarnya (mis. 2026, October 15)'], ['journalAbbreviation', 'Singkatan jurnal IEEE terverifikasi'],
        ['nlmAbbreviation', 'Singkatan jurnal NLM terverifikasi']].forEach(function(field) {
        var l = document.createElement('label'); l.textContent = field[1] + ' '; l.style.display = 'block'; l.style.marginTop = '6px';
        var input = document.createElement('input'); input.type = 'text'; input.dataset.field = field[0]; input.value = facts[field[0]] || ''; l.appendChild(input); row.appendChild(l);
      });
      host.appendChild(row);
    });
    host.onchange = function() {
      var status = document.getElementById('bibliographyStatusBanner');
      if (status) status.textContent = 'Detail sumber diubah. Jalankan validasi ulang untuk memperbarui temuan dan laporan.';
    };
  }
  root.BibliographyReview = { read: read, render: render };
})(window);
