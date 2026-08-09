import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
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
 * `Fournisseur` with the one piece of context the row itself does not carry:
 * toggling activation is a mutation owned by the screen, not a supplier
 * field. Splicing it into every row is what keeps the column arrays static
 * module-level constants instead of a factory — the same trade already made
 * by `ProduitAffiche` (`catalogue/produits/index.tsx`) and by
 * `LigneVenteAffichee` (`ventes/$saleId.tsx`).
 */
export type FournisseurAffiche = Fournisseur & { surBascule: () => void }

/** Card mode: the supplier's name identifies the row. Reused verbatim as the
 * "Nom" column's cell so the two renderings can never drift apart. */
export function titreFournisseur(f: Fournisseur) {
  return f.name
}

/** The single toggle button, shared by the table's action column and by the
 * card's trailing action — it therefore exists exactly once per row in
 * either tier. Its label depends on the row's own state, so it resolves
 * inside the cell rather than through any screen-level branch. */
export function boutonBascule(f: FournisseurAffiche) {
  return (
    <Button variant="outline" size="sm" onClick={f.surBascule}>
      {f.isActive ? "Désactiver" : "Réactiver"}
    </Button>
  )
}

/** The four data columns — exactly what a read-only account sees. */
export const COLONNES_FOURNISSEURS: ColonneAdaptative<FournisseurAffiche>[] = [
  {
    cle: "nom",
    entete: "Nom",
    // Resurfaces via titreFournisseur, which renders this same name.
    masquerEnCarte: true,
    classeCellule: "font-medium",
    cellule: titreFournisseur,
  },
  { cle: "contact", entete: "Contact", cellule: (f) => f.contact ?? "—" },
  { cle: "telephone", entete: "Téléphone", cellule: (f) => f.phone ?? "—" },
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

  const lignes: FournisseurAffiche[] = fournisseurs.map((f) => ({
    ...f,
    surBascule: () => basculer.mutate(f),
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
