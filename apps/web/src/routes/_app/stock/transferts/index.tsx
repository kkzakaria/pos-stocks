import { useEffect, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useAccesStock } from "@/lib/permissions"
import { useEntrepotsVisibles } from "@/lib/stock"
import { STATUTS_TRANSFERT_FR, varianteBadgeStatut } from "@/lib/transferts"
import type { StatutTransfert, TransfertListe } from "@/lib/transferts"
import { ArrowLeftRight } from "lucide-react"
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

export const Route = createFileRoute("/_app/stock/transferts/")({
  component: TransfertsPage,
})

/**
 * The one real link to the transfer sheet — used verbatim by the table's
 * "Destination" cell and by the card's title, so the two renderings can
 * never drift apart. Until now the row was clickable without exposing any
 * real link: a keyboard or screen-reader user had no way of their own to
 * reach the sheet.
 *
 * This screen holds its filters in local state, not in the URL, so the link
 * has no `search` to carry back — unlike `catalogue/produits/index.tsx`,
 * whose otherwise identical link ships the list's filters along.
 */
export function titreTransfert(t: TransfertListe) {
  return (
    <Link
      to="/stock/transferts/$transferId"
      params={{ transferId: t.id }}
      className="min-w-0 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      {t.toWarehouseName}
    </Link>
  )
}

/** Card mode: the transferred quantity sits opposite the title — it is the
 * headline figure of a transfer. Reused verbatim as the "Quantité" column's
 * cell so the two renderings can never drift apart. */
export function valeurTransfert(t: TransfertListe) {
  return t.totalQuantity
}

/** Card mode: the creation date as the secondary line under the title.
 * Reused verbatim as the "Date" column's cell. */
export function sousTitreTransfert(t: TransfertListe) {
  return new Date(t.createdAt).toLocaleDateString("fr-FR")
}

/**
 * The seven columns of the transfers list. No action column here: the whole
 * row leads to the sheet, and the link on the destination is that action.
 *
 * `TEXTE_LIBRE` goes on the three columns holding text a human typed —
 * origin warehouse name, destination warehouse name, and the reference,
 * which is routinely a single unbreakable token. Its JSDoc in
 * `components/ui/table.tsx` holds the mechanism, including why
 * `break-words` alone contributes nothing here.
 *
 * It deliberately stays off Lignes, Quantité and Statut: a count, a
 * quantity and a badge from a closed set are atomic values, and breaking a
 * figure across two lines would be a defect, not a fix.
 */
export const COLONNES_TRANSFERTS: ColonneAdaptative<TransfertListe>[] = [
  {
    cle: "date",
    entete: "Date",
    // Resurfaces via sousTitreTransfert, which renders this same date.
    masquerEnCarte: true,
    classeCellule: "text-sm",
    cellule: sousTitreTransfert,
  },
  {
    cle: "origine",
    entete: "Origine",
    classeCellule: TEXTE_LIBRE,
    cellule: (t) => t.fromWarehouseName,
  },
  {
    cle: "destination",
    entete: "Destination",
    // Resurfaces via titreTransfert, which renders this same link.
    masquerEnCarte: true,
    classeCellule: cn("font-medium", TEXTE_LIBRE),
    cellule: titreTransfert,
  },
  {
    cle: "reference",
    entete: "Référence",
    classeCellule: cn("font-mono text-xs", TEXTE_LIBRE),
    cellule: (t) => t.reference ?? "—",
  },
  {
    cle: "lignes",
    entete: "Lignes",
    numeric: true,
    cellule: (t) => t.itemCount,
  },
  {
    cle: "quantite",
    entete: "Quantité",
    numeric: true,
    // Resurfaces via valeurTransfert, which renders this same quantity.
    masquerEnCarte: true,
    cellule: valeurTransfert,
  },
  {
    cle: "statut",
    entete: "Statut",
    // No masquerEnCarte: the transfer's status is auditable information and
    // stays a visible label/value pair in the card.
    cellule: (t) => (
      <Badge variant={varianteBadgeStatut(t.status)}>
        {STATUTS_TRANSFERT_FR[t.status]}
      </Badge>
    ),
  },
]

/**
 * Inter-warehouse transfers list: filter by status and creation of a
 * draft (origin, destination, reference) leading to its detail page.
 */
