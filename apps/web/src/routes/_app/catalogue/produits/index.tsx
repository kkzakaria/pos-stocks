import { useEffect, useRef, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { apiFetch, apiUrl } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { usePeutEcrire } from "@/lib/permissions"
import { validerRechercheProduits } from "@/lib/recherche-produits"
import { PackageSearch } from "lucide-react"
import { EtatVide } from "@/components/etat-vide"
import { Pagination } from "@/components/ui/pagination"
import { Button } from "@/components/ui/button"
import { InputRecherche } from "@/components/ui/input-recherche"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"

export const Route = createFileRoute("/_app/catalogue/produits/")({
  // Filters and page live in the URL: shareable, refresh- and back-safe.
  validateSearch: validerRechercheProduits,
  component: ProduitsPage,
})

type Variante = { id: string; isActive: boolean }
type Produit = {
  id: string
  name: string
  sku: string
  price: number
  imageKey: string | null
  isActive: boolean
  updatedAt: string
  variants: Variante[]
}
type Categorie = { id: string; name: string }
type Reglages = { currency: string }

/**
 * Catalog products list: search (name, SKU, barcode), filter by
 * category, and creation of a product leading to its detail page.
 * Full-height column layout: heading, filters and pagination stay
 * fixed while the table body scrolls under its sticky header.
 */
function ProduitsPage() {
  const navigate = useNavigate()
  const navigateFiltres = Route.useNavigate()
  const peutEcrire = usePeutEcrire()

  const { q = "", categorie = "", page = 1 } = Route.useSearch()
  const [recherche, setRecherche] = useState(q)
  const refRecherche = useRef<HTMLInputElement>(null)

  // 300 ms debounce: the URL (source of truth for the query) is only
  // updated once typing has settled; changing a filter resets to page 1.
  // The equality guard keeps mount and back/forward realignment from
  // stripping ?page out of a shared or reloaded URL.
  useEffect(() => {
    if (recherche === q) return
    const timer = setTimeout(() => {
      void navigateFiltres({
        search: (prec) => ({
          ...prec,
          q: recherche || undefined,
          page: undefined,
        }),
        replace: true,
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [recherche, q, navigateFiltres])

  // Back/forward: realign the field with the URL, without clobbering typing
  useEffect(() => {
    if (document.activeElement !== refRecherche.current) setRecherche(q)
  }, [q])

  const produits = useQuery({
    queryKey: ["products", q, categorie, page],
    queryFn: () => {
      const params = new URLSearchParams()
      if (q) params.set("recherche", q)
      if (categorie) params.set("categorie", categorie)
      params.set("page", String(page))
      return apiFetch<{
        products: Produit[]
        total: number
        page: number
        limite: number
      }>(`/api/v1/products?${params.toString()}`)
    },
  })
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })
  const organisation = useQuery({
    queryKey: ["organization"],
    queryFn: () => apiFetch<Reglages>("/api/v1/organization"),
  })
  const devise = organisation.data?.currency ?? "XOF"

  const listeCategories = categories.data?.categories ?? []
  const idsCategories = listeCategories.map((c) => c.id)
  const nomCategorie = (id: string) =>
    listeCategories.find((c) => c.id === id)?.name ?? id

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Produits</h1>
        {peutEcrire && (
          <Button
            onClick={() =>
              void navigate({
                to: "/catalogue/produits/nouveau",
                search: {
                  q: q || undefined,
                  categorie: categorie || undefined,
                  page: page > 1 ? page : undefined,
                },
              })
            }
          >
            Nouveau produit
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-recherche">Recherche</Label>
          <InputRecherche
            id="p-recherche"
            name="recherche"
            ref={refRecherche}
            placeholder="Nom, SKU ou code-barres…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className="w-72"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-filtre-categorie">Catégorie</Label>
          <Combobox
            items={idsCategories}
            itemToStringLabel={nomCategorie}
            autoHighlight
            value={categorie || null}
            onValueChange={(valeur) =>
              // Push (not replace): each filter step stays in history
              void navigateFiltres({
                search: (prec) => ({
                  ...prec,
                  categorie: valeur ?? undefined,
                  page: undefined,
                }),
              })
            }
          >
            <ComboboxInput
              id="p-filtre-categorie"
              placeholder="Toutes"
              showClear
              className="w-56"
            />
            <ComboboxContent>
              <ComboboxEmpty>Aucune catégorie trouvée</ComboboxEmpty>
              <ComboboxList>
                {(id: string) => (
                  <ComboboxItem key={id} value={id}>
                    {nomCategorie(id)}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      </div>

      <Table containerClassName="min-h-0 flex-1 overflow-y-auto">
        <TableHeader sticky>
          <TableRow>
            <TableHead />
            <TableHead>Nom</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead numeric>Prix</TableHead>
            <TableHead numeric>Variantes</TableHead>
            <TableHead>Statut</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {produits.isPending ? (
            <TableSkeleton colonnes={6} />
          ) : (produits.data?.products ?? []).length === 0 ? (
            <TableRow>
              <TableCell colSpan={6}>
                <EtatVide
                  icon={PackageSearch}
                  titre="Aucun produit trouvé"
                  message={
                    q || categorie
                      ? "Aucun produit ne correspond à ces critères. Ajustez la recherche ou le filtre."
                      : "Créez votre premier produit pour démarrer le catalogue."
                  }
                  action={
                    peutEcrire && !q && !categorie ? (
                      <Button
                        onClick={() =>
                          void navigate({
                            to: "/catalogue/produits/nouveau",
                            search: {
                              q: q || undefined,
                              categorie: categorie || undefined,
                              page: page > 1 ? page : undefined,
                            },
                          })
                        }
                      >
                        Nouveau produit
                      </Button>
                    ) : undefined
                  }
                />
              </TableCell>
            </TableRow>
          ) : (
            (produits.data?.products ?? []).map((p) => {
              const variantesActives = p.variants.filter(
                (v) => v.isActive
              ).length
              return (
                <TableRow
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() =>
                    void navigate({
                      to: "/catalogue/produits/$productId",
                      params: { productId: p.id },
                      search: {
                        q: q || undefined,
                        categorie: categorie || undefined,
                        page: page > 1 ? page : undefined,
                      },
                    })
                  }
                >
                  <TableCell>
                    {p.imageKey ? (
                      <img
                        src={`${apiUrl(`/api/v1/files/${p.imageKey}`)}?v=${encodeURIComponent(p.updatedAt)}`}
                        alt=""
                        width={40}
                        height={40}
                        loading="lazy"
                        crossOrigin="use-credentials"
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted" />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      to="/catalogue/produits/$productId"
                      params={{ productId: p.id }}
                      search={{
                        q: q || undefined,
                        categorie: categorie || undefined,
                        page: page > 1 ? page : undefined,
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
                    >
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                  <TableCell numeric>
                    {formaterMontant(p.price, devise)}
                  </TableCell>
                  <TableCell numeric>
                    {variantesActives > 0 ? (
                      variantesActives
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.isActive ? "success" : "secondary"}>
                      {p.isActive ? "Actif" : "Inactif"}
                    </Badge>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>

      {(produits.data?.total ?? 0) > 0 && (
        <Pagination
          className="mt-3"
          page={page}
          total={produits.data?.total ?? 0}
          pageSize={produits.data?.limite ?? 50}
          onPageChange={(p) =>
            // Push (not replace): Back returns to the previous page of results
            void navigateFiltres({
              search: (prec) => ({ ...prec, page: p > 1 ? p : undefined }),
            })
          }
          element={{ un: "produit", plusieurs: "produits" }}
        />
      )}
    </div>
  )
}
