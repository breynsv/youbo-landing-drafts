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
 *  1. DE VORM, EN DE VELDEN DIE SVELTIA KENT. Sveltia leest een YAML-bestand in
 *     en schrijft bij elke opslag een volledig nieuw bestand — in de volgorde
 *     van `fields` in beheer/config.yml, en met alleen de velden die daarin
 *     staan. Daar zitten twee stille fouten in:
 *
 *       · Staat de bron niet al in de vorm die Sveltia schrijft, dan is Jana's
 *         eerste opslag een herschrijving van het hele bestand waarin haar eigen
 *         wijziging niet te vinden is. Bij de FAQ veranderde zo'n herschrijving
 *         ook echt de pagina: een alineagrens verdween, en een openstaand
 *         TODO-antwoord belandde in de structuurdata voor Google.
 *       · Ontbreekt een veld in `fields`, dan verdwijnt het bij de eerste opslag
 *         uit het bestand, en stopt de bouw omdat de pagina erom vraagt. De
 *         pagina is dan tot de volgende commit niet bij te werken.
 *
 *     Daarom wordt de opslag hier nagebootst uit beheer/config.yml zelf — met
 *     dezelfde bibliotheek en dezelfde opties als Sveltia — voor alle VIER de
 *     bestanden, en wordt het resultaat byte voor byte vergeleken. En daarna
 *     wordt met die vier nagebootste bestanden de pagina opnieuw gebouwd: komt
 *     daar byte voor byte dezelfde HTML uit, dan verandert een opslag in
 *     /beheer/ werkelijk niets aan de pagina behalve de tekst die Jana typte.
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
import { GRENZEN, tekstHtml } from './inhoud-opmaak.js';

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
const { parse, Document, isMap } = yaml;

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

// addYAMLComments() uit hetzelfde bestand: de regels die als `comment` bij een
// veld in beheer/config.yml staan, schrijft Sveltia zelf boven dat veld terug.
// Dat is de enige uitleg die een herschrijving overleeft.
const addYAMLComments = (node, comments, prefix = '') => {
  if (!isMap(node)) return;
  node.items.forEach(({ key, value }) => {
    const keyPath = `${prefix}${key.value}`;
    const comment = comments[keyPath];
    if (comment) {
      key.commentBefore = comment.split(/\\n|\n/).map((regel) => ` ${regel}`).join('\n');
    }
    addYAMLComments(value, comments, `${keyPath}.`);
  });
};

const schrijfZoalsSveltia = (obj, comments = {}) => {
  const doc = new Document(obj);
  addYAMLComments(doc.contents, comments);
  return `${doc.toString({
    indent: 2,
    indentSeq: true,
    lineWidth: 0,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'PLAIN',
    singleQuote: true,
  }).trim()}\n`;
};

// Sveltia trimt de waarde van een string-, text- en list-veld bij het opslaan.
// Een getal is geen van die drie, en moet hier ongemoeid door: Object.entries()
// van een getal is een lege lijst, dus maakte deze functie van `hoogte: 24` een
// `hoogte: {}` — en dan zegt de toets dat een opslag het bestand sloopt terwijl
// de toets zelf het sloopt. Gevonden toen de logohoogtes getallen werden.
const trimDiep = (knoop) => {
  if (typeof knoop === 'string') return knoop.trim();
  if (typeof knoop === 'number' || typeof knoop === 'boolean' || knoop === null) return knoop;
  if (Array.isArray(knoop)) return knoop.map(trimDiep);
  const uit = {};
  for (const [k, v] of Object.entries(knoop)) uit[k] = trimDiep(v);
  return uit;
};

/* ---------------------------------------------- de velden uit config.yml ---
   Sveltia bouwt de waarde op uit `fields` — in die volgorde, en alleen die
   velden. Dus doet deze nabootsing dat ook: ze leest beheer/config.yml en niet
   het bestand. Zo gaat ze rood wanneer de configuratie en het bestand
   uiteenlopen, en dat is precies de fout die niemand ziet tot Jana opslaat. */

