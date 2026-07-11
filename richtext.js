// RichEditable: turns a contenteditable <div> into an italic-preserving text input.
// Model: one flat flow per element, lines separated by <br>, italic runs wrapped in <i>.
// Nothing else (no fonts, colors, classes, spans) survives a paste — this keeps the DOM
// simple to read back out reliably.
(function() {
  var W = window;

  function isTextarea(el) { return el.tagName === 'TEXTAREA'; }

  // ---- Reading ----
  // Walks live DOM (or a detached fragment) into: [ [ {text, italic}, ... ], ... ] (lines).
  function walkToRichLines(root) {
    var lines = [];
    var current = [];
    function pushText(text, italic) {
      if (text === '') return;
      var last = current[current.length - 1];
      if (last && last.italic === italic) last.text += text;
      else current.push({ text: text, italic: italic });
    }
    function walk(node, italic) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var n = node.childNodes[i];
        if (n.nodeType === 3) { // text node
          pushText(n.nodeValue.replace(/\u00a0/g, ' '), italic);
        } else if (n.nodeType === 1) {
          var tag = n.tagName;
          if (tag === 'BR') {
            lines.push(current); current = [];
          } else if (tag === 'DIV' || tag === 'P' || tag === 'LI') {
            if (lines.length > 0 || current.length > 0) { lines.push(current); current = []; }
            var style = (n.getAttribute('style') || '');
            var childItalic = italic || tag === 'I' || tag === 'EM' || /font-style:\s*italic/i.test(style);
            walk(n, childItalic);
            lines.push(current); current = [];
          } else {
            var style2 = (n.getAttribute('style') || '');
            var childItalic2 = italic || tag === 'I' || tag === 'EM' || /font-style:\s*italic/i.test(style2);
            walk(n, childItalic2);
          }
        }
      }
    }
    walk(root, false);
    lines.push(current);
    // Drop a single trailing fully-empty line (typical trailing <br> artifact).
    if (lines.length > 1 && lines[lines.length - 1].every(function(s) { return !s.text; })) lines.pop();
    return lines;
  }

  function getRichLines(el) {
    if (isTextarea(el)) {
      return el.value.split('\n').map(function(l) { return l ? [{ text: l, italic: false }] : []; });
    }
    return walkToRichLines(el);
  }

  function richLinesToPlainText(lines) {
    return lines.map(function(line) { return line.map(function(s) { return s.text; }).join(''); }).join('\n');
  }

  function getText(el) {
    if (isTextarea(el)) return el.value;
    return richLinesToPlainText(getRichLines(el));
  }

  // ---- Writing ----
  function renderRichLinesFragment(lines) {
    var frag = document.createDocumentFragment();
    lines.forEach(function(line, idx) {
      if (idx > 0) frag.appendChild(document.createElement('br'));
      line.forEach(function(seg) {
        if (!seg.text) return;
        if (seg.italic) {
          var i = document.createElement('i');
          i.textContent = seg.text;
          frag.appendChild(i);
        } else {
          frag.appendChild(document.createTextNode(seg.text));
        }
      });
    });
    return frag;
  }

  function updateEmptyState(el) {
    var empty = getText(el).trim() === '';
    el.classList.toggle('is-empty', empty);
  }

  function setRichLines(el, lines) {
    if (isTextarea(el)) { el.value = richLinesToPlainText(lines); return; }
    el.innerHTML = '';
    el.appendChild(renderRichLinesFragment(lines));
    updateEmptyState(el);
  }

  function setText(el, text) {
    if (isTextarea(el)) { el.value = text; return; }
    var lines = (text || '').split('\n').map(function(l) { return l ? [{ text: l, italic: false }] : []; });
    setRichLines(el, lines);
  }

  // ---- Paste handling ----
  function sanitizeClipboardHtml(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    // Drop obviously non-content elements Word/Docs sometimes include.
    tmp.querySelectorAll('script,style,meta,link,img,table').forEach(function(n) { n.remove(); });
    return walkToRichLines(tmp);
  }

  function insertRichLinesAtCursor(el, lines) {
    var sel = window.getSelection();
    var range;
    if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      range = sel.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.deleteContents();
    var frag = renderRichLinesFragment(lines);
    var lastNode = frag.lastChild;
    range.insertNode(frag);
    if (lastNode) {
      var newRange = document.createRange();
      newRange.setStartAfter(lastNode);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
    updateEmptyState(el);
  }

  function initRichInput(el) {
    el.setAttribute('contenteditable', 'true');
    el.classList.add('rich-input');
    updateEmptyState(el);

    el.addEventListener('paste', function(e) {
      e.preventDefault();
      var html = e.clipboardData && e.clipboardData.getData('text/html');
      var lines;
      if (html) {
        lines = sanitizeClipboardHtml(html);
      } else {
        var text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
        lines = text.split('\n').map(function(l) { return l ? [{ text: l, italic: false }] : []; });
      }
      insertRichLinesAtCursor(el, lines);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    el.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.execCommand('insertLineBreak');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    el.addEventListener('input', function() { updateEmptyState(el); });
  }

  // Splits a rich-lines array into {article, references, headingText} rich-lines parts,
  // using the same heading-detection logic as CE.splitDocumentByReferences (operating on
  // the plain-text projection) so behavior matches exactly — but returns rich (italic-
  // preserving) line arrays instead of plain strings.
  function splitRichByReferences(lines) {
    var CE = W.CitationEngine;
    if (!CE) return null;
    var plainText = richLinesToPlainText(lines);
    var heading = CE.findReferencesHeading(plainText);
    if (!heading) return null;
    function isBlankLine(line) { return line.every(function(s) { return !s.text.trim(); }); }
    function trimBlank(arr) {
      var start = 0, end = arr.length;
      while (start < end && isBlankLine(arr[start])) start++;
      while (end > start && isBlankLine(arr[end - 1])) end--;
      return arr.slice(start, end);
    }
    var article = trimBlank(lines.slice(0, heading.lineIndex));
    var references = trimBlank(lines.slice(heading.lineIndex + 1));
    return { article: article, references: references, headingText: heading.text };
  }

  W.RichEditable = {
    init: initRichInput,
    getText: getText,
    setText: setText,
    getRichLines: getRichLines,
    setRichLines: setRichLines,
    splitRichByReferences: splitRichByReferences,
  };
})();
