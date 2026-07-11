import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { usePeutEcrire } from "@/lib/permissions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const Route = createFileRoute("/_app/catalogue/categories")({
  component: CategoriesPage,
})

type Categorie = { id: string; name: string; parentId: string | null }

function CategoriesPage() {
  const peutEcrire = usePeutEcrire()
  const queryClient = useQueryClient()

  const { data, isPending } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: Categorie[] }>("/api/v1/categories"),
  })
  const parents = new Map(
    (data?.categories ?? []).map((cat) => [cat.id, cat.name])
  )

  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [enEdition, setEnEdition] = useState<Categorie | null>(null)
  const [nom, setNom] = useState("")
  const [parentId, setParentId] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  function ouvrirCreation() {
    setEnEdition(null)
    setNom("")
    setParentId("")
    setErreur(null)
    setDialogOuvert(true)
  }

  function ouvrirEdition(cat: Categorie) {
    setEnEdition(cat)
    setNom(cat.name)
    setParentId(cat.parentId ?? "")
    setErreur(null)
    setDialogOuvert(true)
  }

  const enregistrer = useMutation({
    mutationFn: () =>
      enEdition
        ? apiFetch(`/api/v1/categories/${enEdition.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: nom, parentId: parentId || null }),
          })
        : apiFetch("/api/v1/categories", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: nom,
              parentId: parentId || undefined,
            }),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["categories"] })
      setDialogOuvert(false)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Catégories</h1>
        {peutEcrire && (
          <Button onClick={ouvrirCreation}>Nouvelle catégorie</Button>
        )}
      </div>

      <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {enEdition ? "Modifier la catégorie" : "Nouvelle catégorie"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setErreur(null)
              enregistrer.mutate()
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-nom">Nom</Label>
              <Input
                id="c-nom"
                required
                value={nom}
                onChange={(e) => setNom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-parent">Catégorie parente (optionnel)</Label>
              <select
                id="c-parent"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="h-10 rounded-md border px-2 text-sm"
              >
                <option value="">— aucune —</option>
                {(data?.categories ?? [])
                  .filter((cat) => cat.id !== enEdition?.id)
                  .map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
              </select>
            </div>
            {erreur && (
              <p role="alert" className="text-sm text-red-700">
                {erreur}
              </p>
            )}
            <Button type="submit" disabled={enregistrer.isPending}>
              {enregistrer.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {isPending ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Catégorie</TableHead>
              {peutEcrire && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.categories ?? []).map((cat) => (
              <TableRow key={cat.id}>
                <TableCell className="font-medium">
                  {cat.parentId
                    ? `${parents.get(cat.parentId) ?? "?"} > ${cat.name}`
                    : cat.name}
                </TableCell>
                {peutEcrire && (
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => ouvrirEdition(cat)}
                    >
                      Modifier
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {data?.categories.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={peutEcrire ? 2 : 1}
                  className="text-center text-sm text-gray-500"
                >
                  Aucune catégorie.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
