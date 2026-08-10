import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { formaterMontant } from "@/lib/format"
import { useAccesStock } from "@/lib/permissions"
import { useEntrepotsVisibles } from "@/lib/stock"
import type { NiveauStock } from "@/lib/stock"
import { PackageSearch } from "lucide-react"
import { ErreurChargement } from "@/components/erreur-chargement"
import { EtatVide } from "@/components/etat-vide"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputRecherche } from "@/components/ui/input-recherche"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Pagination } from "@/components/ui/pagination"
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
} from "@/components/ui/dialog"
import { TEXTE_LIBRE } from "@/components/ui/table"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"
import { FiltresRepliables } from "@/components/ui/filtres-repliables"

export const Route = createFileRoute("/_app/stock/")({
  component: NiveauxStockPage,
})

/**
 * `NiveauStock` with the two screen-owned handlers a row does not carry on
 * its own: opening the adjustment dialog and opening the threshold dialog.
 * Same trade already made by `FournisseurAffiche` (`catalogue/fournisseurs.tsx`)
 * and `LigneVenteAffichee` (`ventes/$saleId.tsx`).
 */
export type NiveauStockAffiche = NiveauStock & {
  surAjuster: () => void
  surSeuil: () => void
}

/**
 * Card mode: reproduces `titreMouvement`'s identity shape
 * (`stock/mouvements.tsx`) token-for-token — same dominant product name,
 * same muted `variantName (sku)` trailer — so this screen and the four
 * others in the domain read as one family by the end of the phase. Not
 * imported from there: the row types differ (`NiveauStock` vs.
 * `MouvementJournal`), only the shape is shared.
 */
export function titreNiveau(n: NiveauStock) {
  return (
    <>
      {n.productName}{" "}
      <span className="font-normal text-muted-foreground">
        {n.variantName} ({n.sku})
      </span>
    </>
  )
}

/**
 * The six data columns — exactly what a read-only account sees.
 *
 * Produit, Variante and SKU all carry `TEXTE_LIBRE` (human-typed text; its
 * JSDoc in `components/ui/table.tsx` holds the mechanism). All three are
 * `masquerEnCarte`: together they resurface as `titreNiveau`, the card's
 * single identity line — table mode still renders them as three separate
 * columns, `masquerEnCarte` only governs the card's label/value pairs.
 *
 * Deliberately no `valeur` column for the card: Quantité stays a normal
 * pair, badge and figure together (see the plan's arbitrage for this
 * screen). Divorcing the "Stock bas" badge from its quantity would read
 * worse than either option at 375px.
 *
 * CMP and Seuil are formatted numbers, not human text, so neither carries
 * `TEXTE_LIBRE` — breaking a formatted amount or a threshold mid-token would
 * be a defect, not a fix.
 */
export const COLONNES_NIVEAUX: ColonneAdaptative<NiveauStockAffiche>[] = [
  {
    cle: "produit",
    entete: "Produit",
    // Resurfaces via titreNiveau, which renders this same name.
    masquerEnCarte: true,
    classeCellule: cn("font-medium", TEXTE_LIBRE),
    cellule: (n) => n.productName,
  },
  {
    cle: "variante",
    entete: "Variante",
    // Resurfaces via titreNiveau.
    masquerEnCarte: true,
    classeCellule: TEXTE_LIBRE,
    cellule: (n) => n.variantName,
  },
  {
    cle: "sku",
    entete: "SKU",
    // Resurfaces via titreNiveau.
    masquerEnCarte: true,
    classeCellule: cn("font-mono text-xs", TEXTE_LIBRE),
    cellule: (n) => n.sku,
  },
  {
    cle: "quantite",
    entete: "Quantité",
    numeric: true,
    cellule: (n) => (
      <span className="flex items-center justify-end gap-2">
        {n.enAlerte && <Badge variant="destructive">Stock bas</Badge>}
        <span className="tabular-nums">{n.quantity}</span>
      </span>
    ),
  },
  {
    cle: "cmp",
    entete: "CMP",
    numeric: true,
    cellule: (n) => formaterMontant(n.avgCost),
  },
  {
    cle: "seuil",
    entete: "Seuil",
    numeric: true,
    cellule: (n) =>
      n.seuilEffectif === null ? (
        "—"
      ) : (
        <>
          {n.seuilEffectif}
          {n.minStock === null && (
            <span className="text-muted-foreground"> (produit)</span>
          )}
        </>
      ),
  },
]

