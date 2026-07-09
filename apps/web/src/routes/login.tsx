import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { authClient } from "@/lib/auth-client"
import { LoginForm } from "@/components/login-form"

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    if (data) throw redirect({ to: "/" })
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const maintenant = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date())

  async function handleSubmit(values: { email: string; password: string }) {
    const { error } = await authClient.signIn.email(values)
    if (error) return "Identifiants invalides"
    await navigate({ to: "/" })
    return null
  }

  return (
    <main className="login-comptoir grid min-h-screen place-items-center px-4 py-10">
      <div className="ticket-sortie w-full max-w-sm">
        <div className="ticket-zigzag ticket-zigzag--haut" aria-hidden="true" />
        <div className="ticket px-7 py-6">
          <header className="login-mono border-b border-dashed border-(--ligne) pb-5 text-center">
            <p className="login-display text-2xl font-bold tracking-tight">
              POS·STOCKS
            </p>
            <p className="mt-2 text-[11px] tracking-widest text-(--encre-pale) uppercase">
              Gestion de stock &amp; point de vente
            </p>
            <p className="mt-1 text-[11px] tracking-widest text-(--encre-pale)">
              {maintenant}
            </p>
          </header>

          <div className="py-6">
            <h1 className="login-display mb-5 text-lg font-semibold">
              Connexion
            </h1>
            <LoginForm onSubmit={handleSubmit} />
          </div>

          <footer className="border-t border-dashed border-(--ligne) pt-5">
            <div className="ticket-code-barres" aria-hidden="true" />
            <p className="login-mono mt-3 text-center text-[10px] tracking-widest text-(--encre-pale) uppercase">
              Accès réservé au personnel autorisé
            </p>
          </footer>
        </div>
        <div className="ticket-zigzag" aria-hidden="true" />
      </div>
    </main>
  )
}
