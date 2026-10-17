/**
 * Renders the raster icons from the brand SVGs (`public/brand/`,
 * `docs/brand-assets.md`):
 *
 *   public/brand/debikefitstudiologo-icon-512.png   the square mark, 512×512 (Organization logo, sharing)
 *   src/app/apple-icon.png                          180×180 (Next's `apple-icon` file convention)
 *   src/app/favicon.ico                             16, 32 and 48 px PNG entries in one .ico
 *
 * Run `npm run brand:icons` after a brand SVG changes; the outputs are
 * committed so a build never needs this script. Needs `sharp` (a dependency
 * of the app already) in the environment that runs npm (WSL here).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const BRAND = resolve(process.cwd(), 'public', 'brand');
const APP = resolve(process.cwd(), 'src', 'app');

async function png(svgFile: string, size: number): Promise<Buffer> {
  const svg = await readFile(resolve(BRAND, svgFile));
  return sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

/** An .ico container whose entries are PNG images (every current browser reads these). */
function ico(entries: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  entries.forEach((entry, index) => {
    const at = index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at); // width (0 = 256)
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1); // height
    directory.writeUInt8(0, at + 2); // colour palette
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
}

async function main() {
  await writeFile(
    resolve(BRAND, 'debikefitstudiologo-icon-512.png'),
    await png('debikefitstudiologo-icon-512.svg', 512),
  );
  console.log('+ public/brand/debikefitstudiologo-icon-512.png');
  await writeFile(
    resolve(APP, 'apple-icon.png'),
    await png('debikefitstudiologo-icon-512.svg', 180),
  );
  console.log('+ src/app/apple-icon.png (180×180)');
  const sizes = [16, 32, 48];
  const entries = [];
  for (const size of sizes) {
    entries.push({ size, data: await png('debikefitstudiologo-favicon-32.svg', size) });
  }
  await writeFile(resolve(APP, 'favicon.ico'), ico(entries));
  console.log(`+ src/app/favicon.ico (${sizes.join(', ')} px)`);
}

main().catch((error) => {
  console.error('✗ brand icons failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