const config = parse(readFileSync(join(hier, 'beheer', 'config.yml'), 'utf8'));
const CMS_BESTANDEN = (config.collections ?? []).flatMap((c) => c.files ?? []);

// output.omit_empty_optional_fields staat in deze configuratie AAN: een leeg
// veld dat niet verplicht is, laat Sveltia dan weg uit het bestand in plaats
// van er een lege waarde in te schrijven. Die stand is hier geen smaak maar
// noodzaak — de nota op een casekaart is er bijna nooit, en de bouw weigert een
// leeg veld. Zou deze nabootsing die stand niet volgen, dan zegt de toets groen
// terwijl Jana's eerste opslag de bouw laat falen op vier lege nota's.
const LAAT_LEEG_WEG = config.output?.omit_empty_optional_fields === true;

function waardeUitVelden(velden, data) {
  const uit = {};
  for (const v of velden ?? []) {
    const w = data?.[v.name];
    if (v.widget === 'object') { uit[v.name] = waardeUitVelden(v.fields, w ?? {}); continue; }
    if (v.widget === 'list') {
      uit[v.name] = v.fields
        ? (w ?? []).map((item) => waardeUitVelden(v.fields, item))
        : (w ?? []).map((x) => String(x).trim());
      continue;
    }
    const waarde = String(w ?? '').trim();
    if (LAAT_LEEG_WEG && waarde === '' && v.required === false) continue;
    // Een getalveld schrijft Sveltia als getal terug, niet als tekst tussen
    // aanhalingstekens. De logohoogtes zijn getallen, dus zou een tekstwaarde
    // hier bij elke opslag aanhalingstekens in het bestand zetten.
    uit[v.name] = v.widget === 'number' && waarde !== '' && !Number.isNaN(Number(waarde))
      ? Number(waarde) : waarde;
  }
  return uit;
}

/** De `comment`-regels per sleutelpad, zoals Sveltia ze terugschrijft. */
function commentsUitVelden(velden, pad = '', uit = {}) {
  for (const v of velden ?? []) {
    const hier = pad ? `${pad}.${v.name}` : v.name;
    if (v.comment) uit[hier] = v.comment;
    if (v.widget === 'object') commentsUitVelden(v.fields, hier, uit);
  }
  return uit;
}

/**
 * De platte sleutels die de configuratie beschrijft, in de volgorde van
 * `fields`. Een lijst van groepjes wordt genummerd uitgeklapt, net als in
 * vlak() — en dus met de GEGEVENS erbij, want hoeveel items er zijn staat in
 * het bestand en niet in de configuratie. Alleen zo vergelijkt deze toets twee
 * dingen van dezelfde vorm; zonder de gegevens zou ze "cases.items" naast
 * "cases.items.1.bedrijf" leggen en altijd rood staan.
 */
function sleutelsUitVelden(velden, data = null, pad = '', uit = []) {
  for (const v of velden ?? []) {
    const hier = pad ? `${pad}.${v.name}` : v.name;
    const w = data?.[v.name];
    if (v.widget === 'object') { sleutelsUitVelden(v.fields, w ?? {}, hier, uit); continue; }
    if (v.widget === 'list' && v.fields) {
      (w ?? []).forEach((item, k) => sleutelsUitVelden(v.fields, item, `${hier}.${k + 1}`, uit));
      continue;
    }
    if (LAAT_LEEG_WEG && v.required === false
        && String(w ?? '').trim() === '') continue;
    uit.push(hier);
  }
  return uit;
}

/** Elk leesbaar veld in de configuratie, met zijn pad — voor de keuring eronder. */
function alleVelden(velden, pad = '', uit = []) {
  for (const v of velden ?? []) {
    const hier = pad ? `${pad}.${v.name}` : v.name;
    if (v.widget === 'object') alleVelden(v.fields, hier, uit);
    else {
      uit.push([hier, v]);
      if (v.widget === 'list' && v.field) uit.push([`${hier}[]`, v.field]);
      if (v.widget === 'list' && v.fields) alleVelden(v.fields, `${hier}[]`, uit);
    }
  }
  return uit;
}

