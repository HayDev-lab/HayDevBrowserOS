import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.argv[2];
const exe = process.env.HAYDEV_APP_BIN || path.resolve('src-tauri/target/debug/app.exe');
for (const [file, error] of Object.entries({ 'multilingual.pdf': null, 'multilingual.docx': null,
  'empty.pdf': 'DOCUMENT_EMPTY', 'scan.pdf': 'DOCUMENT_SCAN_REQUIRES_OCR', 'protected.pdf': 'DOCUMENT_PROTECTED',
  'corrupt.pdf': 'DOCUMENT_CORRUPT', 'corrupt.docx': 'DOCUMENT_CORRUPT' })) {
  const started = performance.now();
  const result = spawnSync(exe, ['--document-worker', path.extname(file).slice(1)], {
    input: readFileSync(path.join(root,file)), timeout: 10000, maxBuffer: 2*1024*1024,
  });
  assert.equal(result.status, 0, result.stderr?.toString());
  const output = JSON.parse(result.stdout);
  if (error) assert.equal(output.error, error);
  else { assert.equal(output.ok,true); for(const expected of ['Москва','Երևան','7319 AMD','Copper']) assert.ok(output.document.text.includes(expected), `${file}: ${expected}`); }
  console.log(JSON.stringify({file,status:'PASS',durationMs:Math.round(performance.now()-started),expectedError:error}));
}
