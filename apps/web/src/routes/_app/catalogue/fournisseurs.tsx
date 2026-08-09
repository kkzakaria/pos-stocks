import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { usePeutEcrire } from "@/lib/permissions"
import { Truck } from "lucide-react"
import { EtatVide } from "@/components/etat-vide"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { TEXTE_LIBRE } from "@/components/ui/table"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"

export const Route = createFileRoute("/_app/catalogue/fournisseurs")({
  component: FournisseursPage,
})

type Fournisseur = {
  id: string
  name: string
  contact: string | null
  phone: string | null
  isActive: boolean
}

/**
 * `Fournisseur` with the two pieces of context the row itself does not carry:
 * toggling activation is a mutation owned by the screen, not a supplier
 * field, and so is knowing whether THIS row's toggle is currently in flight.
 * Splicing them into every row is what keeps the column arrays static
 * module-level constants instead of a factory — the same trade already made
 * by `ProduitAffiche` (`catalogue/produits/index.tsx`) and by
 * `LigneVenteAffichee` (`ventes/$saleId.tsx`).
 */
export type FournisseurAffiche = Fournisseur & {
  surBascule: () => void
  /** This row's own toggle is awaiting its PATCH — see `boutonBascule`. */
  basculeEnCours: boolean
}

/** Card mode: the supplier's name identifies the row. Reused verbatim as the
 * "Nom" column's cell so the two renderings can never drift apart. */
export function titreFournisseur(f: Fournisseur) {
  return f.name
}

/** The single toggle button, shared by the table's action column and by the
 * card's trailing action — it therefore exists exactly once per row in
 * either tier. Its label depends on the row's own state, so it resolves
 * inside the cell rather than through any screen-level branch.
 *
 * Disabled while its OWN toggle is in flight: two quick clicks would send two
 * PATCHes, and the supplier would land back on its starting state — two
 * writes for no visible change, which is exactly the kind of silent
 * contradiction the audit trail must not carry. Row-scoped on purpose:
 * disabling on the bare `isPending` of the shared mutation would freeze every
 * other supplier's button too. */
export function boutonBascule(f: FournisseurAffiche) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={f.basculeEnCours}
      onClick={f.surBascule}
    >
      {f.isActive ? "Désactiver" : "Réactiver"}
    </Button>
  )
}

/**
 * The four data columns — exactly what a read-only account sees.
 *
 * Name, contact and phone are all typed by the user, so all three carry
 * `TEXTE_LIBRE` (its JSDoc in `components/ui/table.tsx` holds the mechanism and
 * why `break-words` alone is inert). Measured at the 1024px tier, where this
 * screen's container is 736px: 1 578px of table, columns at Nom 576 · Contact
 * 502 · Téléphone 348, i.e. 842px of horizontal scroll. The contact carries
 * SPACES and still refused to fold, because `TableCell` sets
 * `whitespace-nowrap` — which is exactly the half of the pair `wrap-anywhere`
 * cannot supply on its own.
 *
 * The status column is left untouched on purpose: a badge is a fixed
 * two-word label from a closed set, not user text, and breaking it mid-word
 * would only make it harder to read.
 */
export const COLONNES_FOURNISSEURS: ColonneAdaptative<FournisseurAffiche>[] = [
  {
    cle: "nom",
    entete: "Nom",
    // Resurfaces via titreFournisseur, which renders this same name.
    masquerEnCarte: true,
    classeCellule: cn("font-medium", TEXTE_LIBRE),
    cellule: titreFournisseur,
  },
  {
    cle: "contact",
    entete: "Contact",
    classeCellule: TEXTE_LIBRE,
    cellule: (f) => f.contact ?? "—",
  },
  {
    cle: "telephone",
    entete: "Téléphone",
    classeCellule: TEXTE_LIBRE,
    cellule: (f) => f.phone ?? "—",
  },
  {
    cle: "statut",
    entete: "Statut",
    // No masquerEnCarte: an activation state is auditable information and
    // stays a visible label/value pair in the card.
    cellule: (f) => (
      <Badge variant={f.isActive ? "success" : "secondary"}>
        {f.isActive ? "Actif" : "Inactif"}
      </Badge>
    ),
  },
]

