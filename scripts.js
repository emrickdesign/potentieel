/* =============================================
   POTENTIEEL — Scripts partagés
   ============================================= */

document.addEventListener('DOMContentLoaded', () => {
  initBlobBackgrounds();
  initSparkles();
  initTicker();
  initTrustMarquee();
  initTiltCards();
  initWordReveal();
  initScrollAnimations();
  initCounters();
  initMockCardFlip();
});

/* ---- Hero mock card flip — floating badges reveal content on the back ---- */
function initMockCardFlip() {
  const card = document.getElementById('heroMockCard');
  if (!card) return;
  const badges = Array.from(document.querySelectorAll('.hero-float-badge[data-scene]'));
  if (!badges.length) return;

  function activate(scene, badge) {
    const isSame = card.classList.contains('flipped') && card.dataset.activeScene === scene;
    badges.forEach(b => b.classList.remove('active-badge'));
    if (isSame) {
      card.classList.remove('flipped');
      card.dataset.activeScene = '';
      return;
    }
    card.querySelectorAll('.mock-back-scene').forEach(s => s.classList.toggle('active', s.dataset.scene === scene));
    card.classList.add('flipped');
    card.dataset.activeScene = scene;
    badge.classList.add('active-badge');
  }

  badges.forEach(badge => {
    badge.addEventListener('click', () => activate(badge.dataset.scene, badge));
    badge.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(badge.dataset.scene, badge);
      }
    });
  });
}

/* ---- Trust marquee (hero-modern) — clones chips for a seamless loop ---- */
function initTrustMarquee() {
  const track = document.getElementById('trustTrack');
  if (!track) return;
  const original = Array.from(track.children);
  original.forEach(chip => track.appendChild(chip.cloneNode(true)));
}

/* ---- Animated blob backgrounds (hero + page headers) ---- */
function initBlobBackgrounds() {
  document.querySelectorAll('.hero, .hero-modern, .page-header').forEach(section => {
    if (section.querySelector('.blob-bg')) return;
    const wrap = document.createElement('div');
    wrap.className = 'blob-bg';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = '<span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>';
    section.insertBefore(wrap, section.firstChild);
  });
}

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

  document.querySelectorAll('.scroll-anim, .reveal-words').forEach(el => observer.observe(el));
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

/* ---- Word Reveal (splits text into staggered spans, keeps inline elements) ---- */
function initWordReveal() {
  document.querySelectorAll('.reveal-words').forEach(el => {
    const nodes = Array.from(el.childNodes);
    el.innerHTML = '';
    let i = 0;
    nodes.forEach(node => {
      if (node.nodeType === 3) { // text node
        node.textContent.split(/(\s+)/).forEach(tok => {
          if (tok === '' ) return;
          if (/^\s+$/.test(tok)) { el.appendChild(document.createTextNode(tok)); return; }
          const sp = document.createElement('span');
          sp.className = 'rw';
          sp.textContent = tok;
          sp.style.transitionDelay = (i * 0.045) + 's';
          el.appendChild(sp);
          i++;
        });
      } else { // element node (e.g. <br>, <span class="serif">)
        if (node.classList) node.classList.add('rw');
        if (node.style) node.style.transitionDelay = (i * 0.045) + 's';
        el.appendChild(node);
        i++;
      }
    });
  });
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
