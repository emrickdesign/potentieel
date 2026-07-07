/* =============================================
   POTENTIEEL — application.html
   Couche d'amélioration GSAP + ScrollTrigger + Draggable.
   Additive uniquement : ne modifie ni ne supprime les animations
   CSS existantes (badgeFloat, mockFloat, toolBob, ticker...).
   Le scroll reste natif (pas de lissage type Lenis) : ScrollTrigger
   écoute directement le scroll natif du navigateur.
   ============================================= */

document.addEventListener('DOMContentLoaded', () => {
  if (typeof gsap === 'undefined') return;

  gsap.registerPlugin(ScrollTrigger, Draggable, InertiaPlugin, SplitText);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return; // le HTML affiche déjà l'état final (aucune animation à sauter)

  initHeroTitleSplit();
  initHeroParallax();
  initBpKpiCounters();
  initBpChartGrow();
  initToolCardStagger();
});

/* ---- H1 hero : cascade mot par mot, en plus du fondu de bloc existant (.hero-entry) ---- */
function initHeroTitleSplit() {
  const h1 = document.querySelector('.hero-modern-text h1');
  if (!h1 || typeof SplitText === 'undefined') return;

  const split = SplitText.create(h1, { type: 'words' });
  gsap.from(split.words, {
    opacity: 0,
    duration: 0.5,
    stagger: 0.045,
    delay: 0.5,
    ease: 'power2.out',
  });
}

/* ---- Parallax léger sur le visuel du hero (le conteneur lui-même n'a aucune animation propre) ---- */
function initHeroParallax() {
  const visual = document.querySelector('.hero-modern-visual');
  const hero = document.querySelector('.hero-modern');
  if (!visual || !hero) return;

  gsap.to(visual, {
    y: 46,
    ease: 'none',
    scrollTrigger: {
      trigger: hero,
      start: 'top top',
      end: 'bottom top',
      scrub: true,
    },
  });
}

/* ---- KPI BatiPilot : comptent depuis 0 au scroll (lit la valeur déjà écrite dans le HTML) ---- */
function initBpKpiCounters() {
  document.querySelectorAll('.bp-kpi b').forEach((el) => {
    const match = el.textContent.trim().match(/^(\d+)(.*)$/);
    if (!match) return;
    const target = parseInt(match[1], 10);
    const suffix = match[2] || '';
    const counter = { val: 0 };

    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      once: true,
      onEnter: () => {
        gsap.to(counter, {
          val: target,
          duration: 1.3,
          ease: 'power2.out',
          onUpdate: () => { el.textContent = Math.round(counter.val) + suffix; },
        });
      },
    });
  });
}

/* ---- Barres du mini-graphique BatiPilot : poussent depuis 0 au scroll ---- */
function initBpChartGrow() {
  const bars = document.querySelectorAll('.bp-chart span');
  if (!bars.length) return;
  const targets = Array.from(bars).map((b) => b.style.height);
  gsap.set(bars, { height: 0 });

  ScrollTrigger.create({
    trigger: '.bp-chart',
    start: 'top 85%',
    once: true,
    onEnter: () => {
      bars.forEach((bar, i) => {
        gsap.to(bar, {
          height: targets[i],
          duration: 0.9,
          delay: i * 0.06,
          ease: 'power3.out',
        });
      });
    },
  });
}

/* ---- Cartes outils : entrée en cascade par catégorie (opacity uniquement, ne touche pas au bob CSS) ---- */
function initToolCardStagger() {
  document.querySelectorAll('.tools-category').forEach((cat) => {
    const cards = cat.querySelectorAll('.tool-flip');
    if (!cards.length) return;
    gsap.set(cards, { opacity: 0 });

    ScrollTrigger.create({
      trigger: cat,
      start: 'top 88%',
      once: true,
      onEnter: () => {
        gsap.to(cards, {
          opacity: 1,
          duration: 0.45,
          stagger: 0.06,
          ease: 'power1.out',
        });
      },
    });
  });
}
