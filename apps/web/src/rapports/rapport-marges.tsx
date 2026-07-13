import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { formaterMontant } from "@/lib/format"
import {
  fetchRapportMarges,
  periodePreset,
  telechargerCsv,
} from "@/lib/rapports"
import { ErreurEtRetry, SelecteurPeriode } from "@/rapports/rapport-ventes"
import { Button } from "@/components/ui/button"

function BadgeEstime() {
  return (
    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
      estimé
    </span>
  )
}

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
        <p role="alert" className="mt-2 text-sm text-red-600">
          {erreurExport}
        </p>
      )}
      {rapport.isPending && periodeValide && (
        <p className="mt-6 text-sm text-gray-500">Chargement…</p>
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
            <div className="rounded border bg-white p-3">
              <p className="text-xs text-gray-500">CA</p>
              <p className="mt-1 font-semibold tabular-nums">
                {formaterMontant(rapport.data.total.ca)}
              </p>
            </div>
            <div className="rounded border bg-white p-3">
              <p className="text-xs text-gray-500">Coût</p>
              <p className="mt-1 font-semibold tabular-nums">
                {formaterMontant(rapport.data.total.cout)}
              </p>
            </div>
            <div className="rounded border bg-white p-3">
              <p className="text-xs text-gray-500">
                Marge
                {rapport.data.total.estime && <BadgeEstime />}
              </p>
              <p className="mt-1 font-semibold tabular-nums">
                {formaterMontant(rapport.data.total.marge)}
              </p>
            </div>
          </div>
          {rapport.data.lignes.length === 0 ? (
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
                  <th className="text-right">Coût</th>
                  <th className="text-right">Marge</th>
                </tr>
              </thead>
              <tbody>
                {rapport.data.lignes.map((ligne) => (
                  <tr key={ligne.variantId} className="border-b">
                    <td className="py-2">{ligne.productName}</td>
                    <td>{ligne.variantName}</td>
                    <td className="text-gray-500">{ligne.sku}</td>
                    <td className="text-right">{ligne.quantite}</td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.ca)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.cout)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formaterMontant(ligne.marge)}
                      {ligne.estime && <BadgeEstime />}
                    </td>
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
