import { useEffect, useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toast"

export const Route = createFileRoute("/_app/administration/parametres")({
  beforeLoad: ({ context }) => {
    const role = context.me.membership?.role
    if (role !== "owner" && role !== "admin" && role !== "auditor") {
      throw redirect({ to: "/" })
    }
  },
  component: ParametresPage,
})

type Reglages = {
  name: string
  currency: string
  receiptHeader: string
  receiptFooter: string
}

function ParametresPage() {
  const { me } = Route.useRouteContext()
  const peutEcrire =
    me.membership?.role === "owner" || me.membership?.role === "admin"
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Reglages | null>(null)

  const { data, isError, error } = useQuery({
    queryKey: ["organization"],
    queryFn: () => apiFetch<Reglages>("/api/v1/organization"),
  })

  useEffect(() => {
    if (data && !form) setForm(data)
  }, [data, form])

  const enregistrer = useMutation({
    mutationFn: (values: Reglages) =>
      apiFetch("/api/v1/organization", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organization"] })
      toast.success("Paramètres enregistrés")
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Impossible de charger les paramètres :{" "}
        {error instanceof Error ? error.message : "Erreur inconnue"}
      </p>
    )
  }

  if (!form) {
    return (
      <div className="max-w-xl">
        <h1 className="mb-6 text-xl font-semibold">Paramètres</h1>
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_champ, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-xl">
      <h1 className="mb-6 text-xl font-semibold">Paramètres</h1>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          enregistrer.mutate(form)
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-nom">Nom de l'entreprise</Label>
          <Input
            id="p-nom"
            required
            disabled={!peutEcrire}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-devise">Devise (code ISO, ex : XOF)</Label>
          <Input
            id="p-devise"
            required
            maxLength={3}
            disabled={!peutEcrire}
            value={form.currency}
            onChange={(e) =>
              setForm({ ...form, currency: e.target.value.toUpperCase() })
            }
            className="w-28 font-mono uppercase"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-entete">En-tête de ticket</Label>
          <Textarea
            id="p-entete"
            rows={2}
            disabled={!peutEcrire}
            value={form.receiptHeader}
            onChange={(e) =>
              setForm({ ...form, receiptHeader: e.target.value })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-pied">Pied de ticket</Label>
          <Textarea
            id="p-pied"
            rows={2}
            disabled={!peutEcrire}
            value={form.receiptFooter}
            onChange={(e) =>
              setForm({ ...form, receiptFooter: e.target.value })
            }
          />
        </div>
        {peutEcrire && (
          <Button type="submit" disabled={enregistrer.isPending}>
            {enregistrer.isPending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        )}
      </form>
    </div>
  )
}
