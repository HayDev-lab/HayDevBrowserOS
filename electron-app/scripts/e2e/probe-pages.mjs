import { AppHandle } from '../../scripts/e2e/harness.mjs';

const app = new AppHandle();
try {
  await app.launch();
  console.log('ports:', JSON.stringify(app.ports, null, 2));
  const cp = app.chromePage();
  console.log('chrome url:', cp.url());
  const html = await cp.content();
  console.log('chrome html head:', html.slice(0, 1200));
  console.log('tab pages:', app.tabPages().map((p) => p.url()));
  await app.stop();
} catch (e) {
  console.error('FAIL:', e.message);
  await app.stop().catch(() => {});
  process.exit(1);
}