/** Wat Sveltia na een opslag van dit bestand zou wegschrijven. */
const naEenOpslagVan = (bestand, tekst) =>
  schrijfZoalsSveltia(trimDiep(waardeUitVelden(bestand.fields, parse(tekst))),
                      commentsUitVelden(bestand.fields));

/* --------------------------------------------------------------- wegwerpmap ---
   Een volledige, werkende kopie van de bouw in /tmp. Daar mag kapotgemaakt
   worden; de echte pagina wordt door deze toets nooit geschreven. */

const SCRIPTS = ['build-inhoud.mjs', 'build-faq.mjs', 'inhoud-opmaak.js',
                 'lees-yaml.js', 'faq-opmaak.js'];

function maakWegwerp() {
  const map = mkdtempSync(join(tmpdir(), 'youbo-inhoud-'));
  for (const f of SCRIPTS) cpSync(join(hier, f), join(map, f));
  cpSync(join(hier, 'draft-r3-01-definitief.html'), join(map, 'draft-r3-01-definitief.html'));
  mkdirSync(join(map, 'content'));
  for (const f of [...BRONNEN, 'faq.yml']) cpSync(join(hier, 'content', f), join(map, 'content', f));
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

/* ------------------------------- 1 · een opslag in /beheer/, alle vier --- */

console.log('1. Een opslag in /beheer/ — alle vier de inhoudsbestanden');

const ALLE_BRONNEN = ['pagina.yml', 'klanten.yml', 'contact.yml', 'faq.yml'];

eis(`beheer/config.yml beheert alle ${ALLE_BRONNEN.length} de inhoudsbestanden`,
    ALLE_BRONNEN.every((f) => CMS_BESTANDEN.some((b) => b.file === `content/${f}`)),
    'ontbreekt: ' + ALLE_BRONNEN.filter((f) => !CMS_BESTANDEN.some((b) => b.file === `content/${f}`))
      .join(', '));

const bronTekst = new Map(BRONNEN.map((f) => [f, readFileSync(join(hier, 'content', f), 'utf8')]));
const naOpslag = new Map();

for (const naam of ALLE_BRONNEN) {
  const bestand = CMS_BESTANDEN.find((b) => b.file === `content/${naam}`);
  if (!bestand) continue;
  const pad = join(hier, 'content', naam);
  const was = readFileSync(pad, 'utf8');
  const na = naEenOpslagVan(bestand, was);
  naOpslag.set(naam, na);

  // (a) beschrijft de configuratie precies de velden die in het bestand staan,
  //     en in dezelfde volgorde? Een veld dat hier ontbreekt, verdwijnt bij
  //     Jana's eerste opslag uit het bestand.
  if (naam !== 'faq.yml') {
    const inBestand = [...vlak(leesYaml(was, naam)).keys()];
    const inConfig = sleutelsUitVelden(bestand.fields, parse(was));
    eis(`${naam}: de configuratie beschrijft precies deze ${inBestand.length} velden, in deze volgorde`,
        JSON.stringify(inBestand) === JSON.stringify(inConfig),
        `in het bestand: ${inBestand.join(', ')}\n        in config.yml: ${inConfig.join(', ')}`);
  }

  // (b) levert een opslag byte voor byte hetzelfde bestand op?
  if (na === was) ok(`${naam}: een opslag verandert er geen byte aan`);
  else {
    fout(`${naam}: een opslag verandert er geen byte aan`,
         'Jana\'s eerste opslag herschrijft dan het hele bestand in plaats van alleen haar ' +
         'wijziging. Eerste verschil:\n        ' + eersteVerschil(was, na));
  }

  // (c) en een tweede opslag ook niet (stabiel)
  eis(`${naam}: en een tweede opslag ook niet (stabiel)`,
      naEenOpslagVan(bestand, na) === na, 'elke opslag levert een ander bestand op');

  // (d) de uitleg bovenaan komt uit `comment` en staat er werkelijk
  const kopregels = na.split('\n').filter((r) => r.startsWith('#')).length;
  const uitConfig = Object.keys(commentsUitVelden(bestand.fields)).length;
  eis(`${naam}: de uitleg bovenaan (${kopregels} regels) komt uit "comment" in config.yml`,
      kopregels > 0 && uitConfig > 0,
      uitConfig === 0 ? 'geen enkel veld heeft een "comment"' : 'het bestand heeft geen kopregels');
}

function eersteVerschil(a, b) {
  const x = a.split('\n'); const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return `regel ${i + 1}\n        in git: ${JSON.stringify(x[i])}\n        na opslag: ${JSON.stringify(y[i])}`;
  }
  return '(geen)';
}

