import { useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Upload } from "lucide-react"
import { apiFetch, apiUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  ACCEPT_IMAGE,
  AIDE_IMAGE,
  ERREUR_PREPARATION_IMAGE,
  ERREUR_TAILLE_IMAGE,
  ERREUR_TYPE_IMAGE,
  TAILLE_IMAGE_MAX,
  TYPES_IMAGE_ACCEPTES,
  preparerImage,
} from "@/lib/image"
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
import type { ChangeEvent } from "react"
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
      {/*
        Category name, barcode and description are free user text. The row is a
        COLUMN flex container, so the box already stretches to the full width
        and no `min-w-0` is needed; only the inline text spilled — a 50-digit
        barcode pushed the document to 430 px at a 375 px viewport.
      */}
      <span className="text-sm break-words">{valeur || "—"}</span>
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
  const [preparationImage, setPreparationImage] = useState(false)
  // Generation token: only the most recent selection may publish its result.
  // See the identical guard in `ChampImage` for the rationale.
  const generationImage = useRef(0)

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
    // The image error is part of the edit session too: without this, a refusal
    // from a previous session reappears verbatim when reopening the form.
    setErreurImage(null)
    setEdition(true)
  }

  /**
   * Leaves edit mode. Bumping the generation token is NOT cosmetic: unmounting
   * the image block does not cancel an in-flight preparation, and the upload
   * mutation would fire on a form the user explicitly cancelled — writing the
   * image server-side, with no visible feedback since the block is gone.
   */
  const fermer = () => {
    generationImage.current++
    setPreparationImage(false)
    setEdition(false)
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

  /**
   * Same three steps, in the same order, as `ChampImage` — and for the same
   * reasons; do not "simplify" this by grouping the two validations:
   *
   * 1. MIME type BEFORE `preparerImage` (entry guard: a PDF must yield
   *    "format not accepted", not a decoding error).
   * 2. `preparerImage`, the single place where compression will land.
   * 3. Size AFTER `preparerImage`: it is the *prepared* file that has to fit
   *    under the cap, not the original.
   *
   * Both errors reuse the constants of `@/lib/image`, so the two upload paths
   * cannot word the same refusal differently.
   */
  const choisirImage = async (evenement: ChangeEvent<HTMLInputElement>) => {
    // evenement.target.files is nullable (FileList | null): the optional
    // chain is legitimate for no-unnecessary-condition
    const input = evenement.target
    const fichier = input.files?.[0]
    // Reset after each attempt (success or failure): otherwise re-selecting
    // the SAME file does not fire onChange.
    input.value = ""
    if (!fichier) return

    const jeton = ++generationImage.current
    const obsolete = () => generationImage.current !== jeton

    if (!TYPES_IMAGE_ACCEPTES.includes(fichier.type)) {
      setErreurImage(ERREUR_TYPE_IMAGE)
      // Mandatory, and a `finally` could NOT do it: this attempt never enters
      // the `try`. The token claimed above already invalidated any in-flight
      // preparation, which now returns through its `obsolete()` guard BEFORE
      // its own setPreparationImage(false) — leaving the busy state stuck at
      // true, i.e. an unusable field, without this line.
      setPreparationImage(false)
      return
    }

    setErreurImage(null)
    setPreparationImage(true)
    let prepare: File
    try {
      prepare = await preparerImage(fichier)
    } catch {
      if (obsolete()) return
      setPreparationImage(false)
      // Fixed French sentence: the browser's own decoding errors are English.
      setErreurImage(ERREUR_PREPARATION_IMAGE)
      return
    }
    // A newer selection took over while we were preparing: drop this result
    // rather than uploading a file the user already replaced.
    if (obsolete()) return
    setPreparationImage(false)

    if (prepare.size > TAILLE_IMAGE_MAX) {
      setErreurImage(ERREUR_TAILLE_IMAGE)
      return
    }
    envoyerImage.mutate(prepare)
  }

  const imageOccupee = preparationImage || envoyerImage.isPending

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
          <input
            // "id-image" and not "p-image": the latter is the default id of
            // `ChampImage`, and duplicating it would break both labels the day
            // the two coexist in one view.
            id="id-image"
            type="file"
            accept={ACCEPT_IMAGE}
            aria-label="Choisir une image"
            aria-busy={imageOccupee}
            disabled={envoyerImage.isPending}
            onChange={(e) => void choisirImage(e)}
            // "peer" must be an IMMEDIATE previous sibling of the label for
            // peer-focus-visible: to apply — Tailwind's peer combinator only
            // matches general siblings, and the failure is silent. Same
            // pattern as `ChampImage`, on purpose.
            className="peer sr-only"
          />
          <label
            htmlFor="id-image"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "w-fit cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-ring/30",
              imageOccupee && "pointer-events-none opacity-50"
            )}
          >
            <Upload />
            {preparationImage
              ? "Préparation…"
              : envoyerImage.isPending
                ? "Envoi…"
                : "Choisir une image…"}
          </label>
          <p className="text-xs text-muted-foreground">{AIDE_IMAGE}</p>
          {erreurImage && (
            <p role="alert" className="text-xs break-words text-destructive">
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
          {/* Same reason as the image error above: an API message may carry an
              unbroken token (quoted value, error code with underscores). */}
          {erreur && (
            <p role="alert" className="text-xs break-words text-destructive">
              {erreur}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={enregistrer.isPending}>
              {enregistrer.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button type="button" variant="ghost" onClick={fermer}>
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
