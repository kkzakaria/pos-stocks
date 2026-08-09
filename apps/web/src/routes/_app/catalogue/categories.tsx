import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { usePeutEcrire } from "@/lib/permissions"
import { FolderTree } from "lucide-react"
import { EtatVide } from "@/components/etat-vide"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TEXTE_LIBRE } from "@/components/ui/table"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"

export const Route = createFileRoute("/_app/catalogue/categories")({
  component: CategoriesPage,
})

type Categorie = { id: string; name: string; parentId: string | null }

/**
 * `Categorie` with the two pieces of context the row itself does not carry:
 * `libelle`, the hierarchical label, which needs the whole list to resolve the
 * parent's name, and `surModifier`, this screen's edit handler. Splicing them
 * into every row is what keeps the column arrays static at module level
 * instead of a factory — the same trade already made by `ProduitAffiche`
 * (`catalogue/produits/index.tsx`) and `LigneVenteAffichee`
 * (`ventes/$saleId.tsx`).
 */
export type CategorieAffichee = Categorie & {
  libelle: string
  surModifier: () => void
}

/**
 * Hierarchical label: `Parent > Enfant`, or the bare name at root level.
 * `parents` maps every known category id to its name; an unresolved parent
 * degrades to "?" rather than dropping the level silently.
 */
export function libelleCategorie(
  cat: Categorie,
  parents: Map<string, string>
): string {
  return cat.parentId
    ? `${parents.get(cat.parentId) ?? "?"} > ${cat.name}`
    : cat.name
}

/** Card mode: the hierarchical label identifies the row. */
export function titreCategorie(cat: CategorieAffichee) {
  return cat.libelle
}

/**
 * Shared between the table's action column and the card's trailing action, so
 * the two renderings can never drift apart — and so the button exists exactly
 * once in each tier.
 */
export function boutonModifier(cat: CategorieAffichee) {
  return (
    <Button variant="outline" size="sm" onClick={cat.surModifier}>
      Modifier
    </Button>
  )
}

/**
 * The one free-text column of this screen: the label is built from category
 * NAMES the user typed, so a long one (or an unbreakable reference pasted as a
 * name) sizes the column at its own min-content width and the whole table
 * overflows its container — measured 1 075px of table for a 736px container at
 * the 1024px tier, which pushed the "Modifier" button 331px out of view. Hence
 * `TEXTE_LIBRE`; see its JSDoc in `components/ui/table.tsx` for why the two
 * tokens are needed together and why `break-words` alone would be inert.
 */
const COLONNE_CATEGORIE: ColonneAdaptative<CategorieAffichee> = {
  cle: "categorie",
  entete: "Catégorie",
  // Resurfaces via titreCategorie, which renders this same label.
  masquerEnCarte: true,
  classeCellule: cn("font-medium", TEXTE_LIBRE),
  cellule: titreCategorie,
}

/** Appended only when the account can write. Module-private: the screen and
 * its test consume the composed array below, never this column on its own. */
const COLONNE_ACTION_CATEGORIE: ColonneAdaptative<CategorieAffichee> = {
  cle: "action",
  entete: "",
  // Resurfaces via actionCarte, which renders this same button.
  masquerEnCarte: true,
  cellule: boutonModifier,
}

/** The data columns — exactly what a read-only account sees. */
export const COLONNES_CATEGORIES: ColonneAdaptative<CategorieAffichee>[] = [
  COLONNE_CATEGORIE,
]

/**
 * Write-capable roles get the trailing action column. The composition is
 * spelled out here — derived from `COLONNES_CATEGORIES`, not re-enumerated,
 * and not assembled at the call site — for two reasons:
 *
 * 1. The data columns are defined in exactly one place. With two enumerated
 *    arrays, adding a column and forgetting the read-only one would drop the
 *    data for read-only accounts: information hidden by role without the role
 *    justifying it, and no current test would see it.
 * 2. The test asserts the very array the screen passes. Composed at the call
 *    site, the test can only rebuild its own copy: swapping the ternary's
 *    branches, or losing the write branch, would strip every action button on
 *    desktop without failing a single test or the typecheck.
 */
