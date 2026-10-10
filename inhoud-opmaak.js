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

/* =========================================================== DE LIJSTEN ====
   DE GRENZEN, EN WAAR ELK GETAL VANDAAN KOMT
   ----------------------------------------------------------------------------
   Vier blokken van de pagina zijn sinds 2026-10-10 echte lijsten: Jana kan er
   een item bij zetten, een weghalen en de volgorde veranderen. Maar de pagina
   rekent op aantallen, en een zesde quote of een tiende logo breekt de
   indeling STIL — groene bouw, scheve pagina. Dus heeft elke lijst een
   ondergrens en een bovengrens, en die staan hier, in het bestand dat de bouw
   én het voorbeeldvenster lezen.

   Geen van deze acht getallen is aangenomen. Ze zijn gemeten in een eigen
   headless Chromium door het aantal items te variëren en te kijken wat er
   werkelijk stuk gaat; wat er gemeten is staat per lijst in `waarom`, en dat
   is ook de tekst die Jana te zien krijgt wanneer de bouw weigert. Een grens
   zonder reden is een grens die de volgende lezer weghaalt.
   ========================================================================== */

export const GRENZEN = {
  'cases.items': {
    min: 2,
    max: 7,
    naam: 'cases',
    waarom:
      'Het raster op desktop is zes kolommen breed: een kaart beslaat er twee (drie op ' +
      'een rij) of drie (twee op een rij). Met één kaart blijft er 699 van de 1024 ' +
      'beeldpunten leeg — gemeten op 1440px. En onder het raster staat op een telefoon ' +
      'één puntje per kaart van 44 beeldpunten breed: zeven puntjes zijn 308 en passen ' +
      'in de 312 die een 360px-telefoon binnen de kantlijn overhoudt, acht zijn 352 en ' +
      'steken aan beide kanten buiten de pagina.',
  },
  'quotes.items': {
    min: 3,
    max: 7,
    naam: 'quotes',
    waarom:
      'De veegbare rij toont op desktop twee quotes volledig en een derde half — dat ' +
      'halve kaartje is wat zonder woorden zegt dat er nog volgen. Met twee quotes is de ' +
      'rij op 1440px nul beeldpunten schuifbaar (gemeten), dus verdwijnt dat teken en ' +
      'worden de pijlen en de puntjes knoppen die niets doen. Met drie is ze 191 ' +
      'beeldpunten schuifbaar. De bovengrens is dezelfde puntjesrij als bij de cases: ' +
      'zeven van 44 passen op een telefoon, acht niet.',
  },
  'rondleiding.stappen': {
    min: 2,
    max: 4,
    naam: 'stappen van de rondleiding',
    waarom:
      'Elke stap hoort bij één nagetekend productscherm, en die vier schermen zijn ' +
      'ontwerp: hun cijfers sluiten op elkaar aan over de vier schermen heen. Een vijfde ' +
      'stap heeft dus geen scherm om te tonen. Je kunt een stap weglaten of de volgorde ' +
      'veranderen — het scherm gaat mee — maar een stap bijmaken is werk voor een ' +
      'ontwikkelaar. En met één stap wisselt de meescrollende kaart nooit, dus is het ' +
      'geen rondleiding meer.',
  },
  'logobalk.logos': {
    min: 6,
    max: 9,
    naam: "logo's in de balk",
    waarom:
      'De balk mag nooit een complete reeks tegelijk tonen: dan staat er een naam twee ' +
      'keer in beeld. Gemeten: met vijf logo\'s past een hele reeks in de balk op 1279 en ' +
      'op 1919 beeldpunten breed. Zes is het eerste aantal dat op elke breedte veilig is. ' +
      'Aan de bovenkant beslist de stilstaande terugval voor wie "beperk beweging" aan ' +
      'heeft: op 1024 beeldpunten — de smalste desktop — blijft de rij met negen logo\'s ' +
      'op één regel (1004 van 1024) en breekt ze bij tien in twee halve regels, wat als ' +
      'een fout leest.',
  },
};

