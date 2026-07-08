import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"
import { authClient } from "@/lib/auth-client"

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    if (!data) throw redirect({ to: "/login" })
    return { user: data.user }
  },
  component: AppLayout,
})

function AppLayout() {
  const { user } = Route.useRouteContext()

  async function handleSignOut() {
    await authClient.signOut()
    window.location.href = "/login"
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col justify-between border-r p-4">
        <div>
          <h2 className="mb-6 text-lg font-semibold">pos-stocks</h2>
          <nav className="flex flex-col gap-2 text-sm">
            <span className="font-medium">Tableau de bord</span>
          </nav>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <span className="truncate text-gray-500">{user.email}</span>
          <button onClick={handleSignOut} className="text-left text-red-600">
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
