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
import { TEXTE_LIBRE } from "@/components/ui/table"
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"

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

/** Colored discrepancy: positive as `success`, negative as `destructive`, zero neutral.
 * Shared, unchanged, by both tables of this screen — the count table and the
 * closing recap. */
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
 * `LigneInventaire` with what the count table's cells need but the row
 * itself does not carry — arbitrage B (plan §Les quatre arbitrages tranchés,
 * B. `inventaires/$countId.tsx` — la table de saisie). `saisissable` is a
 * SCREEN-LEVEL scalar spliced into every row: the whole count is either
 * editable or read-only, but the "Compté" column sits in the MIDDLE of the
 * 4-column array, so branching on a per-row flag keeps ONE column array
 * composed by spread, instead of two enumerated arrays that would
 * desynchronize in silence.
 */
export type LigneInventaireAffichee = LigneInventaire & {
  /** Screen-level scalar spliced into every row: the whole count is either
   * editable or read-only, but the "Compté" column sits in the MIDDLE of the
   * array, so branching here keeps ONE column array composed by spread. */
  saisissable: boolean
  /** Raw local entry, or null when the server value is still the reference. */
  saisie: string | null
  surSaisie: (valeur: string) => void
  surEnregistrer: () => void
  /** Computed at the screen, verbatim — see "ne pas approcher". */
  enregistrementDesactive: boolean
}

/**
 * Card mode: reproduces `titreLigneReception`'s identity shape
 * (`receptions/$purchaseId.tsx`, Task 5) token-for-token — same dominant
 * product name, same muted `variantName (sku)` trailer.
 */
export function titreLigneInventaire(l: LigneInventaireAffichee) {
  return (
    <>
      {l.productName}{" "}
      <span className="font-normal text-muted-foreground">
        {l.variantName} ({l.sku})
      </span>
    </>
  )
}

/** The two write actions live in a single node, kept identical between the
 * table's action column and the card's trailing action so the button never
 * exists twice per row. No `w-full`: `ListeAdaptative` places `actionCarte`
 * in an unstyled `<div className="mt-2">`, so the button keeps its own
 * width and stays right-aligned — same as Task 4's `actionsNiveau`. */
export function actionEnregistrerLigne(l: LigneInventaireAffichee) {
  return (
    <span className="flex justify-end">
      <Button
        variant="outline"
        size="sm"
        disabled={l.enregistrementDesactive}
        onClick={l.surEnregistrer}
      >
        Enregistrer
      </Button>
    </span>
  )
}

/**
 * The four data columns — exactly what a read-only account sees.
 *
 * Article carries `TEXTE_LIBRE`: product/variant names are arbitrary,
 * often unbreakable human text, same reasoning as every other identity
 * column in the domain. Attendu, Compté and Écart do NOT carry it — they
 * are quantities, and `ecartRendu` colors a sign that must not be split
 * from its digit.
 */
export const COLONNES_LIGNES_INVENTAIRE: ColonneAdaptative<LigneInventaireAffichee>[] =
  [
    {
      cle: "article",
      entete: "Article",
      // Resurfaces via titreLigneInventaire.
      masquerEnCarte: true,
      classeCellule: TEXTE_LIBRE,
      cellule: (l) => (
        <>
          <span className="font-medium">{l.productName}</span>{" "}
          <span className="text-muted-foreground">
            {l.variantName} ({l.sku})
          </span>
        </>
      ),
    },
    {
      cle: "attendu",
      entete: "Attendu (à l'ouverture)",
      numeric: true,
      cellule: (l) => l.expectedQuantity,
    },
    {
      cle: "compte",
      entete: "Compté",
      numeric: true,
      // Branches on `l.saisissable`: an editable field, or the read-only
      // value — exactly as today. The single source of truth for the
      // rendered value is `l.saisie` (the raw local entry) falling back to
      // the server's `countedQuantity`, matching the JSDoc of `saisie`.
      cellule: (l) =>
        l.saisissable ? (
          <Input
            aria-label={`Quantité comptée — ${l.sku}`}
            type="number"
            min={0}
            step={1}
            className="ml-auto w-24 text-right"
            value={
              l.saisie ??
              (l.countedQuantity === null ? "" : String(l.countedQuantity))
            }
            onChange={(e) => l.surSaisie(e.target.value)}
          />
        ) : l.countedQuantity === null ? (
          <span className="text-muted-foreground">— (non compté)</span>
        ) : (
          l.countedQuantity
        ),
    },
    {
      cle: "ecart",
      entete: "Écart",
      numeric: true,
      cellule: (l) =>
        ecartRendu(
          l.countedQuantity === null
            ? null
            : l.countedQuantity - l.expectedQuantity
        ),
    },
  ]

/** Appended only when the count is open and the account can write on this
 * warehouse. `masquerEnCarte` keeps the button out of the card's pairs:
 * `actionCarte` renders the very same node there instead. Module-private:
 * the screen and its test consume the composed array below, never this
 * column on its own. */
const COLONNE_ACTION_LIGNE_INVENTAIRE: ColonneAdaptative<LigneInventaireAffichee> =
  {
    cle: "action",
    entete: "",
    masquerEnCarte: true,
    cellule: actionEnregistrerLigne,
  }

/**
 * Write-capable, open counts get the trailing action column. Derived from
 * `COLONNES_LIGNES_INVENTAIRE`, not re-enumerated — see the same reasoning
 * in `receptions/$purchaseId.tsx` and `transferts/$transferId.tsx`.
 */
export const COLONNES_LIGNES_INVENTAIRE_ECRITURE: ColonneAdaptative<LigneInventaireAffichee>[] =
  [...COLONNES_LIGNES_INVENTAIRE, COLONNE_ACTION_LIGNE_INVENTAIRE]

