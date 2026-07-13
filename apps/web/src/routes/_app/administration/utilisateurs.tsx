import { useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CompanyRole, WarehouseRole } from "shared"
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
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { ProvisionalPasswordDialog } from "@/components/provisional-password-dialog"

export const Route = createFileRoute("/_app/administration/utilisateurs")({
  beforeLoad: ({ context }) => {
    const role = context.me.membership?.role
    if (role !== "owner" && role !== "admin" && role !== "auditor") {
      throw redirect({ to: "/" })
    }
  },
  component: UtilisateursPage,
})

type Utilisateur = {
  id: string
  name: string
  email: string
  role: CompanyRole
  isActive: boolean
  assignments: Array<{
    id: string
    warehouseId: string
    warehouseName: string
    role: WarehouseRole
  }>
}

const ROLES_FR: Record<CompanyRole, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  auditor: "Auditeur",
  stock_manager: "Gestionnaire de stock",
  staff: "Employé",
}

const ROLES_ENTREPOT_FR: Record<WarehouseRole, string> = {
  manager: "Responsable",
  auditor: "Auditeur",
  cashier: "Caissier",
}

function UtilisateursPage() {
  const { me } = Route.useRouteContext()
  const peutEcrire =
    me.membership?.role === "owner" || me.membership?.role === "admin"
  const queryClient = useQueryClient()

  // Rôles attribuables à la création (admin réservé au propriétaire).
  const optionsRole: Array<{ value: CompanyRole; label: string }> = [
    { value: "staff", label: "Employé (caissier)" },
    { value: "stock_manager", label: "Gestionnaire de stock" },
    { value: "auditor", label: "Auditeur" },
    ...(me.membership?.role === "owner"
      ? [{ value: "admin" as CompanyRole, label: "Administrateur" }]
      : []),
  ]

  const [dialogCreation, setDialogCreation] = useState(false)
  const [nom, setNom] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<CompanyRole>("staff")
  const [erreur, setErreur] = useState<string | null>(null)
  const [provisoire, setProvisoire] = useState<{
    password: string
    email: string
  } | null>(null)
  const [affectation, setAffectation] = useState<{
    userId: string
    warehouseId: string
    role: WarehouseRole
  }>({
    userId: "",
    warehouseId: "",
    role: "cashier",
  })

  const utilisateurs = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<{ users: Utilisateur[] }>("/api/v1/users"),
  })
  const entrepots = useQuery({
    queryKey: ["warehouses"],
    queryFn: () =>
      apiFetch<{ warehouses: Array<{ id: string; name: string }> }>(
        "/api/v1/warehouses"
      ),
  })

  const invalider = () => queryClient.invalidateQueries({ queryKey: ["users"] })

  const creer = useMutation({
    mutationFn: () =>
      apiFetch<{ provisionalPassword: string }>("/api/v1/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nom, email, role }),
      }),
    onSuccess: async (res) => {
      await invalider()
      setDialogCreation(false)
      setProvisoire({ password: res.provisionalPassword, email })
      setNom("")
      setEmail("")
      setRole("staff")
      setErreur(null)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const changerRole = useMutation({
    mutationFn: (v: { userId: string; role: CompanyRole }) =>
      apiFetch(`/api/v1/users/${v.userId}/role`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: v.role }),
      }),
    onSuccess: async () => {
      await invalider()
      toast.success("Rôle mis à jour")
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  const changerStatut = useMutation({
    mutationFn: (u: Utilisateur) =>
      apiFetch(`/api/v1/users/${u.id}/statut`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !u.isActive }),
      }),
    onSuccess: async (_res, u) => {
      await invalider()
      toast.success(u.isActive ? "Compte désactivé" : "Compte réactivé")
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  const affecter = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/warehouse-members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(affectation),
      }),
    onSuccess: async () => {
      await invalider()
      setAffectation({ userId: "", warehouseId: "", role: "cashier" })
      toast.success("Affectation ajoutée")
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  const retirerAffectation = useMutation({
    mutationFn: (assignmentId: string) =>
      apiFetch(`/api/v1/warehouse-members/${assignmentId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await invalider()
      toast.success("Affectation retirée")
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Utilisateurs</h1>
        {peutEcrire && (
          <Dialog open={dialogCreation} onOpenChange={setDialogCreation}>
            <DialogTrigger render={<Button />}>
              Nouvel utilisateur
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Créer un compte employé</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  creer.mutate()
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="u-nom">Nom</Label>
                  <Input
                    id="u-nom"
                    required
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="u-email">Email</Label>
                  <Input
                    id="u-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="u-role">Rôle</Label>
                  <Select
                    value={role}
                    onValueChange={(valeur) => setRole(valeur as CompanyRole)}
                  >
                    <SelectTrigger id="u-role" className="w-full">
                      <SelectValue>
                        {(valeur: CompanyRole) =>
                          optionsRole.find((o) => o.value === valeur)?.label
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {optionsRole.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {erreur && (
                  <p role="alert" className="text-sm text-destructive">
                    {erreur}
                  </p>
                )}
                <Button type="submit" disabled={creer.isPending}>
                  {creer.isPending ? "Création…" : "Créer le compte"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {provisoire && (
        <ProvisionalPasswordDialog
          password={provisoire.password}
          email={provisoire.email}
          onClose={() => setProvisoire(null)}
        />
      )}

      <Table>
        <TableHeader sticky>
          <TableRow>
            <TableHead>Nom</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Rôle</TableHead>
            <TableHead>Affectations</TableHead>
            <TableHead>Statut</TableHead>
            {peutEcrire && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {utilisateurs.isPending ? (
            <TableSkeleton colonnes={peutEcrire ? 6 : 5} />
          ) : (
            (utilisateurs.data?.users ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  {peutEcrire && u.id !== me.user.id ? (
                    <Select
                      value={u.role}
                      onValueChange={(valeur) =>
                        changerRole.mutate({
                          userId: u.id,
                          role: valeur as CompanyRole,
                        })
                      }
                    >
                      <SelectTrigger size="sm" className="w-48">
                        <SelectValue>
                          {(valeur: CompanyRole) => ROLES_FR[valeur]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          Object.entries(ROLES_FR) as [CompanyRole, string][]
                        ).map(([valeur, libelle]) => (
                          <SelectItem key={valeur} value={valeur}>
                            {libelle}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    ROLES_FR[u.role]
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {u.assignments.length === 0 ? (
                    "—"
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {u.assignments.map((a) => (
                        <Badge key={a.id} variant="secondary">
                          {a.warehouseName} ({ROLES_ENTREPOT_FR[a.role]})
                          {peutEcrire && (
                            <AlertDialog>
                              <AlertDialogTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label={`Retirer l'affectation ${a.warehouseName}`}
                                    className="ml-1 font-semibold outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/30"
                                  />
                                }
                              >
                                ×
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Retirer l'affectation ?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Retirer « {a.warehouseName} » de {u.name} ?
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() =>
                                      retirerAffectation.mutate(a.id)
                                    }
                                  >
                                    Retirer
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </Badge>
                      ))}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={u.isActive ? "success" : "secondary"}>
                    {u.isActive ? "Actif" : "Désactivé"}
                  </Badge>
                </TableCell>
                {peutEcrire && (
                  <TableCell>
                    {u.id !== me.user.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => changerStatut.mutate(u)}
                      >
                        {u.isActive ? "Désactiver" : "Réactiver"}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {peutEcrire && (
        <div className="mt-8 max-w-2xl rounded-md border p-4">
          <h2 className="mb-3 text-base font-semibold">
            Affecter à un entrepôt
          </h2>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              affecter.mutate()
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-user">Utilisateur</Label>
              <Select
                value={affectation.userId}
                onValueChange={(valeur) =>
                  setAffectation({ ...affectation, userId: valeur as string })
                }
              >
                <SelectTrigger id="a-user" className="w-56">
                  <SelectValue placeholder="— choisir —">
                    {(valeur: string) =>
                      (utilisateurs.data?.users ?? []).find(
                        (u) => u.id === valeur
                      )?.name
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(utilisateurs.data?.users ?? [])
                    .filter((u) => u.isActive)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-wh">Entrepôt</Label>
              <Select
                value={affectation.warehouseId}
                onValueChange={(valeur) =>
                  setAffectation({
                    ...affectation,
                    warehouseId: valeur as string,
                  })
                }
              >
                <SelectTrigger id="a-wh" className="w-56">
                  <SelectValue placeholder="— choisir —">
                    {(valeur: string) =>
                      (entrepots.data?.warehouses ?? []).find(
                        (w) => w.id === valeur
                      )?.name
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(entrepots.data?.warehouses ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-role">Rôle</Label>
              <Select
                value={affectation.role}
                onValueChange={(valeur) =>
                  setAffectation({
                    ...affectation,
                    role: valeur as WarehouseRole,
                  })
                }
              >
                <SelectTrigger id="a-role" className="w-40">
                  <SelectValue>
                    {(valeur: WarehouseRole) => ROLES_ENTREPOT_FR[valeur]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cashier">Caissier</SelectItem>
                  <SelectItem value="manager">Responsable</SelectItem>
                  <SelectItem value="auditor">Auditeur</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              disabled={
                affecter.isPending ||
                !affectation.userId ||
                !affectation.warehouseId
              }
            >
              Affecter
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}
