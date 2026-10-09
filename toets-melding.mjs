#!/usr/bin/env node
/**
 * Toetst de melding bij een mislukte publicatie.
 *
 *     node toets-melding.mjs
 *
 * WAAROM DIT BESTAAT
 *
 * Een melding die nooit afgegaan is, is een belofte. Deze toets laat hem drie
 * keer echt afgaan, zonder GitHub aan te raken en zonder iets naar de klant te
 * sturen:
 *
 *  1. De WERING: hij zet een echte GitHub-API na op een eigen poort, en laat
 *     meld-mislukking.mjs daar tegen praten. Daardoor is te zien wat er
 *     werkelijk verstuurd wordt — welke titel, welke tekst, welke
 *     @-vermeldingen, welk label, aan wie toegewezen — en niet alleen dat het
 *     script niet crasht.
 *
 *  2. De VOLGORDE: twee mislukkingen achter elkaar mogen niet twee meldingen
 *     geven, en een gelukte publicatie erna moet de open melding sluiten.
 *     Anders loopt het bord vol en kijkt niemand er nog naar.
 *
 *  3. De ECHTE BOUW: in een wegwerpmap met een kapotte faq.yml draait
 *     stamp-version.mjs zoals de Action hem draait. Die stopt, en precies dan
 *     gaat de melding af, met de uitleg die bij díe stap hoort. Dat is het
 *     geval dat we vrezen — Jana typt iets dat de bouw weigert — en het is hier
 *     uitgelokt in plaats van beredeneerd.
 *
 * En de wiring zelf: dat .github/workflows/publiceren.yml de melding werkelijk
 * aanroept bij een mislukking, dat het daar het recht voor heeft, en dat elke
 * stap-id in die workflow ook in meld-mislukking.mjs uitgelegd staat. Haal in
 * de workflow `if: failure()` weg of noem een stap anders, en deze toets wordt
 * rood.
 *
 * Raakt niets aan: geen GitHub, geen FTPS, geen bestand in deze repo. De
 * kapotte faq.yml staat in een map onder /tmp die achteraf verdwijnt.
 */
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const hier = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = join(hier, '.github', 'workflows', 'publiceren.yml');

let fouten = 0;
const groen = (t) => `\x1b[32m${t}\x1b[0m`;
const rood  = (t) => `\x1b[31m${t}\x1b[0m`;
const grijs = (t) => `\x1b[2m${t}\x1b[0m`;

function ok(wat, waar, extra = '') {
  if (waar) console.log(`  ${groen('ok')}    ${wat}${extra ? grijs('  ' + extra) : ''}`);
  else { fouten++; console.log(`  ${rood('FOUT')}  ${wat}${extra ? '\n        ' + extra : ''}`); }
}

/* ------------------------------------------------- de nagemaakte GitHub --- */

