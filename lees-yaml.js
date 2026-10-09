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
 *       items:
 *         - sleutel: waarde
 *           ander: waarde
 *         - sleutel: waarde
 *           ander: waarde
 *     blok: |-
 *       regel een
 *       regel twee
 *
 * Die `items`-vorm — een lijst van groepjes — is er sinds 2026-10-10, toen de
 * cases, de quotes, de stappen van de rondleiding en de logo's echte lijsten
 * werden. Een lijst van regels tekst (`cijfers`) en een lijst van groepjes
 * (`items`) staan naast elkaar in hetzelfde bestand, dus moet de lezer ze aan
 * de eerste regel kunnen onderscheiden: staat er achter het streepje
 * "sleutel: ", dan is het een groepje. Door elkaar heen mag niet — dat is in
 * YAML geldig en hier bijna altijd een typefout.
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
      let soort = null;   // 'tekst' of 'groep' — binnen één lijst maar één van de twee
      while (true) {
        vooruit();
        if (i >= regels.length) break;
        if (inspringing(regels[i]) !== diepte) break;
        const m = /^\s*-\s+(\S.*)$/.exec(regels[i]);
        if (!m) fout(i + 1, `verwacht "- waarde", kreeg "${regels[i].trim()}" — ` +
                            'een lijst bevat hier regels tekst of groepjes, geen leeg streepje');
        const ditIsGroep = SLEUTEL.test(m[1]) && !BLOKVORM.test(m[1]);
        const nu = ditIsGroep ? 'groep' : 'tekst';
        if (soort && soort !== nu) {
          fout(i + 1, soort === 'tekst'
            ? 'deze lijst begon met regels tekst en gaat nu verder met een groepje. ' +
              'Eén lijst is óf een opsomming regels, óf een rij items met velden.'
            : 'deze lijst begon met een item met velden en gaat nu verder met één regel ' +
              'tekst. Elk item hier hoort dezelfde velden te hebben.');
        }
        soort = nu;
        if (!ditIsGroep) {
          uit.push(schaal(m[1], i + 1));
          i++;
          continue;
        }
        // Een groepje. De eerste sleutel staat op de streepjesregel zelf; door
        // het streepje door twee spaties te vervangen wordt het een gewone
        // groep op diepte+2 en leest dezelfde lezer hem. Dat is geen truc om
        // code te sparen: een tweede mappinglezer zou "sleutel: waarde" op twee
        // plaatsen anders kunnen gaan lezen, en dat is precies het soort
        // verschil dat deze lezer moet uitsluiten.
        const streepje = regels[i].indexOf('-', diepte);
        regels[i] = ' '.repeat(diepte) + '  ' + regels[i].slice(streepje + 1).trimStart();
        uit.push(lees(diepte + 2));
      }
      if (!uit.length) fout(i + 1, 'een lijst zonder items');
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

/** Een lijst van groepjes — "items" — tegenover een opsomming regels tekst. */
const isGroepenlijst = (w) => Array.isArray(w) && w.length > 0 && typeof w[0] === 'object'
                              && !Array.isArray(w[0]);

/**
 * Van een geneste groep naar platte sleutels met punten ertussen —
 * "cases.items.1.voordeel". Dat is de vorm waarin de pagina ernaar verwijst
 * (data-inhoud="cases.items.1.voordeel"), zodat één sleutel in de HTML precies
 * één veld in het bestand aanwijst.
 *
 * Twee soorten lijst, en ze gaan hier uit elkaar:
 *
 * · Een opsomming REGELS TEKST (`cijfers`) blijft één veld met een lijst erin.
 *   Dat is één invulvak in het beheerscherm en één <ul> op de pagina.
 * · Een lijst GROEPJES (`items`) wordt genummerd uitgeklapt, vanaf 1 en niet
 *   vanaf 0 — de sleutel staat in de HTML en in een foutmelding die Jana onder
 *   ogen kan krijgen, en "item 0" is voor niemand buiten de programmeur het
 *   eerste item.
 */
export function vlak(groep, voorvoegsel = '', uit = new Map()) {
  for (const [sleutel, waarde] of Object.entries(groep)) {
    const pad = voorvoegsel ? `${voorvoegsel}.${sleutel}` : sleutel;
    if (isGroepenlijst(waarde)) {
      waarde.forEach((item, k) => vlak(item, `${pad}.${k + 1}`, uit));
    } else if (Array.isArray(waarde) || typeof waarde === 'string') {
      uit.set(pad, waarde);
    } else {
      vlak(waarde, pad, uit);
    }
  }
  return uit;
}

/**
 * Hoe lang elke lijst van groepjes is: Map("cases.items" → 5).
 *
 * De bouw heeft dat apart nodig, want vlak() kent alleen nog de uitgeklapte
 * velden en kan het verschil tussen "nul items" en "deze lijst bestaat niet"
 * niet meer zien. En juist nul items is het geval dat moet tegenhouden.
 */
export function vlakLijsten(groep, voorvoegsel = '', uit = new Map()) {
  for (const [sleutel, waarde] of Object.entries(groep)) {
    const pad = voorvoegsel ? `${voorvoegsel}.${sleutel}` : sleutel;
    if (isGroepenlijst(waarde)) {
      uit.set(pad, waarde.length);
      waarde.forEach((item, k) => vlakLijsten(item, `${pad}.${k + 1}`, uit));
    } else if (!Array.isArray(waarde) && typeof waarde !== 'string') {
      vlakLijsten(waarde, pad, uit);
    }
  }
  return uit;
}
