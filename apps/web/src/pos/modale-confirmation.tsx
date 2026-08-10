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
    // `grid-cols-1` (i.e. `minmax(0, 1fr)`) rather than the implicit `auto`
    // column: an `auto` track is FLOORED at its item's min-content, and free
    // space is distributed only while it is POSITIVE, so an item that overflows
    // leaves the track pinned at that floor. An amount is one unbreakable run
    // (`formaterMontant` joins it with U+202F/U+00A0), so its min-content is
    // its full width: a large change due widened the track past the viewport
    // and took `w-full` with it. `position: fixed` hides this from any
    // document-level overflow check — measured at 375x667 before the fix,
    // change 75 000 F CFA: panel 352px wide for a 343px box, and it grows with
    // the amount.
    // The ZERO MINIMUM is what corrects this, not a bounded maximum: `1fr`
    // alone is `minmax(auto, 1fr)`, keeps the same min-content floor and
    // reproduces the defect. Never « simplify » this to `1fr`.
    // `print:hidden` stays on this overlay only: the 80mm receipt is portalled
    // to document.body, so it is never a descendant of this node.
    <div className="fixed inset-0 z-40 grid grid-cols-1 place-items-center bg-black/60 p-4 print:hidden">
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
          // Type step, not a redesign: the panel leaves 295px at 375, where
          // `text-5xl` renders 304px for a 75 000 F CFA change and 373px for a
          // 1 800 000 one. `text-4xl` renders 228px and 280px — the realistic
          // span fits — and matches the change line of the payment modal,
          // which is `text-4xl` already. Desktop keeps `text-5xl`.
          <p className="my-4 text-4xl font-bold text-success tabular-nums sm:text-5xl">
            Monnaie : {formaterMontant(monnaie)}
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
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
