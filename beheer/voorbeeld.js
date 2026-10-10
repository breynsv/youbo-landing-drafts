/**
 * Het voorbeeldvenster van /beheer/: Jana ziet naast het invulvak wat ze maakt,
 * in de echte opmaak van de pagina.
 *
 * WAAROM DIT BESTAAT
 *
 * Een kaal formulier is blind typen. Jana beheert een Webflow-site en is dus
 * gewend te zien wat ze doet; "sla op en kijk straks op de site" is voor haar
 * geen bewerken maar gokken. Erger: het TODO-kader en de alinea-indeling zijn
 * afspraken die je pas begrijpt als je ze ziet gebeuren.
 *
 * WAT ER NAGEKEKEN IS VOOR DIT GEBOUWD WERD
 *
 * Sveltia CMS 0.233.0 ondersteunt `CMS.registerPreviewTemplate()` — nagekeken in
 * de broncode van de versie die /beheer/ laadt, niet aangenomen. De functie
 * staat in dist/sveltia-cms.js als een echte implementatie (`jA.set(e,t)`), de
 * naam staat NIET in de lijst van Decap-dingen die ze weigeren te maken, en de
 * component wordt met React gerenderd in een eigen iframe — de bron zegt zelfs
 * precies hoe: `createRoot(body).render(createElement(component, props))`. Er is
 * ook `registerPreviewStyle()`, waarmee stijlen in dat iframe komen.
 *
 * Twee dingen volgen daaruit, en ze bepalen het ontwerp hieronder:
 *
 *  1. De sleutel waaronder je registreert is bij een `files`-verzameling de naam
 *     van het BESTAND, niet van de verzameling (`jA.get(fileName ?? collectionName)`).
 *     Sinds 2026-10-09 zijn er vier bestanden, dus vier registraties: pagina,
 *     klanten, contact en faq. De verzameling heet "landingspagina" en komt in
 *     geen enkele registratie voor.
 *  2. Het voorbeeld draait in een iframe met alleen de stijlen die wij meegeven.
 *     De pagina krijgt haar opmaak van de Tailwind-CDN plus een eigen
 *     `<style type="text/tailwindcss">`-blok, en dat is een SCRIPT dat bij het
 *     laden CSS maakt. Zoiets kun je niet als stylesheet meegeven.
 *
 * DAAROM EEN IFRAME MET DE ECHTE KOP EN DE ECHTE BLOKKEN VAN DE PAGINA
 *
 * Het voorbeeld is geen nabootsing van de pagina maar een stuk ván de pagina:
 * dit bestand haalt draft-r3-01-definitief.html op, knipt daar de kop uit (de
 * Tailwind-CDN, de tokens van de huisstijl, het hele tailwindcss-blok, de
 * lettertypen en Alpine), knipt de blokken uit die bij dit bestand horen, en zet
 * die in een iframe. De tekst erin komt uit inhoud-opmaak.js en faq-opmaak.js —
 * dezelfde bestanden waarmee de bouw de echte pagina maakt.
 *
 * Er is dus geen tweede stijlblad, geen tweede opmaakfunctie en geen tweede
 * lijstje "welk blok hoort bij welk veld" die uiteen kunnen lopen met de pagina.
 * Welke blokken bij dit bestand horen, wordt afgeleid: de pagina zegt zelf welk
 * veld waar hoort (data-inhoud="hero.kop"), en een blok hoort bij dit bestand
 * zodra er een veld van dit bestand in staat. Verandert de huisstijl of de
 * indeling, dan verandert het voorbeeld mee. Verandert de pagina zo dat het
 * knippen niet meer lukt, dan zegt het voorbeeld dat in gewone taal — het laat
 * nooit iets zien dat anders is dan de pagina.
 *
 * WAT HET VOORBEELD NIET DOET, EN WAAROM DAT ZO MOET BLIJVEN
 *
 *  · Het toont alleen de blokken die bij dit bestand horen. Staat er op de site
 *    een ander blok tussen, dan staat daar in het voorbeeld een streep die dat
 *    zegt. Zonder die streep zou het voorbeeld beweren dat twee blokken aan
 *    elkaar grenzen terwijl dat niet zo is.
 *  · De vier velden van "vindbaarheid" (de titel in Google en het deelbericht)
 *    staan NIET op de pagina, dus is er niets van te tonen. Er komt een regel
 *    die dat zegt, en geen nagemaakt zoekresultaat: een tekening van een
 *    Google-resultaat is precies het soort voorbeeld dat liegt zodra Google
 *    zijn vorm verandert.
 *  · Net als op de site staat er één FAQ-vraag open, niet alle zes.
 *
 * WAAROM DE SCRIPTS VAN DE PAGINA MEEKOMEN
 *
 * Omdat ze moeten. Zonder de scripts van de pagina blijft elk blok met
 * data-reveal onzichtbaar, gooien x-data="vasteband()" en $store.toestemming een
 * fout en staat de quotecarrousel stil. Dat is geen half voorbeeld maar een
 * onjuist voorbeeld.
 *
 * En daarom staat er een CSP in het voorbeelddocument. Die scripts laden na
 * "Toestaan" de meettags van Google en LinkedIn, en het beheerscherm is geen
 * bezoeker: een klik in een voorbeeldvenster hoort geen meting op de echte site
 * te veroorzaken. De CSP laat precies de twee CDN's en de lettertypen door die
 * de pagina nodig heeft en verder niets. Klopt die lijst ooit niet meer, dan
 * ziet het voorbeeld er anders uit dan de pagina en gaat toets-voorbeeld.mjs
 * rood — dat is de gekozen bewaking.
 *
 * toets-voorbeeld.mjs meet het na: het vergelijkt de berekende stijlen van het
 * voorbeeld met die van de echte pagina, per blok en per veld.
 */
