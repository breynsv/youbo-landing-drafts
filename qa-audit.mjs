// Automated design-QA pass over the draft landing pages.
//
//   node qa-audit.mjs                 # all drafts, headless, writes qa/*.json + qa/*.png
//   node qa-audit.mjs 03 07           # only drafts whose filename contains 03 or 07
//   HEADED=1 node qa-audit.mjs 03     # watch it in a real Chromium window
//
// It reports the objective failures a human eye misses on a 90k-line page:
//   - images that did not load (404 / wrong path)
//   - logos rendered in a colour that vanishes into their background
//   - text that fails WCAG AA against its actual computed background
//   - horizontal overflow and elements wider than the viewport
//   - controls with no accessible name, images with no alt
//
// It does NOT judge layout, rhythm, hierarchy or taste. That is the eyeball pass.

import { chromium } from 'playwright';
import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'qa');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const filters = process.argv.slice(2);
const drafts = readdirSync(here)
  .filter((f) => /^draft-.*\.html$/.test(f))
  .filter((f) => filters.length === 0 || filters.some((k) => f.includes(k)))
  .sort();

if (drafts.length === 0) {
  console.error('No drafts matched.');
  process.exit(1);
}

// SVG logo files whose artwork is white and therefore only legible on a dark ground.
const WHITE_ARTWORK = [
  'youbo_logo_white.svg',
  'dpg-logo-white.svg',
  'sdworx-logo.svg',
  'kaneka-logo.svg',
  'aertssen-logo.svg',
  'dpg-logo.svg',
];
// SVG logo files whose artwork is dark ink and therefore only legible on a light ground.
const DARK_ARTWORK = [
  'youbo_logo.svg',
  'sdworx-logo-dark.svg',
  'kaneka-logo-dark.svg',
  'aertssen-logo-dark.svg',
  'dpg-logo-dark.svg',
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const audit = ({ whiteArtwork, darkArtwork }) => {
  // ---------- colour helpers ----------
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const over = (fg, bg) => ({
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
    a: 1,
  });

  // Walk ancestors for the first opaque background; composite any translucent
  // layers found on the way. Reports whether an unresolvable image/gradient sat
  // in the stack, because that makes the number a guess rather than a fact.
  const backdrop = (el) => {
    let node = el;
    let acc = null;
    let sawImage = false;
    while (node && node !== document.documentElement.parentNode) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') sawImage = true;
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) {
        acc = acc ? over(acc, bg) : bg;
        if (acc.a >= 0.999 || bg.a >= 0.999) {
          return { colour: { ...acc, a: 1 }, sawImage };
        }
      }
      node = node.parentElement;
    }
    return { colour: acc ? { ...acc, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }, sawImage };
  };

  const where = (el) => {
    const path = [];
    let n = el;
    for (let i = 0; n && i < 4; i++, n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += `#${n.id}`;
      else if (n.className && typeof n.className === 'string') {
        const c = n.className.trim().split(/\s+/).slice(0, 3).join('.');
        if (c) s += `.${c}`;
      }
      path.unshift(s);
    }
    const r = el.getBoundingClientRect();
    return { sel: path.join(' > '), y: Math.round(r.top + window.scrollY), x: Math.round(r.left) };
  };

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  const findings = {
    brokenImages: [], logoContrast: [], textContrast: [], overflow: [], a11y: [], lazyInHidden: [],
  };

  // ---------- 1. images that did not load ----------
  // Every image has already been forced eager and awaited by the harness, so a
  // naturalWidth of 0 here is a genuinely bad path, not a lazy-loading artefact.
  for (const img of document.querySelectorAll('img')) {
    if (img.complete && img.naturalWidth > 0) continue;
    findings.brokenImages.push({
      src: img.getAttribute('src'),
      hidden: !visible(img),
      ...where(img),
    });
  }

  // ---------- 2. logo artwork vs its background ----------
  for (const img of document.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    const file = src.split('/').pop();
    if (!visible(img)) continue;
    const { colour, sawImage } = backdrop(img);
    const L = lum(colour);
    const bgHex =
      '#' + [colour.r, colour.g, colour.b].map((v) => v.toString(16).padStart(2, '0')).join('');
    if (whiteArtwork.includes(file) && L > 0.35) {
      findings.logoContrast.push({
        file, issue: 'white artwork on a light background — invisible or half-invisible',
        bg: bgHex, bgLuminance: +L.toFixed(3), unresolvedBgImage: sawImage, ...where(img),
      });
    }
    if (darkArtwork.includes(file) && L < 0.18) {
      findings.logoContrast.push({
        file, issue: 'dark artwork on a dark background — invisible',
        bg: bgHex, bgLuminance: +L.toFixed(3), unresolvedBgImage: sawImage, ...where(img),
      });
    }
  }

  // ---------- 3. text contrast ----------
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue.trim();
    if (text.length < 2) continue;
    const el = node.parentElement;
    if (!el || !visible(el)) continue;
    if (el.closest('script,style,noscript,template')) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const { colour: bg, sawImage } = backdrop(el);
    const eff = fg.a < 1 ? over(fg, bg) : fg;
    const cr = ratio(eff, bg);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const floor = large ? 3 : 4.5;
    if (cr < floor) {
      const w = where(el);
      const key = `${w.sel}|${cs.color}|${text.slice(0, 24)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.textContrast.push({
        text: text.slice(0, 70), colour: cs.color, bg:
          '#' + [bg.r, bg.g, bg.b].map((v) => v.toString(16).padStart(2, '0')).join(''),
        ratio: +cr.toFixed(2), required: floor, fontSize: size, fontWeight: weight,
        unresolvedBgImage: sawImage, ...w,
      });
    }
  }

  // ---------- 4. horizontal overflow ----------
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) {
    findings.overflow.push({ page: true, scrollWidth: document.documentElement.scrollWidth, viewport: vw });
    for (const el of document.body.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed') continue;
        findings.overflow.push({ ...where(el), right: Math.round(r.right), width: Math.round(r.width) });
        if (findings.overflow.length > 12) break;
      }
    }
  }

  // ---------- 5. accessible names & alt text ----------
  for (const el of document.querySelectorAll('a,button,[role="tab"],[role="button"]')) {
    if (!visible(el)) continue;
    const name = (el.innerText || '').trim() || el.getAttribute('aria-label') ||
      el.getAttribute('title') || (el.querySelector('img') || {}).alt || '';
    if (!name.trim()) findings.a11y.push({ issue: 'control with no accessible name', ...where(el) });
  }
  for (const img of document.querySelectorAll('img')) {
    if (!visible(img)) continue;
    if (img.getAttribute('alt') === null) {
      findings.a11y.push({ issue: 'img with no alt attribute', src: img.getAttribute('src'), ...where(img) });
    }
  }

  return findings;
};

const browser = await chromium.launch({ headless: !process.env.HEADED });
const summary = [];

for (const file of drafts) {
  const url = pathToFileURL(join(here, file)).href;
  const perDraft = { draft: file, viewports: {} };

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
    page.on('requestfailed', (r) => failedRequests.push(r.url().split('/').pop()));

    await page.goto(url, { waitUntil: 'load' });
    // Wait for the webfonts to actually arrive before measuring or shooting —
    // a fallback serif changes text metrics, which changes wrapping, which
    // changes what counts as overflow.
    await page.evaluate(() => document.fonts.ready);
    // Let Tailwind CDN generate its stylesheet and the fonts settle.
    await page.waitForTimeout(1500);

    // Scroll the whole page so scroll-reveal animations fire and their end
    // state is what gets measured and photographed.
    await page.evaluate(async () => {
      await new Promise((res) => {
        let y = 0;
        const step = () => {
          window.scrollTo(0, y);
          y += window.innerHeight;
          if (y < document.body.scrollHeight) setTimeout(step, 60);
          else { window.scrollTo(0, 0); setTimeout(res, 250); }
        };
        step();
      });
    });

    // Force every lazy image to load before measuring. Without this, images
    // below the fold and inside collapsed tab panels report naturalWidth 0 —
    // which looks exactly like a 404 but is not one — and full-page
    // screenshots come out with blank rectangles where the artwork should be.
    await page.evaluate(async () => {
      const imgs = [...document.querySelectorAll('img')];
      for (const img of imgs) {
        img.loading = 'eager';
        if (img.getAttribute('src')) img.src = img.getAttribute('src');
      }
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((res) => {
                img.addEventListener('load', res, { once: true });
                img.addEventListener('error', res, { once: true });
                setTimeout(res, 4000);
              })
        )
      );
    });
    await page.waitForTimeout(600);

    const findings = await page.evaluate(audit, { whiteArtwork: WHITE_ARTWORK, darkArtwork: DARK_ARTWORK });
    findings.consoleErrors = [...new Set(consoleErrors)].slice(0, 8);
    findings.failedRequests = [...new Set(failedRequests)].slice(0, 12);

    const base = file.replace(/\.html$/, '');
    await page.screenshot({ path: join(outDir, `${base}.${vp.name}.png`), fullPage: true });

    perDraft.viewports[vp.name] = findings;
    const counts = Object.fromEntries(
      Object.entries(findings).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]).filter(([, n]) => n > 0)
    );
    console.log(`${base} @ ${vp.name}:`, Object.keys(counts).length ? JSON.stringify(counts) : 'clean');

    await ctx.close();
  }

  writeFileSync(join(outDir, `${file.replace(/\.html$/, '')}.json`), JSON.stringify(perDraft, null, 2));
  summary.push(perDraft);
}

await browser.close();

// Compact roll-up so a reviewer can see the shape of the damage at a glance.
const roll = summary.map((d) => ({
  draft: d.draft,
  ...Object.fromEntries(
    ['brokenImages', 'logoContrast', 'textContrast', 'overflow', 'a11y', 'lazyInHidden'].map((k) => [
      k,
      (d.viewports.desktop[k] || []).length + (d.viewports.mobile[k] || []).length,
    ])
  ),
}));
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(roll, null, 2));
console.table(roll);
