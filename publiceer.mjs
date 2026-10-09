#!/usr/bin/env node
/**
 * Stelt de publicatiemap samen: ALLEEN wat de twee productiepagina's werkelijk
 * nodig hebben.
 *
 *     node publiceer.mjs             # bouwt publicatie-uit/
 *     node publiceer.mjs --lijst     # zegt wat erin zou komen, schrijft niets
 *     node publiceer.mjs --uit=DIR   # een andere uitvoermap
 *     node publiceer.mjs --servermap # print alleen de doelmap op de server
 *
 * WAAROM DIT BESTAAT
 *
 * Deze repo is een werkmap, niet een site. 146 bestanden, 24 MB afbeeldingen,
 * 19 interne drafts, vijf hero-varianten, een reviewtool, een offerte en een
 * verbatim kopie van de huidige klantensite. De twee pagina's die de klant
 * straks publiek heeft staan, gebruiken daarvan 24 afbeeldingen.
 *
 * Een botte "upload de hele map" zet dus de andere 60 afbeeldingen, alle
 * interne drafts en de offerte op de productieserver van de klant. Dat is geen
 * ongeluk dat je achteraf opruimt — het staat op hun publieke domein zodra de
 * upload klaar is.
 *
 * Dus: deze stap LEIDT DE LIJST AF UIT DE PAGINA'S ZELF. Niets wat de twee
 * pagina's niet noemen, gaat mee. Er is geen handmatige lijst om bij te werken,
 * want een handmatige lijst is een lijst die ooit niet bijgewerkt is — en dan
 * mist er een foto op productie terwijl de bouw groen was.
 *
 * WAAROM EEN ONTBREKENDE VERWIJZING DE BOUW LAAT FALEN
 *
 * Stil overslaan zou betekenen: bouw groen, pagina met een gat erin. Dat is
 * precies het soort fout dat niemand ziet tot de klant het ziet. Dus stopt
 * deze stap, en publiceert de pijplijn niets. Beter de vorige pagina online dan
 * een kapotte nieuwe.
 *
 * WAAROM DE TWEE PAGINA'S IN DE WORTEL BLIJVEN
 *
 * draft-r3-01-definitief.html wordt index.html en draft-r3-02-bedankt.html
 * wordt bedankt.html, naast elkaar in de wortel. Niet bedankt/index.html: dan
 * zouden alle relatieve paden naar assets/ één niveau verkeerd staan. De mooie
 * URL /bedankt komt van een herschrijfregel in web.config, niet van de
 * mappenstructuur.
 *
 * LET OP BIJ LOKAAL DRAAIEN
 *
 * Deze stap eist dat `node stamp-version.mjs` eerst gedraaid heeft (zie de
 * controle op de versiestempel onderaan). Dat script SCHRIJFT in de drafts, en
 * die stempel hoort met opzet niet in git. Na lokaal proberen dus:
 *
 *     git checkout -- 'draft-*.html'
 */
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, statSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, posix, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// DE INSTELLING DIE JE KOMT VERANDEREN
//
// De map op de server waar de twee pagina's in terechtkomen. Hij staat hier en
// nergens anders: de GitHub Action leest hem op met `node publiceer.mjs
// --servermap`, zodat er geen tweede plek is die hem ook weet en die iemand
// vergeet.
//
// Sinds 2026-10-09 krijgt demo.youbo.io een EIGEN Azure-app, dus is dit de
// wortel van die app. Hing de pagina onder een bestaande app in een submap,
// dan stond hier `/site/wwwroot/demo/`.
//
// De FTPS-host, de gebruikersnaam en het wachtwoord staan hier met opzet NIET:
// die horen in de GitHub-secrets. Zie .github/workflows/publiceren.yml.
export const SERVERMAP = '/site/wwwroot/';

// De hostnamen waarop deze pagina straks staat. Een verwijzing als
// https://demo.youbo.io/assets/img/open_graph.png (de og:image) is geen externe
// link maar een verwijzing naar ons eigen bestand, en moet dus net zo goed
// meegeteld en net zo goed gecontroleerd worden.
export const PRODUCTIEHOSTS = ['demo.youbo.io'];

// Bron → naam op de server.
export const PAGINAS = [
  { bron: 'draft-r3-01-definitief.html', doel: 'index.html' },
  { bron: 'draft-r3-02-bedankt.html', doel: 'bedankt.html' },
];

