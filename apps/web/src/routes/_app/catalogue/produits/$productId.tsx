import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { usePeutEcrire } from "@/lib/permissions"
import { Badge } from "@/components/ui/badge"
import { SectionImage } from "@/components/produit/section-image"
import { SectionInfos } from "@/components/produit/section-infos"
import { SectionVariantes } from "@/components/produit/section-variantes"
import { SectionLots } from "@/components/produit/section-lots"
import type { Produit } from "@/components/produit/types"

export const Route = createFileRoute("/_app/catalogue/produits/$productId")({
  component: FicheProduitPage,
})

function FicheProduitPage() {
  const { productId } = Route.useParams()
  const peutEcrire = usePeutEcrire()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ["product", productId],
    queryFn: () =>
      apiFetch<{ product: Produit }>(`/api/v1/products/${productId}`),
  })
  const organisation = useQuery({
    queryKey: ["organization"],
    queryFn: () => apiFetch<{ currency: string }>("/api/v1/organization"),
  })
  const devise = organisation.data?.currency ?? "XOF"

  const invalider = () =>
    queryClient.invalidateQueries({ queryKey: ["product", productId] })

  if (!data) {
    return <p className="text-sm text-gray-500">Chargement…</p>
  }
  const produit = data.product

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-semibold">{produit.name}</h1>
        <span className="font-mono text-xs text-gray-500">{produit.sku}</span>
        <Badge variant={produit.isActive ? "default" : "secondary"}>
          {produit.isActive ? "Actif" : "Inactif"}
        </Badge>
      </div>
      <SectionImage
        produit={produit}
        productId={productId}
        peutEcrire={peutEcrire}
        onModifie={invalider}
      />
      <SectionInfos
        key={produit.id}
        produit={produit}
        productId={productId}
        peutEcrire={peutEcrire}
        onModifie={invalider}
      />
      <SectionVariantes
        produit={produit}
        productId={productId}
        peutEcrire={peutEcrire}
        devise={devise}
        onModifie={invalider}
      />
      {produit.trackLots && (
        <SectionLots
          produit={produit}
          peutEcrire={peutEcrire}
          onModifie={invalider}
        />
      )}
    </div>
  )
}
