/* =========================================================================
   LA GALERIE COURBE DERRIÈRE « ON PARLE DE VOTRE PROJET ? »

   Des captures de nos visios défilent lentement sur un arc, en fond du
   bloc. La géométrie est celle du composant d'origine : pour un écart
   horizontal x depuis le centre, la carte descend de
   R − √(R² − x²) et pivote de asin(x / R), avec R = (H² + B²) / 2B.
   Seule la mise en œuvre change — des transformations CSS plutôt que du
   WebGL : c'est un décor flouté derrière du texte, il n'a pas besoin d'un
   contexte 3D ni d'une bibliothèque de 60 Ko.

   Deux écarts volontaires avec l'original :
   — pas d'écoute de la molette. L'original détourne le défilement de la
     page vers la galerie ; derrière un appel à l'action, ça empêcherait
     de lire la suite.
   — pas de capture du pointeur. C'est un fond, il laisse passer les clics.
   ========================================================================= */

(function () {
  'use strict';

  var scenes = document.querySelectorAll('[data-visio]');
  if (!scenes.length) return;

  var douce = window.matchMedia('(prefers-reduced-motion: reduce)');

  scenes.forEach(function (scene) {
    var n = parseInt(scene.getAttribute('data-visio-nb'), 10) || 14;
    var base = scene.getAttribute('data-visio-src') || 'assets/visio/';
    var vitesse = parseFloat(scene.getAttribute('data-visio-vitesse')) || 46;

    /* ---- les cartes --------------------------------------------------- */
    var cartes = [];
    var piste = document.createElement('div');
    piste.className = 'visio-piste';

    // on double la série pour que le tour soit toujours plein
    for (var i = 0; i < n * 2; i++) {
      var carte = document.createElement('div');
      carte.className = 'visio-carte';
      var img = document.createElement('img');
      img.src = base + ('0' + ((i % n) + 1)).slice(-2) + '.webp';
      img.alt = '';
      img.width = 720; img.height = 405;
      img.loading = i < 6 ? 'eager' : 'lazy';
      img.decoding = 'async';
      carte.appendChild(img);
      piste.appendChild(carte);
      cartes.push(carte);
    }
    scene.appendChild(piste);

    /* ---- géométrie ------------------------------------------------------ */
    var L = 0, haut = 0, pas = 0, total = 0, R = 0, demi = 0, axe = 0;

    function mesurer() {
      L = scene.clientWidth;
      haut = scene.clientHeight;
      // sur téléphone les cartes sont plus grandes : plus petites, l'arc les
      // emportait sur les côtés et il ne restait qu'un liseré à l'écran
      var largeurCarte = L < 700 ? 264 : L < 1100 ? 240 : 290;
      var ecart = L < 700 ? 14 : 24;
      pas = largeurCarte + ecart;
      total = pas * cartes.length;
      demi = L / 2;
      // Sur grand écran la bande passe derrière le texte, au milieu. Sur un
      // téléphone il n'y a pas la place : elle descend sous le bouton, là où
      // le voile peut rester léger et où les captures se voient vraiment.
      axe = L < 700 ? haut * 0.82 : haut / 2;
      // La flèche de l'arc. Un dixième de la largeur sur grand écran : la
      // courbure se voit sans que les bords sortent du cadre. Sur un
      // téléphone, la même proportion emportait les cartes hors de l'écran
      // — la courbe s'y fait plus douce.
      var B = Math.max(24, L * (L < 700 ? 0.045 : 0.1));
      R = (demi * demi + B * B) / (2 * B);
      cartes.forEach(function (c) {
        c.style.width = largeurCarte + 'px';
        c.style.height = Math.round(largeurCarte * 9 / 16) + 'px';
      });
      placer();
    }

    /* ---- la boucle ------------------------------------------------------ */
    var decalage = 0, dernier = 0, actif = false;

    function placer() {
      for (var i = 0; i < cartes.length; i++) {
        // position ramenée dans [-pas, total - pas[ puis centrée
        var x = (i * pas - decalage) % total;
        if (x < 0) x += total;
        x -= demi + pas / 2;
        if (x > total - demi - pas / 2) x -= total;

        var ax = Math.min(Math.abs(x), demi);
        var creux = R - Math.sqrt(R * R - ax * ax);
        var angle = -Math.sign(x) * Math.asin(ax / R);

        cartes[i].style.transform =
          'translate3d(' + (demi + x) + 'px,' + (axe - creux) + 'px,0)' +
          ' translate(-50%,-50%) rotate(' + (angle * 180 / Math.PI).toFixed(2) + 'deg)';
      }
    }

    function tour(t) {
      if (!actif) return;
      if (dernier) decalage += (t - dernier) / 1000 * vitesse;
      dernier = t;
      if (decalage > total) decalage -= total;
      placer();
      requestAnimationFrame(tour);
    }

    function demarrer() {
      if (actif || douce.matches) return;
      actif = true; dernier = 0;
      requestAnimationFrame(tour);
    }
    function arreter() { actif = false; }

    /* ---- on ne fait tourner que ce qui est à l'écran -------------------- */
    mesurer();
    scene.classList.add('visio-prete');

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (e) {
        e[0].isIntersecting ? demarrer() : arreter();
      }, { rootMargin: '120px' }).observe(scene);
    } else {
      demarrer();
    }

    var minuteur;
    window.addEventListener('resize', function () {
      clearTimeout(minuteur);
      minuteur = setTimeout(mesurer, 160);
    });
    if (douce.addEventListener) {
      douce.addEventListener('change', function () {
        douce.matches ? arreter() : demarrer();
      });
    }
  });
})();
