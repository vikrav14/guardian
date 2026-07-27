/**
 * Flood-fill beige stage backgrounds to alpha and write PNGs for Flutter.
 * Usage: node scripts/dodo-transparent-png.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stagesDir = path.join(__dirname, '..', 'assets', 'dodo', 'stages');

const TOLERANCE = 42;

function getPixel(data, width, channels, x, y) {
  const i = (y * width + x) * channels;
  return [data[i], data[i + 1], data[i + 2]];
}

function matchesBg(r, g, b, bg) {
  return (
    Math.abs(r - bg[0]) <= TOLERANCE &&
    Math.abs(g - bg[1]) <= TOLERANCE &&
    Math.abs(b - bg[2]) <= TOLERANCE
  );
}

async function transparentPng(inputPath, outputPath) {
  const img = sharp(inputPath);
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const corners = [
    getPixel(data, width, channels, 0, 0),
    getPixel(data, width, channels, width - 1, 0),
    getPixel(data, width, channels, 0, height - 1),
    getPixel(data, width, channels, width - 1, height - 1),
  ];
  const bg = corners.reduce(
    (acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]],
    [0, 0, 0],
  ).map((v) => Math.round(v / corners.length));

  const visited = new Uint8Array(width * height);
  const queue = [];
  for (let x = 0; x < width; x += 1) {
    queue.push([x, 0], [x, height - 1]);
  }
  for (let y = 0; y < height; y += 1) {
    queue.push([0, y], [width - 1, y]);
  }

  while (queue.length > 0) {
    const [x, y] = queue.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const i = idx * channels;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (!matchesBg(r, g, b, bg)) continue;
    data[i + 3] = 0;
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  await sharp(data, { raw: { width, height, channels } }).png().toFile(outputPath);
  console.log(`wrote ${path.basename(outputPath)} (bg ~ rgb(${bg.join(',')}))`);
}

const mauritiusRawMap = [
  ['guardian_dodo_live_mauritius_raw.png', 'guardian_dodo_live.png'],
  ['guardian_dodo_pendant_mauritius_raw.png', 'guardian_dodo_pendant.png'],
  ['guardian_dodo_network_mauritius_raw.png', 'guardian_dodo_network.png'],
  ['guardian_dodo_location_mauritius_raw.png', 'guardian_dodo_location.png'],
  ['guardian_dodo_ai_mauritius_raw.png', 'guardian_dodo_ai.png'],
];

const mauritiusPresent = mauritiusRawMap.some(([raw]) =>
  fs.existsSync(path.join(stagesDir, raw)),
);

if (mauritiusPresent) {
  for (const [raw, out] of mauritiusRawMap) {
    const inputPath = path.join(stagesDir, raw);
    if (!fs.existsSync(inputPath)) {
      console.warn(`skip missing ${raw}`);
      continue;
    }
    await transparentPng(inputPath, path.join(stagesDir, out));
  }
} else {
  const files = fs.readdirSync(stagesDir).filter((f) => f.endsWith('.webp'));
  for (const file of files) {
    const base = file.replace(/\.webp$/, '');
    await transparentPng(
      path.join(stagesDir, `${base}.webp`),
      path.join(stagesDir, `${base}.png`),
    );
  }
}
