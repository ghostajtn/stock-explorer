// Generates the PWA icons (PNG) with no dependencies: dark tile + rising green chart line.
//   node tools/make-icons.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, sum]);
};

function png(size, { padding = 0.14, rounded = true } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const BG = [14, 17, 22], FG = [63, 185, 80], ACC = [88, 166, 255];
  // chart polyline in unit coordinates, scaled into the padded safe area
  const pts = [[0.05, 0.78], [0.30, 0.55], [0.48, 0.66], [0.70, 0.30], [0.95, 0.12]]
    .map(([x, y]) => [(padding + x * (1 - 2 * padding)) * size, (padding + y * (1 - 2 * padding)) * size]);
  const w = size * 0.07, r = size * 0.22;
  const segDist = (px_, py_, [ax, ay], [bx, by]) => {
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px_ - ax) * dx + (py_ - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px_ - (ax + t * dx), py_ - (ay + t * dy));
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    // rounded-corner mask (anti-aliased)
    let a = 255;
    if (rounded) {
      const cx = Math.min(x + 0.5, size - x - 0.5), cy = Math.min(y + 0.5, size - y - 0.5);
      if (cx < r && cy < r) { const d = Math.hypot(r - cx, r - cy); a = Math.max(0, Math.min(1, r - d + 0.5)) * 255; }
    }
    let d = Infinity; for (let s = 0; s < pts.length - 1; s++) d = Math.min(d, segDist(x + 0.5, y + 0.5, pts[s], pts[s + 1]));
    const dot = Math.hypot(x + 0.5 - pts.at(-1)[0], y + 0.5 - pts.at(-1)[1]) - w * 1.25;
    const line = Math.max(0, Math.min(1, w - d + 0.5)), tip = Math.max(0, Math.min(1, -dot + 0.5));
    let c = BG.map((v, k) => v + (FG[k] - v) * line);
    c = c.map((v, k) => v + (ACC[k] - v) * tip);
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync('public/icons', { recursive: true });
const out = {
  'icon-192.png': png(192), 'icon-512.png': png(512),
  'maskable-512.png': png(512, { padding: 0.26, rounded: false }),   // full-bleed with a larger safe zone
  'apple-touch-icon.png': png(180, { rounded: false }),
};
for (const [name, buf] of Object.entries(out)) { fs.writeFileSync(`public/icons/${name}`, buf); console.log(name, buf.length, 'bytes'); }
