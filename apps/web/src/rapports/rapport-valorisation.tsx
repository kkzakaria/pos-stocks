import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Boxes } from "lucide-react"
import { formaterMontant } from "@/lib/format"
import { jourLocal } from "@/lib/pos"
import { fetchRapportValorisation, telechargerCsv } from "@/lib/rapports"
import type { LigneValorisation } from "@/lib/rapports"
import { BarreProportion } from "@/components/ui/barre-proportion"
import { ErreurEtRetry } from "@/rapports/rapport-ventes"
import { EtatVide } from "@/components/etat-vide"
import { Button } from "@/components/ui/button"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody } from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"

/** Card mode: the product name is the dominant identity line. */
export function titreLigneValorisation(item: LigneValorisation) {
  return item.productName
}

/** Card mode: the line's stock value is the headline figure. */
export function valeurLigneValorisation(item: LigneValorisation) {
  return formaterMontant(item.valeur)
}

export function sousTitreLigneValorisation(item: LigneValorisation) {
  return item.sku
}

/**
 * Extracted once at module level: this screen renders one list per warehouse,
 * so rebuilding the array inside the map would allocate it N times for no
 * reason.
 */
export const COLONNES_VALORISATION: ColonneAdaptative<LigneValorisation>[] = [
  {
    cle: "produit",
    entete: "Produit",
    masquerEnCarte: true,
    classeCellule: "font-medium",
    cellule: (ligne) => ligne.productName,
  },
  {
    cle: "variante",
    entete: "Variante",
    cellule: (ligne) => ligne.variantName,
  },
  {
    cle: "sku",
    entete: "SKU",
    masquerEnCarte: true,
    classeCellule: "font-mono text-xs text-muted-foreground",
    cellule: (ligne) => ligne.sku,
  },
  {
    cle: "quantite",
    entete: "Quantité",
    numeric: true,
    cellule: (ligne) => ligne.quantity,
  },
  {
    cle: "cmp",
    entete: "CMP",
    numeric: true,
    cellule: (ligne) => formaterMontant(ligne.avgCost),
  },
  {
    cle: "valeur",
    entete: "Valeur",
    numeric: true,
    // Already carried by the card headline (`valeur`), so hidden from the
    // pairs — otherwise the figure would render twice in one card.
    masquerEnCarte: true,
    cellule: (ligne) => formaterMontant(ligne.valeur),
  },
]

/** Valuation report: snapshot of current stock (quantity × weighted average cost) per warehouse and per variant, with total and CSV export. */
export function RapportValorisation() {
  const [erreurExport, setErreurExport] = useState<string | null>(null)
  const rapport = useQuery({
    queryKey: ["rapport-valorisation"],
    queryFn: () => fetchRapportValorisation(),
  })

  async function exporter() {
    setErreurExport(null)
    try {
      await telechargerCsv(
        "/api/v1/reports/valuation?format=csv",
        `rapport-valorisation_${jourLocal()}.csv`
      )
    } catch (err) {
      setErreurExport(err instanceof Error ? err.message : "Export impossible")
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Photographie du stock courant (quantité × coût moyen pondéré).
        </p>
        <Button variant="outline" onClick={() => void exporter()}>
          Exporter CSV
        </Button>
      </div>
      {erreurExport && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erreurExport}
        </p>
      )}
      {rapport.isPending && (
        <>
          <Skeleton className="mt-4 h-16 w-full max-w-xs" />
          <Table className="mt-6">
            <TableBody>
              <TableSkeleton colonnes={6} />
            </TableBody>
          </Table>
        </>
      )}
      {rapport.isError && (
        <ErreurEtRetry
          message={
            rapport.error instanceof Error
              ? rapport.error.message
              : "Impossible de charger le rapport"
          }
          onRetry={() => void rapport.refetch()}
        />
      )}
      {rapport.isSuccess && (
        <>
          <div className="mt-4 rounded-md bg-card p-3 ring-1 ring-foreground/10">
            <p className="text-xs text-muted-foreground">
              Valeur totale du stock
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formaterMontant(rapport.data.total)}
            </p>
          </div>
          {rapport.data.entrepots.length === 0 ? (
            <EtatVide
              className="mt-6"
              icon={Boxes}
              titre="Aucun stock valorisé"
              message="Réceptionnez ou transférez du stock pour alimenter la valorisation."
            />
          ) : (
            rapport.data.entrepots.map((entrepot) => (
              <section key={entrepot.warehouseId} className="mt-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h2 className="font-semibold">{entrepot.warehouseName}</h2>
                  <span className="flex flex-col items-end gap-1">
                    <span className="text-sm font-normal text-muted-foreground tabular-nums">
                      {formaterMontant(entrepot.valeur)}
                    </span>
                    <BarreProportion
                      className="max-w-32"
                      valeur={entrepot.valeur}
                      total={rapport.data.total}
                    />
                  </span>
                </div>
                <div className="mt-2">
                  <ListeAdaptative<LigneValorisation>
                    colonnes={COLONNES_VALORISATION}
                    lignes={entrepot.lignes}
                    cleLigne={(ligne) => ligne.variantId}
                    titre={titreLigneValorisation}
                    valeur={valeurLigneValorisation}
                    sousTitre={sousTitreLigneValorisation}
                  />
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  )
}
