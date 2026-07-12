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
    // Posé par le gel des lignes DANS le batch de validation (receive) ;
    // NULL = ligne jamais gelée. Sentinelle du trigger
    // purchases_receive_lignes_gelees (0012) : une ligne insérée par une
    // requête concurrente ENTRE la lecture JS du receive et son batch n'a
    // pas été gelée et bloque la transition draft -> received (même passe
    // corrective que transfers_send_lignes_gelees, 0008 — le sentinel
    // unit_cost NULL n'existe pas ici, unit_cost étant NOT NULL).
    frozenAt: integer("frozen_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("purchase_items_purchase_idx").on(t.purchaseId)]
)

export const TRANSFER_STATUSES = [
  "pending",
  "sent",
  "received",
  "cancelled",
] as const

export const INVENTORY_COUNT_STATUSES = ["open", "closed"] as const

// Transfert inter-entrepôts : pending (brouillon éditable, annulable) →
// sent (stock sorti de l'origine, lignes figées, CMP origine gelé sur
// unit_cost) → received (stock entré à destination, terminal). Terminal
// aussi : cancelled (avant expédition seulement). Immuabilité par triggers
// (0007_transfer_inventory_guards).
export const transfers = sqliteTable(
  "transfers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    fromWarehouseId: text("from_warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    toWarehouseId: text("to_warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    status: text("status", { enum: TRANSFER_STATUSES })
      .notNull()
      .default("pending"),
    // Référence libre (n° de bon de transfert interne)
    reference: text("reference"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    sentBy: text("sent_by").references(() => user.id),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    receivedBy: text("received_by").references(() => user.id),
    receivedAt: integer("received_at", { mode: "timestamp" }),
    cancelledBy: text("cancelled_by").references(() => user.id),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("transfers_org_status_idx").on(t.organizationId, t.status)]
)

export const transferItems = sqliteTable(
  "transfer_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    transferId: text("transfer_id")
      .notNull()
      .references(() => transfers.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    // Lot choisi côté origine (optionnel en brouillon, exigé à l'expédition
    // pour un produit trackLots). Le lot est GLOBAL à la variante
    // (lots_variant_lot_uidx) : le même lotId sert au transfer_in de
    // destination, aucune création de lot côté destination.
    lotId: text("lot_id").references(() => lots.id),
    quantity: integer("quantity").notNull(),
    // CMP de l'entrepôt d'origine, entier XOF, figé PAR SOUS-REQUÊTE SQL
    // dans le batch d'expédition ; null tant que le transfert est pending.
    unitCost: integer("unit_cost"),
    // Quantité acceptée à destination (<= quantity) ; null avant réception.
    receivedQuantity: integer("received_quantity"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("transfer_items_transfer_idx").on(t.transferId)]
)

// Inventaire TOUJOURS COMPLET (v1, spec) : l'ouverture fige une ligne par
// niveau de l'entrepôt (expected_quantity), les comptages s'étalent sur
// plusieurs sessions, la clôture génère les mouvements `count`.
// L'index unique partiel « un seul inventaire ouvert par entrepôt » est posé
// en migration custom 0007 (index partiel : HORS snapshot drizzle).
export const inventoryCounts = sqliteTable(
  "inventory_counts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    status: text("status", { enum: INVENTORY_COUNT_STATUSES })
      .notNull()
      .default("open"),
    openedBy: text("opened_by")
      .notNull()
      .references(() => user.id),
    openedAt: integer("opened_at", { mode: "timestamp" }).notNull(),
    closedBy: text("closed_by").references(() => user.id),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("inventory_counts_org_status_idx").on(t.organizationId, t.status),
  ]
)

export const inventoryCountItems = sqliteTable(
  "inventory_count_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    countId: text("count_id")
      .notNull()
      .references(() => inventoryCounts.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    // Quantité figée à l'ouverture (photographie de stock_levels.quantity)
    expectedQuantity: integer("expected_quantity").notNull(),
    // Quantité comptée ; null = pas encore comptée (ignorée à la clôture)
    countedQuantity: integer("counted_quantity"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("inventory_count_items_count_idx").on(t.countId),
    uniqueIndex("inventory_count_items_count_variant_uidx").on(
      t.countId,
      t.variantId
    ),
  ]
)
