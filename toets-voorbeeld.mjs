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
 * Sinds 2026-10-09 toont het voorbeeld niet meer alleen de FAQ maar elk blok van
 * de pagina, dus gaat deel 2b daar net zo door: voor pagina.yml, klanten.yml en
 * contact.yml wordt ELK element met een data-inhoud-attribuut in het voorbeeld
 * naast hetzelfde element op de echte pagina gelegd, en worden de tekst en tien
 * berekende eigenschappen vergeleken. Dat zijn er ruim honderd, en het is de
 * enige manier om de bewering "in de echte opmaak van de pagina" te kunnen doen.
 *
 * Deel 2c kijkt naar wat het voorbeeld OPVRAAGT. De scripts van de pagina moeten
 * meekomen (zonder die blijft elk blok met data-reveal onzichtbaar), en die
 * scripts laden na "Toestaan" de meettags van Google en LinkedIn. Een
 * beheerscherm is geen bezoeker, dus hoort daar geen enkel verzoek naartoe te
 * gaan. Er staat een CSP in het voorbeelddocument; deze toets klikt op
 * "Toestaan" en kijkt of er werkelijk niets vertrekt.
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
import { blokkenVoorSleutels, vindSlots } from './inhoud-opmaak.js';
import { vlak } from './lees-yaml.js';

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

// De inhoud van de drie bestanden, in dezelfde vorm als Sveltia hem aan het
// voorbeeld geeft: een geneste groep. Niet nagebootst — het ZIJN de bestanden.
const BESTANDEN = ['pagina', 'klanten', 'contact'];
const velden = Object.fromEntries(BESTANDEN.map((naam) =>
  [naam, parse(readFileSync(join(hier, 'content', `${naam}.yml`), 'utf8'))]));

// De platte sleutels per bestand — uit de bouw zelf, niet overgetypt.
const vlakkeSleutels = Object.fromEntries(BESTANDEN.map((naam) =>
  [naam, [...vlak(parse(readFileSync(join(hier, 'content', `${naam}.yml`), 'utf8'))).keys()]]));

// Waarmee de bouw rekent, zodat deel 1 kan zeggen of het voorbeeld hetzelfde ziet.
const paginaHtml = readFileSync(join(hier, 'draft-r3-01-definitief.html'), 'utf8');
const slotsVanBouw = vindSlots(paginaHtml);
const slotsInBouw = slotsVanBouw.length;

/** De volgnummers van de blokken die bij dit bestand horen — uit de bouwcode. */
const blokkenVanBestand = (naam) => {
  const groepen = new Set(Object.keys(velden[naam]));
  return blokkenVoorSleutels(paginaHtml, slotsVanBouw, (k) => groepen.has(k.split('.')[0]))
    .blokken.map((b) => b.nummer);
};
const cmsNamen = (parse(readFileSync(join(hier, 'beheer', 'config.yml'), 'utf8'))
  .collections ?? []).flatMap((c) => c.files ?? []).map((f) => f.name);
const browser = await chromium.launch();

