import { useRef } from "react"
import type { ReactNode } from "react"
import { usePiegeFocus } from "@/lib/use-piege-focus"
import { Button } from "@/components/ui/button"

type Props = {
  onFermer: () => void
  children: ReactNode
}

/**
 * Mobile cart overlay (< md), rendered as an INLINE sibling in the DOM —
 * never a portal: the whole POS screen sits under `print:hidden`
 * (`ecran-vente.tsx`) and a portalled panel would escape it and print over
 * the 80mm receipt.
 *
 * Reuses the app's hand-rolled focus trap (`usePiegeFocus`, otherwise used
 * by `ModalePaiement`/`ModaleConfirmation`/`DialogueDepannage`) to cover
 * initial focus (on "Fermer"), Tab/Shift+Tab containment and Escape to
 * close, plus focus restored on unmount to whatever triggered the open (the
 * summary bar's "Voir le panier" button in practice).
 *
 * Deliberately NOT `role="dialog"`/`aria-modal`: this is explicitly not a
 * blocking modal (spec) — the barcode scan buffer and the `/`/F2/Delete
 * shortcuts stay live while it is open, so marking it modal would misinform
 * assistive tech about what the rest of the screen can still do. `role`
 * "region" + `aria-label` give it an accessible name without that claim,
 * and without colliding with `getByRole("dialog")` queries aimed at the
 * payment modal, which can be open at the same time (checkout triggered
 * from inside the cart leaves this panel mounted underneath it).
 *
 * `rattraperEchappees: false` on the trap: unlike the app's other
 * hand-rolled modals, THIS one can stay mounted while a higher-z sibling
 * modal (payment, depannage — both triggered from inside the cart) opens on
 * top of it. The trap's default pointer-escape catch is document-wide and
 * would fight that sibling's own trap for control of focus; this panel's
 * opaque, full-bleed background already leaves nothing reachable behind it,
 * so the catch buys nothing here.
 *
 * The trap's keydown handler only ever calls `preventDefault` for Tab at
 * the containment boundaries — never `stopPropagation` — so the GLOBAL
 * keydown listener in `ecran-vente.tsx` still sees every key that bubbles
 * past it, including scan characters, `/`, F2 and Delete.
 */
export function PanneauPanierMobile({ onFermer, children }: Props) {
  const fermerRef = useRef<HTMLButtonElement>(null)
  const { conteneurRef, gererClavier } = usePiegeFocus<HTMLDivElement>(
    onFermer,
    { focusInitial: fermerRef, rattraperEchappees: false }
  )
  return (
    <div
      ref={conteneurRef}
      data-slot="panneau-panier"
      role="region"
      aria-label="Panier"
      tabIndex={-1}
      onKeyDown={gererClavier}
      className="absolute inset-0 z-20 flex flex-col overscroll-contain bg-card print:hidden"
    >
      {/* No own "Panier" heading here: `<Panier>` (in `children`) renders
          its own header just below — a second one would be a visible
          duplicate for no reason. */}
      <div className="flex items-center justify-end border-b px-3 py-2">
        <Button ref={fermerRef} variant="ghost" onClick={onFermer}>
          Fermer
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
