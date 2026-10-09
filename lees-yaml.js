/**
 * Een opzettelijk kleine YAML-lezer, voor precies de vorm die content/pagina.yml,
 * content/klanten.yml en content/contact.yml hebben — en niet voor YAML in het
 * algemeen.
 *
 * WAAROM DIT BESTAAT EN WAAROM HET GEEN BIBLIOTHEEK IS
 *
 * Cloudflare Pages bouwt deze site met SKIP_DEPENDENCY_INSTALL=1. Er is daar
 * dus geen node_modules, en een `import ... from 'yaml'` in de bouw zou de
 * deploy laten falen op een plek waar niemand kijkt. Dezelfde afweging als in
 * build-faq.mjs, dat om die reden zijn eigen lezertje heeft.
 *
 * WAAROM DAN NIET DIE VAN build-faq.mjs HERGEBRUIKT
 *
 * Die lezer kent precies één vorm: een `items:`-lijst met twee velden. Hij
 * staat in de publicatiepijplijn, hij is bewezen met toets-faq-rondrit.mjs, en
 * hem verbouwen om ook geneste groepen te lezen zou het enige stuk van deze
 * keten dat al werkt opnieuw open leggen. Dus staat hier een tweede, bredere
 * lezer, en blijft die van de FAQ ongemoeid.
 *
 * WAT HET AANVAARDT
 *
 *     sleutel: waarde op één regel
 *     sleutel: "waarde met: een dubbele punt"
 *     groep:
 *       sleutel: waarde
 *       lijst:
 *         - eerste
 *         - tweede
 *     blok: |-
 *       regel een
 *       regel twee
 *
 * Alles wat het niet met zekerheid begrijpt, weigert het met een regelnummer.
 * Gokken is hier het enige wat echt mis kan gaan: de waarden komen uit een
 * invulveld en belanden op de pagina van de klant.
 *
 * Deze vormen zijn niet bedacht maar nagekeken: het zijn de vormen die Sveltia
 * CMS schrijft (`lineWidth: 0`, `defaultStringType: 'PLAIN'`, `indent: 2`), en
 * toets-inhoud.mjs bewijst dat een opslag door het CMS dezelfde pagina
 * oplevert — dezelfde opzet als toets-faq-rondrit.mjs.
 *
 * Het heet .js en niet .mjs en gebruikt niets uit node, zodat de browser het
 * ook kan inlezen. Het voorbeeldvenster van /beheer/ heeft dat vandaag niet
 * nodig (het krijgt velden, geen bestand), maar een lezer die alleen in node
 * draait, is een lezer die daar straks nagebouwd wordt.
 */

const isLeeg = (r) => r.trim() === '';
const isCommentaar = (r) => /^\s*#/.test(r);
const inspringing = (r) => r.length - r.trimStart().length;

// Een blokaanduiding: "|" of ">", eventueel met inspringingscijfer en/of
// afkapteken, in beide volgordes ("|2-" en "|-2" zijn allebei geldig YAML).
const BLOKVORM = /^[|>](?:[1-9][-+]?|[-+][1-9]?)?$/;
const SLEUTEL = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;

export class YamlFout extends Error {}

