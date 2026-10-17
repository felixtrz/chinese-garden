// Usage: node tools/capture.mjs <outDir>
// Tours the garden (keyboard walk, teleports to each view, koi feeding, dusk, pause menu)
// and saves a screenshot per stop plus console.txt with any console errors/warnings.
import fs from 'node:fs';
import { collectErrors, launch, openGarden, teleporter } from './lib.mjs';

const out = process.argv[2] || 'shots';
fs.mkdirSync(out, { recursive: true });

const browser = await launch(['--autoplay-policy=no-user-gesture-required']);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const logs = collectErrors(page, { console: true });
await openGarden(page);
await page.waitForTimeout(2500);
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('saved', `${out}/${name}.png`); };
await shot('01-intro');
await page.click('#enter-btn');
await page.waitForTimeout(1800);
await shot('02-spawn');

const tp = teleporter(page, 1600);
// walk forward through the moon gate using the keyboard
await page.keyboard.down('KeyW');
await page.waitForTimeout(2600);
await page.keyboard.up('KeyW');
await page.waitForTimeout(900);
await shot('03-walked-to-gate');
const views = [
  ['04-moon-view', -6.4, 3.4, 0.05, -0.1],
  ['05-zigzag', 0.4, 3.0, 0.3, -0.06],
  ['06-pavilion-inside', -0.4, -3.4, 2.4, 0.12],
  ['07-on-moon-bridge', -8.8, -4.3, -1.57, -0.12],
  ['08-cascade', -10.2, -6.4, -1.27, 0.05],
  ['09-bamboo', 14.0, 3.4, 0.2, 0.1],
  ['10-terrace', -12.0, 3.0, -1.9, -0.05],
  ['11-overview-east', 13.5, 6.5, 0.85, -0.12],
];
for (const [name, x, z, yaw, pitch] of views) { await tp(x, z, yaw, pitch); await shot(name); }
// interaction: feed koi on bridge
await tp(-6.7, -4.3, 0, -0.5);
await page.keyboard.press('KeyE');
await page.waitForTimeout(4000);
await shot('12-feed-koi');
// dusk
await page.keyboard.press('KeyT');
await page.waitForTimeout(4200);
await tp(-6.4, 3.4, 0.05, -0.08, 1500);
await shot('13-dusk-moon');
await tp(-6, 3.5, -0.7, 0.02, 1500);
await shot('14-dusk-pavilion');
await page.keyboard.press('Escape');
await page.evaluate(() => window.__garden.player()?.setPaused(true));
await page.waitForTimeout(800);
await shot('15-pause-menu');
fs.writeFileSync(`${out}/console.txt`, logs.join('\n'));
console.log('console issues:', logs.length);
await browser.close();
