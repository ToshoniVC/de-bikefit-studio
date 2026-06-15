import type { Product } from '@/db/schema';

/**
 * Development seed / fallback catalog. Mirrors the `products` table shape so it
 * can be served by the data layer before Neon is provisioned, and reused as
 * seed data once it is. Images are intentionally null — the UI renders a
 * branded icon placeholder rather than a stock photo.
 */
export const sampleProducts: Product[] = [
  {
    id: 'sample-road-aero-1',
    slug: 'qarakter-aero-rs',
    name: 'Qarakter Aero RS',
    description:
      'A wind-tunnel-shaped carbon race frame built for the rider who measures every watt. Integrated cockpit, electronic groupset ready.',
    price: '4299.00',
    stockCount: 4,
    category: 'road',
    imageUrl: null,
    isActive: true,
    createdAt: new Date('2026-01-15T09:00:00Z'),
  },
  {
    id: 'sample-gravel-1',
    slug: 'qarakter-gravel-x',
    name: 'Qarakter Gravel X',
    description:
      'One bike for the commute, the bikepacking trip and the Sunday gravel grind. Clearance for 50mm tyres and mounts everywhere.',
    price: '3199.00',
    stockCount: 7,
    category: 'gravel',
    imageUrl: null,
    isActive: true,
    createdAt: new Date('2026-02-02T09:00:00Z'),
  },
  {
    id: 'sample-road-endurance-1',
    slug: 'qarakter-endure',
    name: 'Qarakter Endure',
    description:
      'Endurance geometry tuned for long days in the saddle. Compliant rear triangle, hidden mudguard mounts, all-road tyre clearance.',
    price: '2799.00',
    stockCount: 0,
    category: 'road',
    imageUrl: null,
    isActive: true,
    createdAt: new Date('2026-02-20T09:00:00Z'),
  },
  {
    id: 'sample-accessory-helmet-1',
    slug: 'qarakter-aero-helmet',
    name: 'Qarakter Aero Helmet',
    description:
      'Featherweight aero road helmet with adjustable venting. MIPS protection, 270g, dialled-in fit system.',
    price: '189.00',
    stockCount: 23,
    category: 'accessory',
    imageUrl: null,
    isActive: true,
    createdAt: new Date('2026-03-05T09:00:00Z'),
  },
  {
    id: 'sample-accessory-bottle-1',
    slug: 'qarakter-bidon',
    name: 'Qarakter Bidon (2-pack)',
    description:
      'BPA-free 650ml bidons with a high-flow valve and the Qarakter mark. Sold as a pair.',
    price: '24.00',
    stockCount: 120,
    category: 'accessory',
    imageUrl: null,
    isActive: true,
    createdAt: new Date('2026-03-18T09:00:00Z'),
  },
];
