import { useState } from "react"
import { MAX_VARIANTES_CREATION } from "shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type VarianteSaisie = {
  name: string
  attributes: Record<string, string>
  barcode?: string
  priceOverride?: number
  minPriceOverride?: number
}

type PaireAttribut = { cle: string; valeur: string }

const PAIRE_VIDE: PaireAttribut = { cle: "", valeur: "" }

/**
 * Mirrors `genererSkuVariante` on the API side (apps/api/src/lib/sku.ts): the
 * variant SKU suffix derives from the attribute VALUES, never from the name.
 * Two variants whose values normalise the same collide on the unique SKU index
 * and make the API reject the whole creation, so the clash is caught here
 * instead of after the round trip. Both implementations must stay aligned.
 */
function suffixeSku(attributes: Record<string, string>): string {
  return Object.values(attributes)
    .map((valeur) =>
      valeur
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter((valeur) => valeur.length > 0)
    .join("-")
}

/**
 * Controlled variant list: holds the draft row locally and hands the committed
 * variants to its parent. It issues no request — variants travel with the
 * creation call, so nothing here is persisted until the product is submitted.
 */
export function FormulaireVariantes({
  value,
  onChange,
}: {
  value: VarianteSaisie[]
  onChange: (variantes: VarianteSaisie[]) => void
}) {
  const [nom, setNom] = useState("")
  const [attributs, setAttributs] = useState<PaireAttribut[]>([PAIRE_VIDE])
  const [prix, setPrix] = useState("")
  const [plancher, setPlancher] = useState("")
  const [codeBarres, setCodeBarres] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  const ajouter = () => {
    if (value.length >= MAX_VARIANTES_CREATION) {
      // Mirrors the API bound: past it the whole creation is refused, so the
      // cap is enforced before the user keeps typing.
      setErreur(`Maximum ${MAX_VARIANTES_CREATION} variantes par produit`)
      return
    }
    if (!nom.trim()) {
      setErreur("Donnez un nom à la variante")
      return
    }
    const attributes: Record<string, string> = {}
    const clesVues = new Set<string>()
    for (const { cle, valeur } of attributs) {
      if (!cle.trim() || !valeur.trim()) continue
      // Silently keeping the last value would drop what the user typed first.
      if (clesVues.has(cle.trim())) {
        setErreur(`L'attribut « ${cle.trim()} » est renseigné deux fois`)
        return
      }
      clesVues.add(cle.trim())
      attributes[cle.trim()] = valeur.trim()
    }
    if (Object.keys(attributes).length === 0) {
      // Without an attribute the API generates the same SKU as the implicit
      // "Standard" variant and refuses the whole creation.
      setErreur("Renseignez au moins un attribut (ex. taille, couleur)")
      return
    }
    const suffixe = suffixeSku(attributes)
    if (value.some((v) => suffixeSku(v.attributes) === suffixe)) {
      // The clash is on normalised values, so distinct keys or a different
      // name do not avoid it: « teinte: Rouge » and « couleur: Rouge » both
      // yield "-ROUGE".
      setErreur(
        `Une variante produit déjà la même référence « ${suffixe} » — changez la valeur d'un attribut`
      )
      return
    }
    // Validate prices: must be integers and positive if provided.
    if (prix) {
      const prixNum = Number(prix)
      if (!Number.isInteger(prixNum) || prixNum <= 0) {
        setErreur("Le prix doit être un entier positif")
        return
      }
    }
    if (plancher) {
      const plancherNum = Number(plancher)
      if (!Number.isInteger(plancherNum) || plancherNum <= 0) {
        setErreur("Le plancher doit être un entier positif")
        return
      }
    }
    const variante: VarianteSaisie = { name: nom.trim(), attributes }
    if (prix) variante.priceOverride = Number(prix)
    if (plancher) variante.minPriceOverride = Number(plancher)
    if (codeBarres.trim()) variante.barcode = codeBarres.trim()

    onChange([...value, variante])
    setNom("")
    setAttributs([PAIRE_VIDE])
    setPrix("")
    setPlancher("")
    setCodeBarres("")
    setErreur(null)
  }

  return (
    <div className="flex flex-col gap-3">
      {value.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-md border">
          {value.map((variante, index) => (
            <li
              key={`${variante.name}-${index}`}
              className="flex items-center justify-between gap-2 px-2 py-1.5"
            >
              {/* min-w-0 + break-words: an attribute VALUE is free text, and a
                  long unbroken one (a supplier reference pasted in) used to set
                  the flex item's automatic minimum to its own width and push
                  the whole page 200px past the viewport, "Retirer" included. */}
              <span className="min-w-0 text-xs break-words">
                {variante.name}{" "}
                <span className="text-muted-foreground">
                  ·{" "}
                  {Object.entries(variante.attributes)
                    .map(([cle, valeur]) => `${cle} : ${valeur}`)
                    .join(", ")}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Retirer la variante ${variante.name}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="v-nom">Nom (ex : M / Rouge)</Label>
        <Input
          id="v-nom"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Attributs</Label>
        {/* Own wrapper so the gap BETWEEN pairs (12px) beats the gap INSIDE a
            stacked pair (8px) below `sm`. Without it the two gaps would read
            6px vs 8px and the pairs would visually merge into one column of
            anonymous fields. Back to the parent's rhythm from `sm` on, where
            each pair is a single row again. */}
        <div className="flex flex-col gap-3 sm:gap-1.5">
          {attributs.map((paire, index) => (
            // Stacked below `sm`: side by side, the pair shrinks to 132px per
            // field once "Retirer" takes its 62px — under the readable width
            // for a free-text attribute.
            <div key={index} className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label={`Attribut ${index + 1} — nom`}
                placeholder="taille"
                value={paire.cle}
                onChange={(e) =>
                  setAttributs(
                    attributs.map((item, i) =>
                      i === index ? { ...item, cle: e.target.value } : item
                    )
                  )
                }
              />
              <Input
                aria-label={`Attribut ${index + 1} — valeur`}
                placeholder="M"
                value={paire.valeur}
                onChange={(e) =>
                  setAttributs(
                    attributs.map((item, i) =>
                      i === index ? { ...item, valeur: e.target.value } : item
                    )
                  )
                }
              />
              {/* Adding pairs without being able to remove one forced the user
                  to abandon the whole draft over a single mistyped key. The
                  last remaining pair stays, since a variant needs one
                  attribute. */}
              {attributs.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  // `self-start` only matters while stacked, where the default
                  // stretch would blow the button up to the full width. From
                  // `sm` on it is inert: the button has a fixed height, so
                  // stretch already resolved to flex-start.
                  className="self-start"
                  aria-label={`Retirer l'attribut ${index + 1}`}
                  onClick={() =>
                    setAttributs(attributs.filter((_, i) => i !== index))
                  }
                >
                  Retirer
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setAttributs([...attributs, PAIRE_VIDE])}
        >
          Ajouter un attribut
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="v-prix">Prix (optionnel)</Label>
          <Input
            id="v-prix"
            type="number"
            min={1}
            step={1}
            value={prix}
            onChange={(e) => setPrix(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="v-plancher">Plancher (optionnel)</Label>
          <Input
            id="v-plancher"
            type="number"
            min={1}
            step={1}
            value={plancher}
            onChange={(e) => setPlancher(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="v-barcode">Code-barres (optionnel)</Label>
          <Input
            id="v-barcode"
            autoComplete="off"
            spellCheck={false}
            value={codeBarres}
            onChange={(e) => setCodeBarres(e.target.value)}
          />
        </div>
      </div>

      {/* break-words: these messages quote what the user typed — an attribute
          key, or the normalised SKU suffix built from attribute VALUES. A
          60-character supplier reference pasted as a value overflows the 343px
          available at 375px and <main> does not clip, exactly like the variant
          list above. No min-w-0 needed here, unlike the <span> in that list:
          this <p> is a block in a column, its width is already the
          container's. */}
      {erreur && (
        <p role="alert" className="text-xs break-words text-destructive">
          {erreur}
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={ajouter}
      >
        Ajouter la variante
      </Button>
    </div>
  )
}