// De adressen die deze site zelf heeft. Een interne link naar iets anders is
// een dode link, en die wil je bij de bouw weten en niet van de klant horen.
// /bedankt staat erbij omdat web.config die herschrijft naar bedankt.html.
const ROUTES = new Set(['/', '/index.html', '/bedankt', '/bedankt/', '/bedankt.html']);

const STANDAARD_UIT = 'publicatie-uit';
const WEBCONFIG_BRON = join(hier, 'publicatie', 'web.config');
// ─────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (argv.includes('--servermap')) {
  process.stdout.write(SERVERMAP + '\n');
  process.exit(0);
}
const alleenLijst = argv.includes('--lijst');
const uitArg = argv.find((a) => a.startsWith('--uit='));
const uitMap = join(hier, uitArg ? uitArg.slice('--uit='.length) : STANDAARD_UIT);

const fouten = [];
function fout(bericht) { fouten.push(bericht); }
function stop(bericht) { console.error('STOP — ' + bericht); process.exit(1); }

// ── Verwijzingen uit de HTML halen ──────────────────────────────────────────
//
// Commentaar eerst wegblanken, met dezelfde truc als check-drafts.mjs: dezelfde
// lengte eroverheen, zodat regelnummers blijven kloppen. Zonder dat stap zou
// deze bouw <script src="/js/footer.js"> meenemen — en dat staat in een
// commentaarblok dat uitlegt hoe de footer er op youbo.io ingehangen wordt. Het
// bestand bestaat hier niet, dus zou de bouw falen op een regel die een mens
// aan het uitleggen was.
const blankeerCommentaar = (h) => h.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));

// De attributen die een adres dragen. `content` zit er niet bij: dat is bijna
// altijd gewone tekst (de meta description), en alleen op een handvol
// afbeeldings-meta's een adres. Die staan apart.
const ADRES_ATTRIBUTEN = new Set([
  'src', 'href', 'poster', 'action', 'formaction',
  'data-src', 'data-poster', 'data-href', 'data-bg', 'data-background',
]);
const SRCSET_ATTRIBUTEN = new Set(['srcset', 'imagesrcset']);
const META_MET_ADRES = new Set([
  'og:image', 'og:image:url', 'og:image:secure_url',
  'twitter:image', 'twitter:image:src',
  'msapplication-tileimage', 'msapplication-config',
]);

