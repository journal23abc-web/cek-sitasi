/* Runs the CPU-heavy concept analysis away from the UI thread. */
'use strict';

importScripts('term-consistency-engine.js?v=3');

self.onmessage = function (event) {
  var message = event.data || {};
  if (message.type !== 'analyze') return;
  try {
    var result = self.TermConsistencyEngine.buildConceptDictionary(message.text || '', message.options || {});
    self.postMessage({ type: 'result', requestId: message.requestId, result: result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId,
      message: error && error.message ? error.message : String(error),
    });
  }
};
