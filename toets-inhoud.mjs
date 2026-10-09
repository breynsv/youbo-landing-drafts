#!/usr/bin/env node
/**
 * Bewijst dat de tekst van de landingspagina veilig uit handen gegeven kan
 * worden: dat een opslag door het CMS dezelfde pagina oplevert, dat elke nota
 * aan de klant er nog staat, en dat elke fout die een invulveld kan maken de
 * bouw tegenhoudt in plaats van de site.
 *
 *     node toets-inhoud.mjs
 *
 * Geen netwerk, geen browser, geen schrijfrecht op deze map: alles gebeurt in
 * een wegwerpmap in /tmp. Dezelfde opzet als toets-faq-rondrit.mjs, en om
 * dezelfde reden — de FAQ bewees daar dat een CMS-opslag niets stilletjes
 * sloopt, en dit doet dat voor de negen andere blokken.
 *
 * WAT ER TE BEWIJZEN VALT, EN WAAROM JUIST DIT
 *
 *  1. DE VORM. Sveltia leest een YAML-bestand in en schrijft bij elke opslag
 *     een volledig nieuw bestand. Staat de bron niet al in de vorm die Sveltia
 *     schrijft, dan is Jana's eerste opslag een herschrijving van het hele
 *     bestand waarin haar eigen wijziging niet te vinden is. Bij de FAQ
 *     veranderde zo'n herschrijving ook echt de pagina (een alineagrens
 *     verdween, en een openstaand TODO-antwoord belandde in de structuurdata
 *     voor Google). Daarom wordt die opslag hier nagebootst — met dezelfde
 *     bibliotheek en dezelfde opties als Sveltia — en vergeleken.
 *
 *  2. DE NOTA'S. Op de pagina staan nog zes open punten van de klant. Die
 *     zijn nu velden, en een veld is iets dat iemand kan leegmaken. Deze toets
 *     telt ze en eist dat elk kader met een stippellijn ook echt uit een veld
 *     komt dat met "TODO — " begint.
 *
 *  3. DE GRENZEN. Zeven dingen die een invulveld kan aanleveren en die de
 *     pagina zouden slopen. Elk ervan hoort de BOUW te laten stoppen, zodat
 *     Cloudflare de vorige publicatie online houdt. Dat is niet beredeneerd
 *     maar uitgelokt: elke grens wordt hier echt overschreden en de
 *     afsluitcode wordt gelezen.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { BRONNEN, dump, vindSlots } from './build-inhoud.mjs';
import { leesYaml, vlak } from './lees-yaml.js';
import { tekstHtml } from './inhoud-opmaak.js';

const hier = dirname(fileURLToPath(import.meta.url));

let yaml;
try {
  yaml = await import('yaml');
} catch {
  console.error(
    'STOP — de bibliotheek "yaml" ontbreekt. Zij staat in package.json als\n' +
    'devDependency en wordt alleen door deze toets gebruikt, niet door de bouw.\n' +
    'Draai `npm install` en probeer opnieuw.');
  process.exit(2);
}
const { parse, Document } = yaml;

let fouten = 0;
const ok = (wat, extra = '') => console.log(`  ok    ${wat}${extra ? `  ${extra}` : ''}`);
const fout = (wat, uitleg) => { fouten++; console.log(`  FOUT  ${wat}\n        ${uitleg}`); };
const eis = (wat, waar, uitleg = '') => (waar ? ok(wat) : fout(wat, uitleg));

/* ---------------------------------------------- de schrijfkant van Sveltia ---
   Overgenomen uit sveltia-cms/src/lib/services/contents/file/format.js:
   formatYAML() met de standaardopties, net als in toets-faq-rondrit.mjs. Het
   commentaar bovenaan deze bestanden overleeft zo'n opslag niet; wat er wél
   blijft staan, zijn de regels die in beheer/config.yml als `comment` bij een
   veld staan, en die schrijft Sveltia zelf terug. */

const schrijfZoalsSveltia = (obj) => `${new Document(obj).toString({
  indent: 2,
  indentSeq: true,
  lineWidth: 0,
  defaultKeyType: 'PLAIN',
  defaultStringType: 'PLAIN',
  singleQuote: true,
}).trim()}\n`;

// Sveltia trimt de waarde van een string-, text- en list-veld bij het opslaan.
const trimDiep = (knoop) => {
  if (typeof knoop === 'string') return knoop.trim();
  if (Array.isArray(knoop)) return knoop.map(trimDiep);
  const uit = {};
  for (const [k, v] of Object.entries(knoop)) uit[k] = trimDiep(v);
  return uit;
};

const naEenOpslag = (tekst) => schrijfZoalsSveltia(trimDiep(parse(tekst)));

