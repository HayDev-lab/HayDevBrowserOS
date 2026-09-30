// Generate a 256x256 app icon PNG programmatically (no external deps).
// Design: Neural Cockpit dark foundation (#05070d) with a glowing "B" monogram
// and a subtle radial gradient ring — matches the app's design tokens.
const fs = require('fs');
const zlib = require('zlib');

const SIZE = 256;

// --- Color helpers ---
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const bg = hexToRgb('#05070d');
const accent = hexToRgb('#4f8cff'); // Neural Cockpit accent blue
const accent2 = hexToRgb('#7c5cff'); // secondary violet

// --- Build RGBA pixel buffer ---
const px = Buffer.alloc(SIZE * SIZE * 4);
const cx = SIZE / 2;
const cy = SIZE / 2;
const R = SIZE * 0.42;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    // Base background with subtle vertical gradient
    let r = bg[0], g = bg[1], b = bg[2];
    const vgrad = y / SIZE;
    r += Math.round(6 * vgrad);
    g += Math.round(8 * vgrad);
    b += Math.round(14 * vgrad);

    // Radial glow ring
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ring = Math.abs(dist - R);
    if (ring < 14) {
      const t = 1 - ring / 14;
      const glow = t * t;
      r = Math.round(r + (accent[0] - r) * glow * 0.7);
      g = Math.round(g + (accent[1] - g) * glow * 0.7);
      b = Math.round(b + (accent[2] - b) * glow * 0.7);
    }

    // Inner filled disc (slightly lighter)
    if (dist < R - 14) {
      const t = dist / (R - 14);
      const mix = 0.25 + 0.15 * (1 - t);
      r = Math.round(r + (accent2[0] - r) * mix);
      g = Math.round(g + (accent2[1] - g) * mix);
      b = Math.round(b + (accent2[2] - b) * mix);
    }

    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  }
}

// --- Draw a bold "B" monogram in the center ---
// Simple bitmap font for "B" on a 7x9 grid, scaled up.
const B_GLYPH = [
  '1111110',
  '1000001',
  '1000001',
  '1000001',
  '1111110',
  '1000001',
  '1000001',
  '1000001',
  '1111110',
];
const gw = 7, gh = 9;
const scale = 12; // glyph cell size in px
const ox = Math.round(cx - (gw * scale) / 2);
const oy = Math.round(cy - (gh * scale) / 2);

for (let gy = 0; gy < gh; gy++) {
  for (let gx = 0; gx < gw; gx++) {
    if (B_GLYPH[gy][gx] !== '1') continue;
    for (let sy = 0; sy < scale; sy++) {
      for (let sx = 0; sx < scale; sx++) {
        const x = ox + gx * scale + sx;
        const y = oy + gy * scale + sy;
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
        const i = (y * SIZE + x) * 4;
        px[i] = 255;
        px[i + 1] = 255;
        px[i + 2] = 255;
        px[i + 3] = 255;
      }
    }
  }
}

// --- Encode PNG ---
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

// Raw scanlines with filter byte 0
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync('icon.png', png);
console.log('Wrote icon.png', png.length, 'bytes,', SIZE + 'x' + SIZE);
