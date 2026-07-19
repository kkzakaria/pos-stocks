import { warehouseCreateSchema } from "shared"
import type { WarehouseCreateInput } from "shared"
import type { StoreSource } from "./supabase-source"

export const NOM_FOURNISSEUR = "Stock initial (import Supabase)"

export function construireMagasinCible(
  source: StoreSource
): WarehouseCreateInput {
  const adresse = source.address?.trim()
  const payload: WarehouseCreateInput = {
    name: source.name,
    type: "store",
    ...(adresse ? { address: adresse } : {}),
  }
  // Validate against the real target schema: a mapping regression fails here
  // rather than confusingly against the API during the real prod run.
  return warehouseCreateSchema.parse(payload)
}