/* --------------------------------------------------------------- wegwerpmap ---
   Een volledige, werkende kopie van de bouw in /tmp. Daar mag kapotgemaakt
   worden; de echte pagina wordt door deze toets nooit geschreven. */

const SCRIPTS = ['build-inhoud.mjs', 'inhoud-opmaak.js', 'lees-yaml.js', 'faq-opmaak.js'];

function maakWegwerp() {
  const map = mkdtempSync(join(tmpdir(), 'youbo-inhoud-'));
  for (const f of SCRIPTS) cpSync(join(hier, f), join(map, f));
  cpSync(join(hier, 'draft-r3-01-definitief.html'), join(map, 'draft-r3-01-definitief.html'));
  mkdirSync(join(map, 'content'));
  for (const f of BRONNEN) cpSync(join(hier, 'content', f), join(map, 'content', f));
  mkdirSync(join(map, 'assets', 'img'), { recursive: true });
  for (const beeld of beeldenInBronnen()) cpSync(join(hier, beeld), join(map, beeld));
  return map;
}

function beeldenInBronnen() {
  const uit = new Set();
  for (const f of BRONNEN) {
    for (const m of readFileSync(join(hier, 'content', f), 'utf8').matchAll(/assets\/img\/[\w.-]+/g)) {
      uit.add(m[0]);
    }
  }
  return uit;
}

/** Draait de bouw in de wegwerpmap. Geeft afsluitcode en uitvoer terug. */
function bouw(map, ...args) {
  const r = spawnSync(process.execPath, [join(map, 'build-inhoud.mjs'), ...args],
                      { cwd: map, encoding: 'utf8' });
  return { code: r.status, uit: `${r.stdout}${r.stderr}` };
}

/** Verandert één veld in een bestand in de wegwerpmap, met een ruwe tekstruil. */
function verander(map, bestand, oud, nieuw) {
  const pad = join(map, 'content', bestand);
  const was = readFileSync(pad, 'utf8');
  if (!was.includes(oud)) {
    fout(`de toets zelf: "${oud}" staat niet in content/${bestand}`,
         'de toets is dan vacuüm groen, dus is dit een fout en geen waarschuwing');
    return false;
  }
  writeFileSync(pad, was.replace(oud, nieuw));
  return true;
}

/* ------------------------------------------------- 1 · de vorm van de bron --- */

console.log('1. De drie inhoudsbestanden — de vorm die het CMS schrijft');

const bronTekst = new Map(BRONNEN.map((f) => [f, readFileSync(join(hier, 'content', f), 'utf8')]));

