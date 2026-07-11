import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { useAccesStock } from "@/lib/permissions"
import { useEntrepotsVisibles } from "@/lib/stock"
import type { NiveauStock } from "@/lib/stock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

export const Route = createFileRoute("/_app/stock/")({
  component: NiveauxStockPage,
})

function NiveauxStockPage() {
  const acces = useAccesStock()
  const { options: entrepots, isPending: entrepotsEnCours } =
    useEntrepotsVisibles()
  const queryClient = useQueryClient()

  const [entrepotId, setEntrepotId] = useState("")
  // Présélectionne le premier entrepôt dès que la liste arrive
  useEffect(() => {
    if (!entrepotId && entrepots.length > 0) {
      setEntrepotId(entrepots[0]?.id ?? "")
    }
  }, [entrepots, entrepotId])

  const [recherche, setRecherche] = useState("")
  const [rechercheDebouncee, setRechercheDebouncee] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setRechercheDebouncee(recherche), 300)
    return () => clearTimeout(timer)
  }, [recherche])
  const [alertesSeules, setAlertesSeules] = useState(false)

  const niveaux = useQuery({
    queryKey: ["stock-levels", entrepotId, rechercheDebouncee, alertesSeules],
    queryFn: () => {
      const params = new URLSearchParams({ warehouseId: entrepotId })
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      if (alertesSeules) params.set("alertes", "true")
      return apiFetch<{ levels: NiveauStock[] }>(
        `/api/v1/stock/levels?${params.toString()}`
      )
    },
    enabled: entrepotId !== "",
  })

  const peutEcrireIci =
    acces.ecritureTous || acces.entrepotsEcriture.includes(entrepotId)

  const invalider = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] }),
    ])

  // Dialogue d'ajustement
  const [ajustementPour, setAjustementPour] = useState<NiveauStock | null>(null)
  const [delta, setDelta] = useState("")
  const [motif, setMotif] = useState("")
  const [erreurAjustement, setErreurAjustement] = useState<string | null>(null)

  const ajuster = useMutation({
    mutationFn: (niveau: NiveauStock) =>
      apiFetch(`/api/v1/stock/warehouses/${entrepotId}/adjustments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          variantId: niveau.variantId,
          delta: Number(delta),
          reason: motif,
        }),
      }),
    onSuccess: async () => {
      await invalider()
      setAjustementPour(null)
      setDelta("")
      setMotif("")
      setErreurAjustement(null)
    },
    onError: (err) =>
      setErreurAjustement(err instanceof Error ? err.message : "Erreur"),
  })

  // Dialogue de seuil
  const [seuilPour, setSeuilPour] = useState<NiveauStock | null>(null)
  const [seuil, setSeuil] = useState("")
  const [erreurSeuil, setErreurSeuil] = useState<string | null>(null)

  const definirSeuil = useMutation({
    mutationFn: (niveau: NiveauStock) =>
      apiFetch(
        `/api/v1/stock/warehouses/${entrepotId}/levels/${niveau.variantId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            minStock: seuil === "" ? null : Number(seuil),
          }),
        }
      ),
    onSuccess: async () => {
      await invalider()
      setSeuilPour(null)
      setSeuil("")
      setErreurSeuil(null)
    },
    onError: (err) =>
      setErreurSeuil(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Niveaux de stock</h1>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="n-entrepot">Entrepôt</Label>
          <select
            id="n-entrepot"
            value={entrepotId}
            onChange={(e) => setEntrepotId(e.target.value)}
            className="h-10 rounded-md border px-2 text-sm"
          >
            {entrepots.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="n-recherche">
            Recherche (produit, SKU, code-barres)
          </Label>
          <Input
            id="n-recherche"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className="w-72"
          />
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={alertesSeules}
            onChange={(e) => setAlertesSeules(e.target.checked)}
          />
          Alertes seulement
        </label>
      </div>

      {entrepotsEnCours || niveaux.isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produit</TableHead>
              <TableHead>Variante</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Quantité</TableHead>
              <TableHead>CMP</TableHead>
              <TableHead>Seuil</TableHead>
              {peutEcrireIci && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(niveaux.data?.levels ?? []).map((n) => (
              <TableRow key={n.variantId}>
                <TableCell className="font-medium">{n.productName}</TableCell>
                <TableCell>{n.variantName}</TableCell>
                <TableCell className="font-mono text-xs">{n.sku}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {n.quantity}
                    {n.enAlerte && (
                      <Badge variant="destructive">Stock bas</Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell>{formaterMontant(n.avgCost)}</TableCell>
                <TableCell>
                  {n.seuilEffectif === null
                    ? "—"
                    : `${n.seuilEffectif}${n.minStock === null ? " (produit)" : ""}`}
                </TableCell>
                {peutEcrireIci && (
                  <TableCell>
                    <span className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setErreurAjustement(null)
                          setDelta("")
                          setMotif("")
                          setAjustementPour(n)
                        }}
                      >
                        Ajuster
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setErreurSeuil(null)
                          setSeuil(
                            n.minStock === null ? "" : String(n.minStock)
                          )
                          setSeuilPour(n)
                        }}
                      >
                        Seuil
                      </Button>
                    </span>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {niveaux.data?.levels.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={peutEcrireIci ? 7 : 6}
                  className="text-center text-sm text-gray-500"
                >
                  Aucun article en stock pour cet entrepôt.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {ajustementPour !== null && (
        <Dialog
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setAjustementPour(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Ajuster — {ajustementPour.productName} (
                {ajustementPour.variantName})
              </DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setErreurAjustement(null)
                ajuster.mutate(ajustementPour)
              }}
            >
              <p className="text-sm text-gray-500">
                Stock actuel : {ajustementPour.quantity}
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="a-delta">Delta (+ entrée, − sortie)</Label>
                <Input
                  id="a-delta"
                  type="number"
                  step={1}
                  required
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="a-motif">Motif (obligatoire)</Label>
                <Input
                  id="a-motif"
                  required
                  value={motif}
                  onChange={(e) => setMotif(e.target.value)}
                />
              </div>
              {erreurAjustement && (
                <p role="alert" className="text-sm text-red-700">
                  {erreurAjustement}
                </p>
              )}
              <Button type="submit" disabled={ajuster.isPending}>
                {ajuster.isPending ? "Ajustement…" : "Ajuster le stock"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {seuilPour !== null && (
        <Dialog
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setSeuilPour(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Seuil d'alerte — {seuilPour.productName} (
                {seuilPour.variantName})
              </DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setErreurSeuil(null)
                definirSeuil.mutate(seuilPour)
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-seuil">
                  Seuil pour cet entrepôt (vide = hériter du produit)
                </Label>
                <Input
                  id="s-seuil"
                  type="number"
                  min={0}
                  step={1}
                  value={seuil}
                  onChange={(e) => setSeuil(e.target.value)}
                />
              </div>
              {erreurSeuil && (
                <p role="alert" className="text-sm text-red-700">
                  {erreurSeuil}
                </p>
              )}
              <Button type="submit" disabled={definirSeuil.isPending}>
                {definirSeuil.isPending
                  ? "Enregistrement…"
                  : "Enregistrer le seuil"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
