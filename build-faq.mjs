#!/usr/bin/env node
/**
 * Bouwt de FAQ van draft-r3-01-definitief.html uit content/faq.yml.
 *
 *     node build-faq.mjs            # schrijft de FAQ in de pagina
 *     node build-faq.mjs --check    # zegt alleen of de pagina nog overeenkomt
 *     node build-faq.mjs --dry-run  # zegt wat het zou doen, schrijft niets
 *
 * WAAROM DIT BESTAAT
 *
 * De pagina was met de hand getypte HTML zonder inhoudslaag: de marketeer kon
 * geen woord veranderen zonder de ontwikkelaar. Haar FAQ-antwoorden zijn het
 * enige dat de oplevering nog tegenhoudt, dus is de FAQ het stuk dat eerst een
 * bron buiten de HTML krijgt. Alleen de FAQ — de cases, de quotes en de hero
 * blijven voorlopig HTML, want dit is een proef en geen verbouwing.
 *
 * WAAROM BIJ DE BOUW EN NIET IN DE BROWSER
 *
 * De zwaarste bevinding van de site-audit was dat 57 van de 81 pagina's zonder
 * JavaScript leeg zijn. Een FAQ die in de browser uit een YAML-bestand wordt
 * samengesteld, maakt dat probleem groter: geen tekst voor een crawler, geen
 * tekst zonder JavaScript, en de FAQPage-structuurdata zou dan over inhoud gaan
 * die in de HTML niet bestaat. Dus gebeurt het hier, vóór publicatie, en staat
 * het resultaat gewoon in het bestand.
 *
 * WAAROM HET AAN stamp-version.mjs HANGT
 *
 * Cloudflare Pages draait één build command: `node stamp-version.mjs`. Dat
 * script roept dit script aan. Zo is er niets in het dashboard te veranderen en
 * — belangrijker — niets te vergeten. Een tweede build command die iemand had
 * moeten instellen, is een build command die ooit niet ingesteld is, en dan
 * publiceert de pagina stilletjes de FAQ van vorige maand. Dezelfde reden
 * waarom de versiestempel een build command is en geen handeling.
 *
 * WAAROM DE GEBOUWDE HTML IN GIT STAAT
 *
 * Deze repo heeft twee uitgevers: Cloudflare Pages bouwt, maar GitHub Pages
 * serveert `draft-r3-01-definitief.html` rechtstreeks uit git, zonder build.
 * Zou in git een plaatshouder staan, dan had GitHub Pages een pagina zonder
 * FAQ. Dus staat het gebouwde resultaat gecommit, en is `--check` er om te
 * bewijzen dat het nog overeenkomt met content/faq.yml.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// De opmaak — hoe een vraag en een antwoord HTML worden — staat sinds
// 2026-10-09 in faq-opmaak.js. Niet om dit bestand korter te maken, maar omdat
// het voorbeeldvenster in /beheer/ dezelfde functies in de browser gebruikt.
// Eén bron voor die HTML, dus kan het voorbeeld niet uiteenlopen met de pagina.
// Lezen, keuren en wegschrijven blijven hier.
import { TODO_ALINEA, alineasUitTekst, ctas, lijstHtml } from './faq-opmaak.js';

const hier = dirname(fileURLToPath(import.meta.url));

const BRON   = join(hier, 'content', 'faq.yml');
const PAGINA = join(hier, 'draft-r3-01-definitief.html');

const UITLEG = 'gegenereerd uit content/faq.yml door build-faq.mjs — met de hand aanpassen heeft geen zin';
const LIJST_BEGIN  = `    <!-- FAQ-LIJST:BEGIN — ${UITLEG} -->`;
const LIJST_EINDE  = '    <!-- FAQ-LIJST:EINDE -->';
const JSONLD_BEGIN = `<!-- FAQ-JSONLD:BEGIN — ${UITLEG} -->`;
const JSONLD_EINDE = '<!-- FAQ-JSONLD:EINDE -->';



function stop(bericht) {
  console.error('STOP — ' + bericht);
  process.exit(1);
}

/* ------------------------------------------------------------------ YAML ---
   Een opzettelijk kleine lezer voor precies de afgesproken vorm, en niet voor
   YAML in het algemeen. Hij weigert alles wat hij niet met zekerheid begrijpt,
   in plaats van te gokken: een gok op inhoud van een invulveld is hier het
   enige wat echt mis kan gaan. Een echte YAML-afhankelijkheid zou de eerste
   npm-afhankelijkheid van deze repo zijn naast playwright, en Cloudflare bouwt
   met SKIP_DEPENDENCY_INSTALL=1 — er is daar dus geen node_modules. */

