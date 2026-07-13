import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import {
  boutiquesLisibles,
  fetchVentesPeriode,
  periodePreset,
} from "@/lib/rapports"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

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

  return (
    <div>
      <h1 className="text-xl font-semibold">Historique des ventes</h1>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Boutique
          <select
            className="mt-1 block rounded border px-2 py-1.5 text-sm"
            value={boutiqueId ?? ""}
            onChange={(e) => {
              setBoutiqueChoisie(e.target.value)
              setPage(1)
            }}
          >
            {boutiques.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
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

      {destinations.isSuccess && boutiques.length === 0 && (
        <p className="mt-6 text-sm text-gray-500">
          Aucune boutique lisible pour ce compte.
        </p>
      )}
      {ventes.isPending && boutiqueId !== null && periodeValide && (
        <p className="mt-6 text-sm text-gray-500">Chargement…</p>
      )}
      {ventes.isError && (
        <div className="mt-6">
          <p role="alert" className="mb-2 text-sm text-red-600">
            {ventes.error instanceof Error
              ? ventes.error.message
              : "Impossible de charger les ventes"}
          </p>
          <Button variant="outline" onClick={() => void ventes.refetch()}>
            Réessayer
          </Button>
        </div>
      )}
      {ventes.isSuccess && liste.length === 0 && (
        <p className="mt-6 text-sm text-gray-500">
          Aucune vente sur cette période.
        </p>
      )}
      {ventes.isSuccess && liste.length > 0 && (
        <>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2">N°</th>
                <th>Date</th>
                <th>Caissier</th>
                <th className="text-right">Articles</th>
                <th className="text-right">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {liste.map((vente) => (
                <tr key={vente.id} className="border-b">
                  <td className="py-2">{vente.ticketNumber}</td>
                  <td>{new Date(vente.createdAt).toLocaleString("fr-FR")}</td>
                  <td>{vente.cashierName}</td>
                  <td className="text-right">{vente.itemCount}</td>
                  <td className="text-right tabular-nums">
                    {formaterMontant(vente.total, vente.currency)}
                  </td>
                  <td className="text-right">
                    <Link
                      to="/ventes/$saleId"
                      params={{ saleId: vente.id }}
                      className="text-blue-600 hover:underline"
                    >
                      Détail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Précédent
              </Button>
              <span className="text-gray-500">
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
  )
}