// Alleen de vier dingen die meld-mislukking.mjs werkelijk doet: een label
// maken, open meldingen opvragen, een melding maken, en erop reageren of hem
// sluiten. Geen nabootsing van GitHub, wel van dit gesprek.
function startNagemaakteApi() {
  const stand = { labels: [], issues: [], verzoeken: [] };

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const data = body ? JSON.parse(body) : undefined;
      stand.verzoeken.push({ methode: req.method, pad: url.pathname, zoek: url.search, data,
                             jeton: req.headers.authorization });
      const antwoord = (code, inhoud) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(inhoud ?? {}));
      };

      // POST /repos/:o/:r/labels
      if (req.method === 'POST' && /\/labels$/.test(url.pathname)) {
        if (stand.labels.includes(data.name)) return antwoord(422, { message: 'already_exists' });
        stand.labels.push(data.name);
        return antwoord(201, { name: data.name });
      }
      // GET /repos/:o/:r/issues?state=open&labels=…
      if (req.method === 'GET' && /\/issues$/.test(url.pathname)) {
        const label = url.searchParams.get('labels');
        return antwoord(200, stand.issues.filter((i) =>
          i.state === 'open' && (!label || i.labels.includes(label))));
      }
      // POST /repos/:o/:r/issues
      if (req.method === 'POST' && /\/issues$/.test(url.pathname)) {
        const nieuw = {
          number: stand.issues.length + 1, state: 'open',
          title: data.title, body: data.body,
          labels: data.labels ?? [], assignees: data.assignees ?? [], reacties: [],
        };
        stand.issues.push(nieuw);
        return antwoord(201, nieuw);
      }
      // POST /repos/:o/:r/issues/:n/comments
      let m = url.pathname.match(/\/issues\/(\d+)\/comments$/);
      if (req.method === 'POST' && m) {
        const issue = stand.issues.find((i) => i.number === Number(m[1]));
        if (!issue) return antwoord(404, { message: 'not found' });
        issue.reacties.push(data.body);
        return antwoord(201, { id: 1 });
      }
      // PATCH /repos/:o/:r/issues/:n
      m = url.pathname.match(/\/issues\/(\d+)$/);
      if (req.method === 'PATCH' && m) {
        const issue = stand.issues.find((i) => i.number === Number(m[1]));
        if (!issue) return antwoord(404, { message: 'not found' });
        Object.assign(issue, { state: data.state ?? issue.state });
        return antwoord(200, issue);
      }
      antwoord(404, { message: `niet nagemaakt: ${req.method} ${url.pathname}` });
    });
  });

  return new Promise((klaar) => {
    server.listen(0, '127.0.0.1', () => {
      stand.url = `http://127.0.0.1:${server.address().port}`;
      klaar({ stand, stop: () => new Promise((k) => server.close(k)) });
    });
  });
}

// Met spawn en niet spawnSync, en dat is geen smaak: de nagemaakte API draait in
// DIT proces, en spawnSync zet de lus hier stil — dan kan de server het verzoek
// van het kind niet beantwoorden en wacht alles op alles.
function meld({ api, args = [], env = {}, cwd = hier }) {
  return new Promise((klaar) => {
    const kind = spawn(process.execPath, [join(hier, 'meld-mislukking.mjs'), ...args], {
      cwd,
      env: {
        PATH: process.env.PATH,
        GITHUB_API_URL: api,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'breynsv/youbo-landing-drafts',
        GITHUB_TOKEN: 'jeton-van-de-run',
        GITHUB_RUN_ID: '12345',
        GITHUB_SHA: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
        GITHUB_ACTOR: 'jana-voorbeeld',
        ...env,
      },
    });
    let stdout = '', stderr = '';
    kind.stdout.on('data', (c) => { stdout += c; });
    kind.stderr.on('data', (c) => { stderr += c; });
    kind.on('close', (status) => klaar({ status, stdout, stderr }));
  });
}

/* ------------------------------------------------------------- 1 · wiring --- */

console.log('\n1. .github/workflows/publiceren.yml — wordt de melding werkelijk aangeroepen');

const workflowTekst = readFileSync(WORKFLOW, 'utf8');
const workflow = parse(workflowTekst);
const stappen = workflow.jobs?.publiceren?.steps ?? [];

const melder = stappen.find((s) => String(s.run ?? '').includes('meld-mislukking.mjs')
                                 && !String(s.run ?? '').includes('--gelukt'));
const sluiter = stappen.find((s) => String(s.run ?? '').includes('--gelukt'));

ok('er is een stap die meld-mislukking.mjs aanroept', !!melder);
ok('die stap draait juist WEL na een mislukking (if: failure())',
   String(melder?.if ?? '').replace(/\s/g, '') === 'failure()',
   `gevonden: ${JSON.stringify(melder?.if)}`);
ok('de job mag issues schrijven (anders komt de melding nergens)',
   workflow.permissions?.issues === 'write',
   `gevonden: ${JSON.stringify(workflow.permissions)}`);
ok('het jeton van de run wordt meegegeven, en geen eigen geheim',
   /github\.token/.test(String(melder?.env?.GITHUB_TOKEN ?? '')) &&
   !Object.values(melder?.env ?? {}).some((v) => /secrets\./.test(String(v))));
