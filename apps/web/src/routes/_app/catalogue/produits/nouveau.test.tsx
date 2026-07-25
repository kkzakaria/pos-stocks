import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { FormulaireCreationProduit } from "@/routes/_app/catalogue/produits/nouveau"
import { apiFetch } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() => Promise.resolve({ id: "p1", sku: "PRD-0001" })),
  apiUrl: (chemin: string) => chemin,
}))

afterEach(() => vi.clearAllMocks())

function monter(surSucces = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <FormulaireCreationProduit categories={[]} surSucces={surSucces} />
    </QueryClientProvider>
  )
}

/** Reads back the JSON part the form submitted. */
function donneesEnvoyees(): Record<string, unknown> {
  const appel = vi.mocked(apiFetch).mock.calls[0]
  const corps = (appel[1] as { body: FormData }).body
  return JSON.parse(corps.get("donnees") as string) as Record<string, unknown>
}

describe("FormulaireCreationProduit", () => {
  it("envoie un multipart contenant les champs saisis", async () => {
    const surSucces = vi.fn()
    monter(surSucces)

    fireEvent.change(screen.getByLabelText("Nom"), {
      target: { value: "Marteau" },
    })
    fireEvent.change(screen.getByLabelText("Prix de vente"), {
      target: { value: "12000" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Créer le produit" }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(donneesEnvoyees()).toEqual({ name: "Marteau", price: 12000 })
    await waitFor(() => expect(surSucces).toHaveBeenCalledWith("p1"))
  })

  it("joint les variantes saisies à la partie donnees", async () => {
    monter()

    fireEvent.change(screen.getByLabelText("Nom"), {
      target: { value: "Câble" },
    })
    fireEvent.change(screen.getByLabelText("Prix de vente"), {
      target: { value: "1500" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Ce produit se décline" })
    )
    fireEvent.change(screen.getByLabelText("Nom (ex : M / Rouge)"), {
      target: { value: "1.5 mm²" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — nom"), {
      target: { value: "section" },
    })
    fireEvent.change(screen.getByLabelText("Attribut 1 — valeur"), {
      target: { value: "1.5" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la variante" }))
    fireEvent.click(screen.getByRole("button", { name: "Créer le produit" }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(donneesEnvoyees()).toMatchObject({
      variants: [{ name: "1.5 mm²", attributes: { section: "1.5" } }],
    })
  })

  it("affiche l'erreur de l'API sans vider la saisie", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(
      new Error("Ce nom est déjà utilisé")
    )
    monter()

    fireEvent.change(screen.getByLabelText("Nom"), {
      target: { value: "Doublon" },
    })
    fireEvent.change(screen.getByLabelText("Prix de vente"), {
      target: { value: "500" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Créer le produit" }))

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Ce nom est déjà utilisé"
      )
    )
    expect(screen.getByLabelText<HTMLInputElement>("Nom").value).toBe("Doublon")
  })

  it("signale que la liste des catégories n'a pas pu être chargée", () => {
    // An empty combobox after a failed request looks exactly like an
    // organisation without categories: the message tells the two apart, and
    // creation stays possible since the category is optional.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <FormulaireCreationProduit
          categories={[]}
          categoriesEnErreur
          surSucces={vi.fn()}
        />
      </QueryClientProvider>
    )

    expect(
      screen
        .getAllByRole("alert")
        .some((n) => n.textContent.includes("catégories"))
    ).toBe(true)
    expect(
      screen.getByRole("button", { name: "Créer le produit" })
    ).toBeTruthy()
  })
})