/** The two write actions, shared by the table's action column and by the
 * card's trailing action — the buttons therefore exist exactly once per row
 * in either tier. */
export function actionsNiveau(n: NiveauStockAffiche) {
  return (
    <span className="flex justify-end gap-2">
      <Button variant="outline" size="sm" onClick={n.surAjuster}>
        Ajuster
      </Button>
      <Button variant="outline" size="sm" onClick={n.surSeuil}>
        Seuil
      </Button>
    </span>
  )
}

/** Appended only when the account can write on this warehouse.
 * `masquerEnCarte` keeps the buttons out of the card's pairs: `actionCarte`
 * renders the very same node there instead. Module-private: the screen and
 * its test consume the composed array below, never this column on its
 * own. */
const COLONNE_ACTION_NIVEAU: ColonneAdaptative<NiveauStockAffiche> = {
  cle: "action",
  entete: "",
  masquerEnCarte: true,
  cellule: actionsNiveau,
}

/**
 * Write-capable roles get the trailing action column. Derived from
 * `COLONNES_NIVEAUX`, not re-enumerated — see the same reasoning in
 * `catalogue/fournisseurs.tsx`.
 */
export const COLONNES_NIVEAUX_ECRITURE: ColonneAdaptative<NiveauStockAffiche>[] =
  [...COLONNES_NIVEAUX, COLONNE_ACTION_NIVEAU]

/**
 * Per-warehouse stock levels screen: item search, alerts filter,
 * incoming in-transit stock display, quantity adjustment, and alert
 * threshold setting.
 */