import { alineasUitTekst, ctas, lijstHtml } from '../faq-opmaak.js';
import {
  bezwaarTegenLengte, bezwaren, blokkenVoorSleutels, herhaal, InhoudFout,
  kenmerkWaardeVoorSlot, sleutelsVan, tekstVoorSlot, vindBlokken, vindSlots,
} from '../inhoud-opmaak.js';
import { vlak, vlakLijsten } from '../lees-yaml.js';

/* --------------------------------------------------------- de pagina lezen --- */

// Relatief, want deze repo wordt op twee plekken gepubliceerd: Cloudflare Pages
// op de wortel en GitHub Pages onder /youbo-landing-drafts/. Een pad met een
// schuine streep vooraan werkt op de tweede niet.
export const PAGINA_URL = new URL('../draft-r3-01-definitief.html', import.meta.url);

// De ankers waarop geknipt wordt. Alle vier staan ze in de pagina met een reden
// die er niets met dit bestand te maken heeft — de twee FAQ-markeringen zijn van
// build-faq.mjs, de andere twee zijn gewoon de kop van de pagina. Verdwijnt er
// een, dan stopt het voorbeeld met een duidelijke melding.
const ANKERS = {
  lettertypen: '<link rel="preconnect" href="https://fonts.googleapis.com">',
  tailwindCss: '<style type="text/tailwindcss">',
  lijstBegin: '<!-- FAQ-LIJST:BEGIN',
  lijstEinde: '<!-- FAQ-LIJST:EINDE -->',
};

