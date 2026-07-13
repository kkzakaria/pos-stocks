import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Boxes } from "lucide-react"
import { formaterMontant } from "@/lib/format"
import { jourLocal } from "@/lib/pos"
import { fetchRapportValorisation, telechargerCsv } from "@/lib/rapports"
import { BarreProportion } from "@/components/ui/barre-proportion"
import { ErreurEtRetry } from "@/rapports/rapport-ventes"
import { EtatVide } from "@/components/etat-vide"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"

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
      <div className="flex items-center justify-between">
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
                <div className="flex items-baseline justify-between">
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
                <Table className="mt-2">
                  <TableHeader sticky>
                    <TableRow>
                      <TableHead>Produit</TableHead>
                      <TableHead>Variante</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead numeric>Quantité</TableHead>
                      <TableHead numeric>CMP</TableHead>
                      <TableHead numeric>Valeur</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entrepot.lignes.map((ligne) => (
                      <TableRow key={ligne.variantId}>
                        <TableCell className="font-medium">
                          {ligne.productName}
                        </TableCell>
                        <TableCell>{ligne.variantName}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {ligne.sku}
                        </TableCell>
                        <TableCell numeric>{ligne.quantity}</TableCell>
                        <TableCell numeric>
                          {formaterMontant(ligne.avgCost)}
                        </TableCell>
                        <TableCell numeric>
                          {formaterMontant(ligne.valeur)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            ))
          )}
        </>
      )}
    </div>
  )
}
