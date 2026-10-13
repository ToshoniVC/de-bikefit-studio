/**
 * Imports one delivered editorial image into the site.
 *
 *   npm run images:import -- --slot flemish-lane --src "/path/to/delivered.png" \
 *     [--alt "Dutch alt text"] [--prompt "generation prompt"] [--version 2]
 *
 * Slots: the keys of `src/lib/studio/editorial-images.json` (flemish-lane,
 * fitting-session, coach-junior). The script:
 *  1. reads the source file (never modified) and records its sha256;
 *  2. writes `public/images/editorial/<slot>-v<version>.webp`: EXIF-rotated,
 *     at most 2000 px on the long side, metadata stripped, WebP at the highest
 *     quality that stays under 450 KB (Next's optimiser serves smaller sizes);
 *  3. records file, size, dimensions, provenance, prompt and alt in the
 *     manifest. Existing files are never overwritten: bump `--version`.
 *
 * Afterwards the seed content picks the image up (`editorialImage()`), and a
 * `cms:rollout-aanbod` dry run shows the pages that will get it. Only for
 * generated images of generic people: never import one as a team portrait.
 *
 * Uses `sharp`, which ships with Next.js; no extra dependency.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const MANIFEST = resolve('src/lib/studio/editorial-images.json');
const OUTPUT_DIR = resolve('public/images/editorial');
const MAX_EDGE = 2000;
const MAX_BYTES = 450 * 1024;
const QUALITIES = [82, 76, 70, 64, 58];

type ManifestEntry = {
  subject: string;
  file: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  alt: string;
  generated: boolean;
  source: string | null;
  sourceSha256: string | null;
  prompt: string | null;
  importedAt: string | null;
};
type Manifest = { version: number; note: string; images: Record<string, ManifestEntry> };

function option(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index >= 0) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    return value;
  }
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const slot = option(args, '--slot');
  const src = option(args, '--src');
  const version = Number(option(args, '--version') ?? '1');
  if (!slot || !src) throw new Error('usage: --slot <slot> --src <file> [--alt …] [--prompt …]');
  if (!Number.isInteger(version) || version < 1) throw new Error('--version must be 1 or higher');

  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8')) as Manifest;
  const entry = manifest.images[slot];
  if (!entry)
    throw new Error(`unknown slot ${slot} (known: ${Object.keys(manifest.images).join(', ')})`);

  const source = await readFile(resolve(src));
  const sha256 = createHash('sha256').update(source).digest('hex');

  let sharp: typeof import('sharp');
  try {
    sharp = (await import('sharp')).default as unknown as typeof import('sharp');
  } catch {
    throw new Error('sharp is not available (it ships with next); run npm ci first');
  }

  const file = `${slot}-v${version}.webp`;
  const target = resolve(OUTPUT_DIR, file);
  const exists = await stat(target).then(
    () => true,
    () => false,
  );
  if (exists) throw new Error(`${file} already exists; pass --version ${version + 1}`);

  let output: Buffer | null = null;
  let info: { width: number; height: number; size: number } | null = null;
  for (const quality of QUALITIES) {
    const result = await sharp(source)
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 5 })
      .toBuffer({ resolveWithObject: true });
    output = result.data;
    info = { width: result.info.width, height: result.info.height, size: result.info.size };
    if (result.info.size <= MAX_BYTES) break;
  }
  if (!output || !info) throw new Error('could not encode the image');

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(target, output, { flag: 'wx' });

  const alt = option(args, '--alt');
  const prompt = option(args, '--prompt');
  manifest.images[slot] = {
    ...entry,
    file,
    width: info.width,
    height: info.height,
    bytes: info.size,
    alt: alt ?? entry.alt,
    source: basename(src),
    sourceSha256: sha256,
    prompt: prompt ?? entry.prompt,
    importedAt: new Date().toISOString(),
  };
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `✓ ${slot}: public/images/editorial/${file} — ${info.width}×${info.height}, ${Math.round(info.size / 1024)} KB`,
  );
  console.log(`  source ${basename(src)} sha256 ${sha256}`);
  console.log(
    '  next: npm test, then `npm run cms:rollout-aanbod` (dry run) to see which pages get it.',
  );
}

main().catch((error) => {
  console.error('✗ image import failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
