import { useEffect, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { formaterMontant } from "@/lib/format"
import { useAccesStock } from "@/lib/permissions"
import { useEntrepotsVisibles } from "@/lib/stock"
import { Truck } from "lucide-react"
import { ErreurChargement } from "@/components/erreur-chargement"
import { EtatVide } from "@/components/etat-vide"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { TEXTE_LIBRE } from "@/components/ui/table"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"
import { FiltresRepliables } from "@/components/ui/filtres-repliables"
import { Pagination } from "@/components/ui/pagination"

export const Route = createFileRoute("/_app/stock/receptions/")({
  component: ReceptionsPage,
})

export type ReceptionListe = {
  id: string
  warehouseId: string
  warehouseName: string
  supplierId: string
  supplierName: string
  reference: string | null
  status: "draft" | "received"
  createdAt: string
  receivedAt: string | null
  itemCount: number
  totalCost: number
}

type Fournisseur = { id: string; name: string; isActive: boolean }

const LIBELLES_STATUT: Record<string, string> = {
  "": "Tous",
  draft: "Brouillons",
  received: "Validées",
}

/**
 * The one real link to the receipt sheet — used verbatim by the table's
 * "Fournisseur" cell and by the card's title, so the two renderings can never
 * drift apart. Until now the row was clickable without exposing any real
 * link: a keyboard or screen-reader user had no way of their own to reach the
 * sheet.
 *
 * This screen holds its filters in local state, not in the URL, so the link
 * has no `search` to carry back — unlike `catalogue/produits/index.tsx`,
 * whose otherwise identical link ships the list's filters along.
 */
export function titreReception(r: ReceptionListe) {
  return (
    <Link
      to="/stock/receptions/$purchaseId"
      params={{ purchaseId: r.id }}
      className="min-w-0 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      {r.supplierName}
    </Link>
  )
}

/** Card mode: the receipt's total sits opposite the title — it is the
 * headline figure of a receipt. Reused verbatim as the "Total" column's cell
 * so the two renderings can never drift apart. */
export function valeurReception(r: ReceptionListe) {
  return formaterMontant(r.totalCost)
}

/** Card mode: the creation date as the secondary line under the title.
 * Reused verbatim as the "Date" column's cell. */
export function sousTitreReception(r: ReceptionListe) {
  return new Date(r.createdAt).toLocaleDateString("fr-FR")
}

/**
 * The seven columns of the receipts list. No action column here: the whole
 * row leads to the sheet, and the link on the supplier is that action.
 *
 * `TEXTE_LIBRE` goes on the three columns holding text a human typed —
 * warehouse name, supplier name, and the delivery-note reference, which is
 * routinely a single unbreakable token. Its JSDoc in
 * `components/ui/table.tsx` holds the mechanism, including why `break-words`
 * alone contributes nothing here.
 *
 * It deliberately stays off Lignes, Total and Statut: a count, a formatted
 * amount and a two-word badge from a closed set are atomic values, and
 * breaking a figure across two lines would be a defect, not a fix.
 */
export const COLONNES_RECEPTIONS: ColonneAdaptative<ReceptionListe>[] = [
  {
    cle: "date",
    entete: "Date",
    // Resurfaces via sousTitreReception, which renders this same date.
    masquerEnCarte: true,
    classeCellule: "text-sm",
    cellule: sousTitreReception,
  },
  {
    cle: "entrepot",
    entete: "Entrepôt",
    classeCellule: TEXTE_LIBRE,
    cellule: (r) => r.warehouseName,
  },
  {
    cle: "fournisseur",
    entete: "Fournisseur",
    // Resurfaces via titreReception, which renders this same link.
    masquerEnCarte: true,
    classeCellule: cn("font-medium", TEXTE_LIBRE),
    cellule: titreReception,
  },
  {
    cle: "reference",
    entete: "Référence",
    classeCellule: cn("font-mono text-xs", TEXTE_LIBRE),
    cellule: (r) => r.reference ?? "—",
  },
  {
    cle: "lignes",
    entete: "Lignes",
    numeric: true,
    cellule: (r) => r.itemCount,
  },
  {
    cle: "total",
    entete: "Total",
    numeric: true,
    // Resurfaces via valeurReception, which renders this same amount.
    masquerEnCarte: true,
    cellule: valeurReception,
  },
  {
    cle: "statut",
    entete: "Statut",
    // No masquerEnCarte: draft vs validated is auditable information and
    // stays a visible label/value pair in the card.
    cellule: (r) => (
      <Badge variant={r.status === "draft" ? "warning" : "success"}>
        {r.status === "draft" ? "Brouillon" : "Validée"}
      </Badge>
    ),
  },
]

/**
 * Supplier receipts list: filter by status (draft/validated) and
 * creation of a draft (warehouse, supplier, reference) leading to its
 * detail page.
 */
export function ReceptionsPage() {
  const acces = useAccesStock()
  const { options: entrepots } = useEntrepotsVisibles()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Entrepôts où l'utilisateur peut CRÉER une réception
  const entrepotsEcriture = acces.ecritureTous
    ? entrepots
    : entrepots.filter((w) => acces.entrepotsEcriture.includes(w.id))
  const peutCreer = entrepotsEcriture.length > 0

  const [statut, setStatut] = useState("")
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [statut])
  const receptions = useQuery({
    queryKey: ["purchases", statut, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) })
      if (statut) params.set("statut", statut)
      return apiFetch<{
        purchases: ReceptionListe[]
        total: number
        page: number
        limite: number
      }>(`/api/v1/purchases?${params.toString()}`)
    },
  })
  const fournisseurs = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiFetch<{ suppliers: Fournisseur[] }>("/api/v1/suppliers"),
    enabled: peutCreer,
  })

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [entrepotId, setEntrepotId] = useState("")
  const [fournisseurId, setFournisseurId] = useState("")
  const [reference, setReference] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  const fournisseursActifs = (fournisseurs.data?.suppliers ?? []).filter(
    (f) => f.isActive
  )

  const creer = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/api/v1/purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          warehouseId: entrepotId,
          supplierId: fournisseurId,
          reference: reference || undefined,
        }),
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["purchases"] })
      setDialogOuvert(false)
      void navigate({
        to: "/stock/receptions/$purchaseId",
        params: { purchaseId: res.id },
      })
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Réceptions fournisseur</h1>
        {peutCreer && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>
              Nouvelle réception
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvelle réception</DialogTitle>
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
                  <Label htmlFor="r-entrepot">Entrepôt</Label>
                  <Select
                    value={entrepotId}
                    onValueChange={(valeur) => setEntrepotId(valeur as string)}
                  >
                    <SelectTrigger id="r-entrepot" className="w-full">
                      {/* base-ui ignores `placeholder` as soon as a render
                          function is passed, and calls the function even on an
                          empty value: the fallback has to live INSIDE it, or
                          the field shows the raw UUID (no function) or nothing
                          at all (function returning undefined). */}
                      <SelectValue>
                        {(valeur: string) =>
                          entrepotsEcriture.find((w) => w.id === valeur)
                            ?.name ?? "— choisir —"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {entrepotsEcriture.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="r-fournisseur">Fournisseur</Label>
                  <Select
                    value={fournisseurId}
                    onValueChange={(valeur) =>
                      setFournisseurId(valeur as string)
                    }
                  >
                    <SelectTrigger id="r-fournisseur" className="w-full">
                      <SelectValue>
                        {(valeur: string) =>
                          fournisseursActifs.find((f) => f.id === valeur)
                            ?.name ?? "— choisir —"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {fournisseursActifs.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="r-reference">
                    Référence (bon de livraison, optionnel)
                  </Label>
                  <Input
                    id="r-reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-destructive">
                    {erreur}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={creer.isPending || !entrepotId || !fournisseurId}
                >
                  {creer.isPending ? "Création…" : "Créer le brouillon"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <FiltresRepliables nbActifs={statut !== "" ? 1 : 0}>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex w-full flex-col gap-1.5 sm:w-48">
            <Label htmlFor="r-statut">Statut</Label>
            <Select
              value={statut}
              onValueChange={(valeur) => setStatut(valeur as string)}
            >
              <SelectTrigger id="r-statut" className="w-full sm:w-48">
                <SelectValue placeholder="Tous">
                  {(valeur: string) => LIBELLES_STATUT[valeur] ?? "Tous"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Tous</SelectItem>
                <SelectItem value="draft">Brouillons</SelectItem>
                <SelectItem value="received">Validées</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </FiltresRepliables>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        {receptions.isError ? (
          <ErreurChargement
            message="Impossible de charger les réceptions."
            onRetry={() => void receptions.refetch()}
          />
        ) : (
          <ListeAdaptative<ReceptionListe>
            colonnes={COLONNES_RECEPTIONS}
            lignes={receptions.data?.purchases ?? []}
            cleLigne={(r) => r.id}
            titre={titreReception}
            valeur={valeurReception}
            sousTitre={sousTitreReception}
            chargement={receptions.isPending}
            containerClassName="min-h-0 flex-1 overflow-y-auto"
            surClicLigne={(r) =>
              void navigate({
                to: "/stock/receptions/$purchaseId",
                params: { purchaseId: r.id },
              })
            }
            etatVide={
              <EtatVide
                icon={Truck}
                titre="Aucune réception"
                message={
                  peutCreer
                    ? "Aucune réception pour ce filtre. Créez une réception pour entrer du stock fournisseur."
                    : "Aucune réception pour ce filtre."
                }
              />
            }
          />
        )}

        {(receptions.data?.total ?? 0) > 0 && (
          <Pagination
            className="mt-3"
            page={page}
            total={receptions.data?.total ?? 0}
            pageSize={receptions.data?.limite ?? 50}
            onPageChange={setPage}
            element={{ un: "réception", plusieurs: "réceptions" }}
          />
        )}
      </div>
    </div>
  )
}
