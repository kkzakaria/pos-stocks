import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Receipt, Store } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import {
  boutiquesLisibles,
  fetchVentesPeriode,
  periodePreset,
} from "@/lib/rapports"
import type { VenteListe } from "@/lib/pos-api"
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
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"
import { Pagination } from "@/components/ui/pagination"
import { FiltresRepliables } from "@/components/ui/filtres-repliables"

export const Route = createFileRoute("/_app/ventes/")({
  component: HistoriqueVentes,
})

const PRESETS = [
  { id: "jour", libelle: "Aujourd'hui" },
  { id: "semaine", libelle: "7 jours" },
  { id: "mois", libelle: "Ce mois" },
] as const

const MESSAGE_VIDE =
  "Aucune vente sur cette période. Élargissez la période ou changez de boutique."

/** Shared between the table's "detail" column and the card's trailing action — the pattern phases 2–4 should copy instead of duplicating the JSX. */
function lienDetail(v: VenteListe) {
  return (
    <Link
      to="/ventes/$saleId"
      params={{ saleId: v.id }}
      className="text-primary hover:underline"
    >
      Détail
    </Link>
  )
}

export const COLONNES_VENTES: ColonneAdaptative<VenteListe>[] = [
  {
    cle: "numero",
    entete: "N°",
    numeric: true,
    masquerEnCarte: true,
    cellule: (v) => v.ticketNumber,
  },
  {
    cle: "date",
    entete: "Date",
    masquerEnCarte: true,
    cellule: (v) => new Date(v.createdAt).toLocaleString("fr-FR"),
  },
  { cle: "caissier", entete: "Caissier", cellule: (v) => v.cashierName },
  {
    cle: "articles",
    entete: "Articles",
    numeric: true,
    cellule: (v) => v.itemCount,
  },
  {
    cle: "total",
    entete: "Total",
    numeric: true,
    masquerEnCarte: true,
    cellule: (v) => formaterMontant(v.total, v.currency),
  },
  {
    cle: "detail",
    entete: "",
    masquerEnCarte: true,
    classeCellule: "text-right",
    cellule: lienDetail,
  },
]

/** Card mode: the ticket number identifies the row. */
export function titreVente(v: VenteListe) {
  return `N° ${v.ticketNumber}`
}

/** Card mode: the total is the headline figure. */
export function valeurVente(v: VenteListe) {
  return formaterMontant(v.total, v.currency)
}

export function sousTitreVente(v: VenteListe) {
  return new Date(v.createdAt).toLocaleString("fr-FR")
}

/** Sales history page: list paginated by store and period (presets or dates), filtered to the stores the account can read. */
export function HistoriqueVentes() {
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
  // Frozen at mount: the "semaine" window the page opens on, used below as
  // the neutral baseline against which we decide whether the period counts
  // as a user-set filter. `useRef`'s initial-value argument is only kept on
  // the first render, so this stays stable even though `periodePreset`
  // itself reads the current date every render.
  const periodeParDefaut = useRef(periodePreset("semaine")).current
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
  // Page size read from the API response (it echoes limite) rather than a
  // literal, so the page count can't drift from the server's actual paging.
  const parPage = ventes.data?.limite ?? 50
  const aucuneBoutique = destinations.isSuccess && boutiques.length === 0

  // Only filters actually set by the user: the boutique select has no
  // "toutes" option, so it's only "set" once the user has explicitly picked
  // one — the fallback to the first store on mount doesn't count. The dates
  // are never empty (a real "semaine" window is the initial state, not a
  // blank filter), so each date only counts once it has drifted from that
  // opening window — whether by hand or via a preset button.
  const nbFiltresActifs =
    (boutiqueChoisie !== null ? 1 : 0) +
    (periode.du !== periodeParDefaut.du ? 1 : 0) +
    (periode.au !== periodeParDefaut.au ? 1 : 0)

  return (
    <div className="flex h-full flex-col">
      <h1 className="text-xl font-semibold">Historique des ventes</h1>
      <FiltresRepliables nbActifs={nbFiltresActifs}>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex w-full flex-col gap-1.5 sm:w-56">
            <Label htmlFor="v-boutique">Boutique</Label>
            <Select
              value={boutiqueId ?? ""}
              onValueChange={(valeur) => {
                setBoutiqueChoisie(valeur)
                setPage(1)
              }}
            >
              <SelectTrigger id="v-boutique" className="w-full">
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
          <div className="flex w-full flex-col gap-1.5 sm:w-auto">
            <Label htmlFor="v-du">Du</Label>
            <Input
              id="v-du"
              type="date"
              value={periode.du}
              onChange={(e) => {
                setPeriode((p) => ({ ...p, du: e.target.value }))
                setPage(1)
              }}
            />
          </div>
          <div className="flex w-full flex-col gap-1.5 sm:w-auto">
            <Label htmlFor="v-au">Au</Label>
            <Input
              id="v-au"
              type="date"
              value={periode.au}
              onChange={(e) => {
                setPeriode((p) => ({ ...p, au: e.target.value }))
                setPage(1)
              }}
            />
          </div>
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
      </FiltresRepliables>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
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
            <ListeAdaptative<VenteListe>
              colonnes={COLONNES_VENTES}
              lignes={liste}
              cleLigne={(v) => v.id}
              titre={titreVente}
              valeur={valeurVente}
              sousTitre={sousTitreVente}
              chargement={ventes.isLoading}
              containerClassName="min-h-0 flex-1 overflow-y-auto"
              etatVide={
                <EtatVide
                  icon={Receipt}
                  titre="Aucune vente"
                  message={MESSAGE_VIDE}
                />
              }
              actionCarte={lienDetail}
            />
            {liste.length > 0 && (
              <Pagination
                className="mt-3"
                page={page}
                total={total}
                pageSize={parPage}
                onPageChange={setPage}
                element={{ un: "vente", plusieurs: "ventes" }}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
