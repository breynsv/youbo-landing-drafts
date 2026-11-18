#!/usr/bin/env node
/**
 * Bouwt de vaste CSS van de drie pagina's die naar demo.youbo.io gaan.
 *
 *     node bouw-css.mjs          # bouwt, schrijft assets/css/, zet de hash in de pagina's
 *     node bouw-css.mjs --check  # bouwt in het geheugen; exit 1 als de repo achterloopt
 *
 * (`npm run build:css` doet het eerste.)
 *
 * WAAROM DIT BESTAAT
 *
 * Tot 2026-11-18 laadden de pagina's cdn.tailwindcss.com. Die maakt de CSS pas
 * in de browser: eerst ~400 kB javascript downloaden en uitvoeren, dan pas
 * opmaak. Op een telefoon in de browser van de LinkedIn-app gaf dat een trage
 * eerste weergave en een flits zonder opmaak — op de pagina waar betaald
 * LinkedIn-verkeer op landt. Nu is het één geminificeerd stylesheet per pagina.
 *
 * TWEE BUNDELS, EN NIET ÉÉN
 *
 * De landingspagina en de twee lichte pagina's (bedankt, cookies) hadden elk
 * hun EIGEN <style type="text/tailwindcss">-blok, en die verschillen. Ze
 * samenvoegen zou de regels van de ene pagina over de andere leggen — dezelfde
 * selector met een andere waarde, een @media-blok dat er eerst niet was. Dan
 * ziet de pagina er niet meer hetzelfde uit, en dat was de eis. Dus bouwt
 * elke bundel uit haar eigen bron en scant ze alleen haar eigen pagina's.
 *
 *   landing  css/landing.css  ← draft-r3-01-definitief.html (+ wat er markup voor maakt)
 *   licht    css/licht.css    ← draft-r3-02-bedankt.html, draft-r3-03-cookies.html
 *
 * WAT DE CDN DEED, EN DUS WAT DIT OOK DOET
 *
 * De CDN draaide Tailwind 3.4.17 met deze config, zonder plugins, en daarna
 * autoprefixer. Dit script doet hetzelfde met dezelfde versies (exact
 * vastgezet in package.json), en minificeert met esbuild — dat al een
 * afhankelijkheid van publiceer.mjs was.
 *
 * WAAROM DE HASH IN DE BESTANDSNAAM
 *
 * assets/ krijgt op de server 30 dagen cache (publicatie/web.config). Met de
 * inhoud in de naam is een nieuwe build een nieuw adres, dus ziet niemand ooit
 * een oude stylesheet bij een nieuwe pagina. Het script zet de nieuwe naam
 * zelf in de pagina's en ruimt de vorige bestanden van die bundel op.
 *
 * WAAROM HET COMMENTAAR NIET GESCAND WORDT
 *
 * De pagina's staan vol uitleg in HTML-commentaar, en daarin staan woorden die
 * ook een Tailwind-klasse zijn. Die zouden regels opleveren voor iets dat nooit
 * op de pagina komt. HTML-commentaar wordt dus weggeblankt vóór het scannen —
 * dezelfde truc als check-drafts.mjs en publiceer.mjs. Commentaar wordt nooit
 * een element, dus kan daar ook nooit een klasse vandaan komen.
 *
 * WAT HIER NIET GESCAND WORDT, EN WAAR HET DAN WEL MOET STAAN
 *
 * Tailwind ziet alleen klassen die LETTERLIJK in een bronbestand staan. Een
 * klasse die javascript in elkaar plakt ('bg-' + kleur) bestaat voor de scan
 * niet. Op 2026-11-18 gemeten: er zijn er geen. Komt er ooit een, zet hem in
 * `safelist` in tailwind.config.js.
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { transform } from 'esbuild';
import config from './tailwind.config.js';

const hier = dirname(fileURLToPath(import.meta.url));
const UITMAP = 'assets/css';

export const BUNDELS = [
  {
    naam: 'landing',
    bron: 'css/landing.css',
    paginas: ['draft-r3-01-definitief.html'],
    /* Wat er markup voor deze pagina maakt zonder er letterlijk in te staan:
       de FAQ-lijst en de inhoudsvelden worden bij de bouw uit deze twee
       bestanden in de pagina gezet, en /beheer/ toont zijn voorbeeld met déze
       stylesheet en een paar eigen klassen. */
    extra: ['faq-opmaak.js', 'inhoud-opmaak.js', 'beheer/voorbeeld.js'],
  },
  {
    naam: 'licht',
    bron: 'css/licht.css',
    paginas: ['draft-r3-02-bedankt.html', 'draft-r3-03-cookies.html'],
    extra: [],
  },
];

