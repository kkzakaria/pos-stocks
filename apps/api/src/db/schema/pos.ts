import {
  sqliteTable,
  text,
  integer,
  index,
  check,
} from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { organization, user } from "./auth"
import { warehouses } from "./domain"
import { productVariants, lots } from "./catalog"

export const REGISTER_SESSION_STATUSES = ["open", "closed"] as const
// `refunded` RÉSERVÉ v2 (spec §3) : aucune route ne le pose ; les triggers
// 0014 rendent la vente totalement immuable — ouvrir la transition
// completed -> refunded se fera par une NOUVELLE migration.
export const SALE_STATUSES = ["completed", "refunded"] as const
export const PAYMENT_METHODS = ["cash", "mobile_money"] as const

// Session de caisse (spec §3) : obligatoire pour vendre. « Une seule session
// ouverte par (boutique, caissier) » = index unique PARTIEL posé en
// migration custom 0014 (HORS snapshot). Fermée = immuable (trigger
// register_sessions_fermee_immuable) : la double fermeture concurrente meurt
// en base, comme les documents des phases 4/5.
export const registerSessions = sqliteTable(
  "register_sessions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    storeId: text("store_id")
      .notNull()
      .references(() => warehouses.id),
    cashierId: text("cashier_id")
      .notNull()
      .references(() => user.id),
    status: text("status", { enum: REGISTER_SESSION_STATUSES })
      .notNull()
      .default("open"),
    // Fond de caisse à l'ouverture, entier XOF
    openingFloat: integer("opening_float").notNull(),
    // Montant compté à la fermeture ; null tant que la session est ouverte
    countedAmount: integer("counted_amount"),
    // Attendu figé à la fermeture : fond + encaissements cash nets de la
    // session — calculé PAR SOUS-REQUÊTE SQL dans l'UPDATE de fermeture
    // (jamais une valeur lue en JS : pas de course avec une vente tardive).
    expectedCash: integer("expected_cash"),
    // Écart = compté − attendu ; null tant que la session est ouverte
    difference: integer("difference"),
    openedAt: integer("opened_at", { mode: "timestamp" }).notNull(),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    closedBy: text("closed_by").references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("register_sessions_org_status_idx").on(t.organizationId, t.status),
    index("register_sessions_store_idx").on(t.storeId),
  ]
)

// Vente : document TERMINAL dès sa création (`completed`), immuable par
// triggers 0014 — PAS de onDelete cascade : on ne supprime jamais une pièce
// d'audit. Numéro de ticket séquentiel PAR BOUTIQUE (sous-requête MAX+1 dans
// le batch de création, index unique 0014 en ceinture) ; idempotence par
// client_request_id (index unique 0014, décision 5 du plan).
export const sales = sqliteTable(
  "sales",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    storeId: text("store_id")
      .notNull()
      .references(() => warehouses.id),
    registerSessionId: text("register_session_id")
      .notNull()
      .references(() => registerSessions.id),
    cashierId: text("cashier_id")
      .notNull()
      .references(() => user.id),
    ticketNumber: integer("ticket_number").notNull(),
    // Somme des lignes (quantité × prix appliqué), entier XOF
    total: integer("total").notNull(),
    // Devise de l'organisation FIGÉE au moment de la vente
    currency: text("currency").notNull(),
    status: text("status", { enum: SALE_STATUSES })
      .notNull()
      .default("completed"),
    // Identifiant d'idempotence généré côté client (spec §8)
    clientRequestId: text("client_request_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("sales_org_store_date_idx").on(
      t.organizationId,
      t.storeId,
      t.createdAt
    ),
    index("sales_session_idx").on(t.registerSessionId),
  ]
)

export const saleItems = sqliteTable(
  "sale_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    // Lot déduit par FEFO quand l'allocation tient sur UN seul lot ; NULL si
    // la ligne a puisé dans plusieurs lots (le détail exact est au journal —
    // décision 3 du plan).
    lotId: text("lot_id").references(() => lots.id),
    // Entrepôt d'où SORT le stock : la boutique par défaut, un autre
    // entrepôt en dépannage (spec §5, décision 7).
    sourceWarehouseId: text("source_warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    quantity: integer("quantity").notNull(),
    // Prix unitaire APPLIQUÉ (négocié, borné par le plancher — décision 8)
    unitPrice: integer("unit_price").notNull(),
    // Prix catalogue au moment de la vente : la remise consentie s'en déduit
    // (rapports Phase 7)
    catalogPrice: integer("catalog_price").notNull(),
    // CMP de l'entrepôt SOURCE figé au moment exact de la vente (spec §3,
    // Phase 7) : posé par sous-requête SQL DANS l'INSERT du batch de vente
    // (routes/sales.ts) — même mécanisme que le gel du CMP à l'expédition
    // des transferts. NULL = vente antérieure à la colonne : les rapports
    // la valorisent au CMP courant et la marquent « estimé ».
    unitCost: integer("unit_cost"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("sale_items_sale_idx").on(t.saleId),
    check("sale_items_quantity_positive", sql`${t.quantity} > 0`),
  ]
)

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    // Part du TOTAL réglée par ce paiement (la somme des payments d'une
    // vente = sales.total ; paiement mixte = plusieurs lignes)
    amount: integer("amount").notNull(),
    // Référence de transaction mobile money (exigée côté validation Zod)
    reference: text("reference"),
    // Cash : montant tendu par le client et monnaie rendue (informationnel,
    // sert au ticket et au contrôle de caisse)
    receivedAmount: integer("received_amount"),
    changeGiven: integer("change_given"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("payments_sale_idx").on(t.saleId)]
)
