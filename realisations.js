/* =========================================================================
   POTENTIEEL — Les réalisations : dossiers en verre + aperçu des sites

   Le catalogue vit ici, en un seul endroit. Chaque site porte son nom, son
   métier et son adresse de déploiement ; l'adresse ne s'affiche jamais à
   l'écran, elle ne sert qu'à charger l'aperçu.

   L'aperçu montre la page entière du site, en capture, à sa taille de rendu
   réelle : 1240 px sur un grand écran, 390 px sur un téléphone. On la
   parcourt du haut jusqu'au pied du site, sans zoom et sans rien pouvoir
   déclencher chez le client — ni formulaire, ni appel.

   Un cadre vivant ne peut pas faire cela : la hauteur d'un cadre EST sa
   hauteur de fenêtre, donc lui donner la hauteur d'une page entière étire
   toutes les sections en 100vh du site (mesuré sur Jamier Toiture : un
   document de 10 511 px passe à 25 364 px dans un cadre de cette hauteur).
   La capture est le seul moyen d'avoir à la fois la page entière, la taille
   réelle et la lecture seule. Elle n'est chargée qu'au clic.
   ========================================================================= */
(function () {
  'use strict';

  var DOSSIERS = [
    {
      titre: 'Bâtiment et rénovation',
      sites: [
        { nom: 'Euros Carrelage', metier: 'Carreleur · Villefranche-sur-Saône', url: 'https://euros-carrelage.vercel.app', vue: 'assets/apercus/euros-carrelage.jpg', plein: { 1240: [1240, 13703], 390: [390, 15266] } },
        { nom: 'Jamier Toiture',  metier: 'Couvreur-zingueur · Pays de Vitré',  url: 'https://jamier-toiture.vercel.app',  vue: 'assets/apercus/jamier-toiture.jpg', plein: { 1240: [1240, 10511], 390: [390, 8879] } },
        { nom: 'SJM Rénovation',  metier: 'Rénovation complète · Paris',        url: 'https://sjm-renovation.vercel.app',  vue: 'assets/apercus/sjm-renovation.jpg', plein: { 1240: [1240, 5672], 390: [398, 9170] } },
        { nom: "Tonio Rénov'",    metier: 'Toiture et façade · Boucau',         url: 'https://client-tonio-renov.vercel.app', vue: 'assets/apercus/tonio-renov.jpg', plein: { 1240: [1240, 8005], 390: [390, 11538] } }
      ]
    },
    {
      titre: 'Commerce et artisanat',
      sites: [
        { nom: 'ND Fleurs',       metier: 'Fleuriste · Paris 11e, Bastille',    url: 'https://nabil-fleurs.vercel.app',    vue: 'assets/apercus/nabil-fleurs.jpg', plein: { 1240: [1240, 7602], 390: [390, 13609] } },
        { nom: 'Tendance Raphia', metier: 'Artisanat malgache · boutique',      url: 'https://tendance-raphia.vercel.app', vue: 'assets/apercus/tendance-raphia.jpg', plein: { 1240: [1240, 4017], 390: [390, 5538] } },
        { nom: 'SiscoBe',         metier: 'Salon de coiffure · réservation',    url: 'https://siscobe.vercel.app',         vue: 'assets/apercus/siscobe.jpg', plein: { 1240: [1240, 6970], 390: [390, 8137] } },
        { nom: "Lux'Auto Spa",    metier: 'Detailing auto · Pontchâteau',       url: 'https://luxauto-spa.vercel.app',     vue: 'assets/apercus/luxauto-spa.jpg', plein: { 1240: [1240, 6700], 390: [390, 9077] } }
      ]
    },
    {
      titre: 'Services et soin',
      sites: [
        { nom: 'TKN Naturopathie',   metier: 'Naturopathe · prise de rendez-vous', url: 'https://tkn-naturopathie.vercel.app', vue: 'assets/apercus/tkn-naturopathie.jpg', plein: { 1240: [1240, 7645], 390: [390, 11042] } },
        { nom: 'NKG Service',        metier: 'Entreprise de nettoyage · Yvelines', url: 'https://nkg-sparkle-site.vercel.app', vue: 'assets/apercus/nkg-service.jpg', plein: { 1240: [1240, 4304], 390: [390, 8131] } },
        { nom: "Cœur de l'Asie",     metier: 'Élevage de chats · Val-d’Oise',  url: 'https://coeur-de-lasie.vercel.app',   vue: 'assets/apercus/coeur-de-lasie.jpg', plein: { 1240: [1240, 7938], 390: [390, 11424] } },
        { nom: 'ORIAL',              metier: 'Artiste peintre · vente en ligne',    url: 'https://orial.vercel.app',            vue: 'assets/apercus/orial.jpg', plein: { 1240: [1240, 8105], 390: [390, 12103] } }
      ]
    }
  ];

  var hote = document.querySelector('.rea-grid');
  if (!hote) return;

  var CATALOGUE = {};
  DOSSIERS.forEach(function (d) {
    d.sites.forEach(function (s) {
      // la clé des captures est le nom de fichier de la vignette
      s.cle = s.vue.split('/').pop().replace(/\.jpg$/, '');
      CATALOGUE[s.url] = s;
    });
  });

  /* ---- petit générateur reproductible : chaque fiche garde son décalage --- */
  function alea(graine) {
    var a = graine >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function empreinte(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  var FLECHE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function echappe(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---- construction des dossiers ----------------------------------------- */
  DOSSIERS.forEach(function (d, di) {
    var n = d.sites.length;
    var fiches = d.sites.map(function (s, i) {
      // -1 … 1 : la place de la fiche dans l'éventail
      var creneau = n <= 1 ? 0 : (i / (n - 1)) * 2 - 1;
      var r = alea(empreinte(s.nom) + i);
      var jx = ((r() - 0.5) * 10).toFixed(2);
      var jr = ((r() - 0.5) * 3.2).toFixed(2);
      return '<button type="button" class="fold-file"' +
        ' style="--slot:' + creneau + ';--depth:' + (n - 1 - i) + ';--jx:' + jx + 'px;--jr:' + jr + 'deg;z-index:' + (i + 1) + '"' +
        ' data-url="' + echappe(s.url) + '" data-nom="' + echappe(s.nom) + '"' +
        ' data-metier="' + echappe(s.metier) + '" data-vue="' + echappe(s.vue) + '">' +
        '<img src="' + echappe(s.vue) + '" alt="" loading="lazy" width="720" height="450">' +
        '<b>' + echappe(s.nom) + '</b><i>' + echappe(s.metier) + '</i>' +
        '<u aria-hidden="true">' + FLECHE + '</u></button>';
    }).join('');

    var el = document.createElement('div');
    el.className = 'fold';
    el.innerHTML =
      '<div class="fold-stage">' +
        '<div class="fold-shadow" aria-hidden="true"></div>' +
        '<div class="fold-back" aria-hidden="true"></div>' +
        '<svg class="fold-rim fold-rim-back" viewBox="0 0 340 272" aria-hidden="true">' +
          '<path d="M0 56A22 22 0 0 1 22 34L146 34C170 34 172 0 198 0L318 0A22 22 0 0 1 340 22L340 250A22 22 0 0 1 318 272L22 272A22 22 0 0 1 0 250Z"/></svg>' +
        '<div class="fold-files" role="list">' + fiches + '</div>' +
        '<div class="fold-front">' +
          '<svg class="fold-rim fold-rim-front" viewBox="0 0 340 198" aria-hidden="true">' +
            '<path d="M0 22A22 22 0 0 1 22 0L118 0C144 0 146 32 172 32L318 32A22 22 0 0 1 340 54L340 176A22 22 0 0 1 318 198L22 198A22 22 0 0 1 0 176Z"/></svg>' +
          '<button type="button" class="fold-hit" aria-expanded="false">' +
            '<span class="sr-only">Ouvrir le dossier ' + echappe(d.titre) + ', ' + n + ' sites</span>' +
          '</button>' +
          '<div class="fold-label"><b>' + echappe(d.titre) + '</b><span>' + n + ' sites livrés</span></div>' +
          '<div class="fold-key" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div>' +
        '</div>' +
      '</div>';
    hote.appendChild(el);

    [].forEach.call(el.querySelectorAll('.fold-file'), function (f) {
      f.setAttribute('role', 'listitem');
    });

    var bouton = el.querySelector('.fold-hit');
    bouton.addEventListener('click', function () {
      var ouvert = el.classList.toggle('is-open');
      bouton.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
      // fermé, le contenu sort de l'ordre de tabulation
      el.querySelector('.fold-files').toggleAttribute('inert', !ouvert);
      if (ouvert) {
        [].forEach.call(document.querySelectorAll('.fold.is-open'), function (autre) {
          if (autre === el) return;
          autre.classList.remove('is-open');
          autre.querySelector('.fold-hit').setAttribute('aria-expanded', 'false');
          autre.querySelector('.fold-files').setAttribute('inert', '');
        });
        // les fiches montent au-dessus du dossier : si le haut de l'eventail
        // sort de l'ecran, on remonte la page juste de ce qu'il faut.
        setTimeout(function () {
          var haute = el.querySelector('.fold-file');
          if (!haute) return;
          var manque = 110 - haute.getBoundingClientRect().top;
          if (manque > 8) {
            window.scrollBy({ top: -manque - 16, behavior: 'smooth' });
          }
        }, 420);
      }
    });
    el.querySelector('.fold-files').setAttribute('inert', '');
  });

  /* ---- l'assemblage à l'arrivée à l'écran -------------------------------- */
  var dossiers = hote.querySelectorAll('.fold');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !('IntersectionObserver' in window)) {
    [].forEach.call(dossiers, function (f) { f.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (e) {
        if (!e.isIntersecting) return;
        var i = [].indexOf.call(dossiers, e.target);
        setTimeout(function () { e.target.classList.add('is-in'); }, i * 140);
        io.unobserve(e.target);
      });
    }, { threshold: 0.2 });
    [].forEach.call(dossiers, function (f) { io.observe(f); });
    // garde-fou : si l'observateur ne vient jamais, on montre quand même
    setTimeout(function () {
      [].forEach.call(dossiers, function (f) { f.classList.add('is-in'); });
    }, 6000);
  }

  /* ---- l'aperçu ---------------------------------------------------------- */
  var peek = document.createElement('div');
  peek.className = 'peek';
  peek.setAttribute('role', 'dialog');
  peek.setAttribute('aria-modal', 'true');
  peek.setAttribute('aria-label', 'Aperçu du site');
  peek.hidden = false;
  peek.innerHTML =
    '<div class="peek-box">' +
      '<div class="peek-bar">' +
        '<button type="button" class="peek-retour">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>' +
          '<span>Retour à Potentieel</span>' +
        '</button>' +
        '<div class="peek-who"><b></b><span></span></div>' +
        '<span class="peek-note">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>' +
          'Le site du client, en vrai' +
        '</span>' +
      '</div>' +
      '<div class="peek-vue">' +
        '<iframe title="" referrerpolicy="no-referrer" allow="autoplay; fullscreen" ' +
          'sandbox="allow-scripts allow-same-origin allow-forms allow-popups ' +
          'allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock"></iframe>' +
        // data-lenis-prevent : la page utilise Lenis, qui capte la molette pour
        // tout le document ; sans lui le repli ne défilerait pas.
        '<div class="peek-repli" data-lenis-prevent></div>' +
        '<div class="peek-wait">Ouverture du site…</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(peek);

  var boite  = peek.querySelector('.peek-box');
  var vue    = peek.querySelector('.peek-vue');
  var cadre  = peek.querySelector('iframe');
  var repli  = peek.querySelector('.peek-repli');
  var attend = peek.querySelector('.peek-wait');
  var retour = peek.querySelector('.peek-retour');
  var nomEl  = peek.querySelector('.peek-bar b');
  var metEl  = peek.querySelector('.peek-who span');
  var rendu  = null;      // l'élément à qui rendre le focus
  var minuteur = 0;
  var siteOuvert = null;

  /* Largeurs auxquelles les captures de repli ont été prises. */
  var LARGEURS = [1240, 390];

  /* Le repli : si le cadre reste vide, on montre la capture pleine page et
     on propose d'ouvrir le site dans un onglet. */
  function basculerSurRepli() {
    if (!siteOuvert || boite.classList.contains('is-repli')) return;
    var w = vue.clientWidth >= 1234 ? LARGEURS[0] : LARGEURS[1];
    var d = siteOuvert.plein && siteOuvert.plein[w];
    var img = document.createElement('img');
    img.className = 'peek-page';
    img.decoding = 'async';
    if (d) { img.width = d[0]; img.height = d[1]; }
    img.alt = 'La page d’accueil du site de ' + siteOuvert.nom + ', en entier.';
    img.src = 'assets/apercus/plein/' + siteOuvert.cle + '-' + w + '.webp';
    repli.innerHTML = '';
    repli.appendChild(img);
    attend.hidden = true;
    boite.classList.add('is-repli');

    if (!peek.querySelector('.peek-onglet')) {
      var a = document.createElement('a');
      a.className = 'peek-note peek-onglet';
      a.href = siteOuvert.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Ouvrir le site dans un onglet';
      var note = peek.querySelector('.peek-note');
      if (note) note.replaceWith(a);
    }
  }

  function ouvrir(f) {
    rendu = f;
    var site = CATALOGUE[f.dataset.url];
    if (!site) return;
    siteOuvert = site;
    nomEl.textContent = site.nom;
    metEl.textContent = site.metier;
    cadre.title = 'Site de ' + site.nom;
    attend.textContent = 'Ouverture du site…';
    attend.hidden = false;
    boite.classList.remove('is-repli');
    repli.innerHTML = '';
    cadre.src = site.url;

    peek.classList.add('is-on');
    document.documentElement.style.overflow = 'hidden';
    retour.focus();

    // si rien ne vient au bout de 9 s, le site refuse probablement le cadre
    clearTimeout(minuteur);
    minuteur = setTimeout(basculerSurRepli, 9000);
  }

  function fermer() {
    clearTimeout(minuteur);
    peek.classList.remove('is-on');
    document.documentElement.style.overflow = '';
    cadre.src = 'about:blank';      // on arrête le site qui tournait
    repli.innerHTML = '';
    boite.classList.remove('is-repli');
    siteOuvert = null;
    if (rendu) { rendu.focus(); rendu = null; }
  }

  cadre.addEventListener('load', function () {
    if (!cadre.src || cadre.src === 'about:blank') return;
    attend.hidden = true;
    clearTimeout(minuteur);
  });

  hote.addEventListener('click', function (e) {
    var f = e.target.closest('.fold-file');
    if (f) ouvrir(f);
  });

  retour.addEventListener('click', fermer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && peek.classList.contains('is-on')) fermer();
  });
  // le focus ne sort pas de l'aperçu tant qu'il est ouvert
  peek.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    retour.focus();
  });
})();
