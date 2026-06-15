export type NavItem = { title: string; href: string };

/** Primary navigation, shared by the desktop header and mobile sheet. */
export const mainNav: NavItem[] = [
  { title: 'Shop', href: '/shop' },
  { title: 'Blog', href: '/blog' },
  { title: 'About', href: '/about' },
];

export const shopCategories: NavItem[] = [
  { title: 'Road', href: '/shop?category=road' },
  { title: 'Gravel', href: '/shop?category=gravel' },
  { title: 'Accessories', href: '/shop?category=accessory' },
];
