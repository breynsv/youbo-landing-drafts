// Telefoon-audit: is wat Jana/Sven in de review-tool ziet een echt probleem op
// een echte telefoon, of een artefact van het kader waarin de tool het ontwerp
// toont?
//
//   node qa-telefoon.mjs
//
// Drie keer dezelfde pagina, drie keer dezelfde meting:
//
//   A  direct        — echte mobiele emulatie, 390x844, dpr 3, touch, GEEN schuifbalk
//   B  tool-desktop  — review/index.html op 1440x900 met 📱 Telefoon aan (iframe 390px)
//   C  tool-telefoon — review/index.html zelf op 390x844 (wat een telefoon doet:
//                      de knoppen computer/telefoon zijn daar verborgen, het
//                      iframe vult het hele toneel)
//   D  webkit        — A nog eens in WebKit, want dat is de motor van iOS Safari
//
// Het verschil tussen A en B/C is het antwoord. Per meting:
//   - clientWidth vs innerWidth vs scrollWidth (de schuifbalk zit in dat verschil)
//   - elk element waarvan de rechterrand buiten de viewport valt, met naam en px
//   - per overlopend element: zit het in een bewuste overflow-x-scroller of niet
//   - de linkermarge van de aangeklaagde blokken tegen de goot van de rest
//   - de hoogte van de footer, in px en in % van 844
//
// Bewijs in qa/telefoon/.

import { chromium, webkit, devices } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'qa', 'telefoon');
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const PORT = process.env.PORT || 8899;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const PAGES = [
  { key: 'draft', file: 'draft-r3-01-definitief.html' },
  { key: 'index', file: 'index.html' },
];