const ALPINE_SCRIPTS = /<script\s+defer\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/(?:@alpinejs\/collapse|alpinejs)[^"]*"><\/script>/g;

function eis(voorwaarde, bericht) {
  if (!voorwaarde) throw new Error(bericht);
}

/**
 * Knipt uit de echte pagina wat het voorbeeld nodig heeft.
 * Geeft losse stukken terug; bouwVoorbeeldDocument() maakt er een document van.
 */
export function knipSchil(html) {
  const a = html.indexOf(ANKERS.lettertypen);
  const b = html.indexOf(ANKERS.tailwindCss);
  eis(a !== -1, 'de lettertype-regels staan niet meer in de pagina');
  eis(b > a, 'het tailwindcss-blok staat niet meer na de lettertypen');
  const c = html.indexOf('</style>', b);
  eis(c !== -1, 'het tailwindcss-blok wordt niet afgesloten');
  const kop = html.slice(a, c + '</style>'.length);

  const alpine = html.match(ALPINE_SCRIPTS) ?? [];
  eis(alpine.length >= 2,
      'Alpine staat niet meer in de pagina — zonder Alpine blijft de FAQ gevouwen');

  const begin = html.indexOf(ANKERS.lijstBegin);
  const einde = html.indexOf(ANKERS.lijstEinde);
  eis(begin !== -1 && einde > begin, 'de FAQ-markeringen staan niet meer in de pagina');
  const sectieBegin = html.lastIndexOf('<section', begin);
  const sectieEinde = html.indexOf('</section>', einde);
  eis(sectieBegin !== -1 && sectieEinde !== -1, 'de FAQ-sectie is niet te vinden');
  const beginEinde = html.indexOf('-->', begin) + 3;

  const lichaam = html.match(/<body[^>]*class="([^"]*)"/);

  // De blokken en de slots: hieruit volgt welk stuk van de pagina bij welk
  // bestand hoort. Allebei uit inhoud-opmaak.js, dus uit dezelfde code als de
  // bouw. Lukt dit niet, dan is er geen voorbeeld — en dat is beter dan een
  // voorbeeld dat het verkeerde blok toont.
  const kinderen = vindBlokken(html);
  const slots = vindSlots(html);
  const scripts = kinderen.filter((k) => k.tag === 'script')
    .map((k) => html.slice(k.start, k.einde)).join('\n');
  eis(scripts.length > 0,
      'de scripts van de pagina staan er niet meer — zonder die blijven blokken onzichtbaar');

  return {
    kop,
    alpine: alpine.join('\n'),
    scripts,
    voor: html.slice(sectieBegin, beginEinde),
    na: html.slice(einde, sectieEinde + '</section>'.length),
    lichaamKlasse: lichaam ? lichaam[1] : '',
    html,
    slots,
  };
}

export async function haalSchil(url = PAGINA_URL) {
  const antwoord = await fetch(url, { cache: 'no-cache' });
  eis(antwoord.ok, `de pagina kon niet gelezen worden (${antwoord.status})`);
  return knipSchil(await antwoord.text());
}

/* ------------------------------------------------------- de vragenlijst --- */

/** De items zoals het CMS ze nu in het formulier heeft staan → de vorm die
 *  faq-opmaak.js verwacht. Dezelfde alinea-regel als de bouw, uit dezelfde
 *  functie: een nieuwe regel is een nieuwe alinea. */
export function itemsUitVelden(ruw) {
  return (Array.isArray(ruw) ? ruw : [])
    .map((item) => ({
      vraag: String(item?.vraag ?? '').trim(),
      alineas: alineasUitTekst(String(item?.antwoord ?? '')),
    }))
    .filter((item) => item.vraag || item.alineas.length);
}

/** Exact dezelfde HTML als de bouw in de pagina zet. Niet "zoals", dezelfde:
 *  lijstHtml() komt uit faq-opmaak.js, dat build-faq.mjs ook gebruikt. */
export function lijstVanItems(items) {
  if (!items.length) return '';
  return lijstHtml(items, ctas(items));
}

/* ------------------------------------------- de blokken van dit bestand --- */

/** Van wat het CMS in het formulier heeft staan naar platte sleutels. Dezelfde
 *  functie als de bouw gebruikt, dus "cases.kaart_1.voordeel" betekent hier
 *  precies wat het in de pagina betekent. */
export function veldenUitEntry(data) {
  return vlak(data && typeof data === 'object' ? data : {});
}

/** Hoeveel items elke lijst in het formulier nu heeft. */
export function lijstenUitEntry(data) {
  return vlakLijsten(data && typeof data === 'object' ? data : {});
}

