/**
 * De OPMAAK van de inhoud van de landingspagina: hoe een stuk tekst uit
 * content/*.yml HTML wordt.
 *
 * WAAROM DIT EEN APART BESTAND IS — DEZELFDE REDEN ALS BIJ faq-opmaak.js
 *
 * Er zijn twee lezers van deze regels: de bouw (build-inhoud.mjs) en straks het
 * voorbeeldvenster in /beheer/. Een voorbeeld dat liegt is erger dan geen
 * voorbeeld, dus mag er maar één plek zijn waar die HTML gemaakt wordt, en dit
 * is ze. Daarom staat hier niets uit node — geen fs, geen path — en heet het
 * .js en niet .mjs, want niet elke statische server levert .mjs als JavaScript
 * uit.
 *
 * DE TODO-AFSPRAAK KOMT UIT faq-opmaak.js EN IS NIET NAGEMAAKT
 *
 * Een alinea die met "TODO — " begint is overal op deze pagina hetzelfde: een
 * nota aan onszelf, met een los kader met een stippellijn eromheen. Die regel
 * en het ontsnappen van tekst worden hieronder uit faq-opmaak.js geïmporteerd
 * in plaats van herhaald. Twee kopieën van "wat is een TODO" is precies hoe de
 * FAQ en de rest van de pagina na één wijziging uiteen gaan lopen.
 *
 * WAT HIER NIET IN HOORT: lezen, keuren en wegschrijven. Dat blijft
 * build-inhoud.mjs — het voorbeeldvenster leest geen bestanden.
 */
import { ontsnap, TODO_ALINEA } from './faq-opmaak.js';

export { ontsnap, TODO_ALINEA };

/* ----------------------------------------------------------- één stuk tekst --- */

/**
 * Een waarde uit content/*.yml als HTML, bedoeld om BINNEN bestaande opmaak te
 * staan: er komt geen enkele witruimte bij. Dat is niet netheid maar noodzaak —
 * een regelafbreking die dit erbij zou zetten, zet op de pagina een spatie vóór
 * een komma.
 *
 * Begint de tekst met "TODO — ", dan krijgt het stuk tot de eerste dubbele punt
 * vet, net als in de FAQ; het kader zelf zit in de klasse die al in de HTML
 * staat (.todo of .todo-inv).
 */
export function tekstHtml(tekst) {
  if (!TODO_ALINEA.test(tekst)) return ontsnap(tekst);
  const dp = tekst.indexOf(':');
  if (dp === -1) return `<b>${ontsnap(tekst)}</b>`;
  return `<b>${ontsnap(tekst.slice(0, dp))}</b>${ontsnap(tekst.slice(dp))}`;
}

/** Een waarde in een attribuut (alt, src, href, aria-label). */
export function kenmerkHtml(tekst) {
  return ontsnap(tekst);
}

/* ------------------------------------------------------------ de cijferlijst --- */

/**
 * De opsomming onder het voordeel op een casekaart: "204 medewerkers",
 * "27 afdelingen". Eén regel per cijfer, met het stipje ervoor.
 *
 * Dit is de enige plek waar een veld meer dan één regel mag zijn, en dat is
 * met opzet: het aantal cijfers per case verschilt (twee bij Kaneka, drie bij
 * SD Worx) en dat is inhoud, geen vorm. Overal elders is één veld één regel.
 */
export function cijferregelHtml(tekst) {
  return '<li class="flex items-start gap-3">' +
         '<span class="cijferstip" aria-hidden="true"></span>' +
         `<span class="tabular">${ontsnap(tekst)}</span>` +
         '</li>';
}

export function cijferlijstHtml(lijst, inspringing = 12) {
  const binnen = ' '.repeat(inspringing + 2);
  return '\n' + lijst.map((t) => binnen + cijferregelHtml(t)).join('\n') +
         '\n' + ' '.repeat(inspringing);
}

/* ------------------------------------------------------------------- keuren --- */

/**
 * De drie afspraken die voor élk veld gelden, en de reden erbij. Ze staan hier
 * en niet in de bouw, zodat het voorbeeldvenster dezelfde grens kan tonen in
 * plaats van iets te laten zien dat straks de bouw tegenhoudt.
 *
 * Geeft een lijst bezwaren terug; leeg betekent in orde.
 */
