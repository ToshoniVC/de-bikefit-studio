import type { Product } from './types';

/**
 * Development fallback catalog, used only until Shopify is configured. Mirrors
 * the normalized `Product` shape. Images are null so the UI renders a branded
 * icon placeholder rather than a stock photo.
 */
export const sampleProducts: Product[] = [
  {
    id: 'sample-road-aero-1',
    slug: 'qarakter-aero-rs',
    name: 'Qarakter Aero RS',
    description:
      'A wind-tunnel-shaped carbon race frame built for the rider who measures every watt. Integrated cockpit, electronic groupset ready.',
    price: '4299.00',
    currencyCode: 'EUR',
    imageUrl: null,
    category: 'road',
    availableForSale: true,
    variantId: 'sample-variant-aero-rs',
  },
  {
    id: 'sample-gravel-1',
    slug: 'qarakter-gravel-x',
    name: 'Qarakter Gravel X',
    description:
      'One bike for the commute, the bikepacking trip and the Sunday gravel grind. Clearance for 50mm tyres and mounts everywhere.',
    price: '3199.00',
    currencyCode: 'EUR',
    imageUrl: null,
    category: 'gravel',
    availableForSale: true,
    variantId: 'sample-variant-gravel-x',
  },
  {
    id: 'sample-road-endurance-1',
    slug: 'qarakter-endure',
    name: 'Qarakter Endure',
    description:
      'Endurance geometry tuned for long days in the saddle. Compliant rear triangle, hidden mudguard mounts, all-road tyre clearance.',
    price: '2799.00',
    currencyCode: 'EUR',
    imageUrl: null,
    category: 'road',
    availableForSale: false,
    variantId: 'sample-variant-endure',
  },
  {
    id: 'sample-accessory-helmet-1',
    slug: 'qarakter-aero-helmet',
    name: 'Qarakter Aero Helmet',
    description:
      'Featherweight aero road helmet with adjustable venting. MIPS protection, 270g, dialled-in fit system.',
    price: '189.00',
    currencyCode: 'EUR',
    imageUrl: null,
    category: 'accessory',
    availableForSale: true,
    variantId: 'sample-variant-helmet',
  },
  {
    id: 'sample-accessory-bottle-1',
    slug: 'qarakter-bidon',
    name: 'Qarakter Bidon (2-pack)',
    description:
      'BPA-free 650ml bidons with a high-flow valve and the Qarakter mark. Sold as a pair.',
    price: '24.00',
    currencyCode: 'EUR',
    imageUrl: null,
    category: 'accessory',
    availableForSale: true,
    variantId: 'sample-variant-bidon',
  },
];
