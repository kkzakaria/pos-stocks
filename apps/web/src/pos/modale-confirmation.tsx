import { useRef } from "react"
import { formaterMontant } from "@/lib/format"
import { usePiegeFocus } from "@/lib/use-piege-focus"
import type { VenteDetail } from "@/lib/pos-api"
import { Button } from "@/components/ui/button"

type Props = {
  vente: VenteDetail
  onNouvelleVente: () => void
  onReimprimer: () => void
}

// Confirmation de vente (spec §7) : n° de ticket, monnaie à rendre en énorme,
// réimpression ou nouvelle vente. Vraie modale (role="dialog" + piège de
// focus mutualisé) au même titre que la modale de paiement : le focus initial
// va sur « Nouvelle vente » (Entrée enchaîne une vente), Échap referme.
export function ModaleConfirmation({
  vente,
  onNouvelleVente,
  onReimprimer,
}: Props) {
  const nouvelleVenteRef = useRef<HTMLButtonElement>(null)
  const { conteneurRef, gererClavier } = usePiegeFocus<HTMLDivElement>(
    onNouvelleVente,
    { focusInitial: nouvelleVenteRef }
  )
  const monnaie = vente.payments.reduce(
    (somme, p) => somme + (p.changeGiven ?? 0),
    0
  )

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4 print:hidden">
      <div
        ref={conteneurRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modale-confirmation-titre"
        tabIndex={-1}
        onKeyDown={gererClavier}
        className="w-full max-w-md rounded-lg bg-card p-6 text-center outline-none"
      >
        <p id="modale-confirmation-titre" className="text-lg font-semibold">
          Vente n° {vente.ticketNumber} enregistrée
        </p>
        {monnaie > 0 && (
          <p className="my-4 text-5xl font-bold text-success tabular-nums">
            Monnaie : {formaterMontant(monnaie)}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            className="min-h-14 flex-1"
            // `<ImpressionTicket>` reste monté (via portail vers document.body,
            // `onImprime` no-op) tant que la confirmation est affichée : le
            // ticket est déjà dans le DOM hors de `<main>`, donc `window.print()`
            // direct suffit à le réimprimer.
            onClick={onReimprimer}
          >
            Réimprimer
          </Button>
          <Button
            ref={nouvelleVenteRef}
            className="min-h-14 flex-1 text-lg"
            onClick={onNouvelleVente}
          >
            Nouvelle vente
          </Button>
        </div>
      </div>
    </div>
  )
}
