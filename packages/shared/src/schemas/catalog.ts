import { z } from "zod"

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  parentId: z.string().min(1).optional(),
})

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis").optional(),
    parentId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })

export const supplierCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  contact: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(1).optional(),
})

export const supplierUpdateSchema = supplierCreateSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>
export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>