const blankeerCommentaar = (h) => h.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
const LINK = (naam) => new RegExp(`(<link rel="stylesheet" href=")${UITMAP}/${naam}\\.[0-9a-f]{10}\\.css(">)`, 'g');

export async function bouwBundel(b) {
  const content = [
    ...b.paginas.map((p) => ({ raw: blankeerCommentaar(readFileSync(join(hier, p), 'utf8')), extension: 'html' })),
    ...b.extra.map((p) => ({ raw: readFileSync(join(hier, p), 'utf8'), extension: 'js' })),
  ];
  const { css } = await postcss([
    tailwindcss({ ...config, content }),
    autoprefixer({ remove: false }), // zoals de CDN
  ]).process(readFileSync(join(hier, b.bron), 'utf8'), { from: join(hier, b.bron) });
  /* Alleen witruimte en commentaar. minifySyntax staat met opzet UIT: die
     herschrijft ook custom properties (--m-telop: 1400ms wordt 1.4s), en de
     pagina leest --m-telop uit in javascript als duur van de tellers — met
     parseFloat('1.4s') liep die teller dan in 1,4 ms. Gemeten 2026-11-18.
     Het kost ~0,1 kB na gzip. */
  const { code } = await transform(css, { loader: 'css', minifyWhitespace: true, legalComments: 'none' });
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 10);
  return { code, hash, bestand: `${UITMAP}/${b.naam}.${hash}.css` };
}

const alleenCheck = process.argv.includes('--check');
let achter = 0;

for (const b of BUNDELS) {
  const { code, bestand } = await bouwBundel(b);
  const re = LINK(b.naam);

  for (const p of b.paginas) {
    const pad = join(hier, p);
    const html = readFileSync(pad, 'utf8');
    const treffers = html.match(re) ?? [];
    if (treffers.length !== 1) {
      console.error(`STOP — ${p} moet precies één <link> naar ${UITMAP}/${b.naam}.<hash>.css hebben, er zijn er ${treffers.length}`);
      process.exit(1);
    }
    const nieuw = html.replace(re, `$1${bestand}$2`);
    if (nieuw !== html) {
      if (alleenCheck) { console.error(`achter: ${p} wijst niet naar ${bestand}`); achter++; }
      else writeFileSync(pad, nieuw);
    }
  }

  const doel = join(hier, bestand);
  if (!existsSync(doel) || readFileSync(doel, 'utf8') !== code) {
    if (alleenCheck) { console.error(`achter: ${bestand} ontbreekt of is anders`); achter++; }
    else writeFileSync(doel, code);
  }
  // Oude builds van deze bundel weg — de pagina's wijzen er niet meer naar.
  for (const f of readdirSync(join(hier, UITMAP))) {
    if (f.startsWith(b.naam + '.') && f.endsWith('.css') && `${UITMAP}/${f}` !== bestand) {
      if (alleenCheck) { console.error(`achter: ${UITMAP}/${f} is een oude build`); achter++; }
      else unlinkSync(join(hier, UITMAP, f));
    }
  }
  console.log(`${b.naam.padEnd(8)} ${bestand}  ${(Buffer.byteLength(code) / 1024).toFixed(1)} kB`);
}

if (alleenCheck && achter) {
  console.error(`\nDe gebouwde CSS loopt achter op de bron. Draai: npm run build:css`);
  process.exit(1);
}
