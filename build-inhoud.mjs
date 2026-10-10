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

import { leesYaml, vlak, vlakLijsten, YamlFout } from './lees-yaml.js';
import {
  bezwaren, herhaal, InhoudFout, sleutelsVan, vindSlots, voegIn,
} from './inhoud-opmaak.js';

// vindSlots stond hier tot 2026-10-09 en staat nu in inhoud-opmaak.js, samen
// met het invoegen zelf: sinds het voorbeeldvenster van /beheer/ elk blok van
// de pagina toont, zijn er twee lezers van die regels en mag er maar één
// waarheid over zijn. Zie de kop van inhoud-opmaak.js. Het blijft hier
// doorgegeven omdat toets-inhoud.mjs het van deze module verwacht.
export { vindSlots };

const hier = dirname(fileURLToPath(import.meta.url));

export const BRONNEN = ['pagina.yml', 'klanten.yml', 'contact.yml'];
const PAGINA = join(hier, 'draft-r3-01-definitief.html');

/* -------------------------------------------------------------- de pagina ---
   Het vinden van de data-inhoud-attributen en het invullen ervan staat in
   inhoud-opmaak.js — gedeeld met het voorbeeldvenster. Wat HIER blijft, is
   alles wat een bestandssysteem nodig heeft: de bronnen lezen, een verwijzing
   naar een bestand keuren, en de pagina wegschrijven. */

// De bestandscontrole die het voorbeeldvenster niet kan doen en de bouw wel.
const bestaat = (pad) => existsSync(join(hier, pad));

function stop(bericht) {
  console.error('STOP — ' + bericht);
  process.exit(1);
}

/* ------------------------------------------------------------------ bronnen --- */

export function leesBronnen(map = join(hier, 'content')) {
  const velden = new Map();
  const herkomst = new Map();
  const lijsten = new Map();
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
    for (const [sleutel, aantal] of vlakLijsten(groep)) lijsten.set(sleutel, aantal);
  }
  return { velden, herkomst, lijsten };
}

export function keurBronnen(velden) {
  const fouten = [];
  for (const [sleutel, waarde] of velden) fouten.push(...bezwaren(sleutel, waarde));
  if (fouten.length) {
    stop(`de inhoudsbestanden zijn niet in orde:\n\n  · ${fouten.join('\n  · ')}\n`);
  }
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

export function bouwInhoud(opties = {}) {
  // inhoud-opmaak.js gooit een InhoudFout in plaats van af te sluiten, want het
  // voorbeeldvenster deelt die code en mag de beheerpagina niet neerhalen. Hier
  // is afsluiten juist wél de bedoeling: een bouw die doorloopt na een fout in
  // de inhoud, publiceert een halve pagina.
  try {
    return bouwenEcht(opties);
  } catch (e) {
    if (e instanceof InhoudFout) stop(e.message);
    throw e;
  }
}

function bouwenEcht({ check = false, proef = false } = {}) {
  const { velden, lijsten } = leesBronnen();
  keurBronnen(velden);

  if (!existsSync(PAGINA)) stop('draft-r3-01-definitief.html ontbreekt');
  const was = readFileSync(PAGINA, 'utf8');

  // Eerst de lijsten uitklappen, dan de velden invullen. In die volgorde, want
  // de slots van kaart 4 bestaan pas nadat kaart 4 er staat. De grenzen per
  // lijst zitten in herhaal(): een zesde quote stopt de bouw hier, niet
  // halverwege een pagina die al half geschreven is.
  const uitgeklapt = herhaal(was, lijsten, velden);

  const slots = vindSlots(uitgeklapt);
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

  const wordt = voegIn(uitgeklapt, slots, velden, { bestaat });

  const tekstslots = slots.filter((s) => s.soort === 'tekst').length;
  const lijstTelling = [...lijsten].map(([l, n]) => `${l.split('.')[0]} ${n}`).join(', ');
  const samenvatting = `${velden.size} veld(en) uit ${BRONNEN.length} bestanden · ` +
                       `${tekstslots} stuk(ken) tekst en ${slots.length - tekstslots} attribu(u)t(en) in de pagina` +
                       (lijstTelling ? ` · lijsten: ${lijstTelling}` : '');

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
    try {
      for (const [sleutel, waarde] of dump(html, vindSlots(html))) {
        console.log(`${sleutel}\t${JSON.stringify(waarde)}`);
      }
    } catch (e) {
      if (e instanceof InhoudFout) stop(e.message);
      throw e;
    }
  } else {
    bouwInhoud({
      check: process.argv.includes('--check'),
      proef: process.argv.includes('--dry-run'),
    });
  }
}

export { PAGINA };
