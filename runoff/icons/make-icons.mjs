#!/usr/bin/env node
/* Draws the Runoff icons with no dependencies: shapes are tested per pixel
 * (4×4 supersampled) and written as PNG via node:zlib. Rerun after a theme
 * change:   node icons/make-icons.mjs */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex('#1c2530'), WIN = hex('#243040'), SLAB = hex('#7d8791'), TOP = hex('#b3bdc6');
const WATER = hex('#5ec8f0'), HI = hex('#d8f4ff'), SUN0 = hex('#fff6d8'), SUN1 = hex('#ffb13b');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Shapes in a 512 design space; `k` shrinks toward the centre for maskable.
function sample(x, y) {
  // sun band across the top with a wavy edge
  const edge = 92 + Math.sin(x * 0.045) * 7;
  if (y < edge) return mix(SUN0, SUN1, y / edge);
  let c = BG;
  // back-wall windows
  for (const [wx, wy] of [[70, 150], [390, 150], [70, 420], [390, 420]])
    if (x > wx && x < wx + 52 && y > wy && y < wy + 70) c = WIN;
  // two slabs: left one rising to the right, right one rising to the left
  const slab = (ax, ay, bx, by, r) => {
    const ex = bx - ax, ey = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
    const dx = x - (ax + ex * t), dy = y - (ay + ey * t), d = Math.hypot(dx, dy);
    return d < r ? (dy < -r * 0.45 ? TOP : SLAB) : null;
  };
  c = slab(-20, 250, 250, 222, 18) ?? slab(532, 452, 262, 424, 18) ?? c;
  // the drop: a circle with a cone tangent to it
  const cx = 300, cy = 330, r = 64, ax = 300, ay = 200;
  const inCircle = Math.hypot(x - cx, y - cy) < r;
  const d = cy - ay, alpha = Math.asin(r / d);
  const vx = x - ax, vy = y - ay, along = vy, ang = Math.atan2(Math.abs(vx), vy);
  const inCone = along > 0 && along < d * Math.cos(alpha) ** 2 && ang < alpha;
  if (inCircle || inCone) c = Math.hypot(x - (cx - 22), y - (cy - 20)) < 16 ? HI : WATER;
  return c;
}

function draw(size, k) {
  const px = Buffer.alloc(size * (size * 4 + 1));
  const SS = 4;
  for (let j = 0; j < size; j++) {
    px[j * (size * 4 + 1)] = 0; // filter: none
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0;
      for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
        const u = ((i + (si + 0.5) / SS) / size) * 512, v = ((j + (sj + 0.5) / SS) / size) * 512;
        const c = sample(256 + (u - 256) / k, 256 + (v - 256) / k);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = j * (size * 4 + 1) + 1 + i * 4, n = SS * SS;
      px[o] = r / n; px[o + 1] = g / n; px[o + 2] = b / n; px[o + 3] = 255;
    }
  }
  return png(size, size, px);
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(join(DIR, 'icon-192.png'), draw(192, 1));
writeFileSync(join(DIR, 'icon-512.png'), draw(512, 1));
writeFileSync(join(DIR, 'icon-512-maskable.png'), draw(512, 0.8));
writeFileSync(join(DIR, 'apple-touch-icon.png'), draw(180, 1));
console.log('wrote icons to', DIR);
