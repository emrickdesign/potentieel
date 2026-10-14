/* =========================================================================
   POTENTIEEL — le nom en trame de points, au pied des pages

   Le nom est composé en très grand, coupé par le bord bas, et imprimé en
   trame : chaque point est dimensionné par la part de lettre qui couvre sa
   case, si bien que le mot garde ses arêtes à n'importe quelle échelle. Au
   passage du pointeur les points s'écartent sur ressort et se réchauffent
   vers le laiton ; au clic, une onde traverse le mot.

   Porté en JS natif depuis l'idée « halftone wordmark footer » de 21st.dev :
   le site n'embarque pas React pour un pied de page.

   Les couleurs ne sont pas écrites ici : elles sont lues sur le pied de page
   lui-même, donc la trame suit le fond de chaque page sans réglage.
   ========================================================================= */
(function () {
  'use strict';

  var pied = document.querySelector('footer.foot, footer.footer');
  if (!pied || !pied.getContext && !document.createElement('canvas').getContext) return;

  var MOT = 'POTENTIEEL';
  var RAYON = 90;     // portée du pointeur
  var COUPE = 0.22;   // part de la hauteur de capitale qui passe sous le bord

  /* Le pas de trame suit la largeur : sur un téléphone, le mot est dix fois
     plus petit, et un pas de 7 px ne laisse pas assez de rangées pour que
     les lettres se lisent. */
  function pasDeTrame(largeur) { return largeur < 700 ? 4 : largeur < 1100 ? 5.5 : 7; }

  /* ---- les fonctions pures ------------------------------------------- */

  function hex(v) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((v || '').trim());
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/(.)/g, '$1$1') : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbDe(couleur) {
    var m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(couleur);
    if (m) return [+m[1], +m[2], +m[3]];
    return hex(couleur);
  }
  /* rayon du point pour une couverture de case : en racine, pour que la
     densité d'encre reste juste quelle que soit la couverture. */
  function rayonPoint(couverture, pas) {
    var c = couverture < 0 ? 0 : couverture > 1 ? 1 : couverture;
    return Math.sqrt(c) * pas * 0.56;
  }
  /* un pas du ressort qui ramène le point chez lui, plus la poussée du
     pointeur. Loin du pointeur, un point déplacé rentre toujours. */
  function pas(x, y, vx, vy, hx, hy, pxy0, pxy1, r) {
    var dx = x - pxy0, dy = y - pxy1, d2 = dx * dx + dy * dy;
    if (r > 0 && d2 < r * r) {
      var d = Math.sqrt(d2) + 0.001;
      var f = (1 - d / r) * 2.6;
      vx += (dx / d) * f;
      vy += (dy / d) * f;
    }
    vx = (vx + (hx - x) * 0.05) * 0.84;
    vy = (vy + (hy - y) * 0.05) * 0.84;
    return [x + vx, y + vy, vx, vy];
  }
  function chaleur(x, y, hx, hy, portee) {
    var d = Math.sqrt((x - hx) * (x - hx) + (y - hy) * (y - hy));
    return portee > 0 ? Math.min(1, d / portee) : 0;
  }
  function tailleQuiRemplit(mesure, largeur) {
    return mesure > 0 ? (largeur / mesure) * 100 : 0;
  }

  /* ---- la toile -------------------------------------------------------- */

  var toile = document.createElement('canvas');
  toile.className = 'pied-trame';
  toile.setAttribute('aria-hidden', 'true');
  pied.insertBefore(toile, pied.firstChild);
  pied.classList.add('a-trame');

  var ctx = toile.getContext('2d');
  if (!ctx) { toile.remove(); return; }

  var reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var styles = getComputedStyle(pied);
  var FOND = styles.backgroundColor;
  var ENCRE = rgbDe(styles.getPropertyValue('--gray-light') || '') ||
              rgbDe(styles.getPropertyValue('--dim') || '') || [159, 179, 190];
  var LAITON = rgbDe(styles.getPropertyValue('--orange') || '') ||
               rgbDe(styles.getPropertyValue('--brass') || '') || [210, 165, 76];
  var ENCRE_CSS = 'rgb(' + ENCRE.join(',') + ')';

  var l = 0, h = 0, dpr = 1;
  var px = -1e5, py = -1e5;
  var raf = 0, visible = true, eveille = true;
  var onde = { x: 0, y: 0, t: -1 };
  var points = new Float32Array(0), nb = 0;
  var grain = null;

  function disposer() {
    var r = pied.getBoundingClientRect();
    l = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    toile.width = Math.round(l * dpr);
    toile.height = Math.round(h * dpr);

    // le mot est composé une fois sur un masque, à la taille qui remplit
    var masque = document.createElement('canvas');
    masque.width = l; masque.height = h;
    var m = masque.getContext('2d', { willReadFrequently: true });
    if (!m) return;
    var face = "800 100px 'Libre Franklin', system-ui, sans-serif";
    m.font = face;
    var taille = tailleQuiRemplit(m.measureText(MOT).width, l * 0.98);
    m.font = '800 ' + taille + "px 'Libre Franklin', system-ui, sans-serif";
    var boite = m.measureText(MOT);
    var capitale = boite.actualBoundingBoxAscent || taille * 0.72;
    m.fillStyle = '#000';
    m.textBaseline = 'alphabetic';
    m.fillText(MOT, (l - boite.width) / 2, h + capitale * COUPE);
    var img = m.getImageData(0, 0, l, h).data;

    var g = Math.max(3, pasDeTrame(l));
    var cols = Math.ceil(l / g), rangs = Math.ceil(h / g);
    var tmp = [];
    for (var gy = 0; gy < rangs; gy++) {
      for (var gx = 0; gx < cols; gx++) {
        var somme = 0;
        for (var sy = 0; sy < 3; sy++) {
          for (var sx = 0; sx < 3; sx++) {
            var x = Math.min(l - 1, Math.floor(gx * g + ((sx + 0.5) * g) / 3));
            var y = Math.min(h - 1, Math.floor(gy * g + ((sy + 0.5) * g) / 3));
            somme += img[(y * l + x) * 4 + 3];
          }
        }
        var couv = somme / (9 * 255);
        if (couv < 0.06) continue;
        var hx = gx * g + g / 2, hy = gy * g + g / 2;
        tmp.push(hx, hy, 0, 0, hx, hy, rayonPoint(couv, g));
      }
    }
    points = new Float32Array(tmp);
    nb = tmp.length / 7;

    // une tuile de grain d'impression, tirée une fois
    grain = document.createElement('canvas');
    grain.width = grain.height = 256;
    var gg = grain.getContext('2d');
    if (gg) {
      var id = gg.createImageData(256, 256);
      for (var i = 0; i < id.data.length; i += 4) {
        var v = Math.random() * 255;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
        id.data[i + 3] = Math.random() < 0.5 ? 0 : 255;
      }
      gg.putImageData(id, 0, 0);
    }
    eveille = true;
  }

  function dessiner(maintenant) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, l, h);

    var r = reduit ? 0 : RAYON;
    var age = onde.t < 0 ? 1e9 : maintenant - onde.t;
    var rayonOnde = age * 0.9;
    var bouge = false;

    for (var i = 0; i < nb; i++) {
      var j = i * 7;
      var x = points[j], y = points[j + 1], vx = points[j + 2], vy = points[j + 3];
      var hx = points[j + 4], hy = points[j + 5];
      if (!reduit) {
        if (age < 900) {
          var dx = hx - onde.x, dy = hy - onde.y;
          var d = Math.sqrt(dx * dx + dy * dy) + 0.001;
          var bande = 1 - Math.min(1, Math.abs(d - rayonOnde) / 26);
          if (bande > 0) {
            var f = bande * 3.2 * (1 - age / 900);
            vx += (dx / d) * f; vy += (dy / d) * f;
          }
        }
        var s = pas(x, y, vx, vy, hx, hy, px, py, r);
        x = s[0]; y = s[1]; vx = s[2]; vy = s[3];
        if (Math.abs(vx) + Math.abs(vy) > 0.02 ||
            Math.abs(x - hx) + Math.abs(y - hy) > 0.05) bouge = true;
        else { x = hx; y = hy; vx = 0; vy = 0; }
        points[j] = x; points[j + 1] = y; points[j + 2] = vx; points[j + 3] = vy;
      }
      var k = chaleur(x, y, hx, hy, 28);
      ctx.fillStyle = k > 0.02
        ? 'rgb(' + Math.round(ENCRE[0] + (LAITON[0] - ENCRE[0]) * k) + ',' +
                   Math.round(ENCRE[1] + (LAITON[1] - ENCRE[1]) * k) + ',' +
                   Math.round(ENCRE[2] + (LAITON[2] - ENCRE[2]) * k) + ')'
        : ENCRE_CSS;
      ctx.beginPath();
      ctx.arc(x, y, points[j + 6], 0, 6.2832);
      ctx.fill();
    }

    if (grain) {
      ctx.globalAlpha = 0.045;
      ctx.globalCompositeOperation = 'overlay';
      var motif = ctx.createPattern(grain, 'repeat');
      if (motif) { ctx.fillStyle = motif; ctx.fillRect(0, 0, l, h); }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // on s'endort dès que tout est rentré et que rien ne pousse
    eveille = bouge || age < 900 || px > -1e4;
  }

  function boucle(t) {
    raf = 0;
    if (!visible) return;
    dessiner(t);
    if (eveille) raf = requestAnimationFrame(boucle);
  }
  function reveiller() {
    eveille = true;
    if (!raf && visible) raf = requestAnimationFrame(boucle);
  }

  function local(e) {
    var b = toile.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  }
  pied.addEventListener('pointermove', function (e) {
    if (reduit) return;
    var p = local(e); px = p[0]; py = p[1]; reveiller();
  });
  pied.addEventListener('pointerleave', function () {
    px = -1e5; py = -1e5; reveiller();
  });
  pied.addEventListener('pointerdown', function (e) {
    if (reduit) return;
    if (e.target.closest('a, button')) return;   // on ne vole pas un clic utile
    var p = local(e);
    onde = { x: p[0], y: p[1], t: performance.now() };
    reveiller();
  });

  disposer();
  dessiner(performance.now());
  reveiller();

  if ('ResizeObserver' in window) {
    new ResizeObserver(function () { disposer(); reveiller(); }).observe(pied);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) {
      visible = e[0] ? e[0].isIntersecting : true;
      if (visible) reveiller();
    }).observe(pied);
  }
  // une police qui arrive en retard recompose le mot dans sa vraie face
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { disposer(); reveiller(); });
  }
})();
