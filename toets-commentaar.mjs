#!/usr/bin/env node
/**
 * TOETST: dat publiceer.mjs met het commentaar niets anders meeneemt.
 *
 *     node publiceer.mjs && node toets-commentaar.mjs
 *
 * Sinds 2026-11-10 haalt de publicatiestap al het HTML-commentaar uit de drie
 * pagina's — ruim 100 kB intern werklogboek dat anders op de server van de
 * klant leesbaar staat. De drafts houden het; de publicatie niet.
 *
 * Een vervanging met een reguliere uitdrukking over een bestand van 380 kB is
 * precies het soort ingreep dat één teken te veel of te weinig pakt zonder dat
 * iets stuk lijkt. publiceer.mjs controleert daarom zelf al dat er nul
 * commentaarblokken overblijven en dat de link naar trouvee.be er nog in staat
 * — maar dat zegt niets over wat de bezoeker ziet.
 *
 * Deze toets zegt dat wel: hij zet de draft en de gepubliceerde pagina naast
 * elkaar in een echte browser, op 1440 en 390 px, en vergelijkt de tekst, het
 * aantal elementen, het aantal zichtbare elementen, de hoogte tot op de pixel
 * en het volledige beeld. Twee lokale servers, zodat /assets/… aan beide
 * kanten echt oplost en geen van beide op ontbrekende beelden valt.
 *
 * WAT ER MIS GING TOEN HIJ GESCHREVEN WERD, en waarom hij nu wacht
 * De eerste versie was soms groen en soms rood op dezelfde bestanden. Twee
 * oorzaken, allebei in de toets en niet in de pagina: de beweging werd pas ná
 * het laden uitgezet, en er werd niet gewacht tot de webfont geladen was. In
 * dat laatste geval legt de ene render Inter vast en de andere de
 * terugvalletter, en dan verschilt élke tekstregel een paar pixels.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const TYPEN = { '.html':'text/html', '.svg':'image/svg+xml', '.webp':'image/webp',
  '.png':'image/png', '.pdf':'application/pdf', '.json':'application/json',
  '.js':'text/javascript', '.css':'text/css' };

/* Poort 0 laat het systeem er een kiezen. Met vaste poorten botsen twee
   doorlopen kort na elkaar op een socket die nog in TIME_WAIT staat, en dan
   valt de toets om op iets dat niets met de pagina's te maken heeft. */