// (e) de lezekant: leest de bouw na zo'n opslag dezelfde velden? De lezer is
//     hier geen nabootsing — het is leesYaml() uit de bouw zelf.
{
  const nu = new Map();
  const na = new Map();
  for (const [naam, tekst] of bronTekst) {
    for (const [k, v] of vlak(leesYaml(tekst, naam))) nu.set(k, v);
    for (const [k, v] of vlak(leesYaml(naOpslag.get(naam), naam))) na.set(k, v);
  }
  eis(`de bouw leest na een opslag dezelfde ${nu.size} velden`,
      JSON.stringify([...nu]) === JSON.stringify([...na]),
      'de lezer van de bouw en de schrijver van het CMS zijn niet elkaars omgekeerde');
}

// (f) EN HET ANTWOORD DAT ERTOE DOET: komt er na een opslag van alle vier de
//     bestanden byte voor byte dezelfde pagina uit? Hier wordt niets
//     nagebootst behalve de opslag zelf: de bouw is de echte bouw, in een
//     wegwerpmap, en het resultaat gaat tegen de pagina in git.
{
  const map = maakWegwerp();
  try {
    for (const [naam, tekst] of naOpslag) writeFileSync(join(map, 'content', naam), tekst);
    const a = bouw(map);
    const b = spawnSync(process.execPath, [join(map, 'build-faq.mjs')], { cwd: map, encoding: 'utf8' });
    const gebouwd = readFileSync(join(map, 'draft-r3-01-definitief.html'), 'utf8');
    const inGit = readFileSync(join(hier, 'draft-r3-01-definitief.html'), 'utf8');
    eis('na een opslag van alle vier de bestanden bouwt de pagina byte voor byte hetzelfde',
        a.code === 0 && b.status === 0 && gebouwd === inGit,
        `${a.uit.trim()}\n        ${(b.stdout + b.stderr).trim()}\n        ` +
        (gebouwd === inGit ? '' : `de HTML verschilt (${inGit.length} → ${gebouwd.length} tekens)`));
  } finally { rmSync(map, { recursive: true, force: true }); }
}

