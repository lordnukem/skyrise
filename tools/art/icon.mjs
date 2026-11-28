// Renders assets/ui/app-icon.svg to the PNG sizes browsers and phones ask for (512 and 180),
// with the pre-installed Chromium. Run by tools/art/build.py; or: node tools/art/icon.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'ui');
const svg = readFileSync(join(OUT, 'app-icon.svg'), 'utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
for (const px of [512, 180]) {
  const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`);
  await page.screenshot({ path: join(OUT, `app-icon-${px}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
console.log('rendered app-icon-512.png and app-icon-180.png');
