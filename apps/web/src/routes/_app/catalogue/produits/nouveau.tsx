import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { usePeutEcrire } from "@/lib/permissions"
import { validerRechercheProduits } from "@/lib/recherche-produits"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { ChampImage } from "@/components/produit/champ-image"
import { FormulaireVariantes } from "@/components/produit/formulaire-variantes"
import type { VarianteSaisie } from "@/components/produit/formulaire-variantes"

export const Route = createFileRoute("/_app/catalogue/produits/nouveau")({
  // The list's filters ride along so that Cancel returns to the exact view.
  validateSearch: validerRechercheProduits,
  component: NouveauProduitPage,
})

type Categorie = { id: string; name: string }

function NouveauProduitPage() {
  const navigate = useNavigate()
  const peutEcrire = usePeutEcrire()
  const { q, categorie, page } = Route.useSearch()
  const retour = {
    to: "/catalogue/produits",
    search: { q, categorie, page },
  } as const

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 w-fit"
          onClick={() => void navigate(retour)}
        >
          ← Produits
        </Button>
        <h1 className="text-xl font-semibold">Nouveau produit</h1>
      </div>
      {peutEcrire ? (
        <FormulaireCreationProduit
          categories={categories.data?.categories ?? []}
          categoriesEnErreur={categories.isError}
          surSucces={(productId) =>
            void navigate({
              to: "/catalogue/produits/$productId",
              params: { productId },
            })
          }
          surAnnulation={() => void navigate(retour)}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Vous n'avez pas le droit de créer un produit.
        </p>
      )}
    </div>
  )
}

/**
 * Creation form, exported on its own so it can be tested without a router.
 * Everything is held locally and submitted as a single multipart call: nothing
 * is created until the user validates.
 */
