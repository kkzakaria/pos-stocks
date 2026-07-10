import { apiFetch } from "./api"
import type { CompanyRole, WarehouseRole } from "shared"

export type Me = {
  user: { id: string; email: string; name: string; mustChangePassword: boolean }
  membership: {
    organizationId: string
    organizationName: string
    role: CompanyRole
  } | null
  assignments: Array<{
    warehouseId: string
    warehouseName: string
    role: WarehouseRole
  }>
}

export function fetchMe(): Promise<Me> {
  return apiFetch<Me>("/api/v1/me")
}
