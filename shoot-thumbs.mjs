// Screenshot every draft-*.html into thumbs/<same-name>.jpg.
//
//   node shoot-thumbs.mjs            # all drafts
//   node shoot-thumbs.mjs 03 07      # only drafts whose filename contains 03 or 07
//
// The review index renders these at ~380px wide, so we shoot the top 1600px of a
// 1280px-wide viewport and let the browser scale it down. Anything below the fold
// of that 1600px is not in the thumbnail — which is the point: the card should
// show what a visitor sees first.
//
// Needs playwright (already present in this machine's cache):
//   npx playwright screenshot --help

import { chromium } from 'playwright';
import { readdirSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const thumbs = join(here, 'thumbs');
if (!existsSync(thumbs)) mkdirSync(thumbs, { recursive: true });

const filters = process.argv.slice(2);
// Dezelfde verzameling als check-drafts.mjs: elke draft, plus elke pagina die
// zichzelf met <meta name="pagina-soort" content="vergelijking"> aanmeldt. Die
// staan allebei in het reviewgereedschap en hebben er dus allebei een thumbnail
// nodig. Gevonden op wat de pagina over zichzelf zegt, niet op hoe ze heet.
const VERGELIJKING_META = /<meta[^>]+name=["']pagina-soort["'][^>]+content=["']\s*vergelijking\s*["']/i;
const drafts = readdirSync(here)
  .filter(f => f.endsWith('.html'))
  .filter(f => f.startsWith('draft-') ||
               VERGELIJKING_META.test(readFileSync(join(here, f), 'utf8')))
  .filter(f => !filters.length || filters.some(x => f.includes(x)))
  .sort();

if (!drafts.length) {
  console.error('No drafts matched. Nothing to shoot.');
  process.exit(1);
}

// Als dit faalt met "Executable doesn't exist", dan is Playwright bijgewerkt en
// wijst het naar een buildnummer dat nog niet in ~/Library/Caches/ms-playwright
// staat. Het antwoord is `npx playwright install chromium` — ~95MB, eenmalig.
// Terugvallen op `channel: 'chrome'` is geprobeerd en werkt hier NIET: Chrome
// start wel, maar page.screenshot loopt daarna af op de time-out, ook op een
// eenvoudige draft. Niet opnieuw proberen.
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 1600 },
  deviceScaleFactor: 2,
});

for (const file of drafts) {
  const out = join(thumbs, file.replace('.html', '.jpg'));
  try {
    await page.goto('file://' + join(here, file), { waitUntil: 'networkidle', timeout: 30000 });
  } catch {
    // networkidle can hang on a page with a persistent connection; a load event is enough.
    await page.goto('file://' + join(here, file), { waitUntil: 'load', timeout: 30000 });
  }
  // Tailwind's CDN build and any webfont both land after load; give them a beat,
  // and let entry animations settle so we don't photograph a half-faded hero.
  await page.waitForTimeout(2500);
  // `animations: 'disabled'` zet oneindige animaties op hun eerste beeld. Zonder dat
  // wacht Playwright op een stabiel beeld dat nooit komt — de voorbijrollende
  // logobalk van ronde 3 draait voor altijd door — en loopt de opname na 30s af.
  // Het maakt de thumbnails meteen ook reproduceerbaar in plaats van toevallig.
  await page.screenshot({ path: out, type: 'jpeg', quality: 78, animations: 'disabled' });
  console.log('✓', file);
}

await browser.close();
console.log(`\n${drafts.length} thumbnail${drafts.length === 1 ? '' : 's'} written to thumbs/`);
