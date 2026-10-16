/* Tarifs (prc-) : toggle chiffre d'affaires, compteurs de prix, révélations au scroll, lueur au survol. */
(function () {
  var root = document.getElementById('pricing');
  if (!root) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fmt = function (n) { return Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' '); };

  /* ---- Toggle CA : 1 = 300 k€ – 1 M€, 2 = + de 1 M€ ---- */
  var toggle = root.querySelector('.prc-toggle');
  var opts = root.querySelectorAll('.prc-toggle-opt');
  var nums = root.querySelectorAll('.prc-num');
  var tierTxt = root.querySelectorAll('.prc-tier-txt');

  function animateNum(el, to) {
    var from = parseFloat(el.getAttribute('data-cur') || el.getAttribute('data-p1'));
    el.setAttribute('data-cur', to);
    if (reduce || from === to) { el.textContent = fmt(to); return; }
    var t0 = null, dur = 700;
    function step(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function setTier(tier) {
    if (!toggle || toggle.getAttribute('data-state') === String(tier)) return;
    toggle.setAttribute('data-state', tier);
    opts.forEach(function (o) {
      var on = o.getAttribute('data-tier') === String(tier);
      o.classList.toggle('is-active', on);
      o.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    nums.forEach(function (n) { animateNum(n, parseFloat(n.getAttribute('data-p' + tier))); });
    tierTxt.forEach(function (t) {
      var txt = t.getAttribute('data-p' + tier);
      if (reduce || !t.animate) { t.textContent = txt; return; }
      t.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 160, easing: 'ease-in' })
        .onfinish = function () {
          t.textContent = txt;
          t.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
        };
    });
  }
  opts.forEach(function (o) {
    o.addEventListener('click', function () { setTier(+o.getAttribute('data-tier')); });
    o.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var next = o.getAttribute('data-tier') === '1' ? 2 : 1;
        setTier(next);
        root.querySelector('.prc-toggle-opt[data-tier="' + next + '"]').focus();
      }
    });
  });

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
    if (el.classList.contains('prc-card')) { el.style.transitionDelay = (cardIdx++ * 0.12) + 's'; }
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target;
      el.classList.add('is-in');
      io.unobserve(el);
      // retire le délai après l'entrée pour ne pas ralentir le survol
      setTimeout(function () { el.style.transitionDelay = ''; }, 1400);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  items.forEach(function (el) { io.observe(el); });
  // filet de sécurité : tout afficher si rien n'a été déclenché
  setTimeout(function () { items.forEach(function (el) { if (el.getBoundingClientRect().top < innerHeight) el.classList.add('is-in'); }); }, 3000);
})();
