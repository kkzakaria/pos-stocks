import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { formaterMontant } from "@/lib/format"
import { useAccesStock } from "@/lib/permissions"
import {
  STATUTS_TRANSFERT_FR,
  preparerReception,
  varianteBadgeStatut,
} from "@/lib/transferts"
import type { LigneTransfert, TransfertDetail } from "@/lib/transferts"
import { PackageSearch } from "lucide-react"
import { ErreurChargement } from "@/components/erreur-chargement"
import { EtatVide } from "@/components/etat-vide"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
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

export const Route = createFileRoute("/_app/stock/transferts/$transferId")({
  component: TransfertDetailPage,
})

type ProduitCatalogue = {
  id: string
  name: string
  trackLots: boolean
  variants: Array<{ id: string; name: string; sku: string; isActive: boolean }>
}

type VarianteCatalogue = {
  variantId: string
  productId: string
  libelle: string
  trackLots: boolean
}

type ProduitAvecLots = {
  product: {
    variants: Array<{
      id: string
      lots: Array<{ id: string; lotNumber: string }>
    }>
  }
}

/**
 * `LigneTransfert` with the two screen-owned handlers a row does not carry
 * on its own: opening the edit dialog and removing the line. Same trade
 * already made by `LigneReceptionAffichee` (`receptions/$purchaseId.tsx`)
 * and `NiveauStockAffiche` (`stock/index.tsx`).
 */
export type LigneTransfertAffichee = LigneTransfert & {
  surModifier: () => void
  surRetirer: () => void
}

/**
 * Card mode: reproduces `titreLigneReception`'s identity shape (Task 5)
 * token-for-token — same dominant product name, same muted
 * `variantName (sku)` trailer.
 */
export function titreLigneTransfert(l: LigneTransfertAffichee) {
  return (
    <>
      {l.productName}{" "}
      <span className="font-normal text-muted-foreground">
        {l.variantName} ({l.sku})
      </span>
    </>
  )
}

/**
 * The five data columns — exactly what a read-only account sees.
 *
 * Article and Lot carry `TEXTE_LIBRE`: a lot number is an arbitrary, often
 * unbreakable token, same reasoning as the product/variant names it sits
 * next to. CMP figé does NOT carry it — a formatted amount is atomic. Reçu
 * does NOT carry it either: it pairs a discrepancy badge with a number,
 * splitting them would break the link between the two.
 */
export const COLONNES_LIGNES_TRANSFERT: ColonneAdaptative<LigneTransfertAffichee>[] =
  [
    {
      cle: "article",
      entete: "Article",
      // Resurfaces via titreLigneTransfert.
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
      cle: "quantite",
      entete: "Quantité",
      numeric: true,
      cellule: (l) => l.quantity,
    },
    {
      cle: "lot",
      entete: "Lot",
      classeCellule: cn("font-mono text-xs", TEXTE_LIBRE),
      cellule: (l) => l.lotNumber ?? "—",
    },
    {
      cle: "cmpFige",
      entete: "CMP figé",
      numeric: true,
      cellule: (l) => (l.unitCost === null ? "—" : formaterMontant(l.unitCost)),
    },
    {
      cle: "recu",
      entete: "Reçu",
      numeric: true,
      cellule: (l) =>
        l.receivedQuantity === null ? (
          "—"
        ) : (
          <span className="flex items-center justify-end gap-2">
            {l.receivedQuantity < l.quantity && (
              <Badge variant="destructive">
                Écart −{l.quantity - l.receivedQuantity}
              </Badge>
            )}
            <span className="tabular-nums">{l.receivedQuantity}</span>
          </span>
        ),
    },
  ]

/** The two write actions, shared by the table's action column and by the
 * card's trailing action — the buttons therefore exist exactly once per row
 * in either tier. */
