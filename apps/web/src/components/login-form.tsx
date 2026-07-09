import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"

type Props = {
  onSubmit: (values: {
    email: string
    password: string
  }) => Promise<string | null>
}

export function LoginForm({ onSubmit }: Props) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const message = await onSubmit({ email, password })
      setError(message)
    } catch {
      setError("Une erreur est survenue, veuillez réessayer.")
    } finally {
      setLoading(false)
    }
  }

  const inputClasses =
    "h-11 rounded-md border border-(--ligne) bg-white px-3 text-base text-(--encre) " +
    "placeholder:text-(--encre-pale)/60 " +
    "focus:border-(--rack-vif) focus:ring-2 focus:ring-(--rack-vif)/35 focus:outline-none"

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder="nom@entreprise.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClasses}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Mot de passe
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClasses} w-full pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={
              showPassword
                ? "Masquer le mot de passe"
                : "Afficher le mot de passe"
            }
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-(--encre-pale) transition-colors hover:text-(--encre) focus-visible:text-(--encre) focus-visible:outline-none"
          >
            {showPassword ? (
              <EyeOff size={18} aria-hidden="true" />
            ) : (
              <Eye size={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="login-mono text-[13px] font-medium text-red-700"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="mt-1 h-11 rounded-md bg-(--rack) text-base font-semibold text-white transition-colors duration-150 hover:bg-(--rack-vif) focus-visible:ring-2 focus-visible:ring-(--rack-vif) focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
      >
        {loading ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  )
}
