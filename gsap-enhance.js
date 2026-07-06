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
  initDraggableMarquee();
  initBpKpiCounters();
  initBpChartGrow();
  initToolCardStagger();
  initProcessDragDot();
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

/* ---- Bandeau de confiance : la piste devient draggable, l'auto-scroll CSS est mis en pause pendant le drag puis reprend ---- */
function initDraggableMarquee() {
  const track = document.getElementById('trustTrack');
  const wrap = document.querySelector('.trust-strip');
  if (!track || !wrap || typeof Draggable === 'undefined') return;

  Draggable.create(track, {
    type: 'x',
    inertia: true,
    bounds: wrap,
    cursor: 'grab',
    activeCursor: 'grabbing',
    onPress() {
      track.style.animationPlayState = 'paused';
    },
    onDragEnd() {
      const resume = () => {
        gsap.set(track, { clearProps: 'transform' });
        track.style.animationPlayState = 'running';
      };
      if (this.tween) {
        this.tween.eventCallback('onComplete', resume);
      } else {
        resume();
      }
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

/* ---- Process : point draggable le long de la vague, se cale sur l'étape la plus proche au relâchement ---- */
function initProcessDragDot() {
  const track = document.getElementById('processTimeline');
  const dot = document.getElementById('processDragDot');
  if (!track || !dot || typeof Draggable === 'undefined') return;
  if (window.innerWidth <= 900) return; // vague masquée sur mobile, pas de drag là

  const steps = Array.from(track.querySelectorAll('.process-step-new'));
  const badges = steps.map((s) => s.querySelector('.process-badge'));
  if (badges.length < 2) return;

  const trackLeft = track.getBoundingClientRect().left;
  const xs = badges.map((b) => {
    const r = b.getBoundingClientRect();
    return r.left + r.width / 2 - trackLeft;
  });
  const relXs = xs.map((x) => x - xs[0]);

  // "left" fixe = origine ; tout mouvement (drag ou clic) passe ensuite par x (transform)
  dot.style.left = xs[0] + 'px';

  window.moveProcessDragDot = (index) => {
    gsap.to(dot, { x: relXs[index], duration: 0.35, ease: 'power2.out' });
  };

  Draggable.create(dot, {
    type: 'x',
    bounds: { minX: 0, maxX: relXs[relXs.length - 1] },
    liveSnap: { x: relXs },
    onDragEnd() {
      let idx = 0;
      let minDist = Infinity;
      relXs.forEach((rx, i) => {
        const d = Math.abs(rx - this.x);
        if (d < minDist) { minDist = d; idx = i; }
      });
      setProcessStep(idx + 1, steps[idx]);
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
