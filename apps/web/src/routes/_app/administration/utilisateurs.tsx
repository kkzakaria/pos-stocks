import { useEffect, useRef, useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Users } from "lucide-react"
import { COMPANY_ROLES } from "shared"
import type { CompanyRole } from "shared"
import { apiFetch } from "@/lib/api"
import { validerRechercheUtilisateurs } from "@/lib/recherche-utilisateurs"
import {
  peutGererRole,
  rolesAttribuables,
  ROLES_ENTREPRISE_FR,
} from "@/lib/roles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputRecherche } from "@/components/ui/input-recherche"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Pagination } from "@/components/ui/pagination"
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
import { ProvisionalPasswordDialog } from "@/components/provisional-password-dialog"
import { GererAcces } from "@/components/utilisateur/gerer-acces"
import { PorteeUtilisateur } from "@/components/utilisateur/portee"
import type {
  EntrepotOption,
  Utilisateur,
} from "@/components/utilisateur/types"

export const Route = createFileRoute("/_app/administration/utilisateurs")({
  beforeLoad: ({ context }) => {
    const role = context.me.membership?.role
    if (role !== "owner" && role !== "admin" && role !== "auditor") {
      throw redirect({ to: "/" })
    }
  },
  // Filters and page live in the URL: shareable, refresh- and back-safe.
  validateSearch: validerRechercheUtilisateurs,
  component: UtilisateursPage,
})

const LIBELLES_STATUT: Record<"true" | "false", string> = {
  true: "Actifs",
  false: "Désactivés",
}

/**
 * Users register: who holds which company role, over which warehouses, and
 * whether the account can still sign in. The table stays read-only; every
 * write for one account goes through its "Gérer l'accès" dialog.
 * Full-height column layout: heading, filters and pagination stay fixed
 * while the table body scrolls under its sticky header.
 */
