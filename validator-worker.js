// Runs MultiFormatValidator.validate() off the main thread for large documents, so the tab
// doesn't freeze while parsing/matching hundreds of references. Only handles the CPU-bound
// validation step — DOI network checks stay on the main thread (already async/progressive).
importScripts('engine.js');

self.onmessage = function(e) {
  var msg = e.data || {};
  try {
    var CE = self.CitationEngine;
    if (!CE) throw new Error('CitationEngine gagal dimuat di dalam worker.');
    var validator = new CE.MultiFormatValidator(msg.articleText, msg.referenceText, msg.styleId);
    var result = validator.validate();
    self.postMessage({ ok: true, result: result });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err) });
  }
};
