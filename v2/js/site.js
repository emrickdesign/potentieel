/* PAGE « SITE INTERNET » — révélations au scroll, captures Google qui s'allument
   avec leur légende, compteur, projecteur au survol des cartes.
   Le contenu reste visible si ce script échoue (html.site-js retiré par le <head>). */
(function () {
  'use strict';
  window.__siteReady = true;
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;

  /* Le footer partagé a des liens d'ancre de l'accueil (#services…) : on les renvoie vers /#… */
  document.querySelectorAll('#footer a[href^="#"]').forEach(function (a) {
    a.setAttribute('href', '/' + a.getAttribute('href'));
  });

  if (!hasIO || reduce) {
    root.classList.remove('site-js');
    document.querySelectorAll('[data-site-reveal],.site-shot,.site-serp-paid,.site-path').forEach(function (el) { el.classList.add('is-in'); });
    var leg = document.querySelector('.site-leg[data-leg="1"]'); if (leg) leg.classList.add('is-on');
    return;
  }

  /* ---------- Révélations ---------- */
  var reveal = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      reveal.unobserve(e.target);
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('[data-site-reveal],.site-shot,.site-serp-paid,.site-path').forEach(function (el) { reveal.observe(el); });
  // filet de sécurité : tout visible après 8 s quoi qu'il arrive
  setTimeout(function () {
    document.querySelectorAll('[data-site-reveal],.site-shot,.site-serp-paid,.site-path').forEach(function (el) { el.classList.add('is-in'); });
  }, 8000);

  /* ---------- Page Google : la capture au milieu de l'écran s'allume, sa légende aussi ---------- */
  var shots = document.querySelectorAll('.site-shot');
  var legs = document.querySelectorAll('.site-leg');
  var setActive = function (n) {
    shots.forEach(function (s) { s.classList.toggle('is-lit', s.getAttribute('data-shot') === n); });
    legs.forEach(function (l) { l.classList.toggle('is-on', l.getAttribute('data-leg') === n); });
  };
  if (shots.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) setActive(e.target.getAttribute('data-shot')); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    shots.forEach(function (s) { spy.observe(s); });
    setActive('1');
  }
  // survol d'une ligne de légende : allume la capture correspondante
  legs.forEach(function (l) {
    l.addEventListener('mouseenter', function () { setActive(l.getAttribute('data-leg')); });
  });

  /* ---------- Compteur ---------- */
  document.querySelectorAll('[data-site-count]').forEach(function (el) {
    var to = parseInt(el.getAttribute('data-site-count'), 10) || 0;
    var io = new IntersectionObserver(function (en) {
      if (!en[0].isIntersecting) return;
      io.disconnect();
      var t0 = null, dur = 1100;
      var tick = function (t) {
        if (!t0) t0 = t;
        var p = Math.min(1, (t - t0) / dur);
        el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      };
      el.textContent = '0';
      requestAnimationFrame(tick);
    }, { threshold: 0.6 });
    io.observe(el);
  });

  /* ---------- Projecteur qui suit la souris sur les cartes ---------- */
  if (window.matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('.site-rc,.site-feat').forEach(function (c) {
      c.addEventListener('pointermove', function (e) {
        var r = c.getBoundingClientRect();
        c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        c.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }
})();

/* Navigateur du hero : vrais sites clients qui défilent (pause au survol) */
(function(){
  var box=document.querySelector('.site-demos'); if(!box) return;
  var demos=box.querySelectorAll('.site-demo'), dots=box.querySelectorAll('.site-demo-dots i');
  var url=document.querySelector('.site-browser-url'), i=0, hold=false;
  function show(n){
    demos.forEach(function(d,k){ d.classList.toggle('is-on',k===n); d.setAttribute('tabindex',k===n?'0':'-1'); });
    dots.forEach(function(d,k){ d.classList.toggle('is-on',k===n); });
    if(url) url.textContent=demos[n].getAttribute('data-url');
  }
  show(0);
  if(demos.length<2) return;
  box.addEventListener('mouseenter',function(){hold=true;});
  box.addEventListener('mouseleave',function(){hold=false;});
  setInterval(function(){ if(hold||document.hidden) return; i=(i+1)%demos.length; show(i); },3000);
})();
