/**
 * Het voorbeeldvenster van /beheer/: Jana ziet naast het invulvak wat ze maakt,
 * in de echte opmaak van de pagina.
 *
 * WAAROM DIT BESTAAT
 *
 * Een kaal formulier is blind typen. Jana beheert een Webflow-site en is dus
 * gewend te zien wat ze doet; "sla op en kijk straks op de site" is voor haar
 * geen bewerken maar gokken. Erger: het gele TODO-kader en de alinea-indeling
 * zijn afspraken die je pas begrijpt als je ze ziet gebeuren.
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
 *     Hier heten beide "faq", dus valt dat niet op — tot iemand het omdoopt.
 *  2. Het voorbeeld draait in een iframe met alleen de stijlen die wij meegeven.
 *     De pagina krijgt haar opmaak van de Tailwind-CDN plus een eigen
 *     `<style type="text/tailwindcss">`-blok, en dat is een SCRIPT dat bij het
 *     laden CSS maakt. Zoiets kun je niet als stylesheet meegeven.
 *
 * DAAROM EEN IFRAME MET DE ECHTE KOP VAN DE PAGINA
 *
 * Het voorbeeld is geen nabootsing van de pagina maar een stuk ván de pagina:
 * dit bestand haalt draft-r3-01-definitief.html op, knipt daar de kop uit (de
 * Tailwind-CDN, de tokens van de huisstijl, het hele tailwindcss-blok, de
 * lettertypen en Alpine) en de FAQ-sectie zelf, en zet die in een iframe. De
 * vragenlijst erin wordt gemaakt met faq-opmaak.js — hetzelfde bestand dat de
 * bouw gebruikt om de echte pagina te maken.
 *
 * Er is dus geen tweede stijlblad en geen tweede opmaakfunctie die uiteen kunnen
 * lopen met de pagina. Verandert de huisstijl, dan verandert het voorbeeld mee,
 * want het leest dezelfde regels. Verandert de pagina zo dat het knippen niet
 * meer lukt, dan zegt het voorbeeld dat in gewone taal — het laat nooit iets
 * zien dat anders is dan de pagina.
 *
 * WAT HET VOORBEELD NIET DOET
 *
 * Het toont de FAQ-sectie, niet de hele pagina: alles erboven staat vast en Jana
 * kan er niets aan veranderen. En net als op de site staat er één vraag open —
 * klikken werkt, want het is Alpine zelf die dat doet. Zou het alle vragen
 * openzetten, dan zou het voorbeeld iets tonen wat de bezoeker nooit ziet.
 *
 * toets-voorbeeld.mjs meet het na: het vergelijkt letter voor letter de
 * berekende stijlen van het voorbeeld met die van de echte pagina.
 */
