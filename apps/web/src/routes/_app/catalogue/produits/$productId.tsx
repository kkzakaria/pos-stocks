import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { usePeutEcrire, useAccesStock } from "@/lib/permissions"
import { validerRechercheProduits } from "@/lib/recherche-produits"
import type { RechercheProduits } from "@/lib/recherche-produits"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionSynthese } from "@/components/produit/section-synthese"
import { SectionIdentite } from "@/components/produit/section-identite"
import { SectionStock } from "@/components/produit/section-stock"
import { SectionVariantes } from "@/components/produit/section-variantes"
import type { LigneStockProduit, Produit } from "@/components/produit/types"

export const Route = createFileRoute("/_app/catalogue/produits/$productId")({
  // Carries the list's filters so the back link can restore them.
  validateSearch: validerRechercheProduits,
  component: FicheProduitPage,
})

function FicheProduitPage() {
  const { productId } = Route.useParams()
  const rechercheListe = Route.useSearch()
  return <FicheProduit productId={productId} rechercheListe={rechercheListe} />
}

/**
 * Product sheet, read-first: header with back link, summary band of
 * figures, identity column (1/3) and living data column (2/3): stock per
 * warehouse then variants with their nested lots. Sections edit in place.
 */
export function FicheProduit({
  productId,
  rechercheListe = {},
}: {
  productId: string
  rechercheListe?: RechercheProduits
}) {
  const peutEcrire = usePeutEcrire()
  const accesStock = useAccesStock()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ["product", productId],
    queryFn: () =>
      apiFetch<{ product: Produit }>(`/api/v1/products/${productId}`),
  })
  const stock = useQuery({
    queryKey: ["product-stock", productId],
    queryFn: () =>
      apiFetch<{ stock: LigneStockProduit[] }>(
        `/api/v1/products/${productId}/stock`
      ),
  })
  const organisation = useQuery({
    queryKey: ["organization"],
    queryFn: () => apiFetch<{ currency: string }>("/api/v1/organization"),
  })
  const devise = organisation.data?.currency ?? "XOF"

  const invalider = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["product", productId] }),
      queryClient.invalidateQueries({ queryKey: ["product-stock", productId] }),
    ])

  if (!data) {
    return (
      <div>
        <div className="mb-6 flex items-center gap-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="mb-6 h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  const produit = data.product
  const lignesStock = stock.data?.stock ?? []
  const plusieursVariantes =
    produit.variants.filter((v) => v.isActive).length > 1
  // Stock total shown only for a user with stock-reading scope: a scoped
  // user with no rows still sees 0, a user without scope sees the figure
  // omitted entirely.
  const stockTotal = accesStock.lecture
    ? lignesStock.reduce((somme, l) => somme + l.quantity, 0)
    : null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          to="/catalogue/produits"
          search={rechercheListe}
          className="mb-2 inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&>svg]:size-3.5"
        >
          <ArrowLeft />
          Produits
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{produit.name}</h1>
          <span className="font-mono text-xs text-muted-foreground">
            {produit.sku}
          </span>
          <Badge variant={produit.isActive ? "success" : "secondary"}>
            {produit.isActive ? "Actif" : "Inactif"}
          </Badge>
        </div>
      </div>

      <SectionSynthese
        key={`synthese-${produit.id}`}
        produit={produit}
        productId={productId}
        peutEcrire={peutEcrire}
        devise={devise}
        stockTotal={stockTotal}
        onModifie={invalider}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <SectionIdentite
          key={`identite-${produit.id}`}
          produit={produit}
          productId={productId}
          peutEcrire={peutEcrire}
          onModifie={invalider}
        />
        <div className="flex flex-col gap-8 lg:col-span-2">
          <SectionStock
            lignes={lignesStock}
            enChargement={stock.isPending}
            devise={devise}
            plusieursVariantes={plusieursVariantes}
          />
          <SectionVariantes
            produit={produit}
            productId={productId}
            peutEcrire={peutEcrire}
            devise={devise}
            onModifie={invalider}
          />
        </div>
      </div>
    </div>
  )
}
