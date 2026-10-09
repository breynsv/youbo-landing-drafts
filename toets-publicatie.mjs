#!/usr/bin/env node
/**
 * Vindt elke pagina in de publicatiemap alles wat ze vraagt?
 *
 *     node publiceer.mjs && node toets-publicatie.mjs
 *
 * WAT DEZE TOETS BEWIJST
 *
 * publiceer.mjs leidt de bestandslijst af uit de HTML met een eigen lezer. Die
 * lezer kan een SOORT verwijzing missen die er later bijkomt — een srcset, een
 * achtergrondafbeelding in CSS, een favicon in een vorm die vandaag niet
 * voorkomt. Dan is de lijst korter dan de waarheid, staat het bestand niet in
 * de map, en is de bouw groen. Deze toets zet een echte browser op de
 * publicatiemap en kijkt wat die browser werkelijk opvraagt. Dat is de enige
 * controle die een blinde vlek in de lezer kan zien.
 *
 * Ze scrolt de pagina helemaal uit, zodat loading="lazy" ook afgaat, en ze
 * bootst de drie dingen na die web.config op IIS doet: index.html als
 * standaarddocument, /bedankt → bedankt.html, en 404 voor een bestandstype
 * zonder MIME-regel.
 *
 * WAT ZE NIET BEWIJST
 *
 * Niets over IIS zelf. De server hierin is een node-servertje van vijftien
 * regels dat doet wat web.config BEDOELT; of IIS het ook zo doet, blijkt pas
 * bij de eerste publicatie. Zie PUBLICEREN.md.
 *
 * WAAROM ZE NIET IN DE GITHUB ACTION STAAT
 *
 * Ze heeft Playwright nodig, en package-lock.json staat in .gitignore. Zonder
 * lockfile is `npm ci` onmogelijk en zou de pijplijn bij elke publicatie een
 * ongepinde browser binnenhalen — een nieuwe faalkans vlak voor een upload naar
 * de klant. Dus staat ze hier, en hoort ze gedraaid te worden wanneer er aan de
 * STRUCTUUR van een van de twee pagina's iets verandert.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const WORTEL = new URL('./publicatie-uit/', import.meta.url).pathname;
const TYPEN = { '.html':'text/html', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png' };

const srv = createServer((req, res) => {
  let p = decodeURI(req.url.split('?')[0]);
  if (/^\/bedankt\/?$/.test(p)) p = '/bedankt.html';          // de herschrijfregel
  if (p.endsWith('/')) p += 'index.html';                       // het standaarddocument
  const vol = join(WORTEL, p);
  if (!vol.startsWith(WORTEL) || !existsSync(vol) || statSync(vol).isDirectory()) {
    res.writeHead(404); return res.end('404');
  }
  const t = TYPEN[extname(vol).toLowerCase()];
  if (!t) { res.writeHead(404); return res.end('404.3 — geen MIME-type'); }  // wat IIS doet
  res.writeHead(200, { 'Content-Type': t });
  res.end(readFileSync(vol));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const basis = `http://127.0.0.1:${srv.address().port}`;

const browser = await chromium.launch({ headless: true });
let stuk = 0;
for (const [naam, url] of [['/', basis + '/'], ['/bedankt', basis + '/bedankt']]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  const mislukt = [];
  pg.on('requestfailed', (r) => mislukt.push(['requestfailed', r.url()]));
  pg.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(basis)) mislukt.push([r.status(), r.url()]); });
  await pg.goto(url, { waitUntil: 'networkidle' });
  // helemaal naar beneden en terug, zodat loading="lazy" ook afgaat
  await pg.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await pg.waitForLoadState('networkidle');
  const stukkeAfb = await pg.evaluate(() => [...document.images]
    .filter((i) => i.getBoundingClientRect().width > 0 && i.complete && i.naturalWidth === 0)
    .map((i) => i.currentSrc || i.src));
  const titel = await pg.title();
  console.log(`\n${naam}  →  "${titel}"`);
  console.log(`  eigen verzoeken die faalden : ${mislukt.length}`);
  for (const [s, u] of mislukt) console.log(`    ${s}  ${u.replace(basis, '')}`);
  console.log(`  <img> die niet laadden      : ${stukkeAfb.length}`);
  for (const u of stukkeAfb) console.log(`    ${u.replace(basis, '')}`);
  stuk += mislukt.length + stukkeAfb.length;
  await ctx.close();
}
await browser.close();
srv.close();
console.log(`\n${stuk === 0 ? 'ALLES GEVONDEN' : stuk + ' PROBLE(E)M(EN)'}\n`);
process.exit(stuk === 0 ? 0 : 1);