export function bezwaren(sleutel, waarde) {
  const uit = [];
  const stukken = Array.isArray(waarde) ? waarde : [waarde];
  if (Array.isArray(waarde) && !waarde.length) {
    uit.push(`${sleutel} is een lege lijst — een opsomming zonder regels laat een gat op de pagina`);
  }
  for (const stuk of stukken) {
    if (typeof stuk !== 'string') {
      uit.push(`${sleutel} is geen tekst`);
      continue;
    }
    if (stuk.trim() === '') {
      uit.push(`${sleutel} is leeg — een leeg veld laat een gat op de pagina staan`);
    }
    if (stuk.includes('<')) {
      uit.push(`${sleutel} bevat een "<". In deze bestanden hoort geen HTML: tekst uit een ` +
               'invulveld die als HTML op de pagina belandt, is een lek');
    }
    if (stuk.includes('\n')) {
      uit.push(`${sleutel} bestaat uit meer dan één regel. Elk veld hier is één doorlopend ` +
               'stuk tekst; de opmaak van de pagina heeft op die plek geen tweede alinea');
    }
  }
  return uit;
}

/* ============================================================================
   DE PLEKKEN IN DE PAGINA
   ----------------------------------------------------------------------------
   Hieronder staat wat tot 2026-10-09 in build-inhoud.mjs stond: het vinden van
   de data-inhoud-attributen in de HTML, en het invullen ervan. Het is hierheen
   verhuisd om precies dezelfde reden als tekstHtml() hierboven — er is nu een
   tweede lezer.

   Het voorbeeldvenster van /beheer/ toont niet meer alleen de FAQ maar elk
   blok van de pagina, en het doet dat door hetzelfde blok uit te knippen en
   dezelfde velden erin te zetten. Zou het die velden zelf opzoeken en zelf
   opmaken, dan is er een tweede waarheid over "waar hoort dit veld en hoe ziet
   het eruit", en loopt het voorbeeld na één wijziging uit de pas met de pagina.
   Nu rekent het voorbeeld met deze functies en zet het alleen nog het resultaat
   in het venster.

   Niets hier raakt het bestandssysteem aan: lezen, keuren van verwijzingen en
   wegschrijven blijven in build-inhoud.mjs. In plaats van af te sluiten gooien
   deze functies een InhoudFout; de bouw vangt die en stopt ermee, het
   voorbeeld zet er een regel bij in gewone taal.
   ========================================================================== */

export class InhoudFout extends Error {}

const stop = (bericht) => { throw new InhoudFout(bericht); };

// Elementen zonder inhoud. Voor die mag er alleen een kenmerkslot op staan;
// `data-inhoud` erop zou vragen om tekst in een element te zetten dat er geen
// heeft, en dat is een typefout die je niet pas op de pagina wil zien.
export const LEEG = new Set(['img', 'meta', 'link', 'input', 'br', 'hr', 'source', 'area',
                             'base', 'col', 'embed', 'param', 'track', 'wbr']);

// Welke waarden in een href of src als een verwijzing naar een bestand van deze
// site gelezen worden. De rest is een anker, een ander protocol of een andere
// site, en die controleren we niet — net als publiceer.mjs.
const EIGEN_PROTOCOL = /^(https?:|mailto:|tel:|#|\/\/)/i;
const VERDACHT_PROTOCOL = /^\s*(javascript|data|vbscript)\s*:/i;

/* --------------------------------------------------------------- de pagina ---
   Een kleine, opzettelijk letterlijke lezer: hij zoekt de attributen en de
   grenzen van het element waar ze op staan, en verder niets. Geen DOM-model,
   want de bouw schrijft HTML terug en moet dus elke byte eromheen onaangeroerd
   laten. */

function inCommentaar(html, index) {
  const open = html.lastIndexOf('<!--', index);
  if (open === -1) return false;
  const sluit = html.indexOf('-->', open);
  return sluit === -1 || sluit > index;
}

export function eindeStarttag(html, start) {
  let aanhaling = null;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (aanhaling) { if (c === aanhaling) aanhaling = null; continue; }
    if (c === '"' || c === "'") { aanhaling = c; continue; }
    if (c === '>') return k;
  }
  return -1;
}

// Het bijhorende sluittag, met diepte voor hetzelfde tagtype erbinnen.
export function eindeElement(html, tag, na) {
  const open = new RegExp(`<${tag}(?=[\\s/>])`, 'gi');
  const sluit = new RegExp(`</${tag}\\s*>`, 'gi');
  let diepte = 1;
  let k = na;
  while (k < html.length) {
    open.lastIndex = k; sluit.lastIndex = k;
    const o = open.exec(html);
    const s = sluit.exec(html);
    if (!s) return -1;
    if (o && o.index < s.index) { diepte++; k = o.index + o[0].length; continue; }
    diepte--;
    if (diepte === 0) return s.index;
    k = s.index + s[0].length;
  }
  return -1;
}