/**
 * DE SCHIL, UITGEKLAPT NAAR HET AANTAL ITEMS DAT NU IN HET FORMULIER STAAT.
 *
 * Zonder dit toont het voorbeeld altijd het aantal cases dat in de pagina in
 * git staat — vijf — ook wanneer Jana er net een zesde bij heeft gezet. Dat is
 * precies het soort kleine onwaarheid waardoor een voorbeeld niet meer te
 * vertrouwen is: ze typt een zesde case en ziet er vijf.
 *
 * Het klapt uit met herhaal() uit inhoud-opmaak.js, dus met dezelfde code als
 * de bouw. Daarna worden de slots en de blokken OPNIEUW gelezen, want hun
 * posities zijn verschoven.
 *
 * Gaat het uitklappen niet (te veel items, een scherm dat niet bestaat), dan
 * blijft de schil staan zoals ze was en komt het bezwaar als tekst terug. Het
 * voorbeeld toont dan de pagina van vóór die wijziging plús de melding die ook
 * de bouw zou geven — en niet een pagina die straks niet publiceert.
 */
export function schilVoorEntry(schil, data) {
  const lijsten = lijstenUitEntry(data);
  if (!lijsten.size) return { schil, bezwaren: [] };

  const grenzen = [];
  for (const [lijst, aantal] of lijsten) {
    const bezwaar = bezwaarTegenLengte(lijst, aantal);
    if (bezwaar) grenzen.push(bezwaar);
  }
  if (grenzen.length) return { schil, bezwaren: grenzen };

  try {
    // negeerOnbekend: de andere twee bestanden staan niet in dit formulier, dus
    // blijven hun blokken staan zoals ze in de pagina staan. De bouw doet dat
    // nooit — daar is een gemarkeerde lijst zonder bron een fout.
    const html = herhaal(schil.html, lijsten, veldenUitEntry(data), { negeerOnbekend: true });
    return { schil: { ...schil, html, slots: vindSlots(html) }, bezwaren: [] };
  } catch (e) {
    if (e instanceof InhoudFout) return { schil, bezwaren: [e.message] };
    throw e;
  }
}

/**
 * Welke blokken van de pagina horen bij dit bestand? Afgeleid, niet opgezocht:
 * de bovenste sleutels van dit bestand (hero, logobalk, …) wijzen via de
 * data-inhoud-attributen de blokken aan waar ze in staan.
 *
 * `buiten` zijn de velden die in geen enkel blok van <body> staan — vandaag de
 * vier van "vindbaarheid", die in de <head> zitten en dus nergens op de pagina
 * te zien zijn.
 */
export function blokkenVoorEntry(schil, data) {
  const groepen = new Set(Object.keys(data && typeof data === 'object' ? data : {}));
  return blokkenVoorSleutels(schil.html, schil.slots, (s) => groepen.has(s.split('.')[0]));
}

/**
 * Wat er in het venster gezet moet worden: per slot de nieuwe tekst of de nieuwe
 * attribuutwaarde. Berekend hier, met de functies van de bouw; het venster zelf
 * wijst het alleen nog toe. Zo is er geen tweede plek waar van een stuk tekst
 * HTML gemaakt wordt.
 *
 * Een veld dat de bouw zou tegenhouden — leeg, een "<" erin, twee alinea's —
 * levert een bezwaar op in plaats van een leugen op het scherm.
 */
export function vullingenVoorEntry(schil, data, blokken) {
  const velden = veldenUitEntry(data);
  const bezwaar = [];
  for (const [sleutel, waarde] of velden) bezwaar.push(...bezwaren(sleutel, waarde));

  const binnen = schil.slots.filter((s) =>
    blokken.some((b) => s.tagStart >= b.start && s.tagStart < b.einde));

  const ops = [];
  for (const slot of binnen) {
    try {
      // Een slot dat een veld van een ANDER bestand vraagt, blijft staan zoals
      // het in de pagina staat. Dat is juist: Jana beheert dat veld hier niet.
      if (!sleutelsVan(slot).every((k) => velden.has(k))) continue;
      ops.push({
        kenmerk: slot.kenmerk,
        sleutel: slot.waarde,
        waarde: slot.soort === 'tekst'
          ? tekstVoorSlot(slot, velden.get(slot.waarde))
          : kenmerkWaardeVoorSlot(slot, velden),
      });
    } catch (e) {
      if (e instanceof InhoudFout) { bezwaar.push(e.message); continue; }
      throw e;
    }
  }
  return { ops, bezwaren: bezwaar };
}

