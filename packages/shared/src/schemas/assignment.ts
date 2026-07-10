import { z } from "zod"
import { WAREHOUSE_ROLES } from "../roles"

export const assignmentCreateSchema = z.object({
  userId: z.string().min(1),
  warehouseId: z.string().min(1),
  role: z.enum(WAREHOUSE_ROLES, { message: "Rôle d'entrepôt invalide" }),
})

export type AssignmentCreateInput = z.infer<typeof assignmentCreateSchema>
