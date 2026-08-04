/* =============================================
   POTENTIEEL — premium.js
   Socle animation premium PARTAGÉ (toutes pages publiques).
   Lenis (scroll fluide) + GSAP ScrollTrigger + SplitText + micro-interactions.

   Purement ADDITIF : ne touche pas aux animations existantes
   (scroll-anim IntersectionObserver, ticker, sparkles, tilt, carrousels,
   gsap-enhance.js sur application.html).

   Respecte prefers-reduced-motion : si l'utilisateur le demande, on ne
   lance NI Lenis NI GSAP — le HTML affiche déjà l'état final, rien à jouer.
   ============================================= */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGSAP = typeof window.gsap !== 'undefined';
  var hasST = hasGSAP && typeof window.ScrollTrigger !== 'undefined';
  var hasSplit = hasGSAP && typeof window.SplitText !== 'undefined';

  /* ---------------------------------------------------------------
     1. SCROLL FLUIDE — Lenis (branché sur ScrollTrigger si présent)
     --------------------------------------------------------------- */
  var lenis = null;
  if (typeof window.Lenis !== 'undefined' && !reduce) {
    lenis = new Lenis({
      duration: 1.05,
      // ease-out-expo : décélération naturelle, jamais de rebond
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      smoothWheel: true,
      touchMultiplier: 1.5,
      autoRaf: true, // Lenis pilote sa propre boucle rAF (driver autonome)
    });

    // ScrollTrigger reste synchronisé pendant le scroll fluide.
    if (hasST) lenis.on('scroll', ScrollTrigger.update);

    // Ancres internes -> scroll fluide (offset sous la navbar fixe)
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      var id = a.getAttribute('href');
      if (!id || id.length < 2) return;
      a.addEventListener('click', function (e) {
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: -80 });
      });
    });
  }

  // Sans GSAP (ou reduced-motion), on s'arrête là : Lenis seul suffit.
  if (reduce || !hasGSAP) return;

  gsap.registerPlugin.apply(gsap, [window.ScrollTrigger, window.SplitText].filter(Boolean));

  var started = false;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    if (started) return;
    started = true;

    initHeroTitle();
    initHeroParallax();
    initSectionReveals();
    initButtonMicroInteractions();

    if (hasST) ScrollTrigger.refresh();
  }

  /* ---------------------------------------------------------------
     2. HERO — titre en cascade mot par mot (pages avec .hero-content h1)
        Additif au fondu de bloc existant (.hero-entry). N'entre pas en
        conflit avec gsap-enhance.js qui cible .hero-modern-text h1.
     --------------------------------------------------------------- */
  function initHeroTitle() {
    var h1 = document.querySelector('.hero-content h1');
    if (!h1 || !hasSplit) return;
    var split = SplitText.create(h1, { type: 'words', wordsClass: 'pm-word' });
    gsap.set(h1, { opacity: 1 }); // le fondu .hero-entry gère l'apparition du bloc
    gsap.from(split.words, {
      yPercent: 45,
      opacity: 0,
      duration: 0.7,
      ease: 'power3.out',
      stagger: 0.055,
      delay: 0.12,
    });
  }

  /* ---------------------------------------------------------------
     3. HERO — parallax doux sur la photo de fond
     --------------------------------------------------------------- */
  function initHeroParallax() {
    var img = document.querySelector('.hero-image');
    var hero = img && img.closest('.hero');
    if (!img || !hero || !hasST) return;
    gsap.to(img, {
      yPercent: 10,
      ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
    });
  }

  /* ---------------------------------------------------------------
     4. REVEALS AU SCROLL — opt-in via [data-reveal], SANS cacher le
        contenu par défaut (SEO/headless safe : gsap.from part de l'état
        final visible et anime vers lui). Groupes staggerés via
        [data-reveal-group] (chaque enfant direct entre en décalé).
     --------------------------------------------------------------- */
  function initSectionReveals() {
    if (!hasST) return;

    document.querySelectorAll('[data-reveal]').forEach(function (el) {
      gsap.from(el, {
        y: 34,
        opacity: 0,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 85%', once: true },
      });
    });

    document.querySelectorAll('[data-reveal-group]').forEach(function (group) {
      var items = group.children;
      if (!items.length) return;
      gsap.from(items, {
        y: 30,
        opacity: 0,
        duration: 0.6,
        ease: 'power2.out',
        stagger: 0.06,
        scrollTrigger: { trigger: group, start: 'top 82%', once: true },
      });
    });
  }

  /* ---------------------------------------------------------------
     5. MICRO-INTERACTIONS — boutons magnétiques + feedback au press.
        Léger, ease-out, jamais de rebond. Pointer coarse (tactile) exclu
        du magnétisme pour éviter les décalages au tap.
     --------------------------------------------------------------- */
  function initButtonMicroInteractions() {
    var fine = window.matchMedia('(pointer: fine)').matches;
    var btns = document.querySelectorAll('.btn-primary, .btn-secondary, .btn-lime');

    btns.forEach(function (btn) {
      if (fine) {
        btn.addEventListener('pointermove', function (e) {
          var r = btn.getBoundingClientRect();
          var mx = (e.clientX - r.left - r.width / 2) / r.width;
          var my = (e.clientY - r.top - r.height / 2) / r.height;
          gsap.to(btn, { x: mx * 6, y: my * 5, duration: 0.3, ease: 'power2.out' });
        });
        btn.addEventListener('pointerleave', function () {
          gsap.to(btn, { x: 0, y: 0, duration: 0.45, ease: 'power3.out' });
        });
      }
      btn.addEventListener('pointerdown', function () {
        gsap.to(btn, { scale: 0.96, duration: 0.12, ease: 'power2.out' });
      });
      var release = function () { gsap.to(btn, { scale: 1, duration: 0.28, ease: 'power3.out' }); };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointerleave', release);
    });
  }
})();