// ---------------------------------------------------------------- the measurement
// Runs inside the document under test (the draft itself, whether that document
// is the top-level page or the review tool's iframe).
const measure = () => {
  const vw = document.documentElement.clientWidth;
  const inner = window.innerWidth;

  const sel = (el) => {
    const path = [];
    let n = el;
    for (let i = 0; n && n.tagName && i < 4; i++, n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += `#${n.id}`;
      else if (typeof n.className === 'string' && n.className.trim()) {
        s += '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.');
      }
      path.unshift(s);
    }
    return path.join(' > ');
  };

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  // The nearest ancestor that can actually scroll sideways, and whether it is
  // currently overflowing. This is the whole difference between "the page is
  // broken" and "this is a carousel".
  const scroller = (el) => {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) {
        return {
          sel: sel(n),
          overflowX: cs.overflowX,
          scrollWidth: Math.round(n.scrollWidth),
          clientWidth: Math.round(n.clientWidth),
          hiddenScrollbar: n.classList.contains('scrollhide'),
        };
      }
      n = n.parentElement;
    }
    return null;
  };

  // ---- page-level horizontal overflow -------------------------------------
  const pageOverflow = {
    clientWidth: vw,
    innerWidth: inner,
    scrollbarPx: inner - vw,
    docScrollWidth: Math.round(document.documentElement.scrollWidth),
    bodyScrollWidth: Math.round(document.body.scrollWidth),
    overflows: document.documentElement.scrollWidth > vw + 1,
  };

  const offenders = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      offenders.push({
        sel: sel(el),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        overshootPx: Math.round(r.right - vw),
        y: Math.round(r.top + window.scrollY),
        insideScroller: scroller(el),
      });
      if (offenders.length >= 25) break;
    }
  }
  pageOverflow.offenders = offenders;

  // ---- helpers to find the flagged blocks ---------------------------------
  const byText = (what, needle) =>
    [...document.querySelectorAll(what)].find((e) => (e.textContent || '').includes(needle));

  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      sel: sel(el),
      left: +r.left.toFixed(1),
      right: +r.right.toFixed(1),
      width: +r.width.toFixed(1),
      height: +r.height.toFixed(1),
      docY: Math.round(r.top + window.scrollY),
      paddingLeft: cs.paddingLeft,
      paddingRight: cs.paddingRight,
      overflowX: cs.overflowX,
      scrollWidth: Math.round(el.scrollWidth),
      clientWidth: Math.round(el.clientWidth),
      scrollable: el.scrollWidth > el.clientWidth + 1,
      hiddenScrollbar: el.classList.contains('scrollhide'),
    };
  };

  const result = { pageOverflow, items: {} };

  // ---- the page's own gutter, for comparison ------------------------------
  // Every band wraps its content in .shell. Its padding IS the gutter.
  const shells = [...document.querySelectorAll('.shell')].filter(visible);
  if (shells.length) {
    const gutters = shells.map((s) => {
      const cs = getComputedStyle(s);
      const r = s.getBoundingClientRect();
      return {
        sel: sel(s),
        left: +r.left.toFixed(1),
        paddingLeft: parseFloat(cs.paddingLeft),
        contentLeft: +(r.left + parseFloat(cs.paddingLeft)).toFixed(1),
      };
    });
    const uniq = [...new Set(gutters.map((g) => g.contentLeft))].sort((a, b) => a - b);
    result.gutter = { shellCount: shells.length, contentLeftValues: uniq, sample: gutters.slice(0, 3) };
  }

  // ---- item 1a: the Loonvoorstellen table --------------------------------
  const loonBar = byText('.panel-bar, .miniheader', 'Loonvoorstellen');
  const panel = loonBar ? loonBar.closest('.panel') : null;
  if (panel) {
    const scrollBox = panel.querySelector('.overflow-x-auto, [class*="overflow-x"]');
    const table = panel.querySelector('table');
    const voorstelTh = [...panel.querySelectorAll('th')].find((t) =>
      /voorstel/i.test(t.textContent || '')
    );
    const firstVal = [...panel.querySelectorAll('td')].find((t) => /\+\s*\d/.test(t.textContent || ''));
    result.items.loonvoorstellen = {
      panel: box(panel),
      scrollBox: box(scrollBox),
      table: box(table),
      overshootPx: scrollBox ? Math.round(scrollBox.scrollWidth - scrollBox.clientWidth) : null,
      voorstelHeader: voorstelTh
        ? { ...box(voorstelTh), visibleRightEdgeVsBox: null, text: voorstelTh.textContent.trim() }
        : null,
      firstValue: firstVal ? { ...box(firstVal), text: firstVal.textContent.trim() } : null,
    };
    // How much of the last column actually falls inside the visible box.
    if (scrollBox && voorstelTh) {
      const sb = scrollBox.getBoundingClientRect();
      const th = voorstelTh.getBoundingClientRect();
      result.items.loonvoorstellen.voorstelHeader.clippedPx = Math.max(0, Math.round(th.right - sb.right));
    }
    if (scrollBox && firstVal) {
      const sb = scrollBox.getBoundingClientRect();
      const td = firstVal.getBoundingClientRect();
      result.items.loonvoorstellen.firstValue.clippedPx = Math.max(0, Math.round(td.right - sb.right));
    }
  }

  // ---- item 1b: "Goedkeuring" in section 1 -------------------------------
  const goed = [...document.querySelectorAll('span')].find(
    (s) => (s.textContent || '').trim() === 'Goedkeuring'
  );
  if (goed) {
    const li = goed.closest('li');
    const ol = li ? li.closest('ol') : null;
    const r = goed.getBoundingClientRect();
    result.items.goedkeuring = {
      span: box(goed),
      cell: box(li),
      row: box(ol),
      // A single word in a centred cell: it overflows the cell when the cell is
      // narrower than the word. scrollWidth > clientWidth on the span is the
      // honest test; the cell does not clip unless something sets overflow.
      wordWiderThanCell: li ? Math.round(goed.scrollWidth - li.clientWidth) : null,
      spanOverflowPx: Math.round(goed.scrollWidth - goed.clientWidth),
      rightVsCell: li ? Math.round(r.right - li.getBoundingClientRect().right) : null,
      cellOverflowClipped: li ? getComputedStyle(li).overflow : null,
      rowScrollable: ol ? ol.scrollWidth > ol.clientWidth + 1 : null,
    };
  }

  // ---- item 2: the case cards --------------------------------------------
  const caseUl = [...document.querySelectorAll('ul')].find((u) =>
    (u.textContent || '').includes('Download de case')
  );
  if (caseUl) {
    const first = caseUl.querySelector(':scope > li');
    const card = first ? first.querySelector('article, .card') : null;
    const shell = caseUl.closest('.shell');
    result.items.cases = {
      track: box(caseUl),
      firstItem: box(first),
      firstCard: box(card),
      shell: box(shell),
      itemCount: caseUl.querySelectorAll(':scope > li').length,
      peekPx: first ? Math.round(vw - first.getBoundingClientRect().right) : null,
      // Is there anything on screen that says "this scrolls"?
      cueScrollbar: !caseUl.classList.contains('scrollhide'),
      cueArrows: !!(
        caseUl.parentElement &&
        caseUl.parentElement.querySelector('button[aria-label*="olgende"],button[aria-label*="orige"]')
      ),
      cueDots: !!(
        caseUl.parentElement && caseUl.parentElement.querySelector('[role="tablist"], .dots, .stip')
      ),
    };
  }

  // ---- item 3: the testimonial cards -------------------------------------
  const quoteUl = [...document.querySelectorAll('ul')].find((u) =>
    (u.textContent || '').includes('Pieter-Jan Boden')
  );
  if (quoteUl) {
    const first = quoteUl.querySelector(':scope > li');
    const section = quoteUl.closest('section') || quoteUl.parentElement;
    result.items.quotes = {
      track: box(quoteUl),
      firstItem: box(first),
      shell: box(quoteUl.closest('.shell')),
      itemCount: quoteUl.querySelectorAll(':scope > li').length,
      peekPx: first ? Math.round(vw - first.getBoundingClientRect().right) : null,
      cueScrollbar: !quoteUl.classList.contains('scrollhide'),
      cueArrows: !!(section && section.querySelector('button[aria-label*="olgende"],button[aria-label*="orige"]')),
      cueDots: !!(section && section.querySelector('[role="tablist"], .dots, .stip')),
    };
  }

  // ---- item 4: the footer -------------------------------------------------
  const footer = document.querySelector('footer.yb-footer') || document.querySelector('footer');
  if (footer) {
    const r = footer.getBoundingClientRect();
    const kids = [...footer.children].map((c) => {
      const cr = c.getBoundingClientRect();
      return {
        sel: sel(c),
        height: Math.round(cr.height),
        childCount: c.children.length,
        text: (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      };
    });
    // The link columns are the usual culprit: stacked instead of side by side.
    const cols = [...footer.querySelectorAll('.footer-links')].map((c) => ({
      height: Math.round(c.getBoundingClientRect().height),
      links: c.querySelectorAll('a').length,
      heading: (c.querySelector('p') || {}).textContent || '',
    }));
    result.items.footer = {
      sel: sel(footer),
      height: Math.round(r.height),
      viewportHeight: window.innerHeight,
      screens: +(r.height / window.innerHeight).toFixed(2),
      pageHeight: Math.round(document.documentElement.scrollHeight),
      shareOfPage: +((r.height / document.documentElement.scrollHeight) * 100).toFixed(1),
      children: kids,
      linkColumns: cols,
      linkCount: footer.querySelectorAll('a').length,
      gridTemplate: (() => {
        const grid = [...footer.querySelectorAll('*')].find((e) =>
          /grid|flex/.test(getComputedStyle(e).display) && e.querySelectorAll('.footer-links').length > 1
        );
        if (!grid) return null;
        const cs = getComputedStyle(grid);
        return { sel: sel(grid), display: cs.display, cols: cs.gridTemplateColumns, flexWrap: cs.flexWrap };
      })(),
    };
  }

  // Everything fixed at the bottom eats screen too; name it so the footer
  // number is not blamed for it.
  result.fixedBars = [...document.querySelectorAll('body *')]
    .filter((e) => {
      const cs = getComputedStyle(e);
      return (cs.position === 'fixed' || cs.position === 'sticky') && visible(e);
    })
    .slice(0, 8)
    .map((e) => {
      const r = e.getBoundingClientRect();
      return { sel: sel(e), height: Math.round(r.height), top: Math.round(r.top), position: getComputedStyle(e).position };
    });

  return result;
};

