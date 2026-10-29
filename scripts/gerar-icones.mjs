// Gera os ícones do Muquifo (prato com garfo e faca) sem dependências:
// PNGs do app (apps/web/public) e o .ico do Muquifo.exe (tools/launcher).
// Uso: node scripts/gerar-icones.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORANGE = [0xe8, 0x74, 0x2f];
const WHITE = [255, 255, 255];

const rect = (x0, y0, x1, y1) => (x, y) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1;
const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const ring = (cx, cy, r0, r1) => (x, y) => {
  const d = (x - cx) ** 2 + (y - cy) ** 2;
  return d <= r1 * r1 && d >= r0 * r0;
};

// Coordenadas 0..1; tudo nos 80% centrais (zona segura do ícone "maskable").
const solid = [
  ring(0.5, 0.5, 0.165, 0.215),
  // garfo
  rect(0.188, 0.27, 0.2, 0.39),
  rect(0.214, 0.27, 0.226, 0.39),
  rect(0.24, 0.27, 0.252, 0.39),
  rect(0.188, 0.375, 0.252, 0.43),
  rect(0.207, 0.42, 0.233, 0.73),
  circle(0.22, 0.73, 0.013),
  // faca
  rect(0.762, 0.3, 0.8, 0.5),
  circle(0.781, 0.3, 0.019),
  rect(0.768, 0.49, 0.794, 0.73),
  circle(0.781, 0.73, 0.013),
];
const soft = [circle(0.5, 0.5, 0.125)];

/**
 * Pixels RGBA de cima para baixo. `round` arredonda os cantos (o .ico não
 * passa por máscara do sistema como o ícone do celular).
 */
function render(size, { round = false } = {}) {
  const S = 4; // supersampling para bordas suaves
  const px = Buffer.alloc(size * size * 4);
  const corner = round ? 0.18 : 0;
  const inside = (x, y) => {
    if (!corner) return true;
    const cx = Math.min(Math.max(x, corner), 1 - corner);
    const cy = Math.min(Math.max(y, corner), 1 - corner);
    return (x - cx) ** 2 + (y - cy) ** 2 <= corner * corner;
  };
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let bg = 0;
      let hit = 0;
      let half = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (pxl + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          if (!inside(x, y)) continue;
          bg++;
          if (solid.some((f) => f(x, y))) hit++;
          else if (soft.some((f) => f(x, y))) half++;
        }
      }
      const a = bg ? (hit + half * 0.3) / bg : 0;
      const o = (py * size + pxl) * 4;
      for (let c = 0; c < 3; c++) {
        px[o + c] = Math.round(ORANGE[c] * (1 - a) + WHITE[c] * a);
      }
      px[o + 3] = Math.round((bg / (S * S)) * 255);
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function png(size, options) {
  const pixels = render(size, options);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Imagem BMP (DIB 32 bits) de um .ico: a bandeja do Windows lê melhor que PNG. */
function dib(size) {
  const pixels = render(size, { round: true });
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // cor + máscara
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const color = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = ((size - 1 - y) * size + x) * 4; // de baixo para cima, BGRA
      color[dst] = pixels[src + 2];
      color[dst + 1] = pixels[src + 1];
      color[dst + 2] = pixels[src];
      color[dst + 3] = pixels[src + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, color, Buffer.alloc(maskRow * size)]);
}

function ico(sizes) {
  const images = sizes.map((s) =>
    s >= 256 ? png(s, { round: true }) : dib(s),
  );
  const dir = Buffer.alloc(6 + 16 * sizes.length);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(sizes.length, 4);
  let offset = dir.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    dir[e] = s >= 256 ? 0 : s;
    dir[e + 1] = s >= 256 ? 0 : s;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(images[i].length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([dir, ...images]);
}

const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(path.slice(root.length + 1));
};

const pub = join(root, 'apps/web/public');
write(join(pub, 'icon-192.png'), png(192));
write(join(pub, 'icon-512.png'), png(512));
write(join(pub, 'apple-touch-icon.png'), png(180));
write(join(pub, 'favicon-32.png'), png(32, { round: true }));
write(join(root, 'tools/launcher/muquifo.ico'), ico([16, 24, 32, 48, 256]));
