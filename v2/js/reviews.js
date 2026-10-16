/* Avis clients (#reviews) — révélations, carrousel, tickers. Contenu visible si ce script échoue. */
(function () {
  var root = document.getElementById('reviews');
  if (!root) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1) Découpe des citations en mots (sans casser les <span class="todo">)
  function splitWords(el) {
    var i = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var parts = n.textContent.split(/(\s+)/);
          var frag = document.createDocumentFragment();
          parts.forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); return; }
            var s = document.createElement('span');
            s.className = 'rev-w'; s.style.setProperty('--i', i++); s.textContent = p;
            frag.appendChild(s);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1) walk(n);
      });
    })(el);
  }
  root.querySelectorAll('[data-rev-words]').forEach(splitWords);

  // 2) Tickers : on duplique le contenu pour une boucle sans couture
  function cloneTrack(track, pxPerSec) {
    var kids = Array.prototype.slice.call(track.children);
    kids.forEach(function (k) {
      var c = k.cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      track.appendChild(c);
    });
    requestAnimationFrame(function () {
      var w = track.scrollWidth / 2;
      track.style.setProperty('--rev-dur', Math.max(8, w / pxPerSec) + 's');
    });
  }
  if (!reduce) {
    root.querySelectorAll('.rev-ticker-track').forEach(function (t) { cloneTrack(t, 30); });
    root.querySelectorAll('.rev-row-track').forEach(function (t) {
      // assez de cartes pour couvrir les grands écrans
      var kids = Array.prototype.slice.call(t.children);
      kids.forEach(function (k) { var c = k.cloneNode(true); c.setAttribute('aria-hidden', 'true'); t.appendChild(c); });
      cloneTrack(t, 32);
    });
  }

  root.classList.add('rev-js');

  // 3) Révélations au scroll
  var ups = root.querySelectorAll('.rev-up');
  var feature = root.querySelector('[data-rev-carousel]');
  var slides = feature ? Array.prototype.slice.call(feature.querySelectorAll('[data-rev-slide]')) : [];
  var current = 0, autoTimer = null, inView = false;

  function showAll() {
    ups.forEach(function (u) { u.classList.add('is-in'); });
    if (slides[current]) slides[current].classList.add('is-shown');
  }
  if (!('IntersectionObserver' in window) || reduce) { showAll(); }
  else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        if (e.target === feature && slides[current]) {
          setTimeout(function () { slides[current].classList.add('is-shown'); }, 200);
        }
        io.unobserve(e.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    ups.forEach(function (u) { io.observe(u); });
    // filet de sécurité : rien ne doit rester caché
    setTimeout(showAll, 6000);
  }

  // 4) Carrousel
  function go(n) {
    if (!slides.length) return;
    var prev = slides[current];
    current = (n + slides.length) % slides.length;
    var next = slides[current];
    if (prev === next) return;
    prev.classList.remove('is-active', 'is-shown');
    prev.setAttribute('aria-hidden', 'true');
    next.removeAttribute('aria-hidden');
    next.classList.add('is-active');
    // relance l'animation d'entrée
    void next.offsetWidth;
    requestAnimationFrame(function () { next.classList.add('is-shown'); });
  }
  if (feature) {
    var p = feature.querySelector('[data-rev-prev]');
    var nx = feature.querySelector('[data-rev-next]');
    p && p.addEventListener('click', function () { go(current - 1); restart(); });
    nx && nx.addEventListener('click', function () { go(current + 1); restart(); });
    // swipe mobile
    var x0 = null;
    feature.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    feature.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) { go(current + (dx < 0 ? 1 : -1)); restart(); }
    });
    function restart() {
      clearInterval(autoTimer);
      if (!reduce && inView) autoTimer = setInterval(function () { go(current + 1); }, 7000);
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        inView = es[0].isIntersecting; restart();
      }, { threshold: 0.4 }).observe(feature);
    }
    feature.addEventListener('mouseenter', function () { clearInterval(autoTimer); });
    feature.addEventListener('mouseleave', restart);
  }
})();
