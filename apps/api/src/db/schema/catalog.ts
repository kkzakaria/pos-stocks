import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"
import { organization } from "./auth"

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Auto-référence : le type de retour explicite AnySQLiteColumn est requis
  // par TypeScript pour casser la circularité.
  parentId: text("parent_id").references((): AnySQLiteColumn => categories.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
})

export const suppliers = sqliteTable("suppliers", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contact: text("contact"),
  phone: text("phone"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
})

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    price: integer("price").notNull(),
    minPrice: integer("min_price"),
    defaultMinStock: integer("default_min_stock"),
    hasVariants: integer("has_variants", { mode: "boolean" })
      .notNull()
      .default(false),
    trackLots: integer("track_lots", { mode: "boolean" })
      .notNull()
      .default(false),
    imageKey: text("image_key"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("products_org_sku_uidx").on(t.organizationId, t.sku)]
)

export const productVariants = sqliteTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    // « Standard » pour la variante implicite, sinon p. ex. « M / Rouge »
    name: text("name").notNull(),
    attributes: text("attributes").notNull().default("{}"),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    priceOverride: integer("price_override"),
    minPriceOverride: integer("min_price_override"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("product_variants_org_sku_uidx").on(t.organizationId, t.sku),
  ]
)

export const lots = sqliteTable(
  "lots",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    lotNumber: text("lot_number").notNull(),
    expiryDate: integer("expiry_date", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("lots_variant_lot_uidx").on(t.variantId, t.lotNumber)]
)