const SLOTKENMERK = /data-inhoud(?:-([a-z][a-z0-9-]*))?="([^"]*)"/g;

export function vindSlots(html) {
  const slots = [];
  SLOTKENMERK.lastIndex = 0;
  let m;
  while ((m = SLOTKENMERK.exec(html)) !== null) {
    if (inCommentaar(html, m.index)) continue;
    const tagStart = html.lastIndexOf('<', m.index);
    if (tagStart === -1) stop(`een data-inhoud-attribuut staat niet in een element (positie ${m.index})`);
    const naam = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(tagStart, tagStart + 32));
    if (!naam) stop(`kan het element van "${m[0]}" niet lezen`);
    const tag = naam[1].toLowerCase();
    const tagEinde = eindeStarttag(html, tagStart);
    if (tagEinde === -1) stop(`het element <${tag}> met "${m[0]}" is niet afgesloten`);
    slots.push({
      soort: m[1] ? 'kenmerk' : 'tekst',
      kenmerk: m[1] ?? null,
      waarde: m[2],
      tag,
      tagStart,
      tagEinde,
      attribuutStart: m.index,
      attribuutEinde: m.index + m[0].length,
    });
  }

  for (const slot of slots) {
    if (slot.soort === 'tekst') {
      if (LEEG.has(slot.tag)) {
        stop(`<${slot.tag}> kan geen tekst bevatten, dus data-inhoud="${slot.waarde}" ` +
             `kan daar niet staan. Bedoelde je data-inhoud-alt of data-inhoud-src?`);
      }
      const einde = eindeElement(html, slot.tag, slot.tagEinde + 1);
      if (einde === -1) stop(`geen </${slot.tag}> gevonden na data-inhoud="${slot.waarde}"`);
      slot.binnenStart = slot.tagEinde + 1;
      slot.binnenEinde = einde;
      const binnen = html.slice(slot.binnenStart, slot.binnenEinde);
      if (/data-inhoud(-[a-z]|=)/.test(binnen)) {
        stop(`data-inhoud="${slot.waarde}" bevat zelf nog een data-inhoud-attribuut. ` +
             'De bouw vervangt de hele inhoud van dit element, dus zou dat tweede slot ' +
             'bij de eerste bouw verdwijnen.');
      }
      // De inspringing van de regel waarop dit element begint — nodig om een
      // opsomming net zo in te springen als de omringende HTML.
      const regelStart = html.lastIndexOf('\n', slot.tagStart) + 1;
      slot.inspringing = slot.tagStart - regelStart;
    } else {
      const starttag = html.slice(slot.tagStart, slot.tagEinde + 1);
      const treffer = new RegExp(`\\s${slot.kenmerk}="([^"]*)"`).exec(starttag);
      if (!treffer) {
        stop(`data-inhoud-${slot.kenmerk}="${slot.waarde}" staat op een <${slot.tag}> ` +
             `die zelf geen ${slot.kenmerk}-attribuut heeft. De bouw vult een bestaand ` +
             'attribuut in; hij voegt er geen toe, want dan bepaalt dit script de ' +
             'volgorde van de attributen in de HTML.');
      }
      slot.kenmerkStart = slot.tagStart + treffer.index + treffer[0].indexOf('"') + 1;
      slot.kenmerkEinde = slot.kenmerkStart + treffer[1].length;
      slot.huidig = treffer[1];
    }
  }
  return slots;
}

/* ---------------------------------------------------------------- de blokken ---
   Welk stuk van de pagina hoort bij welk veld? Het voorbeeldvenster moet dat
   weten om het juiste blok te kunnen laten zien, en de verleiding is om hier
   een lijstje ankers neer te zetten ("de hero begint bij <header class=…").
   Zo'n lijstje is een tweede waarheid die stil scheef gaat zodra iemand de
   pagina herschikt.

   Dus wordt het afgeleid: dit zijn simpelweg de rechtstreekse kinderen van
   <body>, en een blok hoort bij een bestand wanneer er een veld van dat
   bestand in staat. De pagina zegt het dus zelf, net als bij de slots.

   De <script>-blokken komen MEE in deze lijst, en dat is geen slordigheid. Het
   voorbeeldvenster heeft ze nodig: zonder de scripts van de pagina blijft elk
   blok met data-reveal onzichtbaar, gooien x-data="vasteband()" en
   $store.toestemming een fout, en staat de quotecarrousel stil. Een voorbeeld
   dat de helft van de blokken niet toont, of ze anders toont, is precies het
   voorbeeld dat niet mag bestaan. Ze bevatten geen enkel slot, dus storen ze
   blokkenVoorSleutels() niet. */

