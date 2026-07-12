import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { formaterMontant } from "@/lib/format"
import { fermerSession } from "@/lib/pos-api"
import type { SessionCaisse, SessionFermeture } from "@/lib/pos-api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Props = {
  session: SessionCaisse
  onFermee: () => void
  onAnnuler: () => void
}

// Fermeture de caisse (spec §7) : saisie du montant compté ; l'attendu
// (fond + encaissements cash) et l'écart sont calculés PAR LE SERVEUR à la
// fermeture et affichés au retour.
export function FermetureCaisse({ session, onFermee, onAnnuler }: Props) {
  const [compte, setCompte] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)
  const [resultat, setResultat] = useState<SessionFermeture | null>(null)
  const fermeture = useMutation({
    mutationFn: () => fermerSession(session.id, Number(compte || "0")),
    onSuccess: ({ session: fermee }) => setResultat(fermee),
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })
  const compteValide = /^\d+$/.test(compte)

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6">
        {resultat === null ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setErreur(null)
              fermeture.mutate()
            }}
          >
            <h2 className="mb-1 text-lg font-semibold">Fermer la caisse</h2>
            <p className="mb-4 text-sm text-gray-500">
              Fond d'ouverture : {formaterMontant(session.openingFloat)}
            </p>
            <Label htmlFor="compte">Montant compté en caisse (XOF)</Label>
            <Input
              id="compte"
              inputMode="numeric"
              autoFocus
              value={compte}
              onChange={(e) => setCompte(e.target.value)}
            />
            {erreur && (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {erreur}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={onAnnuler}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={!compteValide || fermeture.isPending}
              >
                {fermeture.isPending ? "Fermeture…" : "Fermer la caisse"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="text-center">
            <h2 className="mb-4 text-lg font-semibold">Caisse fermée</h2>
            <dl className="mb-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Compté</dt>
                <dd>{formaterMontant(resultat.countedAmount ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Attendu (fond + espèces)</dt>
                <dd>{formaterMontant(resultat.expectedCash ?? 0)}</dd>
              </div>
            </dl>
            <p
              className={`text-3xl font-bold tabular-nums ${
                (resultat.difference ?? 0) === 0
                  ? "text-green-700"
                  : "text-red-600"
              }`}
            >
              Écart : {formaterMontant(resultat.difference ?? 0)}
            </p>
            <Button className="mt-5 w-full" onClick={onFermee}>
              Terminer
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
