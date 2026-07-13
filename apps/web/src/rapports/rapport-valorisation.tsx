import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { formaterMontant } from "@/lib/format"
import { jourLocal } from "@/lib/pos"
import { fetchRapportValorisation, telechargerCsv } from "@/lib/rapports"
import { ErreurEtRetry } from "@/rapports/rapport-ventes"
import { Button } from "@/components/ui/button"

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
        <p className="text-sm text-gray-500">
          Photographie du stock courant (quantité × coût moyen pondéré).
        </p>
        <Button variant="outline" onClick={() => void exporter()}>
          Exporter CSV
        </Button>
      </div>
      {erreurExport && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {erreurExport}
        </p>
      )}
      {rapport.isPending && (
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
          <div className="mt-4 rounded border bg-white p-3">
            <p className="text-xs text-gray-500">Valeur totale du stock</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formaterMontant(rapport.data.total)}
            </p>
          </div>
          {rapport.data.entrepots.length === 0 && (
            <p className="mt-6 text-sm text-gray-500">Aucun stock valorisé.</p>
          )}
          {rapport.data.entrepots.map((entrepot) => (
            <section key={entrepot.warehouseId} className="mt-6">
              <h3 className="flex items-baseline justify-between font-semibold">
                {entrepot.warehouseName}
                <span className="text-sm font-normal text-gray-500 tabular-nums">
                  {formaterMontant(entrepot.valeur)}
                </span>
              </h3>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="py-2">Produit</th>
                    <th>Variante</th>
                    <th>SKU</th>
                    <th className="text-right">Quantité</th>
                    <th className="text-right">CMP</th>
                    <th className="text-right">Valeur</th>
                  </tr>
                </thead>
                <tbody>
                  {entrepot.lignes.map((ligne) => (
                    <tr key={ligne.variantId} className="border-b">
                      <td className="py-2">{ligne.productName}</td>
                      <td>{ligne.variantName}</td>
                      <td className="text-gray-500">{ligne.sku}</td>
                      <td className="text-right">{ligne.quantity}</td>
                      <td className="text-right tabular-nums">
                        {formaterMontant(ligne.avgCost)}
                      </td>
                      <td className="text-right tabular-nums">
                        {formaterMontant(ligne.valeur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
