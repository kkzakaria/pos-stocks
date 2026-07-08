import { z } from "zod"

export const setupSchema = z.object({
  organizationName: z.string().min(1, "Le nom de l'entreprise est requis"),
  name: z.string().min(1, "Le nom est requis"),
  email: z.string().email("Adresse email invalide"),
  password: z
    .string()
    .min(12, "Le mot de passe doit contenir au moins 12 caractères"),
})

export type SetupInput = z.infer<typeof setupSchema>
