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
// screenshot — a broken image path, a missing tracking hook, an invented asset.

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
  const ALLOWED = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com',
                   'snap.licdn.com', 'px.ads.linkedin.com'];
  const foreign = [...new Set(fetched
    .map(u => (u.match(/^https?:\/\/([a-z0-9.-]+)/i) || [])[1])
    .filter(Boolean).map(h => h.toLowerCase()))]
    .filter(h => !ALLOWED.includes(h));
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
