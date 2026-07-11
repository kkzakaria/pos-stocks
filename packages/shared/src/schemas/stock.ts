import { z } from "zod"

export const adjustmentCreateSchema = z.object({
  variantId: z.string().min(1, "La variante est requise"),
  delta: z
    .number()
    .int("Le delta doit être un entier")
    .refine((v) => v !== 0, "Le delta ne peut pas être nul"),
  reason: z.string().trim().min(1, "Le motif est requis"),
  lotId: z.string().min(1).optional(),
})

export const minStockSchema = z.object({
  minStock: z
    .number()
    .int("Le seuil doit être un entier")
    .nonnegative("Le seuil doit être positif ou nul")
    .nullable(),
})

export type AdjustmentCreateInput = z.infer<typeof adjustmentCreateSchema>
export type MinStockInput = z.infer<typeof minStockSchema>

const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/

export const purchaseCreateSchema = z.object({
  warehouseId: z.string().min(1, "L'entrepôt est requis"),
  supplierId: z.string().min(1, "Le fournisseur est requis"),
  reference: z.string().trim().min(1).optional(),
})

export const purchaseItemCreateSchema = z.object({
  variantId: z.string().min(1, "La variante est requise"),
  quantity: z
    .number()
    .int("La quantité doit être un entier")
    .positive("La quantité doit être positive"),
  unitCost: z
    .number()
    .int("Le coût unitaire doit être un entier")
    .nonnegative("Le coût unitaire doit être positif ou nul"),
  lotNumber: z.string().trim().min(1).optional(),
  expiryDate: z
    .string()
    .regex(MOTIF_JOUR, "Date de péremption invalide (AAAA-MM-JJ)")
    .optional(),
})

export const purchaseItemUpdateSchema = z
  .object({
    quantity: z
      .number()
      .int("La quantité doit être un entier")
      .positive("La quantité doit être positive")
      .optional(),
    unitCost: z
      .number()
      .int("Le coût unitaire doit être un entier")
      .nonnegative("Le coût unitaire doit être positif ou nul")
      .optional(),
    lotNumber: z.string().trim().min(1).nullable().optional(),
    expiryDate: z
      .string()
      .regex(MOTIF_JOUR, "Date de péremption invalide (AAAA-MM-JJ)")
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })

export type PurchaseCreateInput = z.infer<typeof purchaseCreateSchema>
export type PurchaseItemCreateInput = z.infer<typeof purchaseItemCreateSchema>
export type PurchaseItemUpdateInput = z.infer<typeof purchaseItemUpdateSchema>