// (g) en de velden zelf: platte tekst, nergens een opmaakveld, en overal een
//     patroon dat een < al in de interface weigert.
{
  const velden = CMS_BESTANDEN.flatMap((b) => alleVelden(b.fields));
  const rijk = velden.filter(([, v]) => ['markdown', 'richtext', 'rich_text', 'code'].includes(v.widget));
  eis(`geen markdown-, rich-text- of code-veld (${velden.length} velden nagekeken)`,
      rijk.length === 0,
      rijk.map(([p]) => p).join(', ') + ' — zo\'n veld schrijft HTML in de inhoud');

  // Zes soorten en geen zevende. Image, number en select zijn er sinds
  // 2026-10-10 bij, en ze kunnen géén HTML of regelafbreking dragen: een
  // beeldveld schrijft een pad uit de beeldbibliotheek, een getalveld een
  // getal, en een keuzeveld één van de waarden die hier in config.yml staan.
  // Daarom is het patroon hieronder ook alleen voor string en text een eis —
  // een patroon op een keuzeveld zou een regel zijn die niets kan tegenhouden.
  const TOEGESTAAN = ['string', 'text', 'list', 'image', 'number', 'select'];
  const vreemd = velden.filter(([, v]) => !TOEGESTAAN.includes(v.widget));
  eis(`en alleen ${TOEGESTAAN.join('-, ')}-velden`, vreemd.length === 0,
      vreemd.map(([p, v]) => `${p} is een ${v.widget}-veld`).join(', '));

  // Een keuzeveld mag alleen waarden aanbieden die de bouw kent.
  const keuzes = velden.filter(([, v]) => v.widget === 'select');
  eis(`elk keuzeveld (${keuzes.length}) biedt alleen waarden aan die de pagina kent`,
      keuzes.every(([, v]) => Array.isArray(v.options) && v.options.length > 0
                              && v.options.every((o) => typeof o === 'object' && o.value && o.label)),
      keuzes.filter(([, v]) => !Array.isArray(v.options) || !v.options.length)
        .map(([p]) => p).join(', ') || 'een optie zonder label of value');

  const tekstsoort = ([, v]) => v.widget === 'string' || v.widget === 'text';
  const geenPatroon = velden.filter(tekstsoort).filter(([, v]) => {
    const pat = Array.isArray(v.pattern) ? v.pattern[0] : null;
    if (!pat) return true;
    const r = new RegExp(pat);
    return !r.test('gewone tekst') || r.test('met een <b> erin');
  });
  eis('en elk veld weigert een < al in de interface', geenPatroon.length === 0,
      geenPatroon.map(([p]) => p).join(', '));

  // De tekstvelden van de pagina zijn één doorlopend stuk tekst: de bouw
  // weigert een regelafbreking, dus hoort de interface dat ook te doen. Het
  // FAQ-antwoord is het enige veld waar een nieuwe regel juist WEL een nieuwe
  // alinea is, en dat is het enige veld dat `text` mag zijn.
  const tekstvelden = CMS_BESTANDEN
    .filter((b) => b.file !== 'content/faq.yml')
    .flatMap((b) => alleVelden(b.fields))
    .filter(tekstsoort);
  const regelDoor = tekstvelden.filter(([, v]) => {
    const pat = Array.isArray(v.pattern) ? v.pattern[0] : null;
    return !pat || new RegExp(pat).test('eerste\ntweede');
  });
  eis('en elk veld buiten de FAQ weigert ook een nieuwe regel', regelDoor.length === 0,
      regelDoor.map(([p]) => p).join(', '));

  // De regels BINNEN een opsomming krijgen geen eigen hint: Sveltia zet die
  // onder het lijstveld zelf, en één hint per regel zou vijf keer hetzelfde
  // zeggen onder vijf invulvakken.
  const zonderHint = tekstvelden
    .filter(([p]) => !p.endsWith('[]'))
    .filter(([, v]) => !v.hint || !v.hint.trim());
  eis('en elk van die velden heeft een hint die Jana onder het invulvak ziet',
      zonderHint.length === 0, zonderHint.map(([p]) => p).join(', '));

  const zonderLabel = CMS_BESTANDEN.flatMap((b) => alleVelden(b.fields))
    .filter(([p, v]) => !v.label && !p.endsWith('[]'));
  eis('en een Nederlands label', zonderLabel.length === 0, zonderLabel.map(([p]) => p).join(', '));
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
    // Commentaar eerst wegblanken, met dezelfde truc als check-drafts.mjs:
    // dezelfde lengte eroverheen, zodat de posities hierboven blijven kloppen.
    // Sinds de cases een lijst zijn, staat de nota van een kaart die er geen
    // heeft GEPARKEERD tussen commentaartekens in de pagina — zie
    // inhoud-opmaak.js. Zo'n element staat niet op de pagina, dus hoort het
    // hier ook niet als kader geteld te worden. Zonder deze regel zou deze
    // toets vier nota's eisen die er met opzet niet zijn.
    const zonderCommentaar = paginaHtml.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
    const kaders = [...zonderCommentaar.matchAll(/<(\w+)\s[^>]*class="(?:[^"]*\s)?(todo|todo-inv)(?:\s[^"]*)?"[^>]*>/g)]
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
                   'titel: Hr houdt realtime het overzicht',
                   'titel: Hr ziet alles in één oogopslag')) {
        const r = bouw(anders);
        const na = readFileSync(join(anders, 'draft-r3-01-definitief.html'), 'utf8');
        eis('de aria-label van een rondleidingknop loopt mee met de kop ernaast',
            r.code === 0 &&
            na.includes('data-inhoud="rondleiding.stappen.1.titel">Hr ziet alles in één oogopslag<') &&
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
   '      cijfers:\n        - 204 medewerkers\n        - 27 afdelingen', '      cijfers: []', /tussen haken/],
  ['een opsomming waar één regel tekst hoort, houdt de bouw tegen', 'pagina.yml',
   '  kop: Compensatie zonder kopzorgen', '  kop:\n    - Eerste\n    - Tweede', /doorlopend stuk tekst/],
  ['één regel tekst waar een opsomming hoort, houdt de bouw tegen', 'klanten.yml',
   '      cijfers:\n        - 204 medewerkers\n        - 27 afdelingen', '      cijfers: 204 medewerkers',
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

/* ----------------------------------------------------- 3b · de lijstgrenzen --- */

/**
 * Een lijst in een inhoudsbestand op een ander aantal items zetten, door de
 * items die er staan te herhalen of af te kappen. Ruwe tekst en geen
 * YAML-schrijver, met opzet: zo is dit precies wat iemand met de hand of met
 * het CMS zou aanleveren, en niet wat een bibliotheek ervan maakt.
 */
function zetAantal(map, bestand, lijstsleutel, aantal) {
  const pad = join(map, 'content', bestand);
  const regels = readFileSync(pad, 'utf8').split('\n');
  const kop = regels.findIndex((r) => r.trim() === `${lijstsleutel}:`);
  if (kop === -1) {
    fout(`de toets zelf: "${lijstsleutel}:" staat niet in content/${bestand}`,
         'de toets is dan vacuüm groen, dus is dit een fout en geen waarschuwing');
    return false;
  }
  const diep = regels[kop].length - regels[kop].trimStart().length + 2;
  const streep = ' '.repeat(diep) + '- ';
  const items = [];
  let i = kop + 1;
  while (i < regels.length) {
    if (!regels[i].startsWith(streep)) break;
    const blok = [regels[i]];
    i++;
    while (i < regels.length && regels[i].startsWith(' '.repeat(diep + 2))
           && !regels[i].startsWith(streep)) { blok.push(regels[i]); i++; }
    items.push(blok);
  }
  if (!items.length) {
    fout(`de toets zelf: geen enkel item onder "${lijstsleutel}:" in content/${bestand}`,
         'de toets is dan vacuüm groen');
    return false;
  }
  const nieuw = [];
  for (let k = 0; k < aantal; k++) nieuw.push(...items[k % items.length]);
  writeFileSync(pad, [...regels.slice(0, kop + 1), ...nieuw, ...regels.slice(i)].join('\n'));
  return true;
}

console.log('\n3b. De grenzen van de lijsten — één te veel en één te weinig');

// De grenzen in de bouw en die in het beheerscherm moeten dezelfde zijn. De
// interface is een gemak (Jana ziet het terwijl ze bezig is), de bouw is de
// waarborg — maar twee getallen die uiteenlopen, is een interface die iets
// toestaat wat de publicatie een uur later laat falen. Precies wat /beheer/
// niet mag doen.
{
  const velden = CMS_BESTANDEN.flatMap((b) => alleVelden(b.fields));
  for (const [sleutel, g] of Object.entries(GRENZEN)) {
    // Op het hele pad vergelijken en niet op de laatste naam: "items" bestaat
    // twee keer (cases en quotes), en met de laatste naam vond deze toets de
    // grens van de cases terug voor de quotes — en zei dus groen over een
    // getal dat zij zelf verkeerd had opgezocht.
    const veld = velden.filter(([p]) => p === sleutel).map(([, v]) => v)
      .find((v) => v.widget === 'list');
    eis(`${sleutel}: het beheerscherm toont dezelfde grens als de bouw (${g.min}–${g.max})`,
        veld && veld.min === g.min && veld.max === g.max,
        veld ? `config.yml zegt ${veld.min}–${veld.max}, inhoud-opmaak.js zegt ${g.min}–${g.max}`
             : 'geen list-veld met die naam in beheer/config.yml');
  }
}

const lijstgrenzen = [
  ['cases.items', 'klanten.yml', 'items', 'cases'],
  ['quotes.items', 'klanten.yml', 'items', 'quotes'],
  ['rondleiding.stappen', 'pagina.yml', 'stappen', 'rondleiding'],
  ['logobalk.logos', 'pagina.yml', 'logos', 'logobalk'],
];

for (const [sleutel, bestand, yamlSleutel, waar] of lijstgrenzen) {
  const g = GRENZEN[sleutel];
  for (const [wat, aantal] of [['één te veel', g.max + 1], ['één te weinig', g.min - 1]]) {
    const map = maakWegwerp();
    try {
      // De tweede lijst in hetzelfde bestand draagt dezelfde sleutelnaam
      // ("items"), dus moet zetAantal de juiste vinden: hij pakt de EERSTE, en
      // voor de quotes staat die onder de cases. Daarom snijdt deze toets het
      // bestand op de groep.
      if (!zetAantalInGroep(map, bestand, waar, yamlSleutel, aantal)) continue;
      const r = bouw(map);
      const naam = `${sleutel}: ${wat} (${aantal}) houdt de bouw tegen`;
      if (r.code === 0) {
        fout(naam, `de bouw liep gewoon door (afsluitcode 0): ${r.uit.trim().slice(0, 160)}`);
      } else if (!/Te veel|Te weinig/.test(r.uit)) {
        fout(naam, `de bouw stopte, maar niet op de grens:\n        ${r.uit.trim().slice(0, 240)}`);
      } else if (!new RegExp(`hoogstens ${g.max}|minstens ${g.min}`).test(r.uit)) {
        fout(naam, `de melding noemt de grens niet:\n        ${r.uit.trim().slice(0, 240)}`);
      } else if (r.uit.length < 200) {
        fout(naam, 'de melding zegt wel dat het mis is maar niet waarom — ' +
                   'een grens zonder reden is een grens die de volgende lezer weghaalt');
      } else {
        ok(naam, r.uit.trim().split('\n')[0].replace(/^STOP — /, '').slice(0, 95));
      }
    } finally { rmSync(map, { recursive: true, force: true }); }
  }
}

/**
 * zetAantal, maar binnen één groep van het bestand — nodig omdat "items" twee
 * keer voorkomt in klanten.yml (de cases én de quotes).
 */
function zetAantalInGroep(map, bestand, groep, lijstsleutel, aantal) {
  const pad = join(map, 'content', bestand);
  const heel = readFileSync(pad, 'utf8');
  const a = heel.indexOf(`\n${groep}:\n`);
  if (a === -1) {
    fout(`de toets zelf: groep "${groep}:" staat niet in content/${bestand}`,
         'de toets is dan vacuüm groen');
    return false;
  }
  const volgende = heel.slice(a + 1).search(/\n[A-Za-z_][A-Za-z0-9_]*:/);
  const b = volgende === -1 ? heel.length : a + 1 + volgende + 1;
  const stuk = heel.slice(a, b);

  const tijdelijk = join(map, 'content', '__stuk.yml');
  writeFileSync(tijdelijk, stuk.replace(new RegExp(`^\\n${groep}:\\n`), ''));
  // het stuk staat nu één niveau minder diep? Nee — het blijft zoals het is,
  // zetAantal zoekt op de sleutelregel en niet op de diepte van het bestand.
  const gelukt = zetAantal(map, '__stuk.yml', lijstsleutel, aantal);
  if (!gelukt) return false;
  const nieuwStuk = `\n${groep}:\n` + readFileSync(tijdelijk, 'utf8');
  rmSync(tijdelijk, { force: true });
  writeFileSync(pad, heel.slice(0, a) + nieuwStuk + heel.slice(b));
  return true;
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