/**
 * Het bezwaar tegen een lijstlengte, of null. Het voorbeeldvenster toont deze
 * tekst terwijl Jana bezig is; de bouw weigert ermee. Eén bron, dus kunnen ze
 * niet uiteenlopen.
 */
export function bezwaarTegenLengte(lijst, aantal) {
  const g = GRENZEN[lijst];
  if (!g) return null;
  if (aantal >= g.min && aantal <= g.max) return null;
  const teveel = aantal > g.max;
  return `${teveel ? 'Te veel' : 'Te weinig'} ${g.naam}: er ${aantal === 1 ? 'is' : 'zijn'} er ` +
         `${aantal} en het mogen er ${teveel ? `hoogstens ${g.max}` : `minstens ${g.min}`} zijn.\n` +
         `        ${g.waarom}`;
}

/**
 * Hoe breed elke casekaart in het raster van zes kolommen staat.
 *
 * Een rij is pas vol wanneer de spans samen zes zijn, en de twee breedtes die
 * het ontwerp heeft zijn twee (drie kaarten op een rij) en drie (twee kaarten
 * op een rij). Zoveel rijen van drie als kan en de rest in rijen van twee —
 * dat is de verdeling waarin de minste leegte overblijft, en voor vijf kaarten
 * levert het precies de indeling op die er vandaag staat: drie smalle boven,
 * twee brede onder.
 */
export function kaartspans(aantal) {
  for (let rijenVanDrie = Math.floor(aantal / 3); rijenVanDrie >= 0; rijenVanDrie--) {
    const rest = aantal - rijenVanDrie * 3;
    if (rest % 2 === 0) {
      return [...Array(rijenVanDrie * 3).fill(2), ...Array(rest).fill(3)];
    }
  }
  return null;   // alleen bij één kaart; de ondergrens houdt dat al tegen
}

/**
 * Een naam als stukje adres: "Aertssen Group" → "aertssen-group". Alleen voor
 * de data-cta-haken van de analytics, die per kaart verschillend moeten zijn —
 * check-drafts.mjs waarschuwt bij twee gelijke. Hij staat niet op de pagina en
 * wordt niet voorgelezen.
 */
