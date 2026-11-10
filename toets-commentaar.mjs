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
      /* Dezelfde herschrijfregels als publicatie/web.config. Zonder deze landt
         de gepubliceerde pagina na het versturen van het formulier op een 404
         terwijl de draft netjes op de bedankpagina komt — en dan vergelijk je
         twee verschillende pagina's met elkaar in plaats van twee versies van
         dezelfde. */
      if (/^\/bedankt\/?$/.test(p)) p = '/bedankt.html';
      if (/^\/cookies\/?$/.test(p)) p = '/cookies.html';
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


/* ───────────────────────────────────────────────────────────────────────────
   DEEL 2 — DOET DE CODE NOG HETZELFDE?

   Deel 1 vergelijkt het beeld, en dat bewijst de stijlen. Het bewijst niets
   over het JavaScript: een kapotte meetcode of een formulier dat niet meer
   verstuurt, ziet er op een schermafdruk precies hetzelfde uit.

   Daarom hier dezelfde handelingen op beide versies, en een vergelijking van
   wat de pagina DOET: welke gebeurtenissen in dataLayer komen, wat er naar
   Google en LinkedIn vertrekt, en wat het formulier verstuurt. De drafts en de
   publicatie moeten tot op het veld hetzelfde antwoord geven.
   ──────────────────────────────────────────────────────────────────────── */
console.log('');

/* Google's en LinkedIn's adressen dragen een willekeurige bezoeker-id en een
   tijdstempel. Die verschillen per lading en zeggen niets, dus blijft alleen
   over wat wél iets zegt. */
const INTERESSANT = ['en', 'tid', 'gcs', 'conversion_id', 'conversionId', 'pid', 'fmt'];
function kaal(url) {
  try {
    const u = new URL(url);
    const p = INTERESSANT.map((k) => (u.searchParams.has(k) ? `${k}=${u.searchParams.get(k)}` : null))
      .filter(Boolean).join('&');
    /* De twee servers draaien op verschillende poorten, dus zou de eigen host
       altijd verschillen. Hij zegt hier niets: het gaat om WAT er gevraagd
       wordt, niet van welke poort. */
    const host = u.hostname === '127.0.0.1' ? '(zelf)' : u.host;
    return host + u.pathname + (p ? '?' + p : '');
  } catch { return url; }
}

async function gedragVan(url, soort) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pag = await ctx.newPage();
  const verzoeken = [];
  const verstuurd = [];
  const fouten = [];
  pag.on('pageerror', (e) => fouten.push(String(e).split('\n')[0]));
  pag.on('console', (m) => { if (m.type() === 'error') fouten.push('console: ' + m.text().slice(0, 160)); });
  await pag.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  /* Alles wat naar buiten zou gaan wordt hier opgevangen en beantwoord, zodat
     deze toets met niemand buiten 127.0.0.1 praat. */
  /* Alleen verzoeken naar buiten. Zonder de hostbegrenzing vangt "linkedin"
     ook /assets/img/linkedin.svg van onze eigen server. */
  await pag.route(/^https?:\/\/(?!127\.0\.0\.1)[^/]*(googletagmanager|google-analytics|analytics\.google|linkedin|licdn|doubleclick|cloudflare)/i,
    async (r) => {
      verzoeken.push(kaal(r.request().url()));
      await r.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    });
  await pag.route(/\/request-demo/, async (r) => {
    verstuurd.push(r.request().postData());
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await pag.goto(url, { waitUntil: 'networkidle' });
  await pag.evaluate(() => document.fonts.ready);

  /* Geen enkele klik mag wegnavigeren: dan stopt de meting halverwege en
     vergelijken we twee verschillende momenten. */
  await pag.evaluate(() => {
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (a) e.preventDefault();
    }, true);
  });

  const toestaan = await pag.$('[data-cta="cookiebalk-toestaan"]');
  if (toestaan) { await toestaan.click(); await pag.waitForTimeout(1200); }

  /* Elke zichtbare haak één keer, in de volgorde waarin ze in de pagina staan. */
  const haken = await pag.$$eval('[data-cta]', (els) => els.map((e) => e.getAttribute('data-cta')));
  for (const h of haken) {
    const el = await pag.$(`[data-cta="${h}"]`);
    if (!el) continue;
    try { await el.click({ timeout: 1500, force: true }); } catch { /* onklikbaar: telt als niets */ }
  }
  await pag.waitForTimeout(400);

  if (soort === 'landing') {
    await pag.fill('#name', 'Toets Persoon');
    await pag.fill('#email', 'toets@voorbeeld.be');
    await pag.waitForTimeout(1600);          /* de drempel tegen te snel versturen */
    await pag.click('[data-cta="formulier-vraag-demo"]').catch(() => {});
    await pag.waitForTimeout(1200);
  }

  const dl = await pag.evaluate(() => (window.dataLayer || [])
    .map((r) => JSON.stringify({ event: r.event, cta: r.cta, cta_detail: r.cta_detail })));
  const koekjes = (await ctx.cookies()).map((c) => c.name).sort();
  await ctx.close();
  return { haken, dl, verzoeken: verzoeken.map(kaal), verstuurd, koekjes, fouten };
}

let gedragStuk = 0;
for (const [draft, doel, soort] of [
  [PAREN[0][0], PAREN[0][1], 'landing'],
  [PAREN[1][0], PAREN[1][1], 'bedankt'],
  [PAREN[2][0], PAREN[2][1], 'cookies'],
]) {
  const A = await gedragVan(`${BRON}/${draft}`, soort);
  const B = await gedragVan(`${UIT}/${doel}`, soort);
  const velden = [
    ['haken', A.haken, B.haken],
    ['gebeurtenissen', A.dl, B.dl],
    ['verzoeken', A.verzoeken, B.verzoeken],
    ['formulierinhoud', A.verstuurd, B.verstuurd],
    ['cookies', A.koekjes, B.koekjes],
    /* Hier staan altijd een paar net::ERR_FAILED-regels: dat zijn de
       lettertypeverzoeken die deze toets zelf afbreekt. Ze horen aan beide
       kanten even vaak voor te komen — een fout die alleen in de publicatie
       opduikt, is wél een echte. */
    ['scriptfouten', A.fouten, B.fouten],
  ];
  for (const [naam, x, y] of velden) {
    const zelfde = JSON.stringify(x) === JSON.stringify(y);
    if (!zelfde) gedragStuk++;
    console.log(`${zelfde ? 'OK ' : 'FOUT'}  ${doel} · ${naam}: ${x.length} tegen ${y.length}`);
    if (!zelfde) {
      const alleen = (p, q) => p.filter((v) => !q.includes(v)).slice(0, 4);
      console.log('      alleen in de draft     : ' + (JSON.stringify(alleen(x, y)) || '[]'));
      console.log('      alleen in de publicatie: ' + (JSON.stringify(alleen(y, x)) || '[]'));
    }
  }
}

await browser.close(); a.close(); b.close();
console.log(gedragStuk ? `\n${gedragStuk} gedragsverschil(len)` : 'En de code doet hetzelfde: gelijke gebeurtenissen, gelijke verzoeken, gelijk formulier.');
if (gedragStuk) process.exitCode = 1;

console.log(stuk ? `\n${stuk} verschil(len)` : '\nGeen enkel verschil: het commentaar droeg niets.');
process.exit(stuk ? 1 : 0);
