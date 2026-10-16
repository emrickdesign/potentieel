/* CTA final + footer (#footer) — révélations et téléphone animé. Contenu visible si ce script échoue. */
(function () {
  var root = document.getElementById('footer');
  if (!root) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ups = root.querySelectorAll('.ftr-up');

  if (!reduce && 'IntersectionObserver' in window) {
    root.classList.add('ftr-js');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    ups.forEach(function (u) { io.observe(u); });
    setTimeout(function () { ups.forEach(function (u) { u.classList.add('is-in'); }); }, 6000);
  }

  // Téléphone : les photos défilent (comme Siddny / Alexa / Jack chez Impacta),
  // la notif d'appel change de source : les 3 places de la page Google.
  var shots = root.querySelectorAll('.ftr-shot');
  var notif = root.querySelector('.ftr-notif');
  var src = root.querySelector('[data-ftr-src]');
  var sources = ['Google Ads', 'LSA', 'Fiche Google'];
  if (reduce || shots.length < 2 || !notif || !src) return;
  var i = 0, timer = null;
  function step() {
    shots[i].classList.remove('is-on');
    i = (i + 1) % shots.length;
    shots[i].classList.add('is-on');
    notif.classList.add('is-swap');
    setTimeout(function () {
      src.textContent = sources[i % sources.length];
      notif.classList.remove('is-swap');
    }, 450);
  }
  var visual = root.querySelector('.ftr-cta-visual');
  new IntersectionObserver(function (es) {
    clearInterval(timer);
    if (es[0].isIntersecting) timer = setInterval(step, 3200);
  }, { threshold: 0.2 }).observe(visual);
})();
