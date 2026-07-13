import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Receipt } from "lucide-react"
import { formaterMontant } from "@/lib/format"
import {
  fetchRapportMarges,
  periodePreset,
  telechargerCsv,
} from "@/lib/rapports"
import {
  ErreurEtRetry,
  SelecteurPeriode,
  TuilesSkeleton,
} from "@/rapports/rapport-ventes"
import { EtatVide } from "@/components/etat-vide"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"

/** "estimé" badge flagging a margin whose cost was approximated (weighted average cost unavailable for a lot). */
function BadgeEstime() {
  return (
    <Badge variant="warning" className="ml-2">
      estimé
    </Badge>
  )
}

/** Per-product margins report over a period: revenue, cost, and margin (an "estimé" badge when approximated), summary tiles, and CSV export. */
export function RapportMarges() {
  const [periode, setPeriode] = useState(() => periodePreset("semaine"))
  const [erreurExport, setErreurExport] = useState<string | null>(null)
  const periodeValide = periode.du !== "" && periode.au !== ""
  const rapport = useQuery({
    queryKey: ["rapport-marges", periode.du, periode.au],
    queryFn: () => fetchRapportMarges(periode.du, periode.au),
    enabled: periodeValide,
  })

  async function exporter() {
    setErreurExport(null)
    try {
      await telechargerCsv(
        `/api/v1/reports/margins?du=${periode.du}&au=${periode.au}&format=csv`,
        `rapport-marges_${periode.du}_${periode.au}.csv`
      )
    } catch (err) {
      setErreurExport(err instanceof Error ? err.message : "Export impossible")
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SelecteurPeriode periode={periode} onChange={(p) => setPeriode(p)} />
        <Button
          variant="outline"
          disabled={!periodeValide}
          onClick={() => void exporter()}
        >
          Exporter CSV
        </Button>
      </div>
      {erreurExport && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erreurExport}
        </p>
      )}
      {rapport.isPending && periodeValide && (
        <>
          <TuilesSkeleton nombre={3} />
          <Table className="mt-4">
            <TableBody>
              <TableSkeleton colonnes={7} />
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
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-md bg-card p-3 ring-1 ring-foreground/10">
              <p className="text-xs text-muted-foreground">CA</p>
              <p className="mt-1 font-semibold tabular-nums">
                {formaterMontant(rapport.data.total.ca)}
              </p>
            </div>
            <div className="rounded-md bg-card p-3 ring-1 ring-foreground/10">
              <p className="text-xs text-muted-foreground">Coût</p>
              <p className="mt-1 font-semibold tabular-nums">
                {formaterMontant(rapport.data.total.cout)}
              </p>
            </div>
            <div className="rounded-md bg-card p-3 ring-1 ring-foreground/10">
              <p className="text-xs text-muted-foreground">
                Marge
                {rapport.data.total.estime && <BadgeEstime />}
              </p>
              <p className="mt-1 font-semibold tabular-nums">
                {formaterMontant(rapport.data.total.marge)}
              </p>
            </div>
          </div>
          {rapport.data.lignes.length === 0 ? (
            <EtatVide
              className="mt-6"
              icon={Receipt}
              titre="Aucune vente sur cette période"
              message="Ajustez la période ou vérifiez qu'un ticket a bien été encaissé."
            />
          ) : (
            <Table className="mt-4">
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead>Variante</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead numeric>Quantité</TableHead>
                  <TableHead numeric>CA</TableHead>
                  <TableHead numeric>Coût</TableHead>
                  <TableHead numeric>Marge</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rapport.data.lignes.map((ligne) => (
                  <TableRow key={ligne.variantId}>
                    <TableCell className="font-medium">
                      {ligne.productName}
                    </TableCell>
                    <TableCell>{ligne.variantName}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {ligne.sku}
                    </TableCell>
                    <TableCell numeric>{ligne.quantite}</TableCell>
                    <TableCell numeric>{formaterMontant(ligne.ca)}</TableCell>
                    <TableCell numeric>{formaterMontant(ligne.cout)}</TableCell>
                    <TableCell numeric>
                      <span className="inline-flex items-center">
                        {formaterMontant(ligne.marge)}
                        {ligne.estime && <BadgeEstime />}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  )
}
