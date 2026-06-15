import { pgTable, text, timestamp, integer, boolean, decimal } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users (synced securely via Clerk webhooks — id matches the Clerk user id)
export const users = pgTable('users', {
  id: text('id').primaryKey(), // Matches Clerk User ID
  email: text('email').notNull().unique(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Products (Bikes & Accessories)
export const products = pgTable('products', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  stockCount: integer('stock_count').default(0).notNull(),
  category: text('category').notNull(), // e.g. 'road', 'gravel', 'accessory'
  imageUrl: text('image_url'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Orders
export const orders = pgTable('orders', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').references(() => users.id), // Nullable for guest checkouts
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  status: text('status').default('pending').notNull(), // pending, paid, shipped, cancelled
  stripeSessionId: text('stripe_session_id'),
  shippingAddress: text('shipping_address').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Order Items (join table between orders and products)
export const orderItems = pgTable('order_items', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  orderId: text('order_id')
    .references(() => orders.id)
    .notNull(),
  productId: text('product_id')
    .references(() => products.id)
    .notNull(),
  quantity: integer('quantity').notNull(),
  priceAtPurchase: decimal('price_at_purchase', { precision: 10, scale: 2 }).notNull(),
});

// ---- Relations ----

export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
}));

export const productsRelations = relations(products, ({ many }) => ({
  orderItems: many(orderItems),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

// ---- Inferred types (use throughout the app instead of redefining shapes) ----

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
