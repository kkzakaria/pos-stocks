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

/** Extract the JSON object printed after the CLI's login banner. */
function extraireJson(raw: string): unknown {
  const debut = raw.indexOf("{")
  if (debut < 0)
    throw new Error(`Sortie Supabase sans JSON : ${raw.slice(0, 200)}`)
  return JSON.parse(raw.slice(debut))
}

export function parseStores(raw: string): StoreSource[] {
  const rows = enveloppe.parse(extraireJson(raw)).rows
  return rows.map((r) => {
    const v = storeRow.parse(r)
    return { id: v.id, name: v.name, address: v.address }
  })
}

export function parseInventaire(raw: string): LigneInventaireSource[] {
  const rows = enveloppe.parse(extraireJson(raw)).rows
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
  return execFileSync(
    "supabase",
    ["db", "query", "--linked", "--workdir", workdir, sql],
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
