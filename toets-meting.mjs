#!/usr/bin/env node
/**
 * Doet de meting wat ze belooft?
 *
 *     node toets-meting.mjs
 *
 * Op de twee r3-pagina's staat op elke knop en elke link een data-cta-haak.
 * Sinds 2026-10-12 luistert daar iets naar: het blok DE METING, onderaan beide
 * pagina's, letterlijk hetzelfde op allebei. Deze toets is het bewijs dat het
 * doet wat de uitleg zegt — en, net zo belangrijk, dat het niets doet wat het
 * niet mag.
 *
 * WAT ZE BEWIJST, EN WAAROM ELK STUK ERIN ZIT
 *
 *  1. Geen browser. De twee kopieen van het blok zijn teken voor teken gelijk,
 *     elke haak in de HTML heeft een naam, en geen van die namen is een naam
 *     die GA4 zelf al gebruikt. Dit is de goedkope poort: ze draait in een
 *     halve seconde en vangt het meeste.
 *  2. Zonder toestemming vertrekt er niets. Niet "er vertrekt geen meettag"
 *     maar: hier is de volledige lijst van alles wat de browser opvroeg, en er
 *     staat niets van Google of LinkedIn in. Een klik vóór de keuze gaat in de
 *     wachtrij en komt niet in dataLayer.
 *  3. Na Toestaan vertrekt het wél, precies één keer, en de wachtrij gaat mee.
 *     Met een echte container (GTM-MXTKMSBR) is dat een scherpere toets dan met
 *     een leeg id: er hoort nu een verzoek te zijn, en exact één.
 *  4. Eén klik, één gebeurtenis. Elke haak apart geklikt, een haak binnen een
 *     haak, een veeg door de quoterij, en een dubbele tik op de verzendknop.
 *  5. Wat wegnavigeert. mailto: en tel: ontladen de pagina niet — gemeten, niet
 *     aangenomen. En voor een link die wél wegnavigeert staat hier een nagemaakte
 *     container die met navigator.sendBeacon verstuurt, zodat te zien is of de
 *     gebeurtenis de navigatie overleeft.
 *  6. Het formulier, met en zonder action, en de bevestigingspagina.
 *  7. LinkedIn: met de conversie-id's leeg gaat er niets naar LinkedIn, en met
 *     één ingevuld (in een omgeleide kopie van de pagina, niet in het bestand)
 *     gaat het er wél naartoe. Dat is het bewijs dat de lege plek de enige
 *     drempel is en dat invullen één handeling blijft.
 *
 * WAT ZE NIET BEWIJST
 *
 * Niets over wat Google en LinkedIn met een hit doen. Dat de gebeurtenis in de
 * container aankomt is hier te zien; of er in GA4 een rij van komt, hangt af van
 * hoe Sven de container inricht en is alleen in GA4 zelf te zien.
 *
 * ZE RAAKT DE GEDEELDE BROWSER OP 9222/9223 NIET. Eigen headless Chromium, eigen
 * servertje op een vrije poort, alles achteraf afgezet.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HIER = dirname(fileURLToPath(import.meta.url));
const LANDING = 'draft-r3-01-definitief.html';
const BEDANKT = 'draft-r3-02-bedankt.html';

const groen = (s) => `\x1b[32m${s}\x1b[0m`;
const rood = (s) => `\x1b[31m${s}\x1b[0m`;
const grijs = (s) => `\x1b[2m${s}\x1b[0m`;

let fouten = 0;
function ok(wat, waar, extra) {
  if (waar) console.log(`  ${groen('ok')}    ${wat}${extra ? grijs('  ' + extra) : ''}`);
  else { fouten++; console.log(`  ${rood('FOUT')}  ${wat}${extra ? '\n        ' + extra : ''}`); }
}

/* Alle namen die mogen bestaan. Deze lijst staat hier en niet in de pagina:
   een toets die de tabel van de pagina overschrijft, toetst niets. */
const NAMEN = [
  'logo_geklikt', 'demo_knop_geklikt', 'demo_formulier_verstuurd',
  'demo_aanvraag_bevestigd', 'nieuwsbrief_ingeschreven', 'formulier_geweigerd',
  'formulier_controle_mislukt', 'case_pdf_geopend', 'vraag_opengeklapt',
  'rondleiding_stap_gekozen', 'klantverhaal_doorgebladerd', 'nick_gemaild',
  'nick_gebeld', 'agenda_geopend', 'juridische_tekst_geopend',
  'naar_youbo_site', 'naar_teal_partners', 'cookies_toegestaan',
  'cta_zonder_naam',
];

/* Wat GA4 met "Enhanced measurement" zelf al meet. Onze namen mogen hier niet
   in staan: twee bronnen met dezelfde naam zijn in één rapport niet meer te
   scheiden. */
const GA4_EIGEN = [
  'page_view', 'session_start', 'first_visit', 'user_engagement', 'scroll',
  'click', 'view_search_results', 'file_download', 'form_start', 'form_submit',
  'video_start', 'video_progress', 'video_complete',
];

/* De haken waarvan de naam vastgepind hoort te zijn. De lijstharken van het CMS
   (case-pdf-…, faq-…, rondleiding-stap-…) staan er met één voorbeeld bij; hun
   regel is het voorvoegsel en niet de volledige naam. */
const VERWACHT = {
  'hero-wordmerk': 'logo_geklikt',
  'hero-boek-demo': 'demo_knop_geklikt',
  'rondleiding-boek-demo': 'demo_knop_geklikt',
  'vaste-band-demo': 'demo_knop_geklikt',
  'formulier-vraag-demo': 'demo_formulier_verstuurd',
  'formulier-privacy': 'juridische_tekst_geopend',
  'formulier-mail-nick': 'nick_gemaild',
  'formulier-telefoon-nick': 'nick_gebeld',
  'bedankt-mail-nick': 'nick_gemaild',
  'bedankt-telefoon-nick': 'nick_gebeld',
  'bedankt-logo': 'naar_youbo_site',
  'bedankt-terug-youbo': 'naar_youbo_site',
  'footer-logo': 'naar_youbo_site',
  'footer-linkedin': 'naar_teal_partners',
  'footer-tealpartners': 'naar_teal_partners',
  'footer-cookiebeleid': 'juridische_tekst_geopend',
  'cookiebalk-toestaan': 'cookies_toegestaan',
  'cases-punt': 'klantverhaal_doorgebladerd',
  'quotes-punt': 'klantverhaal_doorgebladerd',
  'quotes-vorige': 'klantverhaal_doorgebladerd',
  'quotes-volgende': 'klantverhaal_doorgebladerd',
  'case-pdf-kaneka': 'case_pdf_geopend',
  'faq-prijs': 'vraag_opengeklapt',
  'rondleiding-stap-3': 'rondleiding_stap_gekozen',
};

/* Een haak die met opzet niets mag opleveren. */
const STIL = ['cookiebalk-weigeren'];

const MEETHOSTS = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|snap\.licdn\.com|px\.ads\.linkedin\.com|doubleclick/i;

