import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.ts', 'tests/gemini-thought-signature.test.ts', 'tests/integration-runtime-contract.test.ts'], {
  stdio: 'inherit', env: { ...process.env, HAYDEV_INTEGRATION: '1' },
});
process.exit(result.status ?? 1);
