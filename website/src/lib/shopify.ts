import 'server-only';
import type { Product } from './types';
import { sampleProducts } from './sample-products';

/**
 * Shopify Storefront API client (headless commerce).
 *
 * Products/collections/cart come from Shopify; the rest of the site is plain
 * Next.js. Until the store is configured, product reads fall back to the in-repo
 * `sampleProducts` fixture so the site stays runnable.
 *
 * The Storefront access token is a *public* token by design, but we keep calls
 * server-side and never expose the Admin API here.
 */
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN; // e.g. your-store.myshopify.com
const TOKEN = process.env.SHOPIFY_STOREFRONT_API_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2026-01';

export const isShopifyConfigured = Boolean(DOMAIN && TOKEN);

const endpoint = DOMAIN ? `https://${DOMAIN}/api/${API_VERSION}/graphql.json` : '';

type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

async function shopifyFetch<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  if (!isShopifyConfigured) {
    throw new Error('Shopify is not configured (set SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_API_TOKEN).');
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': TOKEN as string,
    },
    body: JSON.stringify({ query, variables }),
    // Cache product reads briefly; revalidate so price/stock changes propagate.
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    throw new Error(`Shopify request failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  return json.data as T;
}

// ---- Product mapping ----

type ShopifyProduct = {
  id: string;
  handle: string;
  title: string;
  description: string;
  productType: string;
  availableForSale: boolean;
  featuredImage: { url: string; altText: string | null } | null;
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
  variants: { edges: { node: { id: string } }[] };
};

const PRODUCT_FRAGMENT = `
  fragment ProductFields on Product {
    id
    handle
    title
    description
    productType
    availableForSale
    featuredImage { url altText }
    priceRange { minVariantPrice { amount currencyCode } }
    variants(first: 1) { edges { node { id } } }
  }
`;

function mapProduct(p: ShopifyProduct): Product {
  return {
    id: p.id,
    slug: p.handle,
    name: p.title,
    description: p.description,
    price: p.priceRange.minVariantPrice.amount,
    currencyCode: p.priceRange.minVariantPrice.currencyCode,
    imageUrl: p.featuredImage?.url ?? null,
    category: p.productType || 'other',
    availableForSale: p.availableForSale,
    variantId: p.variants.edges[0]?.node.id ?? null,
  };
}

// ---- Public read helpers (used by Server Components) ----

export async function getProducts(category?: string): Promise<Product[]> {
  if (!isShopifyConfigured) {
    return category ? sampleProducts.filter((p) => p.category === category) : sampleProducts;
  }
  const data = await shopifyFetch<{ products: { edges: { node: ShopifyProduct }[] } }>(
    `${PRODUCT_FRAGMENT}
     query Products($query: String) {
       products(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
         edges { node { ...ProductFields } }
       }
     }`,
    { query: category ? `product_type:${category}` : undefined },
  );
  return data.products.edges.map((e) => mapProduct(e.node));
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  if (!isShopifyConfigured) {
    return sampleProducts.find((p) => p.slug === slug) ?? null;
  }
  const data = await shopifyFetch<{ product: ShopifyProduct | null }>(
    `${PRODUCT_FRAGMENT}
     query Product($handle: String!) {
       product(handle: $handle) { ...ProductFields }
     }`,
    { handle: slug },
  );
  return data.product ? mapProduct(data.product) : null;
}

// ---- Cart / checkout ----

export type CartLine = { variantId: string; quantity: number };

/**
 * Create a Shopify cart and return the hosted checkout URL. The browser is
 * redirected there to complete payment (Shopify handles PCI, tax, shipping).
 */
export async function createCartCheckoutUrl(lines: CartLine[]): Promise<string | null> {
  if (!isShopifyConfigured || lines.length === 0) return null;
  const data = await shopifyFetch<{
    cartCreate: { cart: { checkoutUrl: string } | null; userErrors: { message: string }[] };
  }>(
    `mutation CartCreate($lines: [CartLineInput!]!) {
       cartCreate(input: { lines: $lines }) {
         cart { checkoutUrl }
         userErrors { message }
       }
     }`,
    {
      lines: lines.map((l) => ({ merchandiseId: l.variantId, quantity: l.quantity })),
    },
  );
  if (data.cartCreate.userErrors?.length) {
    throw new Error(data.cartCreate.userErrors.map((e) => e.message).join('; '));
  }
  return data.cartCreate.cart?.checkoutUrl ?? null;
}
