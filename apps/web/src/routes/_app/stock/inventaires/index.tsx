import { useEffect, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useAccesStock } from "@/lib/permissions"
import { useEntrepotsVisibles } from "@/lib/stock"
import { ClipboardList } from "lucide-react"
import { ErreurChargement } from "@/components/erreur-chargement"
import { EtatVide } from "@/components/etat-vide"
import { Button } from "@/components/ui/button"
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

export const Route = createFileRoute("/_app/stock/inventaires/")({
  component: InventairesPage,
})

export type InventaireListe = {
  id: string
  warehouseId: string
  warehouseName: string
  status: "open" | "closed"
  openedAt: string
  closedAt: string | null
  itemCount: number
  countedCount: number
}

const STATUTS_INVENTAIRE_FR: Record<string, string> = {
  "": "Tous",
  open: "Ouverts",
  closed: "Clos",
}

/**
 * The one real link to the count sheet — used verbatim by the table's
 * "Entrepôt" cell and by the card's title, so the two renderings can never
 * drift apart. Until now the row was clickable without exposing any real
 * link: a keyboard or screen-reader user had no way of their own to reach the
 * sheet.
 *
 * This screen holds its filters in local state, not in the URL, so the link
 * has no `search` to carry back — unlike `catalogue/produits/index.tsx`,
 * whose otherwise identical link ships the list's filters along.
 */
export function titreInventaire(i: InventaireListe) {
  return (
    <Link
      to="/stock/inventaires/$countId"
      params={{ countId: i.id }}
      className="min-w-0 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      {i.warehouseName}
    </Link>
  )
}

/** Card mode: the opening timestamp as the secondary line under the title.
 * Reused verbatim as the "Ouvert le" column's cell. `toLocaleString` (with
 * the time), not `toLocaleDateString` like the other two lists — the
 * opening time of day is meaningful data here, not noise to normalise away. */
export function sousTitreInventaire(i: InventaireListe) {
  return new Date(i.openedAt).toLocaleString("fr-FR")
}

/**
 * The five columns of the inventory counts list. No action column here: the
 * whole row leads to the sheet, and the link on the warehouse is that
 * action.
 *
 * No `valeur` either: the progress ("3 / 12 comptés") is a phrase, not a
 * standalone figure, so it reads better with its label in card mode — a
 * label/value pair rather than a headline number.
 *
 * `TEXTE_LIBRE` goes only on the warehouse column, which holds text a human
 * typed. Its JSDoc in `components/ui/table.tsx` holds the mechanism,
 * including why `break-words` alone contributes nothing here.
 *
 * It deliberately stays off Avancement, Clos le and Statut: a progress
 * phrase, a formatted date and a two-word badge from a closed set are atomic
 * values, and breaking one across two lines would be a defect, not a fix.
 */
export const COLONNES_INVENTAIRES: ColonneAdaptative<InventaireListe>[] = [
  {
    cle: "ouvertLe",
    entete: "Ouvert le",
    // Resurfaces via sousTitreInventaire, which renders this same timestamp.
    masquerEnCarte: true,
    cellule: sousTitreInventaire,
  },
  {
    cle: "entrepot",
    entete: "Entrepôt",
    // Resurfaces via titreInventaire, which renders this same link.
    masquerEnCarte: true,
    classeCellule: cn("font-medium", TEXTE_LIBRE),
    cellule: titreInventaire,
  },
  {
    cle: "avancement",
    entete: "Avancement",
    cellule: (i) => (
      <>
        <span className="tabular-nums">
          {i.countedCount} / {i.itemCount}
        </span>{" "}
        compté{i.countedCount > 1 ? "s" : ""}
      </>
    ),
  },
  {
    cle: "closLe",
    entete: "Clos le",
    cellule: (i) =>
      i.closedAt ? new Date(i.closedAt).toLocaleString("fr-FR") : "—",
  },
  {
    cle: "statut",
    entete: "Statut",
    // No masquerEnCarte: open vs closed is auditable information and stays a
    // visible label/value pair in the card.
    cellule: (i) => (
      <Badge variant={i.status === "open" ? "warning" : "success"}>
        {i.status === "open" ? "Ouvert" : "Clos"}
      </Badge>
    ),
  },
]

/**
 * Inventory counts list: filter by status (open/closed), counting
 * progress, and opening of a full warehouse count leading to its detail
 * page.
 */