try {
  /* 1 · het knippen zelf */
  console.log('\n1. Het voorbeeld knipt de echte pagina — zonder te raden');

  const knipPagina = await browser.newPage();
  const knipFouten = [];
  knipPagina.on('pageerror', (e) => knipFouten.push(e.message));
  await knipPagina.goto(`${ORIGIN}/beheer/`, { waitUntil: 'domcontentloaded' });
  const schil = await knipPagina.evaluate(async ({ origin, velden }) => {
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
      scripts: s.scripts.length,
      scriptsAlpine: /Alpine\.store\('toestemming'/.test(s.scripts)
                      && /Alpine\.data\('carrousel'/.test(s.scripts),
      slots: s.slots.length,
      bestanden: mod.BESTANDEN,
      // de blokken per bestand, uit de pagina afgeleid en niet opgezocht
      perBestand: Object.fromEntries(['pagina', 'klanten', 'contact'].map((naam) => {
        const data = velden[naam];
        const r = mod.blokkenVoorEntry(s, data);
        return [naam, { blokken: r.blokken.length, buiten: r.buiten, totaal: r.totaal }];
      })),
    };
  }, { origin: ORIGIN, velden });

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
  ok('de scripts van de pagina komen mee — zonder die blijft een blok onzichtbaar',
     schil.scripts > 1000 && schil.scriptsAlpine, `${schil.scripts} tekens`);
  ok(`alle ${schil.slots} plekken van de pagina zijn gelezen met dezelfde code als de bouw`,
     schil.slots === slotsInBouw, `bouw: ${slotsInBouw}`);
  ok('het voorbeeld registreert zich voor precies de bestanden uit config.yml',
     JSON.stringify([...schil.bestanden].sort()) === JSON.stringify([...cmsNamen].sort()),
     `voorbeeld: ${schil.bestanden.join(', ')} · config.yml: ${cmsNamen.join(', ')}`);
  for (const [naam, r] of Object.entries(schil.perBestand)) {
    ok(`${naam}.yml hoort bij ${r.blokken} van de ${r.totaal} blokken van de pagina — afgeleid uit de pagina zelf`,
       r.blokken > 0);
  }
  ok('en de vier velden die niet op de pagina staan, worden als zodanig gemeld',
     JSON.stringify(schil.perBestand.pagina.buiten) ===
       JSON.stringify(['vindbaarheid.titel', 'vindbaarheid.omschrijving',
                       'vindbaarheid.deel_titel', 'vindbaarheid.deel_omschrijving']),
     JSON.stringify(schil.perBestand.pagina.buiten));
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
      { soort: 'youbo-voorbeeld', html: mod.lijstVanItems(mod.itemsUitVelden(items)) }, '*');
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

  /* 2b · elk ander blok, veld voor veld */
  console.log('\n2b. Elk blok naast de echte pagina — gemeten, veld voor veld');

  // Wat er vergeleken wordt: de tekst, en tien eigenschappen die de browser
  // werkelijk tekent. NIET opacity of transform: data-reveal laat een blok
  // invliegen zodra het in beeld komt, en dat is een moment en geen opmaak.
  // Ook geen positie of breedte — het voorbeeld is een venster van een andere
  // maat, en dat is precies de bedoeling.
  const METEN_VELDEN = (sleutels) => {
    const VELDEN = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
                    'color', 'backgroundColor', 'textAlign', 'textTransform', 'fontStyle'];
    const uit = [];
    for (const el of document.querySelectorAll('[data-inhoud]')) {
      const sleutel = el.getAttribute('data-inhoud');
      if (sleutels.length && !sleutels.includes(sleutel)) continue;
      const c = getComputedStyle(el);
      const stijl = {};
      for (const v of VELDEN) stijl[v] = c[v];
      uit.push({
        sleutel,
        tag: el.tagName,
        tekst: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        stijl,
      });
    }
    return uit;
  };

  // Elk data-reveal-blok moet één keer in beeld geweest zijn, anders meet je een
  // blok dat nog op opacity 0 staat en krijg je een verschil dat geen verschil is.
  const rolDoor = async (frame) => {
    await frame.evaluate(async () => {
      const hoog = document.documentElement.scrollHeight;
      for (let y = 0; y < hoog; y += 400) {
        window.scrollTo(0, y);
        await new Promise((k) => setTimeout(k, 60));
      }
      window.scrollTo(0, 0);
      await new Promise((k) => setTimeout(k, 300));
    });
  };

  // Wat er op de site TUSSEN de blokken van dit bestand staat, geteld uit de
  // pagina zelf: tussen hero en logobalk niets (daar staat alleen commentaar),
  // tussen de kernblokken en de rondleiding wél de cases, enzovoort.
  const verwachteStrepen = Object.fromEntries(BESTANDEN.map((naam) => {
    const r = blokkenVanBestand(naam);
    let n = 0;
    for (let k = 1; k < r.length; k += 1) if (r[k] !== r[k - 1] + 1) n += 1;
    return [naam, n + (naam === 'pagina' ? 1 : 0)];   // pagina: + de regel over de vier velden buiten de pagina
  }));

  const echtBlok = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await echtBlok.goto(`${ORIGIN}/draft-r3-01-definitief.html`, { waitUntil: 'load' });
  await echtBlok.waitForTimeout(1500);
  await rolDoor(echtBlok);
  const opPagina = new Map((await echtBlok.evaluate(METEN_VELDEN, []))
    .map((r) => [r.sleutel, r]));
  ok(`de echte pagina levert ${opPagina.size} gemeten velden`, opPagina.size > 90,
     `${opPagina.size}`);

  for (const naam of BESTANDEN) {
    const vb = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    // Wat er WERKELIJK binnenkwam, en alleen uit het voorbeeldvenster. Een
    // `request`-gebeurtenis zegt niets: Playwright meldt ook een verzoek dat de
    // CSP tegenhoudt. Een `response` betekent dat het er echt was.
    const antwoorden = [];
    vb.on('response', (r) => {
      if (r.frame() !== vb.mainFrame()) antwoorden.push(r.url());
    });
    const vbFouten = [];
    const csp = [];
    vb.on('pageerror', (e) => vbFouten.push(e.message));
    vb.on('console', (m) => {
      const t = m.text();
      if (/Content Security Policy/i.test(t)) csp.push(t.slice(0, 120));
      else if (m.type() === 'error') vbFouten.push(t);
    });
    await vb.goto(`${ORIGIN}/beheer/`, { waitUntil: 'domcontentloaded' });
    const bericht = await vb.evaluate(async ({ origin, data }) => {
      const mod = await import(`${origin}/beheer/voorbeeld.js`);
      const schil = await mod.haalSchil();
      const { blokken, buiten } = mod.blokkenVoorEntry(schil, data);
      const vulling = mod.vullingenVoorEntry(schil, data, blokken);
      document.body.innerHTML = '';
      document.body.style.margin = '0';
      const frame = document.createElement('iframe');
      frame.style.cssText = 'width:1280px;height:1000px;border:0;display:block';
      frame.srcdoc = mod.bouwVoorbeeldDocument(schil, { blokken, buiten });
      document.body.appendChild(frame);
      await new Promise((k) => frame.addEventListener('load', k, { once: true }));
      frame.contentWindow.postMessage(
        { soort: 'youbo-voorbeeld', ops: vulling.ops, bezwaren: vulling.bezwaren }, '*');
      return { ops: vulling.ops.length, bezwaren: vulling.bezwaren, buiten };
    }, { origin: ORIGIN, data: velden[naam] });
    await vb.waitForTimeout(3500);

    const frame = vb.frames().find((f) => f !== vb.mainFrame());
    ok(`${naam}.yml — het voorbeeldvenster staat er`, !!frame);
    ok(`${naam}.yml — geen bezwaar op de echte inhoud (${bericht.ops} plekken gevuld)`,
       bericht.bezwaren.length === 0, bericht.bezwaren.slice(0, 3).join(' · '));
    if (!frame) { await vb.close(); continue; }

    // De regel bovenaan die zegt wát je ziet, en de strepen waar op de site een
    // ander blok staat. Zonder die twee beweert het voorbeeld dat het de hele
    // pagina is en dat de blokken aan elkaar grenzen.
    const chrome = await frame.evaluate(() => {
      const nota = document.getElementById('faq-voorbeeld-nota');
      return {
        notaBoven: !!nota && nota === document.body.firstElementChild
                   && nota.offsetHeight > 0,
        strepen: document.querySelectorAll('.voorbeeld-tussen').length,
      };
    });
    ok(`${naam}.yml — de regel die zegt wat je ziet, staat bovenaan`, chrome.notaBoven);

    await rolDoor(frame);
    const inVoorbeeld = await frame.evaluate(METEN_VELDEN, []);
    const buiten = new Set(bericht.buiten);

    // Elk tekstveld van dit bestand dat op de pagina staat, hoort ook in het
    // voorbeeld te staan. Anders toont het voorbeeld minder dan het beheert.
    const verwacht = [...opPagina.keys()]
      .filter((k) => vlakkeSleutels[naam].includes(k) && !buiten.has(k));
    const gezien = new Set(inVoorbeeld.map((r) => r.sleutel));
    const mist = verwacht.filter((k) => !gezien.has(k));
    ok(`${naam}.yml — alle ${verwacht.length} tekstvelden van dit bestand staan in het voorbeeld`,
       mist.length === 0, `mist: ${mist.join(', ')}`);

    let anders = 0;
    const eerste = [];
    for (const r of inVoorbeeld) {
      const a = opPagina.get(r.sleutel);
      if (!a) continue;
      if (a.tekst !== r.tekst || JSON.stringify(a.stijl) !== JSON.stringify(r.stijl)
          || a.tag !== r.tag) {
        anders += 1;
        if (eerste.length < 3) {
          eerste.push(`${r.sleutel}\n        pagina:    ${JSON.stringify(a)}\n        voorbeeld: ${JSON.stringify(r)}`);
        }
      }
    }
    ok(`${naam}.yml — alle ${inVoorbeeld.length} velden hebben dezelfde tekst, tag en opmaak als op de pagina`,
       anders === 0, eerste.join('\n        '));
    ok(`${naam}.yml — geen enkele fout in de console van het voorbeeld`,
       vbFouten.length === 0, vbFouten.slice(0, 2).join(' · '));
    ok(`${naam}.yml — ${chrome.strepen} streep/strepen waar op de site een ander blok staat`,
       chrome.strepen === verwachteStrepen[naam],
       `verwacht ${verwachteStrepen[naam]}`);

    /* 2c · en wat vraagt het voorbeeld op? */
    if (naam === 'contact') {
      // De cookiebalk staat in dit blok. Klikken op "Toestaan" laadt op de
      // echte site de meettags van Google en LinkedIn. In een beheerscherm
      // hoort dat niet te gebeuren — zie de CSP in beheer/voorbeeld.js.
      const geklikt = await frame.evaluate(() => {
        const knop = document.querySelector('[data-cta="cookiebalk-toestaan"]');
        if (!knop) return false;
        knop.click();
        return true;
      });
      ok('de cookiebalk staat in het voorbeeld van contact.yml', geklikt);
      await vb.waitForTimeout(2500);
      const meet = antwoorden.filter((u) =>
        /snap\.licdn|lms-analytics|googletagmanager|google-analytics|doubleclick|px\.ads\.linkedin/i.test(u));
      ok('en "Toestaan" in het voorbeeld laadt geen enkele meettag',
         meet.length === 0, meet.slice(0, 3).join(' · '));
      // En het bewijs dat het geen toeval is: de browser zegt zelf dat hij het
      // tegenhield. Zonder deze controle zou de toets ook groen zijn als de
      // pagina die tag ooit niet meer probeert te laden, en dan bewaakt ze
      // niets meer. (window.lintrk nakijken kan niet: het inline-stukje van
      // LinkedIn zet die functie als wachtrij nog vóór het script er is.)
      ok('en de browser hield hem tegen op de CSP van het voorbeeld',
         csp.some((t) => /snap\.licdn|lms-analytics/.test(t)),
         csp.slice(0, 2).join(' · ') || 'geen enkele CSP-melding — is de tag wel geprobeerd?');
      const buitenCdn = antwoorden.filter((u) => /^https?:/.test(u))
        .filter((u) => !/^http:\/\/127\.0\.0\.1/.test(u))
        .filter((u) => !/cdn\.tailwindcss\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u));
      ok('en er komt niets binnen van een andere plek dan de CDN\'s van de pagina',
         buitenCdn.length === 0, buitenCdn.slice(0, 3).join(' · '));
      await vb.screenshot({ path: join(KIEKJES, 'voorbeeld-contact.png') });
    } else {
      await vb.screenshot({ path: join(KIEKJES, `voorbeeld-${naam}.png`) });
    }
    await vb.close();
  }
  await echtBlok.close();

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

  await cms.goto(`${ORIGIN}/beheer/#/collections/landingspagina/entries/faq`, { waitUntil: 'load' });
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

  /* 3b · en hetzelfde voor een van de nieuwe bestanden */
  // De FAQ heeft één lijstveld; pagina.yml heeft negen groepen met samen 43
  // velden, en een eigen soort voorbeeld. Dat Sveltia het ÉNE toont, bewijst
  // niets over het andere: het zijn aparte registraties.
  // Een eigen venster, met een eigen aanmelding. Niet hetzelfde venster: de
  // FAQ hierboven staat met onbewaarde wijzigingen open, en Sveltia houdt een
  // navigatie dan tegen — dan zou deze toets een lege pagina meten en groen
  // of rood zijn om de verkeerde reden.
  await cms.close();
  const cms2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  cms2.on('pageerror', (e) => cmsFouten.push(e.message));
  cms2.on('console', (m) => { if (m.type() === 'error') cmsFouten.push(m.text()); });
  await cms2.route(/config\.yml/, async (route) => {
    const cfg = parse(readFileSync(join(hier, 'beheer', 'config.yml'), 'utf8'));
    cfg.backend = { name: 'test-repo' };
    await route.fulfill({ status: 200, contentType: 'text/yaml', body: stringify(cfg) });
  });
  await cms2.goto(`${ORIGIN}/beheer/`, { waitUntil: 'load' });
  await cms2.waitForTimeout(2500);
  await cms2.locator('button', { hasText: /testrepository|test repository/i }).first().click();
  await cms2.waitForTimeout(2500);
  await cms2.goto(`${ORIGIN}/beheer/#/collections/landingspagina/entries/pagina`,
                  { waitUntil: 'load' });
  await cms2.waitForTimeout(4000);

  // De negen groepen staan dichtgeklapt — zo is het formulier van 43 velden
  // doorzoekbaar in plaats van een muur. Dus eerst de bovenste openklappen.
  const dicht = await cms2.locator('button', { hasText: 'chevron_right' }).count();
  ok(`de ${dicht} groepen van pagina.yml staan dichtgeklapt, niet als één muur velden`,
     dicht >= 8, `${dicht}`);
  await cms2.locator('button', { hasText: 'chevron_right' }).first().click();
  await cms2.waitForTimeout(1200);

  const PROEFKOP = 'Compensatie zonder gedoe in dit voorbeeld';
  const vakkenOpen = cms2.locator('input[type="text"]:visible');
  ok('en de bovenste groep klapt open met haar vijf invulvakken',
     await vakkenOpen.count() === 5, `${await vakkenOpen.count()} vak(ken)`);
  await vakkenOpen.first().fill(PROEFKOP);
  await cms2.waitForTimeout(3500);

  let inVoorbeeld = false;
  let echteOpmaak = false;
  for (const f of cms2.frames().filter((x) => x !== cms2.mainFrame())) {
    try {
      const uit = await f.evaluate((kop) => {
        const el = document.querySelector('[data-inhoud="hero.kop"]');
        if (!el) return null;
        return {
          raak: el.textContent.trim() === kop,
          // dezelfde klasse als op de pagina, dus dezelfde opmaak
          klasse: el.className,
          tag: el.tagName,
        };
      }, PROEFKOP);
      if (uit?.raak) {
        inVoorbeeld = true;
        echteOpmaak = uit.tag === 'H1' && /text-h1/.test(uit.klasse);
      }
    } catch { /* een venster dat we niet mogen lezen is niet het onze */ }
  }
  ok('wat Jana in pagina.yml typt, staat meteen in het voorbeeld', inVoorbeeld);
  ok('en het staat daar in de <h1> van de pagina, met haar eigen klassen', echteOpmaak);

  // De lege velden van deze proefrepo horen als bezwaar te verschijnen: het
  // voorbeeld zegt dan dat de publicatie zou stoppen, in plaats van een pagina
  // met gaten te tonen alsof dat kan.
  let bezwaarZichtbaar = false;
  for (const f of cms2.frames().filter((x) => x !== cms2.mainFrame())) {
    try {
      const t = await f.evaluate(() => {
        const el = document.getElementById('faq-voorbeeld-bezwaar');
        return el && !el.hidden ? el.textContent : '';
      });
      if (/houdt de publicatie tegen/.test(t)) bezwaarZichtbaar = true;
    } catch { /* niet ons venster */ }
  }
  ok('en een leeg veld levert in het voorbeeld een waarschuwing op, geen gat',
     bezwaarZichtbaar);
  ok('nog steeds geen enkele fout in de console van de beheerpagina',
     cmsFouten.length === 0, cmsFouten.slice(0, 3).join(' · '));
  await cms2.screenshot({ path: join(KIEKJES, 'beheer-pagina-voorbeeld.png') });
  await cms2.close();

  /* 4 · groeit het voorbeeld mee met een lijst? */
  console.log('\n4. Een item erbij of eraf — ziet Jana dat in het voorbeeld');

  const groei = await browser.newPage();
  const groeiFouten = [];
  groei.on('pageerror', (e) => groeiFouten.push(e.message));
  await groei.goto(`${ORIGIN}/beheer/`, { waitUntil: 'domcontentloaded' });

  const gemeten = await groei.evaluate(async ({ origin, klanten, pagina }) => {
    const mod = await import(`${origin}/beheer/voorbeeld.js`);
    const schil = await mod.haalSchil();
    // Tel de casekaarten in een uitgeklapte schil: de <li> met de klasse die
    // alleen een casekaart draagt.
    const tel = (html, naald) => (html.match(new RegExp(naald, 'g')) || []).length;
    const uit = {};

    const kaarten = (data) => {
      const r = mod.schilVoorEntry(schil, data);
      return { kaarten: tel(r.schil.html, 'class="card case-kaart'),
               quotes: tel(r.schil.html, 'class="card-inv m-0 h-full'),
               bezwaren: r.bezwaren };
    };
    uit.vijf = kaarten(klanten);

    const zes = JSON.parse(JSON.stringify(klanten));
    zes.cases.items.push({ ...zes.cases.items[0], bedrijf: 'Zesde klant' });
    uit.zes = kaarten(zes);

    const drie = JSON.parse(JSON.stringify(klanten));
    drie.cases.items = drie.cases.items.slice(0, 3);
    uit.drie = kaarten(drie);

    const teveel = JSON.parse(JSON.stringify(klanten));
    while (teveel.cases.items.length < 8) teveel.cases.items.push({ ...teveel.cases.items[0] });
    uit.teveel = kaarten(teveel);

    // en de logo's, in het andere bestand
    const logos = (data) => {
      const r = mod.schilVoorEntry(schil, data);
      return { logos: tel(r.schil.html, '<li><img src="assets/img/'), bezwaren: r.bezwaren };
    };
    uit.negen = logos(pagina);
    const acht = JSON.parse(JSON.stringify(pagina));
    acht.logobalk.logos = acht.logobalk.logos.slice(0, 8);
    uit.acht = logos(acht);

    return uit;
  }, { origin: ORIGIN, klanten: velden.klanten, pagina: velden.pagina });

  ok('vijf cases in content/ geven vijf kaarten in het voorbeeld',
     gemeten.vijf.kaarten === 5 && gemeten.vijf.bezwaren.length === 0,
     `${gemeten.vijf.kaarten} kaart(en), bezwaren: ${gemeten.vijf.bezwaren.join(' | ')}`);
  ok('een zesde case erbij geeft zes kaarten',
     gemeten.zes.kaarten === 6 && gemeten.zes.bezwaren.length === 0,
     `${gemeten.zes.kaarten} kaart(en), bezwaren: ${gemeten.zes.bezwaren.join(' | ')}`);
  ok('twee cases weghalen geeft drie kaarten',
     gemeten.drie.kaarten === 3 && gemeten.drie.bezwaren.length === 0,
     `${gemeten.drie.kaarten} kaart(en)`);
  ok('de quotes blijven er vijf wanneer alleen de cases veranderen',
     gemeten.zes.quotes === 5, `${gemeten.zes.quotes} quote(s)`);
  ok('één case te veel: het voorbeeld zegt dat het de publicatie tegenhoudt',
     gemeten.teveel.bezwaren.some((b) => /Te veel cases/.test(b))
       && gemeten.teveel.kaarten === 5,
     `bezwaren: ${gemeten.teveel.bezwaren.join(' | ')} · ${gemeten.teveel.kaarten} kaart(en)`);
  ok('de negen logo’s staan drie keer in het spoor (27 beelden)',
     gemeten.negen.logos === 27, `${gemeten.negen.logos} beeld(en)`);
  ok('acht logo’s geven 24 beelden, dus de balk groeit ook mee',
     gemeten.acht.logos === 24 && gemeten.acht.bezwaren.length === 0,
     `${gemeten.acht.logos} beeld(en), bezwaren: ${gemeten.acht.bezwaren.join(' | ')}`);
  ok('geen enkele fout in de console bij dit alles', groeiFouten.length === 0,
     groeiFouten.slice(0, 3).join(' · '));
  await groei.close();
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
