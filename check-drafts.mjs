// Validate every draft against the hard constraints in DRAFT-INSTRUCTIONS.md.
//
//   node check-drafts.mjs          # all drafts
//   node check-drafts.mjs 07       # just the ones whose filename contains 07
//
// Exit code 1 if any draft has an ERROR. Warnings never fail the run — they are
// judgement calls a designer is allowed to make, and the concept note is where
// they defend them.
//
// This is deliberately a static check: it reads the file, it does not render it.
// Rendering is what shoot-thumbs.mjs does, and looking at the result is what the
// review tool is for. This catches the class of mistake that is invisible in a
// screenshot — a broken image path, a missing tracking hook, an invented asset, a
// mini-title acting as a second heading, an internal link to a page that 404s, and a
// screenshot FACTS.md rules out because the amounts in it do not add up.
//
// It is also deliberately offline. The list of youbo.io URLs that exist is derived from
// the pages saved in _raw/, not fetched, so this check gives the same answer on a train
// as it does in the office.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2);

const drafts = readdirSync(here)
  .filter(f => f.startsWith('draft-') && f.endsWith('.html'))
  .filter(f => !filters.length || filters.some(x => f.includes(x)))
  .sort();

// Assets the manifest explicitly forbids. Referencing one is an error, not a
// matter of taste: performance_cycle.png is the single clearest reason the old
// site reads as programmer-made, and the ring icons are 424 KB of nothing.
const BANNED = [
  'performance_cycle.png',
  'merit-confidential.webp',
  'merit-esg.webp',
  'merit-maatwerk.webp',
  'merit-upgrade.webp',
  'lazy-img.webp',
  'spark.png',
  'angle-up-solid.svg',
];

// The four customer logos ship as white knockouts. On a light surface they are
// invisible, which no screenshot review reliably catches because a missing logo
// looks like a design choice.
const KNOCKOUT = ['sdworx-logo.svg', 'kaneka-logo.svg', 'aertssen-logo.svg', 'dpg-logo.svg'];

// Round 1 (draft-01 … draft-10) and the first three of round 2 are archived: Jana has
// judged them and nobody edits them any more. The rules added after they were written
// still get reported on them — a finding is a finding — but as a warning, because a gate
// that is permanently red teaches everyone to ignore red, and then it protects nothing.
// Archived by name, so a draft added tomorrow is held to the rules by default.
const ARCHIVED = /^draft-(0\d|10)-|^draft-r2-0[123]-/;

// Five real screenshots of youbo.io that FACTS.md rules out: the amounts in them do
// not add up (the same employee is € 3.142,81 in the table and € 3.242,81 on the card
// beside it) and cards overlap so figures are cut in half. On marketing for
// compensation software a sum that does not add up is the most expensive detail there
// is, so these are an error wherever they are referenced — <img src>, a
// <link rel="preload">, a CSS url() background or a path built in JavaScript.
const BANNED_VISUALS = [
  'main-visual-nl.webp',
  'main-visual-en.webp',
  'merit-communication-nl.webp',
  'merit-budget-nl.webp',
  'merit-compare-nl.webp',
];

// Every youbo.io URL we can prove exists, derived from the pages saved in _raw/ — the
// canonical/og:url of each saved page (that page demonstrably exists) plus every
// internal link the real site itself makes (its own nav and footer). Deriving it keeps
// this check offline: no draft check should need the network to be right.
const normalisePath = p => (p === '' ? '/' : p.replace(/\/{2,}/g, '/'));

