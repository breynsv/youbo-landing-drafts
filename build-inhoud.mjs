#!/usr/bin/env node
/**
 * Zet de tekst van draft-r3-01-definitief.html in de pagina, uit
 * content/pagina.yml, content/klanten.yml en content/contact.yml.
 *
 *     node build-inhoud.mjs            # schrijft de tekst in de pagina
 *     node build-inhoud.mjs --check    # zegt alleen of de pagina nog overeenkomt
 *     node build-inhoud.mjs --dry-run  # zegt wat het zou doen, schrijft niets
 *     node build-inhoud.mjs --dump     # schrijft de tekst die NU in de pagina staat
 *
 * WAAROM DIT BESTAAT
 *
 * Tot 2026-10-09 kwam alleen de FAQ uit een bestand; de rest van de pagina was
 * met de hand getypte HTML, en de marketeer kon geen woord veranderen zonder de
 * ontwikkelaar. Dit script doet voor de negen andere blokken wat build-faq.mjs
 * voor de FAQ doet.
 *
 * WAAROM GEEN MARKERINGEN ZOALS BIJ DE FAQ, MAAR EEN ATTRIBUUT
 *
 * Dit is de enige plek waar dit script van het FAQ-patroon afwijkt, dus staat
 * de reden hier voluit.
 *
 * Een markeringspaar (FAQ-LIJST:BEGIN/EINDE) bakent een stuk HTML af dat
 * helemaal gegenereerd wordt. Dat past bij de FAQ: zes keer dezelfde vorm, dus
 * is die vorm code. De negen andere blokken zijn negen verschillende vormen met
 * nagetekende productschermen erin, en wat daar verandert is niet het blok maar
 * één woord erbinnen: een kop, een knoplabel, een getal. Een markeringspaar per
 * woord zou ±140 paren in deze pagina zetten en het ontwerp onder de
 * boekhouding bedelven — en, erger, de vorm van die blokken van de HTML naar
 * een JavaScript-bestand verhuizen, waar een ontwerper er niet meer bij kan.
 *
 * Dus staat er in de HTML een attribuut dat zegt welk veld hier hoort:
 *
 *     <h1 class="text-h1" data-inhoud="hero.kop">Compensatie zonder kopzorgen</h1>
 *     <img src="…" alt="Kaneka" data-inhoud-alt="cases.kaart_1.bedrijf">
 *     <a href="#cases-open" data-inhoud-href="cases.kaart_1.downloadlink">…</a>
 *
 * De vorm blijft dus in de HTML staan, de woorden komen uit content/. Het
 * attribuut is tegelijk het anker van `--check`: de bouw zet de waarde er
 * opnieuw in en vergelijkt. Alles wat van het FAQ-patroon de bedoeling was,
 * blijft gelijk: platte tekst zonder HTML, één gedeelde opmaakmodule
 * (inhoud-opmaak.js) voor de bouw én het voorbeeldvenster, invoegen bij de
 * bouw en niet in de browser, een `--check`, en één bouwcommando.
 *
 * DRIE SOORTEN ATTRIBUUT
 *
 *   data-inhoud="sleutel"              de tekst BINNEN dit element
 *   data-inhoud-<kenmerk>="sleutel"    de waarde van dat attribuut (alt, src,
 *                                      href, placeholder, content, …)
 *   data-inhoud-<kenmerk>="… {sleutel} …"
 *                                      hetzelfde, maar met de tekst in een
 *                                      vaste vorm gezet. Zo blijft
 *                                      aria-label="Ga naar stap 1: <kop>" van
 *                                      de rondleiding meelopen met de kop die
 *                                      ernaast op de pagina staat, zonder dat
 *                                      iemand dezelfde woorden twee keer typt.
 *
 * WAAROM BIJ DE BOUW EN NIET IN DE BROWSER
 *
 * 57 van de 81 pagina's van deze klant zijn zonder JavaScript onzichtbaar. Een
 * pagina die haar eigen koppen in de browser samenstelt, maakt dat probleem
 * groter: geen tekst voor een crawler, geen tekst zonder JavaScript. Dus
 * gebeurt het hier, vóór publicatie, en staat het resultaat gewoon in het
 * bestand — net als bij de FAQ, en om precies dezelfde reden.
 *
 * WAAROM HET AAN stamp-version.mjs HANGT
 *
 * Cloudflare Pages draait één build command: `node stamp-version.mjs`. Dat
 * script roept dit script aan. Een tweede build command dat iemand in het
 * dashboard had moeten instellen, is een build command dat ooit niet ingesteld
 * is — en dan publiceert de pagina stilletjes de tekst van vorige maand.
 */
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leesYaml, vlak, YamlFout } from './lees-yaml.js';
import { bezwaren, cijferlijstHtml, kenmerkHtml, tekstHtml } from './inhoud-opmaak.js';

