import { createFileRoute, useRouter } from "@tanstack/react-router"
import { apiFetch } from "@/lib/api"
import { ChangePasswordForm } from "@/components/change-password-form"

export const Route = createFileRoute("/_app/mon-compte")({
  component: MonComptePage,
})

/** "Mon compte" page: identity/role recap and password change (alert when the password is still provisional). */
function MonComptePage() {
  const { me } = Route.useRouteContext()
  const router = useRouter()

  async function handleSubmit(values: {
    currentPassword: string
    newPassword: string
  }) {
    try {
      await apiFetch("/api/v1/mon-compte/mot-de-passe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      })
      await router.invalidate()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : "Une erreur est survenue"
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold">Mon compte</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {me.user.name} · {me.user.email} · rôle : {me.membership?.role ?? "—"}
      </p>
      {me.user.mustChangePassword && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          Votre mot de passe est provisoire : choisissez-en un nouveau pour
          accéder à l'application.
        </p>
      )}
      <h2 className="mt-8 mb-4 text-base font-semibold">
        Changer mon mot de passe
      </h2>
      <ChangePasswordForm onSubmit={handleSubmit} />
    </div>
  )
}
