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
import type {
  LigneVentesBoutique,
  LigneVentesProduit,
  TotalVentes,
} from "@/lib/rapports"
import { EtatVide } from "@/components/etat-vide"
import { BarreProportion } from "@/components/ui/barre-proportion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody } from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"

const PRESETS = [
  { id: "jour", libelle: "Aujourd'hui" },
  { id: "semaine", libelle: "7 jours" },
  { id: "mois", libelle: "Ce mois" },
] as const

/** Period selector shared across reports: "Du"/"Au" date bounds and preset buttons (day, 7 days, month). */
export function SelecteurPeriode({
  periode,
  onChange,
}: {
  periode: { du: string; au: string }
  onChange: (periode: { du: string; au: string }) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      {/* `Label` + wrapper div, matching the rest of the repo. A bare <label>
          wrapping the input left the date fields without a determinate width:
          `Input` is `w-full min-w-0`, so inside a content-sized flex item it
          collapsed. */}
      <div className="flex w-full flex-col gap-1.5 sm:w-40">
        <Label htmlFor="rap-du">Du</Label>
        <Input
          id="rap-du"
          type="date"
          value={periode.du}
          onChange={(e) => onChange({ ...periode, du: e.target.value })}
        />
      </div>
      <div className="flex w-full flex-col gap-1.5 sm:w-40">
        <Label htmlFor="rap-au">Au</Label>
        <Input
          id="rap-au"
          type="date"
          value={periode.au}
          onChange={(e) => onChange({ ...periode, au: e.target.value })}
        />
      </div>
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

/** Row of sales summary tiles: revenue, tickets, average basket, cash, and mobile money. */
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

/** Loading tiles, matching the density of the totals tiles. */
export function TuilesSkeleton({ nombre = 5 }: { nombre?: number }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
      {Array.from({ length: nombre }).map((_tuile, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  )
}

/** Reusable report error box: alert message + "Réessayer" button. */
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

/**
 * `LigneVentesBoutique` with the period's total CA spliced in — the `CA`
 * column's `BarreProportion` needs it, but the API only returns the total
 * once on `RapportVentesBoutiques`, not per line.
 */
export type LigneVentesBoutiqueAffichee = LigneVentesBoutique & {
  totalCa: number
}

/** Card mode: the store name is the dominant identity line. */
export function titreLigneVentesBoutique(item: LigneVentesBoutiqueAffichee) {
  return item.storeName
}

/** Card mode: CA is the headline figure. */
export function valeurLigneVentesBoutique(item: LigneVentesBoutiqueAffichee) {
  return formaterMontant(item.ca)
}

export const COLONNES_VENTES_BOUTIQUE: ColonneAdaptative<LigneVentesBoutiqueAffichee>[] =
  [
    {
      cle: "boutique",
      entete: "Boutique",
      masquerEnCarte: true,
      classeCellule: "font-medium",
      cellule: (ligne) => ligne.storeName,
    },
    {
      cle: "ca",
      entete: "CA",
      numeric: true,
      // Not masquerEnCarte on purpose: the proportion bar is a visual cue
      // that belongs in card mode too, not just the plain headline amount
      // carried by `valeur`.
      cellule: (ligne) => (
        <span className="flex flex-col items-end gap-1">
          <span>{formaterMontant(ligne.ca)}</span>
          <BarreProportion
            className="max-w-24"
            valeur={ligne.ca}
            total={ligne.totalCa}
          />
        </span>
      ),
    },
    {
      cle: "tickets",
      entete: "Tickets",
      numeric: true,
      cellule: (ligne) => ligne.tickets,
    },
    {
      cle: "panierMoyen",
      entete: "Panier moyen",
      numeric: true,
      cellule: (ligne) => formaterMontant(ligne.panierMoyen),
    },
    {
      cle: "cash",
      entete: "Espèces",
      numeric: true,
      cellule: (ligne) => formaterMontant(ligne.cash),
    },
    {
      cle: "mobileMoney",
      entete: "Mobile money",
      numeric: true,
      cellule: (ligne) => formaterMontant(ligne.mobileMoney),
    },
  ]

/** Card mode: the product name is the dominant identity line. */
export function titreLigneVentesProduit(item: LigneVentesProduit) {
  return item.productName
}

/** Card mode: CA is the headline figure. */
export function valeurLigneVentesProduit(item: LigneVentesProduit) {
  return formaterMontant(item.ca)
}

export function sousTitreLigneVentesProduit(item: LigneVentesProduit) {
  return item.sku
}

export const COLONNES_VENTES_PRODUIT: ColonneAdaptative<LigneVentesProduit>[] =
  [
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
      masquerEnCarte: true,
      cellule: (ligne) => formaterMontant(ligne.ca),
    },
    {
      cle: "remises",
      entete: "Remises",
      numeric: true,
      cellule: (ligne) => formaterMontant(ligne.remise),
    },
    {
      cle: "tickets",
      entete: "Tickets",
      numeric: true,
      cellule: (ligne) => ligne.tickets,
    },
  ]

/** Sales report: grouping by store or by product over a period, totals tiles, table, and CSV export. */
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
        <div className="flex flex-wrap gap-2">
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
          <div className="mt-4">
            <ListeAdaptative<LigneVentesBoutiqueAffichee>
              colonnes={COLONNES_VENTES_BOUTIQUE}
              lignes={boutiquesQ.data.lignes.map((ligne) => ({
                ...ligne,
                totalCa: boutiquesQ.data.total.ca,
              }))}
              cleLigne={(ligne) => ligne.storeId}
              titre={titreLigneVentesBoutique}
              valeur={valeurLigneVentesBoutique}
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

      {groupe === "produit" && produitsQ.isSuccess && (
        <>
          <TuilesTotaux total={produitsQ.data.total} />
          <div className="mt-4">
            <ListeAdaptative<LigneVentesProduit>
              colonnes={COLONNES_VENTES_PRODUIT}
              lignes={produitsQ.data.lignes}
              cleLigne={(ligne) => ligne.variantId}
              titre={titreLigneVentesProduit}
              valeur={valeurLigneVentesProduit}
              sousTitre={sousTitreLigneVentesProduit}
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