export function vindBlokken(html) {
  const lichaam = /<body[^>]*>/i.exec(html);
  if (!lichaam) stop('de pagina heeft geen <body> — dan is er geen blok te vinden');
  const einde = html.toLowerCase().lastIndexOf('</body>');
  if (einde === -1) stop('de pagina sluit <body> niet af');

  const blokken = [];
  let i = lichaam.index + lichaam[0].length;
  while (i < einde) {
    const open = html.indexOf('<', i);
    if (open === -1 || open >= einde) break;
    if (html.startsWith('<!--', open)) {
      const sluit = html.indexOf('-->', open);
      if (sluit === -1) stop('een commentaarblok in <body> wordt niet afgesloten');
      i = sluit + 3;
      continue;
    }
    const naam = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(open, open + 32));
    if (!naam) { i = open + 1; continue; }
    const tag = naam[1].toLowerCase();
    const tagEinde = eindeStarttag(html, open);
    if (tagEinde === -1) stop(`het element <${tag}> in <body> is niet afgesloten`);
    if (LEEG.has(tag) || html[tagEinde - 1] === '/') { i = tagEinde + 1; continue; }
    const sluit = eindeElement(html, tag, tagEinde + 1);
    if (sluit === -1) stop(`geen </${tag}> gevonden voor een blok in <body>`);
    const blokEinde = html.indexOf('>', sluit) + 1;
    blokken.push({ tag, start: open, einde: blokEinde });
    i = blokEinde;
  }
  if (!blokken.length) stop('geen enkel blok in <body> gevonden');
  return blokken;
}

/** De blokken waarin minstens één van deze sleutels voorkomt, in paginavolgorde. */
export function blokkenVoorSleutels(html, slots, hoort) {
  const blokken = vindBlokken(html);
  const raak = new Set();
  const buiten = [];
  for (const slot of slots) {
    if (!sleutelsVan(slot).some((s) => hoort(s))) continue;
    const blok = blokken.findIndex((b) => slot.tagStart >= b.start && slot.tagStart < b.einde);
    if (blok === -1) buiten.push(slot.waarde);
    else raak.add(blok);
  }
  // De volgnummers komen mee. Het voorbeeldvenster moet weten of er op de site
  // nog een blok TUSSEN twee gekozen blokken staat, en dat is niet af te leiden
  // uit de posities in het bestand: tussen twee blokken staat bijna altijd een
  // commentaarblok, en dat is op de site niets.
  return {
    blokken: [...raak].sort((a, b) => a - b).map((k) => ({ ...blokken[k], nummer: k })),
    buiten,
    totaal: blokken.length,
  };
}

/* ----------------------------------------------------------------- sleutels --- */

const SJABLOON = /\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g;

export function sleutelsVan(slot) {
  if (slot.soort === 'tekst' || !slot.waarde.includes('{')) return [slot.waarde];
  const uit = [];
  let m;
  SJABLOON.lastIndex = 0;
  while ((m = SJABLOON.exec(slot.waarde)) !== null) uit.push(m[1]);
  if (!uit.length) stop(`"${slot.waarde}" ziet uit als een vaste vorm maar bevat geen {sleutel}`);
  return uit;
}

/* ---------------------------------------------------------------- invoegen --- */

// Een <ul> of <ol> vraagt om een opsomming, al het andere om één stuk tekst. Die
// regel staat hier en niet in een derde attribuut: hij valt samen met wat de
// opmaak van de pagina toelaat, en een attribuut dat je ernaast kunt zetten is
// een attribuut dat ooit naast de werkelijkheid staat.
const LIJSTTAGS = new Set(['ul', 'ol']);

