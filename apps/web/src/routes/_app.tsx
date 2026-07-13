import { Outlet, Link, createFileRoute, redirect } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { authClient } from "@/lib/auth-client"
import { apiFetch } from "@/lib/api"
import { fetchMe } from "@/lib/me"
import type { Me } from "@/lib/me"
import { useAccesStock } from "@/lib/permissions"
import { Badge } from "@/components/ui/badge"
import { UserMenu } from "@/components/user-menu"

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
  "rounded px-2 py-1.5 text-sm outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/30 aria-[current=page]:bg-sidebar-primary aria-[current=page]:text-sidebar-primary-foreground aria-[current=page]:font-medium"

// Libellé de section : casse normale, sur le ramp (text-xs), token muted.
// Les capitales tramées décoratives sont interdites par DESIGN.md.
const sectionClasses =
  "mt-4 mb-1 px-2 text-xs font-medium text-muted-foreground"

/**
 * Authenticated application shell: navigation sidebar
 * (POS, sales, catalog, stock, administration) filtered by the user's
 * roles, plus the main content area.
 */
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
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground focus:ring-2 focus:ring-ring/30"
      >
        Aller au contenu
      </a>
      {/* h-screen + flex justify-between : bloc déconnexion ancré en bas. Premier div scrolle en interne. */}
      <aside className="sticky top-0 flex h-screen w-60 flex-col justify-between border-r bg-sidebar p-4 text-sidebar-foreground">
        <div className="min-h-0 overflow-y-auto">
          <h2 className="mb-1 text-lg font-semibold">pos-stocks</h2>
          <p className="mb-6 truncate text-xs text-muted-foreground">
            {me.membership?.organizationName}
          </p>
          <nav
            aria-label="Navigation principale"
            className="flex flex-col gap-1"
          >
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
                <p className={sectionClasses}>Ventes</p>
                {accesVentes && (
                  <Link
                    to="/ventes"
                    activeOptions={{ exact: true }}
                    className={lienClasses}
                  >
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
            <p className={sectionClasses}>Catalogue</p>
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
                <p className={sectionClasses}>Stock</p>
                <Link
                  to="/stock"
                  activeOptions={{ exact: true }}
                  className={lienClasses}
                >
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
                <p className={sectionClasses}>Administration</p>
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
        <div className="border-t border-sidebar-border pt-2">
          <UserMenu me={me} onSignOut={handleSignOut} />
        </div>
      </aside>
      <main id="contenu" tabIndex={-1} className="flex-1 p-6 outline-none">
        <Outlet />
      </main>
    </div>
  )
}

/**
 * Navigation badge for the low-stock alert count, refreshed every
 * minute; hidden when no item is below its threshold.
 */
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
