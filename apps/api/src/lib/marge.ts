import { sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import * as schema from "../db/schema"

// Shared cost/margin SQL for sales. Kept in one place so the margins report
// (routes/reports.ts) and the per-sale margin (routes/sales.ts) can never drift
// apart. Both aggregate over sale_items LEFT-joined with the line's stock level.

// Frozen unit cost of a sale line: the cost captured at sale time
// (sale_items.unit_cost), falling back to the level's CURRENT weighted-average
// cost for legacy lines predating the column (unit_cost NULL), then 0.
const coutUnitaireFige: SQL = sql`COALESCE(${schema.saleItems.unitCost}, ${schema.stockLevels.avgCost}, 0)`

// Aggregate cost of sale lines = Σ quantity × frozen unit cost.
export const coutVenteAgrege = sql<number>`COALESCE(SUM(${schema.saleItems.quantity} * ${coutUnitaireFige}), 0)`

// Number of lines valued at the current CMP (unit_cost NULL). A non-zero count
// means the margin is an estimate rather than a frozen figure.
export const lignesEstimeesAgrege = sql<number>`COALESCE(SUM(CASE WHEN ${schema.saleItems.unitCost} IS NULL THEN 1 ELSE 0 END), 0)`
