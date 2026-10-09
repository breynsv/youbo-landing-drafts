#!/usr/bin/env node
/**
 * De heen-en-terug-toets: overleeft content/faq.yml een opslag in /beheer/?
 *
 *     node toets-faq-rondrit.mjs
 *
 * WAAROM DEZE TOETS BESTAAT
 *
 * Sveltia CMS bewerkt content/faq.yml niet regel per regel: het leest het hele
 * bestand in, maakt er velden van, en schrijft bij elke opslag een volledig
 * nieuw bestand terug met een echte YAML-schrijver. Twee dingen kunnen daarbij
 * stuk gaan, en beide zijn stil:
 *
 *   1. Het commentaar bovenaan het bestand. Een YAML-schrijver kent het niet en
 *      schrijft het niet terug. (Opgelost: de noodzakelijke regels staan als
 *      `comment` bij het veld `items` in beheer/config.yml, en die schrijft
 *      Sveltia zélf elke keer terug. De achtergrond staat in
 *      content/LEESMIJ.txt.)
 *   2. De VORM van een meerdelig antwoord. Een gevouwen blok (`>`) met een
 *      witregel erin levert bij het inlezen één regelafbreking op — geen twee —
 *      en Sveltia schrijft dat terug als een letterlijk blok (`|-`) met twee
 *      regels zonder witregel ertussen. Las build-faq.mjs dat als gevouwen,
 *      dan plakte het die twee alinea's weer aan elkaar. Bij de prijsvraag
 *      betekende dat: het gele TODO-kader verdween, en de openstaande
 *      TODO-tekst belandde als gepubliceerd antwoord in de FAQ-structuurdata
 *      voor Google. Gemeten, niet beredeneerd: zie SVELTIA.md.
 *
 * WAT DEZE TOETS WEL EN NIET BEWIJST
 *
 * De schrijfkant is een NABOOTSING van Sveltia, niet Sveltia zelf: dezelfde
 * bibliotheek (`yaml`) en letterlijk dezelfde opties als
 * sveltia-cms/src/lib/services/contents/file/format.js (`formatYAML`) in de
 * versie die beheer/index.html vastpint. De leeskant is géén nabootsing: deze
 * toets gebruikt leesFaq() en keur() uit build-faq.mjs zelf. Een toets die ook
 * de lezer nabootst, bewijst iets over een kopie.
 *
 * Draai deze toets opnieuw bij elke versiesprong van Sveltia in
 * beheer/index.html. Dat is de hele reden dat die versie daar vastligt.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { leesFaq, keur } from './build-faq.mjs';

const hier = dirname(fileURLToPath(import.meta.url));

let yaml;
try {
  yaml = await import('yaml');
} catch {
  console.error(
    'STOP — de bibliotheek "yaml" ontbreekt. Zij staat in package.json als\n' +
    '       devDependency en hoort alleen bij deze toets; de bouw op Cloudflare\n' +
    '       draait zonder node_modules. Installeer ze eenmalig:  npm install',
  );
  process.exit(1);
}

const { parse, Document, isMap } = yaml;

let fouten = 0;
const ok = (wat) => console.log(`  ok    ${wat}`);
const fout = (wat, uitleg) => { fouten++; console.log(`  FOUT  ${wat}\n        ${uitleg}`); };

/* ---------------------------------------------- de schrijfkant van Sveltia ---
   Overgenomen uit sveltia-cms/src/lib/services/contents/file/format.js:
   addYAMLComments() en formatYAML(), met de standaardopties (quote: none,
   indent_size: 2, indent_sequences: true). formatEntryFile() plakt er voor een
   .yml-bestand nog een regeleinde achter: `${formatYAML(...)}\n`. */

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

/** Wat Sveltia na een opslag van het gegeven bestand zou wegschrijven. */
const naEenOpslag = (pad, comments) => {
  const data = parse(readFileSync(pad, 'utf8'));
  const inhoud = {
    // Sveltia trimt de waarde van een string- en een text-veld bij het opslaan.
    items: (data.items ?? []).map((it) => ({
      vraag: String(it.vraag ?? '').trim(),
      antwoord: String(it.antwoord ?? '').trim(),
    })),
  };
  return schrijfZoalsSveltia(inhoud, comments);
};

/* --------------------------------------------------------------- 1. config ---
   De afspraak is platte tekst in precies twee velden. Een markdown- of
   rich-text-veld zou vroeg of laat een "<" in de inhoud schrijven, en dan
   weigert de bouw het bestand. Daarom is dit een toets en geen afspraak op
   papier. */

console.log('\n1. beheer/config.yml — de velden');

const config = parse(readFileSync(join(hier, 'beheer', 'config.yml'), 'utf8'));
const bestand = (config.collections ?? [])
  .flatMap((c) => c.files ?? [])
  .find((f) => f.file === 'content/faq.yml');

let itemsVeld;

