'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CartItem = {
  productId: string;
  slug: string;
  name: string;
  /** Unit price as a decimal string, mirroring the DB column. */
  price: string;
  quantity: number;
  imageUrl: string | null;
};

type CartState = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void;
  removeItem: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clear: () => void;
};

/**
 * Client-side cart, persisted to localStorage. Server-authoritative pricing is
 * recomputed at checkout — never trust these amounts for charging.
 */
export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item, quantity = 1) =>
        set((state) => {
          const existing = state.items.find((i) => i.productId === item.productId);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.productId === item.productId ? { ...i, quantity: i.quantity + quantity } : i,
              ),
            };
          }
          return { items: [...state.items, { ...item, quantity }] };
        }),
      removeItem: (productId) =>
        set((state) => ({ items: state.items.filter((i) => i.productId !== productId) })),
      setQuantity: (productId, quantity) =>
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((i) => i.productId !== productId)
              : state.items.map((i) => (i.productId === productId ? { ...i, quantity } : i)),
        })),
      clear: () => set({ items: [] }),
    }),
    { name: 'qarakter-cart' },
  ),
);

/** Derived selectors — call with the hook, e.g. `useCart(selectTotalItems)`. */
export const selectTotalItems = (s: CartState) =>
  s.items.reduce((sum, i) => sum + i.quantity, 0);

export const selectTotalPrice = (s: CartState) =>
  s.items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
