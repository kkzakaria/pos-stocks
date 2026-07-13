import { useState } from "react"
import { formaterMontant } from "@/lib/format"
import { monnaieARendre, resteAPayer } from "@/lib/pos"
import { usePiegeFocus } from "@/lib/use-piege-focus"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SalePaymentInput } from "shared"

type Props = {
  total: number
  enCours: boolean
  erreur: string | null
  onValider: (paiements: SalePaymentInput[]) => void
  onFermer: () => void
}

const BILLETS = [500, 1000, 2000, 5000, 10000] as const

// Modale de paiement (spec §7) : total en très grand, Espèces / Mobile
// money CUMULABLES (mixte), billets rapides qui s'ADDITIONNENT, monnaie à
// rendre en énorme dès que reçu ≥ dû. Composant PUR : la vente part par
// onValider(paiements) — l'idempotence et l'API vivent dans l'écran (T15).
export function ModalePaiement({
  total,
  enCours,
  erreur,
  onValider,
  onFermer,
}: Props) {
  // Cash : montant TENDU par le client (les billets s'additionnent)
  const [recu, setRecu] = useState(0)
  const [mobileVisible, setMobileVisible] = useState(false)
  const [montantMobile, setMontantMobile] = useState("")
  const [reference, setReference] = useState("")

  const mobile = Math.min(Number(montantMobile || "0"), total)
  const duCash = total - mobile
  const monnaie = monnaieARendre(duCash, recu)
  // Résiduel cash délégué à la logique pure T12 (paiement « cash » courant,
  // pas encore soumis, représenté comme un paiement provisoire unique).
  const reste = resteAPayer(duCash, [{ method: "cash", amount: recu }])
  const referenceManquante = mobile > 0 && reference.trim() === ""
  const pretAValider = reste === 0 && !referenceManquante && !enCours

  // Piège de focus mutualisé (usePiegeFocus) : focus initial sur le conteneur
  // — pas d'action par défaut évidente ici (billets, mobile money, valider…) —,
  // rattrapage des échappées pointeur, bouclage Tab/Shift+Tab et Échap pour
  // fermer. Les deux fuites P6 sont colmatées dans le hook.
  const { conteneurRef, gererClavier } = usePiegeFocus<HTMLDivElement>(onFermer)

  function valider() {
    const paiements: SalePaymentInput[] = []
    if (mobile > 0) {
      paiements.push({
        method: "mobile_money",
        amount: mobile,
        reference: reference.trim(),
      })
    }
    if (duCash > 0) {
      paiements.push({
        method: "cash",
        amount: duCash,
        ...(recu > 0 ? { receivedAmount: recu } : {}),
      })
    }
    onValider(paiements)
  }

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/50 p-4">
      <div
        ref={conteneurRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modale-paiement-titre"
        tabIndex={-1}
        onKeyDown={gererClavier}
        className="w-full max-w-lg rounded-lg bg-card p-5 outline-none"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p
              id="modale-paiement-titre"
              className="text-sm text-muted-foreground"
            >
              Total à encaisser
            </p>
            <p className="text-5xl font-bold tabular-nums">
              {formaterMontant(total)}
            </p>
          </div>
          <button
            onClick={onFermer}
            aria-label="Fermer"
            // border-box : 44×44 au doigt (padding absorbé), compact à la souris.
            className="inline-flex items-center justify-center rounded p-2 text-2xl leading-none pointer-coarse:size-11"
          >
            ×
          </button>
        </div>

        <p className="mb-1 text-sm font-medium">Espèces reçues</p>
        <div className="mb-2 flex flex-wrap gap-2">
          {BILLETS.map((billet) => (
            <Button
              key={billet}
              variant="outline"
              className="min-h-12 flex-1"
              onClick={() => setRecu((r) => r + billet)}
            >
              {billet.toLocaleString("fr-FR")}
            </Button>
          ))}
          <Button
            variant="outline"
            className="min-h-12"
            onClick={() => setRecu(duCash)}
          >
            Montant exact
          </Button>
          <Button
            variant="outline"
            className="min-h-12"
            onClick={() => setRecu(0)}
          >
            Effacer
          </Button>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Reçu : <strong>{formaterMontant(recu)}</strong>
          {reste > 0 && (
            <span className="ml-2">
              reste à payer <strong>{formaterMontant(reste)}</strong>
            </span>
          )}
        </p>

        <Button
          variant="outline"
          className="mb-2 w-full"
          onClick={() =>
            setMobileVisible((v) => {
              // Masquer réinitialise le montant/la référence : sinon un
              // montant mobile caché continue à réduire duCash, part comme
              // paiement mobile_money dans valider(), et peut bloquer la
              // validation si la référence a été laissée vide.
              if (v) {
                setMontantMobile("")
                setReference("")
              }
              return !v
            })
          }
        >
          Mobile money
        </Button>
        {mobileVisible && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="montant-mobile">Montant mobile money</Label>
              <Input
                id="montant-mobile"
                inputMode="numeric"
                value={montantMobile}
                onChange={(e) => setMontantMobile(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="reference-mobile">Référence</Label>
              <Input
                id="reference-mobile"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>
        )}

        {monnaie > 0 && (
          <p
            data-testid="monnaie"
            className="my-3 rounded bg-success/10 py-3 text-center text-4xl font-bold text-success tabular-nums"
          >
            Monnaie : {formaterMontant(monnaie)}
          </p>
        )}
        {erreur && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {erreur}
          </p>
        )}
        <Button
          className="min-h-14 w-full text-lg"
          disabled={!pretAValider}
          onClick={valider}
        >
          {enCours ? "Validation…" : "Valider la vente"}
        </Button>
      </div>
    </div>
  )
}
