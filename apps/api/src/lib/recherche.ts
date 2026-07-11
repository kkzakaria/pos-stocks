import { sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"

// LIKE « littéral » : les métacaractères % et _ (et l'échappement \ lui-même)
// saisis par l'utilisateur sont neutralisés, sinon rechercher « 100% » ou
// « A_B » agit comme un joker SQL.
export function likeEchappe(colonne: AnySQLiteColumn, terme: string): SQL {
  const motif = `%${terme.replace(/[\\%_]/g, (car) => `\\${car}`)}%`
  return sql`${colonne} LIKE ${motif} ESCAPE '\\'`
}
