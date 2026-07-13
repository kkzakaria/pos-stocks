import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Receipt } from "lucide-react"
import { formaterMontant } from "@/lib/format"
import {
  fetchRapportVentesBoutiques,
  fetchRapportVentesProduits,
  periodePreset,
  telechargerCsv,
} from "@/lib/rapports"
import type { TotalVentes } from "@/lib/rapports"
import { EtatVide } from "@/components/etat-vide"
import { BarreProportion } from "@/components/ui/barre-proportion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

const PRESETS = [
  { id: "jour", libelle: "Aujourd'hui" },
  { id: "semaine", libelle: "7 jours" },
  { id: "mois", libelle: "Ce mois" },
] as const

export function SelecteurPeriode({
  periode,
  onChange,
}: {
  periode: { du: string; au: string }
  onChange: (periode: { du: string; au: string }) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        Du
        <Input
          type="date"
          className="mt-1"
          value={periode.du}
          onChange={(e) => onChange({ ...periode, du: e.target.value })}
        />
      </label>
      <label className="text-sm">
        Au
        <Input
          type="date"
          className="mt-1"
          value={periode.au}
          onChange={(e) => onChange({ ...periode, au: e.target.value })}
        />
      </label>
      {PRESETS.map((preset) => (
        <Button
          key={preset.id}
          variant="outline"
          onClick={() => onChange(periodePreset(preset.id))}
        >
          {preset.libelle}
        </Button>
      ))}
    </div>
  )
}

export function TuilesTotaux({ total }: { total: TotalVentes }) {
  const tuiles = [
    { libelle: "Chiffre d'affaires", valeur: formaterMontant(total.ca) },
    { libelle: "Tickets", valeur: `${total.tickets} tickets` },
    { libelle: "Panier moyen", valeur: formaterMontant(total.panierMoyen) },
    { libelle: "Espèces", valeur: formaterMontant(total.cash) },
    { libelle: "Mobile money", valeur: formaterMontant(total.mobileMoney) },
  ]
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
      {tuiles.map((tuile) => (
        <div
          key={tuile.libelle}
          className="rounded-md bg-card p-3 ring-1 ring-foreground/10"
        >
          <p className="text-xs text-muted-foreground">{tuile.libelle}</p>
          <p className="mt-1 font-semibold tabular-nums">{tuile.valeur}</p>
        </div>
      ))}
    </div>
  )
}

/** Tuiles de chargement, à la densité des tuiles de totaux. */
export function TuilesSkeleton({ nombre = 5 }: { nombre?: number }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
      {Array.from({ length: nombre }).map((_tuile, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  )
}

export function ErreurEtRetry({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="mt-6">
      <p role="alert" className="mb-2 text-sm text-destructive">
        {message}
      </p>
      <Button variant="outline" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  )
}

export function RapportVentes() {
  const [periode, setPeriode] = useState(() => periodePreset("semaine"))
  const [groupe, setGroupe] = useState<"boutique" | "produit">("boutique")
  const [erreurExport, setErreurExport] = useState<string | null>(null)
  const periodeValide = periode.du !== "" && periode.au !== ""
  const boutiquesQ = useQuery({
    queryKey: ["rapport-ventes", "boutique", periode.du, periode.au],
    queryFn: () => fetchRapportVentesBoutiques(periode.du, periode.au),
    enabled: periodeValide && groupe === "boutique",
  })
  const produitsQ = useQuery({
    queryKey: ["rapport-ventes", "produit", periode.du, periode.au],
    queryFn: () => fetchRapportVentesProduits(periode.du, periode.au),
    enabled: periodeValide && groupe === "produit",
  })
  const active = groupe === "boutique" ? boutiquesQ : produitsQ

  async function exporter() {
    setErreurExport(null)
    const suffixe = groupe === "boutique" ? "boutiques" : "produits"
    try {
      await telechargerCsv(
        `/api/v1/reports/sales?du=${periode.du}&au=${periode.au}&groupe=${groupe}&format=csv`,
        `rapport-ventes-${suffixe}_${periode.du}_${periode.au}.csv`
      )
    } catch (err) {
      setErreurExport(err instanceof Error ? err.message : "Export impossible")
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SelecteurPeriode periode={periode} onChange={(p) => setPeriode(p)} />
        <div className="flex gap-2">
          <Button
            variant={groupe === "boutique" ? "default" : "outline"}
            onClick={() => setGroupe("boutique")}
          >
            Par boutique
          </Button>
          <Button
            variant={groupe === "produit" ? "default" : "outline"}
            onClick={() => setGroupe("produit")}
          >
            Par produit
          </Button>
          <Button
            variant="outline"
            disabled={!periodeValide}
            onClick={() => void exporter()}
          >
            Exporter CSV
          </Button>
        </div>
      </div>
      {erreurExport && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erreurExport}
        </p>
      )}

      {active.isPending && periodeValide && (
        <>
          <TuilesSkeleton />
          <Table className="mt-4">
            <TableBody>
              <TableSkeleton colonnes={groupe === "boutique" ? 6 : 7} />
            </TableBody>
          </Table>
        </>
      )}
      {active.isError && (
        <ErreurEtRetry
          message={
            active.error instanceof Error
              ? active.error.message
              : "Impossible de charger le rapport"
          }
          onRetry={() => void active.refetch()}
        />
      )}

      {groupe === "boutique" && boutiquesQ.isSuccess && (
        <>
          <TuilesTotaux total={boutiquesQ.data.total} />
          {boutiquesQ.data.lignes.length === 0 ? (
            <EtatVide
              className="mt-6"
              icon={Receipt}
              titre="Aucune vente sur cette période"
              message="Ajustez la période ou vérifiez qu'un ticket a bien été encaissé."
            />
          ) : (
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>Boutique</TableHead>
                  <TableHead numeric>CA</TableHead>
                  <TableHead numeric>Tickets</TableHead>
                  <TableHead numeric>Panier moyen</TableHead>
                  <TableHead numeric>Espèces</TableHead>
                  <TableHead numeric>Mobile money</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boutiquesQ.data.lignes.map((ligne) => (
                  <TableRow key={ligne.storeId}>
                    <TableCell className="font-medium">
                      {ligne.storeName}
                    </TableCell>
                    <TableCell numeric>
                      <span className="flex flex-col items-end gap-1">
                        <span>{formaterMontant(ligne.ca)}</span>
                        <BarreProportion
                          className="max-w-24"
                          valeur={ligne.ca}
                          total={boutiquesQ.data.total.ca}
                        />
                      </span>
                    </TableCell>
                    <TableCell numeric>{ligne.tickets}</TableCell>
                    <TableCell numeric>
                      {formaterMontant(ligne.panierMoyen)}
                    </TableCell>
                    <TableCell numeric>{formaterMontant(ligne.cash)}</TableCell>
                    <TableCell numeric>
                      {formaterMontant(ligne.mobileMoney)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      {groupe === "produit" && produitsQ.isSuccess && (
        <>
          <TuilesTotaux total={produitsQ.data.total} />
          {produitsQ.data.lignes.length === 0 ? (
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
                  <TableHead numeric>Remises</TableHead>
                  <TableHead numeric>Tickets</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produitsQ.data.lignes.map((ligne) => (
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
                    <TableCell numeric>
                      {formaterMontant(ligne.remise)}
                    </TableCell>
                    <TableCell numeric>{ligne.tickets}</TableCell>
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