export function actionsLigneTransfert(l: LigneTransfertAffichee) {
  return (
    <span className="flex justify-end gap-2">
      <Button variant="outline" size="sm" onClick={l.surModifier}>
        Modifier
      </Button>
      <Button variant="outline" size="sm" onClick={l.surRetirer}>
        Retirer
      </Button>
    </span>
  )
}

/** Appended only when the account can write on this draft. `masquerEnCarte`
 * keeps the buttons out of the card's pairs: `actionCarte` renders the very
 * same node there instead. Module-private: the screen and its test consume
 * the composed array below, never this column on its own. */
const COLONNE_ACTION_LIGNE_TRANSFERT: ColonneAdaptative<LigneTransfertAffichee> =
  {
    cle: "action",
    entete: "",
    masquerEnCarte: true,
    cellule: actionsLigneTransfert,
  }

/**
 * Write-capable roles get the trailing action column. Derived from
 * `COLONNES_LIGNES_TRANSFERT`, not re-enumerated — see the same reasoning
 * in `receptions/$purchaseId.tsx`.
 */
export const COLONNES_LIGNES_TRANSFERT_ECRITURE: ColonneAdaptative<LigneTransfertAffichee>[] =
  [...COLONNES_LIGNES_TRANSFERT, COLONNE_ACTION_LIGNE_TRANSFERT]

/**
 * Inter-warehouse transfer detail: editing the draft's lines (item,
 * quantity, lot), shipping or cancellation from the origin, then
 * reception with entry of received quantities and tracking of
 * discrepancies.
 */
