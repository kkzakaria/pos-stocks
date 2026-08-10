import { useState } from "react"
import type { KeyboardEvent } from "react"
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
/** Payment modal: cash (stackable bills) and mobile money can be mixed, change due shown as soon as the amount received covers what's owed, Enter confirms when ready. */
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

  // Entrée encaisse : quand le paiement est prêt, Entrée valide la vente —
  // sauf si le focus est sur un bouton (billet, mobile money…), qui gère son
  // propre Entrée. Le piège de focus (Échap/Tab) tourne d'abord.
  function gererClavierPaiement(e: KeyboardEvent<HTMLElement>) {
    gererClavier(e)
    if (
      e.key === "Enter" &&
      pretAValider &&
      !(e.target instanceof HTMLButtonElement)
    ) {
      e.preventDefault()
      valider()
    }
  }

  return (
    // `grid-cols-1` (i.e. `minmax(0, 1fr)`) rather than the implicit `auto`
    // column: an `auto` track is FLOORED at its item's min-content — the base
    // size comes from the automatic minimum, and « Maximize Tracks »
    // distributes free space only while it is POSITIVE, so an item that
    // overflows leaves the track pinned at that floor. An amount is a single
    // unbreakable run (`formaterMontant` joins it with U+202F and U+00A0), so
    // its min-content equals its full width: the track — and `w-full` with it
    // — is pushed PAST the viewport. `position: fixed` keeps
    // `documentElement.scrollWidth === clientWidth`, so no document-level
    // overflow assertion can see it — measured at 375x812: panel 488px wide,
    // « Fermer » at x 440..484, entirely off-screen. 488 is the min-content of
    // the header, well under the 512px `max-w-lg` cap: had the track followed
    // the max-content (the seven pad buttons on one line) it would have hit
    // that cap, which is how we know the FLOOR is what sizes the track.
    // It is therefore the ZERO MINIMUM that corrects this, not a bounded
    // maximum: `1fr` alone is `minmax(auto, 1fr)`, keeps the same min-content
    // floor and reproduces the defect identically (measured in review: panel
    // at 512px, close button off-screen). Never « simplify » this to `1fr`.
    <div className="fixed inset-0 z-30 grid grid-cols-1 place-items-center bg-black/50 p-4">
      <div
        ref={conteneurRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modale-paiement-titre"
        tabIndex={-1}
        onKeyDown={gererClavierPaiement}
        className="w-full max-w-lg rounded-lg bg-card p-5 outline-none"
      >
        <div className="mb-4 flex items-start justify-between">
          {/* `min-w-0`: an amount is a single unbreakable run — `formaterMontant`
              joins it with U+202F and U+00A0 — so this flex item's automatic
              minimum size equals the full amount width. Without it the item
              refuses to shrink and shoves the close button out of the panel
              (measured at 375x812 before the fix: « Fermer » at x 440..472 for
              a panel ending at 359). With it, an amount too wide to fit
              overflows its own box and the close button stays put. */}
          <div className="min-w-0">
            <p
              id="modale-paiement-titre"
              className="text-sm text-muted-foreground"
            >
              Total à encaisser
            </p>
            {/* Type step, not a redesign: at 375 the header leaves 259px next
                to the 44px touch target, and `text-5xl` renders 273px for the
                SMALLEST realistic total (7 500 F CFA) and 404px for a
                multi-million one — every amount overflowed. `text-3xl` renders
                171px to 252px over that same range, so the whole realistic
                span fits. Desktop keeps `text-5xl` untouched (472px of room). */}
            <p className="text-3xl font-bold tabular-nums sm:text-5xl">
              {formaterMontant(total)}
            </p>
          </div>
          <button
            onClick={onFermer}
            aria-label="Fermer"
            // border-box : 44×44 au doigt (padding absorbé), compact à la souris.
            // `shrink-0`: the target never gives up pixels to a long amount.
            className="inline-flex shrink-0 items-center justify-center rounded p-2 text-2xl leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:size-11"
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
