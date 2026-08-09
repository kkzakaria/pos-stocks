import { useQuery } from "@tanstack/react-query"
import { fetchDisponibilites } from "@/lib/pos-api"
import { usePiegeFocus } from "@/lib/use-piege-focus"
import type { LignePanier } from "@/lib/pos"
import { Button } from "@/components/ui/button"

type Props = {
  storeId: string
  ligne: LignePanier
  onChoisir: (warehouseId: string | null, nom: string | null) => void
  onFermer: () => void
}

// Dépannage sur rupture (spec §5) : « puiser dans… » avec les entrepôts où
// l'article est disponible et leurs quantités. Le choix pose
// sourceWarehouseId sur la ligne (badge « réserve » au panier).
/** Stockout fallback dialog: lists the warehouses where the item is available and sets the chosen source on the cart line. */
export function DialogueDepannage({
  storeId,
  ligne,
  onChoisir,
  onFermer,
}: Props) {
  const dispo = useQuery({
    queryKey: ["pos-disponibilites", storeId, ligne.variantId],
    queryFn: () => fetchDisponibilites(storeId, ligne.variantId),
  })
  const disponibilites = dispo.data?.disponibilites ?? []
  const { conteneurRef, gererClavier } = usePiegeFocus<HTMLDivElement>(onFermer)
  return (
    // `grid-cols-1` (i.e. `minmax(0, 1fr)`) rather than the implicit `auto`
    // column: an `auto` track is FLOORED at its item's min-content, and free
    // space is distributed only while it is POSITIVE, so an item that overflows
    // leaves the track pinned at that floor. A product name with no break
    // opportunity has a min-content as wide as the name itself: the track — and
    // `w-full` with it — is pushed past the viewport. `position: fixed` hides
    // this from any document-level overflow check — measured at 375x812 before
    // the fix: panel 448px wide, « Fermer » at x 620..649, entirely off-screen.
    // The ZERO MINIMUM is what corrects this, not a bounded maximum: `1fr`
    // alone is `minmax(auto, 1fr)`, keeps the same min-content floor and
    // reproduces the defect. Never « simplify » this to `1fr`.
    <div className="fixed inset-0 z-30 grid grid-cols-1 place-items-center bg-black/50 p-4">
      <div
        ref={conteneurRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="depannage-titre"
        tabIndex={-1}
        onKeyDown={gererClavier}
        className="w-full max-w-md rounded-lg bg-card p-5 outline-none"
      >
        <div className="mb-3 flex items-start justify-between">
          {/* `min-w-0` so this flex item may shrink below the product name's
              own width, `break-words` so a SKU-shaped name (no space, no
              hyphen) wraps instead of pushing the close button out of reach. */}
          <div className="min-w-0">
            <h2 id="depannage-titre" className="text-lg font-semibold">
              Puiser dans…
            </h2>
            <p className="text-sm break-words text-muted-foreground">
              {ligne.nom}
            </p>
          </div>
          <button
            onClick={onFermer}
            aria-label="Fermer"
            // `shrink-0`: the touch target never gives up pixels to the name.
            className="inline-flex shrink-0 items-center justify-center rounded p-2 text-xl leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:size-11"
          >
            ×
          </button>
        </div>
        {dispo.isPending && (
          <p className="py-4 text-sm text-muted-foreground">
            Recherche des disponibilités…
          </p>
        )}
        {!dispo.isPending && disponibilites.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">
            Aucun autre entrepôt ne dispose de cet article.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {disponibilites.map((d) => (
            <Button
              key={d.warehouseId}
              variant="outline"
              className="min-h-12 justify-between"
              onClick={() => onChoisir(d.warehouseId, d.warehouseName)}
            >
              <span>{d.warehouseName}</span>
              <span className="text-sm text-muted-foreground">
                {d.quantity} disponible{d.quantity > 1 ? "s" : ""}
              </span>
            </Button>
          ))}
          {ligne.sourceWarehouseId !== null && (
            <Button
              variant="outline"
              className="min-h-12"
              onClick={() => onChoisir(null, null)}
            >
              Revenir au stock de la boutique
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