export function NiveauxStockPage() {
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

  const [page, setPage] = useState(1)
  // Reset to page 1 whenever a filter changes the result set
  useEffect(() => {
    setPage(1)
  }, [entrepotId, rechercheDebouncee, alertesSeules])

  const niveaux = useQuery({
    queryKey: [
      "stock-levels",
      entrepotId,
      rechercheDebouncee,
      alertesSeules,
      page,
    ],
    queryFn: () => {
      const params = new URLSearchParams({ warehouseId: entrepotId })
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      if (alertesSeules) params.set("alertes", "true")
      params.set("page", String(page))
      return apiFetch<{
        levels: NiveauStock[]
        total: number
        page: number
        limite: number
      }>(`/api/v1/stock/levels?${params.toString()}`)
    },
    enabled: entrepotId !== "",
  })

  type LigneTransit = {
    transferId: string
    reference: string | null
    fromWarehouseName: string
    sentAt: string | null
    variantId: string
    productName: string
    variantName: string
    sku: string
    lotNumber: string | null
    quantity: number
  }
  const transit = useQuery({
    queryKey: ["stock-transit", entrepotId],
    queryFn: () =>
      apiFetch<{ transit: LigneTransit[] }>(
        `/api/v1/stock/transit?warehouseId=${entrepotId}`
      ),
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

  // Only filters actually set by the user count: the warehouse is the
  // request's SCOPE, not a restriction — see the plan's arbitrage A for
  // this screen. Counting it would show "1" permanently and would force
  // the panel open on every visit, on the one screen of the phase with the
  // most controls to collapse.
  const nbFiltresActifs = (recherche !== "" ? 1 : 0) + (alertesSeules ? 1 : 0)
  const nomEntrepotCourant = entrepots.find((w) => w.id === entrepotId)?.name

  const lignes: NiveauStockAffiche[] = (niveaux.data?.levels ?? []).map(
    (n) => ({
      ...n,
      surAjuster: () => {
        setErreurAjustement(null)
        setDelta("")
        setMotif("")
        setAjustementPour(n)
      },
      surSeuil: () => {
        setErreurSeuil(null)
        setSeuil(n.minStock === null ? "" : String(n.minStock))
        setSeuilPour(n)
      },
    })
  )

  return (
    <div className="flex h-full flex-col">
      <h1 className="mb-6 text-xl font-semibold">Niveaux de stock</h1>

      <FiltresRepliables
        nbActifs={nbFiltresActifs}
        // The warehouse isn't a counted filter, but it is the context of
        // every figure below it — "le chiffre est sacré" — so it stays
        // visible in the collapsed summary. `min-w-0 break-words` protects
        // this free-typed name from overflow: the `<summary>` is a
        // flex-ROW, so `break-words` alone (the column-container form)
        // would be inert here. See arbitrage A.
        label={
          nomEntrepotCourant ? (
            <span className="min-w-0 break-words">
              Filtres — {nomEntrepotCourant}
            </span>
          ) : (
            "Filtres"
          )
        }
      >
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex w-full flex-col gap-1.5 sm:w-56">
            <Label htmlFor="n-entrepot">Entrepôt</Label>
            <Select
              value={entrepotId}
              onValueChange={(valeur) => setEntrepotId(valeur as string)}
            >
              <SelectTrigger id="n-entrepot" className="w-full">
                <SelectValue placeholder="Choisir un entrepôt">
                  {(valeur: string) =>
                    entrepots.find((w) => w.id === valeur)?.name ??
                    "Choisir un entrepôt"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {entrepots.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-full flex-col gap-1.5 sm:w-72">
            <Label htmlFor="n-recherche">Recherche</Label>
            <InputRecherche
              id="n-recherche"
              name="recherche"
              placeholder="Produit, SKU ou code-barres…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              className="w-full"
            />
          </div>
          <div className="flex h-7 items-center gap-2">
            <Checkbox
              id="n-alertes"
              checked={alertesSeules}
              onCheckedChange={(valeur) => setAlertesSeules(valeur === true)}
            />
            <Label htmlFor="n-alertes">Alertes seulement</Label>
          </div>
        </div>
      </FiltresRepliables>

      {(transit.data?.transit.length ?? 0) > 0 && (
        <div className="mt-4 rounded-md border border-warning/20 bg-warning/10 p-4">
          <h2 className="mb-2 text-sm font-semibold text-warning">
            En transit entrant ({transit.data?.transit.length})
          </h2>
          <ul role="list" className="flex flex-col gap-1 text-sm">
            {(transit.data?.transit ?? []).map((l, index) => (
              <li
                key={`${l.transferId}-${l.variantId}-${index}`}
                className="break-words"
              >
                <span className="font-medium">{l.quantity}</span> ×{" "}
                {l.productName} — {l.variantName} ({l.sku})
                {l.lotNumber ? ` — lot ${l.lotNumber}` : ""} depuis{" "}
                {l.fromWarehouseName}
                {l.sentAt
                  ? `, expédié le ${new Date(l.sentAt).toLocaleDateString("fr-FR")}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        {niveaux.isError ? (
          <ErreurChargement
            message="Impossible de charger les niveaux de stock."
            onRetry={() => void niveaux.refetch()}
          />
        ) : (
          <ListeAdaptative<NiveauStockAffiche>
            colonnes={
              peutEcrireIci ? COLONNES_NIVEAUX_ECRITURE : COLONNES_NIVEAUX
            }
            lignes={lignes}
            cleLigne={(n) => n.variantId}
            titre={titreNiveau}
            chargement={entrepotsEnCours || niveaux.isPending}
            containerClassName="min-h-0 flex-1 overflow-y-auto"
            actionCarte={peutEcrireIci ? actionsNiveau : undefined}
            etatVide={
              <EtatVide
                icon={PackageSearch}
                titre="Aucun article en stock"
                message={
                  alertesSeules
                    ? "Aucun produit sous son seuil d'alerte dans cet entrepôt."
                    : "Aucun niveau pour cet entrepôt. Réceptionnez ou transférez du stock pour commencer."
                }
              />
            }
          />
        )}

        {(niveaux.data?.total ?? 0) > 0 && (
          <Pagination
            page={page}
            total={niveaux.data?.total ?? 0}
            pageSize={niveaux.data?.limite ?? 50}
            onPageChange={setPage}
            element={{ un: "ligne", plusieurs: "lignes" }}
            className="mt-3"
          />
        )}
      </div>

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
              <p className="text-sm text-muted-foreground">
                Stock actuel :{" "}
                <span className="tabular-nums">{ajustementPour.quantity}</span>
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
                <p role="alert" className="text-sm text-destructive">
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
                <p role="alert" className="text-sm text-destructive">
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
