import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { FormulaireCreationProduit } from "@/routes/_app/catalogue/produits/nouveau"
import { apiFetch } from "@/lib/api"
import { jetons } from "@/test/jetons"
import { preparerImage } from "@/lib/image"
import type * as ModuleImage from "@/lib/image"

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(() => Promise.resolve({ id: "p1", sku: "PRD-0001" })),
  apiUrl: (chemin: string) => chemin,
}))

// The real module is kept (identity implementation, shared constants); only
// `preparerImage` is wrapped in a spy so a test can control WHEN it settles.
vi.mock("@/lib/image", async (importOriginal) => {
  const reel = await importOriginal<typeof ModuleImage>()
  return { ...reel, preparerImage: vi.fn(reel.preparerImage) }
})

afterEach(() => {
  vi.clearAllMocks()
  // mockReset, not mockClear: an UNCONSUMED `...Once` implementation would
  // otherwise leak into the next test. Vitest 3 restores the implementation
  // passed to `vi.fn` on reset, so the partial mock survives.
  vi.mocked(preparerImage).mockReset()
})

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

  it("empêche la soumission tant qu'une image est en préparation", async () => {
    let resoudre: (fichier: File) => void = () => undefined
    vi.mocked(preparerImage).mockImplementationOnce(
      () => new Promise<File>((r) => (resoudre = r))
    )
    monter()

    fireEvent.change(screen.getByLabelText("Nom"), {
      target: { value: "Marteau" },
    })
    fireEvent.change(screen.getByLabelText("Prix de vente"), {
      target: { value: "12000" },
    })
    const photo = new File([new Uint8Array(4)], "photo.jpg", {
      type: "image/jpeg",
    })
    fireEvent.change(screen.getByLabelText("Choisir une image"), {
      target: { files: [photo] },
    })

    // The button says nothing on its own: a disabled control with no reason is
    // a dead end, so the wait is spelled out next to it.
    const bouton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Créer le produit",
    })
    expect(bouton.disabled).toBe(true)
    const region = screen.getByRole("status")
    expect(region.textContent).toContain("Préparation")
    // Tied to the control, not merely placed near it.
    expect(bouton.getAttribute("aria-describedby")).toBe(region.id)

    // Submitted straight on the form, which is what `requestSubmit()` amounts
    // to and what remains reachable if someone drops the button's `disabled`.
    // (Enter in a text field would NOT get here: implicit submission clicks
    // the default button, which is disabled.) The handler carries the guard as
    // defence in depth — without it the product would be created WITHOUT its
    // image, silently.
    fireEvent.submit(bouton.closest("form")!)
    // Flushed before asserting: `creer.mutate()` reaches `apiFetch` through a
    // microtask, so a synchronous assertion here would pass even with the
    // guard removed.
    await act(async () => undefined)
    expect(apiFetch).not.toHaveBeenCalled()

    await act(async () => {
      resoudre(photo)
    })

    // The region itself STAYS mounted — it has to exist before its content
    // changes to be announced at all — so what empties is its text, not the
    // node. Asserting its absence would lock in the unannounced variant.
    expect(screen.getByRole("status").textContent).toBe("")
    expect(bouton.disabled).toBe(false)
    fireEvent.click(bouton)

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    // The whole point of the wait: the file the field prepared does travel.
    const appel = vi.mocked(apiFetch).mock.calls[0]
    const corps = (appel[1] as { body: FormData }).body
    expect(corps.get("image")).toBeInstanceOf(File)
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

  // jsdom has neither a layout engine nor a CSS cascade — and no pointer media
  // either: this case guards that the class is APPLIED, never that it produces
  // its effect. The effect was measured in Chrome at 375 px with
  // `pointer-coarse` on: the label went from 184 x 14 px to 184 x 44 px, the
  // box staying 16 px and centred inside that band (top 894, bottom 910 within
  // 880-924). At a fine pointer the label measures 158 x 12 px, i.e. unchanged.
  it("donne au libellé de la case « Suivre les lots » la cible tactile de 44 px", () => {
    monter()
    const label = document.querySelector("label[for='p-suivi-lots']")

    // `Checkbox` already grows a 44 px `before:` overlay on touch, so the box
    // itself was covered. Its label was not, and it is the wider half of the
    // control — the reachable band was 14 px over most of the row's length
    // while every other target of this screen is at 44.
    expect(jetons(label)).toContain("pointer-coarse:min-h-11")
  })
})
