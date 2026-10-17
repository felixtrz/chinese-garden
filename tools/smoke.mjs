// End-to-end smoke test: visits all seven scenic views, performs each ritual with the
// keyboard, and fails unless every view is completed without page errors.
// Runs on a fake clock stepped at 30 fps, so it behaves the same on a GPU or in software GL.
// Usage: node tools/smoke.mjs [screenshotDir]
import fs from 'node:fs';
import { collectErrors, installFakeClock, launch, openGardenOnFakeClock, stepUntil } from './lib.mjs';

const out = process.argv[2];
if (out) fs.mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, ignoreHTTPSErrors: true });
// generous: under SwiftShader (no GPU) a single frame can take seconds
page.setDefaultTimeout(120_000);
const errors = collectErrors(page);
await installFakeClock(page);
await openGardenOnFakeClock(page);
await page.click('#enter-btn');
await stepUntil(page, () => false, null, { seconds: 3 }); // the intro glide down to eye level

// [poi id, x, z, yaw, pitch]: a spot inside each view's radius, facing its subject
const steps = [
  ['gate', 0, 14.6, 0, 0],
  ['zigzag', 0.6, 0.6, 0.8, -0.2],
  ['pavilion', -0.3, -3.1, 2.2, 0],
  ['bridge', -6.0, -4.3, Math.PI, -0.2],
  ['cascade', -3.25, -6.92, Math.atan2(1.5, -0.33), -0.45],
  ['bamboo', 14.0, 0.4, -0.3, 0.25],
  ['pine', -14.0, 3.4, -2.0, 0],
];
// wait on game state rather than wall-clock time, so slow (software GL) machines pass too
const failures = [];
for (const [id, x, z, yaw, pitch] of steps) {
  await page.evaluate(([x, z, yaw, pitch]) => window.__garden.teleport(x, z, yaw, pitch), [x, z, yaw, pitch]);
  const offered = await stepUntil(page, (id) => window.__garden.G.nearPoi === id, id);
  if (offered) await page.keyboard.press('KeyE');
  const done = offered && (await stepUntil(page, (id) => window.__garden.G.completed.has(id), id, { seconds: 3 }));
  const near = await page.evaluate(() => window.__garden.G.nearPoi);
  console.log(id.padEnd(9), done ? 'ok' : `FAILED (offered: ${near})`);
  if (!done) failures.push(id);
  if (out) await page.screenshot({ path: `${out}/${id}.png` });
  if (id === 'pine') await page.keyboard.press('KeyE'); // stand up again
}
const completed = await page.evaluate(() => [...window.__garden.G.completed]);
await browser.close();

const missing = [...new Set([...failures, ...steps.map(([id]) => id).filter((id) => !completed.includes(id))])];
console.log('completed:', completed.join(', ') || '(none)');
if (errors.length) console.log(errors.join('\n'));
if (missing.length || errors.length) {
  console.error(`FAIL: missing ${missing.join(', ') || 'none'}; ${errors.length} page error(s)`);
  process.exit(1);
}
console.log('PASS');
