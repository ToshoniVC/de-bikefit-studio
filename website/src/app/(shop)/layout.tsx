import type { Metadata } from 'next';
import { WebshopChrome, webshopMetadata } from '@/components/shell/webshop-chrome';

/**
 * Qarakter webshop chrome for `/shop` and `/checkout`.
 * Added when `/` became the Bikefit Studio site; the pages themselves are
 * untouched. See `src/components/shell/webshop-chrome.tsx`.
 */
export const metadata: Metadata = webshopMetadata;

export default function ShopGroupLayout({ children }: { children: React.ReactNode }) {
  return <WebshopChrome>{children}</WebshopChrome>;
}