function TransfertDetailPage() {
  const { transferId } = Route.useParams()
  const acces = useAccesStock()
  const queryClient = useQueryClient()

  const { data, isError, refetch } = useQuery({
    queryKey: ["transfer", transferId],
    queryFn: () =>
      apiFetch<{ transfer: TransfertDetail }>(
        `/api/v1/transfers/${transferId}`
      ),
  })

  const invalider = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["transfer", transferId] }),
      queryClient.invalidateQueries({ queryKey: ["transfers"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-transit"] }),
    ])

  // Recherche d'article pour l'ajout de ligne
  const [rechercheArticle, setRechercheArticle] = useState("")
  const [rechercheDebouncee, setRechercheDebouncee] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setRechercheDebouncee(rechercheArticle), 300)
    return () => clearTimeout(timer)
  }, [rechercheArticle])
  const catalogue = useQuery({
    queryKey: ["products", rechercheDebouncee, "actifs"],
    queryFn: () => {
      const params = new URLSearchParams({ actifs: "true" })
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      // Search picker: fetch up to the max page (search narrows further).
      params.set("limite", "200")
      return apiFetch<{ products: ProduitCatalogue[] }>(
        `/api/v1/products?${params.toString()}`
      )
    },
  })
  const variantes: VarianteCatalogue[] = (
    catalogue.data?.products ?? []
  ).flatMap((p) =>
    p.variants
      .filter((v) => v.isActive)
      .map((v) => ({
        variantId: v.id,
        productId: p.id,
        libelle: `${p.name} — ${v.name} (${v.sku})`,
        trackLots: p.trackLots,
      }))
  )

  // Dialogue de ligne (création si ligneEditee === null, édition sinon)
  const [dialogLigne, setDialogLigne] = useState(false)
  const [ligneEditee, setLigneEditee] = useState<LigneTransfert | null>(null)
  const [variantId, setVariantId] = useState("")
  const [quantite, setQuantite] = useState("")
  const [lotId, setLotId] = useState("")
  const [erreurLigne, setErreurLigne] = useState<string | null>(null)

  const varianteChoisie = variantes.find((v) => v.variantId === variantId)
  const suitLots = ligneEditee
    ? ligneEditee.trackLots
    : (varianteChoisie?.trackLots ?? false)
  // Lots disponibles pour la variante de la ligne (le lot est global à la
  // variante) : chargés depuis la fiche produit.
  const produitIdPourLots = ligneEditee
    ? ligneEditee.trackLots
      ? ligneEditee.productId
      : ""
    : varianteChoisie?.trackLots
      ? varianteChoisie.productId
      : ""
  const varianteIdPourLots = ligneEditee ? ligneEditee.variantId : variantId
  const produitLots = useQuery({
    queryKey: ["product", produitIdPourLots],
    queryFn: () =>
      apiFetch<ProduitAvecLots>(`/api/v1/products/${produitIdPourLots}`),
    enabled: produitIdPourLots !== "",
  })
  const lotsDisponibles =
    produitLots.data?.product.variants.find((v) => v.id === varianteIdPourLots)
      ?.lots ?? []

  function ouvrirCreation() {
    setLigneEditee(null)
    setVariantId("")
    setQuantite("")
    setLotId("")
    setErreurLigne(null)
    setDialogLigne(true)
  }

  function ouvrirEdition(ligne: LigneTransfert) {
    setLigneEditee(ligne)
    setVariantId(ligne.variantId)
    setQuantite(String(ligne.quantity))
    setLotId(ligne.lotId ?? "")
    setErreurLigne(null)
    setDialogLigne(true)
  }

  const enregistrerLigne = useMutation({
    mutationFn: () => {
      if (ligneEditee) {
        return apiFetch(
          `/api/v1/transfers/${transferId}/items/${ligneEditee.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              quantity: Number(quantite),
              ...(ligneEditee.trackLots ? { lotId: lotId || null } : {}),
            }),
          }
        )
      }
      return apiFetch(`/api/v1/transfers/${transferId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          variantId,
          quantity: Number(quantite),
          lotId: suitLots && lotId ? lotId : undefined,
        }),
      })
    },
    onSuccess: async () => {
      await invalider()
      setDialogLigne(false)
    },
    onError: (err) =>
      setErreurLigne(err instanceof Error ? err.message : "Erreur"),
  })

  const [erreurSuppression, setErreurSuppression] = useState<string | null>(
    null
  )
  const supprimerLigne = useMutation({
    mutationFn: (itemId: string) =>
      apiFetch(`/api/v1/transfers/${transferId}/items/${itemId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      setErreurSuppression(null)
      await invalider()
    },
    onError: (err) =>
      setErreurSuppression(err instanceof Error ? err.message : "Erreur"),
  })

  const [erreurAction, setErreurAction] = useState<string | null>(null)
  const expedier = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/transfers/${transferId}/send`, { method: "POST" }),
    onSuccess: invalider,
    onError: (err) =>
      setErreurAction(err instanceof Error ? err.message : "Erreur"),
  })
  const annuler = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/transfers/${transferId}/cancel`, { method: "POST" }),
    onSuccess: invalider,
    onError: (err) =>
      setErreurAction(err instanceof Error ? err.message : "Erreur"),
  })

  // Dialogue de réception : saisie des quantités reçues par ligne
  const [dialogReception, setDialogReception] = useState(false)
  const [saisiesRecues, setSaisiesRecues] = useState<Record<string, string>>({})
  const [erreurReception, setErreurReception] = useState<string | null>(null)
  const receptionner = useMutation({
    mutationFn: (corps: {
      items: Array<{ itemId: string; receivedQuantity: number }>
    }) =>
      apiFetch(`/api/v1/transfers/${transferId}/receive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corps),
      }),
    onSuccess: async () => {
      await invalider()
      setDialogReception(false)
    },
    onError: (err) =>
      setErreurReception(err instanceof Error ? err.message : "Erreur"),
  })

  if (isError) {
    return (
      <ErreurChargement
        message="Impossible de charger le transfert."
        onRetry={() => void refetch()}
      />
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-80" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  const transfert = data.transfer
  const brouillon = transfert.status === "pending"
  const expedie = transfert.status === "sent"
  const peutEcrireOrigine =
    acces.ecritureTous ||
    acces.entrepotsEcriture.includes(transfert.fromWarehouseId)
  const peutEcrireDestination =
    acces.ecritureTous ||
    acces.entrepotsEcriture.includes(transfert.toWarehouseId)
  // Named once, right after its two operands: says what it AUTHORIZES (line
  // editing from the origin side), not how it is computed. Every raw-predicate
  // occurrence in the file collapses to this one constant — see the plan's
  // arbitrage D. `peutEcrireDestination` is a SEPARATE, unrelated permission
  // gating the "Réceptionner" button below — never folded in here.
  const ligneModifiable = brouillon && peutEcrireOrigine

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-xl font-semibold break-words">
          Transfert — {transfert.fromWarehouseName} →{" "}
          {transfert.toWarehouseName}
        </h1>
        <Badge
          variant={varianteBadgeStatut(transfert.status)}
          className="shrink-0"
        >
          {STATUTS_TRANSFERT_FR[transfert.status]}
        </Badge>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {transfert.reference ? `Réf. ${transfert.reference} — ` : ""}
        créé le {new Date(transfert.createdAt).toLocaleString("fr-FR")}
        {transfert.sentAt
          ? ` — expédié le ${new Date(transfert.sentAt).toLocaleString("fr-FR")}`
          : ""}
        {transfert.receivedAt
          ? ` — réceptionné le ${new Date(transfert.receivedAt).toLocaleString("fr-FR")}`
          : ""}
        {transfert.cancelledAt
          ? ` — annulé le ${new Date(transfert.cancelledAt).toLocaleString("fr-FR")}`
          : ""}
      </p>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Lignes</h2>
        {ligneModifiable && (
          <Button variant="outline" size="sm" onClick={ouvrirCreation}>
            Ajouter une ligne
          </Button>
        )}
      </div>

      <ListeAdaptative<LigneTransfertAffichee>
        colonnes={
          ligneModifiable
            ? COLONNES_LIGNES_TRANSFERT_ECRITURE
            : COLONNES_LIGNES_TRANSFERT
        }
        lignes={transfert.items.map((item) => ({
          ...item,
          surModifier: () => ouvrirEdition(item),
          surRetirer: () => supprimerLigne.mutate(item.id),
        }))}
        cleLigne={(l) => l.id}
        titre={titreLigneTransfert}
        actionCarte={ligneModifiable ? actionsLigneTransfert : undefined}
        etatVide={
          <EtatVide
            icon={PackageSearch}
            titre="Aucune ligne"
            message={
              ligneModifiable
                ? "Ajoutez des articles à transférer avant d'expédier."
                : "Ce transfert ne comporte aucune ligne."
            }
          />
        }
      />

      {erreurSuppression && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {erreurSuppression}
        </p>
      )}

      {ligneModifiable && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  disabled={expedier.isPending || transfert.items.length === 0}
                />
              }
            >
              {expedier.isPending ? "Expédition…" : "Expédier"}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Expédier le transfert ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Le stock sortira de l'entrepôt d'origine et les lignes seront
                  figées. Cette action est irréversible.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Retour</AlertDialogCancel>
                <AlertDialogAction
                  variant="default"
                  onClick={() => {
                    setErreurAction(null)
                    expedier.mutate()
                  }}
                >
                  Expédier
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="outline" disabled={annuler.isPending} />}
            >
              Annuler le transfert
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Annuler ce transfert ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Le brouillon sera annulé. Cette action est irréversible.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Retour</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setErreurAction(null)
                    annuler.mutate()
                  }}
                >
                  Annuler le transfert
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {erreurAction && (
            <p role="alert" className="text-sm text-destructive">
              {erreurAction}
            </p>
          )}
        </div>
      )}

      {expedie && peutEcrireDestination && (
        <div className="mt-6">
          <Button
            onClick={() => {
              setErreurReception(null)
              setSaisiesRecues({})
              setDialogReception(true)
            }}
          >
            Réceptionner
          </Button>
        </div>
      )}

      {dialogLigne && (
        <Dialog
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setDialogLigne(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {ligneEditee ? "Modifier la ligne" : "Ajouter une ligne"}
              </DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setErreurLigne(null)
                enregistrerLigne.mutate()
              }}
            >
              {ligneEditee ? (
                <p className="text-sm font-medium">
                  {ligneEditee.productName} — {ligneEditee.variantName} (
                  {ligneEditee.sku})
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tl-recherche">Rechercher un article</Label>
                    <Input
                      id="tl-recherche"
                      placeholder="nom, SKU ou code-barres"
                      value={rechercheArticle}
                      onChange={(e) => setRechercheArticle(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tl-variante">Article</Label>
                    <Select
                      value={variantId}
                      onValueChange={(valeur) => {
                        setVariantId(valeur as string)
                        setLotId("")
                      }}
                    >
                      <SelectTrigger id="tl-variante" className="w-full">
                        <SelectValue>
                          {(valeur: string) =>
                            variantes.find((v) => v.variantId === valeur)
                              ?.libelle ?? "— choisir —"
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {variantes.map((v) => (
                          <SelectItem key={v.variantId} value={v.variantId}>
                            {v.libelle}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tl-quantite">Quantité</Label>
                <Input
                  id="tl-quantite"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={quantite}
                  onChange={(e) => setQuantite(e.target.value)}
                />
              </div>
              {suitLots && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tl-lot">Lot (requis avant expédition)</Label>
                  <Select
                    value={lotId}
                    onValueChange={(valeur) => setLotId(valeur as string)}
                  >
                    <SelectTrigger id="tl-lot" className="w-full">
                      <SelectValue>
                        {(valeur: string) =>
                          lotsDisponibles.find((l) => l.id === valeur)
                            ?.lotNumber ?? "— à choisir avant expédition —"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {lotsDisponibles.map((lot) => (
                        <SelectItem key={lot.id} value={lot.id}>
                          {lot.lotNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {erreurLigne && (
                <p role="alert" className="text-sm text-destructive">
                  {erreurLigne}
                </p>
              )}
              <Button
                type="submit"
                disabled={
                  enregistrerLigne.isPending || (!ligneEditee && !variantId)
                }
              >
                {enregistrerLigne.isPending
                  ? "Enregistrement…"
                  : ligneEditee
                    ? "Enregistrer"
                    : "Ajouter la ligne"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {dialogReception && (
        <Dialog
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setDialogReception(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Réceptionner le transfert</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setErreurReception(null)
                const prepare = preparerReception(
                  transfert.items,
                  saisiesRecues
                )
                if (!prepare.ok) {
                  setErreurReception(prepare.erreur)
                  return
                }
                receptionner.mutate({ items: prepare.items })
              }}
            >
              <p className="text-sm text-muted-foreground">
                Laissez vide (ou égal à l'expédié) pour une réception totale.
                Une quantité moindre trace l'écart en ajustement.
              </p>
              {transfert.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm break-words">
                    {item.productName} — {item.variantName} (expédié :{" "}
                    {item.quantity})
                  </span>
                  <Input
                    aria-label={`Quantité reçue — ${item.sku}`}
                    type="number"
                    min={0}
                    max={item.quantity}
                    step={1}
                    className="w-24 shrink-0"
                    placeholder={String(item.quantity)}
                    value={saisiesRecues[item.id] ?? ""}
                    onChange={(e) =>
                      setSaisiesRecues((s) => ({
                        ...s,
                        [item.id]: e.target.value,
                      }))
                    }
                  />
                </div>
              ))}
              {erreurReception && (
                <p role="alert" className="text-sm text-destructive">
                  {erreurReception}
                </p>
              )}
              <Button type="submit" disabled={receptionner.isPending}>
                {receptionner.isPending ? "Réception…" : "Valider la réception"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