// ---------------------------------------------------------------- page prep
const settle = async (target) => {
  await target.evaluate(() => document.fonts.ready);
  await target.waitForTimeout?.(1500);
  // Fire every scroll-reveal so the end state is what gets measured.
  await target.evaluate(async () => {
    await new Promise((res) => {
      let y = 0;
      const step = () => {
        window.scrollTo(0, y);
        y += window.innerHeight;
        if (y < document.body.scrollHeight) setTimeout(step, 50);
        else { window.scrollTo(0, 0); setTimeout(res, 250); }
      };
      step();
    });
    const imgs = [...document.querySelectorAll('img')];
    for (const i of imgs) { i.loading = 'eager'; if (i.getAttribute('src')) i.src = i.getAttribute('src'); }
    await Promise.all(imgs.map((i) => i.complete ? Promise.resolve() : new Promise((r) => {
      i.addEventListener('load', r, { once: true });
      i.addEventListener('error', r, { once: true });
      setTimeout(r, 4000);
    })));
  });
};

const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

const shots = async (frameOrPage, prefix) => {
  const want = [
    ['sectie1', '.panel:has(.miniheader)', 0],
    ['loonvoorstellen', null, 0],
    ['cases', null, 0],
    ['quotes', null, 0],
    ['footer', 'footer', 0],
  ];
  void want;
  // Element shots, located by text so they survive class changes.
  const targets = [
    ['loonvoorstellen', () => 'Loonvoorstellen'],
    ['cases', () => 'Download de case'],
    ['quotes', () => 'Pieter-Jan Boden'],
  ];
  for (const [name, needle] of targets) {
    try {
      const handle = await frameOrPage.evaluateHandle((n) => {
        const hit = [...document.querySelectorAll('section, .panel, ul')].find((e) =>
          (e.textContent || '').includes(n)
        );
        return hit ? hit.closest('section') || hit : null;
      }, needle());
      const el = handle.asElement();
      if (!el) continue;
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await frameOrPage.waitForTimeout?.(500);
      await el.screenshot({ path: join(out, `${prefix}-${name}.png`) }).catch(() => {});
    } catch { /* a missing block is reported by the measurement, not here */ }
  }
  try {
    const f = await frameOrPage.$('footer.yb-footer, footer');
    if (f) {
      await f.scrollIntoViewIfNeeded().catch(() => {});
      await frameOrPage.waitForTimeout?.(400);
      await f.screenshot({ path: join(out, `${prefix}-footer.png`) }).catch(() => {});
    }
  } catch { /* idem */ }
};

