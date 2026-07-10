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

export const productCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis"),
    description: z.string().trim().min(1).optional(),
    categoryId: z.string().min(1).optional(),
    barcode: z.string().trim().min(1).optional(),
    price: z
      .number()
      .int("Le prix doit être un entier")
      .positive("Le prix doit être positif"),
    minPrice: z
      .number()
      .int("Le prix plancher doit être un entier")
      .positive("Le prix plancher doit être positif")
      .optional(),
    defaultMinStock: z.number().int().nonnegative().optional(),
    trackLots: z.boolean().optional(),
    sku: z.string().trim().min(1).optional(),
  })
  .refine((v) => v.minPrice === undefined || v.minPrice <= v.price, {
    message: "Le prix plancher doit être inférieur ou égal au prix de vente",
    path: ["minPrice"],
  })

export const productUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis").optional(),
    description: z.string().trim().min(1).nullable().optional(),
    categoryId: z.string().min(1).nullable().optional(),
    barcode: z.string().trim().min(1).nullable().optional(),
    price: z
      .number()
      .int("Le prix doit être un entier")
      .positive("Le prix doit être positif")
      .optional(),
    minPrice: z
      .number()
      .int("Le prix plancher doit être un entier")
      .positive("Le prix plancher doit être positif")
      .nullable()
      .optional(),
    defaultMinStock: z.number().int().nonnegative().nullable().optional(),
    trackLots: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })
  .refine(
    (v) =>
      v.price === undefined ||
      v.minPrice === undefined ||
      v.minPrice === null ||
      v.minPrice <= v.price,
    {
      message: "Le prix plancher doit être inférieur ou égal au prix de vente",
      path: ["minPrice"],
    }
  )

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>
export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>
export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
