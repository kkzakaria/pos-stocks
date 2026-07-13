import { useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Store } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/components/ui/toast"
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
import { EtatVide } from "@/components/etat-vide"

export const Route = createFileRoute("/_app/administration/entrepots")({
  beforeLoad: ({ context }) => {
    const role = context.me.membership?.role
    if (role !== "owner" && role !== "admin" && role !== "auditor") {
      throw redirect({ to: "/" })
    }
  },
  component: EntrepotsPage,
})

type Warehouse = {
  id: string
  name: string
  type: "warehouse" | "store"
  address: string | null
  isActive: boolean
}

const TYPES = { warehouse: "Entrepôt", store: "Boutique" } as const

const OPTIONS_TYPE = [
  { value: "store", label: "Boutique (avec point de vente)" },
  { value: "warehouse", label: "Entrepôt (réserve)" },
] as const satisfies ReadonlyArray<{
  value: "warehouse" | "store"
  label: string
}>

function EntrepotsPage() {
  const { me } = Route.useRouteContext()
  const peutEcrire =
    me.membership?.role === "owner" || me.membership?.role === "admin"
  const queryClient = useQueryClient()
  const [dialogOuvert, setDialogOuvert] = useState(false)
  const [nom, setNom] = useState("")
  const [type, setType] = useState<"warehouse" | "store">("store")
  const [adresse, setAdresse] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => apiFetch<{ warehouses: Warehouse[] }>("/api/v1/warehouses"),
  })

  const creer = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/warehouses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: nom,
          type,
          address: adresse || undefined,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["warehouses"] })
      setDialogOuvert(false)
      setNom("")
      setAdresse("")
      setErreur(null)
      toast.success("Entrepôt créé")
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const basculer = useMutation({
    mutationFn: (w: Warehouse) =>
      apiFetch(`/api/v1/warehouses/${w.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !w.isActive }),
      }),
    onSuccess: async (_res, w) => {
      await queryClient.invalidateQueries({ queryKey: ["warehouses"] })
      toast.success(w.isActive ? "Entrepôt désactivé" : "Entrepôt réactivé")
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Entrepôts &amp; boutiques</h1>
        {peutEcrire && (
          <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
            <DialogTrigger render={<Button />}>Nouvel entrepôt</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvel entrepôt ou boutique</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  creer.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-nom">Nom</Label>
                  <Input
                    id="wh-nom"
                    required
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-type">Type</Label>
                  <Select
                    value={type}
                    onValueChange={(valeur) =>
                      setType(valeur as "warehouse" | "store")
                    }
                  >
                    <SelectTrigger id="wh-type" className="w-full">
                      <SelectValue>
                        {(valeur: "warehouse" | "store") =>
                          OPTIONS_TYPE.find((o) => o.value === valeur)?.label
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {OPTIONS_TYPE.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wh-adresse">Adresse (optionnel)</Label>
                  <Input
                    id="wh-adresse"
                    value={adresse}
                    onChange={(e) => setAdresse(e.target.value)}
                  />
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-destructive">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nom</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Adresse</TableHead>
            <TableHead>Statut</TableHead>
            {peutEcrire && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <TableSkeleton colonnes={peutEcrire ? 5 : 4} />
          ) : (data?.warehouses ?? []).length === 0 ? (
            <TableRow>
              <TableCell colSpan={peutEcrire ? 5 : 4}>
                <EtatVide
                  icon={Store}
                  titre="Aucun entrepôt"
                  message="Créez une première boutique ou réserve pour démarrer le suivi de stock."
                  action={
                    peutEcrire ? (
                      <Button onClick={() => setDialogOuvert(true)}>
                        Nouvel entrepôt
                      </Button>
                    ) : undefined
                  }
                />
              </TableCell>
            </TableRow>
          ) : (
            (data?.warehouses ?? []).map((w) => (
              <TableRow key={w.id}>
                <TableCell className="font-medium">{w.name}</TableCell>
                <TableCell>{TYPES[w.type]}</TableCell>
                <TableCell>{w.address ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={w.isActive ? "success" : "secondary"}>
                    {w.isActive ? "Actif" : "Inactif"}
                  </Badge>
                </TableCell>
                {peutEcrire && (
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => basculer.mutate(w)}
                    >
                      {w.isActive ? "Désactiver" : "Réactiver"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
