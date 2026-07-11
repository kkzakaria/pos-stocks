import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { organization, user } from "./auth"
import { warehouses } from "./domain"
import { productVariants, lots, suppliers } from "./catalog"

export const MOVEMENT_TYPES = [
  "purchase",
  "sale",
  "transfer_out",
  "transfer_in",
  "adjustment",
  "count",
] as const

export const PURCHASE_STATUSES = ["draft", "received"] as const

// Journal immuable append-only : source de vérité du stock et piste d'audit.
// PAS de onDelete cascade : on ne supprime jamais silencieusement une entité
// référencée par l'audit (et les triggers de 0005_stock_guards bloquent de
// toute façon UPDATE/DELETE sur cette table).
export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    lotId: text("lot_id").references(() => lots.id),
    // > 0 entrée, < 0 sortie — jamais 0
    delta: integer("delta").notNull(),
    type: text("type", { enum: MOVEMENT_TYPES }).notNull(),
    // Motif humain (obligatoire pour les ajustements, côté validation Zod)
    reason: text("reason"),
    // Référence au document source, ex. refType "purchase" + refId purchases.id
    refType: text("ref_type"),
    refId: text("ref_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("stock_movements_org_wh_date_idx").on(
      t.organizationId,
      t.warehouseId,
      t.createdAt
    ),
    index("stock_movements_variant_idx").on(t.variantId),
  ]
)

// Niveaux matérialisés par (entrepôt, variante), recalculables depuis le
// journal. La contrainte CHECK est LA garde anti-stock-négatif atomique :
// dans un db.batch D1 (une transaction SQLite), une violation fait échouer
// le statement et D1 annule le batch ENTIER — contrairement à un
// `UPDATE … WHERE quantity + ? >= 0` qui « réussit » silencieusement avec
// 0 ligne affectée alors que les mouvements, eux, seraient déjà écrits.
export const stockLevels = sqliteTable(
  "stock_levels",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(0),
    // Coût moyen pondéré (CMP), entier XOF, recalculé à chaque réception
    // validée dans le MÊME batch que les mouvements.
    avgCost: integer("avg_cost").notNull().default(0),
    // Surcharge par entrepôt du seuil d'alerte produit
    // (products.default_min_stock) ; NULL = hériter du produit.
    minStock: integer("min_stock"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("stock_levels_wh_variant_uidx").on(t.warehouseId, t.variantId),
    check("stock_levels_quantity_positive", sql`${t.quantity} >= 0`),
  ]
)

// Réception fournisseur : brouillon modifiable → `received` immuable
// (trigger purchases_recu_immuable).
export const purchases = sqliteTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    status: text("status", { enum: PURCHASE_STATUSES })
      .notNull()
      .default("draft"),
    // Référence libre (n° de bon de livraison fournisseur)
    reference: text("reference"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    receivedBy: text("received_by").references(() => user.id),
    receivedAt: integer("received_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("purchases_org_status_idx").on(t.organizationId, t.status)]
)

export const purchaseItems = sqliteTable(
  "purchase_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    purchaseId: text("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    quantity: integer("quantity").notNull(),
    // Coût unitaire d'achat, entier XOF (base du CMP et des marges Phase 7)
    unitCost: integer("unit_cost").notNull(),
    // Saisis à la réception pour les produits trackLots ; le lot n'est créé
    // (ou réutilisé) qu'à la VALIDATION de la réception.
    lotNumber: text("lot_number"),
    expiryDate: integer("expiry_date", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("purchase_items_purchase_idx").on(t.purchaseId)]
)
