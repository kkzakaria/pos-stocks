import { useEffect } from "react"
import { formaterMontant } from "@/lib/format"
import type { ReglagesTicket, VenteDetail } from "@/lib/pos-api"

type PropsTicket = {
  sale: VenteDetail
  reglages: ReglagesTicket | null
}

// Ticket 80 mm (spec §7) : masqué à l'écran (`hidden`), seul contenu visible
// à l'impression (`print:block` + tout le reste du POS est `print:hidden`).
// @page 80mm : largeur des imprimantes thermiques de caisse.
export function TicketRecu({ sale, reglages }: PropsTicket) {
  const monnaie = sale.payments.reduce(
    (somme, p) => somme + (p.changeGiven ?? 0),
    0
  )
  return (
    <div className="ticket-80mm hidden font-mono text-xs print:block">
      <style>{`@media print { @page { size: 80mm auto; margin: 2mm } .ticket-80mm { width: 76mm } }`}</style>
      <div className="text-center">
        <p className="text-sm font-bold">{reglages?.name ?? sale.storeName}</p>
        {reglages?.receiptHeader ? (
          <p className="whitespace-pre-line">{reglages.receiptHeader}</p>
        ) : null}
        <p>{sale.storeName}</p>
        <p>
          Ticket n° {sale.ticketNumber} —{" "}
          {new Date(sale.createdAt).toLocaleString("fr-FR")}
        </p>
        <p>Caissier : {sale.cashierName}</p>
      </div>
      <hr className="my-1 border-dashed" />
      <table className="w-full">
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.id}>
              <td className="pr-1 align-top">
                {item.productName}
                {item.variantName !== "Standard" ? ` ${item.variantName}` : ""}
                <br />
                {item.quantity} × {formaterMontant(item.unitPrice)}
                {item.unitPrice !== item.catalogPrice
                  ? ` (cat. ${formaterMontant(item.catalogPrice)})`
                  : ""}
              </td>
              <td className="text-right align-bottom whitespace-nowrap">
                {formaterMontant(item.quantity * item.unitPrice)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr className="my-1 border-dashed" />
      <p className="flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{formaterMontant(sale.total)}</span>
      </p>
      {sale.payments.map((p, index) => (
        <p key={index} className="flex justify-between">
          <span>
            {p.method === "cash" ? "Espèces" : "Mobile money"}
            {p.reference ? ` (${p.reference})` : ""}
          </span>
          <span>{formaterMontant(p.amount)}</span>
        </p>
      ))}
      {monnaie > 0 && (
        <p className="flex justify-between">
          <span>Monnaie rendue</span>
          <span>{formaterMontant(monnaie)}</span>
        </p>
      )}
      {reglages?.receiptFooter ? (
        <>
          <hr className="my-1 border-dashed" />
          <p className="text-center whitespace-pre-line">
            {reglages.receiptFooter}
          </p>
        </>
      ) : null}
    </div>
  )
}

type PropsImpression = PropsTicket & { onImprime: () => void }

// Monte le ticket puis déclenche l'impression navigateur (spec §5 étape 7 :
// impression automatique après validation ; aussi utilisé en réimpression).
export function ImpressionTicket({
  sale,
  reglages,
  onImprime,
}: PropsImpression) {
  useEffect(() => {
    window.print()
    onImprime()
    // L'impression est un effet ponctuel au montage, volontairement.
  }, [])
  return <TicketRecu sale={sale} reglages={reglages} />
}