for (const [naam, tekst] of bronTekst) {
  const zonderKop = tekst.replace(/^(#[^\n]*\n)+/, '');
  const na = naEenOpslag(tekst);
  if (na === zonderKop) ok(`content/${naam} staat al in de vorm die het CMS schrijft`);
  else {
    fout(`content/${naam} staat al in de vorm die het CMS schrijft`,
         'Jana\'s eerste opslag herschrijft dan het hele bestand in plaats van alleen haar ' +
         'wijziging. Eerste verschil:\n        ' + eersteVerschil(zonderKop, na));
  }
  if (naEenOpslag(na) === na) ok(`en een tweede opslag verandert er niets meer aan (stabiel)`);
  else fout(`een tweede opslag van content/${naam} verandert er niets meer aan`, 'niet stabiel');
}

function eersteVerschil(a, b) {
  const x = a.split('\n'); const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return `regel ${i + 1}\n        in git: ${JSON.stringify(x[i])}\n        na opslag: ${JSON.stringify(y[i])}`;
  }
  return '(geen)';
}

// En nu de lezekant: leest de bouw na zo'n opslag dezelfde velden? De lezer is
// hier geen nabootsing — het is leesYaml() uit de bouw zelf.
{
  const nu = new Map();
  const na = new Map();
  for (const [naam, tekst] of bronTekst) {
    for (const [k, v] of vlak(leesYaml(tekst, naam))) nu.set(k, v);
    for (const [k, v] of vlak(leesYaml(naEenOpslag(tekst), naam))) na.set(k, v);
  }
  eis(`de bouw leest na een opslag dezelfde ${nu.size} velden`,
      JSON.stringify([...nu]) === JSON.stringify([...na]),
      'de lezer van de bouw en de schrijver van het CMS zijn niet elkaars omgekeerde');
}

/* ----------------------------------------------- 2 · de pagina en de bron --- */

console.log('\n2. De pagina komt overeen met de bron');

{
  const schoon = maakWegwerp();
  try {
    const c = bouw(schoon, '--check');
    eis('node build-inhoud.mjs --check is groen', c.code === 0, c.uit.trim());

    const paginaHtml = readFileSync(join(hier, 'draft-r3-01-definitief.html'), 'utf8');
    const slots = vindSlots(paginaHtml);
    const velden = new Map();
    for (const [naam, tekst] of bronTekst) for (const [k, v] of vlak(leesYaml(tekst, naam))) velden.set(k, v);

    eis(`elk van de ${slots.length} plekken in de pagina heeft een veld`,
        slots.every((s) => s.soort === 'kenmerk' && s.waarde.includes('{') ? true : velden.has(s.waarde)),
        'een plek zonder veld zou de bouw laten stoppen, maar dan pas bij de deploy');

    /* ---- de nota's aan de klant ---- */

    // Elk kader met een stippellijn buiten de FAQ moet uit een veld komen, en
    // dat veld moet met "TODO — " beginnen. Zo kan een nota niet stil van de
    // pagina verdwijnen doordat iemand hem wegpoetst: hij is dan geen TODO
    // meer, en dat is hier zichtbaar.
    const faqBegin = paginaHtml.indexOf('<!-- FAQ-LIJST:BEGIN');
    const faqEinde = paginaHtml.indexOf('<!-- FAQ-LIJST:EINDE');
    const kaders = [...paginaHtml.matchAll(/<(\w+)\s[^>]*class="(?:[^"]*\s)?(todo|todo-inv)(?:\s[^"]*)?"[^>]*>/g)]
      .filter((m) => !(m.index > faqBegin && m.index < faqEinde));
    const metVeld = kaders.filter((m) => /data-inhoud="([^"]+)"/.exec(m[0]));
    eis(`de ${kaders.length} TODO-kaders buiten de FAQ komen allemaal uit een veld`,
        kaders.length === metVeld.length,
        `${kaders.length - metVeld.length} kader(s) staan nog als vaste HTML in de pagina`);

    const notas = metVeld.map((m) => /data-inhoud="([^"]+)"/.exec(m[0])[1]);
    const geenTodo = notas.filter((s) => !/^TODO\s+—\s/.test(velden.get(s) ?? ''));
    eis('en elk van die velden begint met "TODO — ", dus krijgt het kader',
        geenTodo.length === 0,
        `deze niet: ${geenTodo.join(', ')} — het kader staat er dan zonder dat de tekst een nota is`);

    eis('een TODO-veld wordt vet tot de eerste dubbele punt, net als in de FAQ',
        tekstHtml('TODO — nodig van klant: iets').startsWith('<b>TODO — nodig van klant</b>:'),
        tekstHtml('TODO — nodig van klant: iets'));

    /* ---- de vaste vorm van de aria-labels ---- */

    // De vier knoppen in de rondleiding dragen "Ga naar stap 1: <kop>". Die kop
    // staat ook als tekst op de pagina. Als die twee niet uit hetzelfde veld
    // komen, lopen ze uiteen en hoort een schermlezer de kop van vorige maand.
    const anders = maakWegwerp();
    try {
      if (verander(anders, 'pagina.yml',
                   'stap1_titel: Hr houdt realtime het overzicht',
                   'stap1_titel: Hr ziet alles in één oogopslag')) {
        const r = bouw(anders);
        const na = readFileSync(join(anders, 'draft-r3-01-definitief.html'), 'utf8');
        eis('de aria-label van een rondleidingknop loopt mee met de kop ernaast',
            r.code === 0 &&
            na.includes('data-inhoud="rondleiding.stap1_titel">Hr ziet alles in één oogopslag<') &&
            na.includes('aria-label="Ga naar stap 1: Hr ziet alles in één oogopslag"') &&
            !na.includes('aria-label="Ga naar stap 1: Hr houdt realtime het overzicht"'),
            r.uit.trim() || 'de aria-label bleef op de oude kop staan');
      }
    } finally { rmSync(anders, { recursive: true, force: true }); }
  } finally { rmSync(schoon, { recursive: true, force: true }); }
}

/* -------------------------------------------------------- 3 · de grenzen --- */

console.log('\n3. Wat een invulveld kan aanleveren, en wat de bouw ermee doet');