export function slug(tekst) {
  return tekst
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
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

/* ======================================================= HERHALEN ==========
   EEN LIJST UITKLAPPEN IN DE PAGINA
   ----------------------------------------------------------------------------
   De cases, de quotes, de stappen en de logo's zijn N keer dezelfde vorm. Daar
   geldt wat bij de FAQ geldt en bij de negen vaste blokken niet: die vorm ís
   code. Dus staat er om elk van die stukken een markeringspaar, net als om de
   FAQ-lijst:

       <!-- HERHAAL:cases.items:BEGIN — … -->
         <li …>de eerste kaart…</li>
         <li …>de tweede kaart…</li>
       <!-- HERHAAL:cases.items:EINDE -->

   WAAROM ER GEEN SJABLOON IN EEN JAVASCRIPT-BESTAND STAAT

   De verleiding is om de vorm van zo'n kaart hierheen te halen, als een stuk
   HTML in een backtick-string. Dat is wat build-faq.mjs voor de FAQ doet, en
   voor zes regels tekst is dat in orde. Een casekaart is het niet: ze heeft
   een logoplek met een gemeten hoogte, een voordeel met een min-height, een
   cijferopsomming, een voet met een scheidingslijn en een raamwerk van
   Tailwind-klassen. Verhuist dat naar hier, dan kan de ontwerper er niet meer
   bij — en dan is het ontwerp van deze pagina voor de helft programmeerwerk
   geworden.

   Dus is DE EERSTE ITEM IN DE PAGINA ZELF DE VORM. De bouw leest hem, maakt er
   N van, en zet in elke kopie de dingen recht die per item verschillen. De
   vorm blijft dus staan waar ze hoort te staan, zichtbaar en aanpasbaar, en
   wie haar wil wijzigen past de eerste kaart aan. De kopieën eronder worden bij
   de volgende bouw overschreven — dat staat in de markering, net als bij de
   FAQ.

   WAT PER KOPIE VERSCHILT, EN HOE DE PAGINA DAT ZELF ZEGT

   Zes kleine kenmerken, en ze blijven in de uitvoer staan zodat de volgende
   bouw de vorm opnieuw leest:

     data-herhaal-nr="2"        het nummer van dit item als tekst, hier met twee
                                cijfers: 01, 02, 03
     data-herhaal-teller        "2 / 4" — het nummer en het totaal
     data-herhaal-span          de breedte in het raster (lg:col-span-2 of -3),
                                berekend met kaartspans()
     data-herhaal-eerste="x y"  deze klassen staan alleen op het eerste item
     data-herhaal-weg-als-leeg="sleutel"
                                laat dit element wég wanneer dat veld geen
                                waarde heeft. Zonder dit zou een casekaart
                                zonder nota een leeg kader met een stippellijn
                                tekenen, want .case-todo heeft eigen marges.
     data-herhaal-scherm="sleutel"
                                vervang dit element door het nagetekende scherm
                                dat in dat veld genoemd staat. De schermen
                                blijven in de pagina staan en worden alleen
                                verplaatst, nooit gegenereerd.
   ========================================================================== */

const HERHAAL_BEGIN = /<!--\s*HERHAAL:([A-Za-z_][A-Za-z0-9_.]*):BEGIN(?:[^]*?)-->/g;

// De kenmerken die een sleutel uit content/ dragen. Alleen in deze wordt bij
// het kopiëren het itemnummer omgezet; in gewone tekst blijft alles staan.
const SLEUTELKENMERK =
  /(?:data-inhoud(?:-[a-z][a-z0-9-]*)?|data-herhaal-weg-als-leeg|data-herhaal-scherm)="([^"]*)"/g;

// Het woord waarmee een element dat bij dit item niets te zeggen heeft, tussen
// commentaartekens staat. Zo blijft het in de pagina leesbaar aanwezig en kan
// de volgende bouw de vorm weer heel maken.
const OPTIONEEL = 'HERHAAL-NIETS-TE-ZEGGEN';
const GEDAAN = 'data-herhaal-gedaan';

/** De gemarkeerde stukken, in paginavolgorde. Dezelfde lijst mag meer dan één
    stuk markeren — de logobalk draagt drie reeksen van dezelfde logo's. */
export function vindHerhalingen(html) {
  const uit = [];
  HERHAAL_BEGIN.lastIndex = 0;
  let m;
  while ((m = HERHAAL_BEGIN.exec(html)) !== null) {
    const lijst = m[1];
    const einde = `HERHAAL:${lijst}:EINDE`;
    const na = m.index + m[0].length;
    const sluitStart = html.indexOf('<!--', na);
    let sluit = -1;
    let zoek = na;
    while (true) {
      const kandidaat = html.indexOf('<!--', zoek);
      if (kandidaat === -1) break;
      const dicht = html.indexOf('-->', kandidaat);
      if (dicht === -1) break;
      if (html.slice(kandidaat, dicht).includes(einde)) { sluit = kandidaat; break; }
      zoek = dicht + 3;
    }
    if (sluit === -1) {
      stop(`de markering HERHAAL:${lijst}:BEGIN heeft geen bijhorende ` +
           `HERHAAL:${lijst}:EINDE. Dan weet de bouw niet waar de lijst ophoudt en ` +
           'zou ze de rest van de pagina overschrijven.');
    }
    void sluitStart;
    uit.push({
      lijst,
      binnenStart: na,
      binnenEinde: sluit,
      // De inspringing van de regel waarop het sluitcommentaar staat: daarmee
      // staat een gegenereerd item net zo diep als de HTML eromheen.
      inspringing: sluit - (html.lastIndexOf('\n', sluit) + 1),
    });
  }
  return uit;
}

