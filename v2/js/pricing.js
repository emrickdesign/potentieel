/* Tarifs (prc-) : calculateur d'honoraires (130 € + 20 % du budget pub), révélations au scroll, lueur au survol. */
(function () {
  var root = document.getElementById('pricing');
  if (!root) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fmt = function (n) { return Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' '); };

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
    range.setAttribute('aria-valuetext', fmt(v) + ' € par mois de budget pub, soit ' + fmt(BASE + v * RATE) + ' € d\'honoraires par mois dès le mois 3');
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

  /* ---- Lueur qui suit la souris sur les cartes ---- */
  root.querySelectorAll('.prc-card').forEach(function (c) {
    c.addEventListener('pointermove', function (e) {
      var r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  /* ---- Révélations au scroll (réf. Framer : opacity 0 + translateY 40px, cartes en cascade) ---- */
  if (reduce || !('IntersectionObserver' in window)) return;
  var items = root.querySelectorAll('.prc-rv');
  root.classList.add('prc-js');
  var cardIdx = 0;
  items.forEach(function (el) {
    if (el.classList.contains('prc-card')) el.style.transitionDelay = (cardIdx++ * 0.12) + 's';
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target;
      el.classList.add('is-in');
      io.unobserve(el);
      setTimeout(function () { el.style.transitionDelay = ''; }, 1400);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  items.forEach(function (el) { io.observe(el); });
  setTimeout(function () { items.forEach(function (el) { if (el.getBoundingClientRect().top < innerHeight) el.classList.add('is-in'); }); }, 3000);
})();
