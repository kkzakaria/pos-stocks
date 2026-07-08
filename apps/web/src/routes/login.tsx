import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { authClient } from "@/lib/auth-client"
import { LoginForm } from "@/components/login-form"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()

  async function handleSubmit(values: { email: string; password: string }) {
    const { error } = await authClient.signIn.email(values)
    if (error) return "Identifiants invalides"
    await navigate({ to: "/" })
    return null
  }

  return (
    <main className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-2xl font-semibold">pos-stocks</h1>
        <LoginForm onSubmit={handleSubmit} />
      </div>
    </main>
  )
}
