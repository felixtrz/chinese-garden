// Uncapped frame-rate benchmark: vsync and the frame limiter are disabled so the
// numbers show real headroom. Usage: node tools/perf.mjs [dpr] [cpuThrottle]
// Numbers are only meaningful with a hardware GPU (macOS/Metal), not SwiftShader.
import { launch, openGarden } from './lib.mjs';
const dpr = +(process.argv[2] || 2);
const browser = await launch(['--disable-gpu-vsync', '--disable-frame-rate-limit']);
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr, ignoreHTTPSErrors: true });
const throttle = +(process.argv[3] || 1);
if (throttle > 1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
}
await openGarden(page);
await page.click('#enter-btn');
await page.waitForTimeout(3500);
const views = [
  ['gate', 0, 15.5, 0, 0],
  ['pond', -6.4, 3.6, 0.15, 0.02],
  ['pavilion', 2.5, 2.0, 0.5, 0.05],
  ['bamboo', 14, 3.5, 0.3, 0.05],
];
for (const [name, x, z, yaw, pitch] of views) {
  for (const night of [false, true]) {
    await page.evaluate(([x, z, yaw, pitch, night]) => {
      const g = window.__garden;
      g.G.todMode = night ? 'night' : 'day';
      g.G.tod = night ? 0.76 : 0.22;
      g.teleport(x, z, yaw, pitch);
    }, [x, z, yaw, pitch, night]);
    await page.waitForTimeout(1800);
    const r = await page.evaluate(
      () =>
        new Promise((res) => {
          const times = [];
          let last = performance.now();
          const t0 = last;
          const tick = () => {
            const now = performance.now();
            times.push(now - last);
            last = now;
            if (now - t0 < 4000) requestAnimationFrame(tick);
            else {
              times.sort((a, b) => a - b);
              const info = window.__garden.world.renderer.info;
              res({
                fps: times.length / 4,
                p50: times[Math.floor(times.length * 0.5)],
                p95: times[Math.floor(times.length * 0.95)],
                calls: info.render.calls,
                tris: info.render.triangles,
                pr: window.__garden.world.renderer.getPixelRatio(),
              });
            }
          };
          requestAnimationFrame(tick);
        }),
    );
    console.log(
      `${name.padEnd(9)} ${night ? 'night' : 'day  '}  ${r.fps.toFixed(0).padStart(4)} fps  p50 ${r.p50.toFixed(1)}ms  p95 ${r.p95.toFixed(1)}ms  calls ${r.calls}  tris ${(r.tris / 1000).toFixed(0)}k  pr ${r.pr}`,
    );
  }
}
await browser.close();