function knownYouboUrls(dir) {
  const known = new Set();
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.html')) files.push(full);
    }
  })(dir);
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    const self = [
      ...[...raw.matchAll(/property=["']og:url["'][^>]*content=["']([^"']+)["']/gi)].map(m => m[1]),
      ...[...raw.matchAll(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/gi)].map(m => m[1]),
    ];
    // A root-relative href only proves something about youbo.io when the file it sits
    // in IS a youbo.io page. _raw/ also holds workleap.html, a competitor's page saved
    // for reference, and harvesting its nav would quietly bless /pricing, /demo and
    // /integrations as real youbo.io URLs — 31 of them, measured. So: absolute youbo.io
    // links from any file, root-relative ones only from a file that identifies itself as
    // youbo's, either by its own canonical or — for components/nav.html and
    // components/footer.html, which are fragments with no canonical at all — by carrying
    // the Youbo name. workleap.html does not mention Youbo once.
    const isYouboPage = self.some(u => /youbo\.io/i.test(u)) ||
      (self.length === 0 && /youbo/i.test(raw));
    const links = [...raw.matchAll(/\bhref=["']([^"']+)["']/gi)].map(m => m[1])
      .filter(u => isYouboPage || /^https?:\/\//i.test(u));
    for (const u of [...self, ...links]) {
      const path = youboPath(u, true);
      if (path) known.add(path);
    }
  }
  return known;
}

// A youbo.io URL reduced to the part that decides whether the page exists: the path,
// without query or fragment. Returns null for anything that is not youbo.io — another
// domain is somebody else's problem, and a bare fragment or mailto: is not a page.
// `rooted` says whether a root-relative href may be read as a youbo.io path. True when
// harvesting _raw/, where the document's own base IS youbo.io. False for a draft, which
// is a standalone file served from anywhere — and because this check is deliberately
// about youbo.io links only. Every other host, Google's tag domains included, is out of
// its scope and handled by the sanctioned-host check further down.
function youboPath(url, rooted = false) {
  const abs = url.match(/^https?:\/\/(?:www\.)?youbo\.io(\/[^?#]*|)(?:[?#]|$)/i);
  if (abs) return normalisePath(abs[1]);
  if (/^(?:[a-z]+:|\/\/)/i.test(url)) return null;   // other scheme or protocol-relative host
  if (rooted && url.startsWith('/')) return normalisePath(url.split(/[?#]/)[0]);
  return null;
}

const KNOWN_URLS = knownYouboUrls(join(here, '_raw'));

// Three URLs _raw/ cannot know about, each for a written reason. This list stays
// explicit and per-URL on purpose: the rule it holds open is that every youbo.io path
// must be proven, by _raw/ or by a line here. Blessing youbo.io as a host instead would
// re-admit the invented /nl/legal/… URLs this check exists to catch.
//   /demo        — this landing page itself; FACTS.md puts it there and it is not live yet.
//   /nl/demo     — the same page under the NL prefix, if we end up mounting it there.
//   /nl/         — the NL homepage, which their own footer component links the wordmark
//                  to. No page saved in _raw/ declares it, so it cannot be derived.
//                  Verified live 2026-10-08: HTTP 200, no redirect. /nl/merit/ answers
//                  200 too but redirects here, so /nl/ is the canonical homepage.
for (const extra of ['/demo', '/nl/demo', '/nl/']) KNOWN_URLS.add(extra);

// Classes that render their text in capitals, read out of the draft's own stylesheet:
// either `text-transform:uppercase` or Tailwind's `uppercase` utility inside @apply.
// Derived rather than listed, because every draft names its eyebrow class differently
// (.eyebrow, .eyebrow-rule, .eyebrow-inv, .marker, .marker-light, .caps).
function uppercasingClasses(html) {
  const set = new Set(['uppercase']);
  for (const style of html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []) {
    for (const rule of [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]) {
      const [, selector, body] = rule;
      if (!/text-transform\s*:\s*uppercase/i.test(body) && !/@apply[^;}]*\buppercase\b/i.test(body))
        continue;
      for (const cls of selector.match(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g) || []) set.add(cls.slice(1));
    }
  }
  return set;
}

// Elements that can hold a mini-title. Deliberately excludes th/td (a table head is a
// caps label and always will be), button/a/summary (a control's own label), li and
// option (list and menu text), and label (a form label sits above an input, not above
// a heading).
const LABEL_TAGS = 'p|span|div|small|strong|em|b';

// A mini-title is a short capitalised label sitting immediately above an h1/h2/h3 and
// saying the same thing as it — the "dubbele titels" Jana rejected.
//
// How the false alarms are kept out, since a capitals label on its own is perfectly
// fine (a table head, a button, a stat caption, the logo bar's intro line):
//
//   1. THE HEADING IS THE WHOLE TEST. A label only counts when an h1/h2/h3 actually
//      follows it, with nothing but markup, whitespace and other label-sized scraps
//      (a step number like "01 — 03") in between. A <th>OMZET</th> or a
//      <button>BOEK EEN DEMO</button> has no heading after it, so neither is ever seen.
//      Any body text longer than 40 characters in the gap means the label belongs to
//      that text, not to the heading, and it is dropped.
//   2. The search window stops at the previous </section>, </header> or closing
//      heading, so a caps caption at the foot of one section cannot be pinned on the
//      first heading of the next.
//   3. Only text-level containers are considered (LABEL_TAGS), so a control's or a
//      table's own label is structurally out of scope.
//   4. "Capitalised" means either literal capitals in the source or a class the
//      draft's own CSS uppercases — because every draft here writes "Het platform" in
//      sentence case and lets .marker/.eyebrow do the shouting.
//   5. A visually hidden heading (sr-only) is not a second visible title, so the label
//      above it is the only one on screen and is left alone.
//   6. TODO blocks are exempt: "TODO — te bevestigen" is an instruction to ourselves
//      that the brief asks to keep visible, not a title.
//
// The residual risk is the other way round — a genuine mini-title written in sentence
// case with no uppercasing class will not be seen. That is the safe direction to miss
// in: this check is an error, so it must not cry wolf.
function miniTitlesAbove(html) {
  const caps = uppercasingClasses(html);
  const clean = blankComments(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, m => ' '.repeat(m.length));

  const found = new Map();                       // label text -> line number of the heading
  for (const h of clean.matchAll(/<(h[123])\b([^>]*)>([\s\S]{0,400}?)<\/\1>/gi)) {
    if (/\bsr-only\b|\bvisually-hidden\b/i.test(h[2])) continue;             // guard 5
    const start = h.index;
    let from = Math.max(0, start - 800);
    let boundary = -1;                                                       // guard 2
    for (const b of clean.slice(from, start).matchAll(/<\/section\s*>|<\/header\s*>|<\/h[1-6]\s*>/gi))
      boundary = b.index + b[0].length;
    if (boundary >= 0) from += boundary;
    const window = clean.slice(from, start);

    // Every opening label tag in the window, innermost included: matching whole
    // elements instead would let an outer <div> swallow the <p class="marker"> inside
    // it, and the marker is the thing we are looking for.
    for (const open of window.matchAll(new RegExp(`<(${LABEL_TAGS})\\b([^>]*)>`, 'gi'))) {
      const [tag, attrs] = [open[1], open[2]];
      const rest = window.slice(open.index + open[0].length);
      const close = rest.search(new RegExp(`</${tag}\\s*>`, 'i'));
      if (close < 0 || close > 200) continue;                 // too much text to be a label
      const text = stripTags(rest.slice(0, close));
      if (!isLabelText(text)) continue;
      const classes = (attrs.match(/\bclass=["']([^"']*)["']/i) || [, ''])[1].split(/\s+/);
      const shouts = text === text.toLocaleUpperCase('nl-BE') || classes.some(c => caps.has(c));
      if (!shouts) continue;                                                 // guard 4
      const gap = stripTags(rest.slice(close));                              // guard 1
      if (gap.length > 40 || gap.split(/ {2,}|·|—/).some(c => c.trim().length > 40)) continue;
      if (!found.has(text)) found.set(text, lineOf(html, start));
    }
  }
  return [...found].map(([text, line]) => `"${text}" (regel ${line})`);
}

// The label as a reader sees it: tags gone, the handful of entities these drafts use
// decoded rather than blanked, so "Bonus &amp; Merit" is reported as "Bonus & Merit"
// and not as the puzzling "Bonus Merit".
const ENTITIES = { amp: '&', nbsp: ' ', middot: '\u00b7', mdash: '\u2014', ndash: '\u2013',
                   rsquo: '\u2019', lsquo: '\u2018', eacute: '\u00e9', egrave: '\u00e8',
                   quot: '"', apos: "'", hellip: '\u2026', times: '\u00d7', deg: '\u00b0',
                   euro: '\u20ac', lt: '<', gt: '>' };
const stripTags = s => s.replace(/<[^>]*>/g, ' ')
  .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? ' ')
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
  .replace(/\s+/g, ' ').trim();

// Label-shaped: a handful of words, some letters in them, not one of our own visible
// TODO markers, and not a bare roman numeral — draft 08 numbers its sections III, VII,
// XII, which sit beside the label rather than being one.
const isLabelText = t =>
  t.length >= 2 && t.length <= 40 &&
  (t.match(/[A-Za-zÀ-ÿ]/g) || []).length >= 3 &&
  t.split(/\s+/).length <= 5 &&
  !/^TODO\b/i.test(t) &&
  !/^[IVXLC]+$/.test(t);

const lineOf = (html, index) => html.slice(0, index).split('\n').length;

// Comments blanked, not removed, so every index still points at the same character of
// the original file and line numbers stay honest.
const blankComments = h => h.replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));

// Where a forbidden image is referenced, and how — because "do not use this webp" is
// only checkable if it covers every way a file gets loaded: <img>/<source>, a
// <link rel="preload"> in the head, a CSS url() background, and a path assembled in
// JavaScript for a tab or a carousel. A mention inside an HTML comment is a note to
// ourselves, not a reference, so comments are blanked first.
function imageReferences(html, name) {
  const hay = blankComments(html);
  const blocks = [...hay.matchAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi)]
    .map(m => ({ from: m.index, to: m.index + m[0].length, kind: m[1].toLowerCase() }));
  const re = new RegExp(`assets/img/${name.replace(/\./g, '\\.')}`, 'g');
  const hits = [];
  let m;
  while ((m = re.exec(hay))) {
    // Inside a tag when the nearest "<" is more recent than the nearest ">" — which is
    // how a path in a multi-line x-data attribute is told apart from one in a script.
    const lt = hay.lastIndexOf('<', m.index);
    const inTag = lt > hay.lastIndexOf('>', m.index);
    const tag = inTag ? (hay.slice(lt, lt + 40).match(/^<([a-zA-Z][\w-]*)/) || [, ''])[1].toLowerCase() : '';
    const openTag = inTag ? hay.slice(lt, m.index) : '';
    const block = blocks.find(b => m.index > b.from && m.index < b.to);
    let how;
    if (/url\(\s*["']?$/.test(hay.slice(Math.max(0, m.index - 40), m.index))) how = 'CSS url()';
    else if (tag === 'img' || tag === 'source') how = `<${tag}>`;
    else if (tag === 'link') how = /\brel=["']preload["']/i.test(openTag) ? '<link rel=preload>' : '<link>';
    else if (tag) how = `attribuut van <${tag}>`;
    else if (block) how = block.kind === 'style' ? '<style>' : 'JavaScript';
    else how = 'losse verwijzing';
    hits.push(`regel ${lineOf(html, m.index)} \u00b7 ${how}`);
  }
  return hits;
}

// Claims the strategist established are false or unverifiable. One of these on a
// page aimed at Belgian HR professionals costs more credibility than the urgency
// it buys. See the urgency section of BRIEF.md.
// Each entry may carry a `negated` pattern: if that matches in the 80 characters
// before the hit, the claim is being *denied*, which is exactly what the brief
// asks for. "Er loopt geen inbreukprocedure" is correct copy, not a violation.
const FORBIDDEN_CLAIMS = [
  { re: /inbreukprocedure|infringement/ig,
    why: 'claims infringement proceedings against Belgium (none exist)',
    negated: /\b(geen|niet|nog geen|no|not)\b/i },
  { re: /\b36\s*%/g,
    why: 'the unverifiable "36% of Belgian employers are ready" figure' },
  { re: /\bvier jaar\b.{0,40}\bhistor/ig,
    why: 'the unverified "four years of historical gap data" claim' },
  { re: /\b(2[,.]86|3[,.]41)\s*%/g,
    why: 'a specific 1 Jan 2027 indexation percentage (sources disagree)' },
];

let failed = 0;
const rows = [];

for (const file of drafts) {
  const html = readFileSync(join(here, file), 'utf8');
  const errors = [];
  const warns = [];
  // Where the checks added after round 1 report to for this file. Everything that was
  // already here keeps failing every draft, exactly as before.
  const archived = ARCHIVED.test(file);
  const flag = msg => archived
    ? warns.push(`${msg} — gearchiveerd draft, niet meer bijgewerkt`)
    : errors.push(msg);

  // --- Language and structure -------------------------------------------------
  if (!/<html[^>]+lang=["']nl-BE["']/i.test(html)) errors.push('missing lang="nl-BE"');

  const h1s = html.match(/<h1[\s>]/gi) || [];
  if (h1s.length === 0) errors.push('no <h1>');
  else if (h1s.length > 1) errors.push(`${h1s.length} <h1> elements (must be exactly 1)`);

  if (!/<title>[^<]{10,}<\/title>/i.test(html)) errors.push('missing or stub <title>');
  if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']{40,}/i.test(html))
    errors.push('missing or thin meta description');
  if (!/property=["']og:image["']/i.test(html)) warns.push('no og:image');
  if (!/property=["']og:locale["']/i.test(html)) warns.push('no og:locale');

  // --- Tracking ---------------------------------------------------------------
  // The campaign is LinkedIn-first, so the tag placeholder is non-negotiable —
  // but an invented partner ID is worse than none, because it silently sends
  // data nowhere and looks wired up.
  const hasLinkedIn = /linkedin/i.test(html) && /(insight|_linkedin_partner_id|partner_id)/i.test(html);
  if (!hasLinkedIn) errors.push('no LinkedIn Insight Tag placeholder');
  const inventedId = html.match(/_linkedin_partner_id\s*=\s*["']?(\d{4,})/i);
  if (inventedId) errors.push(`invented LinkedIn partner ID "${inventedId[1]}" — must stay a placeholder`);

  const ctas = [...html.matchAll(/data-cta=["']([^"']+)["']/g)].map(m => m[1]);
  if (ctas.length === 0) errors.push('no data-cta hooks');
  else if (ctas.length < 3) warns.push(`only ${ctas.length} data-cta hooks`);
  const dupes = ctas.filter((c, i) => ctas.indexOf(c) !== i);
  if (dupes.length) warns.push(`duplicate data-cta values: ${[...new Set(dupes)].join(', ')}`);

  // In België is de LinkedIn Insight Tag (en Google Analytics/Ads) opt-in: hij mag pas
  // laden nadat de bezoeker ja zegt. Een plaatshouder zonder toestemmingsbalk is dus
  // een pagina die niet gepubliceerd kan worden zoals ze is. Een waarschuwing en geen
  // fout, want de balk is bewust een aparte ontwerpbeslissing van Jana ("hoe minimaler
  // hoe beter"). Een commentaarregel die belooft dat er een balk komt, en een
  // voettekstlink naar het cookiebeleid, tellen niet: er moet echt een knop staan
  // waarmee je aanvaardt of weigert.
  const visible = blankComments(html);
  const hasGooglePlaceholder = /gtag\(|googletagmanager|google[- ]?(analytics|ads|tag)|\bGA4\b/i.test(visible);
  const consentButton = [...visible.matchAll(/<button\b[^>]*>[\s\S]{0,300}?<\/button>/gi)]
    .some(b => /aanvaard|accepteer|akkoord|toestaan|weiger|afwijzen|alleen noodzakelijke|enkel noodzakelijk|consent-(accept|refuse|aanvaard|weiger|toestaan|decline)/i.test(b[0]));
  const consentRegion = /aria-label=["'][^"']*(cookie|toestemming|consent)/i.test(visible) ||
    /\b(id|class)=["'][^"']*(cookie|consent)[-_]?(bar|banner|balk|notice|melding)/i.test(visible);
  if ((hasLinkedIn || hasGooglePlaceholder) && !(consentButton && consentRegion))
    warns.push(`tracking-plaatshouder zonder toestemmingsbalk — ${hasGooglePlaceholder
      ? 'de LinkedIn Insight Tag en de Google-tag mogen' : 'de LinkedIn Insight Tag mag'}` +
      ' in België pas na opt-in laden, dus zonder balk kan deze pagina niet live');

  // --- Form -------------------------------------------------------------------
  if (!/<form/i.test(html)) errors.push('no <form>');
  if (!/type=["']email["']/i.test(html)) errors.push('no email input');
  const labels = (html.match(/<label[\s>]/gi) || []).length;
  if (labels < 3) warns.push(`only ${labels} <label> elements — check for placeholder-as-label`);

  // --- Images -----------------------------------------------------------------
  const refs = [...html.matchAll(/assets\/img\/([A-Za-z0-9._-]+)/g)].map(m => m[1]);
  const missing = [...new Set(refs)].filter(r => !existsSync(join(here, 'assets', 'img', r)));
  if (missing.length) errors.push(`image(s) do not exist: ${missing.join(', ')}`);

  const banned = [...new Set(refs)].filter(r => BANNED.includes(r));
  if (banned.length) errors.push(`forbidden asset(s): ${banned.join(', ')}`);

  // Zie FACTS.md: deze vijf schermen tonen bedragen die niet kloppen en kaarten die
  // over elkaar vallen. Elke verwijzing is een fout, ongeacht hoe hij geladen wordt.
  for (const visual of BANNED_VISUALS) {
    const where = imageReferences(html, visual);
    if (where.length) flag(`verboden beeld ${visual} — ${where.join(', ')}`);
  }

  // A knockout logo is fine on a dark ground; we cannot tell statically which
  // ground it sits on, so this is a warning that asks a human to look.
  const knockouts = [...new Set(refs)].filter(r => KNOCKOUT.includes(r));
  if (knockouts.length) warns.push(`white-knockout logo(s) used — confirm dark background: ${knockouts.join(', ')}`);

  // Alpine binds the attribute as :alt / x-bind:alt, which is a real alt at
  // runtime. Only a tag with no alt of any kind is a genuine failure.
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const hasAlt = t => /(\s|:|^)(alt|x-bind:alt)=/i.test(t) || /\s:alt=/i.test(t);
  const noAlt = imgs.filter(t => !hasAlt(t));
  if (noAlt.length) errors.push(`${noAlt.length} <img> without alt`);
  // An empty alt is correct for a decorative image and for tracking pixels; it
  // is only worth a look when the image is a real content asset.
  const emptyAlt = imgs.filter(t =>
    /\salt=["']\s*["']/i.test(t) &&
    !/role=["']presentation["']/i.test(t) &&
    !/aria-hidden=["']true["']/i.test(t) &&
    !/px\.ads\.linkedin\.com|width=["']1["']/i.test(t));
  if (emptyAlt.length) warns.push(`${emptyAlt.length} <img> with empty alt — check none are content images`);

  if (/filter:\s*invert/i.test(html)) errors.push('uses filter:invert() on a logo — wrecks brand colours');

  // A draft is a candidate for the real page. `noindex` slipped into four of
  // them during a preview-hosting pass; had one of those won, the finished
  // landing page would have been invisible to Google and nobody would have
  // noticed for months — on a project whose brief is that SEO was never done.
  // The preview is protected by robots.txt instead, which cannot follow the
  // markup into production.
  if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html))
    errors.push('has <meta robots noindex> — would ship an invisible landing page; protect previews with robots.txt');

  // --- Dubbele titels ----------------------------------------------------------
  // Jana keurde de minititel boven de kop expliciet af ("AI houdt wel van dubbele
  // titels, dat hoeft echt niet") en BRIEF-R2.md verbiedt hem. Zie miniTitlesAbove()
  // voor hoe een echte minititel van een gewoon hoofdletterlabel wordt onderscheiden.
  const minis = miniTitlesAbove(html);
  if (minis.length)
    flag(`${minis.length} minititel${minis.length === 1 ? '' : 's'} boven een kop — ` +
      `dubbele titels: ${minis.slice(0, 6).join(', ')}${minis.length > 6 ? ', …' : ''}`);

  // --- Claims -----------------------------------------------------------------
  for (const claim of FORBIDDEN_CLAIMS) {
    claim.re.lastIndex = 0;
    let m;
    while ((m = claim.re.exec(html))) {
      const before = html.slice(Math.max(0, m.index - 80), m.index);
      if (claim.negated && claim.negated.test(before)) continue; // the page denies it — correct
      errors.push(`forbidden claim — ${claim.why}`);
      break;
    }
  }

  // "Demo" is reserved for the thing Bart gives you in person; everything
  // self-serve is a "preview". Flag only the obvious button-level slips.
  if (/>\s*(Bekijk|Start|Probeer)\s+de\s+demo\s*</i.test(html))
    warns.push('a self-serve control is labelled "demo" — should be "preview"');

  // --- Deliverables -----------------------------------------------------------
  if (!/^<!DOCTYPE html>\s*<!--[\s\S]{0,200}CONCEPT:/i.test(html))
    errors.push('no CONCEPT note comment at the top of the file');
  if (!/prefers-reduced-motion/i.test(html)) warns.push('no prefers-reduced-motion handling');
  if (!/cdn\.tailwindcss\.com/.test(html)) warns.push('not using the Tailwind CDN');

  // --- Interne links -----------------------------------------------------------
  // Een draft verwees naar /cookies, /privacy en /voorwaarden; alle drie 404. De echte
  // is /nl/legal/gebruiksvoorwaarden.html. Elke youbo.io-link wordt daarom getoetst aan
  // KNOWN_URLS, afgeleid uit de opgeslagen pagina's in _raw/ — geen netwerk nodig.
  const deadLinks = new Map();
  for (const m of blankComments(html).matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    const path = youboPath(m[1]);
    if (path === null || KNOWN_URLS.has(path)) continue;
    if (!deadLinks.has(m[1])) deadLinks.set(m[1], lineOf(html, m.index));
  }
  if (deadLinks.size)
    flag(`link(s) naar een youbo.io-pagina die niet bestaat: ` +
      [...deadLinks].map(([u, line]) => `${u} (regel ${line})`).join(', '));

  // Anything *loaded* from a host we did not sanction breaks the page offline and
  // is outside the brief. An <a href> to the client's own site is not that — only
  // fetched resources count, so look at src/srcset and stylesheet hrefs alone.
  // A <link> only fetches something when it is a stylesheet, a preload or an
  // icon. rel="canonical" and rel="alternate" are metadata pointing at the real
  // production domain — correct, and something the old site lacked entirely.
  const linkTags = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0])
    .filter(t => /\brel=["'][^"']*\b(stylesheet|preload|icon|prefetch)\b/i.test(t))
    .map(t => (t.match(/\bhref=["']([^"']+)["']/i) || [])[1])
    .filter(Boolean);

  const fetched = [
    ...[...html.matchAll(/\b(?:src|srcset)=["']([^"']+)["']/gi)].map(m => m[1]),
    ...linkTags,
    ...[...html.matchAll(/url\(\s*["']?(https?:\/\/[^)"']+)/gi)].map(m => m[1]),
  ];
  // Matched on the domain, not the exact host, because the tag snippets the client
  // agreed to ship use www.googletagmanager.com and the LinkedIn ones use two
  // subdomains. Google Analytics 4 / Tag Manager is part of that agreement — "Google én
  // LinkedIn" — so refusing it here would push people into writing the address next to
  // the src attribute to get past the gate, which is worse than no gate.
  const ALLOWED = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com',
                   'licdn.com', 'px.ads.linkedin.com',
                   'googletagmanager.com', 'google-analytics.com'];
  const foreign = [...new Set(fetched
    .map(u => (u.match(/^https?:\/\/([a-z0-9.-]+)/i) || [])[1])
    .filter(Boolean).map(h => h.toLowerCase()))]
    .filter(h => !ALLOWED.some(a => h === a || h.endsWith('.' + a)));
  if (foreign.length) errors.push(`loads resources from unsanctioned host(s): ${foreign.join(', ')}`);

  const todos = (html.match(/TODO\s*—\s*nodig van klant/gi) || []).length;

  if (errors.length) failed++;
  rows.push({ file, errors, warns, todos, lines: html.split('\n').length });
}

// --- Report -------------------------------------------------------------------
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', X = '\x1b[0m';

for (const r of rows) {
  const mark = r.errors.length ? `${R}FAIL${X}` : `${G} OK ${X}`;
  console.log(`\n${mark}  ${r.file}  ${D}${r.lines} lines · ${r.todos} client TODO${r.todos === 1 ? '' : 's'}${X}`);
  for (const e of r.errors) console.log(`      ${R}✕${X} ${e}`);
  for (const w of r.warns) console.log(`      ${Y}!${X} ${D}${w}${X}`);
}

const okCount = rows.length - failed;
console.log(`\n${failed ? R : G}${okCount}/${rows.length} drafts pass${X}`);
process.exit(failed ? 1 : 0);
