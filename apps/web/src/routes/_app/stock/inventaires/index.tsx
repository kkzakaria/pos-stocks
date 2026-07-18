import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
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

export const Route = createFileRoute("/_app/stock/inventaires/")({
  component: InventairesPage,
})

type InventaireListe = {
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
 * Inventory counts list: filter by status (open/closed), counting
 * progress, and opening of a full warehouse count leading to its detail
 * page.
 */
function InventairesPage() {
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
    <div>
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
                      <SelectValue placeholder="— choisir —">
                        {(valeur: string) =>
                          entrepotsEcriture.find((w) => w.id === valeur)?.name
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

      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="i-statut">Statut</Label>
        <Select
          value={statut}
          onValueChange={(valeur) => setStatut(valeur as string)}
        >
          <SelectTrigger id="i-statut" className="w-48">
            <SelectValue>
              {(valeur: string) => STATUTS_INVENTAIRE_FR[valeur]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Tous</SelectItem>
            <SelectItem value="open">Ouverts</SelectItem>
            <SelectItem value="closed">Clos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {inventaires.isError ? (
        <ErreurChargement
          message="Impossible de charger les inventaires."
          onRetry={() => void inventaires.refetch()}
        />
      ) : (
        <Table>
          <TableHeader sticky>
            <TableRow>
              <TableHead>Ouvert le</TableHead>
              <TableHead>Entrepôt</TableHead>
              <TableHead>Avancement</TableHead>
              <TableHead>Clos le</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inventaires.isPending ? (
              <TableSkeleton colonnes={5} />
            ) : inventaires.data.counts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EtatVide
                    icon={ClipboardList}
                    titre="Aucun inventaire"
                    message={
                      peutOuvrir
                        ? "Ouvrez un inventaire pour recompter et réconcilier le stock d'un entrepôt."
                        : "Aucun inventaire ne correspond à ce filtre."
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              inventaires.data.counts.map((i) => (
                <TableRow
                  key={i.id}
                  className="cursor-pointer"
                  onClick={() =>
                    void navigate({
                      to: "/stock/inventaires/$countId",
                      params: { countId: i.id },
                    })
                  }
                >
                  <TableCell className="whitespace-nowrap">
                    {new Date(i.openedAt).toLocaleString("fr-FR")}
                  </TableCell>
                  <TableCell className="font-medium">
                    {i.warehouseName}
                  </TableCell>
                  <TableCell>
                    <span className="tabular-nums">
                      {i.countedCount} / {i.itemCount}
                    </span>{" "}
                    compté{i.countedCount > 1 ? "s" : ""}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {i.closedAt
                      ? new Date(i.closedAt).toLocaleString("fr-FR")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={i.status === "open" ? "warning" : "success"}
                    >
                      {i.status === "open" ? "Ouvert" : "Clos"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
      {(inventaires.data?.counts.length ?? 0) > 0 && (
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
  )
}