export function leesYaml(tekst, naam = 'bestand') {
  const regels = tekst.split('\n');
  let i = 0;

  const fout = (nr, bericht) => { throw new YamlFout(`${naam} regel ${nr}: ${bericht}`); };
  const vooruit = () => {
    while (i < regels.length && (isLeeg(regels[i]) || isCommentaar(regels[i]))) i++;
  };

  function schaal(ruw, nr) {
    const t = ruw.trim();
    if (t === '') fout(nr, 'lege waarde');
    if (t.startsWith('"')) {
      if (t.length < 2 || !t.endsWith('"')) fout(nr, 'aanhalingsteken niet gesloten');
      return t.slice(1, -1).replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', '"': '"', '\\': '\\' }[c] ?? c));
    }
    if (t.startsWith("'")) {
      if (t.length < 2 || !t.endsWith("'")) fout(nr, 'aanhalingsteken niet gesloten');
      return t.slice(1, -1).replace(/''/g, "'");
    }
    if (/\s#/.test(t)) {
      fout(nr, 'een # midden in een waarde is in YAML het begin van commentaar. ' +
               'Zet de hele waarde tussen dubbele aanhalingstekens.');
    }
    // Een lijst of een groep tussen haken. Een echte YAML-lezer maakt daar een
    // lijst van; deze lezer zou er stil de tekens zelf van maken en die op de
    // pagina zetten. Twee lezers die hetzelfde bestand anders lezen, is het
    // ergste wat hier kan gebeuren, dus weigert dit.
    if (t.startsWith('[') || t.startsWith('{')) {
      fout(nr, 'een lijst of groep tussen haken wordt hier niet gelezen. Zet een lijst ' +
               'met streepjes onder de sleutel, één regel per item.');
    }
    // Dezelfde reden: "true", "false", "null" en "~" zijn in YAML geen tekst
    // maar een waarde. Het CMS leest ze zo, deze lezer niet.
    if (/^(true|false|null|~)$/i.test(t)) {
      fout(nr, `"${t}" is in YAML geen tekst maar een waarde. Zet het tussen dubbele ` +
               'aanhalingstekens als het echt dat woord moet worden.');
    }
    return t;
  }

  // Een blokschaal. ">" is gevouwen (regels plakken aan elkaar, een witregel is
  // de grens), "|" is letterlijk (elke regelafbreking blijft staan). Hetzelfde
  // onderscheid als in build-faq.mjs, en om dezelfde reden: het CMS schrijft
  // "|-" waar iemand met de hand ">" typt.
  function blokschaal(diepte, vorm) {
    const lijnen = [];
    while (i < regels.length) {
      if (isLeeg(regels[i])) { lijnen.push(''); i++; continue; }
      if (inspringing(regels[i]) <= diepte) break;
      lijnen.push(regels[i]); i++;
    }
    while (lijnen.length && lijnen[lijnen.length - 1] === '') lijnen.pop();
    const gevuld = lijnen.filter((r) => r !== '');
    if (!gevuld.length) return '';
    const d = Math.min(...gevuld.map(inspringing));
    const kaal = lijnen.map((r) => (r === '' ? '' : r.slice(d)));
    if (vorm === '|') return kaal.join('\n');
    const stukken = [];
    let huidig = [];
    for (const r of kaal) {
      if (r === '') { if (huidig.length) { stukken.push(huidig.join(' ')); huidig = []; } }
      else huidig.push(r.trim());
    }
    if (huidig.length) stukken.push(huidig.join(' '));
    return stukken.join('\n');
  }

  function lees(diepte) {
    vooruit();
    if (i >= regels.length) return {};

    // Een lijst: streepjes op deze diepte.
    if (/^\s*-(\s|$)/.test(regels[i]) && inspringing(regels[i]) === diepte) {
      const uit = [];
      while (true) {
        vooruit();
        if (i >= regels.length) break;
        if (inspringing(regels[i]) !== diepte) break;
        const m = /^\s*-\s+(\S.*)$/.exec(regels[i]);
        if (!m) fout(i + 1, `verwacht "- waarde", kreeg "${regels[i].trim()}" — ` +
                            'een lijst in deze bestanden bevat alleen regels tekst');
        uit.push(schaal(m[1], i + 1));
        i++;
      }
      return uit;
    }

    const uit = {};
    while (true) {
      vooruit();
      if (i >= regels.length) break;
      const d = inspringing(regels[i]);
      if (d < diepte) break;
      if (d > diepte) fout(i + 1, `onverwachte inspringing bij "${regels[i].trim()}"`);
      const m = SLEUTEL.exec(regels[i].trim());
      if (!m) fout(i + 1, `verwacht "sleutel: waarde", kreeg "${regels[i].trim()}"`);
      const sleutel = m[1];
      const rest = m[2].trim();
      if (Object.prototype.hasOwnProperty.call(uit, sleutel)) {
        fout(i + 1, `"${sleutel}" staat twee keer in dezelfde groep`);
      }
      if (BLOKVORM.test(rest)) {
        i++;
        uit[sleutel] = blokschaal(d, rest[0]);
      } else if (rest === '') {
        const kopregel = i + 1;
        i++;
        vooruit();
        if (i >= regels.length || inspringing(regels[i]) <= d) {
          fout(kopregel, `"${sleutel}" heeft geen waarde. Zet de waarde erachter, ` +
                         'of de groep eronder met twee spaties inspringing.');
        }
        uit[sleutel] = lees(inspringing(regels[i]));
      } else {
        uit[sleutel] = schaal(rest, i + 1);
        i++;
      }
    }
    return uit;
  }

  vooruit();
  if (i >= regels.length) throw new YamlFout(`${naam} bevat geen enkel veld`);
  if (inspringing(regels[i]) !== 0) {
    throw new YamlFout(`${naam} regel ${i + 1}: de eerste regel hoort tegen de kantlijn te staan`);
  }
  return lees(0);
}

/**
 * Van een geneste groep naar platte sleutels met punten ertussen —
 * "cases.kaart_1.voordeel". Dat is de vorm waarin de pagina ernaar verwijst
 * (data-inhoud="cases.kaart_1.voordeel"), zodat één sleutel in de HTML precies
 * één veld in het bestand aanwijst. Een lijst blijft een lijst: die is één
 * veld, niet een groep met nummers.
 */
export function vlak(groep, voorvoegsel = '', uit = new Map()) {
  for (const [sleutel, waarde] of Object.entries(groep)) {
    const pad = voorvoegsel ? `${voorvoegsel}.${sleutel}` : sleutel;
    if (Array.isArray(waarde) || typeof waarde === 'string') uit.set(pad, waarde);
    else vlak(waarde, pad, uit);
  }
  return uit;
}
