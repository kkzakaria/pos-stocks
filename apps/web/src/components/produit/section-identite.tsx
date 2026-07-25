import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Upload } from "lucide-react"
import { apiFetch, apiUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
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
import type { Produit } from "./types"

type Categorie = { id: string; name: string }

type Props = {
  produit: Produit
  productId: string
  peutEcrire: boolean
  onModifie: () => Promise<unknown>
}

/** Read-mode definition row: pale label above the value ("—" when absent). */
function Definition({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{libelle}</span>
      <span className="text-sm">{valeur || "—"}</span>
    </div>
  )
}

// Mounted with key={produit.id} by the page: edit state re-seeds when
// navigating to another product.
/**
 * Identity column: product image above a dense definition list; "Modifier"
 * switches name/category/barcode/description and the active toggle to
 * inline editing (partial PATCH). The image upload (input reset after each
 * attempt, URL versioning) only shows in edit mode — read mode stays quiet.
 */
export function SectionIdentite({
  produit,
  productId,
  peutEcrire,
  onModifie,
}: Props) {
  const [edition, setEdition] = useState(false)
  const [nom, setNom] = useState(produit.name)
  const [categorieId, setCategorieId] = useState(produit.categoryId ?? "")
  const [codeBarres, setCodeBarres] = useState(produit.barcode ?? "")
  const [description, setDescription] = useState(produit.description ?? "")
  const [actif, setActif] = useState(produit.isActive)
  const [erreur, setErreur] = useState<string | null>(null)
  const [erreurImage, setErreurImage] = useState<string | null>(null)
  const [versionImage, setVersionImage] = useState(0)

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })
  const listeCategories = categories.data?.categories ?? []
  const idsCategories = listeCategories.map((c) => c.id)
  const nomCategorie = (id: string) =>
    listeCategories.find((c) => c.id === id)?.name ?? id

  const ouvrir = () => {
    setNom(produit.name)
    setCategorieId(produit.categoryId ?? "")
    setCodeBarres(produit.barcode ?? "")
    setDescription(produit.description ?? "")
    setActif(produit.isActive)
    setErreur(null)
    setEdition(true)
  }

  const enregistrer = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/products/${productId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: nom,
          description: description === "" ? null : description,
          categoryId: categorieId === "" ? null : categorieId,
          barcode: codeBarres === "" ? null : codeBarres,
          isActive: actif,
        }),
      }),
    onSuccess: async () => {
      await onModifie()
      setEdition(false)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const envoyerImage = useMutation({
    mutationFn: (fichier: File) => {
      const donnees = new FormData()
      donnees.append("image", fichier)
      // no content-type header: the browser sets the multipart boundary
      return apiFetch(`/api/v1/products/${productId}/image`, {
        method: "POST",
        body: donnees,
      })
    },
    onSuccess: async () => {
      await onModifie()
      setVersionImage((v) => v + 1)
      setErreurImage(null)
    },
    onError: (err) =>
      setErreurImage(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-medium">Identité</h2>
      {produit.imageKey ? (
        <img
          src={`${apiUrl(`/api/v1/files/${produit.imageKey}`)}?v=${versionImage}`}
          alt={produit.name}
          width={128}
          height={128}
          crossOrigin="use-credentials"
          className="h-32 w-32 rounded-md border object-cover"
        />
      ) : (
        <div className="flex h-32 w-32 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
          Aucune image
        </div>
      )}
      {/* edit-only (edition implies peutEcrire): read mode shows the image alone */}
      {edition && (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="p-image"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "w-fit cursor-pointer",
              envoyerImage.isPending && "pointer-events-none opacity-50"
            )}
          >
            <Upload />
            {envoyerImage.isPending ? "Envoi…" : "Choisir une image…"}
          </label>
          <p className="text-xs text-muted-foreground">
            JPEG, PNG, WebP — 2 Mo max
          </p>
          <input
            id="p-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={envoyerImage.isPending}
            onChange={(e) => {
              // e.target.files is nullable (FileList | null): the optional
              // chain is legitimate for no-unnecessary-condition
              const input = e.target
              const fichier = input.files?.[0]
              if (!fichier) return
              // Reset after each attempt (success or failure): otherwise
              // re-selecting the SAME file does not fire onChange.
              envoyerImage.mutate(fichier, {
                onSettled: () => {
                  input.value = ""
                },
              })
            }}
            className="sr-only"
          />
          {erreurImage && (
            <p role="alert" className="text-xs text-destructive">
              {erreurImage}
            </p>
          )}
        </div>
      )}

      {edition ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setErreur(null)
            enregistrer.mutate()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="id-nom">Nom</Label>
            <Input
              id="id-nom"
              required
              autoComplete="off"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="id-categorie">Catégorie</Label>
            <Combobox
              items={idsCategories}
              itemToStringLabel={nomCategorie}
              autoHighlight
              value={categorieId || null}
              onValueChange={(valeur) => setCategorieId(valeur ?? "")}
            >
              <ComboboxInput
                id="id-categorie"
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
            <Label htmlFor="id-barcode">Code-barres</Label>
            <Input
              id="id-barcode"
              autoComplete="off"
              spellCheck={false}
              value={codeBarres}
              onChange={(e) => setCodeBarres(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="id-description">Description</Label>
            <Textarea
              id="id-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="id-actif"
              checked={actif}
              onCheckedChange={(valeur) => setActif(valeur === true)}
            />
            <Label htmlFor="id-actif">Produit actif</Label>
          </div>
          {erreur && (
            <p role="alert" className="text-xs text-destructive">
              {erreur}
            </p>
          )}
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
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <Definition
            libelle="Catégorie"
            valeur={
              produit.categoryId === null
                ? ""
                : nomCategorie(produit.categoryId)
            }
          />
          <Definition libelle="Code-barres" valeur={produit.barcode ?? ""} />
          <Definition
            libelle="Description"
            valeur={produit.description ?? ""}
          />
          {peutEcrire && (
            <Button
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={ouvrir}
            >
              Modifier
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
