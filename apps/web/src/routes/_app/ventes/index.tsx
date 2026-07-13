import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Receipt, Store } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import {
  boutiquesLisibles,
  fetchVentesPeriode,
  periodePreset,
} from "@/lib/rapports"
import { ErreurChargement } from "@/components/erreur-chargement"
import { EtatVide } from "@/components/etat-vide"
import { Button } from "@/components/ui/button"
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

export const Route = createFileRoute("/_app/ventes/")({
  component: HistoriqueVentes,
})

const PRESETS = [
  { id: "jour", libelle: "Aujourd'hui" },
  { id: "semaine", libelle: "7 jours" },
  { id: "mois", libelle: "Ce mois" },
] as const

function HistoriqueVentes() {
  const { me } = useRouteContext({ from: "/_app" })
  const destinations = useQuery({
    queryKey: ["destinations"],
    queryFn: () =>
      apiFetch<{
        warehouses: Array<{ id: string; name: string; type: string }>
      }>("/api/v1/warehouses/destinations"),
  })
  const boutiques = boutiquesLisibles(me, destinations.data?.warehouses ?? [])
  const [boutiqueChoisie, setBoutiqueChoisie] = useState<string | null>(null)
  const [periode, setPeriode] = useState(() => periodePreset("semaine"))
  const [page, setPage] = useState(1)
  const premiere = boutiques.length > 0 ? boutiques[0].id : null
  const boutiqueId = boutiqueChoisie ?? premiere
  const periodeValide = periode.du !== "" && periode.au !== ""
  const ventes = useQuery({
    queryKey: ["ventes-periode", boutiqueId, periode.du, periode.au, page],
    queryFn: () =>
      fetchVentesPeriode({
        storeId: boutiqueId ?? "",
        du: periode.du,
        au: periode.au,
        page,
      }),
    enabled: boutiqueId !== null && periodeValide,
  })
  const liste = ventes.data?.sales ?? []
  const total = ventes.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / 50))
  const aucuneBoutique = destinations.isSuccess && boutiques.length === 0

  return (
    <div>
      <h1 className="text-xl font-semibold">Historique des ventes</h1>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="v-boutique">Boutique</Label>
          <Select
            value={boutiqueId ?? ""}
            onValueChange={(valeur) => {
              setBoutiqueChoisie(valeur)
              setPage(1)
            }}
          >
            <SelectTrigger id="v-boutique" className="w-56">
              <SelectValue placeholder="Choisir une boutique">
                {(valeur: string) =>
                  boutiques.find((b) => b.id === valeur)?.name
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {boutiques.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="text-sm">
          Du
          <Input
            type="date"
            className="mt-1"
            value={periode.du}
            onChange={(e) => {
              setPeriode((p) => ({ ...p, du: e.target.value }))
              setPage(1)
            }}
          />
        </label>
        <label className="text-sm">
          Au
          <Input
            type="date"
            className="mt-1"
            value={periode.au}
            onChange={(e) => {
              setPeriode((p) => ({ ...p, au: e.target.value }))
              setPage(1)
            }}
          />
        </label>
        {PRESETS.map((preset) => (
          <Button
            key={preset.id}
            variant="outline"
            onClick={() => {
              setPeriode(periodePreset(preset.id))
              setPage(1)
            }}
          >
            {preset.libelle}
          </Button>
        ))}
      </div>

      <div className="mt-4">
        {aucuneBoutique ? (
          <EtatVide
            icon={Store}
            titre="Aucune boutique lisible"
            message="Ce compte n'est affecté à aucune boutique. Demandez une affectation à un administrateur."
          />
        ) : ventes.isError ? (
          <ErreurChargement
            message={
              ventes.error instanceof Error
                ? ventes.error.message
                : "Impossible de charger les ventes."
            }
            onRetry={() => void ventes.refetch()}
          />
        ) : (
          <>
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead numeric>N°</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Caissier</TableHead>
                  <TableHead numeric>Articles</TableHead>
                  <TableHead numeric>Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ventes.isPending ? (
                  <TableSkeleton colonnes={6} />
                ) : liste.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EtatVide
                        icon={Receipt}
                        titre="Aucune vente"
                        message="Aucune vente sur cette période. Élargissez la période ou changez de boutique."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  liste.map((vente) => (
                    <TableRow key={vente.id}>
                      <TableCell numeric>{vente.ticketNumber}</TableCell>
                      <TableCell>
                        {new Date(vente.createdAt).toLocaleString("fr-FR")}
                      </TableCell>
                      <TableCell>{vente.cashierName}</TableCell>
                      <TableCell numeric>{vente.itemCount}</TableCell>
                      <TableCell numeric>
                        {formaterMontant(vente.total, vente.currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to="/ventes/$saleId"
                          params={{ saleId: vente.id }}
                          className="text-primary hover:underline"
                        >
                          Détail
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {liste.length > 0 && pages > 1 && (
              <div className="mt-3 flex items-center justify-between text-sm">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Précédent
                </Button>
                <span className="text-muted-foreground">
                  Page {page} / {pages} — {total} ventes
                </span>
                <Button
                  variant="outline"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Suivant
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
