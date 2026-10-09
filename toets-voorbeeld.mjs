#!/usr/bin/env node
/**
 * Toetst het voorbeeldvenster van /beheer/ — door het te METEN tegen de echte
 * pagina, niet door ernaar te kijken.
 *
 *     node toets-voorbeeld.mjs
 *
 * WAAROM METEN EN NIET KIJKEN
 *
 * Een voorbeeld dat liegt is erger dan geen voorbeeld: Jana zou tekst schrijven
 * voor een pagina die er anders uitziet dan wat ze voor zich heeft. "Het lijkt
 * goed" is daar geen antwoord op. Deze toets zet de echte pagina en het
 * voorbeeld naast elkaar in dezelfde browser, klapt in allebei dezelfde zes
 * vragen open, en vergelijkt per vraag de BEREKENDE stijlen van de knop en van
 * elke alinea — lettertype, grootte, gewicht, kleur, achtergrond, kader — plus
 * de HTML zelf. Eén verschil en de toets is rood.
 *
 * WAT HET OOK NAKIJKT
 *
 * Dat Sveltia het voorbeeld werkelijk toont. Dat is een aparte vraag: de
 * opmaak kan kloppen terwijl de registratie bij het CMS niet aankomt. Dus
 * start deel 3 de echte beheerpagina, typt er een vraag in, en kijkt of die
 * vraag in het voorbeeldvenster verschijnt.
 *
 * WAT HET NIET KAN
 *
 * Aanmelden bij GitHub. Daarvoor wisselt deel 3 de backend om naar Sveltia's
 * eigen `test-repo` (een lege map in de browser) — alleen de BACKEND, de rest
 * van beheer/config.yml wordt gelezen zoals hij is, inclusief de velden, de
 * labels en de voorbeeldinstelling. Er wordt dus niets naar GitHub gestuurd en
 * niets aan de klant.
 *
 * De browser is een eigen headless Chromium op een eigen poort; de gedeelde
 * browser op 9222/9223 wordt niet aangeraakt. De server is een eigen
 * node-servertje op een vrije poort, dat na afloop stopt.
 *
 * Schermafdrukken komen in qa/voorbeeld/ (die map is gitignored).
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parse, stringify } from 'yaml';
import { leesFaq, keur } from './build-faq.mjs';

const hier = dirname(fileURLToPath(import.meta.url));
const KIEKJES = join(hier, 'qa', 'voorbeeld');
mkdirSync(KIEKJES, { recursive: true });

let fouten = 0;
const groen = (t) => `\x1b[32m${t}\x1b[0m`;
const rood = (t) => `\x1b[31m${t}\x1b[0m`;
const grijs = (t) => `\x1b[2m${t}\x1b[0m`;
const ok = (wat, waar, extra = '') => {
  if (waar) console.log(`  ${groen('ok')}    ${wat}${extra ? grijs('  ' + extra) : ''}`);
  else { fouten++; console.log(`  ${rood('FOUT')}  ${wat}${extra ? '\n        ' + extra : ''}`); }
};

/* ------------------------------------------------------------- de server --- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.yml': 'text/yaml',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

const server = createServer((req, res) => {
  let pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pad.endsWith('/')) pad += 'index.html';
  const vol = join(hier, pad);
  if (!vol.startsWith(hier) || !existsSync(vol) || !statSync(vol).isFile()) {
    res.writeHead(404); res.end('niet hier'); return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(vol)] || 'application/octet-stream' });
  res.end(readFileSync(vol));
});
await new Promise((k) => server.listen(0, '127.0.0.1', k));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* ---------------------------------------------------------- het meetlint --- */

