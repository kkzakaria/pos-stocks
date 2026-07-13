import { useState } from "react"
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

// Panneau d'édition d'une ligne (spec §7) : pavé numérique quantité +/− et
// saisie directe, prix unitaire convenu (borné par le plancher côté
// lib/pos + serveur), suppression, dépannage.
export function PanneauLigne({
  ligne,
  erreurPrix,
  onQuantite,
  onPrix,
  onSupprimer,
  onDepanner,
  onFermer,
}: Props) {
  const [mode, setMode] = useState<"quantite" | "prix">("quantite")
  const [saisie, setSaisie] = useState("")

  function appliquer() {
    if (saisie === "") return
    const valeur = Number(saisie)
    if (mode === "quantite") onQuantite(valeur)
    else onPrix(valeur)
    setSaisie("")
  }

  return (
    <div className="flex h-full w-full flex-col border-l bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="text-sm font-semibold">{ligne.nom}</p>
          <p className="text-xs text-muted-foreground">
            {ligne.quantite} × {formaterMontant(ligne.prixUnitaire)}
            {ligne.sourceNom ? ` — ${ligne.sourceNom}` : ""}
          </p>
        </div>
        <button onClick={onFermer} aria-label="Fermer" className="p-2 text-xl">
          ×
        </button>
      </div>
      <div className="flex gap-1 p-2">
        <Button
          variant={mode === "quantite" ? "default" : "outline"}
          className="flex-1"
          onClick={() => {
            setMode("quantite")
            setSaisie("")
          }}
        >
          Quantité
        </Button>
        <Button
          variant={mode === "prix" ? "default" : "outline"}
          className="flex-1"
          onClick={() => {
            setMode("prix")
            setSaisie("")
          }}
        >
          Prix convenu
        </Button>
      </div>
      <p className="px-4 py-2 text-center text-3xl font-bold tabular-nums">
        {saisie === ""
          ? mode === "quantite"
            ? ligne.quantite
            : formaterMontant(ligne.prixUnitaire)
          : saisie}
      </p>
      {erreurPrix && (
        <p
          role="alert"
          className="px-4 pb-2 text-center text-sm text-destructive"
        >
          {erreurPrix}
        </p>
      )}
      <div className="grid grid-cols-3 gap-1 p-2">
        {mode === "quantite" && (
          <>
            <Button
              variant="outline"
              className="min-h-12"
              onClick={() => onQuantite(Math.max(1, ligne.quantite - 1))}
            >
              −
            </Button>
            <Button
              variant="outline"
              className="min-h-12"
              onClick={() => onQuantite(ligne.quantite + 1)}
            >
              +
            </Button>
            <span />
          </>
        )}
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
          onClick={() => setSaisie((s) => s.slice(0, -1))}
        >
          ⌫
        </Button>
        <Button className="min-h-12" onClick={appliquer}>
          OK
        </Button>
      </div>
      <div className="mt-auto flex flex-col gap-2 p-3">
        <Button variant="outline" onClick={onDepanner}>
          Puiser dans un autre entrepôt…
        </Button>
        <Button variant="destructive" onClick={onSupprimer}>
          Supprimer la ligne
        </Button>
      </div>
    </div>
  )
}
