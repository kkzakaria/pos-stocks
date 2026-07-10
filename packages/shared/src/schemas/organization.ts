import { z } from "zod"

export const organizationSettingsSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis").optional(),
    currency: z
      .string()
      .trim()
      .length(3, "Code devise ISO 4217 (3 lettres)")
      .transform((v) => v.toUpperCase())
      .optional(),
    receiptHeader: z.string().max(500).optional(),
    receiptFooter: z.string().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à modifier",
  })

export type OrganizationSettingsInput = z.infer<
  typeof organizationSettingsSchema
>
