// Dark/light mode toggle, shared by index.html and upload.html.
// The actual theme attribute is set synchronously in an inline <head> script (before this
// file even loads) to avoid a flash of the wrong theme — this file just wires up the toggle
// button and keeps it in sync with whatever theme is currently active.
(function() {
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyButtonState(btn, theme) {
    if (!btn) return;
    btn.textContent = theme === 'light' ? '🌙 Gelap' : '☀️ Terang';
    btn.setAttribute('aria-label', theme === 'light' ? 'Beralih ke mode gelap' : 'Beralih ke mode terang');
  }

  function init() {
    var btn = document.getElementById('themeToggle');
    applyButtonState(btn, currentTheme());
    if (!btn) return;
    btn.addEventListener('click', function() {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('citationValidatorTheme', next); } catch (e) {}
      applyButtonState(btn, next);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
