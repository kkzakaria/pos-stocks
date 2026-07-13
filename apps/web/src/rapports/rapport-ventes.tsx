import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { formaterMontant } from "@/lib/format"
import {
  fetchRapportVentesBoutiques,
  fetchRapportVentesProduits,
  periodePreset,
  telechargerCsv,
} from "@/lib/rapports"
import type { TotalVentes } from "@/lib/rapports"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

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
        <div key={tuile.libelle} className="rounded border bg-white p-3">
          <p className="text-xs text-gray-500">{tuile.libelle}</p>
          <p className="mt-1 font-semibold tabular-nums">{tuile.valeur}</p>
        </div>
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
      <p role="alert" className="mb-2 text-sm text-red-600">
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
        <p role="alert" className="mt-2 text-sm text-red-600">
          {erreurExport}
        </p>
      )}

      {active.isPending && periodeValide && (
        <p className="mt-6 text-sm text-gray-500">Chargement…</p>
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
            <p className="mt-6 text-sm text-gray-500">
              Aucune vente sur cette période.
            </p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2">Boutique</th>
                  <th className="text-right">CA</th>
                  <th className="text-right">Tickets</th>
                  <th className="text-right">Panier moyen</th>
                  <th className="text-right">Espèces</th>
                  <th className="text-right">Mobile money</th>
                </tr>
              </thead>
              <tbody>
                {boutiquesQ.data.lignes.map((ligne) => (
                  <tr key={ligne.storeId} className="border-b">
                    <td className="py-2">{ligne.storeName}</td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.ca)}
                    </td>
                    <td className="text-right">{ligne.tickets}</td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.panierMoyen)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.cash)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.mobileMoney)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {groupe === "produit" && produitsQ.isSuccess && (
        <>
          <TuilesTotaux total={produitsQ.data.total} />
          {produitsQ.data.lignes.length === 0 ? (
            <p className="mt-6 text-sm text-gray-500">
              Aucune vente sur cette période.
            </p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2">Produit</th>
                  <th>Variante</th>
                  <th>SKU</th>
                  <th className="text-right">Quantité</th>
                  <th className="text-right">CA</th>
                  <th className="text-right">Remises</th>
                  <th className="text-right">Tickets</th>
                </tr>
              </thead>
              <tbody>
                {produitsQ.data.lignes.map((ligne) => (
                  <tr key={ligne.variantId} className="border-b">
                    <td className="py-2">{ligne.productName}</td>
                    <td>{ligne.variantName}</td>
                    <td className="text-gray-500">{ligne.sku}</td>
                    <td className="text-right">{ligne.quantite}</td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.ca)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.remise)}
                    </td>
                    <td className="text-right">{ligne.tickets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}