/**
 * The closing recap's row shape — arbitrage C (plan §Les quatre arbitrages
 * tranchés, C. `inventaires/$countId.tsx` — le récapitulatif de clôture).
 * Purely read-only: no screen-owned handler to splice, so this is a plain
 * alias kept distinct from the API-shaped `EcartCloture` for the same
 * "Affichée" naming convention as every other migrated table.
 */
export type EcartClotureAffiche = EcartCloture

/**
 * Card mode AND table mode share this one function (rule 3, plan §Composition
 * des colonnes): the recap's article cell has no table/card styling
 * divergence to protect against, unlike the count table's identity cell.
 * The fallbacks are preserved verbatim — `e.productName ?? e.variantId` and
 * the conditional `(${e.sku})` in muted — they cover a variant deleted
 * between opening and closing the count.
 */
export function titreEcartCloture(e: EcartClotureAffiche) {
  return (
    <>
      {e.productName ?? e.variantId}{" "}
      <span className="text-muted-foreground">{e.sku ? `(${e.sku})` : ""}</span>
    </>
  )
}

/**
 * The recap's four columns. Article carries `TEXTE_LIBRE` for the same
 * reason as the count table; Compté, Stock avant clôture and Écart appliqué
 * are quantities and do not.
 */
export const COLONNES_ECARTS_CLOTURE: ColonneAdaptative<EcartClotureAffiche>[] =
  [
    {
      cle: "article",
      entete: "Article",
      masquerEnCarte: true,
      classeCellule: TEXTE_LIBRE,
      cellule: titreEcartCloture,
    },
    {
      cle: "compte",
      entete: "Compté",
      numeric: true,
      cellule: (e) => e.compte,
    },
    {
      cle: "avant",
      entete: "Stock avant clôture",
      numeric: true,
      cellule: (e) => e.quantiteAvantCloture,
    },
    {
      cle: "ecart",
      entete: "Écart appliqué",
      numeric: true,
      cellule: (e) => ecartRendu(e.delta),
    },
  ]

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
  // Named once, right after its two operands: says what it AUTHORIZES (line
  // entry), not how it is computed. Every raw-predicate occurrence in the
  // file collapses to this one constant — see the plan's arbitrage D. This
  // screen has neither an "add line" button nor a predicate-gated empty-state
  // message, so it has one fewer call site than `receptions/$purchaseId.tsx`
  // and `transferts/$transferId.tsx`.
  const saisieOuverte = ouvert && peutEcrire

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-xl font-semibold break-words">
          Inventaire — {inventaire.warehouseName}
        </h1>
        <Badge variant={ouvert ? "warning" : "success"} className="shrink-0">
          {ouvert ? "Ouvert" : "Clos"}
        </Badge>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Ouvert le {new Date(inventaire.openedAt).toLocaleString("fr-FR")}
        {inventaire.closedAt
          ? ` — clos le ${new Date(inventaire.closedAt).toLocaleString("fr-FR")}`
          : ` — ${nonComptes} ligne${nonComptes > 1 ? "s" : ""} restant à compter`}
      </p>

      <ListeAdaptative<LigneInventaireAffichee>
        colonnes={
          saisieOuverte
            ? COLONNES_LIGNES_INVENTAIRE_ECRITURE
            : COLONNES_LIGNES_INVENTAIRE
        }
        lignes={inventaire.items.map((item) => ({
          ...item,
          saisissable: saisieOuverte,
          saisie: saisies[item.id] ?? null,
          surSaisie: (valeur: string) =>
            setSaisies((s) => ({ ...s, [item.id]: valeur })),
          surEnregistrer: () => {
            setErreurLigne(null)
            const brut = saisies[item.id] ?? ""
            enregistrer.mutate({
              itemId: item.id,
              countedQuantity: brut === "" ? null : Number(brut),
            })
          },
          enregistrementDesactive:
            enregistrer.isPending || !(item.id in saisies),
        }))}
        cleLigne={(l) => l.id}
        titre={titreLigneInventaire}
        actionCarte={saisieOuverte ? actionEnregistrerLigne : undefined}
        etatVide={
          <EtatVide
            icon={PackageSearch}
            titre="Aucun article"
            message="Cet entrepôt n'avait aucun article à l'ouverture de l'inventaire."
          />
        }
      />

      {erreurLigne && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {erreurLigne}
        </p>
      )}

      {saisieOuverte && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
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
          <DialogContent
            // Arbitrage C (plan §Les quatre arbitrages tranchés, C.
            // `inventaires/$countId.tsx` — le récapitulatif de clôture):
            // `dialog.tsx` caps content at `sm:max-w-sm` (384 px) from
            // 640 px on, but `useEstLarge()` switches this list back to
            // table mode at 768 px — a 4-column table would then scroll
            // horizontally inside a 384 px box. `md:max-w-2xl` gives it
            // 672 px of body from 768 px on, matching the point where
            // `ListeAdaptative` switches to table mode.
            className="md:max-w-2xl"
          >
            <DialogHeader>
              <DialogTitle>Récapitulatif de clôture</DialogTitle>
            </DialogHeader>
            {recap.ecarts.length === 0 ? (
              <p className="text-sm">
                Aucun écart : le stock correspond au comptage.
              </p>
            ) : (
              // No `containerClassName`: the dialog body is already the
              // scrolling box (`overflow-y-auto` on `dialog-body`, see
              // `dialog.tsx`) — adding a second nested scroll region here
              // would recreate the exact defect that made a dialog
              // unvalidatable in phase 2b.
              <ListeAdaptative<EcartClotureAffiche>
                colonnes={COLONNES_ECARTS_CLOTURE}
                lignes={recap.ecarts}
                cleLigne={(e) => e.variantId}
                titre={titreEcartCloture}
              />
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
