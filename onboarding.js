// Reusable first-time onboarding TOUR — walks through the page step by step, spotlighting the
// actual button/control being explained (not a static list). Shows automatically the first time
// someone opens a page (tracked via localStorage[config.key]), and can be replayed anytime via
// the "?" help button in the header.
(function () {
  var STYLE_ID = 'onb-style';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = ''
      + '.onb-dim{position:fixed;inset:0;background:rgba(4,6,12,.72);z-index:9997;opacity:0;transition:opacity .18s ease;}'
      + '.onb-dim.show{opacity:1;}'
      + '.onb-spot{position:fixed;z-index:9998;border-radius:10px;box-shadow:0 0 0 6000px rgba(4,6,12,.72),0 0 0 3px var(--cyan),0 0 22px 2px var(--glow-cyan);pointer-events:none;transition:top .28s cubic-bezier(.4,0,.2,1),left .28s cubic-bezier(.4,0,.2,1),width .28s cubic-bezier(.4,0,.2,1),height .28s cubic-bezier(.4,0,.2,1),opacity .18s ease;opacity:0;}'
      + '.onb-spot.show{opacity:1;}'
      + '.onb-card{position:fixed;z-index:9999;width:300px;max-width:calc(100vw - 32px);background:linear-gradient(180deg, var(--panel-raised), var(--panel));border:1px solid var(--hairline);border-radius:12px;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.45);opacity:0;transform:translateY(6px);transition:opacity .18s ease,transform .18s ease,top .28s cubic-bezier(.4,0,.2,1),left .28s cubic-bezier(.4,0,.2,1);}'
      + '.onb-card.show{opacity:1;transform:translateY(0);}'
      + '.onb-card.centered{width:340px;top:50%!important;left:50%!important;transform:translate(-50%,-50%);}'
      + '.onb-card.centered.show{transform:translate(-50%,-50%);}'
      + '.onb-card .corner{position:absolute;width:12px;height:12px;border:1.5px solid var(--cyan);opacity:.5;}'
      + '.onb-card .corner.tl{top:-1px;left:-1px;border-right:none;border-bottom:none;border-radius:12px 0 0 0;}'
      + '.onb-card .corner.br{bottom:-1px;right:-1px;border-left:none;border-top:none;border-radius:0 0 12px 0;}'
      + '.onb-step-tag{font-family:var(--font-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--cyan);margin-bottom:9px;display:flex;align-items:center;gap:8px;}'
      + '.onb-step-tag .onb-dots{display:flex;gap:4px;}'
      + '.onb-step-tag .onb-dot{width:5px;height:5px;border-radius:50%;background:var(--hairline);}'
      + '.onb-step-tag .onb-dot.active{background:var(--cyan);}'
      + '.onb-card-icon{font-size:22px;margin-bottom:8px;}'
      + '.onb-card-title{font-family:var(--font-display);font-weight:700;font-size:15.5px;color:var(--text);margin:0 0 7px;letter-spacing:-.005em;}'
      + '.onb-card-desc{font-size:12px;color:var(--text-dim);line-height:1.65;margin:0 0 18px;}'
      + '.onb-card-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;}'
      + '.onb-skip{font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint);background:none;border:none;cursor:pointer;padding:4px 0;}'
      + '.onb-skip:hover{color:var(--text-dim);}'
      + '.onb-nav-btns{display:flex;gap:8px;}'
      + '.onb-prev{font-family:var(--font-mono);font-size:11.5px;color:var(--text-dim);background:var(--input-bg);border:1px solid var(--hairline);border-radius:6px;padding:8px 12px;cursor:pointer;}'
      + '.onb-prev:hover{border-color:var(--text-dim);}'
      + '.onb-prev:disabled{opacity:.35;cursor:default;}'
      + '.onb-next{font-family:var(--font-mono);font-size:11.5px;letter-spacing:.04em;color:var(--void);background:var(--cyan);border:none;border-radius:6px;padding:8px 14px;cursor:pointer;font-weight:600;transition:filter .15s ease;}'
      + '.onb-next:hover{filter:brightness(1.08);}'
      + '@media (max-width:480px){.onb-card{width:calc(100vw - 32px);}}';
    var tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function Tour(config) {
    this.config = config;
    this.steps = config.steps;
    this.i = 0;
    this.dim = null;
    this.spot = null;
    this.card = null;
    this._onResize = this._reposition.bind(this);
    this._onKey = this._onKeyDown.bind(this);
  }

  Tour.prototype.start = function () {
    injectStyle();
    this.dim = document.createElement('div');
    this.dim.className = 'onb-dim';
    this.spot = document.createElement('div');
    this.spot.className = 'onb-spot';
    this.card = document.createElement('div');
    this.card.className = 'onb-card';
    document.body.appendChild(this.dim);
    document.body.appendChild(this.spot);
    document.body.appendChild(this.card);
    document.body.style.overflow = 'hidden';
    window.addEventListener('resize', this._onResize);
    document.addEventListener('keydown', this._onKey);
    requestAnimationFrame(function (self) { return function () { self.dim.classList.add('show'); }; }(this));
    this._findFirstValidStep(0, 1);
  };

  Tour.prototype._onKeyDown = function (e) {
    if (e.key === 'Escape') this.finish();
    else if (e.key === 'ArrowRight') this.next();
    else if (e.key === 'ArrowLeft') this.prev();
  };

  // Skips over steps whose target element isn't present on the page right now (e.g. a
  // results-section button that only exists after the user has run a check once).
  Tour.prototype._findFirstValidStep = function (start, dir) {
    var idx = start;
    while (idx >= 0 && idx < this.steps.length) {
      var step = this.steps[idx];
      if (!step.target || document.querySelector(step.target)) { this.i = idx; this._render(); return; }
      idx += dir;
    }
    if (dir > 0) this.finish();
    else { this.i = 0; this._render(); }
  };

  Tour.prototype.next = function () {
    if (this.i >= this.steps.length - 1) { this.finish(); return; }
    this._findFirstValidStep(this.i + 1, 1);
  };

  Tour.prototype.prev = function () {
    if (this.i <= 0) return;
    this._findFirstValidStep(this.i - 1, -1);
  };

  Tour.prototype.finish = function () {
    var self = this;
    this.dim.classList.remove('show');
    this.spot.classList.remove('show');
    this.card.classList.remove('show');
    setTimeout(function () {
      self.dim.remove(); self.spot.remove(); self.card.remove();
    }, 200);
    document.body.style.overflow = '';
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('keydown', this._onKey);
    try { localStorage.setItem(this.config.key, '1'); } catch (e) {}
  };

  Tour.prototype._render = function () {
    var step = this.steps[this.i];
    var target = step.target ? document.querySelector(step.target) : null;

    this.card.classList.remove('show');

    var dotsHtml = this.steps.map(function (s, idx) {
      return '<span class="onb-dot' + (idx === this.i ? ' active' : '') + '"></span>';
    }, this).join('');

    this.card.innerHTML =
      '<span class="corner tl"></span><span class="corner br"></span>'
      + '<div class="onb-step-tag"><span class="onb-dots">' + dotsHtml + '</span><span>Langkah ' + (this.i + 1) + '/' + this.steps.length + '</span></div>'
      + (step.icon ? '<div class="onb-card-icon">' + step.icon + '</div>' : '')
      + '<div class="onb-card-title">' + step.title + '</div>'
      + '<div class="onb-card-desc">' + step.desc + '</div>'
      + '<div class="onb-card-nav">'
      + '<button type="button" class="onb-skip" data-onb-skip>Lewati tur</button>'
      + '<div class="onb-nav-btns">'
      + '<button type="button" class="onb-prev" data-onb-prev' + (this.i === 0 ? ' disabled' : '') + '>← Kembali</button>'
      + '<button type="button" class="onb-next" data-onb-next>' + (this.i === this.steps.length - 1 ? 'Selesai ✓' : 'Lanjut →') + '</button>'
      + '</div></div>';

    var self = this;
    this.card.querySelector('[data-onb-skip]').addEventListener('click', function () { self.finish(); });
    this.card.querySelector('[data-onb-next]').addEventListener('click', function () { self.next(); });
    this.card.querySelector('[data-onb-prev]').addEventListener('click', function () { self.prev(); });

    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.card.classList.remove('centered');
      setTimeout(function () { self._positionAround(target); }, 220);
    } else {
      this.card.classList.add('centered');
      this.spot.classList.remove('show');
    }
    requestAnimationFrame(function () { self.card.classList.add('show'); });
  };

  Tour.prototype._positionAround = function (target) {
    var r = target.getBoundingClientRect();
    var pad = 8;
    this.spot.style.top = (r.top - pad) + 'px';
    this.spot.style.left = (r.left - pad) + 'px';
    this.spot.style.width = (r.width + pad * 2) + 'px';
    this.spot.style.height = (r.height + pad * 2) + 'px';
    this.spot.classList.add('show');

    var cardW = this.card.offsetWidth || 300;
    var cardH = this.card.offsetHeight || 160;
    var gap = 16;
    var vw = window.innerWidth, vh = window.innerHeight;

    var top, left;
    var spaceBelow = vh - r.bottom, spaceAbove = r.top, spaceRight = vw - r.right;
    if (spaceBelow >= cardH + gap) { top = r.bottom + gap; left = r.left; }
    else if (spaceAbove >= cardH + gap) { top = r.top - cardH - gap; left = r.left; }
    else if (spaceRight >= cardW + gap) { top = r.top; left = r.right + gap; }
    else { top = r.top; left = Math.max(gap, r.left - cardW - gap); }

    left = Math.min(Math.max(gap, left), vw - cardW - gap);
    top = Math.min(Math.max(gap, top), vh - cardH - gap);

    this.card.style.top = top + 'px';
    this.card.style.left = left + 'px';
  };

  Tour.prototype._reposition = function () {
    var step = this.steps[this.i];
    if (!step.target) return;
    var target = document.querySelector(step.target);
    if (target) this._positionAround(target);
  };

  // config: { key, helpBtnId, steps: [{ target?, icon?, title, desc }] }
  // A step with no `target` renders as a centered welcome-style card (no spotlight) — use this
  // for the first "welcome" step. Every other step's `target` is a CSS selector for the real
  // element to highlight; steps whose target isn't currently in the DOM are skipped automatically.
  window.initOnboarding = function (config) {
    if (config.helpBtnId) {
      var btn = document.getElementById(config.helpBtnId);
      if (btn) btn.addEventListener('click', function () { new Tour(config).start(); });
    }
    var alreadySeen = false;
    try { alreadySeen = localStorage.getItem(config.key) === '1'; } catch (e) {}
    if (!alreadySeen) {
      setTimeout(function () { new Tour(config).start(); }, 350);
    }
  };
})();
