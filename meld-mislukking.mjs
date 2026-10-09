#!/usr/bin/env node
/**
 * Zegt het tegen een mens wanneer een publicatie mislukt is — of gelukt na een
 * mislukking.
 *
 *     node meld-mislukking.mjs              # er ging iets mis: meld het
 *     node meld-mislukking.mjs --gelukt     # het is weer goed: sluit de melding
 *     node meld-mislukking.mjs --proefrit   # zegt wat het zou versturen, verstuurt niets
 *
 * WAAROM DIT BESTAAT
 *
 * Jana slaat in /beheer/ een antwoord op. Sveltia commit content/faq.yml, de
 * Action bouwt en uploadt, en enkele minuten later staat haar tekst op de site
 * van de klant. Gaat er onderweg iets mis, dan verandert de pagina simpelweg
 * niet — en dat is precies hoe "het duurt even" eruitziet. Zij ziet geen
 * verschil tussen wachten en stuk. Ze slaat dus opnieuw op, of besluit dat het
 * ding niet werkt. Niemand weet dat de site de tekst van gisteren toont.
 *
 * WAAROM EEN ISSUE EN NIET EEN E-MAIL
 *
 * GitHub stuurt zelf wél een bericht bij een mislukte Action, en dat is de val:
 * het gaat naar degene die de run *startte*, en naar niemand anders. De
 * documentatie is daar ondubbelzinnig over — "you'll receive a notification when
 * any workflow runs that you've triggered have completed" — en noemt eigenaars
 * noch beheerders als ontvanger. Komt de commit van Jana, dan krijgt Jana dus
 * een Engelse mail over een "workflow run" en krijgt Sven niets. De enige die
 * het kan herstellen, hoort er niet van.
 *
 * Dus maakt deze stap een issue aan in deze repo, met @-vermelding van de
 * eigenaar én van wie de opslag deed. Een @-vermelding is de ene weg die GitHub
 * zelf als "participating" documenteert, en die staat bij iedereen standaard
 * aan: ze komt aan als mail en in de notificatielijst. De tekst is Nederlands en
 * zegt wat het betekent in plaats van welke stap faalde.
 *
 * WAAROM GEEN SMTP, SLACK OF WORKER
 *
 * Elk van die drie heeft een geheim nodig dat iemand moet aanmaken, bewaren en
 * ooit vernieuwen — en een melding die stilvalt omdat een sleutel verlopen is,
 * is erger dan geen melding, want niemand merkt dat ze stil is. Dit script
 * gebruikt alleen het jeton dat de Action zelf al heeft (`GITHUB_TOKEN`), dat
 * per run bestaat en daarna niet meer. Er is dus niets te beheren en niets te
 * lekken. Verder: alleen ingebouwde node-modules, net als de rest van de
 * pijplijn — geen `npm ci` nodig.
 *
 * WAAROM ÉÉN MELDING EN NIET TIEN
 *
 * Slaat Jana drie keer op terwijl de fout er nog is, dan zijn er drie mislukte
 * runs. Drie issues zouden van de melding ruis maken, en ruis wordt genegeerd.
 * Dus: is er al een open melding, dan komt er een reactie onder díe melding — in
 * dezelfde draad, met dezelfde @-vermelding, dus even goed aankomend.
 *
 * En omgekeerd: lukt een publicatie later weer, dan sluit dit script de open
 * melding met een reactie erbij. Daardoor betekent "er staat een open melding"
 * werkelijk "het is nu stuk". Een bord dat alleen volloopt, is na een maand een
 * bord waar niemand meer naar kijkt.
 */

const ARG = process.argv.slice(2);
const GELUKT   = ARG.includes('--gelukt');
const PROEFRIT = ARG.includes('--proefrit');

const LABEL = 'publicatie-mislukt';

