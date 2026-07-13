import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { useAccesStock } from "@/lib/permissions"
import { PackageSearch } from "lucide-react"
import { ErreurChargement } from "@/components/erreur-chargement"
import { EtatVide } from "@/components/etat-vide"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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

/** Colored discrepancy: positive as `success`, negative as `destructive`, zero neutral. */
function ecartRendu(delta: number | null) {
  if (delta === null) return <span className="text-muted-foreground">—</span>
  if (delta === 0) return <span className="text-muted-foreground">0</span>
  return (
    <span
      className={
        delta > 0 ? "font-medium text-success" : "font-medium text-destructive"
      }
    >
      {delta > 0 ? `+${delta}` : delta}
    </span>
  )
}

/**
 * Inventory count detail: entry of counted quantities per item against
 * the expected stock frozen at opening, then closing which generates the
 * discrepancy movements and displays the summary.
 */
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
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  const inventaire = data.count
  const ouvert = inventaire.status === "open"
  const peutEcrire =
    acces.ecritureTous ||
    acces.entrepotsEcriture.includes(inventaire.warehouseId)
  const nonComptes = inventaire.items.filter(
    (i) => i.countedQuantity === null
  ).length
  const colonnes = ouvert && peutEcrire ? 5 : 4

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          Inventaire — {inventaire.warehouseName}
        </h1>
        <Badge variant={ouvert ? "warning" : "success"}>
          {ouvert ? "Ouvert" : "Clos"}
        </Badge>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Ouvert le {new Date(inventaire.openedAt).toLocaleString("fr-FR")}
        {inventaire.closedAt
          ? ` — clos le ${new Date(inventaire.closedAt).toLocaleString("fr-FR")}`
          : ` — ${nonComptes} ligne${nonComptes > 1 ? "s" : ""} restant à compter`}
      </p>

      <Table>
        <TableHeader sticky>
          <TableRow>
            <TableHead>Article</TableHead>
            <TableHead numeric>Attendu (à l'ouverture)</TableHead>
            <TableHead numeric>Compté</TableHead>
            <TableHead numeric>Écart</TableHead>
            {ouvert && peutEcrire && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {inventaire.items.map((item) => {
            const ecart =
              item.countedQuantity === null
                ? null
                : item.countedQuantity - item.expectedQuantity
            return (
              <TableRow key={item.id}>
                <TableCell>
                  <span className="font-medium">{item.productName}</span>{" "}
                  <span className="text-muted-foreground">
                    {item.variantName} ({item.sku})
                  </span>
                </TableCell>
                <TableCell numeric>{item.expectedQuantity}</TableCell>
                <TableCell numeric>
                  {ouvert && peutEcrire ? (
                    <Input
                      aria-label={`Quantité comptée — ${item.sku}`}
                      type="number"
                      min={0}
                      step={1}
                      className="ml-auto w-24 text-right"
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
                    <span className="text-muted-foreground">
                      — (non compté)
                    </span>
                  ) : (
                    item.countedQuantity
                  )}
                </TableCell>
                <TableCell numeric>{ecartRendu(ecart)}</TableCell>
                {ouvert && peutEcrire && (
                  <TableCell>
                    <span className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          enregistrer.isPending || !(item.id in saisies)
                        }
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
                    </span>
                  </TableCell>
                )}
              </TableRow>
            )
          })}
          {inventaire.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={colonnes}>
                <EtatVide
                  icon={PackageSearch}
                  titre="Aucun article"
                  message="Cet entrepôt n'avait aucun article à l'ouverture de l'inventaire."
                />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {erreurLigne && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {erreurLigne}
        </p>
      )}

      {ouvert && peutEcrire && (
        <div className="mt-6 flex items-center gap-3">
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button disabled={cloturer.isPending} />}
            >
              {cloturer.isPending ? "Clôture…" : "Clôturer l'inventaire"}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clôturer l'inventaire ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Les écarts génèreront des mouvements de stock.
                  {nonComptes > 0
                    ? ` ${nonComptes} ligne${nonComptes > 1 ? "s" : ""} non comptée${nonComptes > 1 ? "s" : ""} seront ignorée${nonComptes > 1 ? "s" : ""}.`
                    : ""}{" "}
                  Cette action est irréversible.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Retour</AlertDialogCancel>
                <AlertDialogAction
                  variant="default"
                  onClick={() => {
                    setErreurCloture(null)
                    cloturer.mutate()
                  }}
                >
                  Clôturer
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {erreurCloture && (
            <p role="alert" className="text-sm text-destructive">
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
                    <TableHead numeric>Compté</TableHead>
                    <TableHead numeric>Stock avant clôture</TableHead>
                    <TableHead numeric>Écart appliqué</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recap.ecarts.map((e) => (
                    <TableRow key={e.variantId}>
                      <TableCell>
                        {e.productName ?? e.variantId}{" "}
                        <span className="text-muted-foreground">
                          {e.sku ? `(${e.sku})` : ""}
                        </span>
                      </TableCell>
                      <TableCell numeric>{e.compte}</TableCell>
                      <TableCell numeric>{e.quantiteAvantCloture}</TableCell>
                      <TableCell numeric>{ecartRendu(e.delta)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="text-sm text-muted-foreground">
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
