import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { useAccesStock } from "@/lib/permissions"
import { useEntrepotsVisibles } from "@/lib/stock"
import { STATUTS_TRANSFERT_FR, varianteBadgeStatut } from "@/lib/transferts"
import type { TransfertListe } from "@/lib/transferts"
import { ErreurChargement } from "@/components/erreur-chargement"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_app/stock/transferts/")({
  component: TransfertsPage,
})

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
  const transferts = useQuery({
    queryKey: ["transfers", statut],
    queryFn: () =>
      apiFetch<{ transfers: TransfertListe[] }>(
        `/api/v1/transfers${statut ? `?statut=${statut}` : ""}`
      ),
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
    <div>
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
                  <select
                    id="t-origine"
                    required
                    value={origineId}
                    onChange={(e) => {
                      const valeur = e.target.value
                      setOrigineId(valeur)
                      if (destinationId === valeur) setDestinationId("")
                    }}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="">— choisir —</option>
                    {entrepotsOrigine.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="t-destination">Entrepôt de destination</Label>
                  <select
                    id="t-destination"
                    required
                    value={destinationId}
                    onChange={(e) => setDestinationId(e.target.value)}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="">— choisir —</option>
                    {entrepotsDestination
                      .filter((w) => w.id !== origineId)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
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
                  <p role="alert" className="text-sm text-red-700">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer le brouillon"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="t-statut">Statut</Label>
        <select
          id="t-statut"
          value={statut}
          onChange={(e) => setStatut(e.target.value)}
          className="h-10 w-48 rounded-md border px-2 text-sm"
        >
          <option value="">Tous</option>
          {Object.entries(STATUTS_TRANSFERT_FR).map(([valeur, libelle]) => (
            <option key={valeur} value={valeur}>
              {libelle}
            </option>
          ))}
        </select>
      </div>

      {transferts.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : transferts.isError ? (
        <ErreurChargement
          message="Impossible de charger les transferts."
          onRetry={() => void transferts.refetch()}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Origine</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Référence</TableHead>
              <TableHead>Lignes</TableHead>
              <TableHead>Quantité</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transferts.data.transfers.map((t) => (
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
                <TableCell className="text-sm whitespace-nowrap">
                  {new Date(t.createdAt).toLocaleDateString("fr-FR")}
                </TableCell>
                <TableCell>{t.fromWarehouseName}</TableCell>
                <TableCell className="font-medium">
                  {t.toWarehouseName}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {t.reference ?? "—"}
                </TableCell>
                <TableCell>{t.itemCount}</TableCell>
                <TableCell>{t.totalQuantity}</TableCell>
                <TableCell>
                  <Badge variant={varianteBadgeStatut(t.status)}>
                    {STATUTS_TRANSFERT_FR[t.status]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {transferts.data.transfers.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-sm text-gray-500"
                >
                  Aucun transfert.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
