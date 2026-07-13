import { formaterMontant } from "@/lib/format"
import { totalPanier } from "@/lib/pos"
import type { LignePanier } from "@/lib/pos"
import { Button } from "@/components/ui/button"

type Props = {
  lignes: LignePanier[]
  onChoisirLigne: (ligne: LignePanier) => void
  onEncaisser: () => void
}

export function Panier({ lignes, onChoisirLigne, onEncaisser }: Props) {
  const total = totalPanier(lignes)
  return (
    <aside className="flex h-full w-full flex-col border-l bg-card">
      <h2 className="border-b px-4 py-3 text-sm font-semibold text-muted-foreground">
        Panier
      </h2>
      <ul className="flex-1 overflow-y-auto">
        {lignes.length === 0 && (
          <li className="p-4 text-sm text-muted-foreground">
            Scannez ou touchez un article.
          </li>
        )}
        {lignes.map((ligne) => (
          <li key={`${ligne.variantId}|${ligne.sourceWarehouseId ?? ""}`}>
            <button
              onClick={() => onChoisirLigne(ligne)}
              className={`flex w-full items-start justify-between gap-2 px-4 py-3 text-left hover:bg-muted ${
                ligne.enAlerte ? "bg-destructive/10" : ""
              }`}
            >
              <span>
                <span className="block text-sm font-medium">{ligne.nom}</span>
                <span className="block text-xs text-muted-foreground">
                  {ligne.quantite} × {formaterMontant(ligne.prixUnitaire)}
                  {ligne.prixUnitaire !== ligne.prixCatalogue && (
                    <s className="ml-1">
                      {formaterMontant(ligne.prixCatalogue)}
                    </s>
                  )}
                </span>
                {ligne.sourceNom && (
                  <span className="mt-0.5 inline-block rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                    {ligne.sourceNom}
                  </span>
                )}
                {ligne.enAlerte && (
                  <span className="mt-0.5 block text-xs font-semibold text-destructive">
                    Stock insuffisant
                  </span>
                )}
              </span>
              <span className="text-sm font-semibold whitespace-nowrap">
                {formaterMontant(ligne.quantite * ligne.prixUnitaire)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t p-4">
        <p className="mb-3 flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-2xl font-bold">{formaterMontant(total)}</span>
        </p>
        <Button
          className="min-h-14 w-full text-lg"
          disabled={lignes.length === 0}
          onClick={onEncaisser}
        >
          ENCAISSER (F2)
        </Button>
      </div>
    </aside>
  )
}
