import { Outlet, Link, createFileRoute, redirect } from "@tanstack/react-router"
import { authClient } from "@/lib/auth-client"
import { fetchMe  } from "@/lib/me"
import type {Me} from "@/lib/me";

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

  async function handleSignOut() {
    await authClient.signOut()
    window.location.href = "/login"
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col justify-between border-r p-4">
        <div>
          <h2 className="mb-1 text-lg font-semibold">pos-stocks</h2>
          <p className="mb-6 truncate text-xs text-gray-500">
            {me.membership?.organizationName}
          </p>
          <nav className="flex flex-col gap-1">
            <Link to="/" className={lienClasses}>
              Tableau de bord
            </Link>
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