function* attributen(tagInhoud) {
  const re = /([A-Za-z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let m;
  while ((m = re.exec(tagInhoud))) {
    const waarde = m[2] ?? m[3] ?? m[4] ?? '';
    yield [m[1].toLowerCase(), waarde];
  }
}

/** Elke lokale-of-externe adreswaarde in een pagina, met waar hij stond. */
function haalVerwijzingen(html, naam) {
  const schoon = blankeerCommentaar(html);
  const uit = [];
  const bij = (ruw, waar) => { if (ruw && ruw.trim()) uit.push({ ruw: ruw.trim(), waar }); };
  const regelVan = (index) => schoon.slice(0, index).split('\n').length;

  for (const tag of schoon.matchAll(/<([A-Za-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const naamTag = tag[1].toLowerCase();
    const attrs = new Map([...attributen(tag[2] || '')]);
    const waar = `${naam}:${regelVan(tag.index)} <${naamTag}>`;

    if (naamTag === 'meta') {
      const sleutel = (attrs.get('property') || attrs.get('name') || '').toLowerCase();
      if (META_MET_ADRES.has(sleutel)) bij(attrs.get('content'), `${waar} ${sleutel}`);
      continue;
    }
    for (const [a, v] of attrs) {
      if (ADRES_ATTRIBUTEN.has(a)) bij(v, `${waar} ${a}`);
      else if (SRCSET_ATTRIBUTEN.has(a)) {
        for (const kandidaat of v.split(',')) {
          bij(kandidaat.trim().split(/\s+/)[0], `${waar} ${a}`);
        }
      } else if (a === 'style') {
        for (const u of v.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) bij(u[2], `${waar} style`);
      }
    }
  }

  // url(...) in <style>-blokken. De twee pagina's hebben er vandaag geen, maar
  // een achtergrondafbeelding in de CSS is precies het soort verwijzing dat
  // later stil toegevoegd wordt.
  for (const blok of schoon.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const u of blok[1].matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      bij(u[2], `${naam}:${regelVan(blok.index)} <style> url()`);
    }
  }
  return uit;
}

const NIET_EEN_PAD = /^(#|data:|mailto:|tel:|sms:|javascript:|about:|blob:|ftp:)/i;

/**
 * Wat is dit voor verwijzing?
 *   extern   → niets te doen
 *   bestand  → moet bestaan en gaat mee naar de publicatiemap
 *   route    → een adres van deze site zelf; moet een adres zijn dat bestaat
 */
function duid(ruw) {
  if (NIET_EEN_PAD.test(ruw)) return { soort: 'extern' };

  let pad;
  if (/^https?:\/\//i.test(ruw) || ruw.startsWith('//')) {
    let u;
    try { u = new URL(ruw.startsWith('//') ? 'https:' + ruw : ruw); }
    catch { return { soort: 'extern' }; }
    if (!PRODUCTIEHOSTS.includes(u.hostname.toLowerCase())) return { soort: 'extern' };
    pad = decodeURI(u.pathname);                       // al vanaf de wortel
  } else {
    const zonderStaart = ruw.split('#')[0].split('?')[0];
    if (!zonderStaart) return { soort: 'extern' };
    // Beide pagina's staan in de wortel, dus is pagina-relatief hetzelfde als
    // wortel-relatief. Zou er ooit een pagina in een submap komen, dan hoort
    // hier de map van die pagina bij.
    pad = decodeURI(zonderStaart.startsWith('/') ? zonderStaart : '/' + zonderStaart);
  }

  const genormaliseerd = posix.normalize(pad);
  if (genormaliseerd.startsWith('/..')) return { soort: 'buiten', pad: genormaliseerd };

  const laatste = genormaliseerd.split('/').pop();
  const isBestand = laatste !== '' && laatste.includes('.') && !/\.html?$/i.test(laatste);
  return isBestand
    ? { soort: 'bestand', pad: genormaliseerd.replace(/^\//, '') }
    : { soort: 'route', pad: genormaliseerd };
}

// ── De pagina's lezen ───────────────────────────────────────────────────────
const bestanden = new Map();   // repo-relatief pad → [waar het genoemd werd]
const routes = new Map();

for (const { bron } of PAGINAS) {
  const pad = join(hier, bron);
  if (!existsSync(pad)) stop(`${bron} ontbreekt — dit is een van de twee productiepagina's`);
  const html = readFileSync(pad, 'utf8');

  // De bouw moet gedraaid hebben. Zonder stempel is de FAQ misschien ook niet
  // gebouwd, en dan publiceren we stilletjes de tekst van vorige maand — het
  // hele probleem dat deze pijplijn moet oplossen.
  if (!/<meta name="ontwerp-versie"/i.test(html)) {
    stop(`${bron} draagt geen versiestempel — draai eerst \`node stamp-version.mjs\`.\n`
      + '       (lokaal daarna opruimen met: git checkout -- \'draft-*.html\')');
  }

  for (const { ruw, waar } of haalVerwijzingen(html, bron)) {
    const d = duid(ruw);
    if (d.soort === 'extern') continue;
    if (d.soort === 'buiten') { fout(`${waar} → "${ruw}" wijst buiten de site`); continue; }
    const doel = d.soort === 'bestand' ? bestanden : routes;
    if (!doel.has(d.pad)) doel.set(d.pad, []);
    doel.get(d.pad).push(waar);
  }
}

// ── Elke verwijzing moet waar zijn ──────────────────────────────────────────
for (const [pad, plekken] of [...bestanden].sort()) {
  if (!existsSync(join(hier, pad))) {
    fout(`ontbrekend bestand: ${pad}\n        genoemd op: ${plekken.join(', ')}`);
  }
}
for (const [pad, plekken] of [...routes].sort()) {
  if (!ROUTES.has(pad)) {
    fout(`interne link naar een adres dat deze site niet heeft: ${pad}\n        genoemd op: ${plekken.join(', ')}`);
  }
}

if (fouten.length) {
  console.error(`\nSTOP — ${fouten.length} probleem(en); er wordt niets gepubliceerd:\n`);
  for (const f of fouten) console.error('  · ' + f);
  console.error('\nEen verwijzing die niet bestaat, wordt NIET stil overgeslagen: dat zou een');
  console.error('groene bouw met een gat in de pagina opleveren.\n');
  process.exit(1);
}

// ── Welke bestandstypen gaan mee, en kent web.config die? ───────────────────
if (!existsSync(WEBCONFIG_BRON)) stop('publicatie/web.config ontbreekt — IIS heeft die nodig');
const webconfig = readFileSync(WEBCONFIG_BRON, 'utf8');
const bekendeTypen = new Set(
  [...webconfig.matchAll(/<mimeMap\s+fileExtension="([^"]+)"/g)].map((m) => m[1].toLowerCase()),
);
const teUploadenTypen = new Set(
  [...bestanden.keys(), ...PAGINAS.map((p) => p.doel)].map((p) => extname(p).toLowerCase()),
);
for (const type of [...teUploadenTypen].sort()) {
  if (!bekendeTypen.has(type)) {
    fout(`publicatie/web.config kent "${type}" niet. IIS weigert elk type dat niet in zijn`
      + `\n        MIME-lijst staat en antwoordt 404.3 — een bestaand bestand dat "niet`
      + `\n        gevonden" heet. Voeg in publicatie/web.config toe, mét de <remove> ervoor:`
      + `\n          <remove fileExtension="${type}" />`
      + `\n          <mimeMap fileExtension="${type}" mimeType="…" />`);
  }
}
if (fouten.length) {
  console.error('\nSTOP — er wordt niets gepubliceerd:\n');
  for (const f of fouten) console.error('  · ' + f);
  console.error('');
  process.exit(1);
}

// ── Samenstellen ────────────────────────────────────────────────────────────
const lijst = [
  ...PAGINAS.map((p) => ({ van: p.bron, naar: p.doel })),
  { van: relative(hier, WEBCONFIG_BRON), naar: 'web.config' },
  ...[...bestanden.keys()].sort().map((p) => ({ van: p, naar: p })),
];

function bytes(pad) { return statSync(pad).size; }
const totaal = lijst.reduce((n, r) => n + bytes(join(hier, r.van)), 0);
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

if (alleenLijst) {
  for (const r of lijst) console.log(`${r.van}  →  ${r.naar}`);
  console.log(`\n(lijst) ${lijst.length} bestanden, ${mb(totaal)} → ${SERVERMAP}`);
  process.exit(0);
}

rmSync(uitMap, { recursive: true, force: true });
for (const r of lijst) {
  const doel = join(uitMap, r.naar);
  mkdirSync(dirname(doel), { recursive: true });
  cpSync(join(hier, r.van), doel);
}

// ── Nakijken wat er écht in de map staat ────────────────────────────────────
//
// Niet "wat ik dacht te kopiëren" maar "wat er ligt". De hele bestaansreden
// van deze stap is dat er niets meegaat wat er niet hoort, dus wordt dat op het
// resultaat gecontroleerd en niet op de bedoeling.
function wandel(map, voor = '') {
  const uit = [];
  for (const naam of readdirSync(map)) {
    const vol = join(map, naam);
    if (statSync(vol).isDirectory()) uit.push(...wandel(vol, posix.join(voor, naam)));
    else uit.push(posix.join(voor, naam));
  }
  return uit;
}
const inMap = wandel(uitMap).sort();

const sluipers = inMap.filter((p) => /(^|\/)draft-.*\.html$/i.test(p));
if (sluipers.length) stop(`er staat een draft in de publicatiemap: ${sluipers.join(', ')}`);

const htmlInMap = inMap.filter((p) => /\.html?$/i.test(p)).sort();
const verwacht = PAGINAS.map((p) => p.doel).sort();
if (htmlInMap.join('|') !== verwacht.join('|')) {
  stop(`andere HTML in de publicatiemap dan verwacht:\n       gevonden:  ${htmlInMap.join(', ')}\n       verwacht:  ${verwacht.join(', ')}`);
}
if (inMap.length !== lijst.length) {
  stop(`${inMap.length} bestanden in de map, ${lijst.length} verwacht`);
}

// ── Wat het geworden is ─────────────────────────────────────────────────────
const perType = new Map();
for (const p of inMap) {
  const t = extname(p).toLowerCase() || '(geen)';
  const v = perType.get(t) || { n: 0, b: 0 };
  v.n += 1; v.b += bytes(join(uitMap, p));
  perType.set(t, v);
}

console.log(`\nPublicatiemap: ${relative(hier, uitMap)}/   →  ${SERVERMAP}`);
console.log(`${inMap.length} bestanden, ${mb(totaal)}\n`);
for (const [t, v] of [...perType].sort((a, b) => b[1].b - a[1].b)) {
  console.log(`  ${String(v.n).padStart(3)} × ${t.padEnd(7)} ${mb(v.b).padStart(9)}`);
}
console.log(`\n  pagina's  : ${verwacht.join(', ')}  (in de wortel, dus assets/ blijft kloppen)`);
console.log(`  drafts    : 0  (van de ${readdirSync(hier).filter((f) => /^draft-.*\.html$/.test(f)).length} in de repo)`);
console.log(`  afbeeldingen: ${bestanden.size} van de ${readdirSync(join(hier, 'assets', 'img')).length} in assets/img`);
console.log('');
