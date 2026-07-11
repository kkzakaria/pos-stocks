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
