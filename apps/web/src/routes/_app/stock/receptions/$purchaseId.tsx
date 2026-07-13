import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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
  const total = reception.items.reduce(
    (somme, item) => somme + item.quantity * item.unitCost,
    0
  )

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          Réception — {reception.supplierName}
        </h1>
        <Badge variant={brouillon ? "warning" : "success"}>
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
        {brouillon && peutEcrire && (
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
            <TableHead numeric>Coût unitaire</TableHead>
            <TableHead>Lot</TableHead>
            <TableHead>Péremption</TableHead>
            {brouillon && peutEcrire && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {reception.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <span className="font-medium">{item.productName}</span>{" "}
                <span className="text-sm text-muted-foreground">
                  {item.variantName} ({item.sku})
                </span>
              </TableCell>
              <TableCell numeric>{item.quantity}</TableCell>
              <TableCell numeric>{formaterMontant(item.unitCost)}</TableCell>
              <TableCell className="font-mono text-xs">
                {item.lotNumber ?? "—"}
              </TableCell>
              <TableCell className="text-sm">
                {item.expiryDate
                  ? new Date(item.expiryDate).toLocaleDateString("fr-FR")
                  : "—"}
              </TableCell>
              {brouillon && peutEcrire && (
                <TableCell>
                  <span className="flex gap-2">
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
                      onClick={() => {
                        setErreurSuppressionLigne(null)
                        supprimerLigne.mutate(item.id)
                      }}
                    >
                      Retirer
                    </Button>
                  </span>
                </TableCell>
              )}
            </TableRow>
          ))}
          {reception.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={brouillon && peutEcrire ? 6 : 5}>
                <EtatVide
                  icon={PackagePlus}
                  titre="Aucune ligne"
                  message={
                    brouillon && peutEcrire
                      ? "Ajoutez une ligne pour composer cette réception avant de la valider."
                      : "Cette réception ne comporte aucune ligne."
                  }
                />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {erreurSuppressionLigne && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {erreurSuppressionLigne}
        </p>
      )}

      {brouillon && peutEcrire && (
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
                        <SelectValue placeholder="— choisir —" />
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