const hier = dirname(fileURLToPath(import.meta.url));

export const BRONNEN = ['pagina.yml', 'klanten.yml', 'contact.yml'];
const PAGINA = join(hier, 'draft-r3-01-definitief.html');

// Elementen zonder inhoud. Voor die mag er alleen een kenmerkslot op staan;
// `data-inhoud` erop zou vragen om tekst in een element te zetten dat er geen
// heeft, en dat is een typefout die je niet pas op de pagina wil zien.
const LEEG = new Set(['img', 'meta', 'link', 'input', 'br', 'hr', 'source', 'area',
                      'base', 'col', 'embed', 'param', 'track', 'wbr']);

// Welke waarden in een href of src als een verwijzing naar een bestand van deze
// site gelezen worden. De rest is een anker, een ander protocol of een andere
// site, en die controleren we niet — net als publiceer.mjs.
const EIGEN_PROTOCOL = /^(https?:|mailto:|tel:|#|\/\/)/i;
const VERDACHT_PROTOCOL = /^\s*(javascript|data|vbscript)\s*:/i;

function stop(bericht) {
  console.error('STOP — ' + bericht);
  process.exit(1);
}

/* ------------------------------------------------------------------ bronnen --- */

export function leesBronnen(map = join(hier, 'content')) {
  const velden = new Map();
  const herkomst = new Map();
  for (const naam of BRONNEN) {
    const pad = join(map, naam);
    if (!existsSync(pad)) {
      stop(`content/${naam} ontbreekt — zonder bron is er geen tekst voor de pagina`);
    }
    let groep;
    try {
      groep = leesYaml(readFileSync(pad, 'utf8'), `content/${naam}`);
    } catch (e) {
      if (e instanceof YamlFout) stop(e.message);
      throw e;
    }
    for (const [sleutel, waarde] of vlak(groep)) {
      if (velden.has(sleutel)) {
        stop(`"${sleutel}" staat in content/${naam} én in content/${herkomst.get(sleutel)}. ` +
             'Twee bestanden die hetzelfde veld beweren te beheren, is één bestand dat ' +
             'de ander stil overschrijft.');
      }
      velden.set(sleutel, waarde);
      herkomst.set(sleutel, naam);
    }
  }
  return { velden, herkomst };
}

export function keurBronnen(velden) {
  const fouten = [];
  for (const [sleutel, waarde] of velden) fouten.push(...bezwaren(sleutel, waarde));
  if (fouten.length) {
    stop(`de inhoudsbestanden zijn niet in orde:\n\n  · ${fouten.join('\n  · ')}\n`);
  }
}

/* -------------------------------------------------------------- de pagina ---
   Een kleine, opzettelijk letterlijke lezer: hij zoekt de attributen en de
   grenzen van het element waar ze op staan, en verder niets. Geen DOM-model,
   want dit script schrijft HTML terug en moet dus elke byte eromheen
   onaangeroerd laten. */

function inCommentaar(html, index) {
  const open = html.lastIndexOf('<!--', index);
  if (open === -1) return false;
  const sluit = html.indexOf('-->', open);
  return sluit === -1 || sluit > index;
}

function eindeStarttag(html, start) {
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
function eindeElement(html, tag, na) {
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

/* ----------------------------------------------------------------- sleutels --- */

const SJABLOON = /\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g;

function sleutelsVan(slot) {
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

function tekstVoorSlot(slot, waarde) {
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

function kenmerkVoorSlot(slot, velden) {
  if (!slot.waarde.includes('{')) {
    const waarde = velden.get(slot.waarde);
    if (Array.isArray(waarde)) {
      stop(`"${slot.waarde}" is een opsomming en kan niet in het attribuut ` +
           `${slot.kenmerk} van een <${slot.tag}> staan`);
    }
    return kenmerkHtml(waarde);
  }
  return kenmerkHtml(slot.waarde.replace(SJABLOON, (_, s) => {
    const waarde = velden.get(s);
    if (Array.isArray(waarde)) stop(`"${s}" is een opsomming en past niet in een vaste vorm`);
    return waarde;
  }));
}

function keurVerwijzing(slot, waarde) {
  if (!(slot.kenmerk === 'href' || slot.kenmerk === 'src')) return;
  if (VERDACHT_PROTOCOL.test(waarde)) {
    stop(`"${slot.waarde}" wijst naar "${waarde}". Een ${waarde.split(':')[0]}:-adres uit een ` +
         'invulveld is een lek, niet een link.');
  }
  if (EIGEN_PROTOCOL.test(waarde)) return;
  const pad = join(hier, waarde.replace(/^\/+/, '').split(/[?#]/)[0]);
  if (!existsSync(pad)) {
    stop(`ontbrekend bestand: ${waarde}\n        genoemd door "${slot.waarde}" ` +
         `(het ${slot.kenmerk} van een <${slot.tag}>). Een verwijzing naar een bestand ` +
         'dat er niet is, wordt op de site een gebroken plaatje of een dode link — ' +
         'dus stopt de bouw hier, net als publiceer.mjs dat doet.');
  }
}

function voegIn(html, slots, velden) {
  const bewerkingen = [];
  for (const slot of slots) {
    if (slot.soort === 'tekst') {
      bewerkingen.push([slot.binnenStart, slot.binnenEinde, tekstVoorSlot(slot, velden.get(slot.waarde))]);
    } else {
      const nieuw = kenmerkVoorSlot(slot, velden);
      keurVerwijzing(slot, nieuw);
      bewerkingen.push([slot.kenmerkStart, slot.kenmerkEinde, nieuw]);
    }
  }
  bewerkingen.sort((a, b) => b[0] - a[0]);
  let uit = html;
  for (const [a, b, tekst] of bewerkingen) uit = uit.slice(0, a) + tekst + uit.slice(b);
  return uit;
}

/* --------------------------------------------------------------------- dump ---
   Leest terug wat er NU in de pagina staat, in de vorm waarin het in
   content/*.yml hoort. Niet voor de bouw: dit is het gereedschap waarmee de
   drie bestanden in één keer uit de bestaande pagina gehaald zijn, zodat er
   geen woord overgetypt is en er dus ook geen woord kan verschillen. */

const ENTITEITEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ', minus: '−' };
const ontsnapTerug = (s) => s.replace(/&([a-z]+|#\d+);/gi, (heel, e) => ENTITEITEN[e.toLowerCase()] ?? heel);
const zonderTags = (s) => ontsnapTerug(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

export function dump(html, slots) {
  const uit = [];
  for (const slot of slots) {
    if (slot.soort === 'kenmerk') {
      if (slot.waarde.includes('{')) continue;
      uit.push([slot.waarde, ontsnapTerug(slot.huidig)]);
      continue;
    }
    const binnen = html.slice(slot.binnenStart, slot.binnenEinde);
    if (/<li\b/.test(binnen)) {
      const regels = [...binnen.matchAll(/<span class="tabular">([\s\S]*?)<\/span>/g)].map((m) => zonderTags(m[1]));
      uit.push([slot.waarde, regels]);
    } else {
      uit.push([slot.waarde, zonderTags(binnen)]);
    }
  }
  return uit;
}

/* --------------------------------------------------------------------- bouw --- */

export function bouwInhoud({ check = false, proef = false } = {}) {
  const { velden } = leesBronnen();
  keurBronnen(velden);

  if (!existsSync(PAGINA)) stop('draft-r3-01-definitief.html ontbreekt');
  const was = readFileSync(PAGINA, 'utf8');
  const slots = vindSlots(was);
  if (!slots.length) {
    stop('geen enkel data-inhoud-attribuut in draft-r3-01-definitief.html — ' +
         'dan zet deze bouwstap niets in de pagina en zou ze stil niets doen');
  }

  const gebruikt = new Set();
  for (const slot of slots) {
    for (const sleutel of sleutelsVan(slot)) {
      if (!velden.has(sleutel)) {
        stop(`de pagina vraagt om "${sleutel}" (${slot.soort === 'tekst' ? 'de tekst van' : `het ${slot.kenmerk} van`} ` +
             `een <${slot.tag}>), maar dat veld staat in geen van de drie inhoudsbestanden.`);
      }
      gebruikt.add(sleutel);
    }
  }
  const ongebruikt = [...velden.keys()].filter((s) => !gebruikt.has(s));
  if (ongebruikt.length) {
    stop(`deze velden staan in content/ maar nergens in de pagina: ${ongebruikt.join(', ')}. ` +
         'Een veld dat de bouw negeert, is een veld dat iemand invult zonder dat het ' +
         'ergens terechtkomt — dat is erger dan geen veld.');
  }

  const wordt = voegIn(was, slots, velden);

  const tekstslots = slots.filter((s) => s.soort === 'tekst').length;
  const samenvatting = `${velden.size} veld(en) uit ${BRONNEN.length} bestanden · ` +
                       `${tekstslots} stuk(ken) tekst en ${slots.length - tekstslots} attribu(u)t(en) in de pagina`;

  if (check) {
    if (wordt !== was) {
      stop('draft-r3-01-definitief.html komt niet overeen met de inhoudsbestanden. ' +
           'Draai `node build-inhoud.mjs` en commit het resultaat.');
    }
    console.log(`Inhoud in orde — ${samenvatting}`);
    return { gewijzigd: false, velden: velden.size, slots: slots.length };
  }

  const gewijzigd = wordt !== was;
  if (!proef && gewijzigd) writeFileSync(PAGINA, wordt);
  console.log(`${proef ? '(proef) ' : ''}Inhoud gebouwd: ${samenvatting}${gewijzigd ? '' : ' (ongewijzigd)'}`);
  return { gewijzigd, velden: velden.size, slots: slots.length };
}

// realpathSync, en niet een vergelijking van de twee paden zoals ze binnenkomen:
// de ESM-lader geeft import.meta.url al met symlinks opgelost terug, terwijl
// argv[1] staat zoals het getypt is. Op macOS is /var een symlink naar
// /private/var, dus liep dit script in een wegwerpmap onder /tmp stil niets te
// doen en gaf het afsluitcode 0 — een bouwstap die zwijgt en slaagt is precies
// het soort stilte waar deze hele opzet tegen bedoeld is. Gevonden doordat
// toets-inhoud.mjs er acht keer rood op ging.
const alsHoofdprogramma = process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (alsHoofdprogramma) {
  if (process.argv.includes('--dump')) {
    const html = readFileSync(PAGINA, 'utf8');
    for (const [sleutel, waarde] of dump(html, vindSlots(html))) {
      console.log(`${sleutel}\t${JSON.stringify(waarde)}`);
    }
  } else {
    bouwInhoud({
      check: process.argv.includes('--check'),
      proef: process.argv.includes('--dry-run'),
    });
  }
}

export { PAGINA };
