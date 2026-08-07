import { Button } from "@/components/ui/button"
import { formaterMontant } from "@/lib/format"
import { totalPanier } from "@/lib/pos"
import type { LignePanier } from "@/lib/pos"

type Props = {
  lignes: LignePanier[]
  /**
   * Deliberately unwired for now: no caller passes it, so this always
   * renders XOF. The app is NOT mono-currency (an organization setting;
   * each sale carries its own) — a tracked deferral will propagate
   * `reglages.data.currency` through `Panier`, `ModalePaiement` and
   * `BarreSynthese` together, in one pass, since wiring this alone would
   * show a XOF cart under a EUR summary bar.
   */
  devise?: string
  /** Cart locked after an ambiguous submission: checkout stays disabled. */
  verrouille: boolean
  onOuvrirPanier: () => void
  onEncaisser: () => void
}

/**
 * Collapsed cart summary shown below `md`, replacing the permanent cart
 * column: item count and running total, tap to expand the cart panel
 * (`ecran-vente.tsx`), plus a direct checkout button. Never recomputes the
 * total itself — delegates to `totalPanier`.
 */
export function BarreSynthese({
  lignes,
  devise = "XOF",
  verrouille,
  onOuvrirPanier,
  onEncaisser,
}: Props) {
  const total = totalPanier(lignes)
  return (
    <div className="flex items-center justify-between gap-3 border-t bg-card px-3 py-2 print:hidden">
      <button
        type="button"
        onClick={onOuvrirPanier}
        aria-label="Voir le panier"
        className="flex min-h-11 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className="text-sm text-muted-foreground">
          {lignes.length} article{lignes.length > 1 ? "s" : ""}
        </span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <span className="font-medium tabular-nums">
          {formaterMontant(total, devise)}
        </span>
      </button>
      <Button
        disabled={lignes.length === 0 || verrouille}
        onClick={onEncaisser}
        className="shrink-0"
      >
        Encaisser
      </Button>
    </div>
  )
}
