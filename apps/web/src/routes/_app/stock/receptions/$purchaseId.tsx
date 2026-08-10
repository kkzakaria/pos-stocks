import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { formaterMontant } from "@/lib/format"
import { useAccesStock } from "@/lib/permissions"
import { PackagePlus } from "lucide-react"
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

export const Route = createFileRoute("/_app/stock/receptions/$purchaseId")({
  component: ReceptionDetailPage,
})

type LigneReception = {
  id: string
  variantId: string
  productName: string
  variantName: string
  sku: string
  trackLots: boolean
  quantity: number
  unitCost: number
  lotNumber: string | null
  expiryDate: string | null
}

type Reception = {
  id: string
  warehouseId: string
  warehouseName: string
  supplierId: string
  supplierName: string
  reference: string | null
  status: "draft" | "received"
  createdAt: string
  receivedAt: string | null
  items: LigneReception[]
}

type VarianteCatalogue = {
  variantId: string
  libelle: string
  trackLots: boolean
}

type ProduitCatalogue = {
  id: string
  name: string
  trackLots: boolean
  variants: Array<{ id: string; name: string; sku: string; isActive: boolean }>
}

/**
 * `LigneReception` with the two screen-owned handlers a row does not carry
 * on its own: opening the edit dialog and removing the line. Same trade
 * already made by `NiveauStockAffiche` (`stock/index.tsx`) and
 * `FournisseurAffiche` (`catalogue/fournisseurs.tsx`).
 */
export type LigneReceptionAffichee = LigneReception & {
  surModifier: () => void
  surRetirer: () => void
}

/**
 * Card mode: reproduces `titreNiveau`'s identity shape (`stock/index.tsx`)
 * token-for-token — same dominant product name, same muted
 * `variantName (sku)` trailer.
 */