export function TransfertsPage() {
  const acces = useAccesStock()
  const { options: entrepots } = useEntrepotsVisibles()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Origines où l'utilisateur peut CRÉER un transfert (rôle sur l'ORIGINE).
  const entrepotsOrigine = acces.ecritureTous
    ? entrepots
    : entrepots.filter((w) => acces.entrepotsEcriture.includes(w.id))
  const peutCreer = entrepotsOrigine.length > 0

  // Destinations : l'API accepte toute destination de l'organisation, donc
  // le sélecteur ne doit pas se limiter aux entrepôts visibles de
  // l'utilisateur (qui, pour un staff manager local, ne contiennent que
  // ses propres entrepôts). GET /warehouses/destinations est accessible à
  // tout membre de l'organisation, y compris sans affectation.
  const destinations = useQuery({
    queryKey: ["warehouses-destinations"],
    queryFn: () =>
      apiFetch<{ warehouses: Array<{ id: string; name: string }> }>(
        "/api/v1/warehouses/destinations"
      ),
  })
  const entrepotsDestination = destinations.data?.warehouses ?? []

  const [statut, setStatut] = useState("")
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [statut])
  const transferts = useQuery({
    queryKey: ["transfers", statut, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) })
      if (statut) params.set("statut", statut)
      return apiFetch<{
        transfers: TransfertListe[]
        total: number
        page: number
        limite: number
      }>(`/api/v1/transfers?${params.toString()}`)
    },
  })

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [origineId, setOrigineId] = useState("")
  const [destinationId, setDestinationId] = useState("")
  const [reference, setReference] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  const creer = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/api/v1/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromWarehouseId: origineId,
          toWarehouseId: destinationId,
          reference: reference || undefined,
        }),
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["transfers"] })
      setDialogOuvert(false)
      void navigate({
        to: "/stock/transferts/$transferId",
        params: { transferId: res.id },
      })
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Transferts</h1>
        {peutCreer && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>Nouveau transfert</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouveau transfert</DialogTitle>
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
                  <Label htmlFor="t-origine">Entrepôt d'origine</Label>
                  <Select
                    value={origineId}
                    onValueChange={(valeur) => {
                      const v = valeur as string
                      setOrigineId(v)
                      if (destinationId === v) setDestinationId("")
                    }}
                    required
                  >
                    <SelectTrigger id="t-origine" className="w-full">
                      {/* base-ui ignores `placeholder` as soon as a render
                          function is passed, and calls the function even on an
                          empty value: the fallback has to live INSIDE it, or
                          the field shows nothing at all (function returning
                          undefined). */}
                      <SelectValue>
                        {(valeur: string) =>
                          entrepotsOrigine.find((w) => w.id === valeur)?.name ??
                          "— choisir —"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {entrepotsOrigine.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="t-destination">Entrepôt de destination</Label>
                  <Select
                    value={destinationId}
                    onValueChange={(valeur) =>
                      setDestinationId(valeur as string)
                    }
                    required
                  >
                    <SelectTrigger id="t-destination" className="w-full">
                      <SelectValue>
                        {(valeur: string) =>
                          entrepotsDestination.find((w) => w.id === valeur)
                            ?.name ?? "— choisir —"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {entrepotsDestination
                        .filter((w) => w.id !== origineId)
                        .map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="t-reference">Référence (optionnel)</Label>
                  <Input
                    id="t-reference"
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
                  disabled={creer.isPending || !origineId || !destinationId}
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
            <Label htmlFor="t-statut">Statut</Label>
            <Select
              value={statut}
              onValueChange={(valeur) => setStatut(valeur as string)}
            >
              <SelectTrigger id="t-statut" className="w-full sm:w-48">
                <SelectValue>
                  {(valeur: string) =>
                    valeur === ""
                      ? "Tous"
                      : STATUTS_TRANSFERT_FR[valeur as StatutTransfert]
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Tous</SelectItem>
                {Object.entries(STATUTS_TRANSFERT_FR).map(
                  ([valeur, libelle]) => (
                    <SelectItem key={valeur} value={valeur}>
                      {libelle}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </FiltresRepliables>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        {transferts.isError ? (
          <ErreurChargement
            message="Impossible de charger les transferts."
            onRetry={() => void transferts.refetch()}
          />
        ) : (
          <ListeAdaptative<TransfertListe>
            colonnes={COLONNES_TRANSFERTS}
            lignes={transferts.data?.transfers ?? []}
            cleLigne={(t) => t.id}
            titre={titreTransfert}
            valeur={valeurTransfert}
            sousTitre={sousTitreTransfert}
            chargement={transferts.isPending}
            containerClassName="min-h-0 flex-1 overflow-y-auto"
            surClicLigne={(t) =>
              void navigate({
                to: "/stock/transferts/$transferId",
                params: { transferId: t.id },
              })
            }
            etatVide={
              <EtatVide
                icon={ArrowLeftRight}
                titre="Aucun transfert"
                message={
                  peutCreer
                    ? "Créez un transfert pour déplacer du stock entre entrepôts."
                    : "Aucun transfert ne correspond à ce filtre."
                }
              />
            }
          />
        )}

        {(transferts.data?.total ?? 0) > 0 && (
          <Pagination
            className="mt-3"
            page={page}
            total={transferts.data?.total ?? 0}
            pageSize={transferts.data?.limite ?? 50}
            onPageChange={setPage}
            element={{ un: "transfert", plusieurs: "transferts" }}
          />
        )}
      </div>
    </div>
  )
}
