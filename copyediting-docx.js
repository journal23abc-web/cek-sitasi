/* Read-only OOXML extraction and a NEW, separate editorial letter DOCX. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CopyeditingDocx = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  var A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  function all(node, ns, name) { return Array.from(node.getElementsByTagNameNS(ns, name)); }
  function attr(node, ns, name) { return node ? (node.getAttributeNS(ns, name) || node.getAttribute(name) || '') : ''; }
  function ancestor(node, ns, names) {
    for (var p = node.parentNode; p && p.nodeType === 1; p = p.parentNode) if (p.namespaceURI === ns && names.includes(p.localName)) return p;
    return null;
  }
  function enabled(node) { return node && !/^(?:false|0|off)$/i.test(attr(node, W, 'val')); }
  function paragraphText(p) {
    var pieces = [];
    function walk(node) {
      if (node !== p && node.nodeType === 1 && node.namespaceURI === W && ['p', 'del', 'moveFrom', 'instrText'].includes(node.localName)) return;
      if (node.nodeType === 1 && node.namespaceURI === W && node.localName === 'r') {
        var props = Array.from(node.childNodes).find(function (c) { return c.localName === 'rPr' && c.namespaceURI === W; });
        if (props && all(props, W, 'vanish').some(enabled)) return;
      }
      if (node.nodeType === 1 && ((node.namespaceURI === W || node.namespaceURI === M) && node.localName === 't')) { pieces.push(node.textContent || ''); return; }
      if (node.nodeType === 1 && node.namespaceURI === W && ['tab', 'br', 'cr'].includes(node.localName)) pieces.push(node.localName === 'tab' ? '\t' : '\n');
      Array.from(node.childNodes || []).forEach(walk);
    }
    walk(p); return pieces.join('');
  }
  function parseXml(text, Parser) {
    var doc = new Parser().parseFromString(text, 'application/xml');
    if (!doc.documentElement || doc.getElementsByTagName('parsererror').length) throw new Error('Bagian XML Word tidak dapat dibaca.');
    return doc;
  }
  function extractPart(xml, part, Parser, start) {
    var doc = parseXml(xml, Parser), records = [], nodes = [];
    all(doc, W, 'p').forEach(function (p) {
      if (ancestor(p, W, ['del', 'moveFrom'])) return;
      var note = ancestor(p, W, ['footnote', 'endnote']);
      if (note && /^(?:separator|continuationSeparator|continuationNotice)$/.test(attr(note, W, 'type'))) return;
      var text = paragraphText(p);
      if (!text.trim()) return;
      var kind = /^word\/header/.test(part) ? 'header' : /^word\/footer/.test(part) ? 'footer' : /footnotes/.test(part) ? 'footnote' : /endnotes/.test(part) ? 'endnote' : ancestor(p, W, ['txbxContent']) ? 'textbox' : ancestor(p, W, ['tbl']) ? 'table' : 'body';
      var style = all(p, W, 'pStyle')[0];
      records.push({ id: 'P' + String(start + records.length + 1).padStart(4, '0'), text: text, part: part, kind: kind, style: attr(style, W, 'val'), highlighted: all(p, W, 'highlight').some(function (n) { return attr(n, W, 'val') !== 'none'; }) });
      nodes.push(p);
    });
    return { records: records, nodes: nodes, xmlDoc: doc, tableCount: all(doc, W, 'tbl').length };
  }
  function dimensions(bytes) {
    if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
      var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (bytes.length >= 10 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return { width: bytes[6] + bytes[7] * 256, height: bytes[8] + bytes[9] * 256 };
    if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
      var i = 2;
      while (i + 8 < bytes.length) {
        if (bytes[i] !== 255) { i++; continue; }
        var marker = bytes[i + 1];
        if (marker === 217 || marker === 218) break;
        if (marker === 0 || marker === 255 || (marker >= 208 && marker <= 216)) { i += 2; continue; }
        var size = bytes[i + 2] * 256 + bytes[i + 3];
        if (size < 2 || i + 2 + size > bytes.length) break;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return { height: bytes[i + 5] * 256 + bytes[i + 6], width: bytes[i + 7] * 256 + bytes[i + 8] };
        i += size + 2;
      }
    }
    return null;
  }
  function resolvePath(part, target) {
    if (target.startsWith('/')) return target.slice(1);
    var paths = part.split('/'); paths.pop();
    target.split('/').forEach(function (s) { if (s === '..') paths.pop(); else if (s !== '.') paths.push(s); });
    return paths.join('/');
  }
  async function read(file, options) {
    options = options || {};
    var Zip = options.JSZip || JSZip, Parser = options.DOMParser || DOMParser;
    if (!file || !/\.docx$/i.test(file.name)) throw new Error('Pilih naskah .docx.');
    if (file.size > 25 * 1024 * 1024) throw new Error('Ukuran maksimum naskah adalah 25 MB.');
    var zip = await Zip.loadAsync(await file.arrayBuffer());
    var entries = Object.keys(zip.files);
    if (entries.length > 3000) throw new Error('Struktur dokumen terlalu besar untuk audit browser.');
    var inflated = entries.reduce(function (n, key) { return n + ((zip.files[key]._data && zip.files[key]._data.uncompressedSize) || 0); }, 0);
    if (inflated > 150 * 1024 * 1024) throw new Error('Isi DOCX setelah ekstraksi melebihi 150 MB.');
    if (!zip.file('word/document.xml')) throw new Error('word/document.xml tidak ditemukan.');
    var partNames = ['word/document.xml'].concat(entries.filter(function (s) { return /^word\/(?:header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(s); }).sort());
    var records = [], images = [], tableCount = 0, warnings = [];
    for (var part of partNames) {
      var xml = await zip.file(part).async('string');
      if (xml.length > 15 * 1024 * 1024) throw new Error('Bagian teks Word terlalu besar.');
      var extracted = extractPart(xml, part, Parser, records.length);
      records = records.concat(extracted.records);
      if (part === 'word/document.xml') tableCount = extracted.tableCount;
      var relPath = part.replace(/\/([^/]+)$/, '/_rels/$1.rels'), relationships = {};
      if (zip.file(relPath)) {
        var relDoc = parseXml(await zip.file(relPath).async('string'), Parser);
        all(relDoc, REL, 'Relationship').forEach(function (r) { relationships[r.getAttribute('Id')] = { target: r.getAttribute('Target'), external: r.getAttribute('TargetMode') === 'External' }; });
      }
      for (var blip of all(extracted.xmlDoc, A, 'blip')) {
        var rid = attr(blip, R, 'embed') || attr(blip, R, 'link'), rel = relationships[rid];
        var path = rel && !rel.external ? resolvePath(part, rel.target) : '';
        var drawing = ancestor(blip, W, ['drawing']), extent = drawing && all(drawing, WP, 'extent')[0], docPr = drawing && all(drawing, WP, 'docPr')[0];
        var image = { relationshipId: rid, part: part, path: path, name: docPr ? docPr.getAttribute('name') : path, description: docPr ? docPr.getAttribute('descr') : '', external: !!(rel && rel.external), missing: !(rel && (rel.external || zip.file(path))), dpi: null };
        if (path && zip.file(path)) {
          var bytes = await zip.file(path).async('uint8array'), size = dimensions(bytes), widthInches = extent ? Number(extent.getAttribute('cx')) / 914400 : 0;
          if (size) { image.width = size.width; image.height = size.height; if (widthInches) image.dpi = size.width / widthInches; }
        }
        images.push(image);
      }
      if (all(extracted.xmlDoc, W, 'altChunk').length) warnings.push('Konten altChunk ditemukan di ' + part + '; buka dan simpan ulang di Word agar kontennya menjadi paragraf yang dapat diperiksa.');
      if (all(extracted.xmlDoc, W, 'del').length || all(extracted.xmlDoc, W, 'ins').length) warnings.push('Track Changes ditemukan di ' + part + '. Audit membaca teks yang terlihat setelah perubahan diterima; teks yang dihapus dikecualikan.');
      if (all(extracted.xmlDoc, W, 'object').length || all(extracted.xmlDoc, W, 'pict').length) warnings.push('Objek atau gambar VML ditemukan di ' + part + '; teks dalam objek dan legibilitas gambar perlu inspeksi editor di Word.');
    }
    if (!records.length) throw new Error('Tidak ditemukan teks yang dapat diaudit.');
    return { fileName: file.name, records: records, tableCount: tableCount, images: images, warnings: warnings, fullText: records.map(function (r) { return '[' + r.id + ' | ' + r.kind + '] ' + r.text; }).join('\n\n') };
  }
  function xmlEsc(text) { return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); }
  function serialize(doc, Serializer) { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + new Serializer().serializeToString(doc.documentElement); }
  function commentNode(doc, id, text) {
    var node = doc.createElementNS(W, 'w:comment');
    node.setAttributeNS(W, 'w:id', String(id)); node.setAttributeNS(W, 'w:author', 'Editorial Audit'); node.setAttributeNS(W, 'w:initials', 'EA'); node.setAttributeNS(W, 'w:date', new Date().toISOString());
    text.split(/\n/).forEach(function (line) {
      var p = doc.createElementNS(W, 'w:p'), r = doc.createElementNS(W, 'w:r'), t = doc.createElementNS(W, 'w:t');
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.textContent = line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); r.appendChild(t); p.appendChild(r); node.appendChild(p);
    });
    return node;
  }
  async function annotatedBlob(file, result, letter, options) {
    options = options || {};
    var Zip = options.JSZip || JSZip, Parser = options.DOMParser || DOMParser, Serializer = options.XMLSerializer || XMLSerializer;
    var zip = await Zip.loadAsync(await file.arrayBuffer()), nodes = new Map(), parts = new Map(), offset = 0;
    var partNames = ['word/document.xml'].concat(Object.keys(zip.files).filter(function (s) { return /^word\/(?:header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(s); }).sort());
    for (var part of partNames) {
      var extracted = extractPart(await zip.file(part).async('string'), part, Parser, offset);
      extracted.records.forEach(function (r, i) { nodes.set(r.id, { node: extracted.nodes[i], record: r, doc: extracted.xmlDoc }); });
      parts.set(part, extracted); offset += extracted.records.length;
    }
    // Verify that all paragraph identities still describe THIS exact uploaded document.
    if (nodes.size !== result.doc.records.length || result.doc.records.some(function (r) { return !nodes.has(r.id) || nodes.get(r.id).record.text !== r.text || nodes.get(r.id).record.part !== r.part; })) throw new Error('Naskah berubah sejak audit. Jalankan audit ulang sebelum ekspor Word.');
    var mainNodes = Array.from(nodes.values()).filter(function (entry) { return entry.record.part === 'word/document.xml'; });
    if (!mainNodes.length) throw new Error('Tidak ditemukan paragraf utama untuk komentar Word.');
    var relPath = 'word/_rels/document.xml.rels', relDoc = parseXml(zip.file(relPath) ? await zip.file(relPath).async('string') : '<Relationships xmlns="' + REL + '"/>', Parser);
    var commentRel = all(relDoc, REL, 'Relationship').find(function (r) { return /\/comments$/.test(r.getAttribute('Type') || ''); });
    if (commentRel && commentRel.getAttribute('TargetMode') === 'External') throw new Error('Komentar Word memiliki hubungan eksternal yang tidak didukung.');
    var commentsPath = commentRel ? resolvePath('word/document.xml', commentRel.getAttribute('Target')) : 'word/comments.xml';
    var commentsDoc = parseXml(zip.file(commentsPath) ? await zip.file(commentsPath).async('string') : '<w:comments xmlns:w="' + W + '"/>', Parser);
    var usedIds = all(commentsDoc, W, 'comment').map(function (c) { return Number(attr(c, W, 'id')); }).filter(Number.isFinite);
    parts.forEach(function (p) { ['commentRangeStart', 'commentRangeEnd', 'commentReference'].forEach(function (tag) { all(p.xmlDoc, W, tag).forEach(function (n) { var id = Number(attr(n, W, 'id')); if (Number.isFinite(id)) usedIds.push(id); }); }); });
    var nextId = usedIds.length ? Math.max.apply(null, usedIds) + 1 : 0, commentsByParagraph = new Map(), fallbackCount = 0;
    function attach(id, text) {
      if (!commentsByParagraph.has(id)) commentsByParagraph.set(id, []);
      commentsByParagraph.get(id).push(text);
    }
    attach(mainNodes[0].record.id, 'FORMAL EDITORIAL NOTE\n\n' + letter);
    result.issues.filter(function (issue) { return issue.selected; }).forEach(function (issue) {
      var anchors = (issue.evidence || []).map(function (e) { return nodes.get(e.paragraphId); }).filter(function (n) { return n && n.record.part === 'word/document.xml'; });
      var anchor = anchors[0] || mainNodes[0];
      var source = (issue.evidence || []).map(function (e) { return '[' + e.paragraphId + '] ' + e.quote; }).join('\n');
      if (!anchors.length && (issue.evidence || []).length) fallbackCount++;
      attach(anchor.record.id, 'Section ' + issue.section + '\n' + issue.comment + (source ? '\n\nEvidence (paragraph IDs in the audit):\n' + source : '\n\nDocument-level issue; this anchor is a location for the note, not evidence that the title is incorrect.'));
    });
    result.verification.forEach(function (v) {
      if (!['not_checked', 'unverified', 'partial_match', 'metadata_mismatch'].includes(v.status)) return;
      var ref = result.references.find(function (r) { return r.id === v.refId; }), anchor = ref && nodes.get(ref.recordIds[0]);
      if (!anchor || anchor.record.part !== 'word/document.xml') return;
      var detail = (v.differences || []).map(function (d) { return d.field + ': manuscript “' + d.provided + '”; fetched record “' + d.official + '”.'; }).join('\n');
      attach(anchor.record.id, '4 Reference List and DOI Verification\n' + ref.id + ': ' + (v.status === 'not_checked' || v.status === 'unverified' ? 'Unverified reference. Verify this source against its official publisher, journal, DOI record, or institutional page. No conclusion of fabrication is justified.' : v.status === 'partial_match' ? 'Partial metadata match. Verify the fields that could not be compared: ' + (v.missingFields || []).join(', ') + '.' : 'Fetched bibliographic metadata differs. Confirm the source identity and correct the bibliographic details.') + '\n' + v.reason + (detail ? '\n' + detail : '') + (v.sourceUrl ? '\nEvidence: ' + v.sourceUrl : ''));
    });
    var commentCount = 0, highlightedParagraphs = 0;
    commentsByParagraph.forEach(function (texts, id) {
      var entry = nodes.get(id), doc = entry.doc, p = entry.node, cid = nextId++;
      var start = doc.createElementNS(W, 'w:commentRangeStart'), end = doc.createElementNS(W, 'w:commentRangeEnd'), reference = doc.createElementNS(W, 'w:r'), mark = doc.createElementNS(W, 'w:commentReference');
      start.setAttributeNS(W, 'w:id', String(cid)); end.setAttributeNS(W, 'w:id', String(cid)); mark.setAttributeNS(W, 'w:id', String(cid)); reference.appendChild(mark);
      var firstContent = Array.from(p.childNodes).find(function (n) { return n.nodeType === 1 && !(n.namespaceURI === W && n.localName === 'pPr'); });
      p.insertBefore(start, firstContent || null); p.appendChild(end); p.appendChild(reference);
      if (options.highlight && id !== mainNodes[0].record.id) {
        all(p, W, 'r').forEach(function (run) {
          if (!all(run, W, 't').length || ancestor(run, W, ['del', 'moveFrom'])) return;
          var rPr = Array.from(run.childNodes).find(function (n) { return n.localName === 'rPr' && n.namespaceURI === W; });
          if (!rPr) { rPr = doc.createElementNS(W, 'w:rPr'); run.insertBefore(rPr, run.firstChild); }
          if (!all(rPr, W, 'highlight').length) { var hl = doc.createElementNS(W, 'w:highlight'); hl.setAttributeNS(W, 'w:val', 'yellow'); rPr.appendChild(hl); }
        });
        highlightedParagraphs++;
      }
      commentsDoc.documentElement.appendChild(commentNode(commentsDoc, cid, texts.join('\n\n'))); commentCount++;
    });
    // Do not overwrite an existing comments part or its relationship; append using fresh IDs.
    if (!commentRel) {
      var usedRelIds = new Set(all(relDoc, REL, 'Relationship').map(function (r) { return r.getAttribute('Id'); })), relId = 1;
      while (usedRelIds.has('rId' + relId)) relId++;
      var relationship = relDoc.createElementNS(REL, 'Relationship'); relationship.setAttribute('Id', 'rId' + relId); relationship.setAttribute('Type', R + '/comments'); relationship.setAttribute('Target', commentsPath.slice(5)); relDoc.documentElement.appendChild(relationship);
      zip.file(relPath, serialize(relDoc, Serializer));
    }
    var typesDoc = parseXml(await zip.file('[Content_Types].xml').async('string'), Parser), CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
    if (!all(typesDoc, CT, 'Override').some(function (node) { return node.getAttribute('PartName') === '/' + commentsPath; })) {
      var override = typesDoc.createElementNS(CT, 'Override'); override.setAttribute('PartName', '/' + commentsPath); override.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'); typesDoc.documentElement.appendChild(override); zip.file('[Content_Types].xml', serialize(typesDoc, Serializer));
    }
    var mainPart = parts.get('word/document.xml'), before = mainPart.records.map(function (r) { return r.text; }), after = extractPart(serialize(mainPart.xmlDoc, Serializer), 'word/document.xml', Parser, 0).records.map(function (r) { return r.text; });
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Ekspor dibatalkan karena teks naskah berubah.');
    zip.file('word/document.xml', serialize(mainPart.xmlDoc, Serializer)); zip.file(commentsPath, serialize(commentsDoc, Serializer));
    var blob = await zip.generateAsync({ type: options.outputType || 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
    return { blob: blob, commentCount: commentCount, highlightedParagraphs: highlightedParagraphs, fallbackCount: fallbackCount };
  }
  return { read: read, extractPart: extractPart, dimensions: dimensions, annotatedBlob: annotatedBlob };
});
