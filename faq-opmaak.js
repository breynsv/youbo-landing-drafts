/**
 * De OPMAAK van de FAQ: hoe een vraag en een antwoord HTML worden.
 *
 * WAAROM DIT EEN APART BESTAND IS
 *
 * Deze functies stonden in build-faq.mjs en doen daar nog precies hetzelfde.
 * Ze staan nu apart omdat er sinds 2026-10-09 een tweede lezer is: het
 * voorbeeldvenster in /beheer/ (beheer/voorbeeld.js) laat Jana haar tekst zien
 * in de echte opmaak van de pagina, en dat moet dezelfde opmaak zijn — niet een
 * nabootsing die er bijna zo uitziet. Een voorbeeld dat liegt is erger dan geen
 * voorbeeld, dus is er maar één plek waar die HTML gemaakt wordt, en dit is ze.
 *
 * Daarom staat hier ook niets uit node: geen fs, geen path. Dit bestand wordt
 * zowel door node (de bouw) als door de browser (het voorbeeld) ingelezen, en
 * het heet .js en niet .mjs omdat niet elke statische server .mjs als
 * JavaScript uitlevert.
 *
 * Wat hier NIET in hoort: lezen, keuren en wegschrijven. Dat blijft
 * build-faq.mjs — het voorbeeldvenster leest geen bestanden.
 */

// De analytics-labels van de zes vragen van oktober 2026. Ze staan hier en niet
// in content/faq.yml omdat faq.yml precies twee velden heeft — vraag en
// antwoord — en dat de afspraak is met de CMS-kant. Een data-cta is ook niets
// voor de marketeer: het is de naam waaronder een klik in de rapportage
// terechtkomt, en die naam moet gelijk blijven terwijl de tekst verandert.
// Sleutel is de vraag zelf, dus herschikken verandert niets. Herschrijft iemand
// een vraag, dan valt dat label terug op een slug en zegt dit script dat.
export const CTA_ERFENIS = new Map([
  ['Hoe lang duurt het om Youbo op te zetten?',          'faq-opzet'],
  ['Vanaf hoeveel medewerkers is Youbo relevant?',       'faq-omvang'],
  ['Hoeveel kost het?',                                  'faq-prijs'],
  ['Past Youbo zich aan onze manier van werken aan?',    'faq-maatwerk'],
  ['Is Youbo geschikt voor meerdere landen en niveaus?', 'faq-landen'],
  ['Hoe helpt Youbo met compliance?',                    'faq-compliance'],
]);

// Een alinea die zo begint is een nota aan onszelf, geen antwoord aan de
// bezoeker. Ze krijgt het TODO-kader van de pagina — een los kader met een
// stippellijn, niet geel; zo ziet het er in het voorbeeldvenster ook uit — en de
// vraag valt uit de
// FAQPage-structuurdata — want een openstaand antwoord aan Google aanbieden als
// antwoord is erger dan geen structuurdata. Dat is ook precies waarom de
// prijsvraag vandaag in de zichtbare FAQ staat en niet in de JSON-LD.
export const TODO_ALINEA = /^TODO\s+—\s+/;

/* --------------------------------------------------------------- opmaak --- */

// Een waarde op één regel kan evengoed regelafbrekingen bevatten: een YAML-lezer
// mag "a\nb" ook als dubbel aangehaalde string schrijven. Dezelfde afspraak als
// bij "|" — een regelafbreking is een alineagrens. Dit is óók de vorm waarin het
// CMS een antwoord aanlevert terwijl Jana typt, dus leest het voorbeeldvenster
// haar tekst met precies deze regel.
export const alineasUitTekst = (tekst) =>
  tekst.split('\n').map((r) => r.trim()).filter((r) => r !== '');

export const ontsnap = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function slug(vraag) {
  const kaal = vraag.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const woorden = kaal.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).slice(0, 5);
  return 'faq-' + (woorden.join('-') || 'vraag');
}

export function ctas(items) {
  const uit = [];
  const gezien = new Set();
  for (const item of items) {
    let naam = CTA_ERFENIS.get(item.vraag);
    if (!naam) {
      naam = slug(item.vraag);
      console.log(`  nota: "${item.vraag}" heeft geen vast analytics-label; data-cta wordt "${naam}"`);
    }
    // check-drafts.mjs waarschuwt bij een dubbele data-cta, en terecht: twee
    // hooks met dezelfde naam zijn in de rapportage niet te scheiden.
    let kandidaat = naam, n = 2;
    while (gezien.has(kandidaat)) kandidaat = `${naam}-${n++}`;
    gezien.add(kandidaat);
    uit.push(kandidaat);
  }
  return uit;
}

export function alineaHtml(tekst, eerste) {
  const todo = TODO_ALINEA.test(tekst);
  const klasse = todo ? 'todo mt-4' : `text-body text-ink-soft${eerste ? '' : ' mt-4'}`;
  let binnen = ontsnap(tekst);
  if (todo) {
    const dp = tekst.indexOf(':');
    binnen = dp === -1
      ? `<b>${ontsnap(tekst)}</b>`
      : `<b>${ontsnap(tekst.slice(0, dp))}</b>${ontsnap(tekst.slice(dp))}`;
  }
  return { todo, klasse, binnen };
}

export function paneelHtml(item) {
  const stukken = item.alineas.map((t, n) => alineaHtml(t, n === 0));
  if (stukken.length === 1 && !stukken[0].todo) {
    return [
      '          <p class="pb-6 pr-6 text-body text-ink-soft">',
      `            ${stukken[0].binnen}`,
      '          </p>',
    ];
  }
  const regels = ['          <div class="pb-6 pr-6">'];
  for (const s of stukken) {
    regels.push(`            <p class="${s.klasse}">`);
    regels.push(`              ${s.binnen}`);
    regels.push('            </p>');
  }
  regels.push('          </div>');
  return regels;
}

export function lijstHtml(items, labels) {
  const blokken = items.map((item, k) => {
    const laatste = k === items.length - 1;
    const kop = laatste ? '      <div>' : '      <div class="border-b border-line">';
    return [
      kop,
      '        <h3 class="m-0">',
      `          <button type="button" @click="open = open === ${k} ? null : ${k}" :aria-expanded="open === ${k} ? 'true' : 'false'"`,
      `                  aria-controls="faq-${k}" data-cta="${labels[k]}"`,
      '                  class="w-full flex items-start justify-between gap-6 py-5 text-left text-h3 font-bold text-ink hover:text-brand-ink min-h-[48px]"',
      '                  style="transition: color var(--m-base) var(--e-standard)">',
      `            <span>${ontsnap(item.vraag)}</span>`,
      `            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="shrink-0 mt-1 h-5 w-5" style="transition: transform var(--m-base) var(--e-standard)" :class="open === ${k} && 'rotate-45'" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>`,
      '          </button>',
      '        </h3>',
      `        <div id="faq-${k}" x-show="open === ${k}" x-collapse>`,
      ...paneelHtml(item),
      '        </div>',
      '      </div>',
    ].join('\n');
  });
  return '\n\n' + blokken.join('\n\n') + '\n\n';
}
