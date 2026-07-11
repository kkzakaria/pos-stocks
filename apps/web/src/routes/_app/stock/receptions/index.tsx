import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { useAccesStock } from "@/lib/permissions"
import { useEntrepotsVisibles } from "@/lib/stock"
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

export const Route = createFileRoute("/_app/stock/receptions/")({
  component: ReceptionsPage,
})

type ReceptionListe = {
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

function ReceptionsPage() {
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
  const receptions = useQuery({
    queryKey: ["purchases", statut],
    queryFn: () =>
      apiFetch<{ purchases: ReceptionListe[] }>(
        `/api/v1/purchases${statut ? `?statut=${statut}` : ""}`
      ),
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
    <div>
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
                  <select
                    id="r-entrepot"
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
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="r-fournisseur">Fournisseur</Label>
                  <select
                    id="r-fournisseur"
                    required
                    value={fournisseurId}
                    onChange={(e) => setFournisseurId(e.target.value)}
                    className="h-10 rounded-md border px-2 text-sm"
                  >
                    <option value="">— choisir —</option>
                    {(fournisseurs.data?.suppliers ?? [])
                      .filter((f) => f.isActive)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
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
        <Label htmlFor="r-statut">Statut</Label>
        <select
          id="r-statut"
          value={statut}
          onChange={(e) => setStatut(e.target.value)}
          className="h-10 w-48 rounded-md border px-2 text-sm"
        >
          <option value="">Tous</option>
          <option value="draft">Brouillons</option>
          <option value="received">Validées</option>
        </select>
      </div>

      {receptions.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : receptions.isError ? (
        <ErreurChargement
          message="Impossible de charger les réceptions."
          onRetry={() => void receptions.refetch()}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Entrepôt</TableHead>
              <TableHead>Fournisseur</TableHead>
              <TableHead>Référence</TableHead>
              <TableHead>Lignes</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receptions.data.purchases.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() =>
                  void navigate({
                    to: "/stock/receptions/$purchaseId",
                    params: { purchaseId: r.id },
                  })
                }
              >
                <TableCell className="text-sm whitespace-nowrap">
                  {new Date(r.createdAt).toLocaleDateString("fr-FR")}
                </TableCell>
                <TableCell>{r.warehouseName}</TableCell>
                <TableCell className="font-medium">{r.supplierName}</TableCell>
                <TableCell className="font-mono text-xs">
                  {r.reference ?? "—"}
                </TableCell>
                <TableCell>{r.itemCount}</TableCell>
                <TableCell>{formaterMontant(r.totalCost)}</TableCell>
                <TableCell>
                  <Badge
                    variant={r.status === "draft" ? "secondary" : "default"}
                  >
                    {r.status === "draft" ? "Brouillon" : "Validée"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {receptions.data.purchases.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-sm text-gray-500"
                >
                  Aucune réception.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
