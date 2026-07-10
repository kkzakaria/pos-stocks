import { z } from "zod"

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Le mot de passe actuel est requis"),
  newPassword: z
    .string()
    .min(12, "Le nouveau mot de passe doit contenir au moins 12 caractères"),
})

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
