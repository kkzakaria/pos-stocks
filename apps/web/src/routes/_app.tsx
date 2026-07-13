import { Outlet, Link, createFileRoute, redirect } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { authClient } from "@/lib/auth-client"
import { apiFetch } from "@/lib/api"
import { fetchMe } from "@/lib/me"
import type { Me } from "@/lib/me"
import { useAccesStock } from "@/lib/permissions"
import { Badge } from "@/components/ui/badge"

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    const { data } = await authClient.getSession()
    if (!data) throw redirect({ to: "/login" })
    let me: Me
    try {
      me = await fetchMe()
    } catch {
      throw redirect({ to: "/login" })
    }
    if (me.user.mustChangePassword && location.pathname !== "/mon-compte") {
      throw redirect({ to: "/mon-compte" })
    }
    return { me }
  },
  component: AppLayout,
})

const lienClasses =
  "rounded px-2 py-1.5 text-sm hover:bg-gray-100 aria-[current=page]:font-semibold"

function AppLayout() {
  const { me } = Route.useRouteContext()
  const role = me.membership?.role
  const estAdmin = role === "owner" || role === "admin" || role === "auditor"
  const accesStock = useAccesStock()
  // Lien POS : owner/admin toujours ; staff s'il a une affectation
  // manager/cashier (la route /pos re-filtre sur les boutiques réelles).
  const accesPos =
    role === "owner" ||
    role === "admin" ||
    me.assignments.some((a) => a.role === "manager" || a.role === "cashier")
  // Section Ventes (Phase 7) : historique lisible par les rôles org
  // owner/admin/auditor et TOUTE affectation locale (décision 10 P6, un
  // caissier relit ses tickets) ; Rapports ouvert en plus à stock_manager
  // (valorisation seulement — l'écran filtre ses onglets).
  const accesVentes = estAdmin || me.assignments.length > 0
  const accesRapports =
    estAdmin ||
    role === "stock_manager" ||
    me.assignments.some((a) => a.role === "manager" || a.role === "auditor")

  async function handleSignOut() {
    await authClient.signOut()
    window.location.href = "/login"
  }

  return (
    <div className="flex min-h-screen">
      {/* h-screen + flex justify-between : bloc déconnexion ancré en bas. Premier div scrolle en interne. */}
      <aside className="sticky top-0 flex h-screen w-60 flex-col justify-between border-r p-4">
        <div className="min-h-0 overflow-y-auto">
          <h2 className="mb-1 text-lg font-semibold">pos-stocks</h2>
          <p className="mb-6 truncate text-xs text-gray-500">
            {me.membership?.organizationName}
          </p>
          <nav className="flex flex-col gap-1">
            <Link to="/" className={lienClasses}>
              Tableau de bord
            </Link>
            {accesPos && (
              <Link to="/pos" className={lienClasses}>
                Point de vente
              </Link>
            )}
            {(accesVentes || accesRapports) && (
              <>
                <p className="mt-4 mb-1 px-2 text-[11px] font-medium tracking-widest text-gray-400 uppercase">
                  Ventes
                </p>
                {accesVentes && (
                  <Link to="/ventes" className={lienClasses}>
                    Historique
                  </Link>
                )}
                {accesRapports && (
                  <Link to="/ventes/rapports" className={lienClasses}>
                    Rapports
                  </Link>
                )}
              </>
            )}
            <p className="mt-4 mb-1 px-2 text-[11px] font-medium tracking-widest text-gray-400 uppercase">
              Catalogue
            </p>
            <Link to="/catalogue/produits" className={lienClasses}>
              Produits
            </Link>
            <Link to="/catalogue/categories" className={lienClasses}>
              Catégories
            </Link>
            <Link to="/catalogue/fournisseurs" className={lienClasses}>
              Fournisseurs
            </Link>
            {accesStock.lecture && (
              <>
                <p className="mt-4 mb-1 px-2 text-[11px] font-medium tracking-widest text-gray-400 uppercase">
                  Stock
                </p>
                <Link to="/stock" className={lienClasses}>
                  <span className="flex items-center gap-2">
                    Niveaux
                    <BadgeAlertesStock />
                  </span>
                </Link>
                <Link to="/stock/mouvements" className={lienClasses}>
                  Mouvements
                </Link>
                <Link to="/stock/receptions" className={lienClasses}>
                  Réceptions
                </Link>
                <Link to="/stock/transferts" className={lienClasses}>
                  Transferts
                </Link>
                <Link to="/stock/inventaires" className={lienClasses}>
                  Inventaires
                </Link>
              </>
            )}
            {estAdmin && (
              <>
                <p className="mt-4 mb-1 px-2 text-[11px] font-medium tracking-widest text-gray-400 uppercase">
                  Administration
                </p>
                <Link to="/administration/entrepots" className={lienClasses}>
                  Entrepôts
                </Link>
                <Link to="/administration/utilisateurs" className={lienClasses}>
                  Utilisateurs
                </Link>
                <Link to="/administration/parametres" className={lienClasses}>
                  Paramètres
                </Link>
              </>
            )}
          </nav>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <Link to="/mon-compte" className={lienClasses}>
            Mon compte
          </Link>
          <span className="truncate px-2 text-xs text-gray-500">
            {me.user.email}
          </span>
          <button
            onClick={handleSignOut}
            className="px-2 py-1.5 text-left text-red-600"
          >
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}

function BadgeAlertesStock() {
  const { data } = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () => apiFetch<{ total: number }>("/api/v1/stock/alerts"),
    refetchInterval: 60_000,
  })
  if (!data || data.total === 0) {
    return null
  }
  return <Badge variant="destructive">{data.total}</Badge>
}
