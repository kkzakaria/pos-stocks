import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          Transfert — {transfert.fromWarehouseName} →{" "}
          {transfert.toWarehouseName}
        </h1>
        <Badge variant={varianteBadgeStatut(transfert.status)}>
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
        {brouillon && peutEcrireOrigine && (
          <Button variant="outline" size="sm" onClick={ouvrirCreation}>
            Ajouter une ligne
          </Button>
        )}
      </div>

      <Table>
        <TableHeader sticky>
          <TableRow>
            <TableHead>Article</TableHead>
            <TableHead numeric>Quantité</TableHead>
            <TableHead>Lot</TableHead>
            <TableHead numeric>CMP figé</TableHead>
            <TableHead numeric>Reçu</TableHead>
            {brouillon && peutEcrireOrigine && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {transfert.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <span className="font-medium">{item.productName}</span>{" "}
                <span className="text-muted-foreground">
                  {item.variantName} ({item.sku})
                </span>
              </TableCell>
              <TableCell numeric>{item.quantity}</TableCell>
              <TableCell className="font-mono text-xs">
                {item.lotNumber ?? "—"}
              </TableCell>
              <TableCell numeric>
                {item.unitCost === null ? "—" : formaterMontant(item.unitCost)}
              </TableCell>
              <TableCell numeric>
                {item.receivedQuantity === null ? (
                  "—"
                ) : (
                  <span className="flex items-center justify-end gap-2">
                    {item.receivedQuantity < item.quantity && (
                      <Badge variant="destructive">
                        Écart −{item.quantity - item.receivedQuantity}
                      </Badge>
                    )}
                    <span className="tabular-nums">
                      {item.receivedQuantity}
                    </span>
                  </span>
                )}
              </TableCell>
              {brouillon && peutEcrireOrigine && (
                <TableCell>
                  <span className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => ouvrirEdition(item)}
                    >
                      Modifier
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => supprimerLigne.mutate(item.id)}
                    >
                      Retirer
                    </Button>
                  </span>
                </TableCell>
              )}
            </TableRow>
          ))}
          {transfert.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={brouillon && peutEcrireOrigine ? 6 : 5}>
                <EtatVide
                  icon={PackageSearch}
                  titre="Aucune ligne"
                  message={
                    brouillon && peutEcrireOrigine
                      ? "Ajoutez des articles à transférer avant d'expédier."
                      : "Ce transfert ne comporte aucune ligne."
                  }
                />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {erreurSuppression && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {erreurSuppression}
        </p>
      )}

      {brouillon && peutEcrireOrigine && (
        <div className="mt-6 flex items-center gap-3">
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
                        <SelectValue placeholder="— choisir —">
                          {(valeur: string) =>
                            variantes.find((v) => v.variantId === valeur)
                              ?.libelle
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
                      <SelectValue placeholder="— à choisir avant expédition —">
                        {(valeur: string) =>
                          lotsDisponibles.find((l) => l.id === valeur)
                            ?.lotNumber
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
                  <span className="flex-1 text-sm">
                    {item.productName} — {item.variantName} (expédié :{" "}
                    {item.quantity})
                  </span>
                  <Input
                    aria-label={`Quantité reçue — ${item.sku}`}
                    type="number"
                    min={0}
                    max={item.quantity}
                    step={1}
                    className="w-24"
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
