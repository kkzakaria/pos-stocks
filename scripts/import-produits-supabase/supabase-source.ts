import { execFileSync } from "node:child_process"
import type {} from "zod"
import { z } from "zod"

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
  cost: z.number().nullable(),
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
      cost: v.cost,
    }
  })
}

function requeter(sql: string, projet?: string): string {
  const args = ["db", "query", "--linked", sql]
  if (projet) args.push("--project-ref", projet)
  return execFileSync("supabase", args, {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  })
}

export function lireStores(projet?: string): StoreSource[] {
  return parseStores(
    requeter("select id, name, address from stores order by created_at", projet)
  )
}

export function lireInventaire(projet?: string): LigneInventaireSource[] {
  return parseInventaire(
    requeter(
      "select pt.sku as sku, pi.store_id as store_id, pi.quantity as quantity, pt.cost as cost " +
        "from product_inventory pi join product_templates pt on pt.id = pi.product_id " +
        "where pi.quantity > 0",
      projet
    )
  )
}
