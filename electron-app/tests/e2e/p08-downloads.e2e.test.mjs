import test from 'node:test';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { checkDownloads } from '../../scripts/e2e/check-downloads.mjs';
test('P08: native downloads bytes, collisions, progress, cancellation and failure', {timeout:90000}, async t=>{
  const app=new AppHandle(); t.after(()=>app.stop()); await app.launch();
  await app.chromePage().waitForSelector('.commandbar__input');
  await checkDownloads(app,app.chromePage());
});