export function titreLigneReception(l: LigneReceptionAffichee) {
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
 * Article and Lot carry `TEXTE_LIBRE`: a supplier's lot number is an
 * arbitrary, often unbreakable token, same reasoning as the product/variant
 * names it sits next to. Péremption does NOT carry it — a formatted expiry
 * date is atomic, and cutting it in half is precisely the defect the
 * product sheet suffered. Quantité and Coût unitaire are formatted numbers,
 * not human text, so neither carries it either.
 *
 * No `valeur`/`sousTitre`: five columns read fine as a title plus four
 * pairs, and inventing a per-line total would surface data the table
 * doesn't actually carry.
 */
export const COLONNES_LIGNES_RECEPTION: ColonneAdaptative<LigneReceptionAffichee>[] =
  [
    {
      cle: "article",
      entete: "Article",
      // Resurfaces via titreLigneReception.
      masquerEnCarte: true,
      classeCellule: TEXTE_LIBRE,
      cellule: (l) => (
        <>
          <span className="font-medium">{l.productName}</span>{" "}
          <span className="text-sm text-muted-foreground">
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
      cle: "cout",
      entete: "Coût unitaire",
      numeric: true,
      cellule: (l) => formaterMontant(l.unitCost),
    },
    {
      cle: "lot",
      entete: "Lot",
      classeCellule: cn("font-mono text-xs", TEXTE_LIBRE),
      cellule: (l) => l.lotNumber ?? "—",
    },
    {
      cle: "peremption",
      entete: "Péremption",
      classeCellule: "text-sm",
      cellule: (l) =>
        l.expiryDate ? new Date(l.expiryDate).toLocaleDateString("fr-FR") : "—",
    },
  ]

/** The two write actions, shared by the table's action column and by the
 * card's trailing action — the buttons therefore exist exactly once per row
 * in either tier. */
export function actionsLigneReception(l: LigneReceptionAffichee) {
  return (
    <span className="flex gap-2">
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
const COLONNE_ACTION_LIGNE_RECEPTION: ColonneAdaptative<LigneReceptionAffichee> =
  {
    cle: "action",
    entete: "",
    masquerEnCarte: true,
    cellule: actionsLigneReception,
  }

/**
 * Write-capable roles get the trailing action column. Derived from
 * `COLONNES_LIGNES_RECEPTION`, not re-enumerated — see the same reasoning
 * in `catalogue/fournisseurs.tsx`.
 */
export const COLONNES_LIGNES_RECEPTION_ECRITURE: ColonneAdaptative<LigneReceptionAffichee>[] =
  [...COLONNES_LIGNES_RECEPTION, COLONNE_ACTION_LIGNE_RECEPTION]

/**
 * Supplier receipt detail: editing a draft's lines (item, quantity,
 * cost, lot/expiry), then validation which brings stock in, or deletion
 * of the draft.
 */
function ReceptionDetailPage() {
  const { purchaseId } = Route.useParams()
  const acces = useAccesStock()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isError, refetch } = useQuery({
    queryKey: ["purchase", purchaseId],
    queryFn: () =>
      apiFetch<{ purchase: Reception }>(`/api/v1/purchases/${purchaseId}`),
  })

  const invalider = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["purchase", purchaseId] }),
      queryClient.invalidateQueries({ queryKey: ["purchases"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-levels"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] }),
    ])

  // Recherche de variante pour l'ajout de ligne
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
        libelle: `${p.name} — ${v.name} (${v.sku})`,
        trackLots: p.trackLots,
      }))
  )

  // Dialogue de ligne (création si ligneEditee === null, édition sinon)
  const [dialogLigne, setDialogLigne] = useState(false)
  const [ligneEditee, setLigneEditee] = useState<LigneReception | null>(null)
  const [variantId, setVariantId] = useState("")
  const [quantite, setQuantite] = useState("")
  const [cout, setCout] = useState("")
  const [numeroLot, setNumeroLot] = useState("")
  const [peremption, setPeremption] = useState("")
  const [erreurLigne, setErreurLigne] = useState<string | null>(null)

  const varianteChoisie = variantes.find((v) => v.variantId === variantId)
  const suitLots = ligneEditee
    ? ligneEditee.trackLots
    : (varianteChoisie?.trackLots ?? false)

  function ouvrirCreation() {
    setLigneEditee(null)
    setVariantId("")
    setQuantite("")
    setCout("")
    setNumeroLot("")
    setPeremption("")
    setErreurLigne(null)
    setDialogLigne(true)
  }

  function ouvrirEdition(ligne: LigneReception) {
    setLigneEditee(ligne)
    setVariantId(ligne.variantId)
    setQuantite(String(ligne.quantity))
    setCout(String(ligne.unitCost))
    setNumeroLot(ligne.lotNumber ?? "")
    setPeremption(ligne.expiryDate ? ligne.expiryDate.slice(0, 10) : "")
    setErreurLigne(null)
    setDialogLigne(true)
  }

  const enregistrerLigne = useMutation({
    mutationFn: () => {
      if (ligneEditee) {
        return apiFetch(
          `/api/v1/purchases/${purchaseId}/items/${ligneEditee.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              quantity: Number(quantite),
              unitCost: Number(cout),
              ...(ligneEditee.trackLots
                ? {
                    lotNumber: numeroLot || null,
                    expiryDate: peremption || null,
                  }
                : {}),
            }),
          }
        )
      }
      return apiFetch(`/api/v1/purchases/${purchaseId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          variantId,
          quantity: Number(quantite),
          unitCost: Number(cout),
          lotNumber: suitLots && numeroLot ? numeroLot : undefined,
          expiryDate: suitLots && peremption ? peremption : undefined,
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

  const [erreurSuppressionLigne, setErreurSuppressionLigne] = useState<
    string | null
  >(null)
  const supprimerLigne = useMutation({
    mutationFn: (itemId: string) =>
      apiFetch(`/api/v1/purchases/${purchaseId}/items/${itemId}`, {
        method: "DELETE",
      }),
    onSuccess: invalider,
    onError: (err) =>
      setErreurSuppressionLigne(err instanceof Error ? err.message : "Erreur"),
  })

  const [erreurValidation, setErreurValidation] = useState<string | null>(null)
  const valider = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/purchases/${purchaseId}/receive`, { method: "POST" }),
    onSuccess: invalider,
    onError: (err) =>
      setErreurValidation(err instanceof Error ? err.message : "Erreur"),
  })

  const [erreurSuppression, setErreurSuppression] = useState<string | null>(
    null
  )
  const supprimerBrouillon = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/purchases/${purchaseId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchases"] })
      void navigate({ to: "/stock/receptions" })
    },
    onError: (err) =>
      setErreurSuppression(err instanceof Error ? err.message : "Erreur"),
  })

  if (isError) {
    return (
      <ErreurChargement
        message="Impossible de charger la réception."
        onRetry={() => void refetch()}
      />
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  const reception = data.purchase
  const brouillon = reception.status === "draft"
  const peutEcrire =
    acces.ecritureTous ||
    acces.entrepotsEcriture.includes(reception.warehouseId)
  // Named once, right after its two operands: says what it AUTHORIZES (line
  // editing), not how it is computed. Every raw-predicate occurrence in the
  // file collapses to this one constant — see the plan's arbitrage D.
  const ligneModifiable = brouillon && peutEcrire
  const total = reception.items.reduce(
    (somme, item) => somme + item.quantity * item.unitCost,
    0
  )

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-xl font-semibold break-words">
          Réception — {reception.supplierName}
        </h1>
        <Badge variant={brouillon ? "warning" : "success"} className="shrink-0">
          {brouillon ? "Brouillon" : "Validée"}
        </Badge>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {reception.warehouseName}
        {reception.reference ? ` — réf. ${reception.reference}` : ""}
        {reception.receivedAt
          ? ` — validée le ${new Date(reception.receivedAt).toLocaleString("fr-FR")}`
          : ""}
      </p>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">
          Lignes — total {formaterMontant(total)}
        </h2>
        {ligneModifiable && (
          <Button variant="outline" size="sm" onClick={ouvrirCreation}>
            Ajouter une ligne
          </Button>
        )}
      </div>

      <ListeAdaptative<LigneReceptionAffichee>
        colonnes={
          ligneModifiable
            ? COLONNES_LIGNES_RECEPTION_ECRITURE
            : COLONNES_LIGNES_RECEPTION
        }
        lignes={reception.items.map((item) => ({
          ...item,
          surModifier: () => ouvrirEdition(item),
          surRetirer: () => {
            setErreurSuppressionLigne(null)
            supprimerLigne.mutate(item.id)
          },
        }))}
        cleLigne={(l) => l.id}
        titre={titreLigneReception}
        actionCarte={ligneModifiable ? actionsLigneReception : undefined}
        etatVide={
          <EtatVide
            icon={PackagePlus}
            titre="Aucune ligne"
            message={
              ligneModifiable
                ? "Ajoutez une ligne pour composer cette réception avant de la valider."
                : "Cette réception ne comporte aucune ligne."
            }
          />
        }
      />

      {erreurSuppressionLigne && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {erreurSuppressionLigne}
        </p>
      )}

      {ligneModifiable && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  disabled={valider.isPending || reception.items.length === 0}
                />
              }
            >
              {valider.isPending ? "Validation…" : "Valider la réception"}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Valider la réception ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Le stock sera mis à jour et le document deviendra immuable.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  variant="default"
                  onClick={() => {
                    setErreurValidation(null)
                    valider.mutate()
                  }}
                >
                  Valider la réception
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  disabled={supprimerBrouillon.isPending}
                />
              }
            >
              Supprimer le brouillon
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer ce brouillon ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Cette réception en brouillon sera définitivement supprimée.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setErreurSuppression(null)
                    supprimerBrouillon.mutate()
                  }}
                >
                  Supprimer le brouillon
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {erreurValidation && (
            <p role="alert" className="text-sm text-destructive">
              {erreurValidation}
            </p>
          )}
          {erreurSuppression && (
            <p role="alert" className="text-sm text-destructive">
              {erreurSuppression}
            </p>
          )}
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
                    <Label htmlFor="l-recherche">Rechercher un article</Label>
                    <Input
                      id="l-recherche"
                      placeholder="nom, SKU ou code-barres"
                      value={rechercheArticle}
                      onChange={(e) => setRechercheArticle(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="l-variante">Article</Label>
                    <Select
                      value={variantId}
                      onValueChange={(valeur) => setVariantId(valeur as string)}
                    >
                      <SelectTrigger id="l-variante" className="w-full">
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
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="l-quantite">Quantité</Label>
                  <Input
                    id="l-quantite"
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={quantite}
                    onChange={(e) => setQuantite(e.target.value)}
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="l-cout">Coût unitaire</Label>
                  <Input
                    id="l-cout"
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={cout}
                    onChange={(e) => setCout(e.target.value)}
                  />
                </div>
              </div>
              {suitLots && (
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="l-lot">Numéro de lot</Label>
                    <Input
                      id="l-lot"
                      required
                      value={numeroLot}
                      onChange={(e) => setNumeroLot(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="l-peremption">Péremption (optionnel)</Label>
                    <Input
                      id="l-peremption"
                      type="date"
                      value={peremption}
                      onChange={(e) => setPeremption(e.target.value)}
                    />
                  </div>
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
    </div>
  )
}