function serveer(wortel) {
  return new Promise((ok) => {
    const s = createServer((req, res) => {
      let p = decodeURI(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const vol = join(wortel, p);
      if (!existsSync(vol)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPEN[extname(vol).toLowerCase()] || 'application/octet-stream' });
      res.end(readFileSync(vol));
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}

const PAREN = [
  ['draft-r3-01-definitief.html', 'index.html'],
  ['draft-r3-02-bedankt.html',    'bedankt.html'],
  ['draft-r3-03-cookies.html',    'cookies.html'],
];
const BREEDTES = [[1440, 900], [390, 844]];

/* Deze toets vergelijkt de draft met wat publiceer.mjs ervan maakte, dus moet
   die bouw van de drafts van NU zijn. Staat de versiestempel in het ene wel en
   in het andere niet, dan verschillen de pagina's met twee <meta>-elementen en
   leest dat als zes raadselachtige verschillen in plaats van als "je bent een
   stap vergeten". */
for (const [draft, doel] of PAREN) {
  const d = readFileSync(draft, 'utf8');
  const p = existsSync(join('publicatie-uit', doel))
    ? readFileSync(join('publicatie-uit', doel), 'utf8') : null;
  if (p === null) {
    console.error(`STOP — publicatie-uit/${doel} bestaat niet. Draai eerst:\n`
      + '       node stamp-version.mjs && node publiceer.mjs');
    process.exit(2);
  }
  const stempel = /<meta name="ontwerp-versie"/;
  if (stempel.test(d) !== stempel.test(p)) {
    console.error(`STOP — ${draft} en publicatie-uit/${doel} lopen uiteen op de\n`
      + '       versiestempel, dus die bouw is niet van deze drafts. Draai eerst:\n'
      + '       node stamp-version.mjs && node publiceer.mjs');
    process.exit(2);
  }
}

const a = await serveer(process.cwd());
const b = await serveer(join(process.cwd(), 'publicatie-uit'));
const BRON = `http://127.0.0.1:${a.address().port}`;
const UIT  = `http://127.0.0.1:${b.address().port}`;
const browser = await chromium.launch();
let stuk = 0;

async function meet(url, breedte, hoogte) {
  const pag = await browser.newPage({ viewport: { width: breedte, height: hoogte } });
  /* Eerst de beweging uitzetten, dan pas laden. Andersom draait de pagina haar
     intro-animatie al af voordat de rem erop staat, en dan hangt het van de
     timing af welk beeld je vastlegt — precies wat een pixelvergelijking
     onbruikbaar maakt. */
  await pag.emulateMedia({ reducedMotion: 'reduce' });
  /* Inter komt van Google Fonts met display=swap. Elke paginalading haalt hem
     opnieuw op, en of hij er is op het moment van de schermafdruk hangt van
     het netwerk af — niet van de pagina. Daardoor legt de ene render Inter
     vast en de andere de terugvalletter, en verschilt élke tekstregel een paar
     pixels zonder dat er iets aan de pagina scheelt. (Eerst alleen wachten op
     document.fonts.ready was niet genoeg: bij swap tekent de browser al vóór
     dat moment.) Deze toets gaat over de HTML en niet over het netwerk, dus
     krijgen beide kanten dezelfde letter: geen. */
  await pag.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await pag.goto(url, { waitUntil: 'networkidle' });
  await pag.evaluate(() => document.fonts.ready);
  await pag.waitForTimeout(800);
  const gegevens = await pag.evaluate(() => ({
    tekst: document.body.innerText.replace(/\s+/g, ' ').trim(),
    elementen: document.querySelectorAll('*').length,
    zichtbaar: [...document.querySelectorAll('body *')]
      .filter((e) => e.getBoundingClientRect().width > 0).length,
    breed: document.documentElement.scrollWidth,
    hoog: document.documentElement.scrollHeight,
  }));
  const beeld = await pag.screenshot({ fullPage: true, animations: 'disabled' });
  await pag.close();
  return { ...gegevens, beeld };
}

for (const [draft, doel] of PAREN) {
  for (const [w, h] of BREEDTES) {
    const A = await meet(`${BRON}/${draft}`, w, h);
    const B = await meet(`${UIT}/${doel}`, w, h);
    const zelfde = A.tekst === B.tekst && A.elementen === B.elementen
      && A.zichtbaar === B.zichtbaar && A.breed === B.breed && A.hoog === B.hoog
      && A.beeld.equals(B.beeld);
    console.log(`${zelfde ? 'OK ' : 'FOUT'}  ${doel} @ ${w}px — ${A.elementen}/${B.elementen} elementen, `
      + `${A.hoog}/${B.hoog}px hoog, beeld ${A.beeld.equals(B.beeld) ? 'gelijk' : 'VERSCHILT'}`);
    if (!zelfde) {
      stuk++;
      if (A.tekst !== B.tekst) {
        const i = [...A.tekst].findIndex((c, n) => c !== B.tekst[n]);
        console.log(`      tekst wijkt af vanaf ${i}: …${A.tekst.slice(i - 60, i + 60)}…`);
        console.log(`                        tegen: …${B.tekst.slice(i - 60, i + 60)}…`);
      }
      writeFileSync(`qa/strip-${doel}-${w}-draft.png`, A.beeld);
      writeFileSync(`qa/strip-${doel}-${w}-publicatie.png`, B.beeld);
    }
  }
}

await browser.close(); a.close(); b.close();
console.log(stuk ? `\n${stuk} verschil(len)` : '\nGeen enkel verschil: het commentaar droeg niets.');
process.exit(stuk ? 1 : 0);