/** Het eerste element in een stuk HTML, met zijn exacte brontekst. */
function eersteElement(fragment, lijst) {
  let i = 0;
  while (i < fragment.length) {
    const open = fragment.indexOf('<', i);
    if (open === -1) break;
    if (fragment.startsWith('<!--', open)) {
      const dicht = fragment.indexOf('-->', open);
      if (dicht === -1) break;
      i = dicht + 3;
      continue;
    }
    const naam = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(fragment.slice(open, open + 32));
    if (!naam) { i = open + 1; continue; }
    const tag = naam[1].toLowerCase();
    const tagEinde = eindeStarttag(fragment, open);
    if (tagEinde === -1) break;
    if (LEEG.has(tag) || fragment[tagEinde - 1] === '/') {
      return { tag, start: open, einde: tagEinde + 1 };
    }
    const sluit = eindeElement(fragment, tag, tagEinde + 1);
    if (sluit === -1) break;
    return { tag, start: open, einde: fragment.indexOf('>', sluit) + 1 };
  }
  stop(`tussen HERHAAL:${lijst}:BEGIN en :EINDE staat geen enkel element. Het eerste ` +
       'element daar is de vorm van één item; zonder dat valt er niets te herhalen.');
  return null;
}

/* ---------------------------------------------------------- één kopie recht zetten --- */

/** Het element waarop dit kenmerk staat, binnen een stuk HTML. */
function elementMet(fragment, kenmerk, vanaf = 0) {
  const re = new RegExp(`\\s${kenmerk}(?:="([^"]*)")?`);
  const treffer = re.exec(fragment.slice(vanaf));
  if (!treffer) return null;
  const op = vanaf + treffer.index;
  const tagStart = fragment.lastIndexOf('<', op);
  const naam = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(fragment.slice(tagStart, tagStart + 32));
  if (!naam) stop(`kan het element van ${kenmerk} niet lezen`);
  const tag = naam[1].toLowerCase();
  const tagEinde = eindeStarttag(fragment, tagStart);
  const leeg = LEEG.has(tag) || fragment[tagEinde - 1] === '/';
  const sluit = leeg ? -1 : eindeElement(fragment, tag, tagEinde + 1);
  return {
    tag, waarde: treffer[1] ?? '', tagStart, tagEinde,
    binnenStart: leeg ? -1 : tagEinde + 1,
    binnenEinde: leeg ? -1 : sluit,
    elementEinde: leeg ? tagEinde + 1 : fragment.indexOf('>', sluit) + 1,
    kenmerkStart: op,
    kenmerkEinde: op + treffer[0].length,
  };
}

const vervang = (tekst, van, tot, nieuw) => tekst.slice(0, van) + nieuw + tekst.slice(tot);

/** De klasse-waarde van een starttag aanpassen. */
function metKlassen(fragment, el, bewerk) {
  const starttag = fragment.slice(el.tagStart, el.tagEinde + 1);
  const treffer = /\sclass="([^"]*)"/.exec(starttag);
  if (!treffer) {
    stop(`het element <${el.tag}> hierboven heeft geen class-attribuut om aan te passen`);
  }
  const van = el.tagStart + treffer.index + treffer[0].indexOf('"') + 1;
  return vervang(fragment, van, van + treffer[1].length, bewerk(treffer[1]));
}

/**
 * Eén kopie van de vorm, recht gezet voor item `nr` van `totaal`.
 *
 * `velden` is de platte Map; `schermen` is de bank met nagetekende schermen,
 * die alleen de rondleiding gebruikt. Allebei mogen leeg zijn — het
 * voorbeeldvenster heeft geen bank nodig zolang het de pagina zelf uitknipt.
 */
