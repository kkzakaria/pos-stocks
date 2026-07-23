import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Produit } from "./types"

type Props = {
  produit: Produit
  productId: string
  peutEcrire: boolean
  devise: string
  /** Sum of visible warehouse quantities; null = no stock reading scope. */
  stockTotal: number | null
  onModifie: () => Promise<unknown>
}

/** One dense fact of the summary line: pale label above a tabular figure. */
function Fait({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{libelle}</span>
      <span className="text-sm font-medium tabular-nums">{valeur}</span>
    </div>
  )
}

/**
 * Summary band: price, floor price, alert threshold and total stock as a
 * single dense line of figures (registre style, no KPI cards). "Modifier"
 * switches the three product numbers to inline inputs, saved via a
 * partial PATCH.
 */
export function SectionSynthese({
  produit,
  productId,
  peutEcrire,
  devise,
  stockTotal,
  onModifie,
}: Props) {
  const [edition, setEdition] = useState(false)
  const [prix, setPrix] = useState(String(produit.price))
  const [plancher, setPlancher] = useState(
    produit.minPrice === null ? "" : String(produit.minPrice)
  )
  const [seuil, setSeuil] = useState(
    produit.defaultMinStock === null ? "" : String(produit.defaultMinStock)
  )
  const [erreur, setErreur] = useState<string | null>(null)

  const ouvrir = () => {
    setPrix(String(produit.price))
    setPlancher(produit.minPrice === null ? "" : String(produit.minPrice))
    setSeuil(
      produit.defaultMinStock === null ? "" : String(produit.defaultMinStock)
    )
    setErreur(null)
    setEdition(true)
  }

  const enregistrer = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/products/${productId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          price: Number(prix),
          minPrice: plancher === "" ? null : Number(plancher),
          defaultMinStock: seuil === "" ? null : Number(seuil),
        }),
      }),
    onSuccess: async () => {
      await onModifie()
      setEdition(false)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  if (edition) {
    return (
      <form
        className="flex flex-wrap items-end gap-3 border-y py-3"
        onSubmit={(e) => {
          e.preventDefault()
          setErreur(null)
          enregistrer.mutate()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sy-prix">Prix de vente</Label>
          <Input
            id="sy-prix"
            type="number"
            min={1}
            step={1}
            required
            className="w-32"
            value={prix}
            onChange={(e) => setPrix(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sy-plancher">Prix plancher</Label>
          <Input
            id="sy-plancher"
            type="number"
            min={1}
            step={1}
            className="w-32"
            value={plancher}
            onChange={(e) => setPlancher(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sy-seuil">Seuil d'alerte</Label>
          <Input
            id="sy-seuil"
            type="number"
            min={0}
            step={1}
            className="w-32"
            value={seuil}
            onChange={(e) => setSeuil(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={enregistrer.isPending}>
            {enregistrer.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setEdition(false)}
          >
            Annuler
          </Button>
        </div>
        {erreur && (
          <p role="alert" className="w-full text-sm text-destructive">
            {erreur}
          </p>
        )}
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-2 border-y py-3">
      <Fait
        libelle="Prix de vente"
        valeur={formaterMontant(produit.price, devise)}
      />
      <Fait
        libelle="Prix plancher"
        valeur={
          produit.minPrice === null
            ? "—"
            : formaterMontant(produit.minPrice, devise)
        }
      />
      <Fait
        libelle="Seuil d'alerte"
        valeur={
          produit.defaultMinStock === null
            ? "—"
            : String(produit.defaultMinStock)
        }
      />
      {stockTotal !== null && (
        <Fait libelle="Stock total" valeur={String(stockTotal)} />
      )}
      {peutEcrire && (
        <Button variant="ghost" size="sm" className="ml-auto" onClick={ouvrir}>
          Modifier
        </Button>
      )}
    </div>
  )
}
