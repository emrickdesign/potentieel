/* Section Résultats : révélations au scroll + compteurs animés (0 → valeur) à l'entrée dans le viewport.
   Sans JS, les valeurs finales sont déjà dans le HTML et tout reste visible. */
(function(){
  var sec = document.getElementById('results');
  if (!sec || !('IntersectionObserver' in window)) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  sec.classList.add('res-js');

  var counters = sec.querySelectorAll('[data-res-count]');
  counters.forEach(function(el){
    var v = el.querySelector('.res-num-val');
    if (v) v.textContent = '0';
  });

  function easeOut(t){ return 1 - Math.pow(1 - t, 3); }

  function count(el){
    if (el.dataset.resDone) return;
    el.dataset.resDone = '1';
    var v = el.querySelector('.res-num-val');
    var end = parseFloat(el.getAttribute('data-res-count')) || 0;
    var dur = 2000, t0 = null;
    function step(ts){
      if (t0 === null) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      v.textContent = String(Math.round(end * easeOut(p)));
      if (p < 1) requestAnimationFrame(step);
      else v.textContent = String(end);
    }
    requestAnimationFrame(step);
  }

  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (!e.isIntersecting) return;
      var el = e.target;
      el.classList.add('is-in');
      var c = el.querySelector('[data-res-count]');
      if (c) setTimeout(function(){ count(c); }, 150);
      io.unobserve(el);
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });

  sec.querySelectorAll('[data-res-reveal], .res-divider').forEach(function(el){ io.observe(el); });

})();