export function kopie(vorm, { lijst, nr, totaal, velden, span = null, schermen = null }) {
  // 0 · de vorm weer heel maken. Een element dat bij dit item niets te zeggen
  //     had, staat in de pagina tussen commentaartekens in plaats van dat het
  //     verdwenen is — zie stap 6. Dat is wat de vorm overleefbaar maakt: zou
  //     het écht verdwijnen, dan is het bij de eerste kaart zonder nota voor
  //     altijd weg, ook voor de kaarten die er wél een hebben.
  let uit = vorm.replace(
    new RegExp(`<!--${OPTIONEEL}\\s?([^]*?)\\s?${OPTIONEEL}-->`, 'g'), '$1');

  // 1 · het nagetekende scherm dat bij deze stap hoort. Dit moet VÓÓR alles
  //     wat volgt: het ingezette scherm draagt zelf een teller en een sleutel,
  //     en die horen daarna net zo recht gezet te worden als de rest van de
  //     kopie. De schermen worden alleen verplaatst, nooit gegenereerd — zo
  //     blijven de vier tekeningen met hun op elkaar sluitende cijfers precies
  //     zoals een mens ze gezet heeft.
  if (schermen) {
    const el = elementMet(uit, 'data-herhaal-scherm');
    if (el) {
      const sleutel = el.waarde.replace(new RegExp(`^${lijst}\\.\\d+\\.`), `${lijst}.${nr}.`);
      const naam = velden ? velden.get(sleutel) : null;
      if (typeof naam !== 'string' || !schermen.has(naam)) {
        stop(`"${sleutel}" noemt het scherm "${naam}", en dat bestaat niet. De schermen ` +
             `die er zijn: ${[...schermen.keys()].join(', ')}. Elke stap van de ` +
             'rondleiding hoort bij één nagetekend scherm; een stap zonder scherm is ' +
             'een lege kolom op desktop.');
      }
      // Het scherm komt uit de bank met de nummers van zijn vorige plaats erin.
      // Die worden hier op 1 gezet, zodat stap 2 ze samen met de rest van de
      // kopie in één keer op het juiste nummer zet.
      const schoon = schermen.get(naam)
        .replace(new RegExp(`${lijst.replace(/\./g, '\\.')}\\.\\d+\\.`, 'g'), `${lijst}.1.`);
      uit = vervang(uit, el.tagStart, el.elementEinde, schoon);
    }
  }

  // 2 · de sleutels: items.1.x wordt items.<nr>.x. Alleen binnen een kenmerk
  //     dat een sleutel draagt, zodat een "cases.items.1." die ergens in gewone
  //     tekst zou staan niet stil meeverandert.
  uit = uit.replace(SLEUTELKENMERK, (heel, waarde) => {
    const nieuw = waarde.split(`${lijst}.1.`).join(`${lijst}.${nr}.`);
    return nieuw === waarde ? heel : heel.replace(waarde, nieuw);
  });

  // 3 · het nummer als tekst (01, 02, …)
  {
    const el = elementMet(uit, 'data-herhaal-nr');
    if (el) {
      const cijfers = Number(el.waarde) || 1;
      uit = vervang(uit, el.binnenStart, el.binnenEinde, String(nr).padStart(cijfers, '0'));
    }
  }

  // 4 · de teller "2 / 4"
  {
    const el = elementMet(uit, 'data-herhaal-teller');
    if (el) uit = vervang(uit, el.binnenStart, el.binnenEinde, `${nr} / ${totaal}`);
  }

  // 5 · de breedte in het raster
  if (span !== null) {
    const el = elementMet(uit, 'data-herhaal-span');
    if (el) {
      uit = metKlassen(uit, el, (k) => {
        if (!/lg:col-span-\d+/.test(k)) {
          stop('data-herhaal-span staat op een element zonder lg:col-span-… in zijn ' +
               'klassen. De bouw past een bestaande klasse aan; hij voegt er geen toe.');
        }
        return k.replace(/lg:col-span-\d+/, `lg:col-span-${span}`);
      });
    }
  }

  // 6 · de klassen die alleen op het eerste item horen
  {
    const el = elementMet(uit, 'data-herhaal-eerste');
    if (el && nr !== 1) {
      const weg = el.waarde.split(/\s+/).filter(Boolean);
      uit = metKlassen(uit, el, (k) => k.split(/\s+/).filter((c) => c && !weg.includes(c)).join(' '));
    }
  }

  // 7 · een element dat niets te zeggen heeft bij dit item
  while (true) {
    const el = elementMet(uit, 'data-herhaal-weg-als-leeg');
    if (!el) break;
    const waarde = velden ? velden.get(el.waarde) : null;
    const heeftIets = typeof waarde === 'string' && waarde.trim() !== '';
    // Het kenmerk tijdelijk omdopen, want anders vindt de volgende ronde van
    // deze lus hetzelfde element opnieuw.
    uit = vervang(uit, el.kenmerkStart, el.kenmerkEinde, ` ${GEDAAN}="${el.waarde}"`);
    if (heeftIets) continue;
    const opnieuw = elementMet(uit, GEDAAN);
    uit = vervang(uit, opnieuw.tagStart, opnieuw.elementEinde,
                  `<!--${OPTIONEEL} ${uit.slice(opnieuw.tagStart, opnieuw.elementEinde)} ${OPTIONEEL}-->`);
  }
  uit = uit.split(`${GEDAAN}="`).join('data-herhaal-weg-als-leeg="');

  return uit;
}

