import { useEffect, useState } from "react"
import {
  Outlet,
  Link,
  createFileRoute,
  redirect,
  useRouterState,
} from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { authClient } from "@/lib/auth-client"
import { apiFetch } from "@/lib/api"
import { fetchMe } from "@/lib/me"
import type { Me } from "@/lib/me"
import { useAccesStock } from "@/lib/permissions"
import { useEstDesktop } from "@/lib/use-media-query"
import {
  LayoutDashboard,
  ScanBarcode,
  ReceiptText,
  BarChart3,
  Package,
  FolderTree,
  Truck,
  Boxes,
  History,
  PackagePlus,
  ArrowLeftRight,
  ClipboardList,
  Warehouse,
  Users,
  Settings,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { UserMenu } from "@/components/user-menu"
import { EnteteMobile } from "@/components/entete-mobile"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer"

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
  component: AppLayoutRoute,
})

function AppLayoutRoute() {
  const { me } = Route.useRouteContext()
  return <AppLayout me={me} />
}

// Nav entry: icon + label, dense (py-1). Icon inherits the text color
// (currentColor): muted at rest, white on the active indigo state.
const lienClasses =
  "flex items-center gap-2 rounded px-2 py-1 text-sm outline-none [&>svg]:size-4 [&>svg]:shrink-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/30 aria-[current=page]:bg-sidebar-primary aria-[current=page]:text-sidebar-primary-foreground aria-[current=page]:font-medium"

// Section label: normal case, on the ramp (text-xs), muted token.
// Decorative uppercase tracking is forbidden per DESIGN.md.
const sectionClasses =
  "mt-3 mb-0.5 px-2 text-xs font-medium text-muted-foreground"

/**
 * Authenticated application shell: navigation sidebar
 * (POS, sales, catalog, stock, administration) filtered by the user's
 * roles, plus the main content area.
 *
 * Takes `me` as a prop (rather than reading `Route.useRouteContext()`
 * itself) so it stays a plain, testable component — `AppLayoutRoute` is the
 * thin route-bound wrapper, same split as `FicheProduitPage`/`FicheProduit`.
 */
export function AppLayout({ me }: { me: Me }) {
  const estDesktop = useEstDesktop()
  const [menuOuvert, setMenuOuvert] = useState(false)

  // Close the drawer whenever the route changes — otherwise it stays open
  // on top of the page the user just reached.
  const chemin = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => setMenuOuvert(false), [chemin])

  async function handleSignOut() {
    await authClient.signOut()
    window.location.href = "/login"
  }

  return (
    // h-dvh (not min-h-screen): bounds this container to exactly one viewport,
    // so <main>'s flex-1 below resolves to a DEFINITE height (viewport minus
    // the mobile header's natural height, computed by flexbox — not a
    // hardcoded constant that would drift the moment the header's own height
    // changes, e.g. pointer-coarse growing its button to 44px). Content
    // taller than that still overflows visibly and scrolls the document
    // exactly as it did under min-h-screen: nothing here clips overflow.
    <div className="flex h-dvh flex-col lg:flex-row">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground focus:ring-2 focus:ring-ring/30"
      >
        Aller au contenu
      </a>
      {estDesktop ? (
        // h-screen + flex justify-between: sign-out block anchored at the bottom. First div scrolls internally.
        <aside className="sticky top-0 flex h-screen w-60 flex-col justify-between border-r bg-sidebar p-4 text-sidebar-foreground">
          <div className="min-h-0 overflow-y-auto">
            <h2 className="text-base font-semibold">pos-stocks</h2>
            <p className="mb-4 truncate text-xs text-muted-foreground">
              {me.membership?.organizationName}
            </p>
            <NavigationPrincipale me={me} />
          </div>
          <div className="border-t border-sidebar-border pt-2">
            <UserMenu me={me} onSignOut={handleSignOut} />
          </div>
        </aside>
      ) : (
        <>
          <EnteteMobile onOuvrir={() => setMenuOuvert(true)} />
          <Drawer open={menuOuvert} onOpenChange={setMenuOuvert}>
            <DrawerContent>
              <DrawerTitle>Navigation</DrawerTitle>
              <DrawerDescription className="sr-only">
                Sections de l'application
              </DrawerDescription>
              <NavigationPrincipale me={me} />
              <div className="mt-auto border-t border-sidebar-border pt-2">
                <UserMenu me={me} onSignOut={handleSignOut} />
              </div>
            </DrawerContent>
          </Drawer>
        </>
      )}
      {/* min-w-0: without it, a wide table widens the whole document
          instead of scrolling inside its overflow-x-auto container.
          flex flex-col + min-h-0 + flex-1: makes THIS element's own
          resolved height definite (see the h-dvh comment above), so a
          screen that wants full-height internal scrolling can just use
          `h-full` on its root instead of reverse-engineering a magic
          `calc(100dvh-…)` that silently drifts whenever the chrome above
          it (mobile header, padding) changes. Screens that don't need
          that (the majority) are unaffected: their content still simply
          overflows and the document scrolls, exactly as before. */}
      <main
        id="contenu"
        tabIndex={-1}
        className="flex min-h-0 min-w-0 flex-1 flex-col p-4 outline-none lg:p-6"
      >
        <Outlet />
      </main>
    </div>
  )
}

/**
 * Main navigation links, filtered by the user's org and warehouse roles.
 * Shared by the desktop sidebar and the mobile drawer so the nav never
 * exists twice in the DOM.
 */
function NavigationPrincipale({ me }: { me: Me }) {
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

  return (
    <nav aria-label="Navigation principale" className="flex flex-col gap-0.5">
      <Link to="/" activeOptions={{ exact: true }} className={lienClasses}>
        <LayoutDashboard />
        Tableau de bord
      </Link>
      {accesPos && (
        <Link to="/pos" className={lienClasses}>
          <ScanBarcode />
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
              <ReceiptText />
              Historique
            </Link>
          )}
          {accesRapports && (
            <Link to="/ventes/rapports" className={lienClasses}>
              <BarChart3 />
              Rapports
            </Link>
          )}
        </>
      )}
      <p className={sectionClasses}>Catalogue</p>
      <Link to="/catalogue/produits" className={lienClasses}>
        <Package />
        Produits
      </Link>
      <Link to="/catalogue/categories" className={lienClasses}>
        <FolderTree />
        Catégories
      </Link>
      <Link to="/catalogue/fournisseurs" className={lienClasses}>
        <Truck />
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
            <Boxes />
            <span className="flex-1">Niveaux</span>
            <BadgeAlertesStock />
          </Link>
          <Link to="/stock/mouvements" className={lienClasses}>
            <History />
            Mouvements
          </Link>
          <Link to="/stock/receptions" className={lienClasses}>
            <PackagePlus />
            Réceptions
          </Link>
          <Link to="/stock/transferts" className={lienClasses}>
            <ArrowLeftRight />
            Transferts
          </Link>
          <Link to="/stock/inventaires" className={lienClasses}>
            <ClipboardList />
            Inventaires
          </Link>
        </>
      )}
      {estAdmin && (
        <>
          <p className={sectionClasses}>Administration</p>
          <Link to="/administration/entrepots" className={lienClasses}>
            <Warehouse />
            Entrepôts
          </Link>
          <Link to="/administration/utilisateurs" className={lienClasses}>
            <Users />
            Utilisateurs
          </Link>
          <Link to="/administration/parametres" className={lienClasses}>
            <Settings />
            Paramètres
          </Link>
        </>
      )}
    </nav>
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
