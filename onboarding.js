// Reusable first-time onboarding popup — shows a short "here's what this tool does" overview
// automatically the first time someone opens a page, then never again unless they click the
// "?" button in the header to bring it back up. One localStorage key per page (via config.key)
// so pages track their own "seen" state independently.
(function () {
  var STYLE_ID = 'onb-style';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = ''
      + '.onb-overlay{position:fixed;inset:0;background:rgba(4,6,12,.72);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;opacity:0;transition:opacity .18s ease;}'
      + '.onb-overlay.show{opacity:1;}'
      + '.onb-modal{position:relative;width:100%;max-width:480px;max-height:86vh;overflow-y:auto;background:linear-gradient(180deg, var(--panel-raised), var(--panel));border:1px solid var(--hairline);border-radius:14px;padding:28px;transform:translateY(10px) scale(.98);transition:transform .18s ease;box-shadow:0 24px 60px rgba(0,0,0,.4);}'
      + '.onb-overlay.show .onb-modal{transform:translateY(0) scale(1);}'
      + '.onb-modal .corner{position:absolute;width:14px;height:14px;border:1.5px solid var(--cyan);opacity:.5;}'
      + '.onb-modal .corner.tl{top:-1px;left:-1px;border-right:none;border-bottom:none;border-radius:14px 0 0 0;}'
      + '.onb-modal .corner.br{bottom:-1px;right:-1px;border-left:none;border-top:none;border-radius:0 0 14px 0;}'
      + '.onb-eyebrow{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);margin-bottom:8px;}'
      + '.onb-title{font-family:var(--font-display);font-weight:700;font-size:20px;color:var(--text);margin:0 0 8px;letter-spacing:-0.01em;}'
      + '.onb-subtitle{font-size:12.5px;color:var(--text-dim);line-height:1.65;margin:0 0 22px;}'
      + '.onb-list{display:flex;flex-direction:column;gap:16px;margin-bottom:26px;}'
      + '.onb-item{display:flex;gap:13px;align-items:flex-start;}'
      + '.onb-item .onb-icon{flex:none;width:34px;height:34px;border-radius:9px;background:var(--input-bg);border:1px solid var(--hairline);display:flex;align-items:center;justify-content:center;font-size:16px;}'
      + '.onb-item .onb-body b{display:block;font-size:13px;color:var(--text);margin-bottom:3px;font-family:var(--font-display);}'
      + '.onb-item .onb-body span{font-size:12px;color:var(--text-dim);line-height:1.6;}'
      + '.onb-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px dashed var(--hairline);padding-top:18px;}'
      + '.onb-dismiss{font-family:var(--font-mono);font-size:11px;color:var(--text-faint);background:none;border:none;cursor:pointer;padding:6px 0;}'
      + '.onb-dismiss:hover{color:var(--text-dim);}'
      + '.onb-cta{font-family:var(--font-mono);font-size:12px;letter-spacing:.05em;color:var(--void);background:var(--cyan);border:none;border-radius:7px;padding:10px 20px;cursor:pointer;font-weight:600;transition:filter .15s ease;}'
      + '.onb-cta:hover{filter:brightness(1.08);}'
      + '.onb-help-btn{font-family:var(--font-mono);font-size:11.5px;letter-spacing:.06em;color:var(--text-dim);background:var(--input-bg);border:1px solid var(--hairline);border-radius:6px;padding:9px 12px;cursor:pointer;transition:all .15s ease;display:inline-flex;align-items:center;gap:6px;}'
      + '.onb-help-btn:hover{border-color:var(--cyan);color:var(--cyan);}'
      + '@media (max-width:520px){.onb-modal{padding:22px;}}';
    var tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function build(config) {
    var overlay = document.createElement('div');
    overlay.className = 'onb-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', config.title);

    var itemsHtml = config.items.map(function (it) {
      return '<div class="onb-item"><div class="onb-icon">' + it.icon + '</div>'
        + '<div class="onb-body"><b>' + it.title + '</b><span>' + it.desc + '</span></div></div>';
    }).join('');

    overlay.innerHTML =
      '<div class="onb-modal">'
      + '<span class="corner tl"></span><span class="corner br"></span>'
      + '<div class="onb-eyebrow">' + (config.eyebrow || 'Cara Pakai') + '</div>'
      + '<div class="onb-title">' + config.title + '</div>'
      + (config.subtitle ? '<p class="onb-subtitle">' + config.subtitle + '</p>' : '')
      + '<div class="onb-list">' + itemsHtml + '</div>'
      + '<div class="onb-footer">'
      + '<button type="button" class="onb-dismiss" data-onb-close>Tutup</button>'
      + '<button type="button" class="onb-cta" data-onb-close>' + (config.ctaText || 'Mengerti, mulai! →') + '</button>'
      + '</div>'
      + '</div>';

    return overlay;
  }

  function show(config) {
    injectStyle();
    var overlay = build(config);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { overlay.classList.add('show'); });

    function close() {
      overlay.classList.remove('show');
      document.body.style.overflow = '';
      setTimeout(function () { overlay.remove(); }, 180);
      try { localStorage.setItem(config.key, '1'); } catch (e) {}
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.hasAttribute('data-onb-close')) close();
    });
  }

  // config: { key, eyebrow, title, subtitle, items: [{icon, title, desc}], ctaText, helpBtnId }
  // Shows automatically once (tracked via localStorage[config.key]); if `helpBtnId` is given,
  // wires up that button to re-open the same popup manually at any time afterward.
  window.initOnboarding = function (config) {
    if (config.helpBtnId) {
      var btn = document.getElementById(config.helpBtnId);
      if (btn) btn.addEventListener('click', function () { show(config); });
    }
    var alreadySeen = false;
    try { alreadySeen = localStorage.getItem(config.key) === '1'; } catch (e) {}
    if (!alreadySeen) {
      setTimeout(function () { show(config); }, 260);
    }
  };
})();