/**
 * De sleutels die de pagina gebruikt zonder dat er een slot voor is: vandaag
 * alleen `scherm`, dat een tekening kiest in plaats van tekst te plaatsen.
 * Zonder deze lijst zou de bouw ze als "veld dat nergens staat" weigeren — en
 * dat is juist de controle die hier moet blijven werken.
 */
export function herhaalSleutels(html) {
  const uit = new Set();
  for (const m of html.matchAll(/data-herhaal-scherm="([^"]*)"/g)) uit.add(m[1]);
  return uit;
}

/** Het aantal logo's in de stylesheet, waar de duur van de marquee het uit leest. */
export function zetLogoAantal(html, aantal) {
  const begin = '/* LOGO-AANTAL:BEGIN';
  const einde = '/* LOGO-AANTAL:EINDE */';
  const a = html.indexOf(begin);
  const b = html.indexOf(einde, a);
  if (a === -1 || b === -1) {
    stop('de markering LOGO-AANTAL:BEGIN/EINDE staat niet in de stylesheet van de pagina. ' +
         'Zonder die regel rekent de marquee met het aantal van vorige maand en loopt ze ' +
         'op een ander tempo dan de 15,9 px/s die de briefing voorschrijft.');
  }
  const naBegin = html.indexOf('*/', a) + 2;
  return html.slice(0, naBegin) +
         `\n  .logo-balk { --logo-n: ${aantal}; }\n  ` +
         html.slice(b);
}

/**
 * De schermenbank van de rondleiding: elk nagetekend scherm uit de pagina,
 * onder de naam die het zelf draagt (data-scherm="overzicht"). Ze worden
 * alleen verplaatst, nooit herschreven — zo blijven de vier tekeningen met
 * hun sluitende cijfers precies zoals een mens ze gezet heeft.
 */
export function schermenbank(ruwFragment) {
  // Een scherm van een stap die Jana weggehaald heeft, staat in de pagina
  // geparkeerd tussen commentaartekens. Dat is met opzet en niet uit
  // zuinigheid: de vier tekeningen zijn samen 20 kB, en ze als onzichtbare
  // <template> dubbel in de pagina zetten zou elke bezoeker 9% meer HTML
  // kosten voor markup die niemand ziet. Geparkeerd kost het niets zolang
  // alle vier in gebruik zijn, en het kan terugkomen.
  const fragment = ruwFragment.replace(
    new RegExp(`<!--${OPTIONEEL}\\s?([^]*?)\\s?${OPTIONEEL}-->`, 'g'), '$1');
  const bank = new Map();
  let vanaf = 0;
  while (true) {
    const el = elementMet(fragment, 'data-scherm', vanaf);
    if (!el) break;
    if (bank.has(el.waarde)) {
      stop(`twee nagetekende schermen heten "${el.waarde}". Dan kiest de bouw er stil ` +
           'één van, en toont een stap het scherm van een andere.');
    }
    bank.set(el.waarde, fragment.slice(el.tagStart, el.elementEinde));
    vanaf = el.elementEinde;
  }
  return bank;
}

