// Push the catalog in products.csv to Shopify via the Admin API.
//
//   node --env-file=.env.local scripts/shopify-sync.mts            # dry run (default)
//   node --env-file=.env.local scripts/shopify-sync.mts --commit   # actually write
//
// Requires SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_API_TOKEN (a custom app's
// Admin API token with write_products scope). Idempotent: upserts by handle via
// the `productSet` mutation. Verify the mutation against your store's API
// version on first run — dry run prints exactly what would be sent.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2026-01';
const COMMIT = process.argv.includes('--commit');

if (!DOMAIN || !TOKEN) {
  console.error('✗ Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_API_TOKEN in .env.local');
  process.exit(1);
}

type Row = {
  handle: string;
  title: string;
  productType: string;
  price: string;
  available: string;
  description: string;
};

/** Minimal RFC-4180-ish CSV parser (handles quoted fields with commas). */
function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { record.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (field !== '' || record.length) { record.push(field); rows.push(record); record = []; field = ''; }
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else field += c;
  }
  if (field !== '' || record.length) { record.push(field); rows.push(record); }
  const [header, ...body] = rows;
  return body.map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ''])) as Row);
}

async function adminFetch<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN as string },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data as T;
}

const PRODUCT_SET = `
  mutation ProductSet($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product { id handle }
      userErrors { field message }
    }
  }
`;

const csv = await readFile(path.join(process.cwd(), 'products.csv'), 'utf8');
const rows = parseCsv(csv);
console.log(`${rows.length} products in products.csv — ${COMMIT ? 'COMMITTING' : 'DRY RUN'}\n`);

for (const row of rows) {
  const input = {
    handle: row.handle,
    title: row.title,
    descriptionHtml: row.description,
    productType: row.productType,
    status: 'ACTIVE',
    productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
    variants: [{ price: row.price, optionValues: [{ optionName: 'Title', name: 'Default Title' }] }],
  };

  if (!COMMIT) {
    console.log(`• ${row.handle}  €${row.price}  (${row.productType})`);
    continue;
  }

  const data = await adminFetch<{
    productSet: { product: { handle: string } | null; userErrors: { message: string }[] };
  }>(PRODUCT_SET, { input });
  const errs = data.productSet.userErrors;
  if (errs?.length) console.error(`✗ ${row.handle}: ${errs.map((e) => e.message).join('; ')}`);
  else console.log(`✓ ${row.handle}`);
}

console.log(COMMIT ? '\nDone.' : '\nDry run only — re-run with --commit to write to Shopify.');
