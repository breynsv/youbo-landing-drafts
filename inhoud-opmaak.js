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
