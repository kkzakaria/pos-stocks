import { z } from "zod"
import { COMPANY_ROLES } from "../roles"

const assignableRoles = COMPANY_ROLES.filter((r) => r !== "owner")

export const userCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis"),
  email: z.string().trim().email("Adresse email invalide"),
  role: z.enum(assignableRoles as [string, ...string[]], {
    message: "Rôle invalide",
  }),
})

export const userRoleSchema = z.object({
  role: z.enum(COMPANY_ROLES, { message: "Rôle invalide" }),
})

export const userStatusSchema = z.object({ isActive: z.boolean() })

export type UserCreateInput = z.infer<typeof userCreateSchema>
