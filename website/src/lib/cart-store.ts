'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem } from './types';

export type { CartItem };

type CartState = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void;
  removeItem: (variantId: string) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  clear: () => void;
};

/**
 * Client-side cart, persisted to localStorage and keyed by Shopify variant id.
 * On checkout these lines are sent to Shopify, which creates the authoritative
 * cart and recomputes pricing — never trust these amounts for charging.
 */
export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item, quantity = 1) =>
        set((state) => {
          const existing = state.items.find((i) => i.variantId === item.variantId);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.variantId === item.variantId ? { ...i, quantity: i.quantity + quantity } : i,
              ),
            };
          }
          return { items: [...state.items, { ...item, quantity }] };
        }),
      removeItem: (variantId) =>
        set((state) => ({ items: state.items.filter((i) => i.variantId !== variantId) })),
      setQuantity: (variantId, quantity) =>
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((i) => i.variantId !== variantId)
              : state.items.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)),
        })),
      clear: () => set({ items: [] }),
    }),
    { name: 'qarakter-cart' },
  ),
);

export const selectTotalItems = (s: CartState) =>
  s.items.reduce((sum, i) => sum + i.quantity, 0);

export const selectTotalPrice = (s: CartState) =>
  s.items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
