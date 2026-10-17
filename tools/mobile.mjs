// Phone emulation: touch joystick + look drag in landscape, the action button, then portrait.
// Usage: node tools/mobile.mjs [outDir]
import fs from 'node:fs';
import { collectErrors, launch, openGarden } from './lib.mjs';

const out = process.argv[2] || 'shots/mobile';
fs.mkdirSync(out, { recursive: true });
const browser = await launch();
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  ignoreHTTPSErrors: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const logs = collectErrors(page);
await openGarden(page);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/1-intro.png` });
await page.tap('#enter-btn');
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/2-entered.png` });
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
const pos = () => page.evaluate(() => { const p = window.__garden.world.player.position; return [+p.x.toFixed(2), +p.z.toFixed(2)]; });
console.log('start', await pos());
// left thumb joystick forward + right thumb look drag simultaneously
await touch('touchStart', [[150, 280, 1]]);
for (let i = 0; i <= 10; i++) { await touch('touchMove', [[150, 280 - i * 5, 1]]); await page.waitForTimeout(30); }
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/3-joystick.png` });
await touch('touchStart', [[150, 230, 1], [650, 200, 2]]);
for (let i = 0; i <= 20; i++) { await touch('touchMove', [[150, 230, 1], [650 + i * 6, 200, 2]]); await page.waitForTimeout(40); }
await page.waitForTimeout(1200);
await touch('touchEnd', []);
await page.waitForTimeout(400);
console.log('after walk', await pos(), 'yaw', await page.evaluate(() => window.__garden.player().yaw.toFixed(2)));
await page.screenshot({ path: `${out}/4-after.png` });
// go near the gate and show the action button
await page.evaluate(() => window.__garden.teleport(0, 14.4, 0, 0.2)); await page.waitForTimeout(2200);
await page.screenshot({ path: `${out}/5-action.png` });
await page.evaluate(() => document.exitFullscreen?.().catch(() => {})); await page.waitForTimeout(300); await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/6-portrait.png` });
console.log('errors', logs);
await browser.close();
