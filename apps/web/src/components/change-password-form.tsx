import { useState } from "react"

type Props = {
  onSubmit: (values: {
    currentPassword: string
    newPassword: string
  }) => Promise<string | null>
}

const champClasses =
  "h-11 w-full rounded-md border border-gray-300 px-3 text-base focus:border-gray-500 focus:ring-2 focus:ring-gray-300 focus:outline-none"

export function ChangePasswordForm({ onSubmit }: Props) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    if (newPassword !== confirmation) {
      setError("Les mots de passe ne correspondent pas")
      return
    }
    if (newPassword.length < 12) {
      setError("Le nouveau mot de passe doit contenir au moins 12 caractères")
      return
    }
    setLoading(true)
    try {
      const message = await onSubmit({ currentPassword, newPassword })
      setError(message)
      if (!message) {
        setSuccess(true)
        setCurrentPassword("")
        setNewPassword("")
        setConfirmation("")
      }
    } catch {
      setError("Une erreur est survenue, veuillez réessayer.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mdp-actuel" className="text-sm font-medium">
          Mot de passe actuel
        </label>
        <input
          id="mdp-actuel"
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={champClasses}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mdp-nouveau" className="text-sm font-medium">
          Nouveau mot de passe
        </label>
        <input
          id="mdp-nouveau"
          type="password"
          required
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={champClasses}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mdp-confirmation" className="text-sm font-medium">
          Confirmer le nouveau mot de passe
        </label>
        <input
          id="mdp-confirmation"
          type="password"
          required
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          className={champClasses}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm font-medium text-green-700">
          Mot de passe changé
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="h-11 rounded-md bg-black text-base font-semibold text-white disabled:opacity-60"
      >
        {loading ? "Changement…" : "Changer le mot de passe"}
      </button>
    </form>
  )
}
