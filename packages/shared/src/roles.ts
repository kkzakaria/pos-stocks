export const COMPANY_ROLES = [
  "owner",
  "admin",
  "auditor",
  "stock_manager",
  "staff",
] as const
export type CompanyRole = (typeof COMPANY_ROLES)[number]

export const WAREHOUSE_ROLES = ["manager", "auditor", "cashier"] as const
export type WarehouseRole = (typeof WAREHOUSE_ROLES)[number]