export function InventairesPage() {
  const acces = useAccesStock()
  const { options: entrepots } = useEntrepotsVisibles()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const entrepotsEcriture = acces.ecritureTous
    ? entrepots
    : entrepots.filter((w) => acces.entrepotsEcriture.includes(w.id))
  const peutOuvrir = entrepotsEcriture.length > 0

  const [statut, setStatut] = useState("")
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [statut])
  const inventaires = useQuery({
    queryKey: ["inventory-counts", statut, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) })
      if (statut) params.set("statut", statut)
      return apiFetch<{
        counts: InventaireListe[]
        total: number
        page: number
        limite: number
      }>(`/api/v1/inventory-counts?${params.toString()}`)
    },
  })

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [entrepotId, setEntrepotId] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  const ouvrir = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/api/v1/inventory-counts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ warehouseId: entrepotId }),
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["inventory-counts"] })
      setDialogOuvert(false)
      void navigate({
        to: "/stock/inventaires/$countId",
        params: { countId: res.id },
      })
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inventaires</h1>
        {peutOuvrir && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>
              Ouvrir un inventaire
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ouvrir un inventaire complet</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  setErreur(null)
                  ouvrir.mutate()
                }}
              >
                <p className="text-sm text-muted-foreground">
                  Les quantités attendues de TOUT l'entrepôt sont figées à
                  l'ouverture. Les ventes restent possibles pendant
                  l'inventaire.
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="i-entrepot">Entrepôt</Label>
                  <Select
                    value={entrepotId}
                    onValueChange={(valeur) => setEntrepotId(valeur as string)}
                    required
                  >
                    <SelectTrigger id="i-entrepot" className="w-full">
                      {/* base-ui ignores `placeholder` as soon as a render
                          function is passed, and calls the function even on an
                          empty value: the fallback has to live INSIDE it, or
                          the field shows nothing at all (function returning
                          undefined). */}
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
                {erreur && (
                  <p role="alert" className="text-sm text-destructive">
                    {erreur}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={ouvrir.isPending || !entrepotId}
                >
                  {ouvrir.isPending ? "Ouverture…" : "Ouvrir l'inventaire"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <FiltresRepliables nbActifs={statut !== "" ? 1 : 0}>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex w-full flex-col gap-1.5 sm:w-48">
            <Label htmlFor="i-statut">Statut</Label>
            <Select
              value={statut}
              onValueChange={(valeur) => setStatut(valeur as string)}
            >
              <SelectTrigger id="i-statut" className="w-full sm:w-48">
                <SelectValue placeholder="Tous">
                  {(valeur: string) => STATUTS_INVENTAIRE_FR[valeur] ?? "Tous"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Tous</SelectItem>
                <SelectItem value="open">Ouverts</SelectItem>
                <SelectItem value="closed">Clos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </FiltresRepliables>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        {inventaires.isError ? (
          <ErreurChargement
            message="Impossible de charger les inventaires."
            onRetry={() => void inventaires.refetch()}
          />
        ) : (
          <ListeAdaptative<InventaireListe>
            colonnes={COLONNES_INVENTAIRES}
            lignes={inventaires.data?.counts ?? []}
            cleLigne={(i) => i.id}
            titre={titreInventaire}
            sousTitre={sousTitreInventaire}
            chargement={inventaires.isPending}
            containerClassName="min-h-0 flex-1 overflow-y-auto"
            surClicLigne={(i) =>
              void navigate({
                to: "/stock/inventaires/$countId",
                params: { countId: i.id },
              })
            }
            etatVide={
              <EtatVide
                icon={ClipboardList}
                titre="Aucun inventaire"
                message={
                  peutOuvrir
                    ? "Ouvrez un inventaire pour recompter et réconcilier le stock d'un entrepôt."
                    : "Aucun inventaire ne correspond à ce filtre."
                }
              />
            }
          />
        )}

        {(inventaires.data?.total ?? 0) > 0 && (
          <Pagination
            className="mt-3"
            page={page}
            total={inventaires.data?.total ?? 0}
            pageSize={inventaires.data?.limite ?? 50}
            onPageChange={setPage}
            element={{ un: "inventaire", plusieurs: "inventaires" }}
          />
        )}
      </div>
    </div>
  )
}