/** Appended only when the account can write. `masquerEnCarte` keeps the
 * button out of the card's pairs: `actionCarte` renders the very same
 * button there instead. Module-private: the screen and its test consume the
 * composed array below, never this column on its own. */
const COLONNE_ACTION_FOURNISSEUR: ColonneAdaptative<FournisseurAffiche> = {
  cle: "action",
  entete: "",
  // Resurfaces via actionCarte, which renders this same button.
  masquerEnCarte: true,
  cellule: boutonBascule,
}

/**
 * Write-capable roles get the trailing action column. The composition is
 * spelled out here — derived from `COLONNES_FOURNISSEURS`, not re-enumerated,
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
export const COLONNES_FOURNISSEURS_ECRITURE: ColonneAdaptative<FournisseurAffiche>[] =
  [...COLONNES_FOURNISSEURS, COLONNE_ACTION_FOURNISSEUR]

/**
 * Suppliers screen: list with active/inactive status, creation of a
 * supplier (name, contact, phone), and activation toggle.
 */
function FournisseursPage() {
  const peutEcrire = usePeutEcrire()
  const queryClient = useQueryClient()

  const { data, isPending } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiFetch<{ suppliers: Fournisseur[] }>("/api/v1/suppliers"),
  })
  const fournisseurs = data?.suppliers ?? []

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [nom, setNom] = useState("")
  const [contact, setContact] = useState("")
  const [telephone, setTelephone] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)
  const [erreurBascule, setErreurBascule] = useState<string | null>(null)

  const invalider = () =>
    queryClient.invalidateQueries({ queryKey: ["suppliers"] })

  const creer = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/suppliers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: nom,
          contact: contact || undefined,
          phone: telephone || undefined,
        }),
      }),
    onSuccess: async () => {
      await invalider()
      setDialogOuvert(false)
      setNom("")
      setContact("")
      setTelephone("")
      setErreur(null)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const basculer = useMutation({
    mutationFn: (f: Fournisseur) =>
      apiFetch(`/api/v1/suppliers/${f.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !f.isActive }),
      }),
    onSuccess: async () => {
      setErreurBascule(null)
      await invalider()
    },
    onError: (err) =>
      setErreurBascule(err instanceof Error ? err.message : "Erreur"),
  })

  // `basculer.variables` holds the argument of the call currently in flight —
  // the supplier itself. Comparing its id is what scopes the pending state to
  // the row that was actually clicked, instead of the whole list. The result
  // being a discriminated union on `isPending`, the guard also narrows
  // `variables` away from `undefined`; no optional chain is needed.
  const lignes: FournisseurAffiche[] = fournisseurs.map((f) => ({
    ...f,
    surBascule: () => basculer.mutate(f),
    basculeEnCours: basculer.isPending && basculer.variables.id === f.id,
  }))

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Fournisseurs</h1>
        {peutEcrire && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>
              Nouveau fournisseur
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouveau fournisseur</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  setErreur(null)
                  creer.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-nom">Nom</Label>
                  <Input
                    id="s-nom"
                    required
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-contact">Contact (optionnel)</Label>
                  <Input
                    id="s-contact"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-telephone">Téléphone (optionnel)</Label>
                  <Input
                    id="s-telephone"
                    value={telephone}
                    onChange={(e) => setTelephone(e.target.value)}
                  />
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-destructive">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {erreurBascule && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {erreurBascule}
        </p>
      )}

      <ListeAdaptative<FournisseurAffiche>
        colonnes={
          peutEcrire ? COLONNES_FOURNISSEURS_ECRITURE : COLONNES_FOURNISSEURS
        }
        lignes={lignes}
        cleLigne={(f) => f.id}
        titre={titreFournisseur}
        chargement={isPending}
        containerClassName="min-h-0 flex-1 overflow-y-auto"
        actionCarte={peutEcrire ? boutonBascule : undefined}
        etatVide={
          <EtatVide
            icon={Truck}
            titre="Aucun fournisseur"
            message="Ajoutez un fournisseur pour tracer vos réceptions et vos coûts."
            action={
              peutEcrire ? (
                <Button onClick={() => setDialogOuvert(true)}>
                  Nouveau fournisseur
                </Button>
              ) : undefined
            }
          />
        }
      />
    </div>
  )
}