const env = process.env;
const API    = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const SERVER = (env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
const REPO   = env.GITHUB_REPOSITORY || '';
const TOKEN  = env.GITHUB_TOKEN || env.GH_TOKEN || '';
const RUN_ID = env.GITHUB_RUN_ID || '';
const SHA    = env.GITHUB_SHA || '';
const ACTOR  = env.GITHUB_ACTOR || '';
const WIE    = env.STAPPEN || '';          // "bouwen=failure;faq_controle=skipped;..."

function stop(bericht) {
  console.error('STOP — ' + bericht);
  process.exit(1);
}

if (!REPO.includes('/')) stop('GITHUB_REPOSITORY ontbreekt — dit script hoort in een Action te draaien');
const [EIGENAAR] = REPO.split('/');

/* ------------------------------------------------------------ de stappen --- */

// Wat elke stap van de pijplijn in gewone taal is, en wat het meestal betekent
// als juist die faalt. Een melding die "step 2 failed" zegt, laat het uitzoeken
// aan de lezer; deze zegt waar hij moet kijken. De sleutels zijn de `id`'s uit
// .github/workflows/publiceren.yml — staat daar een stap bij, dan hoort hij hier
// ook, en zegt toets-melding.mjs dat als het niet zo is.
const STAPPEN = {
  'bouwen': {
    wat: 'de pagina met de nieuwe tekst maken',
    meestal: 'er staat iets in een antwoord dat de bouw niet aanvaardt — een `<`, of een leeg antwoord. Dat is geen defect maar een weigering: tekst uit een invulveld mag geen HTML worden.',
  },
  'faq_controle': {
    wat: 'nakijken of de gebouwde pagina overeenkomt met de tekst uit /beheer/',
    meestal: 'de bouwstap heeft de nieuwe tekst niet in de pagina gezet. Dat is een fout in de pijplijn zelf, niet in de tekst.',
  },
  'pagina_controle': {
    wat: 'de 19 paginacontroles',
    meestal: 'iets anders in de pagina is stuk — een verdwenen afbeelding of een verboden bestandsnaam. Zelden de FAQ-tekst.',
  },
  'samenstellen': {
    wat: 'uitzoeken welke bestanden naar de klant mogen',
    meestal: 'een afbeelding of een verwijzing ontbreekt. De bouw stopt dan met opzet: liever niets publiceren dan een pagina met gaten.',
  },
  'doelmap': {
    wat: 'de doelmap op de server opvragen',
    meestal: 'publiceer.mjs kon niet gelezen worden. Dit faalt vrijwel nooit.',
  },
  'uploaden': {
    wat: 'de bestanden naar de server van de klant zetten',
    meestal: 'de verbinding of de inloggegevens van de FTPS-server. De pagina is dan gebouwd en goedgekeurd; alleen het laatste stukje ging niet door. Vaak een gewijzigd wachtwoord of een server die even weg was.',
  },
};

/** De eerste stap die faalde, uit de STAPPEN-env die de workflow meegeeft. */
function gevallenStap() {
  for (const stuk of WIE.split(';')) {
    const [naam, uitkomst] = stuk.split('=');
    if (uitkomst === 'failure' && STAPPEN[naam]) return { naam, ...STAPPEN[naam] };
  }
  return undefined;
}

/* --------------------------------------------------------------- de tekst --- */

const nu = new Date();
const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
                 'augustus', 'september', 'oktober', 'november', 'december'];
const datum = `${nu.getDate()} ${MAANDEN[nu.getMonth()]} ${nu.getFullYear()}`;
const klok  = `${String(nu.getHours()).padStart(2, '0')}:${String(nu.getMinutes()).padStart(2, '0')}`;

const runUrl    = RUN_ID ? `${SERVER}/${REPO}/actions/runs/${RUN_ID}` : '(geen run bekend)';
const commitUrl = SHA ? `${SERVER}/${REPO}/commit/${SHA}` : '';
const kortSha   = SHA ? SHA.slice(0, 7) : '';