if (!bestand) {
  fout('content/faq.yml staat in beheer/config.yml', 'geen enkele collectie verwijst naar dat bestand');
} else {
  itemsVeld = (bestand.fields ?? []).find((f) => f.name === 'items');
  if (!itemsVeld) fout('het veld "items"', 'ontbreekt in de configuratie');
  else if (itemsVeld.widget !== 'list') fout('het veld "items"', `widget is "${itemsVeld.widget}", verwacht "list"`);
  else ok('het veld "items" is een lijst');

  const sub = (itemsVeld?.fields ?? []).map((f) => `${f.name}:${f.widget}`);
  const verwacht = ['vraag:string', 'antwoord:text'];
  if (sub.join(',') === verwacht.join(',')) ok('de velden zijn vraag (string) en antwoord (text) — platte tekst');
  else fout('de velden', `${sub.join(', ') || 'geen'} — verwacht ${verwacht.join(', ')}`);

  const rijk = (itemsVeld?.fields ?? []).filter((f) => ['markdown', 'richtext', 'code'].includes(f.widget));
  if (rijk.length) fout('geen opmaakveld', `"${rijk[0].name}" is een ${rijk[0].widget}-veld; dat schrijft HTML in de inhoud`);
  else ok('geen markdown-, rich-text- of code-veld');

  for (const f of itemsVeld?.fields ?? []) {
    const p = Array.isArray(f.pattern) ? f.pattern[0] : undefined;
    if (p && new RegExp(p).test('a') && !new RegExp(p).test('a<b')) ok(`"${f.name}" weigert een < al in de interface`);
    else fout(`"${f.name}" weigert een <`, `patroon ${p ?? 'ontbreekt'} doet dat niet`);
  }
}

/* ------------------------------------------------------- 2. de vorm van faq.yml
   Staat het bestand in git al in de vorm die Sveltia schrijft? Zo ja, dan is de
   eerste opslag van Jana een diff met alleen háár wijziging erin, en niet een
   herschrijving van het hele bestand waarin die wijziging niet te vinden is. */

console.log('\n2. content/faq.yml — de vorm');

const bronPad = join(hier, 'content', 'faq.yml');
const bronNu = readFileSync(bronPad, 'utf8');
const comments = itemsVeld?.comment ? { items: itemsVeld.comment } : {};
const naOpslag = naEenOpslag(bronPad, comments);

if (naOpslag === bronNu) ok('het bestand staat al in de vorm die het CMS schrijft (opslaan zonder wijziging verandert niets)');
else fout('de vorm', 'een opslag zonder wijziging herschrijft het bestand — draai de generator uit SVELTIA.md opnieuw');

const tmp = mkdtempSync(join(tmpdir(), 'faq-rondrit-'));
const tweedeRondePad = join(tmp, 'tweede-ronde.yml');
writeFileSync(tweedeRondePad, naOpslag);
if (naEenOpslag(tweedeRondePad, comments) === naOpslag) ok('een tweede opslag verandert er niets meer aan (stabiel)');
else fout('stabiliteit', 'elke opslag levert een ander bestand op');

if (itemsVeld?.comment) {
  const kopregels = bronNu.split('\n').filter((r) => r.startsWith('#')).length;
  if (kopregels > 0) ok(`de uitleg boven "items:" staat er (${kopregels} regels) en komt uit het veld "comment"`);
  else fout('de uitleg boven "items:"', 'staat niet in het bestand');
} else {
  fout('de uitleg boven "items:"', 'het veld "items" heeft geen "comment" in beheer/config.yml');
}

/* ------------------------------------------- 3. leest build-faq.mjs het nog ---
   De kern. Dezelfde inhoud in de drie vormen die een YAML-schrijver kan kiezen,
   door de échte lezer van build-faq.mjs, met hetzelfde resultaat — en met de
   TODO-alinea nog apart. */

console.log('\n3. build-faq.mjs — leest het de drie vormen hetzelfde?');

const naItems = keur(leesFaq(tweedeRondePad));
const nuItems = keur(leesFaq(bronPad));

if (JSON.stringify(naItems) === JSON.stringify(nuItems)) {
  ok(`na een opslag leest de bouw dezelfde ${naItems.length} vragen en dezelfde alinea's (dus dezelfde HTML)`);
} else {
  fout('de inhoud na een opslag', 'de bouw leest andere tekst dan vóór de opslag');
}

const schrijf = (naam, tekst) => { const p = join(tmp, naam); writeFileSync(p, tekst); return p; };

const vormen = {
  'gevouwen blok (>) met een witregel — met de hand getypt': `items:
  - vraag: Hoeveel kost het?
    antwoord: >
      De eerste alinea, over
      twee regels getypt.

      TODO — te bevestigen: de tweede alinea.
`,
  'letterlijk blok (|-) zonder witregel — wat het CMS schrijft': `items:
  - vraag: Hoeveel kost het?
    antwoord: |-
      De eerste alinea, over twee regels getypt.
      TODO — te bevestigen: de tweede alinea.
`,
  'dubbel aangehaald met \\n — wat een YAML-schrijver ook mag kiezen': `items:
  - vraag: Hoeveel kost het?
    antwoord: "De eerste alinea, over twee regels getypt.\\nTODO — te bevestigen: de tweede alinea."
`,
};

const verwachteAlineas = [
  'De eerste alinea, over twee regels getypt.',
  'TODO — te bevestigen: de tweede alinea.',
];

for (const [naam, tekst] of Object.entries(vormen)) {
  const [item] = keur(leesFaq(schrijf(`vorm-${Object.keys(vormen).indexOf(naam)}.yml`, tekst)));
  if (JSON.stringify(item.alineas) === JSON.stringify(verwachteAlineas)) ok(naam);
  else fout(naam, `twee alinea's verwacht, kreeg: ${JSON.stringify(item.alineas)}`);
}

console.log(
  fouten
    ? `\n${fouten} fout(en). De beheerpagina mag zo niet aan Jana gegeven worden.\n`
    : '\nAlles in orde — een opslag in /beheer/ levert dezelfde pagina op.\n',
);
process.exit(fouten ? 1 : 0);
