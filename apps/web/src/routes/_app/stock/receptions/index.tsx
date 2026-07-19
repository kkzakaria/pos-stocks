import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
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

const LIBELLES_STATUT: Record<string, string> = {
  "": "Tous",
  draft: "Brouillons",
  received: "Validées",
}

/**
 * Supplier receipts list: filter by status (draft/validated) and
 * creation of a draft (warehouse, supplier, reference) leading to its
 * detail page.
 */
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
                  <Select
                    value={entrepotId}
                    onValueChange={(valeur) => setEntrepotId(valeur as string)}
                  >
                    <SelectTrigger id="r-entrepot" className="w-full">
                      <SelectValue placeholder="— choisir —" />
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
                      <SelectValue placeholder="— choisir —" />
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

      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="r-statut">Statut</Label>
        <Select
          value={statut}
          onValueChange={(valeur) => setStatut(valeur as string)}
        >
          <SelectTrigger id="r-statut" className="w-48">
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

      {receptions.isError ? (
        <ErreurChargement
          message="Impossible de charger les réceptions."
          onRetry={() => void receptions.refetch()}
        />
      ) : (
        <Table>
          <TableHeader sticky>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Entrepôt</TableHead>
              <TableHead>Fournisseur</TableHead>
              <TableHead>Référence</TableHead>
              <TableHead numeric>Lignes</TableHead>
              <TableHead numeric>Total</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receptions.isPending ? (
              <TableSkeleton colonnes={7} />
            ) : receptions.data.purchases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <EtatVide
                    icon={Truck}
                    titre="Aucune réception"
                    message={
                      peutCreer
                        ? "Aucune réception pour ce filtre. Créez une réception pour entrer du stock fournisseur."
                        : "Aucune réception pour ce filtre."
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              receptions.data.purchases.map((r) => (
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
                  <TableCell className="font-medium">
                    {r.supplierName}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.reference ?? "—"}
                  </TableCell>
                  <TableCell numeric>{r.itemCount}</TableCell>
                  <TableCell numeric>{formaterMontant(r.totalCost)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={r.status === "draft" ? "warning" : "success"}
                    >
                      {r.status === "draft" ? "Brouillon" : "Validée"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
  )
}
