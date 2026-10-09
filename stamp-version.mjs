#!/usr/bin/env node
/**
 * Stempelt de ontwerpversie in elke draft, vlak voor publicatie — en bouwt
 * eerst de FAQ uit content/faq.yml (build-faq.mjs; zie de nota onderaan de
 * invoer, en de kop van dat bestand).
 *
 *     node stamp-version.mjs            # bouwt de FAQ en stempelt
 *     node stamp-version.mjs --dry-run  # zegt alleen wat het zou doen
 *
 * WAAROM DIT BESTAAT
 *
 * Het echte risico van een feedbackronde is niet dat een opmerking verloren
 * gaat. Het is dat je een opmerking leest die over een pagina gaat die
 * sindsdien veranderd is. Elke gepubliceerde pagina draagt daarom haar versie,
 * de tool toont die bovenaan, en elke opmerking onthoudt op welke versie ze
 * geschreven is. Oudere opmerkingen krijgen dan het label
 * "op een eerdere versie gemaakt".
 *
 * WAAROM HET EEN BUILD COMMAND IS EN GEEN HANDELING
 *
 * Studio 28 heeft twee repo's: de bronnen en de gepubliceerde kopie, met een
 * publish.py ertussen die stempelt. Hier is er één repo die Cloudflare Pages
 * rechtstreeks publiceert, dus is er geen tussenstap om het in te hangen —
 * behalve de build command. Daar staat hij:
 *
 *     Settings → Build → Build command : node stamp-version.mjs
 *     Settings → Environment variables : SKIP_DEPENDENCY_INSTALL = 1
 *
 * Dat is niet toevallig de plek. Een stempel die iemand met de hand moet
 * bijwerken, is een stempel die liegt zodra iemand het vergeet — en niemand
 * ziet dat. Nu wordt hij bij élke deploy opnieuw gezet, met de datum van die
 * deploy erin. Daardoor verandert de versie-aanduiding zodra de pagina
 * opnieuw online gaat, zelfs als niemand aan het VERSION-bestand dacht.
 *
 * VERSION is er dus alleen om er samen een naam aan te geven ("v3.1"). Het
 * nummer verhogen mag, vergeten mag ook; de datum doet het werk.
 *
 * De drafts worden NIET met een stempel in git bewaard. Dit script schrijft in
 * de werkmap van de build, en in die van Cloudflare. Zo blijft git schoon en
 * is er één bron van waarheid.
 *
 * Als de build command niet staat: de pagina draagt geen stempel, en de tool
 * zet rechtsboven "versie onbekend" in het rood. Dat is bewust luidruchtig.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bouwFaq } from './build-faq.mjs';

const hier   = dirname(fileURLToPath(import.meta.url));
const proef  = process.argv.includes('--dry-run');

// EERST DE INHOUD, DAARNA DE STEMPEL.
//
// Sinds 2026-10-09 komt de FAQ van draft-r3-01-definitief.html uit
// content/faq.yml in plaats van uit de HTML. Die bouwstap hangt bewust hieraan
// en niet aan een tweede build command: Cloudflare draait één commando, en een
// tweede dat iemand in het dashboard had moeten instellen, is een commando dat
// ooit niet ingesteld is — en dan publiceert de pagina stilletjes de FAQ van
// vorige maand, zonder dat iemand dat ziet. Precies het argument waarmee de
// stempel hier staat en geen handeling is.
//
// Dit script blijft dus "stamp-version" heten en doet er één ding bij, in de
// enige juiste volgorde: eerst de tekst in de pagina zetten, dan stempelen
// welke versie dat is. Gaat de FAQ-bouw niet door, dan stopt build-faq.mjs het
// hele proces en mislukt de deploy — dat is de bedoeling, want dan houdt
// Cloudflare de vorige publicatie online in plaats van een halve FAQ.
bouwFaq({ proef });

const MAANDEN =['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
                 'augustus', 'september', 'oktober', 'november', 'december'];

function stop(bericht) {
  console.error('STOP — ' + bericht);
  process.exit(1);
}

const versieBestand = join(hier, 'VERSION');
if (!existsSync(versieBestand)) stop('VERSION ontbreekt — zonder nummer is er geen stempel');

const nummer = readFileSync(versieBestand, 'utf8').trim();
if (!/^\d+\.\d+$/.test(nummer)) stop(`VERSION bevat "${nummer}" — verwacht iets als 3.0`);

const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const exact    = `${nummer}+${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
const leesbaar = `v${nummer} — ${d.getDate()} ${MAANDEN[d.getMonth()]} ${d.getFullYear()}`;

// Beide varianten eruit, zodat een herpublicatie vervangt in plaats van stapelt.
const OUD = /\s*<meta name="ontwerp-versie[^"]*"[^>]*>/gi;
// Alleen een <head> die alleen op zijn regel staat. In deze drafts komt de
// tekst "<head>" ook voor in commentaar en in JavaScript-strings; een naïeve
// vervanging van de eerste treffer zou de stempel daar kunnen neerzetten.
const HEAD = /^<head>$/m;

// Dezelfde verzameling als check-drafts.mjs en shoot-thumbs.mjs: elke draft, plus
// elke pagina die zichzelf met <meta name="pagina-soort" content="vergelijking">
// aanmeldt. Een vergelijkingspagina wordt net zo goed gepubliceerd en net zo goed
// becommentarieerd, dus moet ze net zo goed zeggen welke versie je bekijkt —
// anders is "versie onbekend" straks geen signaal meer maar normaal.
const VERGELIJKING_META = /<meta[^>]+name=["']pagina-soort["'][^>]+content=["']\s*vergelijking\s*["']/i;
const drafts = readdirSync(hier)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => f.startsWith('draft-') ||
                 VERGELIJKING_META.test(readFileSync(join(hier, f), 'utf8')))
  .sort();

if (!drafts.length) stop('geen te stempelen pagina gevonden — staat dit script in de juiste map?');

let gedaan = 0;
for (const naam of drafts) {
  const pad = join(hier, naam);
  const was = readFileSync(pad, 'utf8');
  const zonder = was.replace(OUD, '');
  if (!HEAD.test(zonder)) stop(`${naam} heeft geen <head> op een eigen regel — niet te stempelen`);
  const wordt = zonder.replace(
    HEAD,
    '<head>\n<meta name="ontwerp-versie" content="' + exact + '">' +
    '\n<meta name="ontwerp-versie-leesbaar" content="' + leesbaar + '">',
  );
  if (!proef && wordt !== was) writeFileSync(pad, wordt);
  gedaan++;
}

console.log(`${proef ? '(proef) ' : ''}${gedaan} draft(s) gestempeld: ${leesbaar}  (${exact})`);