function UtilisateursPage() {
  const { me } = Route.useRouteContext()
  // Typed rather than inferred from a boolean: every write control derives from
  // this role, so it carries the narrowing itself instead of relying on the
  // compiler tracking a `peutEcrire` alias.
  const role = me.membership?.role
  const roleGestionnaire = role === "owner" || role === "admin" ? role : null
  const peutEcrire = roleGestionnaire !== null
  const queryClient = useQueryClient()
  const navigateFiltres = Route.useNavigate()

  const { q = "", role: roleFiltre, actif, page = 1 } = Route.useSearch()
  const [recherche, setRecherche] = useState(q)
  const refRecherche = useRef<HTMLInputElement>(null)

  // 300 ms debounce: the URL (source of truth for the query) is only updated
  // once typing has settled; changing a filter resets to page 1. The equality
  // guard keeps mount and back/forward realignment from stripping ?page out
  // of a shared or reloaded URL.
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

  const utilisateurs = useQuery({
    queryKey: ["users", q, roleFiltre, actif, page],
    queryFn: () => {
      const params = new URLSearchParams()
      if (q) params.set("recherche", q)
      if (roleFiltre) params.set("role", roleFiltre)
      if (actif !== undefined) params.set("actif", String(actif))
      params.set("page", String(page))
      return apiFetch<{
        users: Utilisateur[]
        total: number
        page: number
        limite: number
      }>(`/api/v1/users?${params.toString()}`)
    },
  })
  const entrepots = useQuery({
    queryKey: ["warehouses"],
    queryFn: () =>
      apiFetch<{ warehouses: EntrepotOption[] }>("/api/v1/warehouses"),
    enabled: peutEcrire,
  })

  const [dialogCreation, setDialogCreation] = useState(false)
  const [nom, setNom] = useState("")
  const [email, setEmail] = useState("")
  const [roleNouveau, setRoleNouveau] = useState<CompanyRole>("staff")
  const [erreur, setErreur] = useState<string | null>(null)
  const [provisoire, setProvisoire] = useState<{
    password: string
    email: string
  } | null>(null)
  const [idGere, setIdGere] = useState<string | null>(null)

  // Roles assignable at creation: a new account is never created as owner.
  const optionsCreation = roleGestionnaire
    ? rolesAttribuables(roleGestionnaire).filter((r) => r !== "owner")
    : []

  const creer = useMutation({
    mutationFn: () =>
      apiFetch<{ provisionalPassword: string }>("/api/v1/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nom, email, role: roleNouveau }),
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["users"] })
      setDialogCreation(false)
      setProvisoire({ password: res.provisionalPassword, email })
      setNom("")
      setEmail("")
      setRoleNouveau("staff")
      setErreur(null)
    },
    onError: (err) => setErreur(err instanceof Error ? err.message : "Erreur"),
  })

  const liste = utilisateurs.data?.users ?? []
  const total = utilisateurs.data?.total ?? 0
  // `actif` is a boolean: `false` filters on deactivated accounts, so it has
  // to be tested against undefined rather than for truthiness.
  const filtreActif = Boolean(q || roleFiltre) || actif !== undefined
  const colonnes = peutEcrire ? 5 : 4
  // Read from the fresh list rather than a snapshot: the dialog reflects each
  // mutation as soon as the query is invalidated.
  const utilisateurGere = liste.find((u) => u.id === idGere) ?? null

  // A mutation or a filter change can drop the managed account from the list —
  // deactivating it while filtering on active ones does exactly that. Drop the
  // selection with it, otherwise the dialog springs back open on its own once
  // the account reappears. Gated on `isSuccess`: mid-refetch the list is empty
  // and would clear a selection that is still valid.
  useEffect(() => {
    if (idGere === null || !utilisateurs.isSuccess) return
    if (!liste.some((u) => u.id === idGere)) setIdGere(null)
  }, [idGere, liste, utilisateurs.isSuccess])

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Utilisateurs</h1>
        {peutEcrire && (
          <Dialog open={dialogCreation} onOpenChange={setDialogCreation}>
            <DialogTrigger render={<Button />}>
              Nouvel utilisateur
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvel utilisateur</DialogTitle>
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
                    value={roleNouveau}
                    onValueChange={(valeur) =>
                      setRoleNouveau(valeur as CompanyRole)
                    }
                  >
                    <SelectTrigger id="u-role" className="w-full">
                      <SelectValue>
                        {(valeur: CompanyRole) => ROLES_ENTREPRISE_FR[valeur]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {optionsCreation.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLES_ENTREPRISE_FR[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {roleNouveau === "staff" && (
                    <p className="text-xs text-muted-foreground">
                      Un employé n'accède à rien tant qu'il n'est pas affecté à
                      un entrepôt.
                    </p>
                  )}
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

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="u-recherche">Recherche</Label>
          <InputRecherche
            id="u-recherche"
            name="recherche"
            ref={refRecherche}
            placeholder="Nom ou email…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className="w-72"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="u-filtre-role">Rôle</Label>
          <Select
            value={roleFiltre ?? ""}
            onValueChange={(valeur) =>
              // Push (not replace): each filter step stays in history
              void navigateFiltres({
                search: (prec) => ({
                  ...prec,
                  role: (valeur as CompanyRole | "") || undefined,
                  page: undefined,
                }),
              })
            }
          >
            <SelectTrigger id="u-filtre-role" className="w-52">
              <SelectValue placeholder="Tous">
                {(valeur: string) =>
                  valeur === ""
                    ? "Tous"
                    : ROLES_ENTREPRISE_FR[valeur as CompanyRole]
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tous</SelectItem>
              {COMPANY_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLES_ENTREPRISE_FR[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="u-filtre-statut">Statut</Label>
          <Select
            value={actif === undefined ? "" : String(actif)}
            onValueChange={(valeur) =>
              void navigateFiltres({
                search: (prec) => ({
                  ...prec,
                  actif: valeur === "" ? undefined : valeur === "true",
                  page: undefined,
                }),
              })
            }
          >
            <SelectTrigger id="u-filtre-statut" className="w-36">
              <SelectValue placeholder="Tous">
                {(valeur: string) =>
                  valeur === "true" || valeur === "false"
                    ? LIBELLES_STATUT[valeur]
                    : "Tous"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tous</SelectItem>
              <SelectItem value="true">Actifs</SelectItem>
              <SelectItem value="false">Désactivés</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Table containerClassName="min-h-0 flex-1 overflow-y-auto">
        <TableHeader sticky>
          <TableRow>
            <TableHead>Utilisateur</TableHead>
            <TableHead>Rôle</TableHead>
            <TableHead>Portée</TableHead>
            <TableHead>Statut</TableHead>
            {peutEcrire && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {utilisateurs.isPending ? (
            <TableSkeleton colonnes={colonnes} />
          ) : liste.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colonnes}>
                <EtatVide
                  icon={Users}
                  titre="Aucun utilisateur trouvé"
                  message={
                    filtreActif
                      ? "Aucun compte ne correspond à ces critères. Ajustez la recherche ou les filtres."
                      : "Créez un premier compte pour donner accès à l'application."
                  }
                  action={
                    peutEcrire && !filtreActif ? (
                      <Button onClick={() => setDialogCreation(true)}>
                        Nouvel utilisateur
                      </Button>
                    ) : undefined
                  }
                />
              </TableCell>
            </TableRow>
          ) : (
            liste.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <span className="font-medium">{u.name}</span>
                  {u.id === me.user.id && (
                    <span className="text-muted-foreground"> (vous)</span>
                  )}
                  <span className="block text-muted-foreground">{u.email}</span>
                </TableCell>
                <TableCell>{ROLES_ENTREPRISE_FR[u.role]}</TableCell>
                <TableCell>
                  <PorteeUtilisateur utilisateur={u} />
                </TableCell>
                <TableCell>
                  <Badge variant={u.isActive ? "success" : "secondary"}>
                    {u.isActive ? "Actif" : "Désactivé"}
                  </Badge>
                </TableCell>
                {peutEcrire && (
                  <TableCell>
                    {/* The front hides what the API would refuse: an admin
                        never manages an owner or another admin. */}
                    {u.id !== me.user.id &&
                      peutGererRole(roleGestionnaire, u.role) && (
                        <Button
                          variant="outline"
                          onClick={() => setIdGere(u.id)}
                          aria-label={`Gérer l'accès de ${u.name}`}
                        >
                          Gérer l'accès
                        </Button>
                      )}
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {total > 0 && (
        <Pagination
          page={page}
          total={total}
          pageSize={utilisateurs.data?.limite ?? 50}
          onPageChange={(p) =>
            // Push (not replace): Back returns to the previous page of results
            void navigateFiltres({
              search: (prec) => ({ ...prec, page: p > 1 ? p : undefined }),
            })
          }
          element={{ un: "utilisateur", plusieurs: "utilisateurs" }}
          className="mt-3"
        />
      )}

      {roleGestionnaire && utilisateurGere && (
        <GererAcces
          utilisateur={utilisateurGere}
          entrepots={entrepots.data?.warehouses ?? []}
          roleDemandeur={roleGestionnaire}
          open
          onOpenChange={(ouvert) => {
            if (!ouvert) setIdGere(null)
          }}
        />
      )}
    </div>
  )
}