// Wordt in BEIDE documenten uitgevoerd. Geeft per vraag terug wat de browser
// werkelijk tekent — niet wat er in de klassenamen staat.
const METEN = `(() => {
  const sectie = document.querySelector('section[aria-labelledby="faq-titel"]');
  if (!sectie) return { fout: 'geen FAQ-sectie' };
  const stijl = (el, velden) => {
    const c = getComputedStyle(el);
    const uit = {};
    for (const v of velden) uit[v] = c[v];
    return uit;
  };
  const KNOP = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'paddingTop', 'paddingBottom'];
  const ALINEA = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'backgroundColor',
                  'borderStyle', 'borderColor', 'borderWidth', 'borderRadius', 'paddingTop', 'marginTop'];
  const vragen = [...sectie.querySelectorAll('h3 button')];
  return {
    aantal: vragen.length,
    titel: sectie.querySelector('h2')?.textContent.trim(),
    vragen: vragen.map((knop, k) => {
      const paneel = sectie.querySelector('#faq-' + k);
      const zichtbaar = paneel && paneel.offsetParent !== null;
      return {
        tekst: knop.querySelector('span')?.textContent.trim(),
        knop: stijl(knop, KNOP),
        zichtbaar,
        alineas: zichtbaar ? [...paneel.querySelectorAll('p')].map((p) => ({
          klasse: p.className,
          tekst: p.textContent.replace(/\\s+/g, ' ').trim(),
          stijl: stijl(p, ALINEA),
        })) : null,
      };
    }),
  };
})()`;

async function openAlles(frame, aantal) {
  // Eén voor één openklappen en meten: op de pagina kan er maar één tegelijk
  // open staan, en dat is juist wat we willen nameten.
  const perVraag = [];
  for (let k = 0; k < aantal; k += 1) {
    await frame.evaluate((i) => {
      const s = document.querySelector('section[aria-labelledby="faq-titel"]');
      const knoppen = s.querySelectorAll('h3 button');
      // Alleen klikken op wat nog dicht is. Het voorbeeld opent de eerste vraag
      // uit zichzelf (zoals de knop die Jana net aanklikte openblijft), de
      // pagina begint met alles dicht — zonder deze regel zou de toets de
      // eerste vraag juist dichtklikken en zichzelf rood maken.
      if (knoppen[i].getAttribute('aria-expanded') !== 'true') knoppen[i].click();
    }, k);
    await frame.waitForTimeout?.(350);
    await new Promise((r) => setTimeout(r, 350));
    const meting = await frame.evaluate(METEN);
    perVraag.push(meting.vragen[k]);
  }
  return perVraag;
}

/* ------------------------------------------------------------------ doen --- */

const items = keur(leesFaq(join(hier, 'content', 'faq.yml')));
const browser = await chromium.launch();