/**
 * Elke gemarkeerde lijst in de pagina uitgeklapt naar het aantal items dat in
 * content/ staat. Geeft de nieuwe HTML terug; de slots erin worden daarna door
 * vindSlots()/voegIn() gevuld, net als bij de vaste velden — er is dus maar één
 * plek die weet hoe een veld in de pagina komt.
 */
export function herhaal(html, lijsten, velden = null, { negeerOnbekend = false } = {}) {
  const stukken = vindHerhalingen(html);
  if (!stukken.length) return html;

  const gezien = new Set();
  // Van achter naar voren, zodat de posities van de nog te doen stukken kloppen.
  for (const stuk of [...stukken].reverse()) {
    const aantal = lijsten.get(stuk.lijst);
    if (aantal === undefined) {
      // `negeerOnbekend` is er voor het voorbeeldvenster: dat heeft maar één
      // bestand in het formulier staan, dus kent het de lijsten van de andere
      // twee niet. Zo'n stuk blijft dan staan zoals het in de pagina staat, en
      // dat is juist — Jana beheert dat blok hier niet. De BOUW laat dit nooit
      // toe: daar betekent een gemarkeerde lijst zonder bron dat er iets
      // ontbreekt, en dan hoort de publicatie te stoppen.
      if (negeerOnbekend) continue;
      stop(`de pagina markeert een lijst "${stuk.lijst}", maar in content/ staat geen lijst ` +
           'met die naam. Zet de items eronder met streepjes, of haal de markering weg.');
    }
    const bezwaar = bezwaarTegenLengte(stuk.lijst, aantal);
    if (bezwaar) stop(bezwaar);
    gezien.add(stuk.lijst);

    const fragment = html.slice(stuk.binnenStart, stuk.binnenEinde);
    const vorm = eersteElement(fragment, stuk.lijst);
    const vormTekst = fragment.slice(vorm.start, vorm.einde);
    // De inspringing van de vorm zelf, en niet die van de markering: zo houdt
    // elke kopie dezelfde diepte als het stuk HTML dat een mens geschreven
    // heeft, en verschuift de pagina niet bij elke bouw.
    const vormDiep = vorm.start - (fragment.lastIndexOf('\n', vorm.start - 1) + 1);
    const schermen = vormTekst.includes('data-herhaal-scherm')
      ? schermenbank(fragment) : null;
    const spans = stuk.lijst === 'cases.items' ? kaartspans(aantal) : null;

    const binnen = ' '.repeat(vormDiep);
    const kopieen = [];
    for (let nr = 1; nr <= aantal; nr++) {
      kopieen.push(kopie(vormTekst, {
        lijst: stuk.lijst, nr, totaal: aantal, velden,
        span: spans ? spans[nr - 1] : null, schermen,
      }));
    }

    // De tekeningen die bij geen enkele stap meer horen, blijven geparkeerd in
    // de pagina staan. Zonder dit zou één weggehaalde stap de tekening voor
    // altijd meenemen, en is "een stap weghalen" in de praktijk een
    // onherstelbare handeling in een CMS.
    if (schermen) {
      const gebruikt = new Set();
      for (let nr = 1; nr <= aantal; nr++) {
        const naam = velden.get(`${stuk.lijst}.${nr}.scherm`);
        if (gebruikt.has(naam)) {
          stop(`twee stappen van de rondleiding kiezen hetzelfde scherm ("${naam}"). ` +
               'Elk van de vier tekeningen hoort bij één stap: de cijfers erin sluiten op ' +
               'elkaar aan, dus twee keer hetzelfde scherm laat de rondleiding een stap ' +
               'overslaan en een andere twee keer vertellen.');
        }
        gebruikt.add(naam);
      }
      for (const [naam, markup] of schermen) {
        if (gebruikt.has(naam)) continue;
        kopieen.push(`<!--${OPTIONEEL} ${markup} ${OPTIONEEL}-->`);
      }
    }

    const nieuw = `\n${binnen}${kopieen.join(`\n\n${binnen}`)}\n${' '.repeat(stuk.inspringing)}`;
    html = vervang(html, stuk.binnenStart, stuk.binnenEinde, nieuw);
  }

  // Het tempo van de logobalk hangt af van HOEVEEL logo's er staan — zie de
  // toelichting in de stylesheet. Dus zet de bouw dat aantal in de CSS; anders
  // is er precies één aantal waarbij de balk op de voorgeschreven 15,9 px/s
  // loopt, en verzet een logo erbij of eraf het tempo stil.
  if (lijsten.has('logobalk.logos')) {
    html = zetLogoAantal(html, lijsten.get('logobalk.logos'));
  }

  for (const lijst of lijsten.keys()) {
    if (!gezien.has(lijst)) {
      stop(`in content/ staat een lijst "${lijst}", maar de pagina markeert die nergens. ` +
           'Een lijst die de bouw negeert, is een lijst die Jana vult zonder dat het ' +
           'ergens terechtkomt.');
    }
  }
  return html;
}