export function FormulaireCreationProduit({
  categories,
  categoriesEnErreur = false,
  surSucces,
  surAnnulation,
}: {
  categories: Categorie[]
  categoriesEnErreur?: boolean
  surSucces: (productId: string) => void
  surAnnulation?: () => void
}) {
  const queryClient = useQueryClient()
  const [nom, setNom] = useState("")
  const [description, setDescription] = useState("")
  const [categorieId, setCategorieId] = useState("")
  const [codeBarres, setCodeBarres] = useState("")
  const [prix, setPrix] = useState("")
  const [plancher, setPlancher] = useState("")
  const [seuilAlerte, setSeuilAlerte] = useState("")
  const [suiviLots, setSuiviLots] = useState(false)
  const [image, setImage] = useState<File | null>(null)
  const [preparationImage, setPreparationImage] = useState(false)
  const [variantes, setVariantes] = useState<VarianteSaisie[]>([])
  const [blocVariantes, setBlocVariantes] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const idsCategories = categories.map((c) => c.id)
  const nomCategorie = (id: string) =>
    categories.find((c) => c.id === id)?.name ?? id

  const creer = useMutation({
    mutationFn: () => {
      const donnees: Record<string, unknown> = {
        name: nom,
        price: Number(prix),
      }
      // Trimmed before the truthiness test: a whitespace-only paste used to
      // travel to the server and come back as Zod's default English message,
      // which apiFetch surfaces over the envelope's own.
      if (description.trim()) donnees.description = description.trim()
      if (categorieId) donnees.categoryId = categorieId
      if (codeBarres.trim()) donnees.barcode = codeBarres.trim()
      if (plancher) donnees.minPrice = Number(plancher)
      if (seuilAlerte) donnees.defaultMinStock = Number(seuilAlerte)
      if (suiviLots) donnees.trackLots = true
      if (variantes.length > 0) donnees.variants = variantes

      const corps = new FormData()
      corps.append("donnees", JSON.stringify(donnees))
      if (image) corps.append("image", image)
      // No content-type header: the browser sets the multipart boundary.
      // Extended timeout (default is 15s): this body can carry up to a 2 MB
      // image, and on a slow link a client-side abort could race a server
      // commit that already succeeded, leading to a non-idempotent retry.
      return apiFetch<{ id: string; sku: string }>(
        "/api/v1/products",
        {
          method: "POST",
          body: corps,
        },
        60000
      )
    },
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["products"] })
      surSucces(res.id)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        // Defence in depth, NOT a keyboard workaround: implicit submission
        // (Enter in a text field) fires a click on the form's default button
        // and does nothing when that button is disabled, so the `disabled`
        // below already covers the keyboard. This guard is what survives
        // someone dropping that `disabled`, and it is the only thing covering
        // a programmatic `requestSubmit()`.
        // What it protects, in both cases a write that cannot be replayed:
        // submitting mid-preparation creates the product WITHOUT its image
        // (the field hands the prepared file over through `onChange` only at
        // the end, so the preparation lands nowhere), and submitting while a
        // creation is in flight creates a SECOND product.
        if (preparationImage || creer.isPending) return
        setErreur(null)
        creer.mutate()
      }}
    >
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Identité</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-nom">Nom</Label>
          <Input
            id="p-nom"
            required
            autoComplete="off"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-description">Description (optionnel)</Label>
          <Textarea
            id="p-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-categorie">Catégorie</Label>
          <Combobox
            items={idsCategories}
            itemToStringLabel={nomCategorie}
            autoHighlight
            value={categorieId || null}
            onValueChange={(valeur) => setCategorieId(valeur ?? "")}
          >
            <ComboboxInput
              id="p-categorie"
              placeholder="— aucune —"
              showClear
              className="w-full"
            />
            <ComboboxContent>
              <ComboboxEmpty>Aucune catégorie trouvée</ComboboxEmpty>
              <ComboboxList>
                {(id: string) => (
                  <ComboboxItem key={id} value={id}>
                    {nomCategorie(id)}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          {/* An empty list after a failed request is indistinguishable from an
              organisation with no category at all: say which one it is. The
              category stays optional, so submission is never blocked. */}
          {categoriesEnErreur && (
            <p role="alert" className="text-xs text-destructive">
              La liste des catégories n'a pas pu être chargée.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-barcode">Code-barres (optionnel)</Label>
          <Input
            id="p-barcode"
            autoComplete="off"
            spellCheck={false}
            value={codeBarres}
            onChange={(e) => setCodeBarres(e.target.value)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Prix</h2>
        {/* Side by side from `sm` on. Below it the two amounts would sit at
            165px each, which fits but leaves a XOF amount barely readable. */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="p-prix">Prix de vente</Label>
            <Input
              id="p-prix"
              type="number"
              min={1}
              step={1}
              required
              value={prix}
              onChange={(e) => setPrix(e.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="p-plancher">Prix plancher (optionnel)</Label>
            <Input
              id="p-plancher"
              type="number"
              min={1}
              step={1}
              value={plancher}
              onChange={(e) => setPlancher(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Stock</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-seuil-alerte">
            Seuil d'alerte par défaut (optionnel)
          </Label>
          <Input
            id="p-seuil-alerte"
            type="number"
            min={0}
            step={1}
            value={seuilAlerte}
            onChange={(e) => setSeuilAlerte(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Alerte quand le stock d'un entrepôt passe sous ce seuil —
            surchargeable par entrepôt.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="p-suivi-lots"
            checked={suiviLots}
            onCheckedChange={(valeur) => setSuiviLots(valeur === true)}
          />
          {/* `pointer-coarse:min-h-11` — the same 44px means button, input and
              select already use. The box itself is covered: `Checkbox` grows a
              44px `before:` overlay on touch. Its label is not, and it is the
              wider half of the control (measured 184 x 14px at 375px against
              the box's 16px), so the reachable band was the label's 14px over
              most of its length while every other target on this screen is at
              44. The label is `flex items-center`, so `min-h` centres the text
              rather than pushing it up, and the row's own `items-center` keeps
              the box aligned on it. */}
          <Label htmlFor="p-suivi-lots" className="pointer-coarse:min-h-11">
            Suivre les lots (péremption)
          </Label>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          Image{" "}
          <span className="font-normal text-muted-foreground">
            (facultatif)
          </span>
        </h2>
        <ChampImage
          value={image}
          onChange={setImage}
          surPreparation={setPreparationImage}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          Variantes{" "}
          <span className="font-normal text-muted-foreground">
            (facultatif)
          </span>
        </h2>
        {blocVariantes ? (
          <FormulaireVariantes value={variantes} onChange={setVariantes} />
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => setBlocVariantes(true)}
          >
            Ce produit se décline
          </Button>
        )}
      </section>

      {/* break-words: the API phrases its conflicts around user text — « Le
          SKU « … » de la variante « … » est déjà utilisé » — where the variant
          name is raw input and the SKU tail a normalised attribute value. An
          unbroken 60-character token overflows the 343px available at 375px,
          and <main> does not clip. No min-w-0 needed, unlike the flex item in
          the variant list: this <p> is a block in a column, its width is
          already the container's. */}
      {erreur && (
        <p role="alert" className="text-sm break-words text-destructive">
          {erreur}
        </p>
      )}

      {/* Says WHY the button is unavailable: a disabled control with no
          explanation is a dead end. Mounted AT ALL TIMES, only its text
          toggles — a live region that enters the DOM in the same mutation as
          its content is routinely missed (VoiceOver on iOS/macOS notably),
          which would leave exactly the screen-reader user facing the silent
          dead end this paragraph exists to prevent. At rest `sr-only` is
          position:absolute, so the region is not a flex item and adds no
          `gap` row. `role="status"` and not `role="alert"`: nothing went
          wrong, and a progress update must not interrupt. */}
      <p
        id="p-preparation-image"
        role="status"
        className={cn(
          "text-sm text-muted-foreground",
          !preparationImage && "sr-only"
        )}
      >
        {preparationImage
          ? "Préparation de l'image en cours — la création sera possible dès qu'elle est terminée."
          : ""}
      </p>

      {/* flex-wrap and not flex-col: at 375px the pair only takes 200 of the
          343 available, so stacking would cost a line for nothing. The wrap is
          there for the day a third action joins, since both buttons carry
          `shrink-0 whitespace-nowrap` and could not shrink out of trouble. */}
      <div className="flex flex-wrap gap-2">
        {surAnnulation && (
          <Button type="button" variant="outline" onClick={surAnnulation}>
            Annuler
          </Button>
        )}
        {/* aria-describedby rather than mere proximity: the reason is tied to
            the control it disables, so it is read when the button is reached,
            not only if the user happens to wander past the paragraph. */}
        <Button
          type="submit"
          aria-describedby="p-preparation-image"
          disabled={creer.isPending || preparationImage}
        >
          {creer.isPending ? "Création…" : "Créer le produit"}
        </Button>
      </div>
    </form>
  )
}
