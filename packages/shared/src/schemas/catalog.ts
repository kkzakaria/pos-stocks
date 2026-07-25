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

// Objet explicite (et non .partial() du create) : contact et phone doivent
// accepter null pour pouvoir être VIDÉS via PATCH.
export const supplierUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis").optional(),
    contact: z.string().trim().min(1).nullable().optional(),
    phone: z.string().trim().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })

export const variantCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  attributes: z.record(z.string(), z.string().trim().min(1)).default({}),
  barcode: z.string().trim().min(1).optional(),
  priceOverride: z
    .number()
    .int("Le prix doit être un entier")
    .positive("Le prix doit être positif")
    .optional(),
  minPriceOverride: z
    .number()
    .int("Le prix plancher doit être un entier")
    .positive("Le prix plancher doit être positif")
    .optional(),
  sku: z.string().trim().min(1).optional(),
})

export const MAX_VARIANTES_CREATION = 50

// Shared by both creation schemas: the floor price may not exceed the selling
// price. Kept as a standalone predicate because a refined schema is a
// ZodEffects and can no longer be extended.
const plancherInferieurAuPrix = (v: { price: number; minPrice?: number }) =>
  v.minPrice === undefined || v.minPrice <= v.price

const MESSAGE_PLANCHER = {
  message: "Le prix plancher doit être inférieur ou égal au prix de vente",
  path: ["minPrice"],
}

const productCreateBase = z.object({
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

export const productCreateSchema = productCreateBase.refine(
  plancherInferieurAuPrix,
  MESSAGE_PLANCHER
)

// Multipart creation: same fields, plus the variants carried in the same call.
// Bounded because every variant adds a statement to a single D1 batch.
export const productCreateMultipartSchema = productCreateBase
  .extend({
    variants: z
      .array(variantCreateSchema)
      .max(
        MAX_VARIANTES_CREATION,
        `Maximum ${MAX_VARIANTES_CREATION} variantes`
      )
      .optional(),
  })
  .refine(plancherInferieurAuPrix, MESSAGE_PLANCHER)

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

export const variantUpdateSchema = z
  .object({
    barcode: z.string().trim().min(1).nullable().optional(),
    priceOverride: z.number().int().positive().nullable().optional(),
    minPriceOverride: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })

export const lotCreateSchema = z.object({
  lotNumber: z.string().trim().min(1, "Le numéro de lot est requis"),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date de péremption invalide (AAAA-MM-JJ)")
    .optional(),
})

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>
export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>
export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductCreateMultipartInput = z.infer<
  typeof productCreateMultipartSchema
>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
export type VariantCreateInput = z.infer<typeof variantCreateSchema>
export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>
export type LotCreateInput = z.infer<typeof lotCreateSchema>