const report = {};

// ================================================================ A: direct
const cr = await chromium.launch({ headless: true });
for (const p of PAGES) {
  const ctx = await cr.newContext(MOBILE);
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/${p.file}`, { waitUntil: 'load' });
  await settle(page);
  report[`A-direct-${p.key}`] = await page.evaluate(measure);
  await page.screenshot({ path: join(out, `A-direct-${p.key}-volledig.png`), fullPage: true });
  await shots(page, `A-direct-${p.key}`);
  await ctx.close();
}

// ================================================================ B/C: through the tool
const viaTool = async (label, contextOpts, phoneMode) => {
  const ctx = await cr.newContext(contextOpts);
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/review/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  // The API does not exist on a plain static server, so the tool raises its
  // "this copy saves nothing" dialog. It sits on top of the stage and would
  // cover every screenshot; the layout underneath is untouched.
  await page.evaluate(() => {
    const d = document.getElementById('dood');
    if (d) d.hidden = true;
  });
  if (phoneMode) {
    // On a narrow viewport the button is display:none — the tool assumes you are
    // already on a phone. Clicking it programmatically still works, which is how
    // we can measure the desktop-with-phone-mode case separately.
    await page.evaluate(() => document.getElementById('vPhone')?.click());
    await page.waitForTimeout(600);
  }
  const frameEl = await page.$('#frame');
  const frame = await frameEl.contentFrame();
  const frameBox = await frameEl.boundingBox();
  await settle(frame);
  const m = await frame.evaluate(measure);
  m.iframeElementBox = frameBox;
  m.stage = await page.evaluate(() => {
    const s = document.getElementById('stage');
    const r = s.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height), phoneClass: s.classList.contains('phone') };
  });
  report[label] = m;
  await page.screenshot({ path: join(out, `${label}-tool.png`) });
  await shots(frame, label);
  await ctx.close();
};

await viaTool('B-tool-desktop-phonemode-draft', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, true);
await viaTool('C-tool-op-telefoon-draft', MOBILE, false);
await viaTool('C2-tool-op-telefoon-phonemode-draft', MOBILE, true);
await cr.close();

// ================================================================ D: WebKit (iOS engine)
// Optional: this machine may not have the WebKit build for the installed
// Playwright. Missing it costs a cross-check, not the audit.
let wk = null;
try {
  wk = await webkit.launch({ headless: true });
  const ctx = await wk.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/draft-r3-01-definitief.html`, { waitUntil: 'load' });
  await settle(page);
  report['D-webkit-direct-draft'] = await page.evaluate(measure);
  await shots(page, 'D-webkit-direct-draft');
  await ctx.close();
} catch (e) {
  console.log(`\n(WebKit overgeslagen: ${String(e).split('\n')[0]})`);
} finally {
  if (wk) await wk.close();
}

