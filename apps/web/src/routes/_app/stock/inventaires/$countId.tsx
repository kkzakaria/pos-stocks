import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { useAccesStock } from "@/lib/permissions"
import { ErreurChargement } from "@/components/erreur-chargement"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_app/stock/inventaires/$countId")({
  component: InventaireDetailPage,
})

type LigneInventaire = {
  id: string
  variantId: string
  productName: string
  variantName: string
  sku: string
  expectedQuantity: number
  countedQuantity: number | null
}

type Inventaire = {
  id: string
  warehouseId: string
  warehouseName: string
  status: "open" | "closed"
  openedAt: string
  closedAt: string | null
  items: LigneInventaire[]
}

type EcartCloture = {
  variantId: string
  productName: string | null
  variantName: string | null
  sku: string | null
  attendu: number
  compte: number
  quantiteAvantCloture: number
  delta: number
}

type ReponseCloture = {
  ok: boolean
  ecarts: EcartCloture[]
  nonComptes: number
  mouvements: number
}

function InventaireDetailPage() {
  const { countId } = Route.useParams()
  const acces = useAccesStock()
  const queryClient = useQueryClient()

  const { data, isError, refetch } = useQuery({
    queryKey: ["inventory-count", countId],
    queryFn: () =>
      apiFetch<{ count: Inventaire }>(`/api/v1/inventory-counts/${countId}`),
  })

  const invalider = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["inventory-count", countId] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-counts"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] }),
    ])

  // Saisies locales (chaînes brutes) par ligne ; la valeur serveur reste la
  // référence tant que la ligne n'est pas enregistrée.
  const [saisies, setSaisies] = useState<Record<string, string>>({})
  const [erreurLigne, setErreurLigne] = useState<string | null>(null)
  const enregistrer = useMutation({
    mutationFn: (v: { itemId: string; countedQuantity: number | null }) =>
      apiFetch(`/api/v1/inventory-counts/${countId}/items/${v.itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ countedQuantity: v.countedQuantity }),
      }),
    onSuccess: async (_res, v) => {
      await invalider()
      setSaisies((s) => {
        const reste = { ...s }
        // La valeur serveur fraîchement invalidée redevient la référence
        delete reste[v.itemId]
        return reste
      })
    },
    onError: (err) =>
      setErreurLigne(err instanceof Error ? err.message : "Erreur"),
  })

  const [recap, setRecap] = useState<ReponseCloture | null>(null)
  const [erreurCloture, setErreurCloture] = useState<string | null>(null)
  const cloturer = useMutation({
    mutationFn: () =>
      apiFetch<ReponseCloture>(`/api/v1/inventory-counts/${countId}/close`, {
        method: "POST",
      }),
    onSuccess: async (res) => {
      await invalider()
      setRecap(res)
    },
    onError: (err) =>
      setErreurCloture(err instanceof Error ? err.message : "Erreur"),
  })

  if (isError) {
    return (
      <ErreurChargement
        message="Impossible de charger l'inventaire."
        onRetry={() => void refetch()}
      />
    )
  }
  if (!data) {
    return <p className="text-sm text-gray-500">Chargement…</p>
  }
  const inventaire = data.count
  const ouvert = inventaire.status === "open"
  const peutEcrire =
    acces.ecritureTous ||
    acces.entrepotsEcriture.includes(inventaire.warehouseId)
  const nonComptes = inventaire.items.filter(
    (i) => i.countedQuantity === null
  ).length

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          Inventaire — {inventaire.warehouseName}
        </h1>
        <Badge variant={ouvert ? "secondary" : "default"}>
          {ouvert ? "Ouvert" : "Clos"}
        </Badge>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Ouvert le {new Date(inventaire.openedAt).toLocaleString("fr-FR")}
        {inventaire.closedAt
          ? ` — clos le ${new Date(inventaire.closedAt).toLocaleString("fr-FR")}`
          : ` — ${nonComptes} ligne${nonComptes > 1 ? "s" : ""} restant à compter`}
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Article</TableHead>
            <TableHead>Attendu (à l'ouverture)</TableHead>
            <TableHead>Compté</TableHead>
            {ouvert && peutEcrire && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {inventaire.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <span className="font-medium">{item.productName}</span>{" "}
                <span className="text-sm text-gray-500">
                  {item.variantName} ({item.sku})
                </span>
              </TableCell>
              <TableCell>{item.expectedQuantity}</TableCell>
              <TableCell>
                {ouvert && peutEcrire ? (
                  <Input
                    aria-label={`Quantité comptée — ${item.sku}`}
                    type="number"
                    min={0}
                    step={1}
                    className="w-24"
                    value={
                      saisies[item.id] ??
                      (item.countedQuantity === null
                        ? ""
                        : String(item.countedQuantity))
                    }
                    onChange={(e) =>
                      setSaisies((s) => ({ ...s, [item.id]: e.target.value }))
                    }
                  />
                ) : item.countedQuantity === null ? (
                  "— (non compté)"
                ) : (
                  item.countedQuantity
                )}
              </TableCell>
              {ouvert && peutEcrire && (
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={enregistrer.isPending || !(item.id in saisies)}
                    onClick={() => {
                      setErreurLigne(null)
                      const brut = saisies[item.id] ?? ""
                      enregistrer.mutate({
                        itemId: item.id,
                        countedQuantity: brut === "" ? null : Number(brut),
                      })
                    }}
                  >
                    Enregistrer
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {erreurLigne && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {erreurLigne}
        </p>
      )}

      {ouvert && peutEcrire && (
        <div className="mt-6 flex items-center gap-3">
          <Button
            disabled={cloturer.isPending}
            onClick={() => {
              setErreurCloture(null)
              if (
                window.confirm(
                  `Clôturer l'inventaire ? Les écarts génèreront des mouvements de stock.${
                    nonComptes > 0
                      ? ` ${nonComptes} ligne(s) non comptée(s) seront ignorées.`
                      : ""
                  }`
                )
              ) {
                cloturer.mutate()
              }
            }}
          >
            {cloturer.isPending ? "Clôture…" : "Clôturer l'inventaire"}
          </Button>
          {erreurCloture && (
            <p role="alert" className="text-sm text-red-700">
              {erreurCloture}
            </p>
          )}
        </div>
      )}

      {recap !== null && (
        <Dialog
          open
          onOpenChange={(ouvertDialog) => {
            if (!ouvertDialog) setRecap(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Récapitulatif de clôture</DialogTitle>
            </DialogHeader>
            {recap.ecarts.length === 0 ? (
              <p className="text-sm">
                Aucun écart : le stock correspond au comptage.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Article</TableHead>
                    <TableHead>Compté</TableHead>
                    <TableHead>Stock avant clôture</TableHead>
                    <TableHead>Écart appliqué</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recap.ecarts.map((e) => (
                    <TableRow key={e.variantId}>
                      <TableCell className="text-sm">
                        {e.productName ?? e.variantId}{" "}
                        <span className="text-gray-500">
                          {e.sku ? `(${e.sku})` : ""}
                        </span>
                      </TableCell>
                      <TableCell>{e.compte}</TableCell>
                      <TableCell>{e.quantiteAvantCloture}</TableCell>
                      <TableCell
                        className={
                          e.delta > 0
                            ? "font-medium text-green-700"
                            : "font-medium text-red-700"
                        }
                      >
                        {e.delta > 0 ? `+${e.delta}` : e.delta}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="text-sm text-gray-500">
              {recap.mouvements} mouvement{recap.mouvements > 1 ? "s" : ""} de
              stock généré{recap.mouvements > 1 ? "s" : ""}
              {recap.nonComptes > 0
                ? ` — ${recap.nonComptes} ligne(s) non comptée(s) ignorée(s)`
                : ""}
              .
            </p>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
