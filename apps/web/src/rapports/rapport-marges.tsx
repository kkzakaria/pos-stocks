import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Receipt } from "lucide-react"
import { formaterMontant } from "@/lib/format"
import {
  fetchRapportMarges,
  periodePreset,
  telechargerCsv,
} from "@/lib/rapports"
import type { LigneMarge } from "@/lib/rapports"
import {
  ErreurEtRetry,
  SelecteurPeriode,
  TuilesSkeleton,
} from "@/rapports/rapport-ventes"
import { EtatVide } from "@/components/etat-vide"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"
import { Table, TableBody } from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"

/** "estimé" badge flagging a margin whose cost was approximated (weighted average cost unavailable for a lot). */
function BadgeEstime() {
  return (
    <Badge variant="warning" className="ml-2">
      estimé
    </Badge>
  )
}

/** Card mode: the product name is the dominant identity line. */
export function titreLigneMarge(item: LigneMarge) {
  return item.productName
}

export function sousTitreLigneMarge(item: LigneMarge) {
  return item.sku
}

/**
 * Amount + "estimé" badge, shared verbatim between the `marge` column (table
 * mode) and the card headline (`valeur`). The `marge` column is
 * `masquerEnCarte`, so this is the ONLY place it renders in card mode —
 * reusing the same function for both rules out the figure appearing twice.
 * The badge is audit information (it flags an approximated cost), so it
 * travels along with the figure rather than staying table-only.
 */
export function valeurLigneMarge(item: LigneMarge) {
  return (
    <span className="inline-flex items-center">
      {formaterMontant(item.marge)}
      {item.estime && <BadgeEstime />}
    </span>
  )
}

export const COLONNES_MARGES: ColonneAdaptative<LigneMarge>[] = [
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
    cellule: (ligne) => ligne.quantite,
  },
  {
    cle: "ca",
    entete: "CA",
    numeric: true,
    cellule: (ligne) => formaterMontant(ligne.ca),
  },
  {
    cle: "cout",
    entete: "Coût",
    numeric: true,
    cellule: (ligne) => formaterMontant(ligne.cout),
  },
  {
    cle: "marge",
    entete: "Marge",
    numeric: true,
    masquerEnCarte: true,
    cellule: valeurLigneMarge,
  },
]

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
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          <div className="mt-4">
            <ListeAdaptative<LigneMarge>
              colonnes={COLONNES_MARGES}
              lignes={rapport.data.lignes}
              cleLigne={(ligne) => ligne.variantId}
              titre={titreLigneMarge}
              valeur={valeurLigneMarge}
              sousTitre={sousTitreLigneMarge}
              etatVide={
                <EtatVide
                  icon={Receipt}
                  titre="Aucune vente sur cette période"
                  message="Ajustez la période ou vérifiez qu'un ticket a bien été encaissé."
                />
              }
            />
          </div>
        </>
      )}
    </div>
  )
}
