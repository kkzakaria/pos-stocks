import { z } from "zod"

export const warehouseCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  type: z.enum(["warehouse", "store"], { message: "Type invalide" }),
  address: z.string().trim().min(1).optional(),
})

export const warehouseUpdateSchema = warehouseCreateSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })

export type WarehouseCreateInput = z.infer<typeof warehouseCreateSchema>
export type WarehouseUpdateInput = z.infer<typeof warehouseUpdateSchema>
