import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { Pagination } from "@/components/ui/pagination"

export const Route = createFileRoute("/_app/stock/transferts/")({
  component: TransfertsPage,
})

/**
 * Inter-warehouse transfers list: filter by status and creation of a
 * draft (origin, destination, reference) leading to its detail page.
 */
function TransfertsPage() {
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
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
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
                      <SelectValue placeholder="— choisir —">
                        {(valeur: string) =>
                          entrepotsOrigine.find((w) => w.id === valeur)?.name
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
                      <SelectValue placeholder="— choisir —">
                        {(valeur: string) =>
                          entrepotsDestination.find((w) => w.id === valeur)
                            ?.name
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

      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="t-statut">Statut</Label>
        <Select
          value={statut}
          onValueChange={(valeur) => setStatut(valeur as string)}
        >
          <SelectTrigger id="t-statut" className="w-48">
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
            {Object.entries(STATUTS_TRANSFERT_FR).map(([valeur, libelle]) => (
              <SelectItem key={valeur} value={valeur}>
                {libelle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {transferts.isError ? (
        <ErreurChargement
          message="Impossible de charger les transferts."
          onRetry={() => void transferts.refetch()}
        />
      ) : (
        <Table containerClassName="min-h-0 flex-1 overflow-y-auto">
          <TableHeader sticky>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Origine</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Référence</TableHead>
              <TableHead numeric>Lignes</TableHead>
              <TableHead numeric>Quantité</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transferts.isPending ? (
              <TableSkeleton colonnes={7} />
            ) : transferts.data.transfers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <EtatVide
                    icon={ArrowLeftRight}
                    titre="Aucun transfert"
                    message={
                      peutCreer
                        ? "Créez un transfert pour déplacer du stock entre entrepôts."
                        : "Aucun transfert ne correspond à ce filtre."
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              transferts.data.transfers.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer"
                  onClick={() =>
                    void navigate({
                      to: "/stock/transferts/$transferId",
                      params: { transferId: t.id },
                    })
                  }
                >
                  <TableCell className="whitespace-nowrap">
                    {new Date(t.createdAt).toLocaleDateString("fr-FR")}
                  </TableCell>
                  <TableCell>{t.fromWarehouseName}</TableCell>
                  <TableCell className="font-medium">
                    {t.toWarehouseName}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {t.reference ?? "—"}
                  </TableCell>
                  <TableCell numeric>{t.itemCount}</TableCell>
                  <TableCell numeric>{t.totalQuantity}</TableCell>
                  <TableCell>
                    <Badge variant={varianteBadgeStatut(t.status)}>
                      {STATUTS_TRANSFERT_FR[t.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
  )
}
