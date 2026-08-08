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
import { InputRecherche } from "@/components/ui/input-recherche"
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
import { FiltresRepliables } from "@/components/ui/filtres-repliables"

export const Route = createFileRoute("/_app/stock/mouvements")({
  component: MouvementsPage,
})

const LIMITE = 50

export const COLONNES_MOUVEMENTS: ColonneAdaptative<MouvementJournal>[] = [
  {
    cle: "date",
    entete: "Date",
    masquerEnCarte: true,
    // whitespace-nowrap is already the TableCell default — no wrapper needed.
    classeCellule: "text-sm",
    cellule: (m) => new Date(m.createdAt).toLocaleString("fr-FR"),
  },
  { cle: "entrepot", entete: "Entrepôt", cellule: (m) => m.warehouseName },
  {
    cle: "article",
    entete: "Article",
    masquerEnCarte: true,
    cellule: (m) => (
      <>
        <span className="font-medium">{m.productName}</span>{" "}
        <span className="text-sm text-muted-foreground">
          {m.variantName} ({m.sku})
        </span>
      </>
    ),
  },
  {
    cle: "type",
    entete: "Type",
    cellule: (m) => LIBELLES_TYPE_MOUVEMENT[m.type] ?? m.type,
  },
  {
    cle: "delta",
    entete: "Delta",
    numeric: true,
    masquerEnCarte: true,
    cellule: (m) => (
      <span
        className={
          m.delta > 0
            ? "font-medium text-success"
            : "font-medium text-destructive"
        }
      >
        {m.delta > 0 ? `+${m.delta}` : m.delta}
      </span>
    ),
  },
  {
    cle: "lot",
    entete: "Lot",
    classeCellule: "font-mono",
    cellule: (m) => m.lotNumber ?? "—",
  },
  {
    cle: "motif",
    entete: "Motif",
    classeCellule: "text-sm",
    cellule: (m) => m.reason ?? "—",
  },
  {
    cle: "par",
    entete: "Par",
    classeCellule: "text-sm",
    cellule: (m) => m.userName,
  },
]

/** Card mode: the product identifies the row. */
export function titreMouvement(m: MouvementJournal) {
  return (
    <>
      {m.productName}{" "}
      <span className="font-normal text-muted-foreground">
        {m.variantName} ({m.sku})
      </span>
    </>
  )
}

/** Card mode: the signed delta is the headline figure. */
export function valeurMouvement(m: MouvementJournal) {
  return (
    <span className={m.delta > 0 ? "text-success" : "text-destructive"}>
      {m.delta > 0 ? `+${m.delta}` : m.delta}
    </span>
  )
}

export function sousTitreMouvement(m: MouvementJournal) {
  return new Date(m.createdAt).toLocaleString("fr-FR")
}

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

  // Only filters actually set by the user: a Select left on "Tous", or an
  // empty search/date, is the neutral default and doesn't count.
  const nbFiltresActifs =
    (entrepotId !== "" ? 1 : 0) +
    (type !== "" ? 1 : 0) +
    (recherche !== "" ? 1 : 0) +
    (du !== "" ? 1 : 0) +
    (au !== "" ? 1 : 0)

  return (
    <div className="flex h-full flex-col">
      <h1 className="mb-6 text-xl font-semibold">Journal des mouvements</h1>

      <FiltresRepliables nbActifs={nbFiltresActifs}>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex w-full flex-col gap-1.5 sm:w-56">
            <Label htmlFor="m-entrepot">Entrepôt</Label>
            <Select
              value={entrepotId}
              onValueChange={(valeur) => setEntrepotId(valeur as string)}
            >
              <SelectTrigger id="m-entrepot" className="w-full">
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
          <div className="flex w-full flex-col gap-1.5 sm:w-56">
            <Label htmlFor="m-type">Type</Label>
            <Select
              value={type}
              onValueChange={(valeur) => setType(valeur as string)}
            >
              <SelectTrigger id="m-type" className="w-full">
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
          <div className="flex w-full flex-col gap-1.5 sm:w-56">
            <Label htmlFor="m-recherche">Produit</Label>
            <InputRecherche
              id="m-recherche"
              name="recherche"
              placeholder="Nom ou SKU…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              className="w-full"
            />
          </div>
          <div className="flex w-full flex-col gap-1.5 sm:w-56">
            <Label htmlFor="m-du">Du</Label>
            <Input
              id="m-du"
              type="date"
              value={du}
              onChange={(e) => setDu(e.target.value)}
            />
          </div>
          <div className="flex w-full flex-col gap-1.5 sm:w-56">
            <Label htmlFor="m-au">Au</Label>
            <Input
              id="m-au"
              type="date"
              value={au}
              onChange={(e) => setAu(e.target.value)}
            />
          </div>
        </div>
      </FiltresRepliables>

      {mouvements.isError ? (
        <ErreurChargement
          message="Impossible de charger le journal des mouvements."
          onRetry={() => void mouvements.refetch()}
        />
      ) : (
        <>
          <ListeAdaptative<MouvementJournal>
            colonnes={COLONNES_MOUVEMENTS}
            lignes={liste}
            cleLigne={(m) => m.id}
            titre={titreMouvement}
            valeur={valeurMouvement}
            sousTitre={sousTitreMouvement}
            chargement={mouvements.isPending}
            containerClassName="min-h-0 flex-1 overflow-y-auto"
            etatVide={
              <EtatVide
                icon={History}
                titre="Aucun mouvement"
                message="Aucun mouvement ne correspond à ces filtres. Élargissez la période ou réinitialisez les critères."
              />
            }
          />
          {liste.length > 0 && (
            <Pagination
              className="mt-3"
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