import { alineasUitTekst, ctas, lijstHtml } from '../faq-opmaak.js';

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

  return {
    kop,
    alpine: alpine.join('\n'),
    voor: html.slice(sectieBegin, beginEinde),
    na: html.slice(einde, sectieEinde + '</section>'.length),
    lichaamKlasse: lichaam ? lichaam[1] : '',
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

/* --------------------------------------------------- het voorbeelddocument --- */

// Het enige eigen schermwerk in het voorbeeld: een regel bovenaan die zegt wat
// je ziet, en dat de rest van de pagina er nog boven en onder staat. Zonder die
// regel lijkt het voorbeeld de hele pagina te zijn.
const NOTA = 'Dit is het stukje van de pagina dat je hier beheert. Klik een vraag open — net als op de site.';

const GLUE = `
(function () {
  var wrap = document.getElementById('faq-voorbeeld-lijst');
  var open = 0;            // welke vraag staat open; -1 = geen
  var pogingen = 0;

  wrap.addEventListener('click', function (e) {
    var knop = e.target.closest('button');
    if (!knop) return;
    var i = Array.prototype.indexOf.call(wrap.querySelectorAll('button'), knop);
    open = (open === i) ? -1 : i;
  });

  // Na het vervangen van de lijst moet Alpine de nieuwe knoppen eerst kennen
  // voor een klik iets doet. Alpine ziet nieuwe elementen zelf (het kijkt naar
  // DOM-wijzigingen), maar niet op hetzelfde moment — dus: proberen, en bij
  // mislukking nog een paar keer. Lukt het niet, dan staat de vraag dicht; dat
  // is hinder, geen onwaarheid.
  function openZetten() {
    if (open < 0) return;
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

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.soort !== 'faq-voorbeeld') return;
    wrap.innerHTML = e.data.html;
    pogingen = 0;
    requestAnimationFrame(function () { requestAnimationFrame(openZetten); });
  });

  // De sectie draagt x-cloak en blijft dus onzichtbaar tot Alpine start. Komt
  // Alpine er niet (geen internet, CDN eruit), dan zou het venster leeg blijven
  // zonder uitleg. Dan liever de vragen zonder het open- en dichtklappen, mét
  // een regel die zegt wat er aan de hand is.
  setTimeout(function () {
    if (window.Alpine) return;
    document.querySelectorAll('[x-cloak]').forEach(function (el) { el.removeAttribute('x-cloak'); });
    var p = document.getElementById('faq-voorbeeld-nota');
    if (p) p.textContent = 'Het open- en dichtklappen werkt hier nu niet (Alpine kon niet geladen worden). De tekst en de opmaak zijn wel die van de pagina.';
  }, 5000);

  window.__voorbeeldKlaar = true;
})();
`;

export function bouwVoorbeeldDocument(schil, { basis = String(PAGINA_URL) } = {}) {
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- De kop hieronder is letterlijk die van draft-r3-01-definitief.html. Niet
     nagemaakt: uitgeknipt. Zie beheer/voorbeeld.js. -->
<base href="${basis}">
${schil.kop}
${schil.alpine}
<style>
  /* Het enige dat hier bij de pagina-stijlen komt, en alleen omdat een venster
     van 400px geen pagina van 1280px is: de bandbreedte-marges krimpen en de
     notaregel krijgt vorm. Geen enkele regel raakt de FAQ zelf aan. */
  body { margin: 0; }
  section.band-pad { padding-block: 16px; }
  #faq-voorbeeld-nota {
    margin: 0; padding: 10px 16px; background: #0a3327; color: #fff;
    font: 400 13px/1.4 Inter, system-ui, sans-serif;
  }
</style>
</head>
<body class="${schil.lichaamKlasse}">
<p id="faq-voorbeeld-nota">${NOTA}</p>
${schil.voor}
<div id="faq-voorbeeld-lijst" class="contents"></div>
${schil.na}
<script>${GLUE}</script>
</body>
</html>`;
}

/* ------------------------------------------------------------ het venster --- */

const CMS = typeof window !== 'undefined' ? window.CMS : undefined;

function Voorbeeld({ entry }) {
  const { useEffect, useRef, useState, createElement: h } = CMS.React;
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

  const ruw = entry?.getIn?.(['data', 'items']);
  const items = itemsUitVelden(ruw?.toJS ? ruw.toJS() : ruw);
  const html = lijstVanItems(items);

  // En bij elke toetsaanslag: de nieuwe lijst naar het venster sturen. Het
  // document zelf wordt niet opnieuw gezet — dan zou de Tailwind-CDN bij elke
  // letter opnieuw laden en zou het venster knipperen.
  useEffect(() => {
    const el = venster.current;
    if (!el) return;
    const stuur = () => {
      try { el.contentWindow?.postMessage({ soort: 'faq-voorbeeld', html }, '*'); } catch { /* venster weg */ }
    };
    let klaar = false;
    try { klaar = !!el.contentWindow?.__voorbeeldKlaar; } catch { klaar = false; }
    if (klaar) stuur();
    else el.addEventListener('load', stuur, { once: true });
    return () => el.removeEventListener('load', stuur);
  }, [html, schil]);

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

  return h('iframe', {
    ref: venster,
    title: 'Voorbeeld van de pagina',
    className: 'youbo-voorbeeld',
    srcDoc: bouwVoorbeeldDocument(schil),
  });
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

if (CMS?.registerPreviewTemplate) {
  CMS.registerPreviewStyle(KADER_CSS, { raw: true });
  // "faq" is de naam van het BESTAND in de verzameling (zie de kop). Beide heten
  // hier faq; staat er ooit een tweede bestand bij, dan hoort hier de
  // bestandsnaam.
  CMS.registerPreviewTemplate('faq', Voorbeeld);
} else if (typeof window !== 'undefined' && window.document) {
  console.warn('Sveltia kent registerPreviewTemplate niet — het voorbeeldvenster blijft leeg.');
}
