import { z } from "zod"

export const registerSessionOpenSchema = z.object({
  storeId: z.string().min(1, "La boutique est requise"),
  openingFloat: z
    .number()
    .int("Le fond de caisse doit être un entier")
    .nonnegative("Le fond de caisse doit être positif ou nul"),
})

export const registerSessionCloseSchema = z.object({
  countedAmount: z
    .number()
    .int("Le montant compté doit être un entier")
    .nonnegative("Le montant compté doit être positif ou nul"),
})

const salePaymentSchema = z
  .object({
    method: z.enum(["cash", "mobile_money"], {
      message: "Méthode de paiement invalide",
    }),
    // Part du total réglée par ce paiement
    amount: z
      .number()
      .int("Le montant doit être un entier")
      .positive("Le montant doit être positif"),
    reference: z.string().trim().min(1).optional(),
    // Cash uniquement : montant tendu par le client (la monnaie s'en déduit)
    receivedAmount: z
      .number()
      .int("Le montant reçu doit être un entier")
      .positive("Le montant reçu doit être positif")
      .optional(),
  })
  .superRefine((p, ctx) => {
    if (p.method === "mobile_money" && p.reference === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "La référence de la transaction mobile money est requise",
      })
    }
    if (
      p.method === "cash" &&
      p.receivedAmount !== undefined &&
      p.receivedAmount < p.amount
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["receivedAmount"],
        message: "Le montant reçu doit couvrir le montant encaissé",
      })
    }
    if (p.method === "mobile_money" && p.receivedAmount !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["receivedAmount"],
        message: "Le montant reçu est réservé aux paiements en espèces",
      })
    }
  })

const saleItemSchema = z.object({
  variantId: z.string().min(1, "L'article est requis"),
  quantity: z
    .number()
    .int("La quantité doit être un entier")
    .positive("La quantité doit être positive"),
  // Prix unitaire APPLIQUÉ (négocié) — la borne plancher est vérifiée côté
  // serveur contre le catalogue au moment de la vente
  unitPrice: z
    .number()
    .int("Le prix doit être un entier")
    .nonnegative("Le prix doit être positif ou nul"),
  // Dépannage : entrepôt d'où sort le stock (défaut : la boutique)
  sourceWarehouseId: z.string().min(1).optional(),
})

export const saleCreateSchema = z
  .object({
    storeId: z.string().min(1, "La boutique est requise"),
    // Idempotence (spec §8) : généré côté client, conservé sur retry
    clientRequestId: z
      .string()
      .min(8, "L'identifiant d'idempotence est requis"),
    items: z.array(saleItemSchema).min(1, "Le panier est vide"),
    payments: z
      .array(salePaymentSchema)
      .min(1, "Au moins un paiement est requis"),
  })
  .refine(
    (v) =>
      v.payments.reduce((somme, p) => somme + p.amount, 0) ===
      v.items.reduce((somme, i) => somme + i.quantity * i.unitPrice, 0),
    {
      message: "La somme des paiements doit égaler le total de la vente",
      path: ["payments"],
    }
  )
  .refine(
    (v) =>
      new Set(
        v.items.map((i) => `${i.variantId}|${i.sourceWarehouseId ?? v.storeId}`)
      ).size === v.items.length,
    {
      message:
        "Chaque article ne peut apparaître qu'une fois par entrepôt source",
      path: ["items"],
    }
  )

export type RegisterSessionOpenInput = z.infer<typeof registerSessionOpenSchema>
export type RegisterSessionCloseInput = z.infer<
  typeof registerSessionCloseSchema
>
export type SalePaymentInput = z.infer<typeof salePaymentSchema>
export type SaleItemInput = z.infer<typeof saleItemSchema>
export type SaleCreateInput = z.infer<typeof saleCreateSchema>