// Alleen echte mensen vermelden. Een bot-actor (`github-actions[bot]`) is geen
// ontvanger, en een @-vermelding met blokhaken erin wordt geen vermelding maar
// rommel in de tekst.
const mens = ACTOR && !/\[bot\]$/.test(ACTOR);
const vermeldingen = [`@${EIGENAAR}`, ...(mens && ACTOR !== EIGENAAR ? [`@${ACTOR}`] : [])].join(' ');

function mislukTekst() {
  const stap = gevallenStap();
  const regels = [
    vermeldingen,
    '',
    '**De laatste opslag in /beheer/ staat NIET op de site.**',
    '',
    'Wat dat betekent:',
    '',
    '- De site werkt gewoon. Hij toont de tekst van vóór deze opslag.',
    '- Opnieuw opslaan helpt niet: dezelfde fout komt terug.',
    '- Niemand buiten deze twee namen heeft hier iets van gemerkt.',
    '',
  ];

  if (stap) {
    regels.push(`Wat er faalde: **${stap.wat}**.`, '', `Meestal betekent dat: ${stap.meestal}`, '');
  } else {
    regels.push(
      'Welke stap faalde, staat niet in dit bericht — de workflow gaf het niet mee.',
      'Het logboek hieronder zegt het wel.',
      '',
    );
  }

  regels.push(
    'Wie wat doet:',
    '',
    `- **${mens && ACTOR !== EIGENAAR ? `@${ACTOR}` : 'Wie de tekst aanpaste'}**: niets, en vooral niet opnieuw opslaan.`,
    `- **@${EIGENAAR}**: het logboek openen en herstellen.`,
    '',
    `Logboek van de mislukte publicatie: ${runUrl}`,
  );
  if (commitUrl) regels.push(`De opslag die het betrof: ${kortSha} ${commitUrl}`);
  regels.push(
    '',
    '---',
    '',
    `_Dit bericht is door de publicatiepijplijn gemaakt (${datum} ${klok}). Het sluit zichzelf zodra een publicatie weer lukt. Blijft het open staan, dan is het nu nog stuk._`,
  );
  return regels.join('\n');
}

function geluktTekst() {
  return [
    vermeldingen,
    '',
    '**Het is weer goed: de publicatie is gelukt en de site staat bij.**',
    '',
    `Logboek van de gelukte publicatie: ${runUrl}`,
    '',
    '_Deze melding wordt daarom gesloten._',
  ].join('\n');
}

/* ----------------------------------------------------------------- GitHub --- */

