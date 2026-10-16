/* HERO — agent hero. Navbar (masquage au défilement, menu mobile, lien actif),
   compteur « Ton CA », anneau 3D des appels visio (glisser + pause hors écran).
   Tout le contenu reste visible si ce script échoue : les animations
   d'apparition et la rotation de l'anneau sont en CSS. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Navbar ---------- */
  var nav = document.getElementById('hero-nav');
  if (nav) {
    var lastY = window.scrollY, ticking = false;
    var onScroll = function () {
      var y = window.scrollY;
      nav.classList.toggle('is-scrolled', y > 20);
      if (!nav.classList.contains('is-open')) {
        // comme agencee : la barre disparaît en descendant, revient en remontant
        if (y > 160 && y > lastY + 4) nav.classList.add('is-hidden');
        else if (y < lastY - 4 || y <= 160) nav.classList.remove('is-hidden');
      }
      lastY = y; ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    onScroll();

    var burger = nav.querySelector('.hero-burger');
    var menu = document.getElementById('hero-menu');
    var setOpen = function (open) {
      nav.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
      if (open) menu.hidden = false;
      else setTimeout(function () { if (!nav.classList.contains('is-open')) menu.hidden = true; }, 300);
    };
    if (burger && menu) {
      burger.addEventListener('click', function () { setOpen(!nav.classList.contains('is-open')); });
      menu.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    }

    // lien actif selon la section visible
    var links = nav.querySelectorAll('[data-spy]');
    if ('IntersectionObserver' in window && links.length) {
      var map = {};
      links.forEach(function (a) { var s = document.getElementById(a.dataset.spy); if (s) map[a.dataset.spy] = { a: a, s: s }; });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var item = map[en.target.id]; if (!item) return;
          if (en.isIntersecting) {
            links.forEach(function (l) { l.classList.remove('is-active'); });
            item.a.classList.add('is-active');
          } else if (item.a.classList.contains('is-active') && en.boundingClientRect.top > 0) {
            item.a.classList.remove('is-active');
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      Object.keys(map).forEach(function (k) { io.observe(map[k].s); });
    }
  }

  /* ---------- Compteur « Ton CA » (illustration en boucle, calée sur la courbe CSS de 4 s) ---------- */
  var counter = document.querySelector('[data-hero-counter]');
  var line = document.querySelector('.hero-ca-line');
  if (counter && line && !reduce) {
    var fmt = function (n) { return '+' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'; };
    var t0 = performance.now(), CYCLE = 4000, TOP = 24000;
    var restart = function () { t0 = performance.now(); };
    line.addEventListener('animationstart', restart);
    line.addEventListener('animationiteration', restart);
    var ease = function (p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
    var last = -1;
    var tick = function (now) {
      var p = Math.min(((now - t0) % CYCLE) / (CYCLE * 0.62), 1);
      var v = Math.round(ease(p) * TOP / 10) * 10;
      if (v !== last) { counter.textContent = fmt(v); last = v; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } else if (counter) {
    counter.textContent = '↗';
  }

  /* ---------- Anneau 3D : glisser pour tourner (0,2°/px, comme Ring3D.tsx) + pause hors écran ---------- */
  var ring = document.querySelector('.hero-ring');
  if (ring) {
    var drag = ring.querySelector('.hero-ring-drag');
    var base = 0, startX = 0, active = false, pid = null;
    ring.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      active = true; pid = e.pointerId; startX = e.clientX;
      ring.classList.add('is-dragging');
    });
    window.addEventListener('pointermove', function (e) {
      if (!active || e.pointerId !== pid) return;
      drag.style.setProperty('--hero-drag', (base + (e.clientX - startX) * 0.2) + 'deg');
    });
    var end = function (e) {
      if (!active || (e && e.pointerId !== pid)) return;
      active = false; ring.classList.remove('is-dragging');
      base = parseFloat(drag.style.getPropertyValue('--hero-drag')) || 0;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    ring.addEventListener('dragstart', function (e) { e.preventDefault(); });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        ring.classList.toggle('is-paused', !en[0].isIntersecting);
      }, { threshold: 0 }).observe(ring);
    }
  }
})();