/* ----------------------------------------------------------------- sleutels --- */

/* Een vaste vorm met een veld erin:
   data-inhoud-aria-label="Ga naar stap {nummer:rondleiding.stappen.1.titel}: {rondleiding.stappen.1.titel}"

   Vier bewerkingen mogen voor de sleutel staan. Drie ervan lezen de WAARDE
   niet maar het NUMMER van het item uit de sleutel zelf, en dat is de hele
   truc: het nummer in de sleutel wordt bij het kopiëren toch al bijgewerkt, dus
   blijft zo'n vorm na een bouw bestaan. Een letterlijk nummer in het sjabloon
   zou bij de eerste bouw in de vorm vastgebakken worden, en dan draagt elke
   kopie het nummer van de eerste. */
const SJABLOON = /\{(?:(slug|nummer|nummer0|eerste):)?([A-Za-z_][A-Za-z0-9_.-]*)\}/g;

const nummerIn = (sleutel) => {
  const m = /\.(\d+)\./.exec(sleutel);
  if (!m) {
    stop(`"${sleutel}" draagt geen itemnummer, dus valt er geen nummer uit te lezen. ` +
         'Deze bewerking hoort bij een veld in een lijst.');
  }
  return Number(m[1]);
};

const BEWERKINGEN = {
  slug: (waarde) => slug(waarde),
  nummer: (_, sleutel) => String(nummerIn(sleutel)),
  nummer0: (_, sleutel) => String(nummerIn(sleutel) - 1),
  eerste: (_, sleutel) => (nummerIn(sleutel) === 1 ? 'true' : 'false'),
};

export function sleutelsVan(slot) {
  if (slot.soort === 'tekst' || !slot.waarde.includes('{')) return [slot.waarde];
  const uit = [];
  let m;
  SJABLOON.lastIndex = 0;
  while ((m = SJABLOON.exec(slot.waarde)) !== null) uit.push(m[2]);
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
  return slot.waarde.replace(SJABLOON, (_, bewerking, s) => {
    const waarde = velden.get(s);
    if (Array.isArray(waarde)) stop(`"${s}" is een opsomming en past niet in een vaste vorm`);
    return bewerking ? BEWERKINGEN[bewerking](waarde, s) : waarde;
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
