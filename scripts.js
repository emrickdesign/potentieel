/* =============================================
   POTENTIEEL — Scripts partagés
   ============================================= */

document.addEventListener('DOMContentLoaded', () => {
  initSparkles();
  initTicker();
  initTiltCards();
  initScrollAnimations();
  initCounters();
});

/* ---- Sparkles ---- */
function initSparkles() {
  const wrap = document.getElementById('sparkles');
  if (!wrap) return;
  const positions = [
    [8,18],[15,45],[22,72],[30,28],[40,60],[48,15],[55,82],[62,38],
    [70,65],[78,22],[85,50],[92,35],[18,88],[35,12],[50,55],[65,90],
    [75,10],[25,65],[45,35],[88,75]
  ];
  positions.forEach(([l, t], i) => {
    const s = document.createElement('div');
    s.className = 'sparkle';
    const delay = (i * 0.28) % 3;
    const dur = 2 + (i % 3) * 0.8;
    s.style.cssText = `left:${l}%;top:${t}%;animation-delay:${delay}s;animation-duration:${dur}s;`;
    if (i % 5 === 1) { s.style.background = '#c8f542'; s.style.width = '3px'; s.style.height = '3px'; }
    if (i % 7 === 0) { s.style.background = 'rgba(255,255,255,0.45)'; s.style.width = '2px'; s.style.height = '2px'; }
    wrap.appendChild(s);
  });
}

/* ---- Ticker ---- */
function initTicker() {
  const track = document.getElementById('ticker');
  if (!track) return;
  const items = [
    'Garagistes', 'Mandataires Immo', 'Kinésithérapeutes', 'Vétérinaires',
    'Artisans', 'Professions Libérales', 'Boulangers', 'Coiffeurs',
    'Électriciens', 'Plombiers', 'Architectes', 'Photographes'
  ];
  // Triple loop for seamless infinite scroll
  [0, 1, 2].forEach(() => {
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'ticker-item';
      el.innerHTML = `<span class="dot"></span>${item}`;
      track.appendChild(el);
    });
  });
}

/* ---- 3D Tilt + Cursor Glow on Cards ---- */
function initTiltCards() {
  document.querySelectorAll('.tilt-card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const rect  = card.getBoundingClientRect();
      const x     = e.clientX - rect.left;
      const y     = e.clientY - rect.top;
      const cx    = rect.width  / 2;
      const cy    = rect.height / 2;
      const rotX  = ((y - cy) / cy) * -7;
      const rotY  = ((x - cx) / cx) *  7;

      card.style.transform = `perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateZ(6px)`;
      card.style.setProperty('--gx', `${x}px`);
      card.style.setProperty('--gy', `${y}px`);
      card.style.setProperty('--go', '1');
      card.style.transition = 'transform 0.08s ease, box-shadow 0.2s ease';
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.style.setProperty('--go', '0');
      card.style.transition = 'transform 0.4s ease, box-shadow 0.3s ease';
    });
  });
}

/* ---- Scroll Animations ---- */
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.scroll-anim').forEach(el => observer.observe(el));
}

/* ---- Counter Animation ---- */
function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el      = entry.target;
      const target  = parseInt(el.dataset.count);
      const suffix  = el.dataset.suffix || '';
      const prefix  = el.dataset.prefix || '';
      let current   = 0;
      const step    = Math.max(1, Math.ceil(target / 50));
      const timer   = setInterval(() => {
        current = Math.min(current + step, target);
        el.textContent = prefix + current + suffix;
        if (current >= target) clearInterval(timer);
      }, 35);
      observer.unobserve(el);
    });
  }, { threshold: 0.5 });

  counters.forEach(el => observer.observe(el));
}

/* ---- WA Carousel (index page) ---- */
function initWaCarousel() {
  const track = document.getElementById('waTrack');
  const prev  = document.getElementById('waPrev');
  const next  = document.getElementById('waNext');
  const dots  = document.getElementById('waDots');
  if (!track || !prev || !next) return;

  const cards = Array.from(track.querySelectorAll('.wa-screenshot-card'));
  const total = cards.length;
  let idx     = 0;
  let autoTimer;

  // Build dots
  if (dots) {
    cards.forEach((_, i) => {
      const d = document.createElement('button');
      d.className = 'wa-dot' + (i === 0 ? ' active' : '');
      d.addEventListener('click', () => goTo(i));
      dots.appendChild(d);
    });
  }

  function cardWidth() {
    return cards[0].offsetWidth + parseInt(getComputedStyle(track).gap || 24);
  }

  function goTo(n) {
    idx = ((n % total) + total) % total;
    track.style.transform = `translateX(-${idx * cardWidth()}px)`;
    if (dots) {
      dots.querySelectorAll('.wa-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
    }
  }

  function startAuto() { autoTimer = setInterval(() => goTo(idx + 1), 5000); }
  function stopAuto()  { clearInterval(autoTimer); }

  prev.addEventListener('click', () => { stopAuto(); goTo(idx - 1); startAuto(); });
  next.addEventListener('click', () => { stopAuto(); goTo(idx + 1); startAuto(); });

  // Touch swipe
  let touchX = 0;
  track.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend',   e => {
    const diff = touchX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) goTo(diff > 0 ? idx + 1 : idx - 1);
  });

  startAuto();
}

document.addEventListener('DOMContentLoaded', initWaCarousel);
