import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { useEntrepotsVisibles, LIBELLES_TYPE_MOUVEMENT } from "@/lib/stock"
import type { MouvementJournal } from "@/lib/stock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_app/stock/mouvements")({
  component: MouvementsPage,
})

const LIMITE = 50

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
  const dernierePage = Math.max(1, Math.ceil(total / LIMITE))

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Journal des mouvements</h1>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-entrepot">Entrepôt</Label>
          <select
            id="m-entrepot"
            value={entrepotId}
            onChange={(e) => setEntrepotId(e.target.value)}
            className="h-10 rounded-md border px-2 text-sm"
          >
            <option value="">Tous</option>
            {entrepots.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-type">Type</Label>
          <select
            id="m-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-10 rounded-md border px-2 text-sm"
          >
            <option value="">Tous</option>
            {Object.entries(LIBELLES_TYPE_MOUVEMENT).map(
              ([valeur, libelle]) => (
                <option key={valeur} value={valeur}>
                  {libelle}
                </option>
              )
            )}
          </select>
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

      {mouvements.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entrepôt</TableHead>
                <TableHead>Article</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Delta</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead>Motif</TableHead>
                <TableHead>Par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(mouvements.data?.movements ?? []).map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {new Date(m.createdAt).toLocaleString("fr-FR")}
                  </TableCell>
                  <TableCell>{m.warehouseName}</TableCell>
                  <TableCell>
                    <span className="font-medium">{m.productName}</span>{" "}
                    <span className="text-sm text-gray-500">
                      {m.variantName} ({m.sku})
                    </span>
                  </TableCell>
                  <TableCell>
                    {LIBELLES_TYPE_MOUVEMENT[m.type] ?? m.type}
                  </TableCell>
                  <TableCell
                    className={
                      m.delta > 0
                        ? "font-medium text-green-700"
                        : "font-medium text-red-700"
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
              ))}
              {mouvements.data?.movements.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-sm text-gray-500"
                  >
                    Aucun mouvement.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Précédent
            </Button>
            <span className="text-sm text-gray-500">
              Page {page} / {dernierePage} — {total} mouvement
              {total > 1 ? "s" : ""}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= dernierePage}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
