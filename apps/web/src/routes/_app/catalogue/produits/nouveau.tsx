import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
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
  surSucces,
  surAnnulation,
}: {
  categories: Categorie[]
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
      if (description) donnees.description = description
      if (categorieId) donnees.categoryId = categorieId
      if (codeBarres) donnees.barcode = codeBarres
      if (plancher) donnees.minPrice = Number(plancher)
      if (seuilAlerte) donnees.defaultMinStock = Number(seuilAlerte)
      if (suiviLots) donnees.trackLots = true
      if (variantes.length > 0) donnees.variants = variantes

      const corps = new FormData()
      corps.append("donnees", JSON.stringify(donnees))
      if (image) corps.append("image", image)
      // No content-type header: the browser sets the multipart boundary.
      return apiFetch<{ id: string; sku: string }>("/api/v1/products", {
        method: "POST",
        body: corps,
      })
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
        <div className="flex gap-3">
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
          <Label htmlFor="p-suivi-lots">Suivre les lots (péremption)</Label>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          Image{" "}
          <span className="font-normal text-muted-foreground">
            (facultatif)
          </span>
        </h2>
        <ChampImage value={image} onChange={setImage} />
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

      {erreur && (
        <p role="alert" className="text-sm text-destructive">
          {erreur}
        </p>
      )}

      <div className="flex gap-2">
        {surAnnulation && (
          <Button type="button" variant="outline" onClick={surAnnulation}>
            Annuler
          </Button>
        )}
        <Button type="submit" disabled={creer.isPending}>
          {creer.isPending ? "Création…" : "Créer le produit"}
        </Button>
      </div>
    </form>
  )
}
