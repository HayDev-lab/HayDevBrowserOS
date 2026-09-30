// Replace the embedded logo data-URIs with the CURRENT (transparent) assets.
import fs from 'node:fs';

const hero64 = fs.readFileSync('resources/brand/logo-64.png').toString('base64');
const fav32 = fs.readFileSync('resources/brand/logo-32.png').toString('base64');
const HERO = `data:image/png;base64,${hero64}`;
const FAV = `data:image/png;base64,${fav32}`;

function replaceBetween(text, startMarker, endMarker, replacement) {
  const a = text.indexOf(startMarker);
  if (a < 0) return { text, ok: false };
  const b = text.indexOf(endMarker, a + startMarker.length);
  if (b < 0) return { text, ok: false };
  return { text: text.slice(0, a) + replacement + text.slice(b + endMarker.length), ok: true };
}

// ---- newtab ----------------------------------------------------------------
let nt = fs.readFileSync('src/main/browser/pure/newtab-page.ts', 'utf8');
nt = replaceBetween(nt, "const HERO_LOGO_DATA_URI = '", "';", `const HERO_LOGO_DATA_URI = '${HERO}';`).text;
nt = replaceBetween(nt, "const FAVICON_DATA_URI = '", "';", `const FAVICON_DATA_URI = '${FAV}';`).text;
const favLink = replaceBetween(nt, '<link rel="icon" type="image/png" href="', '">', `<link rel="icon" type="image/png" href="${FAV}">`);
nt = favLink.text;
const heroImg = replaceBetween(nt, '<div class="hero__logo" aria-hidden="true"><img src="', '">', `<div class="hero__logo" aria-hidden="true"><img src="${HERO}">`);
nt = heroImg.text;
fs.writeFileSync('src/main/browser/pure/newtab-page.ts', nt);
console.log('newtab:', {
  heroConst: nt.includes(HERO),
  favConst: nt.includes(FAV),
  favLink: favLink.ok,
  heroImg: heroImg.ok,
});

// ---- search ------------------------------------------------------------------
let sp = fs.readFileSync('src/main/browser/pure/search-page.ts', 'utf8');
const spf = replaceBetween(sp, '<link rel="icon" type="image/png" href="', '">', `<link rel="icon" type="image/png" href="${FAV}">`);
sp = spf.text;
fs.writeFileSync('src/main/browser/pure/search-page.ts', sp);
console.log('search favicon:', spf.ok && sp.includes(FAV));

// ---- topbar asset --------------------------------------------------------------
fs.copyFileSync('resources/brand/logo-64.png', 'src/renderer/src/assets/haydev-logo.png');
console.log('topbar asset updated');
