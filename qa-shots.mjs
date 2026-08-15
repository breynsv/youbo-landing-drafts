// Slice each draft into screen-sized frames a reviewer can actually look at.
//
//   node qa-shots.mjs               # all drafts
//   node qa-shots.mjs 03 07         # only drafts matching 03 or 07
//   HEADED=1 node qa-shots.mjs 03   # watch it in a real Chromium window
//
// A full-page shot of these drafts is 11,000-21,000px tall, which is unreadable
// as a single image. This writes qa/slices/<draft>/<viewport>-NN.jpg, one frame
// per screenful with a small overlap so nothing falls between two frames.
//
// All lazy images are forced to load first — otherwise the frames come out with
// blank rectangles where the artwork should be, and a reviewer reports a
// "missing image" bug that does not exist.

import { chromium } from 'playwright';
import { readdirSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'qa', 'slices');

const filters = process.argv.slice(2);
const drafts = readdirSync(here)
  .filter((f) => /^draft-.*\.html$/.test(f))
  .filter((f) => filters.length === 0 || filters.some((k) => f.includes(k)))
  .sort();

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];
const OVERLAP = 80;

const browser = await chromium.launch({ headless: !process.env.HEADED });

for (const file of drafts) {
  const base = file.replace(/\.html$/, '');
  const dir = join(root, base);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(join(here, file)).href, { waitUntil: 'load' });
    // Wait for the webfonts to actually arrive. Without this the early frames
    // can render in a fallback serif, which looks exactly like a broken
    // font-family declaration and gets reported as a page bug that is not one.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);

    // Fire every scroll-reveal, then force all imagery to load.
    await page.evaluate(async () => {
      await new Promise((res) => {
        let y = 0;
        const step = () => {
          window.scrollTo(0, y);
          y += window.innerHeight;
          if (y < document.body.scrollHeight) setTimeout(step, 50);
          else { window.scrollTo(0, 0); setTimeout(res, 200); }
        };
        step();
      });
      const imgs = [...document.querySelectorAll('img')];
      imgs.forEach((i) => {
        i.loading = 'eager';
        if (i.getAttribute('src')) i.src = i.getAttribute('src');
      });
      await Promise.all(
        imgs.map((i) =>
          i.complete
            ? Promise.resolve()
            : new Promise((r) => {
                i.addEventListener('load', r, { once: true });
                i.addEventListener('error', r, { once: true });
                setTimeout(r, 4000);
              })
        )
      );
    });
    await page.waitForTimeout(500);

    const total = await page.evaluate(() => document.body.scrollHeight);
    const step = vp.height - OVERLAP;
    let n = 0;
    for (let y = 0; y < total; y += step) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      // Must outlast the longest sanctioned entry animation (240ms) or frames
      // catch elements mid-fade and a reviewer reports "washed out cards" that
      // are fully opaque in a real browser a moment later.
      await page.waitForTimeout(450);
      n += 1;
      await page.screenshot({
        path: join(dir, `${vp.name}-${String(n).padStart(2, '0')}.jpg`),
        type: 'jpeg',
        quality: 78,
      });
      if (n > 40) break; // safety valve
    }
    console.log(`${base} ${vp.name}: ${n} frames (page ${total}px)`);
    await ctx.close();
  }
}

await browser.close();
console.log(`\nFrames in ${root}`);
