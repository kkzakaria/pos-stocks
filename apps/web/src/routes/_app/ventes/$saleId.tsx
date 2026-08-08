import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { formaterMontant } from "@/lib/format"
import { fetchVenteDetail } from "@/lib/rapports"
import type { LigneVente } from "@/lib/pos-api"
import { ErreurChargement } from "@/components/erreur-chargement"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"

export const Route = createFileRoute("/_app/ventes/$saleId")({
  component: DetailVente,
})

const LIBELLES_METHODE: Record<string, string> = {
  cash: "Espèces",
  mobile_money: "Mobile money",
}

/**
 * `LigneVente` with the ticket-level currency spliced in — the amount
 * columns and the card's headline value need it, but the API only returns
 * currency once on `VenteDetail`, not per line.
 */
export type LigneVenteAffichee = LigneVente & { currency: string }

/** Card mode: article name, with the variant appended when it isn't the default one. */
export function titreLigneVente(item: LigneVenteAffichee) {
  return item.variantName !== "Standard"
    ? `${item.productName} — ${item.variantName}`
    : item.productName
}

/** Card mode: the applied unit price is the headline figure. */
export function valeurLigneVente(item: LigneVenteAffichee) {
  return formaterMontant(item.unitPrice, item.currency)
}

export function sousTitreLigneVente(item: LigneVenteAffichee) {
  return item.sku
}

export const COLONNES_LIGNES_VENTE: ColonneAdaptative<LigneVenteAffichee>[] = [
  {
    cle: "article",
    entete: "Article",
    masquerEnCarte: true,
    classeCellule: "font-medium",
    cellule: titreLigneVente,
  },
  {
    cle: "sku",
    entete: "SKU",
    masquerEnCarte: true,
    classeCellule: "font-mono text-muted-foreground",
    cellule: sousTitreLigneVente,
  },
  {
    cle: "quantite",
    entete: "Qté",
    numeric: true,
    cellule: (item) => item.quantity,
  },
  {
    cle: "puApplique",
    entete: "PU appliqué",
    numeric: true,
    masquerEnCarte: true,
    cellule: valeurLigneVente,
  },
  {
    cle: "prixCatalogue",
    entete: "Prix catalogue",
    numeric: true,
    cellule: (item) => formaterMontant(item.catalogPrice, item.currency),
  },
  {
    cle: "remise",
    entete: "Remise",
    numeric: true,
    cellule: (item) =>
      formaterMontant(
        (item.catalogPrice - item.unitPrice) * item.quantity,
        item.currency
      ),
  },
  {
    cle: "source",
    entete: "Source",
    cellule: (item) => item.sourceWarehouseName,
  },
  {
    cle: "lot",
    entete: "Lot",
    classeCellule: "text-muted-foreground",
    cellule: (item) => item.lotNumber ?? "—",
  },
]

/** Ticket detail page: line items (applied unit price, discount, source, lot), payments, and margin (an "estimée" badge when the cost is approximated). */
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
  const lignes: LigneVenteAffichee[] = sale.items.map((item) => ({
    ...item,
    currency: sale.currency,
  }))
  return (
    <div>
      <Link to="/ventes" className="text-sm text-primary hover:underline">
        ← Historique
      </Link>
      <h1 className="mt-2 flex flex-col text-xl font-semibold sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-1.5">
        <span>Ticket n° {sale.ticketNumber}</span>
        <span className="break-words">— {sale.storeName}</span>
      </h1>
      <p className="text-sm text-muted-foreground">
        {new Date(sale.createdAt).toLocaleString("fr-FR")} · {sale.cashierName}
      </p>

      <div className="mt-4">
        <ListeAdaptative<LigneVenteAffichee>
          colonnes={COLONNES_LIGNES_VENTE}
          lignes={lignes}
          cleLigne={(item) => item.id}
          titre={titreLigneVente}
          valeur={valeurLigneVente}
          sousTitre={sousTitreLigneVente}
        />
      </div>
      <p className="mt-3 text-right text-lg font-semibold tabular-nums">
        Total : {formaterMontant(sale.total, sale.currency)}
      </p>

      <section className="mt-4">
        <h2 className="font-semibold">Paiements</h2>
        <ul className="mt-1 space-y-1 text-sm">
          {sale.payments.map((paiement, index) => (
            <li
              key={index}
              className="flex flex-col gap-0.5 border-b py-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
            >
              <span className="break-words">
                {LIBELLES_METHODE[paiement.method] ?? paiement.method}
                {paiement.reference && ` · réf. ${paiement.reference}`}
              </span>
              <span className="break-words tabular-nums">
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