ok('een gelukte publicatie sluit een eerdere melding',
   !!sluiter && /success\(\)/.test(String(sluiter?.if ?? '')));
ok('een proefrit sluit géén melding (die publiceert niets)',
   /proefrit/.test(String(sluiter?.if ?? '')));

// Elke stap-id die de workflow meegeeft, moet in meld-mislukking.mjs uitgelegd
// staan. Zonder deze controle zou iemand een stap kunnen omdopen en zou de
// melding voortaan "welke stap faalde weten we niet" zeggen — precies de
// vaagheid die dit bericht moet vervangen.
const scriptTekst = readFileSync(join(hier, 'meld-mislukking.mjs'), 'utf8');
const idsInStappenEnv = [...String(melder?.env?.STAPPEN ?? '').matchAll(/(^|;)\s*([a-z_]+)=/g)]
  .map((m) => m[2]);
const idsInWorkflow = stappen.map((s) => s.id).filter(Boolean);
const uitgelegd = [...scriptTekst.matchAll(/^  '([a-z_]+)': \{$/gm)].map((m) => m[1]);

ok('de workflow geeft de uitkomst van elke genoemde stap mee',
   idsInWorkflow.every((id) => idsInStappenEnv.includes(id)),
   `workflow: ${idsInWorkflow.join(', ')} · meegegeven: ${idsInStappenEnv.join(', ')}`);
ok('elke stap heeft in meld-mislukking.mjs een uitleg in gewone taal',
   idsInStappenEnv.every((id) => uitgelegd.includes(id)),
   `zonder uitleg: ${idsInStappenEnv.filter((id) => !uitgelegd.includes(id)).join(', ') || '—'}`);
ok('geen enkele stap-id draagt een streepje (dat leest GitHub als minteken)',
   idsInWorkflow.every((id) => !id.includes('-')), idsInWorkflow.join(', '));

/* ------------------------------------------------- 2 · de melding zelf --- */

console.log('\n2. De melding gaat af — tegen een nagemaakte GitHub-API');

const { stand, stop } = await startNagemaakteApi();

try {
  const eerste = await meld({
    api: stand.url,
    env: { STAPPEN: 'bouwen=failure;faq_controle=skipped;pagina_controle=skipped;samenstellen=skipped;doelmap=skipped;uploaden=skipped' },
  });
  ok('de eerste mislukking levert afsluitcode 0 (de melding is weggekomen)',
     eerste.status === 0, (eerste.stderr || '').trim().slice(0, 300));
  ok('er staat nu één melding open', stand.issues.length === 1,
     `${stand.issues.length} melding(en)`);

  const issue = stand.issues[0] ?? {};
  ok('de titel zegt wat er aan de hand is, niet welke stap faalde',
     /niet bijgewerkt/i.test(issue.title ?? ''), issue.title);
  ok('de tekst vermeldt de eigenaar van de repo (@breynsv) — de weg die aankomt',
     (issue.body ?? '').includes('@breynsv'));
  ok('de tekst vermeldt ook wie de opslag deed (@jana-voorbeeld)',
     (issue.body ?? '').includes('@jana-voorbeeld'));
  ok('de tekst zegt dat de site niet stuk is',
     /De site werkt gewoon/.test(issue.body ?? ''));
  ok('de tekst zegt dat opnieuw opslaan niet helpt',
     /Opnieuw opslaan helpt niet/.test(issue.body ?? ''));
  ok('de tekst noemt de gevallen stap in gewone taal',
     /de pagina met de nieuwe tekst maken/.test(issue.body ?? ''));
  ok('de tekst noemt de gebruikelijke oorzaak van juist die stap',
     /een `<`, of een leeg antwoord/.test(issue.body ?? ''));
  ok('er staat een link naar het logboek van de run',
     (issue.body ?? '').includes('/actions/runs/12345'));
  ok('de melding draagt het label publicatie-mislukt',
     (issue.labels ?? []).includes('publicatie-mislukt'));
  ok('het label is eerst aangemaakt (GitHub weigert anders het hele issue)',
     stand.verzoeken.some((v) => v.methode === 'POST' && /\/labels$/.test(v.pad)));
  ok('de melding is toegewezen aan wie de opslag deed',
     (issue.assignees ?? []).includes('jana-voorbeeld'));
  ok('het jeton van de run is gebruikt en niets anders',
     stand.verzoeken.every((v) => !v.jeton || v.jeton === 'Bearer jeton-van-de-run'));

  const tweede = await meld({ api: stand.url, env: { STAPPEN: 'bouwen=failure', GITHUB_RUN_ID: '12346' } });
  ok('een tweede mislukking maakt GEEN tweede melding',
     tweede.status === 0 && stand.issues.length === 1, `${stand.issues.length} melding(en)`);
  ok('ze komt als reactie onder dezelfde melding',
     (stand.issues[0]?.reacties ?? []).length === 1);
  ok('die reactie vermeldt opnieuw beide namen (ook een reactie komt aan)',
     /@breynsv/.test(stand.issues[0]?.reacties?.[0] ?? '') &&
     /@jana-voorbeeld/.test(stand.issues[0]?.reacties?.[0] ?? ''));

  const weerGoed = await meld({ api: stand.url, args: ['--gelukt'], env: { GITHUB_RUN_ID: '12347' } });
  ok('een gelukte publicatie sluit de melding',
     weerGoed.status === 0 && stand.issues[0]?.state === 'closed',
     `stand: ${stand.issues[0]?.state}`);
  ok('met een reactie erbij, zodat de draad zelf zegt dat het goed is',
     (stand.issues[0]?.reacties ?? []).some((r) => /weer goed/i.test(r)));

  const nietsTeSluiten = await meld({ api: stand.url, args: ['--gelukt'] });
  ok('een volgende gelukte publicatie doet niets en klaagt niet',
     nietsTeSluiten.status === 0 && /Geen open melding/.test(nietsTeSluiten.stdout));

  // Een bot-actor is geen ontvanger: "@github-actions[bot]" is in GitHub's
  // tekst geen vermelding maar rommel, en toewijzen zou afketsen.
  const doorEenBot = await meld({
    api: stand.url,
    env: { GITHUB_ACTOR: 'github-actions[bot]', STAPPEN: 'uploaden=failure', GITHUB_RUN_ID: '12348' },
  });
  const botIssue = stand.issues[1] ?? {};
  ok('een run door een bot vermeldt geen bot en wijst niemand toe',
     doorEenBot.status === 0 && !/\[bot\]/.test(botIssue.body ?? '') &&
     (botIssue.assignees ?? []).length === 0);
  ok('en noemt de juiste stap (uploaden) in gewone taal',
     /server van de klant/.test(botIssue.body ?? ''));

  /* ------------------------------------------ 3 · de echte bouw faalt --- */

  console.log('\n3. Een echte bouw laten falen — en kijken of de melding afgaat');

  // Schone lei: de meldingen van hierboven staan nog open, en dan zou deze
  // mislukking terecht een reactie worden in plaats van een nieuwe melding.
  // Hier gaat het om de nieuwe melding, dus eerst alles dicht.
  for (const i of stand.issues) i.state = 'closed';

  const wegwerp = mkdtempSync(join(tmpdir(), 'youbo-melding-'));
  try {
    mkdirSync(join(wegwerp, 'content'));
    // Alles wat `node stamp-version.mjs` nodig heeft. Ontbreekt er één, dan
    // faalt de bouw op een ontbrekende module in plaats van op de fout die we
    // hier willen uitlokken — en dan is deze toets rood om de verkeerde reden.
    // Dat is al twee keer gebeurd: met faq-opmaak.js (2026-10-09) en met
    // build-inhoud.mjs (2026-10-10).
    for (const f of ['build-faq.mjs', 'faq-opmaak.js', 'build-inhoud.mjs', 'inhoud-opmaak.js',
                     'lees-yaml.js', 'stamp-version.mjs', 'meld-mislukking.mjs',
                     'VERSION', 'draft-r3-01-definitief.html']) {
      copyFileSync(join(hier, f), join(wegwerp, f));
    }
    for (const f of ['pagina.yml', 'klanten.yml', 'contact.yml']) {
      copyFileSync(join(hier, 'content', f), join(wegwerp, 'content', f));
    }
    // En de beelden waar die bestanden naar verwijzen, want build-inhoud.mjs
    // stopt op een ontbrekend bestand — met recht, maar dan zou deze toets
    // dáárop vastlopen in plaats van op de HTML in het FAQ-antwoord. De lijst
    // wordt uit de inhoudsbestanden zelf gehaald en niet hier opgeschreven,
    // zodat een beeldveld dat er morgen bijkomt, meekomt.
    mkdirSync(join(wegwerp, 'assets', 'img'), { recursive: true });
    const beelden = new Set();
    for (const f of ['pagina.yml', 'klanten.yml', 'contact.yml']) {
      for (const m of readFileSync(join(hier, 'content', f), 'utf8').matchAll(/assets\/img\/[\w.-]+/g)) {
        beelden.add(m[0]);
      }
    }
    for (const beeld of beelden) copyFileSync(join(hier, beeld), join(wegwerp, beeld));
    // Precies de fout die we van een invulveld vrezen: HTML in de tekst.
    writeFileSync(join(wegwerp, 'content', 'faq.yml'),
      'items:\n  - vraag: Hoeveel kost het?\n    antwoord: |-\n      Een <b>vet</b> antwoord.\n');

    const bouw = spawnSync(process.execPath, [join(wegwerp, 'stamp-version.mjs')],
      { cwd: wegwerp, encoding: 'utf8' });
    ok('stamp-version.mjs stopt op een antwoord met HTML erin',
       bouw.status !== 0, `afsluitcode ${bouw.status}`);
    ok('en zegt waarom, in plaats van alleen te falen',
       /</.test(bouw.stdout + bouw.stderr) && /(STOP|teken|<)/.test(bouw.stdout + bouw.stderr),
       (bouw.stdout + bouw.stderr).trim().split('\n').slice(-2).join(' · ').slice(0, 220));

    const naDeKapotteBouw = await meld({
      api: stand.url, cwd: wegwerp,
      env: { STAPPEN: 'bouwen=failure', GITHUB_RUN_ID: '12349' },
    });
    const laatste = stand.issues.at(-1) ?? {};
    ok('en dan gaat de melding af, met de uitleg die bij die stap hoort',
       naDeKapotteBouw.status === 0 &&
       /de pagina met de nieuwe tekst maken/.test(laatste.body ?? '') &&
       (laatste.body ?? '').includes('@breynsv'),
       naDeKapotteBouw.stdout.trim());
  } finally {
    rmSync(wegwerp, { recursive: true, force: true });
  }

  /* ----------------------------------------------- 4 · de proefrit --- */

  console.log('\n4. De proefrit stuurt niets');

  const proef = await meld({ api: stand.url, args: ['--proefrit'], env: { STAPPEN: 'bouwen=failure' } });
  const voor = stand.verzoeken.length;
  ok('een proefrit toont de tekst en doet geen enkel verzoek',
     proef.status === 0 && /PROEFRIT/.test(proef.stdout) && stand.verzoeken.length === voor);
  ok('zonder jeton zegt het script dat, in plaats van stil niets te doen',
     (await meld({ api: stand.url, env: { GITHUB_TOKEN: '', STAPPEN: 'bouwen=failure' } })).status !== 0);
} finally {
  await stop();
}

console.log('');
if (fouten) {
  console.log(rood(`${fouten} fout(en). Een mislukte publicatie zou zo stil kunnen blijven.`));
  process.exit(1);
}
console.log(groen('Alles in orde — een mislukte publicatie bereikt een mens.'));