writeFileSync(join(out, 'metingen.json'), JSON.stringify(report, null, 2));

// ---------------------------------------------------------------- console digest
for (const [k, v] of Object.entries(report)) {
  const po = v.pageOverflow;
  console.log(`\n== ${k}`);
  console.log(
    `   viewport clientWidth ${po.clientWidth} · innerWidth ${po.innerWidth} · schuifbalk ${po.scrollbarPx}px · scrollWidth ${po.docScrollWidth} → ${po.overflows ? 'OVERLOOP' : 'schoon'}`
  );
  if (v.stage) console.log(`   stage ${v.stage.width}px, phone-klasse ${v.stage.phoneClass}, iframe ${v.iframeElementBox?.width}px`);
  for (const o of po.offenders.slice(0, 6)) {
    console.log(`   · ${o.sel}  right ${o.right} (+${o.overshootPx}) ${o.insideScroller ? '[in scroller ' + o.insideScroller.sel.split(' > ').pop() + ']' : '[GEEN scroller]'}`);
  }
  if (v.gutter) console.log(`   goot .shell contentLeft: ${v.gutter.contentLeftValues.join(', ')}`);
  const i = v.items || {};
  if (i.loonvoorstellen) console.log(`   loontabel: scrollbox ${i.loonvoorstellen.scrollBox?.clientWidth} zichtbaar / ${i.loonvoorstellen.scrollBox?.scrollWidth} inhoud = ${i.loonvoorstellen.overshootPx}px verborgen; "Voorstel" ${i.loonvoorstellen.voorstelHeader?.clippedPx}px afgesneden`);
  if (i.goedkeuring) console.log(`   goedkeuring: woord ${i.goedkeuring.span?.scrollWidth}px in cel ${i.goedkeuring.cell?.clientWidth}px → ${i.goedkeuring.wordWiderThanCell}px te breed; spanoverflow ${i.goedkeuring.spanOverflowPx}`);
  if (i.cases) console.log(`   cases: track ${i.cases.track?.clientWidth}/${i.cases.track?.scrollWidth} scrollbaar=${i.cases.track?.scrollable} · eerste kaart left ${i.cases.firstItem?.left} · peek ${i.cases.peekPx}px · cue balk=${i.cases.cueScrollbar} pijlen=${i.cases.cueArrows} bolletjes=${i.cases.cueDots}`);
  if (i.quotes) console.log(`   quotes: track ${i.quotes.track?.clientWidth}/${i.quotes.track?.scrollWidth} scrollbaar=${i.quotes.track?.scrollable} · eerste kaart left ${i.quotes.firstItem?.left} · peek ${i.quotes.peekPx}px · cue balk=${i.quotes.cueScrollbar} pijlen=${i.quotes.cueArrows} bolletjes=${i.quotes.cueDots}`);
  if (i.footer) console.log(`   footer: ${i.footer.height}px = ${i.footer.screens} schermen van ${i.footer.viewportHeight}px · ${i.footer.shareOfPage}% van de pagina · ${i.footer.linkCount} links in ${i.footer.linkColumns.length} kolommen`);
}
console.log(`\nMetingen: ${join(out, 'metingen.json')}`);
