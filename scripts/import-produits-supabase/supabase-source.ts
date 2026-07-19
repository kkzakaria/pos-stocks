import { execFileSync } from "node:child_process"
import path from "node:path"
import { z } from "zod"

// The linked Supabase project resolves from a repo that holds the supabase/
// config (the main pos-stocks checkout). From a nested script directory the
// CLI cannot walk up to it, so every query passes --workdir explicitly.
// Default: the worktree root (two levels up from this module), which is nested
// inside that repo and therefore resolves the link.
const RACINE_SUPABASE_DEFAUT = path.resolve(import.meta.dir, "..", "..")

export interface StoreSource {
  id: string
  name: string
  address: string | null
}

export interface LigneInventaireSource {
  sku: string
  storeId: string
  quantity: number
  cost: number | null
}

const storeRow = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  address: z.string().nullable(),
})
const inventaireRow = z.object({
  sku: z.string().min(1),
  store_id: z.string().min(1),
  quantity: z.number(),
  // Postgres `numeric` columns are serialized as STRINGS by `supabase db
  // query` (to preserve arbitrary precision), unlike `integer` columns which
  // come as numbers. `cost` is numeric, so accept both and coerce below.
  cost: z.union([z.number(), z.string()]).nullable(),
})
const enveloppe = z.object({ rows: z.array(z.unknown()) })

/**
 * Extracts result rows from a `supabase db query` output. The CLI wraps them
 * differently by mode: agent mode prints `{ boundary, rows: [...] }`,
 * interactive mode a bare `[...]` array. Skip the leading login banner (start
 * at the first `{` or `[`), parse, and normalize both shapes to a row array.
 */
function extraireRows(raw: string): unknown[] {
  const indices = [raw.indexOf("{"), raw.indexOf("[")].filter((i) => i >= 0)
  if (indices.length === 0) {
    throw new Error(`Sortie Supabase sans JSON : ${raw.slice(0, 200)}`)
  }
  const parsed: unknown = JSON.parse(raw.slice(Math.min(...indices)))
  if (Array.isArray(parsed)) return parsed
  return enveloppe.parse(parsed).rows
}

export function parseStores(raw: string): StoreSource[] {
  const rows = extraireRows(raw)
  return rows.map((r) => {
    const v = storeRow.parse(r)
    return { id: v.id, name: v.name, address: v.address }
  })
}

export function parseInventaire(raw: string): LigneInventaireSource[] {
  const rows = extraireRows(raw)
  return rows.map((r) => {
    const v = inventaireRow.parse(r)
    return {
      sku: v.sku,
      storeId: v.store_id,
      quantity: v.quantity,
      cost: v.cost === null ? null : Number(v.cost),
    }
  })
}

function requeter(
  sql: string,
  workdir: string = RACINE_SUPABASE_DEFAUT
): string {
  // Force agent mode + JSON output: interactively (TTY) the CLI defaults to an
  // ASCII table, and even --output-format json yields a differently-shaped
  // bare array there. --agent yes pins the deterministic { boundary, rows: [] }
  // envelope regardless of who runs the command (extraireRows handles both).
  return execFileSync(
    "supabase",
    [
      "db",
      "query",
      "--linked",
      "--workdir",
      workdir,
      "--agent",
      "yes",
      "--output-format",
      "json",
      sql,
    ],
    {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    }
  )
}

export function lireStores(workdir?: string): StoreSource[] {
  return parseStores(
    requeter(
      "select id, name, address from stores order by created_at",
      workdir
    )
  )
}

export function lireInventaire(workdir?: string): LigneInventaireSource[] {
  return parseInventaire(
    requeter(
      "select pt.sku as sku, pi.store_id as store_id, pi.quantity as quantity, pt.cost as cost " +
        "from product_inventory pi join product_templates pt on pt.id = pi.product_id " +
        "where pi.quantity > 0 " +
        // Deterministic order: chunk boundaries (and thus the resume-by-chunk
        // -index journal) must be stable across runs, so a crashed run resumes
        // on identical chunks. Without ORDER BY, Postgres row order is undefined.
        "order by pt.sku, pi.store_id",
      workdir
    )
  )
}
