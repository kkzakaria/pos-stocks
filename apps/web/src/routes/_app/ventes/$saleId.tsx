import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { formaterMontant } from "@/lib/format"
import { fetchVenteDetail } from "@/lib/rapports"
import { ErreurChargement } from "@/components/erreur-chargement"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-2 h-40 w-full" />
      </div>
    )
  }
  if (detail.isError) {
    return (
      <ErreurChargement
        message="Vente introuvable ou inaccessible."
        onRetry={() => void detail.refetch()}
      />
    )
  }
  const { sale, marge } = detail.data
  return (
    <div>
      <Link to="/ventes" className="text-sm text-primary hover:underline">
        ← Historique
      </Link>
      <h1 className="mt-2 text-xl font-semibold">
        Ticket n° {sale.ticketNumber} — {sale.storeName}
      </h1>
      <p className="text-sm text-muted-foreground">
        {new Date(sale.createdAt).toLocaleString("fr-FR")} · {sale.cashierName}
      </p>

      <div className="mt-4">
        <Table>
          <TableHeader sticky>
            <TableRow>
              <TableHead>Article</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead numeric>Qté</TableHead>
              <TableHead numeric>PU appliqué</TableHead>
              <TableHead numeric>Prix catalogue</TableHead>
              <TableHead numeric>Remise</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Lot</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sale.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">
                  {item.productName}
                  {item.variantName !== "Standard" && ` — ${item.variantName}`}
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {item.sku}
                </TableCell>
                <TableCell numeric>{item.quantity}</TableCell>
                <TableCell numeric>
                  {formaterMontant(item.unitPrice, sale.currency)}
                </TableCell>
                <TableCell numeric>
                  {formaterMontant(item.catalogPrice, sale.currency)}
                </TableCell>
                <TableCell numeric>
                  {formaterMontant(
                    (item.catalogPrice - item.unitPrice) * item.quantity,
                    sale.currency
                  )}
                </TableCell>
                <TableCell>{item.sourceWarehouseName}</TableCell>
                <TableCell className="text-muted-foreground">
                  {item.lotNumber ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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
        <section className="mt-4 rounded border bg-muted p-3 text-sm">
          <h2 className="font-semibold">Marge</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <span>
              Coût : {formaterMontant(marge.cout, sale.currency)} · Marge :{" "}
              <strong className="tabular-nums">
                {formaterMontant(marge.marge, sale.currency)}
              </strong>
            </span>
            {marge.estime && <Badge variant="warning">estimée</Badge>}
          </p>
        </section>
      )}
    </div>
  )
}