const isLeeg = (r) => r.trim() === '';
const isCommentaar = (r) => /^\s*#/.test(r);
const inspringing = (r) => r.length - r.trimStart().length;

function schaal(ruw, regelnr) {
  const t = ruw.trim();
  if (t === '') stop(`content/faq.yml regel ${regelnr}: lege waarde`);
  if (t.startsWith('"')) {
    if (t.length < 2 || !t.endsWith('"')) stop(`content/faq.yml regel ${regelnr}: aanhalingsteken niet gesloten`);
    return t.slice(1, -1).replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', '"': '"', '\\': '\\' }[c] ?? c));
  }
  if (t.startsWith("'")) {
    if (t.length < 2 || !t.endsWith("'")) stop(`content/faq.yml regel ${regelnr}: aanhalingsteken niet gesloten`);
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (/\s#/.test(t)) {
    stop(`content/faq.yml regel ${regelnr}: een # midden in een waarde is in YAML het begin van ` +
         'commentaar. Zet de hele waarde tussen dubbele aanhalingstekens.');
  }
  return t;
}

// Blokschalen, en de twee vormen zijn NIET hetzelfde — dit is de hele reden dat
// deze lezer sinds 2026-10-09 beide kent.
//
//   ">" is gevouwen: YAML plakt opeenvolgende regels met een spatie aan elkaar,
//       en alleen een witregel is een alineagrens. Dat is de vorm waarin dit
//       bestand met de hand getypt is.
//   "|" is letterlijk: elke regelafbreking is een echte regelafbreking. Daar is
//       één regel dus één alinea, met of zonder witregel ertussen.
//
// Waarom dat verschil hier moet bestaan: Sveltia CMS leest dit bestand met een
// echte YAML-lezer en schrijft het daarna zelf terug. Een gevouwen blok met een
// witregel erin levert bij het lezen één "\n" op — geen twee — en het CMS zet
// dat terug als een letterlijk blok met twee regels zonder witregel ertussen.
// Zou "|" hier als gevouwen gelezen worden, dan plakte dit script die twee
// regels weer aan elkaar en verdween de alineagrens. Bij de prijsvraag betekende
// dat: geen geel TODO-kader meer, en — erger — de openstaande TODO-tekst als
// gepubliceerd antwoord in de FAQ-structuurdata voor Google. Zie SVELTIA.md.
//
// Een harde regelafbreking BINNEN een alinea bestaat nog steeds niet: die zou
// <br> vragen, en er mag geen HTML in de inhoud staan.
function blokAlineas(lijnen, letterlijk = false) {
  const gevuld = lijnen.filter((r) => !isLeeg(r));
  if (!gevuld.length) return [];
  const diepte = Math.min(...gevuld.map(inspringing));
  const kaal = lijnen.map((r) => (isLeeg(r) ? '' : r.slice(diepte)));
  if (letterlijk) return kaal.map((r) => r.trim()).filter((r) => r !== '');
  const alineas = [];
  let huidig = [];
  for (const r of kaal) {
    if (r === '') { if (huidig.length) { alineas.push(huidig.join(' ')); huidig = []; } }
    else huidig.push(r.trim());
  }
  if (huidig.length) alineas.push(huidig.join(' '));
  return alineas;
}

// Een blokaanduiding: "|" of ">", eventueel met een inspringingscijfer en/of een
// afkapteken, in beide volgordes ("|2-" en "|-2" zijn allebei geldig YAML).
const BLOKVORM = /^[|>](?:[1-9][-+]?|[-+][1-9]?)?$/;

// Geëxporteerd voor toets-faq-rondrit.mjs: die toets leest met déze lezer, en
// niet met een nabootsing ervan — anders bewijst ze iets over een kopie.
export function leesFaq(pad) {
  if (!existsSync(pad)) stop(`${relative(hier, pad)} ontbreekt — zonder bron is er geen FAQ`);
  const regels = readFileSync(pad, 'utf8').split('\n');
  let i = 0;
  const vooruit = () => { while (i < regels.length && (isLeeg(regels[i]) || isCommentaar(regels[i]))) i++; };

  vooruit();
  if (i >= regels.length || regels[i].trim() !== 'items:') {
    stop('content/faq.yml moet (na het commentaar) beginnen met een regel "items:" — dat is de afspraak met de CMS-kant');
  }
  i++;

  const items = [];

  while (true) {
    vooruit();
    if (i >= regels.length) break;
    const m = /^(\s*)-(\s+)(\S.*)$/.exec(regels[i]);
    if (!m) stop(`content/faq.yml regel ${i + 1}: verwacht een nieuw item dat met "- " begint, kreeg "${regels[i].trim()}"`);
    const streep = m[1].length;
    const diepte = streep + 1 + m[2].length;
    const blok = [[' '.repeat(diepte) + m[3], i + 1]];
    i++;
    while (i < regels.length) {
      if (isLeeg(regels[i])) { blok.push([regels[i], i + 1]); i++; continue; }
      if (inspringing(regels[i]) <= streep) break;
      blok.push([regels[i], i + 1]); i++;
    }
    while (blok.length && isLeeg(blok[blok.length - 1][0])) blok.pop();

    const item = {};
    let j = 0;
    while (j < blok.length) {
      const [r, nr] = blok[j];
      if (isLeeg(r) || isCommentaar(r)) { j++; continue; }
      if (inspringing(r) !== diepte) stop(`content/faq.yml regel ${nr}: onverwachte inspringing bij "${r.trim()}"`);
      const p = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(r.trim());
      if (!p) stop(`content/faq.yml regel ${nr}: verwacht "sleutel: waarde", kreeg "${r.trim()}"`);
      const sleutel = p[1];
      const rest = p[2].trim();
      if (sleutel in item) stop(`content/faq.yml regel ${nr}: "${sleutel}" staat twee keer in hetzelfde item`);
      if (BLOKVORM.test(rest)) {
        const lijnen = [];
        j++;
        while (j < blok.length) {
          const [rr] = blok[j];
          if (isLeeg(rr)) { lijnen.push(''); j++; continue; }
          if (inspringing(rr) <= diepte) break;
          lijnen.push(rr); j++;
        }
        item[sleutel] = blokAlineas(lijnen, rest[0] === '|');
      } else {
        item[sleutel] = alineasUitTekst(schaal(rest, nr));
        j++;
      }
      item[`${sleutel}@regel`] = nr;
    }
    items.push(item);
  }

  if (!items.length) stop('content/faq.yml bevat geen enkel item');
  return items;
}

/* -------------------------------------------------------------- nazicht --- */

export function keur(items) {
  const TOEGESTAAN = new Set(['vraag', 'antwoord']);
  const netjes = (a) => a.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s !== '');
  const uit = [];
  for (const [k, item] of items.entries()) {
    for (const sleutel of Object.keys(item)) {
      if (sleutel.endsWith('@regel')) continue;
      if (!TOEGESTAAN.has(sleutel)) {
        stop(`content/faq.yml item ${k + 1} (regel ${item[`${sleutel}@regel`]}) heeft een veld "${sleutel}". ` +
             'De afspraak is precies twee velden: vraag en antwoord. Een veld dat dit script negeert, ' +
             'is een veld dat iemand invult zonder dat het ergens terechtkomt.');
      }
    }
    if (!item.vraag) stop(`content/faq.yml item ${k + 1} heeft geen "vraag"`);
    if (!item.antwoord) stop(`content/faq.yml item ${k + 1} heeft geen "antwoord"`);
    const vraag = netjes(item.vraag);
    const antwoord = netjes(item.antwoord);
    if (vraag.length !== 1) stop(`content/faq.yml item ${k + 1}: "vraag" is één regel tekst, geen alinea's`);
    if (!antwoord.length) stop(`content/faq.yml item ${k + 1}: "antwoord" is leeg`);
    for (const tekst of [vraag[0], ...antwoord]) {
      if (tekst.includes('<')) {
        stop(`content/faq.yml item ${k + 1} bevat een "<". In dit bestand hoort geen HTML: ` +
             'tekst uit een invulveld die als HTML op de pagina belandt, is een lek. ' +
             'Alinea\'s maak je met een witregel.');
      }
    }
    uit.push({ vraag: vraag[0], alineas: antwoord });
  }
  const dubbel = uit.map((x) => x.vraag).filter((v, n, a) => a.indexOf(v) !== n);
  if (dubbel.length) stop(`content/faq.yml: dezelfde vraag staat twee keer — "${dubbel[0]}"`);
  return uit;
}