/* --------------------------------------------------- het voorbeelddocument --- */

// Het enige eigen schermwerk in het voorbeeld: een regel bovenaan die zegt wat
// je ziet, en een streep waar op de site een ander blok staat. Zonder die twee
// lijkt het voorbeeld de hele pagina te zijn.
const NOTA_FAQ = 'Dit is het stukje van de pagina dat je hier beheert. Klik een vraag open — net als op de site.';
const NOTA_BLOKKEN = 'Dit zijn de stukken van de pagina die je hier beheert, in de opmaak van de site.';
const TUSSEN = 'Op de site staat hier een stuk dat je in een ander bestand beheert.';

// Waarom een CSP: zie de kop van dit bestand. Alleen wat de pagina echt nodig
// heeft — de Tailwind-CDN, Alpine, de lettertypen en de beelden van deze site.
// Geen meettag, geen pixel, geen verbinding naar buiten.
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'none'",
].join('; ');

const GLUE = `
(function () {
  var open = 0;            // welke FAQ-vraag staat open; -1 = geen
  var pogingen = 0;

  var wrap = document.getElementById('faq-voorbeeld-lijst');
  if (wrap) {
    wrap.addEventListener('click', function (e) {
      var knop = e.target.closest('button');
      if (!knop) return;
      var i = Array.prototype.indexOf.call(wrap.querySelectorAll('button'), knop);
      open = (open === i) ? -1 : i;
    });
  }

  // Na het vervangen van de lijst moet Alpine de nieuwe knoppen eerst kennen
  // voor een klik iets doet. Alpine ziet nieuwe elementen zelf (het kijkt naar
  // DOM-wijzigingen), maar niet op hetzelfde moment — dus: proberen, en bij
  // mislukking nog een paar keer. Lukt het niet, dan staat de vraag dicht; dat
  // is hinder, geen onwaarheid.
  function openZetten() {
    if (!wrap || open < 0) return;
    var knoppen = wrap.querySelectorAll('button');
    var knop = knoppen[Math.min(open, knoppen.length - 1)];
    if (!knop) return;
    if (knop.getAttribute('aria-expanded') === 'true') return;
    knop.click();
    if (knop.getAttribute('aria-expanded') !== 'true' && pogingen < 12) {
      pogingen += 1;
      setTimeout(openZetten, 100);
    }
  }

  // De velden toewijzen. Dit venster rekent NIETS uit: elke waarde is al door
  // inhoud-opmaak.js gemaakt, met dezelfde functies waarmee de bouw de pagina
  // schrijft. Hier staat alleen welk element hem krijgt, en dat zegt de pagina
  // zelf met haar data-inhoud-attributen.
  function toewijzen(ops) {
    var tekst = {};
    var kenmerk = {};
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.kenmerk === null) tekst[op.sleutel] = op.waarde;
      else {
        if (!kenmerk[op.kenmerk]) kenmerk[op.kenmerk] = {};
        kenmerk[op.kenmerk][op.sleutel] = op.waarde;
      }
    }
    var kenmerken = Object.keys(kenmerk);
    var alles = document.querySelectorAll('*');
    for (var j = 0; j < alles.length; j++) {
      var el = alles[j];
      if (!el.hasAttribute) continue;
      var s = el.getAttribute('data-inhoud');
      if (s !== null && Object.prototype.hasOwnProperty.call(tekst, s)) el.innerHTML = tekst[s];
      for (var k = 0; k < kenmerken.length; k++) {
        var naam = kenmerken[k];
        var w = el.getAttribute('data-inhoud-' + naam);
        if (w !== null && Object.prototype.hasOwnProperty.call(kenmerk[naam], w)) {
          el.setAttribute(naam, kenmerk[naam][w]);
        }
      }
    }
  }

  function bezwaren(regels) {
    var vak = document.getElementById('faq-voorbeeld-bezwaar');
    if (!vak) return;
    if (!regels || !regels.length) { vak.hidden = true; vak.textContent = ''; return; }
    vak.hidden = false;
    // Hoogstens drie, want een rode muur van veertig regels leest niemand en
    // hij duwt het voorbeeld zelf van het scherm. Drie en een telling zegt
    // evenveel en laat de pagina zichtbaar.
    var eerste = regels.slice(0, 3).join(' · ');
    vak.textContent = 'Dit houdt de publicatie tegen: ' + eerste +
      (regels.length > 3 ? ' — en nog ' + (regels.length - 3) + ' ander(e) veld(en).' : '');
  }

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.soort !== 'youbo-voorbeeld') return;
    if (typeof e.data.html === 'string' && wrap) {
      wrap.innerHTML = e.data.html;
      pogingen = 0;
      requestAnimationFrame(function () { requestAnimationFrame(openZetten); });
    }
    if (e.data.ops) toewijzen(e.data.ops);
    bezwaren(e.data.bezwaren);
  });

  // De secties dragen x-cloak en data-reveal en blijven dus onzichtbaar tot
  // Alpine start. Komt Alpine er niet (geen internet, CDN eruit), dan zou het
  // venster leeg blijven zonder uitleg. Dan liever de tekst zonder de
  // bewegingen, mét een regel die zegt wat er aan de hand is.
  setTimeout(function () {
    if (window.Alpine) return;
    document.querySelectorAll('[x-cloak]').forEach(function (el) { el.removeAttribute('x-cloak'); });
    var p = document.getElementById('faq-voorbeeld-nota');
    if (p) p.textContent = 'De bewegingen en het open- en dichtklappen werken hier nu niet (Alpine kon niet geladen worden). De tekst en de opmaak zijn wel die van de pagina.';
  }, 5000);

  window.__voorbeeldKlaar = true;
})();
`;

