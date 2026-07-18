import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { useEntrepotsVisibles, LIBELLES_TYPE_MOUVEMENT } from "@/lib/stock"
import type { MouvementJournal } from "@/lib/stock"
import { History } from "lucide-react"
import { ErreurChargement } from "@/components/erreur-chargement"
import { EtatVide } from "@/components/etat-vide"
import { Pagination } from "@/components/ui/pagination"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"

export const Route = createFileRoute("/_app/stock/mouvements")({
  component: MouvementsPage,
})

const LIMITE = 50

/**
 * Stock movements journal: paginated list filterable by warehouse,
 * movement type, period, and item, to trace every entry/exit.
 */
function MouvementsPage() {
  const { options: entrepots } = useEntrepotsVisibles()

  const [entrepotId, setEntrepotId] = useState("")
  const [type, setType] = useState("")
  const [du, setDu] = useState("")
  const [au, setAu] = useState("")
  const [recherche, setRecherche] = useState("")
  const [rechercheDebouncee, setRechercheDebouncee] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setRechercheDebouncee(recherche), 300)
    return () => clearTimeout(timer)
  }, [recherche])
  const [page, setPage] = useState(1)
  // Tout changement de filtre revient page 1
  useEffect(() => {
    setPage(1)
  }, [entrepotId, type, du, au, rechercheDebouncee])

  const mouvements = useQuery({
    queryKey: [
      "stock-movements",
      entrepotId,
      type,
      du,
      au,
      rechercheDebouncee,
      page,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limite: String(LIMITE),
      })
      if (entrepotId) params.set("warehouseId", entrepotId)
      if (type) params.set("type", type)
      if (du) params.set("du", du)
      if (au) params.set("au", au)
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      return apiFetch<{ movements: MouvementJournal[]; total: number }>(
        `/api/v1/stock/movements?${params.toString()}`
      )
    },
  })

  const total = mouvements.data?.total ?? 0
  const liste = mouvements.data?.movements ?? []

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Journal des mouvements</h1>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-entrepot">Entrepôt</Label>
          <Select
            value={entrepotId}
            onValueChange={(valeur) => setEntrepotId(valeur as string)}
          >
            <SelectTrigger id="m-entrepot" className="w-56">
              <SelectValue placeholder="Tous">
                {(valeur: string) =>
                  valeur === ""
                    ? "Tous"
                    : entrepots.find((w) => w.id === valeur)?.name
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tous</SelectItem>
              {entrepots.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-type">Type</Label>
          <Select
            value={type}
            onValueChange={(valeur) => setType(valeur as string)}
          >
            <SelectTrigger id="m-type" className="w-56">
              <SelectValue placeholder="Tous">
                {(valeur: string) =>
                  valeur === "" ? "Tous" : LIBELLES_TYPE_MOUVEMENT[valeur]
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tous</SelectItem>
              {Object.entries(LIBELLES_TYPE_MOUVEMENT).map(
                ([valeur, libelle]) => (
                  <SelectItem key={valeur} value={valeur}>
                    {libelle}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-recherche">Produit (nom ou SKU)</Label>
          <Input
            id="m-recherche"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className="w-56"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-du">Du</Label>
          <Input
            id="m-du"
            type="date"
            value={du}
            onChange={(e) => setDu(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-au">Au</Label>
          <Input
            id="m-au"
            type="date"
            value={au}
            onChange={(e) => setAu(e.target.value)}
          />
        </div>
      </div>

      {mouvements.isError ? (
        <ErreurChargement
          message="Impossible de charger le journal des mouvements."
          onRetry={() => void mouvements.refetch()}
        />
      ) : (
        <>
          <Table>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entrepôt</TableHead>
                <TableHead>Article</TableHead>
                <TableHead>Type</TableHead>
                <TableHead numeric>Delta</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead>Motif</TableHead>
                <TableHead>Par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mouvements.isPending ? (
                <TableSkeleton colonnes={8} />
              ) : mouvements.data.movements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EtatVide
                      icon={History}
                      titre="Aucun mouvement"
                      message="Aucun mouvement ne correspond à ces filtres. Élargissez la période ou réinitialisez les critères."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                mouvements.data.movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {new Date(m.createdAt).toLocaleString("fr-FR")}
                    </TableCell>
                    <TableCell>{m.warehouseName}</TableCell>
                    <TableCell>
                      <span className="font-medium">{m.productName}</span>{" "}
                      <span className="text-sm text-muted-foreground">
                        {m.variantName} ({m.sku})
                      </span>
                    </TableCell>
                    <TableCell>
                      {LIBELLES_TYPE_MOUVEMENT[m.type] ?? m.type}
                    </TableCell>
                    <TableCell
                      numeric
                      className={
                        m.delta > 0
                          ? "font-medium text-success"
                          : "font-medium text-destructive"
                      }
                    >
                      {m.delta > 0 ? `+${m.delta}` : m.delta}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {m.lotNumber ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{m.reason ?? "—"}</TableCell>
                    <TableCell className="text-sm">{m.userName}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {liste.length > 0 && (
            <Pagination
              className="mt-4"
              page={page}
              total={total}
              pageSize={LIMITE}
              onPageChange={setPage}
              element={{ un: "mouvement", plusieurs: "mouvements" }}
            />
          )}
        </>
      )}
    </div>
  )
}
