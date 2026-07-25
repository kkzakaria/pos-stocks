import type { CompanyRole, WarehouseRole } from "shared"

export type Affectation = {
  id: string
  warehouseId: string
  warehouseName: string
  role: WarehouseRole
}

export type Utilisateur = {
  id: string
  name: string
  email: string
  role: CompanyRole
  isActive: boolean
  assignments: Affectation[]
}

export type EntrepotOption = {
  id: string
  name: string
  isActive: boolean
}