function jsonLdHtml(items) {
  const vragen = [];
  for (const item of items) {
    const echt = item.alineas.filter((t) => !TODO_ALINEA.test(t));
    if (echt.length !== item.alineas.length) continue;   // antwoord staat nog open
    vragen.push({
      '@type': 'Question',
      name: item.vraag,
      acceptedAnswer: { '@type': 'Answer', text: echt.join(' ') },
    });
  }
  if (!vragen.length) {
    console.log('  nota: geen enkele vraag heeft een afgewerkt antwoord, dus geen FAQPage-structuurdata');
    return '\n';
  }
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: 'nl-BE',
    mainEntity: vragen,
  };
  return `\n<script type="application/ld+json">\n${JSON.stringify(ld, null, 2)}\n</script>\n`;
}

/* ------------------------------------------------------------- invoegen --- */

function vervang(html, begin, einde, nieuw, wat) {
  const a = html.indexOf(begin);
  if (a === -1) stop(`de markering ${wat}:BEGIN staat niet in draft-r3-01-definitief.html`);
  const b = html.indexOf(einde, a);
  if (b === -1) stop(`de markering ${wat}:EINDE staat niet na ${wat}:BEGIN`);
  if (html.indexOf(begin, a + 1) !== -1) stop(`de markering ${wat}:BEGIN staat er twee keer in`);
  return html.slice(0, a + begin.length) + nieuw + html.slice(b);
}

