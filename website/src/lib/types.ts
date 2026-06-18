/**
 * Normalized domain types for the storefront. These decouple the UI from the
 * Shopify Storefront API's GraphQL shape — `src/lib/shopify.ts` maps Shopify
 * responses into these, and components only ever see this.
 */

export type Product = {
  /** Shopify product GID, e.g. gid://shopify/Product/123 */
  id: string;
  /** Shopify handle — used as the URL slug */
  slug: string;
  name: string;
  description: string;
  /** Minimum variant price as a decimal string, e.g. "4299.00" */
  price: string;
  currencyCode: string;
  imageUrl: string | null;
  /** Product type or primary collection, used for filtering */
  category: string;
  availableForSale: boolean;
  /** Default variant (merchandise) GID, needed to add to a Shopify cart */
  variantId: string | null;
};

export type CartItem = {
  /** Shopify variant (merchandise) GID — the line item identity */
  variantId: string;
  productId: string;
  slug: string;
  name: string;
  price: string;
  imageUrl: string | null;
  quantity: number;
};