export const COLONNES_CATEGORIES_ECRITURE: ColonneAdaptative<CategorieAffichee>[] =
  [...COLONNES_CATEGORIES, COLONNE_ACTION_CATEGORIE]

/**
 * Catalog categories screen: hierarchical list (parent > child),
 * creation and editing of a category and its parent attachment.
 */
function CategoriesPage() {
  const peutEcrire = usePeutEcrire()
  const queryClient = useQueryClient()

  const { data, isPending } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })
  const listeCategories = data?.categories ?? []
  const parents = new Map(listeCategories.map((cat) => [cat.id, cat.name]))

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [enEdition, setEnEdition] = useState<Categorie | null>(null)
  const [nom, setNom] = useState("")
  const [parentId, setParentId] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  function ouvrirCreation() {
    setEnEdition(null)
    setNom("")
    setParentId("")
    setErreur(null)
    setDialogOuvert(true)
  }

  function ouvrirEdition(cat: Categorie) {
    setEnEdition(cat)
    setNom(cat.name)
    setParentId(cat.parentId ?? "")
    setErreur(null)
    setDialogOuvert(true)
  }

  const enregistrer = useMutation({
    mutationFn: () =>
      enEdition
        ? apiFetch(`/api/v1/categories/${enEdition.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: nom, parentId: parentId || null }),
          })
        : apiFetch("/api/v1/categories", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: nom,
              parentId: parentId || undefined,
            }),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["categories"] })
      setDialogOuvert(false)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const lignes: CategorieAffichee[] = listeCategories.map((cat) => ({
    ...cat,
    libelle: libelleCategorie(cat, parents),
    surModifier: () => ouvrirEdition(cat),
  }))

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Catégories</h1>
        {peutEcrire && (
          <Button onClick={ouvrirCreation}>Nouvelle catégorie</Button>
        )}
      </div>

      <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {enEdition ? "Modifier la catégorie" : "Nouvelle catégorie"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setErreur(null)
              enregistrer.mutate()
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-nom">Nom</Label>
              <Input
                id="c-nom"
                required
                value={nom}
                onChange={(e) => setNom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-parent">Catégorie parente (optionnel)</Label>
              <Select
                value={parentId}
                onValueChange={(valeur) => setParentId(valeur as string)}
              >
                <SelectTrigger id="c-parent" className="w-full">
                  <SelectValue placeholder="— aucune —">
                    {(valeur: string) =>
                      valeur === ""
                        ? "— aucune —"
                        : // Two deliberately different fallbacks: "— aucune —"
                          // asserts there is no parent, while an id the list no
                          // longer resolves (parent deleted in another session,
                          // list refreshed by invalidateQueries) means the
                          // parent is unknown — saying "none" there would lie
                          // about a parentId the form would still submit. A
                          // render function makes `placeholder` inert, so
                          // returning undefined would leave the trigger blank.
                          (listeCategories.find((c) => c.id === valeur)?.name ??
                          "— inconnue —")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— aucune —</SelectItem>
                  {listeCategories
                    .filter((cat) => cat.id !== enEdition?.id)
                    .map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {erreur && (
              <p role="alert" className="text-sm text-destructive">
                {erreur}
              </p>
            )}
            <Button type="submit" disabled={enregistrer.isPending}>
              {enregistrer.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ListeAdaptative<CategorieAffichee>
        colonnes={
          peutEcrire ? COLONNES_CATEGORIES_ECRITURE : COLONNES_CATEGORIES
        }
        lignes={lignes}
        cleLigne={(cat) => cat.id}
        titre={titreCategorie}
        chargement={isPending}
        containerClassName="min-h-0 flex-1 overflow-y-auto"
        actionCarte={peutEcrire ? boutonModifier : undefined}
        etatVide={
          <EtatVide
            icon={FolderTree}
            titre="Aucune catégorie"
            message="Créez une catégorie pour organiser vos produits."
            action={
              peutEcrire ? (
                <Button onClick={ouvrirCreation}>Nouvelle catégorie</Button>
              ) : undefined
            }
          />
        }
      />
    </div>
  )
}
