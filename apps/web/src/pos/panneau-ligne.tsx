import { useState } from "react"
import { Minus, Plus, Trash2, Pencil, Warehouse } from "lucide-react"
import { formaterMontant } from "@/lib/format"
import type { LignePanier } from "@/lib/pos"
import { Button } from "@/components/ui/button"

type Props = {
  ligne: LignePanier
  erreurPrix: string | null
  onQuantite: (quantite: number) => void
  onPrix: (prix: number) => void
  onSupprimer: () => void
  onDepanner: () => void
  onFermer: () => void
}

const TOUCHES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const

/**
 * Cart line editor (spec §7): a dedicated quantity block with a `− N +`
 * stepper (the most frequent action, applied immediately), a distinct
 * negotiated-price block showing the catalog price struck through when it
 * differs, a contextual numeric keypad shown only while typing a new value,
 * plus depannage (source warehouse) and a clear "remove item" action.
 */
export function PanneauLigne({
  ligne,
  erreurPrix,
  onQuantite,
  onPrix,
  onSupprimer,
  onDepanner,
  onFermer,
}: Props) {
  // `edition` = quel champ le pavé numérique édite (null = pavé masqué). Les
  // deux préoccupations (quantité / prix) sont ainsi visuellement distinctes.
  const [edition, setEdition] = useState<"quantite" | "prix" | null>(null)
  const [saisie, setSaisie] = useState("")
  const prixNegocie = ligne.prixUnitaire !== ligne.prixCatalogue

  function ouvrir(champ: "quantite" | "prix") {
    setEdition(champ)
    setSaisie("")
  }
  function fermerPave() {
    setEdition(null)
    setSaisie("")
  }
  function appliquer() {
    if (saisie === "") {
      fermerPave()
      return
    }
    const valeur = Number(saisie)
    if (edition === "quantite") onQuantite(Math.max(1, valeur))
    else onPrix(valeur)
    fermerPave()
  }

  return (
    <div className="flex h-full w-full flex-col border-l bg-card">
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{ligne.nom}</p>
          {ligne.sourceNom && (
            <span className="mt-1 inline-block rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
              réserve {ligne.sourceNom}
            </span>
          )}
        </div>
        <button
          onClick={onFermer}
          aria-label="Fermer"
          // border-box : 44×44 au doigt (padding absorbé), compact à la souris.
          className="inline-flex shrink-0 items-center justify-center rounded p-2 text-xl leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:size-11"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Quantité : stepper toujours visible ; taper le nombre ouvre le pavé. */}
        <div className="border-b p-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Quantité
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-12 shrink-0"
              aria-label="Diminuer la quantité"
              disabled={ligne.quantite <= 1}
              onClick={() => onQuantite(ligne.quantite - 1)}
            >
              <Minus className="size-5" />
            </Button>
            <button
              type="button"
              onClick={() => ouvrir("quantite")}
              aria-label="Saisir une quantité précise"
              className="flex-1 rounded-md py-2 text-center text-3xl font-bold tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              {edition === "quantite" && saisie !== ""
                ? saisie
                : ligne.quantite}
            </button>
            <Button
              variant="outline"
              size="icon"
              className="size-12 shrink-0"
              aria-label="Augmenter la quantité"
              onClick={() => onQuantite(ligne.quantite + 1)}
            >
              <Plus className="size-5" />
            </Button>
          </div>
        </div>

        {/* Prix convenu : prix courant + catalogue barré si négocié + Modifier. */}
        <div className="border-b p-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Prix convenu (unité)
          </p>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums">
                {edition === "prix" && saisie !== ""
                  ? saisie
                  : formaterMontant(ligne.prixUnitaire)}
              </p>
              {prixNegocie && (
                <p className="text-xs text-muted-foreground">
                  Catalogue{" "}
                  <s className="tabular-nums">
                    {formaterMontant(ligne.prixCatalogue)}
                  </s>
                </p>
              )}
            </div>
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => ouvrir("prix")}
            >
              <Pencil />
              Modifier
            </Button>
          </div>
          {erreurPrix && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {erreurPrix}
            </p>
          )}
        </div>

        {/* Pavé numérique : uniquement en édition, avec libellé et Annuler. */}
        {edition !== null && (
          <div className="border-b p-2">
            <div className="flex items-center justify-between px-2 pb-1">
              <p className="text-xs text-muted-foreground">
                {edition === "quantite" ? "Nouvelle quantité" : "Nouveau prix"}
              </p>
              <Button variant="ghost" size="sm" onClick={fermerPave}>
                Annuler
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {TOUCHES.map((touche) => (
                <Button
                  key={touche}
                  variant="outline"
                  className="min-h-12 text-lg"
                  onClick={() => setSaisie((s) => s + touche)}
                >
                  {touche}
                </Button>
              ))}
              <Button
                variant="outline"
                className="min-h-12"
                aria-label="Effacer un chiffre"
                onClick={() => setSaisie((s) => s.slice(0, -1))}
              >
                ⌫
              </Button>
              <Button className="min-h-12" onClick={appliquer}>
                OK
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t p-3">
        <Button variant="outline" onClick={onDepanner}>
          <Warehouse />
          Puiser dans un autre entrepôt…
        </Button>
        <Button variant="destructive" onClick={onSupprimer}>
          <Trash2 />
          Retirer l'article
        </Button>
      </div>
    </div>
  )
}
