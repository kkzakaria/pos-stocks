import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { useAccesStock } from "@/lib/permissions"
import { useEntrepotsVisibles } from "@/lib/stock"
import { ErreurChargement } from "@/components/erreur-chargement"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
  const inventaires = useQuery({
    queryKey: ["inventory-counts", statut],
    queryFn: () =>
      apiFetch<{ counts: InventaireListe[] }>(
        `/api/v1/inventory-counts${statut ? `?statut=${statut}` : ""}`
      ),
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
                <p className="text-sm text-gray-500">
                  Les quantités attendues de TOUT l'entrepôt sont figées à
                  l'ouverture. Les ventes restent possibles pendant
                  l'inventaire.
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="i-entrepot">Entrepôt</Label>
                  <select
                    id="i-entrepot"
                    required
                    value={entrepotId}
                    onChange={(e) => setEntrepotId(e.target.value)}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="">— choisir —</option>
                    {entrepotsEcriture.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-red-700">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={ouvrir.isPending}>
                  {ouvrir.isPending ? "Ouverture…" : "Ouvrir l'inventaire"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="i-statut">Statut</Label>
        <select
          id="i-statut"
          value={statut}
          onChange={(e) => setStatut(e.target.value)}
          className="h-10 w-48 rounded-md border px-2 text-sm"
        >
          <option value="">Tous</option>
          <option value="open">Ouverts</option>
          <option value="closed">Clos</option>
        </select>
      </div>

      {inventaires.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : inventaires.isError ? (
        <ErreurChargement
          message="Impossible de charger les inventaires."
          onRetry={() => void inventaires.refetch()}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ouvert le</TableHead>
              <TableHead>Entrepôt</TableHead>
              <TableHead>Avancement</TableHead>
              <TableHead>Clos le</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inventaires.data.counts.map((i) => (
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
                <TableCell className="text-sm whitespace-nowrap">
                  {new Date(i.openedAt).toLocaleString("fr-FR")}
                </TableCell>
                <TableCell className="font-medium">{i.warehouseName}</TableCell>
                <TableCell>
                  {i.countedCount} / {i.itemCount} compté
                  {i.countedCount > 1 ? "s" : ""}
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {i.closedAt
                    ? new Date(i.closedAt).toLocaleString("fr-FR")
                    : "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={i.status === "open" ? "secondary" : "default"}
                  >
                    {i.status === "open" ? "Ouvert" : "Clos"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {inventaires.data.counts.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-sm text-gray-500"
                >
                  Aucun inventaire.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
