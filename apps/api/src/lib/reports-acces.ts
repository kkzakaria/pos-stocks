import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { CompanyRole } from "shared"
import type * as schema from "../db/schema"
import { porteeLectureStock } from "./stock-acces"
import type { PorteeLectureStock } from "./stock-acces"

type Db = DrizzleD1Database<typeof schema>

export type TypeRapport = "ventes" | "marges" | "valorisation"

// Matrice spec §4, ligne « Rapports » : owner/admin ✅ tous ; auditor org 👁
// tous ; stock_manager = rapport de VALORISATION seulement (« ✅ stock » —
// ni ventes ni marges) ; manager/auditor locaux = leurs entrepôts ; cashier
// exclu. Composé sur porteeLectureStock : pour ventes/marges, stock_manager
// est refusé AVANT (sa branche { tous: true } ne vaut que pour le stock) ;
// une portée staff VIDE (caissier pur, staff sans affectation) = exclu.
// Retour null ⇒ l'appelant répond 403 ACCES_REFUSE.
export async function porteeRapport(
  db: Db,
  organizationId: string,
  userId: string,
  role: CompanyRole,
  rapport: TypeRapport
): Promise<PorteeLectureStock | null> {
  if (rapport !== "valorisation" && role === "stock_manager") {
    return null
  }
  const portee = await porteeLectureStock(db, organizationId, userId, role)
  if (!portee.tous && portee.warehouseIds.length === 0) {
    return null
  }
  return portee
}