async function api(pad, { methode = 'GET', body } = {}) {
  const url = pad.startsWith('http') ? pad : `${API}${pad}`;
  const antwoord = await fetch(url, {
    method: methode,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'youbo-publiceren',
      'x-github-api-version': '2022-11-28',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const tekst = await antwoord.text();
  let data;
  try { data = tekst ? JSON.parse(tekst) : undefined; } catch { data = undefined; }
  return { ok: antwoord.ok, status: antwoord.status, data, tekst };
}

/** Het label moet bestaan vóór het op een issue gezet wordt: GitHub weigert
 *  anders het hele issue, niet alleen het label. */
async function zorgVoorLabel() {
  const r = await api(`/repos/${REPO}/labels`, {
    methode: 'POST',
    body: {
      name: LABEL,
      color: 'b60205',
      description: 'Een opslag in /beheer/ is niet op de site terechtgekomen.',
    },
  });
  if (r.ok) return 'aangemaakt';
  if (r.status === 422) return 'bestond al';     // already_exists
  console.error(`  nota: het label kon niet aangemaakt worden (${r.status}); de melding gaat zonder label`);
  return 'niet gelukt';
}

async function openMelding() {
  const r = await api(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=1`);
  if (!r.ok) return undefined;
  const lijst = Array.isArray(r.data) ? r.data : [];
  return lijst.find((i) => !i.pull_request);
}

/* ------------------------------------------------------------------- doen --- */

const titel = `De site is niet bijgewerkt — publicatie mislukt op ${datum}`;
const tekst = GELUKT ? geluktTekst() : mislukTekst();

if (PROEFRIT) {
  console.log('PROEFRIT — er wordt niets naar GitHub gestuurd.\n');
  console.log(`repo       : ${REPO}`);
  console.log(`soort      : ${GELUKT ? 'gelukt (melding sluiten)' : 'mislukt (melding maken)'}`);
  console.log(`label      : ${LABEL}`);
  console.log(`vermeldt   : ${vermeldingen}`);
  if (!GELUKT) console.log(`titel      : ${titel}`);
  console.log('\n--- de tekst ---\n');
  console.log(tekst);
  process.exit(0);
}

if (!TOKEN) stop('GITHUB_TOKEN ontbreekt — zonder jeton kan er geen melding gemaakt worden');

const bestaande = await openMelding();

if (GELUKT) {
  if (!bestaande) {
    console.log('Geen open melding — niets te sluiten.');
    process.exit(0);
  }
  const r1 = await api(`/repos/${REPO}/issues/${bestaande.number}/comments`, {
    methode: 'POST', body: { body: geluktTekst() },
  });
  const r2 = await api(`/repos/${REPO}/issues/${bestaande.number}`, {
    methode: 'PATCH', body: { state: 'closed', state_reason: 'completed' },
  });
  if (!r1.ok || !r2.ok) stop(`melding #${bestaande.number} kon niet gesloten worden (${r1.status}/${r2.status})`);
  console.log(`Melding #${bestaande.number} gesloten: de publicatie is weer gelukt.`);
  process.exit(0);
}

if (bestaande) {
  const r = await api(`/repos/${REPO}/issues/${bestaande.number}/comments`, {
    methode: 'POST', body: { body: mislukTekst() },
  });
  if (!r.ok) stop(`er kon geen reactie bij melding #${bestaande.number} geplaatst worden (${r.status}) — ${r.tekst.slice(0, 300)}`);
  console.log(`Melding #${bestaande.number} bestond al; er is een reactie bij gezet in plaats van een tweede melding.`);
  process.exit(0);
}

const labelStand = await zorgVoorLabel();
const nieuw = await api(`/repos/${REPO}/issues`, {
  methode: 'POST',
  body: {
    title: titel,
    body: mislukTekst(),
    ...(labelStand === 'niet gelukt' ? {} : { labels: [LABEL] }),
    ...(mens ? { assignees: [ACTOR] } : {}),
  },
});

// Een toewijzing kan afketsen (iemand zonder toegang tot deze repo), en dat mag
// de melding zelf niet tegenhouden: de @-vermelding in de tekst is de weg die
// aankomt, de toewijzing is een extra.
if (!nieuw.ok && mens) {
  console.error(`  nota: de melding kon niet aan @${ACTOR} toegewezen worden (${nieuw.status}); er volgt een poging zonder toewijzing`);
  const tweede = await api(`/repos/${REPO}/issues`, {
    methode: 'POST',
    body: { title: titel, body: mislukTekst(), ...(labelStand === 'niet gelukt' ? {} : { labels: [LABEL] }) },
  });
  if (!tweede.ok) stop(`de melding kon niet gemaakt worden (${tweede.status}) — ${tweede.tekst.slice(0, 300)}`);
  console.log(`Melding #${tweede.data?.number} aangemaakt (label ${labelStand}, zonder toewijzing).`);
  process.exit(0);
}

if (!nieuw.ok) stop(`de melding kon niet gemaakt worden (${nieuw.status}) — ${nieuw.tekst.slice(0, 300)}`);
console.log(`Melding #${nieuw.data?.number} aangemaakt (label ${labelStand}${mens ? `, toegewezen aan @${ACTOR}` : ''}).`);
