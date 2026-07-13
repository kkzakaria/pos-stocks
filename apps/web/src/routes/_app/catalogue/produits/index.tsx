import { useEffect, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, apiUrl } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import { usePeutEcrire } from "@/lib/permissions"
import { PackageSearch } from "lucide-react"
import { EtatVide } from "@/components/etat-vide"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
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
  DialogTrigger,
} from "@/components/ui/dialog"
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
 */
function ProduitsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const peutEcrire = usePeutEcrire()

  const [recherche, setRecherche] = useState("")
  const [rechercheDebouncee, setRechercheDebouncee] = useState("")
  const [categorie, setCategorie] = useState("")

  // Debounce 300 ms : la requête ne part qu'une fois la saisie stabilisée
  useEffect(() => {
    const timer = setTimeout(() => setRechercheDebouncee(recherche), 300)
    return () => clearTimeout(timer)
  }, [recherche])

  const produits = useQuery({
    queryKey: ["products", rechercheDebouncee, categorie],
    queryFn: () => {
      const params = new URLSearchParams()
      if (rechercheDebouncee) params.set("recherche", rechercheDebouncee)
      if (categorie) params.set("categorie", categorie)
      const qs = params.toString()
      return apiFetch<{ products: Produit[] }>(
        `/api/v1/products${qs ? `?${qs}` : ""}`
      )
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

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [nom, setNom] = useState("")
  const [prix, setPrix] = useState("")
  const [plancher, setPlancher] = useState("")
  const [seuilAlerte, setSeuilAlerte] = useState("")
  const [categorieProduit, setCategorieProduit] = useState("")
  const [codeBarres, setCodeBarres] = useState("")
  const [description, setDescription] = useState("")
  const [suiviLots, setSuiviLots] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const creer = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; sku: string }>("/api/v1/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: nom,
          price: Number(prix),
          minPrice: plancher ? Number(plancher) : undefined,
          defaultMinStock: seuilAlerte ? Number(seuilAlerte) : undefined,
          categoryId: categorieProduit || undefined,
          barcode: codeBarres || undefined,
          description: description || undefined,
          trackLots: suiviLots,
        }),
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["products"] })
      setDialogOuvert(false)
      void navigate({
        to: "/catalogue/produits/$productId",
        params: { productId: res.id },
      })
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const listeCategories = categories.data?.categories ?? []

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Produits</h1>
        {peutEcrire && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>Nouveau produit</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouveau produit</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  setErreur(null)
                  creer.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="p-nom">Nom</Label>
                  <Input
                    id="p-nom"
                    required
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                  />
                </div>
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="p-prix">Prix de vente</Label>
                    <Input
                      id="p-prix"
                      type="number"
                      min={1}
                      step={1}
                      required
                      value={prix}
                      onChange={(e) => setPrix(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="p-plancher">
                      Prix plancher (optionnel)
                    </Label>
                    <Input
                      id="p-plancher"
                      type="number"
                      min={1}
                      step={1}
                      value={plancher}
                      onChange={(e) => setPlancher(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="p-seuil-alerte">
                    Seuil d'alerte par défaut (optionnel)
                  </Label>
                  <Input
                    id="p-seuil-alerte"
                    type="number"
                    min={0}
                    step={1}
                    value={seuilAlerte}
                    onChange={(e) => setSeuilAlerte(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Alerte quand le stock d'un entrepôt passe sous ce seuil —
                    surchargeable par entrepôt.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="p-categorie">Catégorie</Label>
                  <Select
                    value={categorieProduit}
                    onValueChange={(valeur) =>
                      setCategorieProduit(valeur as string)
                    }
                  >
                    <SelectTrigger id="p-categorie" className="w-full">
                      <SelectValue placeholder="— aucune —">
                        {(valeur: string) =>
                          valeur === ""
                            ? "— aucune —"
                            : listeCategories.find((c) => c.id === valeur)?.name
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">— aucune —</SelectItem>
                      {listeCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="p-barcode">Code-barres (optionnel)</Label>
                  <Input
                    id="p-barcode"
                    value={codeBarres}
                    onChange={(e) => setCodeBarres(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="p-description">Description (optionnel)</Label>
                  <Textarea
                    id="p-description"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="p-suivi-lots"
                    checked={suiviLots}
                    onCheckedChange={(valeur) => setSuiviLots(valeur === true)}
                  />
                  <Label htmlFor="p-suivi-lots">
                    Suivre les lots (péremption)
                  </Label>
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-destructive">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer le produit"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-recherche">Recherche (nom, SKU, code-barres)</Label>
          <Input
            id="p-recherche"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className="w-72"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-filtre-categorie">Catégorie</Label>
          <Select
            value={categorie}
            onValueChange={(valeur) => setCategorie(valeur as string)}
          >
            <SelectTrigger id="p-filtre-categorie" className="w-56">
              <SelectValue placeholder="Toutes">
                {(valeur: string) =>
                  valeur === ""
                    ? "Toutes"
                    : listeCategories.find((c) => c.id === valeur)?.name
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Toutes</SelectItem>
              {listeCategories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Table>
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
                    recherche || categorie
                      ? "Aucun produit ne correspond à ces critères. Ajustez la recherche ou le filtre."
                      : "Créez votre premier produit pour démarrer le catalogue."
                  }
                  action={
                    peutEcrire && !recherche && !categorie ? (
                      <Button onClick={() => setDialogOuvert(true)}>
                        Nouveau produit
                      </Button>
                    ) : undefined
                  }
                />
              </TableCell>
            </TableRow>
          ) : (
            (produits.data?.products ?? []).map((p) => (
              <TableRow
                key={p.id}
                className="cursor-pointer"
                onClick={() =>
                  void navigate({
                    to: "/catalogue/produits/$productId",
                    params: { productId: p.id },
                  })
                }
              >
                <TableCell>
                  {p.imageKey ? (
                    <img
                      src={`${apiUrl(`/api/v1/files/${p.imageKey}`)}?v=${encodeURIComponent(p.updatedAt)}`}
                      alt={p.name}
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
                  <Badge variant="secondary">
                    {p.variants.filter((v) => v.isActive).length}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={p.isActive ? "success" : "secondary"}>
                    {p.isActive ? "Actif" : "Inactif"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