try {
  /* 1 · het knippen zelf */
  console.log('\n1. Het voorbeeld knipt de echte pagina — zonder te raden');

  const knipPagina = await browser.newPage();
  const knipFouten = [];
  knipPagina.on('pageerror', (e) => knipFouten.push(e.message));
  await knipPagina.goto(`${ORIGIN}/beheer/`, { waitUntil: 'domcontentloaded' });
  const schil = await knipPagina.evaluate(async (origin) => {
    const mod = await import(`${origin}/beheer/voorbeeld.js`);
    const s = await mod.haalSchil();
    return {
      kopLengte: s.kop.length,
      tailwind: s.kop.includes('cdn.tailwindcss.com'),
      tokens: s.kop.includes("brand:   { DEFAULT: '#0af29f'"),
      tailwindBlok: s.kop.includes('<style type="text/tailwindcss">'),
      lettertype: s.kop.includes('fonts.googleapis.com'),
      alpine: s.alpine,
      sectie: s.voor.slice(0, 120),
      lichaamKlasse: s.lichaamKlasse,
      lijst: mod.lijstVanItems(mod.itemsUitVelden([
        { vraag: 'Een vraag?', antwoord: 'Een antwoord.\nEn nog een alinea.' },
      ])),
    };
  }, ORIGIN);

  ok('de Tailwind-CDN van de pagina komt mee', schil.tailwind);
  ok('de huisstijltokens komen mee (het groen, letterlijk uit de pagina)', schil.tokens);
  ok('het hele tailwindcss-blok komt mee', schil.tailwindBlok);
  ok('de lettertypen komen mee', schil.lettertype);
  ok('Alpine komt mee, anders klapt er niets open',
     /alpinejs/.test(schil.alpine) && /collapse/.test(schil.alpine));
  ok('de FAQ-sectie zelf wordt uitgeknipt, niet nagebouwd',
     schil.sectie.startsWith('<section') && schil.sectie.includes('faq-titel'));
  ok('de body-klasse van de pagina komt mee', schil.lichaamKlasse.length > 0, schil.lichaamKlasse);
  ok('de lijst wordt met faq-opmaak.js gemaakt — dezelfde HTML als de bouw',
     schil.lijst.includes('data-cta=') && schil.lijst.includes('x-collapse'));
  ok('geen enkele fout in de console bij het knippen', knipFouten.length === 0,
     knipFouten.join(' · '));
  await knipPagina.close();

  /* 2 · de meting tegen de echte pagina */
  console.log('\n2. Het voorbeeld naast de echte pagina — gemeten, per vraag');

  const echt = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await echt.goto(`${ORIGIN}/draft-r3-01-definitief.html`, { waitUntil: 'load' });
  await echt.waitForTimeout(1500);
  const echtAantal = (await echt.evaluate(METEN)).aantal;

  const voorbeeld = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await voorbeeld.goto(`${ORIGIN}/beheer/`, { waitUntil: 'domcontentloaded' });
  await voorbeeld.evaluate(async ({ origin, items }) => {
    const mod = await import(`${origin}/beheer/voorbeeld.js`);
    const schil = await mod.haalSchil();
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    const frame = document.createElement('iframe');
    frame.id = 'venster';
    frame.style.cssText = 'width:1280px;height:1000px;border:0;display:block';
    frame.srcdoc = mod.bouwVoorbeeldDocument(schil);
    document.body.appendChild(frame);
    await new Promise((k) => frame.addEventListener('load', k, { once: true }));
    // Dezelfde weg als in het CMS: de lijst gaat als bericht naar het venster.
    frame.contentWindow.postMessage(
      { soort: 'faq-voorbeeld', html: mod.lijstVanItems(mod.itemsUitVelden(items)) }, '*');
  }, { origin: ORIGIN, items: items.map((i) => ({ vraag: i.vraag, antwoord: i.alineas.join('\n') })) });
  await voorbeeld.waitForTimeout(3500);

  const venster = voorbeeld.frames().find((f) => f !== voorbeeld.mainFrame());
  ok('het voorbeeldvenster staat er', !!venster);

  const meting = await venster.evaluate(METEN);
  ok(`het voorbeeld toont evenveel vragen als de pagina (${echtAantal})`,
     meting.aantal === echtAantal, `voorbeeld: ${meting.aantal}`);
  ok('en dezelfde sectietitel', meting.titel === 'Veelgestelde vragen', meting.titel);

  const echtPer = await openAlles(echt, echtAantal);
  const voorbeeldPer = await openAlles(venster, meting.aantal);

  for (let k = 0; k < echtAantal; k += 1) {
    const a = echtPer[k];
    const b = voorbeeldPer[k];
    const kort = (a.tekst || '').slice(0, 42);
    const verschil = (x, y) => (JSON.stringify(x) === JSON.stringify(y)
      ? '' : `pagina: ${JSON.stringify(x)}\n        voorbeeld: ${JSON.stringify(y)}`);
    ok(`vraag ${k + 1} — dezelfde tekst`, a.tekst === b.tekst, verschil(a.tekst, b.tekst));
    ok(`vraag ${k + 1} — de knop is letter voor letter dezelfde opmaak`,
       JSON.stringify(a.knop) === JSON.stringify(b.knop), verschil(a.knop, b.knop));
    ok(`vraag ${k + 1} — het antwoord klapt open`, a.zichtbaar && b.zichtbaar);
    ok(`vraag ${k + 1} — dezelfde alinea's, dezelfde opmaak ${grijs(kort)}`,
       JSON.stringify(a.alineas) === JSON.stringify(b.alineas), verschil(a.alineas, b.alineas));
  }

  const todoEcht = echtPer.flatMap((v) => (v.alineas || []).filter((p) => /todo/.test(p.klasse)));
  const todoVoorbeeld = voorbeeldPer.flatMap((v) => (v.alineas || []).filter((p) => /todo/.test(p.klasse)));
  ok('het TODO-kader staat er in allebei, en ziet er hetzelfde uit',
     todoEcht.length > 0 && JSON.stringify(todoEcht) === JSON.stringify(todoVoorbeeld),
     `pagina: ${todoEcht.length} kader(s) · voorbeeld: ${todoVoorbeeld.length}`);

  await venster.evaluate(() => {
    const s = document.querySelector('section[aria-labelledby="faq-titel"]');
    const knoppen = [...s.querySelectorAll('h3 button')];
    const todo = knoppen.findIndex((k) => /kost het/i.test(k.textContent));
    knoppen[todo > -1 ? todo : 0].click();
  });
  await voorbeeld.waitForTimeout(600);
  await voorbeeld.screenshot({ path: join(KIEKJES, 'voorbeeld-venster.png') });
  await echt.evaluate(() => {
    const s = document.querySelector('section[aria-labelledby="faq-titel"]');
    const knoppen = [...s.querySelectorAll('h3 button')];
    const todo = knoppen.findIndex((k) => /kost het/i.test(k.textContent));
    knoppen[todo > -1 ? todo : 0].click();
    s.scrollIntoView();
  });
  await echt.waitForTimeout(600);
  await echt.screenshot({ path: join(KIEKJES, 'echte-pagina.png') });
  await echt.close();
  await voorbeeld.close();

  /* 3 · toont Sveltia het ook werkelijk */
  console.log('\n3. En toont de beheerpagina het ook — met de echte config');

  const cms = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const cmsFouten = [];
  cms.on('pageerror', (e) => cmsFouten.push(e.message));
  cms.on('console', (m) => { if (m.type() === 'error') cmsFouten.push(m.text()); });

  // Alleen de backend wordt omgewisseld; al het andere komt uit het echte
  // bestand. Zonder dit zou de toets een GitHub-aanmelding nodig hebben.
  await cms.route(/config\.yml/, async (route) => {
    const cfg = parse(readFileSync(join(hier, 'beheer', 'config.yml'), 'utf8'));
    cfg.backend = { name: 'test-repo' };
    await route.fulfill({ status: 200, contentType: 'text/yaml', body: stringify(cfg) });
  });
  await cms.goto(`${ORIGIN}/beheer/`, { waitUntil: 'load' });
  await cms.waitForTimeout(2500);
  const aanmelden = cms.locator('button', { hasText: /testrepository|test repository/i }).first();
  ok('de beheerpagina komt op', await aanmelden.count() > 0);
  await aanmelden.click();
  await cms.waitForTimeout(2500);

  const zijbalk = await cms.locator('body').innerText();
  ok('de zijbalk en het middenpaneel heten niet meer allebei hetzelfde',
     /Landingspagina/.test(zijbalk) && /Veelgestelde vragen/.test(zijbalk),
     zijbalk.replace(/\n+/g, ' · ').slice(0, 200));
  await cms.screenshot({ path: join(KIEKJES, 'beheer-zijbalk.png') });

  await cms.goto(`${ORIGIN}/beheer/#/collections/faq/entries/faq`, { waitUntil: 'load' });
  await cms.waitForTimeout(3000);
  await cms.locator('button', { hasText: /toevoegen/ }).first().click();
  await cms.waitForTimeout(500);
  const vakken = cms.locator('[role="textbox"], input[type="text"], textarea');
  const n = await vakken.count();
  const PROEFVRAAG = 'Werkt het voorbeeldvenster?';
  await vakken.nth(n - 2).fill(PROEFVRAAG);
  await vakken.nth(n - 1).fill('Ja, en dit is de tweede alinea.\nTODO — en dit hoort in een kader.');
  await cms.waitForTimeout(3500);

  const binnenin = cms.frames().filter((f) => f !== cms.mainFrame());
  ok('Sveltia toont een voorbeeldvenster (registerPreviewTemplate werkt dus echt)',
     binnenin.length >= 2, `${binnenin.length} venster(s)`);

  let gevonden = false;
  let kader = false;
  for (const f of binnenin) {
    try {
      const tekst = await f.evaluate(() => document.body.innerText);
      if (tekst.includes(PROEFVRAAG)) gevonden = true;
      const todo = await f.evaluate(() =>
        !!document.querySelector('section[aria-labelledby="faq-titel"] p.todo'));
      if (todo) kader = true;
    } catch { /* een venster dat we niet mogen lezen is niet het onze */ }
  }
  ok('wat Jana typt, staat meteen in het voorbeeld', gevonden);
  ok('en een alinea die met "TODO — " begint krijgt daar het kader', kader);
  ok('geen enkele fout in de console van de beheerpagina', cmsFouten.length === 0,
     cmsFouten.slice(0, 3).join(' · '));

  await cms.screenshot({ path: join(KIEKJES, 'beheer-met-voorbeeld.png') });
  await cms.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\nSchermafdrukken: ${KIEKJES}`);
if (fouten) {
  console.log(rood(`${fouten} fout(en). Het voorbeeld toont iets anders dan de pagina.`));
  process.exit(1);
}
console.log(groen('Alles in orde — het voorbeeld is de pagina, niet een gelijkende tekening.'));
