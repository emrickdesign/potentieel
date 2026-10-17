/* Tarifs (prc-) : offre unique en value stack (lignes « Offert » qui s'allument une à une, prix barré, total qui compte),
   calculateur d'honoraires dès le mois 3 (130 € + 20 % du budget Google Ads), révélations au scroll. */
(function () {
  var root = document.getElementById('pricing');
  if (!root) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fmt = function (n) { return Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' '); };

  /* ---- Calculateur ---- */
  var BASE = 130, RATE = 0.20;
  var range = root.querySelector('.prc-range');
  var bOut = root.querySelector('.prc-calc-bnum');
  var fOut = root.querySelector('.prc-calc-fnum');
  var feeBox = root.querySelector('.prc-calc-fee');
  var shown = 0, target = 0, raf = 0;

  function tick() {
    var d = target - shown;
    if (Math.abs(d) < 0.5) { shown = target; fOut.textContent = fmt(shown); raf = 0; return; }
    shown += d * 0.18;
    fOut.textContent = fmt(shown);
    raf = requestAnimationFrame(tick);
  }
  function update(animate) {
    var v = +range.value, min = +range.min, max = +range.max;
    range.style.setProperty('--p', ((v - min) / (max - min) * 100) + '%');
    range.setAttribute('aria-valuetext', fmt(v) + ' € par mois de budget Google Ads, soit ' + fmt(BASE + v * RATE) + ' € d\'honoraires par mois dès le mois 3');
    bOut.textContent = fmt(v);
    target = BASE + v * RATE;
    if (!animate || reduce) { shown = target; fOut.textContent = fmt(target); return; }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  if (range && bOut && fOut) {
    shown = BASE + (+range.value) * RATE;
    update(false);
    range.addEventListener('input', function () { update(true); });
    range.addEventListener('change', function () {
      if (reduce || !feeBox) return;
      feeBox.classList.remove('is-bump'); void feeBox.offsetWidth; feeBox.classList.add('is-bump');
    });
    var drag = function (on) { return function () { range.classList.toggle('is-drag', on); }; };
    range.addEventListener('pointerdown', drag(true));
    window.addEventListener('pointerup', drag(false));
    range.addEventListener('blur', drag(false));
  }

  /* ---- Lueur qui suit la souris sur la carte offre ---- */
  var offer = root.querySelector('.prc-offer');
  var offerIn = root.querySelector('.prc-offer-in');
  if (offer && offerIn) offer.addEventListener('pointermove', function (e) {
    var r = offerIn.getBoundingClientRect();
    offerIn.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    offerIn.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });

  if (reduce || !('IntersectionObserver' in window)) return;

  /* ---- Lignes « Offert » éteintes au départ, allumées une à une ---- */
  var gifts = root.querySelectorAll('.prc-row-gift');
  var stack = root.querySelector('.prc-stack');
  var num = root.querySelector('.prc-total-num');
  var total = root.querySelector('.prc-total');
  gifts.forEach(function (r) { r.classList.remove('is-on'); });

  function lightUp() {
    gifts.forEach(function (r, i) {
      setTimeout(function () { r.classList.add('is-on', 'is-pop'); }, 450 + i * 420);
    });
  }
  function countUp() {
    if (!num) return;
    var to = +num.getAttribute('data-to') || 700, t0 = 0, dur = 1100;
    num.textContent = '0';
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      num.textContent = fmt(to * e);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var once = function (el, fn, opts) {
    if (!el) return;
    var o = new IntersectionObserver(function (en) {
      if (!en[0].isIntersecting && en[0].boundingClientRect.top > 0) return;
      o.disconnect(); fn();
    }, opts || { rootMargin: '0px 0px -15% 0px', threshold: 0.25 });
    o.observe(el);
  };
  once(stack, lightUp);
  once(total, function () { setTimeout(countUp, 1200); }, { rootMargin: '0px 0px -10% 0px', threshold: 0.5 });

  /* ---- Révélations au scroll ---- */
  var items = root.querySelectorAll('.prc-rv');
  root.classList.add('prc-js');
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-in');
      io.unobserve(en.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  items.forEach(function (el) { io.observe(el); });
  /* filet de sécurité : rien ne reste caché */
  setTimeout(function () {
    items.forEach(function (el) { if (el.getBoundingClientRect().top < innerHeight) el.classList.add('is-in'); });
  }, 3000);
})();
