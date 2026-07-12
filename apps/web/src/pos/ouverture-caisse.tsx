import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formaterMontant } from "@/lib/format"
import { ouvrirSession } from "@/lib/pos-api"

type Props = {
  boutiques: Array<{ id: string; name: string }>
  boutiqueId: string
  onChangeBoutique: (id: string) => void
  onOuverte: () => void
}

// Garde d'entrée du POS (spec §7) : impossible de vendre sans session de
// caisse ouverte. Choix de la boutique si plusieurs affectations + fond de
// caisse.
export function OuvertureCaisse({
  boutiques,
  boutiqueId,
  onChangeBoutique,
  onOuverte,
}: Props) {
  const [fond, setFond] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)
  const ouverture = useMutation({
    mutationFn: () => ouvrirSession(boutiqueId, Number(fond || "0")),
    onSuccess: onOuverte,
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })
  const fondValide = /^\d*$/.test(fond)

  return (
    <main className="grid min-h-screen place-items-center bg-gray-50 p-4">
      <form
        className="w-full max-w-sm rounded-lg border bg-white p-6"
        onSubmit={(e) => {
          e.preventDefault()
          setErreur(null)
          ouverture.mutate()
        }}
      >
        <h1 className="mb-1 text-xl font-semibold">Ouvrir la caisse</h1>
        <p className="mb-5 text-sm text-gray-500">
          Une session de caisse est requise avant de vendre.
        </p>
        {boutiques.length > 1 && (
          <div className="mb-4">
            <Label htmlFor="boutique">Boutique</Label>
            <select
              id="boutique"
              className="mt-1 w-full rounded border px-3 py-2"
              value={boutiqueId}
              onChange={(e) => onChangeBoutique(e.target.value)}
            >
              {boutiques.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="mb-4">
          <Label htmlFor="fond">Fond de caisse (XOF)</Label>
          <Input
            id="fond"
            inputMode="numeric"
            autoFocus
            value={fond}
            onChange={(e) => setFond(e.target.value)}
            placeholder="0"
          />
          {fond !== "" && fondValide && (
            <p className="mt-1 text-sm text-gray-500">
              {formaterMontant(Number(fond))}
            </p>
          )}
        </div>
        {erreur && (
          <p role="alert" className="mb-3 text-sm text-red-600">
            {erreur}
          </p>
        )}
        <Button
          type="submit"
          className="min-h-12 w-full text-base"
          disabled={!fondValide || ouverture.isPending}
        >
          {ouverture.isPending ? "Ouverture…" : "Ouvrir la caisse"}
        </Button>
      </form>
    </main>
  )
}
