// Generates build/icon.ico (256x256 PNG-in-ICO) and icon.png for the app.
// Draws a dark rounded square with a red play-circle and sound waves.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 256;
const SS = 2; // supersample factor
const W = SIZE * SS;

function makeCrcTable() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
}
const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── Drawing helpers (operate at supersampled resolution) ──
function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return dx * dx + dy * dy <= r * r;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const v0x = cx - ax, v0y = cy - ay;
  const v1x = bx - ax, v1y = by - ay;
  const v2x = px - ax, v2y = py - ay;
  const d00 = v0x * v0x + v0y * v0y;
  const d01 = v0x * v1x + v0y * v1y;
  const d11 = v1x * v1x + v1y * v1y;
  const d20 = v2x * v0x + v2y * v0y;
  const d21 = v2x * v1x + v2y * v1y;
  const denom = d00 * d11 - d01 * d01;
  const u = (d11 * d20 - d01 * d21) / denom;
  const v = (d00 * d21 - d01 * d20) / denom;
  return u >= 0 && v >= 0 && u + v <= 1;
}

// Arc band (sound wave): between radius r1..r2 around (cx,cy), angle within [-a, a] from horizontal-right
function inArcBand(x, y, cx, cy, r1, r2, maxAngle) {
  const dx = x - cx, dy = y - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < r1 || d > r2) return false;
  const ang = Math.abs(Math.atan2(dy, dx));
  return ang <= maxAngle;
}

function samplePixel(x, y) {
  // returns [r,g,b,a]
  const s = SS;
  // Rounded square background
  if (!inRoundedRect(x, y, 8 * s, 8 * s, 248 * s, 248 * s, 52 * s)) return [0, 0, 0, 0];

  // Vertical gradient background #23234a -> #101020
  const t = y / W;
  let r = Math.round(0x23 + (0x10 - 0x23) * t);
  let g = Math.round(0x23 + (0x10 - 0x23) * t);
  let b = Math.round(0x4a + (0x20 - 0x4a) * t);

  const cx = 116 * s, cy = 128 * s;

  // Sound waves (right side), light pink-white
  if (inArcBand(x, y, cx, cy, 108 * s, 118 * s, 0.55) ||
      inArcBand(x, y, cx, cy, 132 * s, 142 * s, 0.42)) {
    return [255, 200, 210, 255];
  }

  // Red circle
  if (inCircle(x, y, cx, cy, 84 * s)) {
    // subtle gradient on circle
    const ct = (y - (cy - 84 * s)) / (168 * s);
    const cr = Math.round(0xe9 - 0x20 * ct);
    const cg = Math.round(0x45 - 0x10 * ct);
    const cb = Math.round(0x60 - 0x10 * ct);
    // Play triangle (white)
    if (inTriangle(x, y, 92 * s, 88 * s, 92 * s, 168 * s, 164 * s, 128 * s)) {
      return [255, 255, 255, 255];
    }
    return [cr, cg, cb, 255];
  }

  return [r, g, b, 255];
}

// Render supersampled then downsample
console.log('Rendering icon...');
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const [pr, pg, pb, pa] = samplePixel(x * SS + sx, y * SS + sy);
        r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
      }
    }
    const n = SS * SS;
    const idx = (y * SIZE + x) * 4;
    if (a > 0) {
      out[idx] = Math.round(r / a);
      out[idx + 1] = Math.round(g / a);
      out[idx + 2] = Math.round(b / a);
      out[idx + 3] = Math.round(a / n);
    }
  }
}

const png = encodePNG(SIZE, SIZE, out);

// ICO wrapper (PNG-in-ICO, valid for Vista+)
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2); // type: icon
icoHeader.writeUInt16LE(1, 4); // count

const dirEntry = Buffer.alloc(16);
dirEntry[0] = 0; // 256 width
dirEntry[1] = 0; // 256 height
dirEntry[2] = 0; // colors
dirEntry[3] = 0;
dirEntry.writeUInt16LE(1, 4);  // planes
dirEntry.writeUInt16LE(32, 6); // bpp
dirEntry.writeUInt32LE(png.length, 8);
dirEntry.writeUInt32LE(22, 12); // offset

const ico = Buffer.concat([icoHeader, dirEntry, png]);

const buildDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
fs.writeFileSync(path.join(__dirname, '..', 'icon.png'), png);
console.log('Wrote build/icon.ico (' + ico.length + ' bytes) and icon.png');