/**
 * Het voorbeelddocument. Zonder `blokken` is het de FAQ-sectie met de
 * gegenereerde vragenlijst erin — dat is wat /beheer/ voor content/faq.yml doet,
 * en wat toets-voorbeeld.mjs meet. Mét `blokken` zijn het de blokken van de
 * pagina die bij dit bestand horen.
 */
export function bouwVoorbeeldDocument(schil, { blokken = null, buiten = [], basis = String(PAGINA_URL) } = {}) {
  let lichaam;
  let nota;
  if (blokken) {
    const stukken = [];
    for (let k = 0; k < blokken.length; k += 1) {
      // Staat er op de site nog een blok TUSSEN deze twee? Dat is het
      // volgnummer in de pagina, niet de plaats in het bestand: tussen twee
      // blokken staat bijna altijd een commentaarblok, en dat is op de site
      // niets. Zonder deze streep beweert het voorbeeld dat de twee blokken
      // aan elkaar grenzen.
      if (k > 0 && blokken[k].nummer !== blokken[k - 1].nummer + 1) {
        stukken.push(`<p class="voorbeeld-tussen">${TUSSEN}</p>`);
      }
      stukken.push(schil.html.slice(blokken[k].start, blokken[k].einde));
    }
    lichaam = stukken.join('\n');
    nota = NOTA_BLOKKEN;
  } else {
    lichaam = `${schil.voor}\n<div id="faq-voorbeeld-lijst" class="contents"></div>\n${schil.na}`;
    nota = NOTA_FAQ;
  }

  const buitenRegel = buiten.length
    ? `<p class="voorbeeld-tussen">Deze velden staan niet op de pagina zelf, dus is er niets van te tonen: ${
      buiten.join(', ')}.</p>`
    : '';

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<!-- De kop hieronder is letterlijk die van draft-r3-01-definitief.html. Niet
     nagemaakt: uitgeknipt. Zie beheer/voorbeeld.js. -->
<base href="${basis}">
${schil.kop}
${schil.alpine}
<style>
  /* Het enige dat hier bij de pagina-stijlen komt, en alleen omdat een venster
     van 400px geen pagina van 1280px is: de bandmarges krimpen en de notaregels
     krijgen vorm. Geen enkele regel raakt een blok van de pagina aan. */
  body { margin: 0; }
  section.band-pad { padding-block: 16px; }
  #faq-voorbeeld-nota, #faq-voorbeeld-bezwaar, .voorbeeld-tussen {
    margin: 0; padding: 10px 16px;
    font: 400 13px/1.4 Inter, system-ui, sans-serif;
  }
  #faq-voorbeeld-nota { background: #0a3327; color: #fff; }
  #faq-voorbeeld-bezwaar { background: #8a1c1c; color: #fff; }
  .voorbeeld-tussen { background: #e8edf0; color: #3b4a4f; text-align: center; }
</style>
</head>
<body class="${schil.lichaamKlasse}">
<p id="faq-voorbeeld-nota">${nota}</p>
<p id="faq-voorbeeld-bezwaar" hidden></p>
${lichaam}
${buitenRegel}
${schil.scripts}
<script>${GLUE}</script>
</body>
</html>`;
}

/* ------------------------------------------------------------ het venster --- */

const CMS = typeof window !== 'undefined' ? window.CMS : undefined;

/** Van een Immutable-waarde van Sveltia naar gewoon JavaScript. */
const gewoon = (w) => (w && typeof w.toJS === 'function' ? w.toJS() : w);

function maakVoorbeeld(bestand) {
  return function Voorbeeld({ entry }) {
    const { useEffect, useMemo, useRef, useState, createElement: h } = CMS.React;
    const [schil, setSchil] = useState(null);
    const [fout, setFout] = useState('');
    const venster = useRef(null);

    // Eén keer per sessie: de pagina ophalen en knippen.
    useEffect(() => {
      let weg = false;
      haalSchil()
        .then((s) => { if (!weg) setSchil(s); })
        .catch((e) => { if (!weg) setFout(String(e.message || e)); });
      return () => { weg = true; };
    }, []);

    const data = gewoon(entry?.getIn?.(['data'])) ?? {};

    // De FAQ heeft één veld (een lijst met vragen) en een eigen opmaakfunctie;
    // de drie andere bestanden vullen de data-inhoud-plekken van de pagina.
    const faq = bestand === 'faq';
    const html = faq ? lijstVanItems(itemsUitVelden(data.items)) : null;
    const afdruk = JSON.stringify(data);

    // DE LIJSTEN. Het uitklappen hangt aan de LENGTES en niet aan de inhoud:
    // zou het aan elke toetsaanslag hangen, dan wordt het document hieronder
    // bij elke letter opnieuw gezet, laadt de Tailwind-CDN telkens opnieuw en
    // knippert het venster. Zet Jana er een item bij, dan verandert de lengte
    // en komt het venster één keer opnieuw op — en dat is bij een item bijzetten
    // precies wat je verwacht.
    const lengtes = useMemo(
      () => [...lijstenUitEntry(data)].map(([l, n]) => `${l}=${n}`).join(','),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [afdruk],
    );
    const uitgeklapt = useMemo(
      () => (schil && !faq ? schilVoorEntry(schil, data) : { schil, bezwaren: [] }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [schil, faq, lengtes],
    );
    const werkschil = uitgeklapt.schil;

    const { blokken, buiten } = useMemo(
      () => (werkschil && !faq ? blokkenVoorEntry(werkschil, data) : { blokken: null, buiten: [] }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [werkschil, faq, Object.keys(data).join(',')],
    );
    const vulling = useMemo(
      () => (werkschil && !faq && blokken ? vullingenVoorEntry(werkschil, data, blokken) : null),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [werkschil, faq, blokken, afdruk],
    );

    // Bij elke toetsaanslag: de nieuwe waarden naar het venster sturen. Het
    // document zelf wordt niet opnieuw gezet — dan zou de Tailwind-CDN bij elke
    // letter opnieuw laden en zou het venster knipperen.
    useEffect(() => {
      const el = venster.current;
      if (!el) return undefined;
      const stuur = () => {
        try {
          el.contentWindow?.postMessage({
            soort: 'youbo-voorbeeld',
            html,
            ops: vulling?.ops,
            bezwaren: [...uitgeklapt.bezwaren, ...(vulling?.bezwaren ?? [])],
          }, '*');
        } catch { /* venster weg */ }
      };
      let klaar = false;
      try { klaar = !!el.contentWindow?.__voorbeeldKlaar; } catch { klaar = false; }
      if (klaar) stuur();
      else el.addEventListener('load', stuur, { once: true });
      return () => el.removeEventListener('load', stuur);
    }, [html, vulling, werkschil, uitgeklapt]);

    if (fout) {
      return h('div', { className: 'youbo-voorbeeld-fout' }, [
        h('p', { key: 'a' }, 'Het voorbeeld kan de pagina niet lezen, dus staat het er niet.'),
        h('p', { key: 'b', className: 'reden' }, fout),
        h('p', { key: 'c' },
          'Je kunt gewoon doorwerken: opslaan werkt wel. Zeg het tegen Sven — ' +
          'waarschijnlijk is de pagina veranderd en moet het voorbeeld meeveranderen.'),
      ]);
    }

    if (!schil) return h('p', { className: 'youbo-voorbeeld-wacht' }, 'Het voorbeeld wordt geladen…');

    if (!faq && (!blokken || !blokken.length)) {
      return h('p', { className: 'youbo-voorbeeld-wacht' },
        'Van dit bestand staat niets op de pagina zelf, dus is er geen voorbeeld te tonen.');
    }

    return h('iframe', {
      ref: venster,
      title: 'Voorbeeld van de pagina',
      className: 'youbo-voorbeeld',
      srcDoc: bouwVoorbeeldDocument(werkschil, { blokken, buiten }),
    });
  };
}

// Alleen de stijlen van het vensterkader zelf — alles binnen het iframe komt uit
// de pagina. registerPreviewStyle met raw: true maakt er een blob-URL van en
// hangt die in de kop van het voorbeeldvenster (zie de bron van Sveltia).
const KADER_CSS = `
  html, body { margin: 0; height: 100%; background: #fff; }
  body > div[role="document"] { padding: 0 !important; height: 100%; }
  iframe.youbo-voorbeeld { display: block; border: 0; width: 100%; height: 100%; min-height: 100vh; }
  .youbo-voorbeeld-wacht, .youbo-voorbeeld-fout {
    font: 400 15px/1.5 system-ui, sans-serif; color: #0a3327; padding: 16px; max-width: 34em;
  }
  .youbo-voorbeeld-fout .reden { font-family: ui-monospace, monospace; font-size: 13px; color: #8a1c1c; }
`;

// De namen van de BESTANDEN in de verzameling (zie de kop), niet van de
// verzameling. Staat er ooit een bestand bij in beheer/config.yml, dan hoort
// zijn naam hier ook — toets-voorbeeld.mjs vergelijkt deze lijst met de
// configuratie en gaat rood als ze uiteenlopen.
export const BESTANDEN = ['pagina', 'klanten', 'contact', 'faq'];

if (CMS?.registerPreviewTemplate) {
  CMS.registerPreviewStyle(KADER_CSS, { raw: true });
  for (const naam of BESTANDEN) CMS.registerPreviewTemplate(naam, maakVoorbeeld(naam));
} else if (typeof window !== 'undefined' && window.document) {
  console.warn('Sveltia kent registerPreviewTemplate niet — het voorbeeldvenster blijft leeg.');
}
