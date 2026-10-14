/* =========================================================================
   POTENTIEEL — Les réalisations : dossiers en verre + aperçu des sites

   Le catalogue vit ici, en un seul endroit. Chaque site porte son nom, son
   métier et son adresse de déploiement ; l'adresse ne s'affiche jamais à
   l'écran, elle ne sert qu'à charger l'aperçu.

   L'aperçu charge le site dans un cadre, à la demande seulement : rien
   n'est chargé tant qu'un visiteur n'a pas cliqué. Le site occupe le cadre
   à sa taille réelle et se parcourt normalement — on passe d'une page à
   l'autre, on défile, rien n'est déformé. Ce sont les actions qui sont
   empêchées, pas les clics : le bac à sable du cadre interdit l'envoi de
   formulaire, les fenêtres surgissantes et toute sortie vers le haut.
   ========================================================================= */
(function () {
  'use strict';

  var DOSSIERS = [
    {
      titre: 'Bâtiment et rénovation',
      sites: [
        { nom: 'Euros Carrelage', metier: 'Carreleur · Villefranche-sur-Saône', url: 'https://euros-carrelage.vercel.app', vue: 'assets/apercus/euros-carrelage.jpg' },
        { nom: 'Jamier Toiture',  metier: 'Couvreur-zingueur · Pays de Vitré',  url: 'https://jamier-toiture.vercel.app',  vue: 'assets/apercus/jamier-toiture.jpg' },
        { nom: 'SJM Rénovation',  metier: 'Rénovation complète · Paris',        url: 'https://sjm-renovation.vercel.app',  vue: 'assets/apercus/sjm-renovation.jpg' },
        { nom: "Tonio Rénov'",    metier: 'Toiture et façade · Boucau',         url: 'https://client-tonio-renov.vercel.app', vue: 'assets/apercus/tonio-renov.jpg' }
      ]
    },
    {
      titre: 'Commerce et artisanat',
      sites: [
        { nom: 'ND Fleurs',       metier: 'Fleuriste · Paris 11e, Bastille',    url: 'https://nabil-fleurs.vercel.app',    vue: 'assets/apercus/nabil-fleurs.jpg' },
        { nom: 'Tendance Raphia', metier: 'Artisanat malgache · boutique',      url: 'https://tendance-raphia.vercel.app', vue: 'assets/apercus/tendance-raphia.jpg' },
        { nom: 'SiscoBe',         metier: 'Salon de coiffure · réservation',    url: 'https://siscobe.vercel.app',         vue: 'assets/apercus/siscobe.jpg' },
        { nom: "Lux'Auto Spa",    metier: 'Detailing auto · Pontchâteau',       url: 'https://luxauto-spa.vercel.app',     vue: 'assets/apercus/luxauto-spa.jpg' }
      ]
    },
    {
      titre: 'Services et soin',
      sites: [
        { nom: 'TKN Naturopathie',   metier: 'Naturopathe · prise de rendez-vous', url: 'https://tkn-naturopathie.vercel.app', vue: 'assets/apercus/tkn-naturopathie.jpg' },
        { nom: 'NKG Service',        metier: 'Entreprise de nettoyage · Yvelines', url: 'https://nkg-sparkle-site.vercel.app', vue: 'assets/apercus/nkg-service.jpg' },
        { nom: "Cœur de l'Asie",     metier: 'Élevage de chats · Val-d’Oise',  url: 'https://coeur-de-lasie.vercel.app',   vue: 'assets/apercus/coeur-de-lasie.jpg' },
        { nom: 'ORIAL',              metier: 'Artiste peintre · vente en ligne',    url: 'https://orial.vercel.app',            vue: 'assets/apercus/orial.jpg' }
      ]
    }
  ];

  var hote = document.querySelector('.rea-grid');
  if (!hote) return;

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
        '<div class="fold-files" role="list">' + fiches + '</div>' +
        '<div class="fold-front">' +
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
        '<div class="peek-who"><b></b><span></span></div>' +
        '<span class="peek-note">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>' +
          'Aperçu : vous naviguez librement, rien n’est envoyé' +
        '</span>' +
        '<button type="button" class="peek-close" aria-label="Fermer l’aperçu">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="peek-vue">' +
        '<iframe title="" referrerpolicy="no-referrer" '+
          'sandbox="allow-scripts allow-same-origin allow-pointer-lock"></iframe>' +
        '<div class="peek-repli"></div>' +
        '<div class="peek-wait">Chargement du site…</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(peek);

  var boite  = peek.querySelector('.peek-box');
  var cadre  = peek.querySelector('iframe');
  var vue    = peek.querySelector('.peek-vue');
  var attend = peek.querySelector('.peek-wait');
  var repli  = peek.querySelector('.peek-repli');
  var nomEl  = peek.querySelector('.peek-bar b');
  var metEl  = peek.querySelector('.peek-bar span');
  var rendu  = null;      // l'élément à qui rendre le focus
  var minuteur = 0;

  function ouvrir(f) {
    rendu = f;
    nomEl.textContent = f.dataset.nom;
    metEl.textContent = f.dataset.metier;
    cadre.title = 'Aperçu du site de ' + f.dataset.nom;
    repli.innerHTML = '';
    boite.classList.remove('is-repli');
    attend.hidden = false;
    cadre.src = f.dataset.url;

    peek.classList.add('is-on');
    document.documentElement.style.overflow = 'hidden';
    peek.querySelector('.peek-close').focus();

    // si rien n'est arrivé au bout de 9 s, on montre la capture
    clearTimeout(minuteur);
    minuteur = setTimeout(function () {
      if (attend.hidden) return;
      attend.hidden = true;
      var img = document.createElement('img');
      img.src = f.dataset.vue;
      img.alt = 'Capture du site de ' + f.dataset.nom;
      repli.appendChild(img);
      boite.classList.add('is-repli');
    }, 9000);
  }

  function fermer() {
    clearTimeout(minuteur);
    peek.classList.remove('is-on');
    document.documentElement.style.overflow = '';
    cadre.src = 'about:blank';          // on arrête le site qui tournait
    if (rendu) { rendu.focus(); rendu = null; }
  }

  cadre.addEventListener('load', function () {
    if (cadre.src === 'about:blank' || !cadre.src) return;
    attend.hidden = true;
    clearTimeout(minuteur);
  });

  hote.addEventListener('click', function (e) {
    var f = e.target.closest('.fold-file');
    if (f) ouvrir(f);
  });

  peek.querySelector('.peek-close').addEventListener('click', fermer);
  peek.addEventListener('click', function (e) { if (e.target === peek) fermer(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && peek.classList.contains('is-on')) fermer();
  });
  // le focus ne sort pas de l'aperçu tant qu'il est ouvert
  peek.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    peek.querySelector('.peek-close').focus();
  });
})();
