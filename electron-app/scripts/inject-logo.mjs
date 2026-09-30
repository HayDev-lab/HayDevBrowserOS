// One-shot injector: embeds the HayDev logo as data-URIs into the internal
// page builders (newtab/search) — shared output for both runtimes.
import fs from 'node:fs';

const b64 = (p) => fs.readFileSync(p).toString('base64');
const hero64 = b64('resources/brand/logo-64.png');
const fav32 = b64('resources/brand/logo-32.png');
const HERO = `data:image/png;base64,${hero64}`;
const FAV = `data:image/png;base64,${fav32}`;

// ---- newtab-page.ts -------------------------------------------------------
let s = fs.readFileSync('src/main/browser/pure/newtab-page.ts', 'utf8');
if (!s.includes('HERO_LOGO_DATA_URI')) {
  const anchor = 'const MAX_TITLE_LENGTH = 40;';
  if (!s.includes(anchor)) throw new Error('newtab: no const anchor');
  const consts = [
    anchor,
    '',
    '/** HayDev logo mark — data-URIs keep the generated page self-contained',
    ' * (byte-identical output shared by the Electron and Tauri runtimes). */',
    `const HERO_LOGO_DATA_URI = '${HERO}';`,
    `const FAVICON_DATA_URI = '${FAV}';`,
  ].join('\n');
  s = s.replace(anchor, consts);
}
if (!s.includes('rel="icon"')) {
  s = s.replace(
    '<meta charset="utf-8">',
    '<meta charset="utf-8">\n<link rel="icon" type="image/png" href="${FAV}">'
      .replace('${FAV}', FAV)
  );
}
if (!s.includes('hero__logo')) {
  const heroOld = '<header class="hero">\n        <h1 class="hero__brand">';
  if (!s.includes(heroOld)) throw new Error('newtab: no hero anchor');
  s = s.replace(
    heroOld,
    `<header class="hero">\n        <div class="hero__logo" aria-hidden="true"><img src="${HERO}" alt=""></div>\n        <h1 class="hero__brand">`
  );
}
if (!s.includes('.hero__logo')) {
  s = s.replace(
    '  .hero { text-align: center; }',
    [
      '  .hero { text-align: center; }',
      '  .hero__logo img {',
      '    width: clamp(44px, 4.4vw, 62px); height: auto; display: block;',
      '    margin: 0 auto 10px; filter: drop-shadow(0 0 18px rgba(0, 255, 209, 0.22));',
      '  }',
    ].join('\n')
  );
}
fs.writeFileSync('src/main/browser/pure/newtab-page.ts', s);
console.log('newtab:', { consts: s.includes('HERO_LOGO_DATA_URI'), favicon: s.includes('rel="icon"'), hero: s.includes('hero__logo'), css: s.includes('.hero__logo') });

// ---- search-page.ts -------------------------------------------------------
let sp = fs.readFileSync('src/main/browser/pure/search-page.ts', 'utf8');
if (!sp.includes('rel="icon"')) {
  const sa = '<meta charset="utf-8">';
  if (!sp.includes(sa)) throw new Error('search: no meta anchor');
  sp = sp.replace(sa, `${sa}\n<link rel="icon" type="image/png" href="${FAV}">`);
  fs.writeFileSync('src/main/browser/pure/search-page.ts', sp);
}
console.log('search favicon:', sp.includes('rel="icon"'));