/* ───────────────────────────────── het servertje ───────────────────────────── */
const TYPEN = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.json': 'application/json', '.yml': 'text/yaml', '.txt': 'text/plain',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
};
const bakens = [];        /* wat de nagemaakte container met sendBeacon verstuurde */
const srv = createServer((req, res) => {
  const pad = decodeURI(req.url.split('?')[0]);
  if (pad === '/baken') {                       /* de collector van part 5 */
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { bakens.push(body); res.writeHead(204); res.end(); });
    return;
  }
  if (pad === '/endpoint') { res.writeHead(204); return res.end(); }  /* nagemaakt formulier-eindpunt */
  const vol = join(HIER, pad.endsWith('/') ? pad + 'index.html' : pad);
  if (!vol.startsWith(HIER) || !existsSync(vol) || statSync(vol).isDirectory()) {
    res.writeHead(404); return res.end('404');
  }
  res.writeHead(200, { 'Content-Type': TYPEN[extname(vol).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(vol));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;

/* ─────────────────── 1 · zonder browser: de twee kopieen en de namen ──────── */
console.log('\n1. Het blok zelf — zonder browser');

const bron = {
  landing: readFileSync(join(HIER, LANDING), 'utf8'),
  bedankt: readFileSync(join(HIER, BEDANKT), 'utf8'),
};

function meetblok(html) {
  const a = html.indexOf('     DE METING — hier worden de data-cta-haken gebeurtenissen');
  const b = html.indexOf('     LAADMEETTAGS — het enige punt');
  return (a === -1 || b === -1 || b < a) ? null : html.slice(a, b);
}
const blokL = meetblok(bron.landing);
const blokB = meetblok(bron.bedankt);
ok('het blok DE METING staat op beide pagina\'s', !!blokL && !!blokB);
ok('en het is op beide pagina\'s teken voor teken hetzelfde blok',
   !!blokL && blokL === blokB,
   blokL && blokB ? `${blokL.length} tegen ${blokB.length} tekens` : 'een van de twee ontbreekt');

/* De namen die de pagina gebruikt, uit het blok zelf gelezen. */
const namenInBlok = new Set([...(blokL || '').matchAll(/'([a-z0-9_]+)'(?=,|\s*\})/g)].map((m) => m[1]));
for (const [, naam] of (blokL || '').matchAll(/:\s*'([a-z][a-z0-9_]+)'/g)) namenInBlok.add(naam);
const onbekend = [...namenInBlok].filter((n) => n.indexOf('_') > 0 && NAMEN.indexOf(n) === -1
  && !/^gtm|^geen$|^ga4$/.test(n));
ok(`het blok gebruikt geen naam buiten de ${NAMEN.length} afgesproken namen`,
   onbekend.length === 0, onbekend.join(', '));

const botsing = NAMEN.filter((n) => GA4_EIGEN.indexOf(n) !== -1);
ok('geen enkele naam is een naam die GA4 zelf al meet', botsing.length === 0, botsing.join(', '));

/* De id's, en of ze op beide pagina's hetzelfde zijn. */
function id(html, naam) {
  const m = html.match(new RegExp(naam + "\\s*=\\s*'([^']*)'"));
  return m ? m[1] : null;
}
for (const naam of ['GOOGLE_GTM_ID', 'GOOGLE_GA4_ID', 'LINKEDIN_PARTNER_ID']) {
  ok(`${naam} is op beide pagina's hetzelfde`,
     id(bron.landing, naam) === id(bron.bedankt, naam),
     `${id(bron.landing, naam)} tegen ${id(bron.bedankt, naam)}`);
}
ok('GOOGLE_GTM_ID is de container en geen plaatshouder',
   /^GTM-[A-Z0-9]{6,}$/.test(id(bron.landing, 'GOOGLE_GTM_ID') || ''),
   id(bron.landing, 'GOOGLE_GTM_ID'));

/* Het standaardfragment van Google hoort hier NIET te staan: dat laadt vóór de
   keuze van de bezoeker. Het enige punt waar googletagmanager.com voorkomt, is
   in laadMeettags(). */
for (const [naam, html] of Object.entries(bron)) {
  const kop = html.slice(0, html.indexOf('</head>'));
  ok(`${naam}: in de head staat geen enkele verwijzing naar googletagmanager.com`,
     !/googletagmanager\.com/.test(kop.replace(/<!--[\s\S]*?-->/g, '')));
  ok(`${naam}: er staat geen noscript-iframe van Tag Manager`,
     !/<noscript>[\s\S]{0,400}googletagmanager\.com\/ns\.html/i.test(html));
}

/* De lege plekken voor LinkedIn. Ze moeten er staan én leeg zijn: verdwijnt de
   tabel, dan is er geen plek meer om in te vullen en valt dat niemand op. */
const lk = (blokL || '').match(/var LINKEDIN_CONVERSIE = \{([\s\S]*?)\};/);
const lkRegels = lk ? [...lk[1].matchAll(/([a-z_]+):\s*'([^']*)'/g)] : [];
ok('er staat een lege plek voor elke LinkedIn-conversie', lkRegels.length === 3,
   lkRegels.map((m) => m[1]).join(', '));
ok('en alle drie staan ze leeg, dus gaat er niets naar LinkedIn',
   lkRegels.every((m) => m[2] === ''), lkRegels.map((m) => `${m[1]}='${m[2]}'`).join(' '));
ok('de echte conversie is de eerste: demo_aanvraag_bevestigd',
   lkRegels.length > 0 && lkRegels[0][1] === 'demo_aanvraag_bevestigd',
   lkRegels.length ? lkRegels[0][1] : '');

/* Elke haak in de HTML moet een naam hebben. Dit is de poort die het goedkoopst
   vangt dat iemand een knop bijzet zonder de naamtabel aan te vullen. */
const tabelHaken = new Set([...(blokL || '').matchAll(/'([a-z0-9-]+)':\s*(?:'[a-z0-9_]+'|null)/g)].map((m) => m[1]));
const voorvoegsels = [...(blokL || '').matchAll(/\['([a-z0-9-]+-)',\s*'([a-z0-9_]+)'\]/g)].map((m) => m[1]);
function heeftNaam(haak) {
  return tabelHaken.has(haak) || voorvoegsels.some((v) => haak.indexOf(v) === 0);
}
for (const [naam, html] of Object.entries(bron)) {
  const haken = [...new Set([...html.replace(/<!--[\s\S]*?-->/g, '')
    .matchAll(/data-cta="([^"]+)"/g)].map((m) => m[1]))]
    .filter((h) => h.indexOf('{') === -1);          /* de sjabloonvorm van de bouw */
  const zonder = haken.filter((h) => !heeftNaam(h));
  ok(`${naam}: alle ${haken.length} haken staan in de naamtabel of onder een voorvoegsel`,
     zonder.length === 0, zonder.join(', '));
}

/* ─────────────────────── de browser ───────────────────────────────────────── */
const browser = await chromium.launch({ headless: true });

/** Een pagina met de meting zichtbaar gemaakt: elke dataLayer-push met een
 *  `event`-sleutel wordt opgevangen, en navigeren wordt tegengehouden zodat we
 *  45 haken achter elkaar kunnen aanklikken zonder de pagina te verlaten.
 *  Het tegenhouden gebeurt met preventDefault in een luisteraar die NA die van
 *  de meting geregistreerd is — stopPropagation zou de meting zelf uitzetten en
 *  de toets vacuüm groen maken. */
async function open(pad, opties = {}) {
  const ctx = await browser.newContext({
    viewport: opties.viewport || { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const pg = await ctx.newPage();
  const verzoeken = [];
  const fout = [];
  pg.on('request', (r) => { if (!r.url().startsWith(ORIGIN)) verzoeken.push(r.url()); });
  pg.on('pageerror', (e) => fout.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error') fout.push(m.text()); });
  if (opties.keuze) {
    await pg.addInitScript((k) => { try { localStorage.setItem('youbo-toestemming', k); } catch (e) {} }, opties.keuze);
  }
  if (opties.route) await opties.route(pg);
  await pg.goto(ORIGIN + pad, { waitUntil: 'load' });
  await pg.waitForTimeout(opties.wacht || 1200);
  if (!opties.laatNavigeren) {
    await pg.evaluate(() => {
      window.__gezien = [];
      document.addEventListener('click', (e) => e.preventDefault(), true);
      document.addEventListener('submit', (e) => e.preventDefault(), true);
    });
  }
  return { ctx, pg, verzoeken, fout };
}

/** Welke van ONZE gebeurtenissen staan er in dataLayer? */
const onzeEvents = (pg) => pg.evaluate((namen) => (window.dataLayer || [])
  .filter((r) => r && typeof r === 'object' && !Array.isArray(r) && r.event && namen.indexOf(r.event) !== -1)
  .map((r) => ({ event: r.event, cta: r.cta, cta_detail: r.cta_detail, cta_tekst: r.cta_tekst, wachtrij_ms: r.wachtrij_ms })), NAMEN);

/* ─────────────── 2 · zonder toestemming vertrekt er niets ─────────────────── */
console.log('\n2. Zonder toestemming — de volledige lijst van wat de browser opvroeg');

for (const [naam, pad] of [['landingspagina', LANDING], ['bevestigingspagina', BEDANKT]]) {
  const { ctx, pg, verzoeken, fout } = await open('/' + pad);
  console.log(grijs(`   ${naam}: ${verzoeken.length} verzoek(en) naar buiten`));
  for (const u of verzoeken) console.log(grijs(`     · ${u.slice(0, 100)}`));
  const meet = verzoeken.filter((u) => MEETHOSTS.test(u));
  ok(`${naam}: geen enkel verzoek naar Google of LinkedIn`, meet.length === 0, meet.join(' · '));
  ok(`${naam}: geen enkele fout in de console`, fout.length === 0, fout.slice(0, 2).join(' · '));
  await ctx.close();
}

{
  const { ctx, pg, verzoeken } = await open('/' + LANDING);
  await pg.evaluate(() => {
    document.querySelector('[data-cta="hero-boek-demo"]').click();
    document.querySelector('[data-cta="vaste-band-demo"]').click();
    document.querySelector('[data-cta="footer-cases"]').click();
  });
  await pg.waitForTimeout(200);
  const stand = await pg.evaluate(() => METING.stand());
  ok('drie kliks vóór de keuze staan in de wachtrij', stand.wachtrij === 3, JSON.stringify(stand));
  ok('en er staat niets van ons in dataLayer', (await onzeEvents(pg)).length === 0);
  ok('en er is nog steeds niets naar Google of LinkedIn vertrokken',
     verzoeken.filter((u) => MEETHOSTS.test(u)).length === 0);

  /* Weigeren gooit de wachtrij weg en houdt haar weg. */
  await pg.evaluate(() => document.querySelector('[data-cta="cookiebalk-weigeren"]').click());
  await pg.waitForTimeout(300);
  const na = await pg.evaluate(() => METING.stand());
  ok('na Weigeren is de wachtrij leeg', na.wachtrij === 0, JSON.stringify(na));
  ok('en er staat nog steeds niets van ons in dataLayer', (await onzeEvents(pg)).length === 0);
  ok('en er is nog steeds geen verzoek naar Google of LinkedIn',
     verzoeken.filter((u) => MEETHOSTS.test(u)).length === 0,
     verzoeken.filter((u) => MEETHOSTS.test(u)).join(' · '));
  await ctx.close();
}

{
  /* Wie eerder weigerde, komt terug: de balk is weg, en een klik mag ook dan
     niet alsnog vertrekken. */
  const { ctx, pg, verzoeken } = await open('/' + LANDING, { keuze: 'geweigerd' });
  await pg.evaluate(() => document.querySelector('[data-cta="hero-boek-demo"]').click());
  await pg.waitForTimeout(300);
  const st = await pg.evaluate(() => METING.stand());
  ok('een herbezoek na Weigeren meet niets — de wachtrij blijft dicht',
     st.wachtrij === 0 && st.afgewezen === true, JSON.stringify(st));
  ok('en haalt niets bij Google of LinkedIn', verzoeken.filter((u) => MEETHOSTS.test(u)).length === 0);
  await ctx.close();
}

/* ─────────────── 3 · na Toestaan, precies één keer ────────────────────────── */
console.log('\n3. Na Toestaan — wat er dan wél vertrekt');

{
  const { ctx, pg, verzoeken, fout } = await open('/' + LANDING);
  await pg.evaluate(() => document.querySelector('[data-cta="hero-boek-demo"]').click());
  await pg.waitForTimeout(150);
  await pg.evaluate(() => document.querySelector('[data-cta="cookiebalk-toestaan"]').click());
  await pg.waitForTimeout(2500);

  const gtm = verzoeken.filter((u) => /googletagmanager\.com\/gtm\.js/.test(u));
  ok('er gaat precies één verzoek naar de Tag Manager-container', gtm.length === 1,
     gtm.join(' · ') || 'geen enkel verzoek — laadt de container wel?');
  ok('en dat is de container uit de pagina',
     gtm.length === 1 && gtm[0].indexOf('id=' + id(bron.landing, 'GOOGLE_GTM_ID')) !== -1, gtm[0]);
  /* GTAG/JS MAG ER WEL ZIJN, ALS HET UIT DE CONTAINER KOMT.
     Tot 2026-10-15 stond hier dat er géén verzoek naar gtag/js mocht gaan, en
     dat was groen — maar om de verkeerde reden. De vier triggers van de
     container stonden tot Versie 3 omgekeerd, dus vuurde de Google-tag voor een
     gewone bezoeker nooit en laadde er dus ook nooit een gtag/js. Sinds die
     versie gepubliceerd is, vuurt hij wél, en laadt Tag Manager zélf gtag/js —
     zo richt GTM een Google-tag in. Deze regel is dus niet verzwakt maar
     scherpgesteld: wat de pagina niet mag, is gtag/js RECHTSTREEKS laden, want
     dan telt elke paginaweergave dubbel. Het onderscheid is de parameter cx=c,
     die alleen Tag Manager erbij zet. */
  const gtagjs = verzoeken.filter((u) => /googletagmanager\.com\/gtag\/js/.test(u));
  ok('de pagina laadt gtag/js niet zelf — wat er komt, komt uit de container',
     gtagjs.every((u) => /[?&]cx=c/.test(u)),
     gtagjs.filter((u) => !/[?&]cx=c/.test(u)).join(' · '));

  /* En dat de container ook echt iets naar GA4 stuurt, met de toestemming erbij.
     gcs=G1<ad_storage><analytics_storage>, dus G111 = beide toegestaan. Zonder
     deze twee regels bewijst het bovenstaande alleen dat er een script laadde. */
  const collect = verzoeken.filter((u) => /google-analytics\.com\/g\/collect/.test(u));
  ok('GA4 ontvangt ook echt een hit', collect.length > 0);
  ok('en die hit draagt de toestemming mee — gcs=G111',
     collect.length > 0 && collect.some((u) => /[?&]gcs=G111/.test(u)),
     collect.map((u) => (u.match(/[?&](gcs=[^&]*)/) || [, 'geen gcs'])[1]).join(' · '));
  ok('de LinkedIn Insight Tag laadt nu wel',
     verzoeken.some((u) => /snap\.licdn\.com/.test(u)));

  const ev = await onzeEvents(pg);
  const wacht = ev.filter((e) => e.event === 'demo_knop_geklikt');
  ok('de klik van vóór de keuze is alsnog verstuurd', wacht.length === 1, JSON.stringify(ev));
  ok('en ze draagt wachtrij_ms, zodat niemand denkt dat ze nú gebeurde',
     wacht.length === 1 && typeof wacht[0].wachtrij_ms === 'number' && wacht[0].wachtrij_ms >= 0,
     wacht.length ? String(wacht[0].wachtrij_ms) : '');
  ok('en Toestaan zelf is ook een gebeurtenis',
     ev.filter((e) => e.event === 'cookies_toegestaan').length === 1);
  ok('geen enkele fout in de console', fout.length === 0, fout.slice(0, 2).join(' · '));
  ok('het kanaal is de container en niet GA4 rechtstreeks',
     (await pg.evaluate(() => METING.stand())).kanaal === 'gtm');
  await ctx.close();
}

/* ─────────────── 4 · intrekken, even makkelijk als toestemmen ─────────────── */
console.log('\n4. Intrekken — AVG artikel 7, lid 3');

{
  /* In de bron: intrek() zet alle vier de signalen van Consent Mode v2 terug op
     denied. Dat is na een herlading niet meer in de browser te zien — de
     dataLayer is dan weg — dus wordt het hier in de tekst zelf nagekeken. */
  for (const [naam, html] of Object.entries(bron)) {
    const m = html.match(/intrek\(\) \{([\s\S]*?)\n      \}/);
    const vier = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'];
    ok(`${naam}: intrek() zet alle vier de signalen terug op denied`,
       !!m && vier.every((s) => new RegExp(s + ":\\s*'denied'").test(m[1])),
       m ? vier.filter((s) => !new RegExp(s + ":\\s*'denied'").test(m[1])).join(', ') : 'intrek() ontbreekt');
    ok(`${naam}: en hij wist de keuze, de meetcookies en herlaadt de pagina`,
       !!m && /removeItem\('youbo-toestemming'\)/.test(m[1])
           && /wisMeetcookies\(\)/.test(m[1]) && /location\.reload\(\)/.test(m[1]));
  }

  /* En in de browser: toestemmen, dan intrekken, en kijken wat er overblijft.

     DE TOESTEMMING WORDT HIER GEKLIKT EN NIET VOORGEZET. open({keuze}) zet de
     sleutel met addInitScript, en dat draait bij ELKE navigatie — ook bij de
     herlading die het intrekken zelf veroorzaakt. De toets zette de keuze dus
     terug die ze net had zien verdwijnen, en viel toen op vier punten rood om
     een reden die niets met de pagina te maken had. Eerst gevonden door deze
     toets op 2026-10-15, en de les staat hier omdat elke volgende toets rond
     een herlading er weer in loopt. */
  const { ctx, pg, verzoeken } = await open('/' + LANDING, { laatNavigeren: true });
  await pg.evaluate(() => document.querySelector('[data-cta="cookiebalk-toestaan"]').click());
  await pg.waitForTimeout(3000);
  const gaVoor = (await ctx.cookies()).filter((c) => /^_ga/.test(c.name));
  ok('na Toestaan staat er een _ga-cookie op het domein', gaVoor.length > 0,
     gaVoor.map((c) => c.name).join(', ') || 'geen enkele');

  const voor = verzoeken.length;
  await Promise.all([
    pg.waitForNavigation({ waitUntil: 'load' }),
    pg.evaluate(() => document.querySelector('[data-cta="cookievoorkeuren"]').click()),
  ]);
  await pg.waitForTimeout(1500);

  ok('de keuze is uit localStorage gewist',
     (await pg.evaluate(() => { try { return localStorage.getItem('youbo-toestemming'); } catch (e) { return 'onleesbaar'; } })) === null);
  const gaNa = (await ctx.cookies()).filter((c) => /^(_ga|_gid|_gcl)/.test(c.name));
  ok('en de meetcookies van Google staan er niet meer', gaNa.length === 0,
     gaNa.map((c) => c.name).join(', '));
  ok('de cookiebalk staat er weer, dus kan de bezoeker opnieuw kiezen',
     await pg.locator('[data-cookiebalk]').isVisible());
  /* WAT ER NA HET HERLADEN NIET MEER MAG KOMEN: EEN MEETTAG.
     Er is met opzet niet gevraagd of er helemaal niets meer vertrekt, want dat
     is niet waar en de toets zou er grillig van worden. Op de echte pagina
     bleek het op 2026-10-15: de stervende pagina had nog een scroll-gebeurtenis
     in de wachtrij van GA4 staan, en die gaat er bij het verlaten alsnog uit.
     Ze draagt dan gcs=G100 en npa=1 — analytics_storage geweigerd, dus zónder
     cookie en met een willekeurig id: precies wat Consent Mode hoort te doen
     als de toestemming net ingetrokken is. Er wordt daarbij niets op het
     toestel gelezen of gezet, en dat is waar de toestemming over gaat.

     Wat wél beslissend is: de herladen pagina mag geen enkele meettag meer
     binnenhalen. Geen gtm.js, geen gtag/js, geen insight.min.js. Dat is het
     verschil tussen een naijlende hit en een pagina die gewoon doormeet. */
  const nieuweTags = verzoeken.slice(voor)
    .filter((u) => /gtm\.js|gtag\/js|insight\.min\.js/.test(u));
  ok('en de herladen pagina haalt geen enkele meettag meer op', nieuweTags.length === 0,
     nieuweTags.join(' · '));

  const laat = verzoeken.slice(voor).filter((u) => /google-analytics\.com\/g\/collect/.test(u));
  const metCookie = laat.filter((u) => /[?&]gcs=G1\d1/.test(u) && !/[?&]npa=1/.test(u));
  ok('en wat er nog naijlt, doet dat zonder cookie',
     metCookie.length === 0 || laat.length === 0,
     metCookie.map((u) => (u.match(/[?&]en=([^&]*)/) || [, '?'])[1]).join(' · '));
  await ctx.close();
}

/* ─────────────── 5 · één klik, één gebeurtenis ────────────────────────────── */
console.log('\n5. Eén klik, één gebeurtenis — elke haak apart');

for (const [paginaNaam, pad] of [['landingspagina', LANDING], ['bevestigingspagina', BEDANKT]]) {
  const { ctx, pg, fout } = await open('/' + pad, { keuze: 'toegestaan', wacht: 2000 });
  /* De verzendknop staat met opzet NIET in deze ronde: hij wordt op het
     submit-event gemeten, en deze ronde houdt juist elke standaardhandeling
     tegen om alle haken achter elkaar te kunnen aanklikken. Hij krijgt zijn
     eigen controles in deel 6.

     «Cookievoorkeuren wijzigen» staat er ook buiten, en om een andere reden:
     die knop herlaadt de pagina met opzet — de enige manier om een al geladen
     Tag Manager en LinkedIn-tag kwijt te raken. In deze ronde zou die ene klik
     het uitvoeringsvenster van de browser slopen en alle haken daarna
     meesleuren. Hij heeft zijn eigen deel: 4. */
  const BUITEN_DE_RONDE = ['formulier-vraag-demo', 'cookievoorkeuren'];
  const alle = (await pg.evaluate(() => [...new Set([...document.querySelectorAll('[data-cta]')]
    .map((e) => e.getAttribute('data-cta')))]))
    .filter((h) => BUITEN_DE_RONDE.indexOf(h) === -1);
  /* "Weigeren" gaat met opzet als LAATSTE. Hij zet de meting voor de rest van
     deze paginaweergave uit — dat is juist wat hij moet doen, en deze ronde
     ontdekte dat zelf: in DOM-volgorde staan Toestaan en de demobalk erna, en
     die gaven daardoor nul. */
  const haken = alle.filter((h) => STIL.indexOf(h) === -1)
    .concat(alle.filter((h) => STIL.indexOf(h) !== -1));
  const uitkomst = [];
  for (const haak of haken) {
    const voor = (await onzeEvents(pg)).length;
    const uit = await pg.evaluate((h) => {
      const el = document.querySelector('[data-cta="' + h + '"]');
      if (!el) { return 'ontbreekt'; }
      /* Een knop die op dit moment `disabled` is — de pijl "vorige quote",
         helemaal links — hoort niets te doen. Die wordt verderop apart gemeten
         zodra hij wel wat kan. */
      if (el.disabled) { return 'uitgezet'; }
      el.click();
      return 'geklikt';
    }, haak);
    await pg.waitForTimeout(90);
    const alles = await onzeEvents(pg);
    uitkomst.push({ haak, uit, nieuw: alles.slice(voor) });
  }
  const geklikt = uitkomst.filter((u) => u.uit === 'geklikt');
  const uitgezet = uitkomst.filter((u) => u.uit === 'uitgezet');
  const teveel = geklikt.filter((u) => STIL.indexOf(u.haak) === -1 && u.nieuw.length !== 1);
  const stilteFout = uitkomst.filter((u) => STIL.indexOf(u.haak) !== -1 && u.nieuw.length !== 0);
  ok(`${paginaNaam}: elk van de ${geklikt.length} klikbare haken geeft precies één gebeurtenis`,
     teveel.length === 0, teveel.map((u) => `${u.haak} → ${u.nieuw.length}`).join(', '));
  ok(`${paginaNaam}: een knop die op dit moment uitgezet is, vuurt niets`,
     uitgezet.every((u) => u.nieuw.length === 0),
     uitgezet.map((u) => u.haak).join(', ') || 'geen enkele uitgezette knop');
  ok(`${paginaNaam}: "Weigeren" geeft met opzet geen enkele gebeurtenis`,
     stilteFout.length === 0, stilteFout.map((u) => u.haak).join(', '));

  const mis = uitkomst.filter((u) => u.nieuw.length === 1 && NAMEN.indexOf(u.nieuw[0].event) === -1);
  ok(`${paginaNaam}: geen enkele gebeurtenis heeft een naam buiten de lijst`,
     mis.length === 0, mis.map((u) => `${u.haak} → ${u.nieuw[0].event}`).join(', '));
  const alarm = uitkomst.filter((u) => u.nieuw.length === 1 && u.nieuw[0].event === 'cta_zonder_naam');
  ok(`${paginaNaam}: geen enkele haak valt op cta_zonder_naam`,
     alarm.length === 0, alarm.map((u) => u.haak).join(', '));

  const verkeerd = uitkomst.filter((u) => VERWACHT[u.haak] && u.nieuw.length === 1
    && u.nieuw[0].event !== VERWACHT[u.haak]);
  const gepind = uitkomst.filter((u) => VERWACHT[u.haak]).length;
  ok(`${paginaNaam}: de ${gepind} vastgepinde haken geven de naam die ze moeten geven`,
     verkeerd.length === 0,
     verkeerd.map((u) => `${u.haak} → ${u.nieuw[0].event} i.p.v. ${VERWACHT[u.haak]}`).join(', '));
  ok(`${paginaNaam}: geen enkele fout in de console`, fout.length === 0, fout.slice(0, 2).join(' · '));

  if (paginaNaam === 'landingspagina') {
    const cases = uitkomst.filter((u) => u.haak.indexOf('case-pdf-') === 0 && u.nieuw.length === 1);
    ok('een case-pdf zegt in cta_detail WELKE case het was — dat is wat Google\'s file_download niet weet',
       cases.length === 5 && cases.every((u) => u.nieuw[0].cta_detail && u.nieuw[0].cta_detail.length > 1),
       cases.map((u) => u.nieuw[0].cta_detail).join(', '));
    const stap = uitkomst.find((u) => u.haak === 'rondleiding-stap-3');
    ok('een rondleidingstap zegt welk nummer',
       !!stap && stap.nieuw.length === 1 && stap.nieuw[0].cta_detail === '3',
       stap ? JSON.stringify(stap.nieuw) : 'de haak rondleiding-stap-3 bestaat niet');
  }
  await ctx.close();
}

{
  /* Een haak binnen een klikbaar element: in de voet zit het logo als <img> in
     een <a data-cta>. Klikken op het beeld hoort de link te geven, één keer. */
  const { ctx, pg } = await open('/' + LANDING, { keuze: 'toegestaan', wacht: 2000 });
  const voor = (await onzeEvents(pg)).length;
  await pg.evaluate(() => document.querySelector('[data-cta="footer-logo"] img').click());
  await pg.waitForTimeout(120);
  const nieuw = (await onzeEvents(pg)).slice(voor);
  ok('een klik op het beeld BINNEN een haak geeft één gebeurtenis van de haak',
     nieuw.length === 1 && nieuw[0].event === 'naar_youbo_site' && nieuw[0].cta === 'footer-logo',
     JSON.stringify(nieuw));

  /* Een veeg door de quoterij mag niets vuren. De rij vuurt bij elke
     verschuiving sync() af; zou de meting aan scroll hangen, dan stond het
     rapport vol met gebeurtenissen die niemand maakte. */
  const voor2 = (await onzeEvents(pg)).length;
  await pg.evaluate(async () => {
    const rij = document.querySelector('[data-cta="quotes-punt"]').closest('section').querySelector('ul.scrollhide')
      || document.querySelectorAll('ul')[0];
    for (let i = 0; i < 6; i++) {
      rij.scrollLeft += 120;
      rij.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 60));
    }
  });
  await pg.waitForTimeout(500);
  ok('een veeg door de quoterij vuurt geen enkele gebeurtenis',
     (await onzeEvents(pg)).length === voor2,
     `${(await onzeEvents(pg)).length - voor2} erbij`);

  /* De pijl "vorige quote" staat helemaal links uitgezet. Schuif de rij een
     kaart op en hij doet wat hij moet doen — één gebeurtenis per klik. */
  const voorPijl = (await onzeEvents(pg)).length;
  await pg.evaluate(async () => {
    document.querySelector('[data-cta="quotes-volgende"]').click();
    await new Promise((r) => setTimeout(r, 800));
    const p = document.querySelector('[data-cta="quotes-vorige"]');
    if (!p.disabled) { p.click(); }
  });
  await pg.waitForTimeout(400);
  const pijlen = (await onzeEvents(pg)).slice(voorPijl);
  ok('de pijl "vorige quote" vuurt zodra hij niet meer uitgezet staat',
     pijlen.length === 2 && pijlen.every((e) => e.event === 'klantverhaal_doorgebladerd'),
     JSON.stringify(pijlen));

  /* Een dubbele tik op de verzendknop is één aanvraag. */
  const voor3 = (await onzeEvents(pg)).length;
  await pg.evaluate(() => {
    /* requestSubmit() en niet knop.click(): deze ronde houdt elke
       standaardhandeling tegen, dus zou een klik op de verzendknop niet eens tot
       een submit komen en zou deze controle vacuüm groen zijn. */
    const f = document.querySelector('form');
    f.requestSubmit(); f.requestSubmit(); f.requestSubmit();
  });
  await pg.waitForTimeout(200);
  const drie = (await onzeEvents(pg)).slice(voor3);
  ok('drie tikken binnen 500ms op "Vraag je demo aan" zijn één aanvraag',
     drie.length === 1 && drie[0].event === 'demo_formulier_verstuurd', JSON.stringify(drie));
  await ctx.close();
}

{
  /* Het alarm moet bestaan: een haak die niemand benoemd heeft, hoort niet stil
     weg te vallen maar als cta_zonder_naam in het rapport te komen. */
  const { ctx, pg } = await open('/' + LANDING, { keuze: 'toegestaan', wacht: 2000 });
  const voor = (await onzeEvents(pg)).length;
  await pg.evaluate(() => {
    const el = document.querySelector('[data-cta="hero-boek-demo"]');
    el.setAttribute('data-cta', 'een-knop-die-niemand-benoemde');
    el.click();
  });
  await pg.waitForTimeout(120);
  const nieuw = (await onzeEvents(pg)).slice(voor);
  ok('een onbenoemde haak valt niet stil weg maar meldt zich als cta_zonder_naam',
     nieuw.length === 1 && nieuw[0].event === 'cta_zonder_naam'
     && nieuw[0].cta === 'een-knop-die-niemand-benoemde', JSON.stringify(nieuw));
  await ctx.close();
}

/* ─────────────── 5 · het formulier en de bevestigingspagina ───────────────── */
console.log('\n6. Het formulier — vandaag zonder eindpunt, en straks met');

{
  const { ctx, pg } = await open('/' + LANDING, { keuze: 'toegestaan', wacht: 2000 });

  /* De labels. Een losgeraakt label vangt geen enkele andere toets hier, en de
     veldnamen zijn op 2026-10-12 Engels geworden. */
  const labels = await pg.evaluate(() => [...document.querySelectorAll('form label[for]')]
    .map((l) => ({ voor: l.getAttribute('for'), raakt: !!l.control, veld: l.control ? l.control.name : null })));
  ok(`alle ${labels.length} labels van het formulier horen bij een bestaand veld`,
     labels.length >= 5 && labels.every((l) => l.raakt),
     labels.filter((l) => !l.raakt).map((l) => l.voor).join(', '));
  const velden = await pg.evaluate(() => [...document.querySelectorAll('form [name]')].map((e) => e.name));
  ok('de vijf veldnamen zijn het afgesproken koppelvlak met de klant',
     JSON.stringify(velden.filter((n) => n !== 'extra_notes'))
       === JSON.stringify(['name', 'email', 'phone', 'message', 'newsletter']),
     JSON.stringify(velden));
  ok('en daarnaast gaat er precies één veld mee dat niet van de bezoeker komt: de val',
     velden.filter((n) => n === 'extra_notes').length === 1, JSON.stringify(velden));

  /* Eén aanvraag, één gebeurtenis — ook al klikt de bezoeker op de knop. De
     klik van de verzendknop wordt met opzet overgeslagen. */
  /* Eerst een echte handeling in het formulier, anders houdt de drempel deze
     verzending tegen — en terecht: een submit zonder enige aanraking binnen drie
     seconden na het laden is precies wat zij hoort te weigeren. Deel 8 meet dat
     apart. */
  await pg.focus('#name');
  await pg.keyboard.type('Anne');
  const voor = (await onzeEvents(pg)).length;
  await pg.evaluate(() => document.querySelector('form').requestSubmit());
  await pg.waitForTimeout(200);
  const ev = (await onzeEvents(pg)).slice(voor);
  ok('een verzending zonder action geeft één demo_formulier_verstuurd',
     ev.length === 1 && ev[0].event === 'demo_formulier_verstuurd', JSON.stringify(ev));

  /* En met een eindpunt erin blijft het werken — dat is de hele vraag, want de
     action is vandaag leeg en komt er pas als de klant hem aanlevert. */
  await pg.waitForTimeout(600);
  const voor2 = (await onzeEvents(pg)).length;
  await pg.evaluate((o) => {
    const f = document.querySelector('form');
    f.setAttribute('action', o + '/endpoint');
    f.setAttribute('method', 'post');
    f.requestSubmit();
  }, ORIGIN);
  await pg.waitForTimeout(250);
  const ev2 = (await onzeEvents(pg)).slice(voor2);
  ok('en met een action erin ook, met het eindpunt in cta_doel',
     ev2.length === 1 && ev2[0].event === 'demo_formulier_verstuurd', JSON.stringify(ev2));
  await ctx.close();
}

{
  /* De bevestigingspagina IS de uitkomst. Zij meet dat bij het laden, en de
     landingspagina doet dat juist niet. */
  const a = await open('/' + BEDANKT, { keuze: 'toegestaan', wacht: 2500 });
  const evB = await onzeEvents(a.pg);
  const bev = evB.filter((e) => e.event === 'demo_aanvraag_bevestigd');
  ok('de bevestigingspagina meet de geslaagde aanvraag bij het laden', bev.length === 1,
     JSON.stringify(evB));
  ok('en precies één keer', bev.length === 1);
  await a.ctx.close();

  const b = await open('/' + LANDING, { keuze: 'toegestaan', wacht: 2500 });
  ok('de landingspagina meet bij het laden niets',
     (await onzeEvents(b.pg)).length === 0, JSON.stringify(await onzeEvents(b.pg)));
  await b.ctx.close();
}

/* ─────────────── 6 · wat wegnavigeert ────────────────────────────────────── */
console.log('\n7. Wat wegnavigeert — gemeten en niet aangenomen');

{
  /* mailto: en tel:. De vraag is of de pagina daarbij ontladen wordt, want dan
     zou de gebeurtenis het vaak niet halen. Gemeten in plaats van aangenomen. */
  const { ctx, pg } = await open('/' + LANDING, { keuze: 'toegestaan', wacht: 2000, laatNavigeren: true });
  await pg.evaluate(() => {
    window.__ontladen = false;
    window.addEventListener('pagehide', () => { window.__ontladen = true; });
  });
  for (const haak of ['formulier-mail-nick', 'formulier-telefoon-nick']) {
    const voor = (await onzeEvents(pg)).length;
    await pg.evaluate((h) => document.querySelector('[data-cta="' + h + '"]').click(), haak);
    await pg.waitForTimeout(400);
    const nieuw = (await onzeEvents(pg)).slice(voor);
    const ontladen = await pg.evaluate(() => window.__ontladen);
    ok(`${haak}: de gebeurtenis staat er (${nieuw.map((n) => n.event).join(',')})`, nieuw.length === 1);
    ok(`${haak}: en de pagina werd niet ontladen, dus kan ze niet verloren gaan`, ontladen === false);
  }
  const url = pg.url();
  ok('de pagina is na mailto: en tel: nog dezelfde', url.indexOf(LANDING) !== -1, url);
  await ctx.close();
}

{
  /* Een link die de pagina wél verlaat. Hier staat een NAGEMAAKTE container in
     plaats van die van Google: ze doet wat een tag in de container doet —
     elke gebeurtenis met navigator.sendBeacon versturen. sendBeacon is er
     precies voor gemaakt dat een verzoek het ontladen van de pagina overleeft,
     en dat is wat hier gemeten wordt. De echte gtag.js doet hetzelfde; wat
     Google daarna met de hit doet, is buiten deze toets.
     De omleiding raakt alleen deze browsercontext en niet het bestand. */
  bakens.length = 0;
  const stub = (o) => `
    (function () {
      var dl = window.dataLayer = window.dataLayer || [];
      function stuur(r) {
        if (!r || !r.event || r.event.indexOf('gtm.') === 0) { return; }
        navigator.sendBeacon('${o}/baken', JSON.stringify(r));
      }
      for (var i = 0; i < dl.length; i++) { stuur(dl[i]); }
      var duw = dl.push;
      dl.push = function () {
        for (var j = 0; j < arguments.length; j++) { stuur(arguments[j]); }
        return duw.apply(dl, arguments);
      };
    })();`;
  const { ctx, pg, verzoeken } = await open('/' + LANDING, {
    keuze: 'toegestaan',
    wacht: 1500,
    laatNavigeren: true,
    route: async (p) => {
      await p.route(/googletagmanager\.com\/gtm\.js/, (r) =>
        r.fulfill({ status: 200, contentType: 'text/javascript', body: stub(ORIGIN) }));
      await p.route(/snap\.licdn\.com|px\.ads\.linkedin\.com/, (r) => r.abort());
    },
  });
  ok('de nagemaakte container is in de plaats van die van Google geladen',
     verzoeken.some((u) => /googletagmanager\.com\/gtm\.js/.test(u)));

  /* De voetlink naar youbo.io gaat echt weg. Hij wordt eerst op deze eigen
     server gezet, zodat de toets geen netwerk nodig heeft — de vraag is of de
     gebeurtenis het ontladen overleeft, niet waar de link naartoe wijst. */
  await pg.evaluate((o) => {
    document.querySelector('[data-cta="footer-cases"]').setAttribute('href', o + '/robots.txt');
  }, ORIGIN);
  const voorBakens = bakens.length;
  await Promise.all([
    pg.waitForURL(/robots\.txt/, { timeout: 10000 }),
    pg.evaluate(() => document.querySelector('[data-cta="footer-cases"]').click()),
  ]);
  /* sendBeacon vertrekt tijdens het ontladen; even wachten tot de collector hem
     gezien heeft. */
  await new Promise((r) => setTimeout(r, 1000));
  const nieuw = bakens.slice(voorBakens).map((b) => { try { return JSON.parse(b); } catch (e) { return {}; } });
  ok('de pagina is werkelijk weggenavigeerd', /robots\.txt/.test(pg.url()), pg.url());
  ok('en de gebeurtenis van die klik is tóch bij de container aangekomen',
     nieuw.some((r) => r.event === 'naar_youbo_site' && r.cta === 'footer-cases'),
     JSON.stringify(nieuw));
  await ctx.close();
}

/* ─────────────── 7 · LinkedIn ─────────────────────────────────────────────── */
console.log('\n8. LinkedIn — de lege plek, en wat er gebeurt als hij gevuld is');

/** Vervangt de Insight Tag door een stuk dat lintrk opschrijft in plaats van
 *  verstuurt, zodat te zien is of wij 'track' aanroepen. */
const lintrkStub = `
  (function () {
    /* Het echte insight.min.js vindt window.lintrk al als wachtrijfunctie —
       laadMeettags() zet die neer vóór het script er is — en werkt die wachtrij
       af. Dat moet deze nabootsing ook doen: zonder de twee regels eronder
       overschrijft ze de wachtrij, en dan is de toets groen omdat ze niets ziet
       en niet omdat er niets was. */
    window.__lintrk = [];
    var q = (window.lintrk && window.lintrk.q) ? window.lintrk.q.slice() : [];
    window.lintrk = function (a, b) { window.__lintrk.push([a, b]); };
    for (var i = 0; i < q.length; i++) { window.__lintrk.push(q[i]); }
  })();`;

for (const [wat, conversie] of [['leeg', null], ['gevuld met 12345678', '12345678']]) {
  const { ctx, pg } = await open('/' + BEDANKT, {
    keuze: 'toegestaan',
    wacht: 2500,
    route: async (p) => {
      await p.route(/snap\.licdn\.com/, (r) =>
        r.fulfill({ status: 200, contentType: 'text/javascript', body: lintrkStub }));
      await p.route(/googletagmanager\.com/, (r) => r.abort());
      if (conversie) {
        await p.route(new RegExp(BEDANKT.replace(/\./g, '\\.')), async (r) => {
          const res = await r.fetch();
          const html = (await res.text())
            .replace("demo_aanvraag_bevestigd:  ''", `demo_aanvraag_bevestigd:  '${conversie}'`);
          await r.fulfill({ response: res, body: html, headers: { 'content-type': 'text/html; charset=utf-8' } });
        });
      }
    },
  });
  const sporen = await pg.evaluate(() => (window.__lintrk || []).filter((r) => r[0] === 'track'));
  if (conversie) {
    ok(`conversie-id ${wat}: LinkedIn krijgt de conversie`,
       sporen.length === 1 && sporen[0][1] && String(sporen[0][1].conversion_id) === conversie,
       JSON.stringify(sporen));
  } else {
    ok(`conversie-id ${wat}: er gaat niets naar LinkedIn`, sporen.length === 0, JSON.stringify(sporen));
  }
  await ctx.close();
}

/* ─────────────── 8 · de wacht op het formulier ────────────────────────────── */
console.log('\n9. De wacht — de val, de drempel, en Turnstile die uit staat');

/** Verzendt het formulier en zegt of de verzending door is gegaan. Hier staat
 *  met opzet GEEN preventDefault omheen: de vraag is juist of de wacht hem
 *  tegenhoudt, en dat is alleen te zien aan de pagina die wel of niet
 *  wegnavigeert. Het formulier heeft geen action en geen method, dus een
 *  geslaagde verzending is een GET naar dezelfde pagina met de velden erachter. */
async function verzend(pg, voorbereiding) {
  const was = pg.url();
  if (voorbereiding) { await voorbereiding(pg); }
  await pg.evaluate(() => document.querySelector('form').requestSubmit());
  try { await pg.waitForURL((u) => String(u).indexOf('?') !== -1, { timeout: 3000 }); }
  catch (e) { /* niet weggenavigeerd — dat is een van de twee antwoorden */ }
  return { doorgegaan: pg.url().indexOf('?') !== -1, was, nu: pg.url() };
}

{
  const { ctx, pg, verzoeken } = await open('/' + LANDING, { keuze: 'toegestaan', wacht: 2000, laatNavigeren: true });

  ok('er is geen Turnstile-sitesleutel — en dat is de stand waarin we publiceren',
     (await pg.evaluate(() => FORMULIERWACHT.stand())).sitesleutel === '');
  ok('en er gaat dus geen enkel verzoek naar challenges.cloudflare.com',
     verzoeken.filter((u) => /challenges\.cloudflare\.com/.test(u)).length === 0,
     verzoeken.filter((u) => /challenges\.cloudflare\.com/.test(u)).join(' · '));
  ok('de melding staat verborgen zolang er niets misgaat',
     await pg.evaluate(() => document.querySelector('[data-formulier-melding]').hasAttribute('hidden')));

  /* De val: aria-hidden, buiten de tabvolgorde, geen label, en geen tekst. */
  const val = await pg.evaluate(() => {
    const el = document.querySelector('[data-val-voor-bots]');
    const st = getComputedStyle(el);
    return {
      naam: el.name, tabindex: el.getAttribute('tabindex'),
      ariaVerborgen: el.closest('[aria-hidden="true"]') !== null,
      display: st.display,
      displayOmhulling: getComputedStyle(el.parentElement).display,
      autocomplete: el.getAttribute('autocomplete'),
      label: !!el.labels && el.labels.length,
      tekstInPagina: document.body.innerText.indexOf('extra_notes') !== -1,
    };
  });
  ok('de val heet extra_notes en niet url of website — anders vult autofill hem',
     val.naam === 'extra_notes', val.naam);
  ok('de val staat NIET op display:none — niet het vak en niet de omhulling, want daar kijkt een bot naar',
     val.display !== 'none' && val.displayOmhulling !== 'none',
     `${val.display} / ${val.displayOmhulling}`);
  ok('de val staat buiten de toegankelijkheidsboom en buiten de tabvolgorde',
     val.ariaVerborgen === true && val.tabindex === '-1', JSON.stringify(val));
  ok('de val heeft geen label en geeft dus geen tekst in de pagina',
     val.label === 0 && val.tekstInPagina === false, JSON.stringify(val));

  /* De tabvolgorde van het formulier loopt langs vijf velden en de knop, en de
     val zit er niet in. Dat is de controle die een toetsenbordbezoeker beschermt. */
  const tabvolgorde = await pg.evaluate(() => [...document.querySelectorAll(
    'form input, form textarea, form button, form select, form a[href]')]
    .filter((e) => e.tabIndex >= 0).map((e) => e.name || e.tagName.toLowerCase()));
  ok('de val staat niet in de tabvolgorde van het formulier',
     tabvolgorde.indexOf('extra_notes') === -1, tabvolgorde.join(', '));
  await ctx.close();
}

{
  /* DE DREMPEL. Een script dat meteen na het laden verzendt, zonder ook maar
     één handeling in het formulier, wordt tegengehouden. */
  const { ctx, pg } = await open('/' + LANDING, { keuze: 'toegestaan', wacht: 250, laatNavigeren: true });
  const r = await verzend(pg);
  ok('verzenden binnen 3s zonder enige handeling wordt tegengehouden', r.doorgegaan === false, r.nu);
  const ev = (await onzeEvents(pg));
  ok('en het heet formulier_geweigerd met reden te_snel, niet demo_formulier_verstuurd',
     ev.length >= 1 && ev[ev.length - 1].event === 'formulier_geweigerd'
     && ev.filter((e) => e.event === 'demo_formulier_verstuurd').length === 0,
     JSON.stringify(ev));
  const reden = await pg.evaluate(() => (window.dataLayer || [])
    .filter((r) => r && r.event === 'formulier_geweigerd').map((r) => r.reden));
  ok('   met reden "te_snel"', reden.indexOf('te_snel') !== -1, JSON.stringify(reden));
  ok('en de bezoeker ziet een melding in plaats van een knop die stil niets doet',
     await pg.evaluate(() => !document.querySelector('[data-formulier-melding]').hasAttribute('hidden')));
  await ctx.close();
}

{
  /* WAT EEN MENS OVERKOMT. Vier wegen, allemaal binnen de 3 seconden, en
     allemaal moeten ze dóór: dat is wat de EN naast de drempel doet. */
  const wegen = [
    ['wie met de muis op de knop klikt', async (pg) => {
      await pg.evaluate(() => document.querySelector('[data-cta="formulier-vraag-demo"]')
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    }],
    ['wie met het toetsenbord in een veld typt', async (pg) => {
      await pg.focus('#name');
      await pg.keyboard.type('Anne');
    }],
    ['wie met een schermlezer in een veld belandt (focusin, geen toets)', async (pg) => {
      await pg.evaluate(() => document.getElementById('email').focus());
    }],
    ['wie met een wachtwoordbeheerder alles in één keer vult en dan klikt', async (pg) => {
      await pg.evaluate(() => {
        document.getElementById('name').value = 'Anne Peeters';
        document.getElementById('email').value = 'anne@bedrijf.be';
        document.querySelector('[data-cta="formulier-vraag-demo"]')
          .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      });
    }],
  ];
  for (const [wat, doe] of wegen) {
    const { ctx, pg } = await open('/' + LANDING, { keuze: 'toegestaan', wacht: 250, laatNavigeren: true });
    const r = await verzend(pg, doe);
    ok(`binnen 3s, maar ${wat}: gaat door`, r.doorgegaan === true, r.nu);
    await ctx.close();
  }

  /* En een trage invuller, ruim na de drempel. */
  const { ctx, pg } = await open('/' + LANDING, { keuze: 'toegestaan', wacht: 4000, laatNavigeren: true });
  const r = await verzend(pg);
  ok('en wie er ruim de tijd voor neemt, gaat ook zonder handeling door',
     r.doorgegaan === true, r.nu);
  await ctx.close();
}

{
  /* DE VAL. Een gevulde val houdt de inzending tegen, ook bij een bezoeker die
     alles goed doet — want dat is precies wat een bot is. */
  const { ctx, pg } = await open('/' + LANDING, { keuze: 'toegestaan', wacht: 4000, laatNavigeren: true });
  const r = await verzend(pg, async (p) => {
    await p.evaluate(() => { document.querySelector('[data-val-voor-bots]').value = 'http://spam.example'; });
  });
  ok('een gevulde val houdt de inzending tegen', r.doorgegaan === false, r.nu);
  const reden = await pg.evaluate(() => (window.dataLayer || [])
    .filter((r) => r && r.event === 'formulier_geweigerd').map((r) => r.reden));
  ok('   met reden "honeypot", en géén demo_formulier_verstuurd',
     reden.indexOf('honeypot') !== -1
     && (await onzeEvents(pg)).filter((e) => e.event === 'demo_formulier_verstuurd').length === 0,
     JSON.stringify(reden));
  ok('en de melding staat aan',
     await pg.evaluate(() => !document.querySelector('[data-formulier-melding]').hasAttribute('hidden')));
  await ctx.close();
}

{
  /* DE NIEUWSBRIEF is een eigen gebeurtenis, zodat ze apart te rapporteren is. */
  const { ctx, pg } = await open('/' + LANDING, { keuze: 'toegestaan', wacht: 4000 });
  const voor = (await onzeEvents(pg)).length;
  await pg.evaluate(() => {
    document.getElementById('newsletter').checked = true;
    document.querySelector('form').requestSubmit();
  });
  await pg.waitForTimeout(250);
  const ev = (await onzeEvents(pg)).slice(voor);
  ok('met het vinkje aan geeft één verzending twee gebeurtenissen',
     ev.length === 2
     && ev.some((e) => e.event === 'demo_formulier_verstuurd')
     && ev.some((e) => e.event === 'nieuwsbrief_ingeschreven'),
     JSON.stringify(ev));
  const aanvraag = await pg.evaluate(() => (window.dataLayer || [])
    .filter((r) => r && r.event === 'demo_formulier_verstuurd').map((r) => r.nieuwsbrief));
  ok('en de aanvraag draagt zelf ook nieuwsbrief=ja, zodat de verhouding in één rij staat',
     aanvraag.indexOf('ja') !== -1, JSON.stringify(aanvraag));

  await pg.waitForTimeout(600);
  const voor2 = (await onzeEvents(pg)).length;
  await pg.evaluate(() => {
    document.getElementById('newsletter').checked = false;
    document.querySelector('form').requestSubmit();
  });
  await pg.waitForTimeout(250);
  const ev2 = (await onzeEvents(pg)).slice(voor2);
  ok('met het vinkje uit geeft ze er één', ev2.length === 1
     && ev2[0].event === 'demo_formulier_verstuurd', JSON.stringify(ev2));
  await ctx.close();
}

{
  /* TURNSTILE AANZETTEN IS ÉÉN HANDELING. Hier gebeurt dat in een omgeleide
     kopie van de pagina en niet in het bestand: de sleutel wordt gezet, en dan
     hoort het script van Cloudflare opgevraagd te worden en het oordeel op
     "wacht" te komen tot er een jeton is. Het script zelf wordt afgevangen —
     deze toets praat met niemand buiten 127.0.0.1. */
  const SLEUTEL = '0x4AAAAAAATOETSSLEUTEL';
  const { ctx, pg, verzoeken } = await open('/' + LANDING, {
    keuze: 'toegestaan', wacht: 2000, laatNavigeren: true,
    route: async (p) => {
      await p.route(/challenges\.cloudflare\.com/, (r) =>
        r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__turnstileGevraagd = true;' }));
      await p.route(new RegExp(LANDING.replace(/\./g, '\\.')), async (r) => {
        const res = await r.fetch();
        const html = (await res.text()).replace("var TURNSTILE_SITEKEY = '';", `var TURNSTILE_SITEKEY = '${SLEUTEL}';`);
        await r.fulfill({ response: res, body: html, headers: { 'content-type': 'text/html; charset=utf-8' } });
      });
    },
  });
  ok('met een sitesleutel wordt het script van Cloudflare opgevraagd',
     verzoeken.some((u) => /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/.test(u)),
     verzoeken.filter((u) => /cloudflare/.test(u)).join(' · ') || 'geen enkel verzoek');
  ok('en met render=explicit en een onload, niet het standaardfragment',
     verzoeken.some((u) => /render=explicit/.test(u) && /onload=/.test(u)));
  await pg.focus('#name');          /* anders spreekt de drempel eerst */
  const oordeel = await pg.evaluate(() => FORMULIERWACHT.oordeel(document.querySelector('form')));
  ok('en het oordeel is "wacht" zolang er geen jeton is', oordeel === 'wacht', oordeel);
  const r = await verzend(pg);
  ok('dus gaat de verzending niet door zonder jeton', r.doorgegaan === false, r.nu);
  ok('en de bezoeker blijft niet in het ongewisse: de melding staat aan',
     await pg.evaluate(() => !document.querySelector('[data-formulier-melding]').hasAttribute('hidden')));
  const ev = await pg.evaluate(() => (window.dataLayer || [])
    .filter((r) => r && r.event === 'formulier_controle_mislukt').map((r) => r.reden));
  ok('en de mislukte controle is apart gemeten', ev.length === 1, JSON.stringify(ev));
  ok('en géén demo_formulier_verstuurd',
     (await onzeEvents(pg)).filter((e) => e.event === 'demo_formulier_verstuurd').length === 0);
  await ctx.close();
}

/* ───────────────────────────────── slot ───────────────────────────────────── */
await browser.close();
srv.close();

console.log('');
if (fouten) {
  console.log(rood(`${fouten} fout(en). De meting doet niet wat de uitleg belooft.`));
  process.exit(1);
}
console.log(groen('Alles in orde — elke data-cta-haak is een gebeurtenis, zonder toestemming vertrekt er niets, '
  + 'en de val en de drempel houden tegen wat ze moeten tegenhouden.'));
