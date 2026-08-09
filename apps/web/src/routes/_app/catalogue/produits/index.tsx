import { useEffect, useRef, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { apiFetch, apiUrl } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { usePeutEcrire } from "@/lib/permissions"
import { validerRechercheProduits } from "@/lib/recherche-produits"
import type { RechercheProduits } from "@/lib/recherche-produits"
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
import { ListeAdaptative } from "@/components/ui/liste-adaptative"
import type { ColonneAdaptative } from "@/components/ui/liste-adaptative"
import { FiltresRepliables } from "@/components/ui/filtres-repliables"

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

/** Normalizes the list's live filter state into a search object — undefined
 * (not empty string / page 1) so `Link`'s `search` and the URL it produces
 * stay minimal. Shared by every navigation that must carry the list's
 * filters back: row link, row click, and the "Nouveau produit" actions. */
function rechercheListe(
  q: string,
  categorie: string,
  page: number
): RechercheProduits {
  return {
    q: q || undefined,
    categorie: categorie || undefined,
    page: page > 1 ? page : undefined,
  }
}

/** Decorative only (`alt=""`): the underlying data (name, SKU) is already
 * carried by other columns, so a screen reader has nothing to lose. */
function vignetteProduit(p: Produit) {
  return p.imageKey ? (
    <img
      src={`${apiUrl(`/api/v1/files/${p.imageKey}`)}?v=${encodeURIComponent(p.updatedAt)}`}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      crossOrigin="use-credentials"
      className="h-10 w-10 shrink-0 rounded object-cover"
    />
  ) : (
    <div className="h-10 w-10 shrink-0 rounded bg-muted" />
  )
}

/** The one real link to the product sheet — used verbatim by the table's
 * "Nom" cell and by the card's title, so the two renderings can never drift
 * apart. */
function lienNomProduit(p: Produit, recherche: RechercheProduits) {
  return (
    <Link
      to="/catalogue/produits/$productId"
      params={{ productId: p.id }}
      search={recherche}
      className="min-w-0 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      {p.name}
    </Link>
  )
}

/** Card mode: thumbnail plus the real link to the product sheet — the same
 * contract table mode exposes via the "Nom" column, so a keyboard or
 * screen-reader user reaches the sheet identically in both tiers. */
export function titreProduit(p: Produit, recherche: RechercheProduits) {
  return (
    <span className="flex items-center gap-2">
      {vignetteProduit(p)}
      {lienNomProduit(p, recherche)}
    </span>
  )
}

/** Card mode: the SKU as the secondary line under the title. */
export function sousTitreProduit(p: Produit) {
  return p.sku
}

/** `devise` and `recherche` come from the live URL/query state, so this is a
 * factory rather than a static array — reusing `lienNomProduit` and
 * `sousTitreProduit` as `cellule` is what keeps the table and card
 * renderings from drifting apart (see `titreProduit`). */
export function COLONNES_PRODUITS(
  devise: string,
  recherche: RechercheProduits
): ColonneAdaptative<Produit>[] {
  return [
    {
      cle: "vignette",
      entete: "",
      // Purely decorative (alt=""); resurfaces via titreProduit.
      masquerEnCarte: true,
      cellule: vignetteProduit,
    },
    {
      cle: "nom",
      entete: "Nom",
      // Resurfaces via titreProduit, which renders this same link.
      masquerEnCarte: true,
      classeCellule: "font-medium",
      cellule: (p) => lienNomProduit(p, recherche),
    },
    {
      cle: "sku",
      entete: "SKU",
      // Resurfaces via sousTitreProduit.
      masquerEnCarte: true,
      classeCellule: "font-mono text-xs",
      cellule: sousTitreProduit,
    },
    {
      cle: "prix",
      entete: "Prix",
      numeric: true,
      cellule: (p) => formaterMontant(p.price, devise),
    },
    {
      cle: "variantes",
      entete: "Variantes",
      numeric: true,
      cellule: (p) => {
        const actives = p.variants.filter((v) => v.isActive).length
        return actives > 0 ? (
          actives
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      },
    },
    {
      cle: "statut",
      entete: "Statut",
      cellule: (p) => (
        <Badge variant={p.isActive ? "success" : "secondary"}>
          {p.isActive ? "Actif" : "Inactif"}
        </Badge>
      ),
    },
  ]
}

/**
 * Catalog products list: search (name, SKU, barcode), filter by
 * category, and creation of a product leading to its detail page.
 * Full-height column layout: heading, filters and pagination stay
 * fixed while the list body scrolls under it (sticky table header from
 * the `md` tier, cards below).
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

  const rechercheListeActuelle = rechercheListe(q, categorie, page)
  const liste = produits.data?.products ?? []

  // Only filters actually set by the user: the search and category filters
  // live in the URL, so at mount they may already hold values restored from
  // a shared link or a back navigation — counting non-empty values (rather
  // than freezing a neutral default, as `ventes/index.tsx` does for its
  // locally-stated period) keeps a filtered, reloaded list from showing zero
  // active filters.
  const nbFiltresActifs = (q !== "" ? 1 : 0) + (categorie !== "" ? 1 : 0)

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Produits</h1>
        {peutEcrire && (
          <Button
            onClick={() =>
              void navigate({
                to: "/catalogue/produits/nouveau",
                search: rechercheListeActuelle,
              })
            }
          >
            Nouveau produit
          </Button>
        )}
      </div>

      <FiltresRepliables nbActifs={nbFiltresActifs}>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex w-full flex-col gap-1.5 sm:w-72">
            <Label htmlFor="p-recherche">Recherche</Label>
            <InputRecherche
              id="p-recherche"
              name="recherche"
              ref={refRecherche}
              placeholder="Nom, SKU ou code-barres…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              className="w-full sm:w-72"
            />
          </div>
          <div className="flex w-full flex-col gap-1.5 sm:w-56">
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
                className="w-full sm:w-56"
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
      </FiltresRepliables>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <ListeAdaptative<Produit>
          colonnes={COLONNES_PRODUITS(devise, rechercheListeActuelle)}
          lignes={liste}
          cleLigne={(p) => p.id}
          titre={(p) => titreProduit(p, rechercheListeActuelle)}
          sousTitre={sousTitreProduit}
          chargement={produits.isPending}
          containerClassName="min-h-0 flex-1 overflow-y-auto"
          surClicLigne={(p) =>
            void navigate({
              to: "/catalogue/produits/$productId",
              params: { productId: p.id },
              search: rechercheListeActuelle,
            })
          }
          etatVide={
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
                        search: rechercheListeActuelle,
                      })
                    }
                  >
                    Nouveau produit
                  </Button>
                ) : undefined
              }
            />
          }
        />

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
    </div>
  )
}