export function tekstVoorSlot(slot, waarde) {
  const wilLijst = LIJSTTAGS.has(slot.tag);
  if (wilLijst && !Array.isArray(waarde)) {
    stop(`"${slot.waarde}" hoort een opsomming te zijn — het vult een <${slot.tag}> op de ` +
         'pagina. Zet de regels met streepjes onder de sleutel, één regel per item.');
  }
  if (!wilLijst && Array.isArray(waarde)) {
    stop(`"${slot.waarde}" is een opsomming, maar op de pagina staat het in een ` +
         `<${slot.tag}> en dat is één doorlopend stuk tekst.`);
  }
  if (Array.isArray(waarde)) return cijferlijstHtml(waarde, slot.inspringing);
  return tekstHtml(waarde);
}

/**
 * De waarde die in dit attribuut hoort, zoals de browser hem straks leest: dus
 * ZONDER de ontsnapping. Het voorbeeldvenster zet die met setAttribute() en
 * heeft de ontsnapping niet nodig; de bouw schrijft hem in een HTML-bestand en
 * wél. Dat is dezelfde waarde langs twee wegen, want een browser leest
 * &amp;quot; in een attribuut terug als een aanhalingsteken. Het oplossen van
 * de sleutel — en de vaste vorm met {sleutel} erin — gebeurt hier, één keer.
 */
export function kenmerkWaardeVoorSlot(slot, velden) {
  if (!slot.waarde.includes('{')) {
    const waarde = velden.get(slot.waarde);
    if (Array.isArray(waarde)) {
      stop(`"${slot.waarde}" is een opsomming en kan niet in het attribuut ` +
           `${slot.kenmerk} van een <${slot.tag}> staan`);
    }
    return waarde;
  }
  return slot.waarde.replace(SJABLOON, (_, s) => {
    const waarde = velden.get(s);
    if (Array.isArray(waarde)) stop(`"${s}" is een opsomming en past niet in een vaste vorm`);
    return waarde;
  });
}

export function kenmerkVoorSlot(slot, velden) {
  return kenmerkHtml(kenmerkWaardeVoorSlot(slot, velden));
}

/**
 * Keurt een href of src. `bestaat` is een functie die zegt of een bestand van
 * deze site er is; geeft de aanroeper die niet mee, dan wordt alleen het
 * protocol gekeurd. Het voorbeeldvenster heeft geen bestandssysteem, de bouw
 * wel — en de bouw is de plek waar het moet tegenhouden.
 */
export function keurVerwijzing(slot, waarde, bestaat = null) {
  if (!(slot.kenmerk === 'href' || slot.kenmerk === 'src')) return;
  if (VERDACHT_PROTOCOL.test(waarde)) {
    stop(`"${slot.waarde}" wijst naar "${waarde}". Een ${waarde.split(':')[0]}:-adres uit een ` +
         'invulveld is een lek, niet een link.');
  }
  if (!bestaat || EIGEN_PROTOCOL.test(waarde)) return;
  if (!bestaat(waarde.replace(/^\/+/, '').split(/[?#]/)[0])) {
    stop(`ontbrekend bestand: ${waarde}\n        genoemd door "${slot.waarde}" ` +
         `(het ${slot.kenmerk} van een <${slot.tag}>). Een verwijzing naar een bestand ` +
         'dat er niet is, wordt op de site een gebroken plaatje of een dode link — ' +
         'dus stopt de bouw hier, net als publiceer.mjs dat doet.');
  }
}

/** Wat er voor elk slot in de pagina komt: [slot, nieuwe tekst]. */
export function vullingen(slots, velden, { bestaat = null } = {}) {
  const uit = [];
  for (const slot of slots) {
    if (slot.soort === 'tekst') {
      uit.push([slot, tekstVoorSlot(slot, velden.get(slot.waarde))]);
    } else {
      const nieuw = kenmerkVoorSlot(slot, velden);
      keurVerwijzing(slot, nieuw, bestaat);
      uit.push([slot, nieuw]);
    }
  }
  return uit;
}

/** Dezelfde vullingen, maar in de HTML gezet. Dit is wat de bouw wegschrijft. */
export function voegIn(html, slots, velden, opties = {}) {
  const bewerkingen = vullingen(slots, velden, opties).map(([slot, tekst]) => (
    slot.soort === 'tekst'
      ? [slot.binnenStart, slot.binnenEinde, tekst]
      : [slot.kenmerkStart, slot.kenmerkEinde, tekst]
  ));
  bewerkingen.sort((a, b) => b[0] - a[0]);
  let uit = html;
  for (const [a, b, tekst] of bewerkingen) uit = uit.slice(0, a) + tekst + uit.slice(b);
  return uit;
}
