/* SERVICES — révélations au scroll, compteurs, séquence d'allumage des 3 zones Google */
(function(){
  var root = document.getElementById('services');
  if (!root || !('IntersectionObserver' in window)) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return; // tout reste visible, zone de chaque carte allumée par le CSS

  root.classList.add('svc-js');

  /* 1. Révélations (en-tête en cascade, puis la pile comme le bloc bloomix) */
  var reveals = root.querySelectorAll('[data-svc-reveal]');
  reveals.forEach(function(el, i){ if (!el.classList.contains('svc-stack')) el.style.setProperty('--svc-d', (i * 0.08) + 's'); });
  var ioReveal = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting){ e.target.classList.add('is-in'); ioReveal.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
  reveals.forEach(function(el){ ioReveal.observe(el); });
  // filet de sécurité : jamais de contenu invisible
  setTimeout(function(){ reveals.forEach(function(el){ el.classList.add('is-in'); }); }, 4000);

  /* 2. Compteurs */
  function countUp(el){
    var to = parseInt(el.getAttribute('data-svc-count'), 10) || 0;
    if (to === 0){ el.textContent = '0'; return; }
    var from = 0;
    var t0 = null, dur = 1400;
    function step(t){
      if (!t0) t0 = t;
      var p = Math.min((t - t0) / dur, 1), k = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * k);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var ioCount = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting){ countUp(e.target); ioCount.unobserve(e.target); }
    });
  }, { threshold: 0.6 });
  root.querySelectorAll('[data-svc-count]').forEach(function(el){ ioCount.observe(el); });

  /* 3. Page Google : les 3 zones s'allument une à une, puis celle du service reste allumée */
  function play(serp){
    var active = serp.getAttribute('data-active');
    var zones = serp.querySelectorAll('.svc-zone');
    serp.classList.add('svc-seq');
    zones.forEach(function(z){ z.classList.remove('is-lit', 'is-you'); });
    var i = 0;
    (function next(){
      zones.forEach(function(z){ z.classList.remove('is-lit'); });
      if (i < zones.length){
        zones[i].classList.add('is-lit');
        i++;
        setTimeout(next, 380);
      } else {
        var z = serp.querySelector('.svc-zone[data-z="' + active + '"]');
        if (z){ z.classList.add('is-lit'); setTimeout(function(){ z.classList.add('is-you'); }, 200); }
      }
    })();
  }
  var ioSerp = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting){ play(e.target); ioSerp.unobserve(e.target); }
    });
  }, { threshold: 0.5 });
  root.querySelectorAll('.svc-serp').forEach(function(s){ ioSerp.observe(s); });

  // rejouer la séquence au survol de la carte (desktop)
  root.querySelectorAll('.svc-card').forEach(function(card){
    var serp = card.querySelector('.svc-serp'), busy = false;
    card.addEventListener('mouseenter', function(){
      if (busy || !serp) return; busy = true; play(serp);
      setTimeout(function(){ busy = false; }, 1600);
    });
  });
})();

/* Pile sticky : une carte plus haute que l'écran ne doit être recouverte
   qu'une fois lue en entier. On cale son « top » sticky pour que son bas
   reste visible (top négatif autorisé), sinon on garde le décalage bloomix. */
(function(){
  var items = document.querySelectorAll('#services .svc-item');
  if (!items.length) return;
  var base = [110,150,170];
  function fit(){
    items.forEach(function(it,i){
      if (getComputedStyle(it).position !== 'sticky') { it.style.top=''; return; }
      var h = it.offsetHeight, room = window.innerHeight - 24;
      it.style.top = (h + base[i] > room ? Math.min(base[i], room - h) : base[i]) + 'px';
    });
  }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('load', fit);
})();
