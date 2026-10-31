import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
  check,
} from "drizzle-orm/sqlite-core";
export const sandboxes = sqliteTable(
  "sandboxes",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("sandboxes_token").on(t.tokenHash),
    index("sandboxes_expiry").on(t.expiresAt),
  ],
);
export const products = sqliteTable(
  "products",
  {
    sandboxId: text("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    stock: integer("stock").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sandboxId, t.sku] }),
    check("stock_nonnegative", sql`${t.stock} >= 0`),
  ],
);
export const reservations = sqliteTable(
  "reservations",
  {
    id: text("id").primaryKey(),
    sandboxId: text("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.sandboxId, t.sku],
      foreignColumns: [products.sandboxId, products.sku],
    }),
    uniqueIndex("reservations_key").on(t.sandboxId, t.idempotencyKey),
    index("reservations_stock").on(t.sandboxId, t.sku, t.status, t.expiresAt),
    index("reservations_list").on(t.sandboxId, t.createdAt, t.id),
    check("quantity_positive", sql`${t.quantity} between 1 and 100`),
    check("status_valid", sql`${t.status} in ('held','confirmed','released')`),
  ],
);
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sandboxId: text("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    reservationId: text("reservation_id").notNull(),
    type: text("type").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("events_list").on(t.sandboxId, t.id)],
);
export const quotas = sqliteTable(
  "quotas",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("quotas_expiry").on(t.expiresAt)],
);