const grenzen = [
  ['HTML in een veld houdt de bouw tegen', 'pagina.yml',
   'kop: Compensatie zonder kopzorgen', 'kop: Compensatie <b>zonder</b> kopzorgen', /"<"/],
  ['een leeg veld houdt de bouw tegen', 'pagina.yml',
   'kop: Compensatie zonder kopzorgen', "kop: ''", /is leeg/],
  ['twee alinea\'s in één veld houden de bouw tegen', 'pagina.yml',
   'kop: Compensatie zonder kopzorgen', 'kop: "Eerste regel\\nTweede regel"', /meer dan één regel/],
  ['een veld dat de pagina niet vraagt, houdt de bouw tegen', 'pagina.yml',
   'logobalk:\n  kop:', 'logobalk:\n  ondertitel: Een veld dat nergens staat\n  kop:', /nergens in de pagina/],
  ['een veld dat de pagina wél vraagt en dat ontbreekt, houdt de bouw tegen', 'pagina.yml',
   '  kop: Deze bedrijven vertrouwen Youbo', '  kop_weg: Deze bedrijven vertrouwen Youbo', /logobalk\.kop/],
  ['een verwijzing naar een bestand dat niet bestaat, houdt de bouw tegen', 'klanten.yml',
   'foto: assets/img/pieter-jan.webp', 'foto: assets/img/bestaat-niet.webp', /ontbrekend bestand/],
  ['een javascript:-adres in een link houdt de bouw tegen', 'klanten.yml',
   "downloadlink: '#cases-open'", "downloadlink: 'javascript:alert(1)'", /javascript/],
  ['een lijst tussen haken wordt niet stil als tekst gelezen', 'klanten.yml',
   '    cijfers:\n      - 204 medewerkers\n      - 27 afdelingen', '    cijfers: []', /tussen haken/],
  ['een opsomming waar één regel tekst hoort, houdt de bouw tegen', 'pagina.yml',
   '  kop: Compensatie zonder kopzorgen', '  kop:\n    - Eerste\n    - Tweede', /doorlopend stuk tekst/],
  ['één regel tekst waar een opsomming hoort, houdt de bouw tegen', 'klanten.yml',
   '    cijfers:\n      - 204 medewerkers\n      - 27 afdelingen', '    cijfers: 204 medewerkers',
   /opsomming te zijn/],
  ['"null" als waarde wordt niet stil als het woord gelezen', 'pagina.yml',
   '  kop: Deze bedrijven vertrouwen Youbo', '  kop: null', /geen tekst maar een waarde/],
];

for (const [wat, bestand, oud, nieuw, verwacht] of grenzen) {
  const map = maakWegwerp();
  try {
    if (!verander(map, bestand, oud, nieuw)) continue;
    const r = bouw(map);
    if (r.code === 0) {
      fout(wat, `de bouw liep gewoon door (afsluitcode 0): ${r.uit.trim().slice(0, 160)}`);
    } else if (!verwacht.test(r.uit)) {
      fout(wat, `de bouw stopte, maar zegt niet waarom in de verwachte woorden:\n        ${r.uit.trim().slice(0, 220)}`);
    } else {
      ok(wat, r.uit.trim().split('\n')[0].replace(/^STOP — /, '').slice(0, 110));
    }
  } finally { rmSync(map, { recursive: true, force: true }); }
}

/* --------------------------------------------- 4 · drie vormen, één tekst --- */

console.log('\n4. Dezelfde tekst, drie manieren om haar op te schrijven');

const vormen = [
  ['een gewone regel — met de hand getypt', 'groep:\n  veld: Een gewone regel\n', 'Een gewone regel'],
  ['enkel aangehaald — wat het CMS kiest bij een dubbele punt',
   "groep:\n  veld: 'Een regel: met een dubbele punt'\n", 'Een regel: met een dubbele punt'],
  ['dubbel aangehaald — ook een geldige keuze van een YAML-schrijver',
   'groep:\n  veld: "Een regel met een \\"citaat\\" erin"\n', 'Een regel met een "citaat" erin'],
  ['letterlijk blok (|-) van één regel — wat het CMS schrijft na een plakactie',
   'groep:\n  veld: |-\n    Een regel uit een blok\n', 'Een regel uit een blok'],
  ['een opsomming', 'groep:\n  veld:\n    - eerste\n    - tweede\n', ['eerste', 'tweede']],
];

for (const [wat, tekst, verwacht] of vormen) {
  const gelezen = vlak(leesYaml(tekst, 'toets')).get('groep.veld');
  eis(wat, JSON.stringify(gelezen) === JSON.stringify(verwacht),
      `kreeg ${JSON.stringify(gelezen)} in plaats van ${JSON.stringify(verwacht)}`);
}

/* ------------------------------------------------------------------ afloop --- */

console.log('');
if (fouten) {
  console.log(`${fouten} fout(en). De inhoudsbestanden mogen zo niet aan Jana gegeven worden.`);
  process.exit(1);
}
console.log('Alles in orde — een opslag in /beheer/ levert dezelfde pagina op, en elke fout ' +
            'die een invulveld kan maken stopt de bouw.');
