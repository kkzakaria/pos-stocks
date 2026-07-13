import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { formaterMontant } from "@/lib/format"
import { fetchVenteDetail } from "@/lib/rapports"

export const Route = createFileRoute("/_app/ventes/$saleId")({
  component: DetailVente,
})

const LIBELLES_METHODE: Record<string, string> = {
  cash: "Espèces",
  mobile_money: "Mobile money",
}

function DetailVente() {
  const { saleId } = Route.useParams()
  const detail = useQuery({
    queryKey: ["vente-detail", saleId],
    queryFn: () => fetchVenteDetail(saleId),
  })
  if (detail.isPending) {
    return <p className="text-sm text-gray-500">Chargement…</p>
  }
  if (detail.isError) {
    return (
      <p role="alert" className="text-sm text-red-600">
        Vente introuvable ou inaccessible.
      </p>
    )
  }
  const { sale, marge } = detail.data
  return (
    <div>
      <Link to="/ventes" className="text-sm text-blue-600 hover:underline">
        ← Historique
      </Link>
      <h1 className="mt-2 text-xl font-semibold">
        Ticket n° {sale.ticketNumber} — {sale.storeName}
      </h1>
      <p className="text-sm text-gray-500">
        {new Date(sale.createdAt).toLocaleString("fr-FR")} · {sale.cashierName}
      </p>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2">Article</th>
            <th>SKU</th>
            <th className="text-right">Qté</th>
            <th className="text-right">PU appliqué</th>
            <th className="text-right">Prix catalogue</th>
            <th className="text-right">Remise</th>
            <th>Source</th>
            <th>Lot</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="py-2">
                {item.productName}
                {item.variantName !== "Standard" && ` — ${item.variantName}`}
              </td>
              <td className="text-gray-500">{item.sku}</td>
              <td className="text-right">{item.quantity}</td>
              <td className="text-right tabular-nums">
                {formaterMontant(item.unitPrice, sale.currency)}
              </td>
              <td className="text-right tabular-nums">
                {formaterMontant(item.catalogPrice, sale.currency)}
              </td>
              <td className="text-right tabular-nums">
                {formaterMontant(
                  (item.catalogPrice - item.unitPrice) * item.quantity,
                  sale.currency
                )}
              </td>
              <td>{item.sourceWarehouseName}</td>
              <td className="text-gray-500">{item.lotNumber ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-right text-lg font-semibold tabular-nums">
        Total : {formaterMontant(sale.total, sale.currency)}
      </p>

      <section className="mt-4">
        <h2 className="font-semibold">Paiements</h2>
        <ul className="mt-1 space-y-1 text-sm">
          {sale.payments.map((paiement, index) => (
            <li key={index} className="flex justify-between border-b py-1">
              <span>
                {LIBELLES_METHODE[paiement.method] ?? paiement.method}
                {paiement.reference && ` · réf. ${paiement.reference}`}
              </span>
              <span className="tabular-nums">
                {formaterMontant(paiement.amount, sale.currency)}
                {paiement.changeGiven !== null &&
                  paiement.changeGiven > 0 &&
                  ` (rendu ${formaterMontant(paiement.changeGiven, sale.currency)})`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {marge && (
        <section className="mt-4 rounded border bg-gray-50 p-3 text-sm">
          <h2 className="font-semibold">Marge</h2>
          <p className="mt-1">
            Coût : {formaterMontant(marge.cout, sale.currency)} · Marge :{" "}
            <strong className="tabular-nums">
              {formaterMontant(marge.marge, sale.currency)}
            </strong>
            {marge.estime && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                estimée
              </span>
            )}
          </p>
        </section>
      )}
    </div>
  )
}
