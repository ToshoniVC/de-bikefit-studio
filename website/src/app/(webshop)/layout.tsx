import type { Metadata } from 'next';
import { WebshopChrome, webshopMetadata } from '@/components/shell/webshop-chrome';

/**
 * Qarakter webshop chrome for `/webshop` (the old `/` home page, moved
 * verbatim) and `/account`.
 *
 * `/account` moved from `src/app/account/` into this group so that the layout
 * sits in a *parent* segment: a `title.template` never applies to a page in the
 * same segment as the layout declaring it, which would have dropped the
 * "· Qarakter" suffix from the account page's title. The URL is unchanged —
 * `(webshop)` is a route group.
 *
 * The pages themselves are untouched. See
 * `src/components/shell/webshop-chrome.tsx`.
 */
export const metadata: Metadata = webshopMetadata;

export default function WebshopGroupLayout({ children }: { children: React.ReactNode }) {
  return <WebshopChrome>{children}</WebshopChrome>;
}