export function bouwFaq({ check = false, proef = false } = {}) {
  const items = keur(leesFaq(BRON));
  const labels = ctas(items);
  if (!existsSync(PAGINA)) stop('draft-r3-01-definitief.html ontbreekt');
  const was = readFileSync(PAGINA, 'utf8');
  let wordt = vervang(was, LIJST_BEGIN, LIJST_EINDE, lijstHtml(items, labels), 'FAQ-LIJST');
  wordt = vervang(wordt, JSONLD_BEGIN, JSONLD_EINDE, jsonLdHtml(items), 'FAQ-JSONLD');

  const telJsonLd = (jsonLdHtml(items).match(/"@type": "Question"/g) || []).length;
  const samenvatting = `${items.length} vraag/vragen uit content/faq.yml · ${telJsonLd} in de FAQPage-structuurdata`;

  if (check) {
    if (wordt !== was) {
      stop('draft-r3-01-definitief.html komt niet overeen met content/faq.yml. ' +
           'Draai `node build-faq.mjs` en commit het resultaat.');
    }
    console.log(`FAQ in orde — ${samenvatting}`);
    return { gewijzigd: false, items: items.length, jsonld: telJsonLd };
  }

  const gewijzigd = wordt !== was;
  if (!proef && gewijzigd) writeFileSync(PAGINA, wordt);
  console.log(`${proef ? '(proef) ' : ''}FAQ gebouwd: ${samenvatting}${gewijzigd ? '' : ' (ongewijzigd)'}`);
  return { gewijzigd, items: items.length, jsonld: telJsonLd };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  bouwFaq({
    check: process.argv.includes('--check'),
    proef: process.argv.includes('--dry-run'),
  });
}
