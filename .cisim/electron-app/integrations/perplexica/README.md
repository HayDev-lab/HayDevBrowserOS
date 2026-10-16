# Pinned Perplexica integration

`source-lock.json` pins the upstream Vane/Perplexica commit and SHA-256 of the HayDev integration patch, additional modules and npm lockfile. The patch preserves the provider error and Gemini thought-signature fixes from the working integration used by this project. The generated checkout is under `electron-app/.cache/perplexica`; a neighboring checkout is never used.

Run `npm run integration:prepare`, then `npm run typecheck:integration` and `npm run test:integration`. Ordinary unit tests exclude the integration file before module resolution. The integration CI job must prepare and run it; absence is an error there.

The integration imports its dependency graph in a separately measured setup hook (20 seconds, unchanged bound). The provider-error runtime test then requires settlement within 2 seconds. This distinguishes environment loading from a stuck search operation. All provider replies are synthetic, and DATA_DIR is temporary.

Upstream is MIT licensed; the exact license is included in `overlay/LICENSE`. This source pin does not by itself certify the security or native ABI of a packaged runtime.
