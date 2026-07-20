# Lever l'ambiguïté d'une vente — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre au client POS de demander au serveur si une vente a été enregistrée sous une clé d'idempotence donnée, pour lever de façon déterministe l'ambiguïté d'une soumission dont la réponse s'est perdue.

**Architecture:** Une route de consultation `GET /sales/par-cle-requete/:clientRequestId` (scopée organisation, même mécanique d'accès que `GET /sales/:id`). Le front interroge cette route dès l'erreur réseau ambiguë et résout selon la réponse ; en cas d'échec de la consultation, il conserve le verrou et propose un bouton « Vérifier ».

**Tech Stack:** Hono 4 + Drizzle + D1 (API, tests sur D1 réelle via `@cloudflare/vitest-pool-workers`), React 19 + TanStack Query (front, tests Testing Library + jsdom).

**Spec :** `docs/superpowers/specs/2026-07-20-levee-ambiguite-vente-design.md`
**Issue :** #21 — **Branche :** `fix/ambiguite-vente-issue-21`

## Global Constraints

- **Garde cross-tenant AVANT tout** (invariant #7) : la recherche filtre sur `organizationId`, donc une vente d'une autre organisation est **introuvable** → `404 INTROUVABLE`. Un refus de portée boutique/rôle donne `403 ACCES_REFUSE`.
- Enveloppe de réponse : **`{ sale }` seul** — pas de `marge`, la résolution POS n'en a aucun usage.
- **Contrainte d'ordre de route** : `par-cle-requete` doit être déclarée **avant** `salesRoute.get("/:id")`, sinon `/:id` capte le segment. Un commentaire dans le code doit énoncer cette contrainte.
- La consultation est un **`GET` pur** : aucune écriture, rejouable sans effet.
- Enveloppe d'erreur API : `{ code: "MAJUSCULES", message: "français" }`. Réutiliser les codes existants (`INTROUVABLE`, `ACCES_REFUSE`).
- Langue : commentaires de code et JSDoc en **anglais** ; UI, messages d'erreur et noms de tests en **français**.
- Pièges eslint : types dans un `import type` séparé ; `no-unnecessary-condition` ; pas d'import mort.
- Hooks husky actifs. **Jamais `--no-verify`.** La suite API se lance avec `CI=true` (sinon le pool workerd sature la machine).

## Commandes

```bash
CI=true bun run --cwd apps/api test -- test/sales-cle-requete.test.ts   # ciblé API
CI=true bun run --cwd apps/api test                                     # suite API
bun run --cwd apps/web test -- src/pos/ecran-vente.test.tsx             # ciblé web
bun run typecheck && bun run lint
```

## File Structure

- **Modify** `apps/api/src/routes/sales.ts` — helper `venteParCleRequete` + route de consultation.
- **Create** `apps/api/test/sales-cle-requete.test.ts` — tests d'accès et de résolution de la route.
- **Modify** `apps/web/src/lib/pos-api.ts` — client `fetchVenteParCleRequete`.
- **Modify** `apps/web/src/pos/ecran-vente.tsx` — extraction de `finaliserVente`, `resoudreAmbiguite`, câblage `onError`, bouton « Vérifier », `onFermer` ne lève plus le verrou.
- **Modify** `apps/web/src/pos/ecran-vente.test.tsx` — tests composant des quatre issues.

---

### Task 1 : API — consultation d'une vente par sa clé d'idempotence

**Files:**
- Modify: `apps/api/src/routes/sales.ts`
- Create: `apps/api/test/sales-cle-requete.test.ts`

**Interfaces:**
- Consumes (existants dans `sales.ts`) : `verifierLectureVentes(c, storeId): Promise<Response | null>`, `chargerVente(db, organizationId, saleId)`, type `Db`.
- Produces :
  - `venteParCleRequete(db: Db, organizationId: string, clientRequestId: string): Promise<{ id: string; storeId: string } | null>`
  - route `GET /api/v1/sales/par-cle-requete/:clientRequestId` → `{ sale }` 200 | `404 INTROUVABLE` | `403 ACCES_REFUSE`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `apps/api/test/sales-cle-requete.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { drizzle } from "drizzle-orm/d1"
import app from "../src/index"
import * as schema from "../src/db/schema"
import { applyMovements } from "../src/services/stock"
import {
  affecterEntrepot,
  bootstrapOwner,
  createUserWithRole,
  creerEntrepot,
  creerProduitSimple,
} from "./helpers"

function req(cookie: string, method: string, url: string, body?: unknown) {
  return app.request(
    url,
    {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env
  )
}

async function seedAvecVente(nomBoutique: string) {
  const { organizationId, ownerId, ownerCookie } = await bootstrapOwner()
  const storeId = await creerEntrepot(organizationId, nomBoutique, "store")
  const caissier = await createUserWithRole(organizationId, "staff")
  await affecterEntrepot(organizationId, caissier.userId, storeId, "cashier")
  const { variantId } = await creerProduitSimple(organizationId, {
    nom: `Eau ${nomBoutique}`,
    prix: 300,
  })
  const db = drizzle(env.DB, { schema })
  await applyMovements(db, {
    organizationId,
    userId: ownerId,
    mouvements: [
      {
        warehouseId: storeId,
        variantId,
        delta: 10,
        type: "purchase",
        unitCost: 100,
      },
    ],
  })
  await req(caissier.cookie, "POST", "/api/v1/register-sessions", {
    storeId,
    openingFloat: 0,
  })
  const clientRequestId = crypto.randomUUID()
  const vente = await req(caissier.cookie, "POST", "/api/v1/sales", {
    storeId,
    clientRequestId,
    items: [{ variantId, quantity: 2, unitPrice: 300 }],
    payments: [{ method: "cash", amount: 600, receivedAmount: 600 }],
  })
  const { sale } = await vente.json<{ sale: { id: string; total: number } }>()
  return {
    organizationId,
    ownerCookie,
    storeId,
    caissier,
    clientRequestId,
    saleId: sale.id,
  }
}

const CHEMIN = "/api/v1/sales/par-cle-requete"

describe("consultation d'une vente par clé d'idempotence", () => {
  it("retrouve la vente et renvoie son détail", async () => {
    const { caissier, clientRequestId, saleId } =
      await seedAvecVente("Boutique K1")
    const res = await req(caissier.cookie, "GET", `${CHEMIN}/${clientRequestId}`)
    expect(res.status).toBe(200)
    const corps = await res.json<{ sale: { id: string; total: number } }>()
    expect(corps.sale.id).toBe(saleId)
    // 2 × 300 = 600 : valeur recalculée à la main.
    expect(corps.sale.total).toBe(600)
  })

  it("404 INTROUVABLE sur une clé inconnue", async () => {
    const { caissier } = await seedAvecVente("Boutique K2")
    const res = await req(
      caissier.cookie,
      "GET",
      `${CHEMIN}/${crypto.randomUUID()}`
    )
    expect(res.status).toBe(404)
    const corps = await res.json<{ code: string }>()
    expect(corps.code).toBe("INTROUVABLE")
  })

  it("404 INTROUVABLE sur une vente d'une AUTRE organisation", async () => {
    const a = await seedAvecVente("Boutique K3")
    const b = await seedAvecVente("Boutique K4")
    // L'owner de B interroge la clé de A : la recherche étant scopée à son
    // organisation, la vente est introuvable — jamais 403, qui divulguerait
    // son existence.
    const res = await req(b.ownerCookie, "GET", `${CHEMIN}/${a.clientRequestId}`)
    expect(res.status).toBe(404)
    const corps = await res.json<{ code: string }>()
    expect(corps.code).toBe("INTROUVABLE")
  })

  it("403 ACCES_REFUSE pour un caissier hors de sa boutique", async () => {
    const { organizationId, clientRequestId } =
      await seedAvecVente("Boutique K5")
    const autreBoutique = await creerEntrepot(
      organizationId,
      "Boutique K5 bis",
      "store"
    )
    const intrus = await createUserWithRole(organizationId, "staff")
    await affecterEntrepot(
      organizationId,
      intrus.userId,
      autreBoutique,
      "cashier"
    )
    const res = await req(intrus.cookie, "GET", `${CHEMIN}/${clientRequestId}`)
    expect(res.status).toBe(403)
    const corps = await res.json<{ code: string }>()
    expect(corps.code).toBe("ACCES_REFUSE")
  })

  it("la route n'est pas captée par GET /sales/:id", async () => {
    const { caissier, saleId } = await seedAvecVente("Boutique K6")
    // Une clé inconnue ne doit PAS être interprétée comme un id de vente :
    // si /:id captait le segment, la réponse porterait un `sale`.
    const res = await req(caissier.cookie, "GET", `${CHEMIN}/${saleId}`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run : `CI=true bun run --cwd apps/api test -- test/sales-cle-requete.test.ts`
Expected : FAIL — la route n'existe pas (404 sur le premier test, ou capture par `/:id`).

- [ ] **Step 3 : Ajouter le helper de recherche**

Dans `apps/api/src/routes/sales.ts`, juste après la fonction `venteBoutique` (qui se termine par `return rows[0] ?? null`), ajouter :

```ts
/**
 * Looks a sale up by its idempotency key, scoped to the organization. Mirrors
 * `venteBoutique`: an entry belonging to another organization is simply not
 * found, so callers answer 404 rather than leaking its existence with a 403.
 */
async function venteParCleRequete(
  db: Db,
  organizationId: string,
  clientRequestId: string
): Promise<{ id: string; storeId: string } | null> {
  const rows = await db
    .select({ id: schema.sales.id, storeId: schema.sales.storeId })
    .from(schema.sales)
    .where(
      and(
        eq(schema.sales.clientRequestId, clientRequestId),
        eq(schema.sales.organizationId, organizationId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}
```

- [ ] **Step 4 : Ajouter la route AVANT `/:id`**

Toujours dans `apps/api/src/routes/sales.ts`, insérer **immédiatement avant** la ligne `salesRoute.get("/:id", async (c) => {` :

```ts
// ORDER MATTERS: this route must stay declared BEFORE `/:id`, otherwise the
// `/:id` pattern captures the `par-cle-requete` segment and this handler is
// never reached. A test covers the ordering.
//
// Lets the POS resolve an AMBIGUOUS submission (request sent, response lost):
// it asks whether a sale already exists for its idempotency key instead of
// guessing — which would mean either a duplicate sale or silently discarded
// cart edits.
salesRoute.get("/par-cle-requete/:clientRequestId", async (c) => {
  const { organizationId } = c.get("membership")
  const db = drizzle(c.env.DB, { schema })
  const vente = await venteParCleRequete(
    db,
    organizationId,
    c.req.param("clientRequestId")
  )
  if (!vente) {
    return c.json({ code: "INTROUVABLE", message: "Vente introuvable" }, 404)
  }
  const refus = await verifierLectureVentes(c, vente.storeId)
  if (refus) return refus
  return c.json({ sale: await chargerVente(db, organizationId, vente.id) })
})
```

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run : `CI=true bun run --cwd apps/api test -- test/sales-cle-requete.test.ts`
Expected : PASS (5 tests).

Puis `bun run typecheck` → aucune erreur.

- [ ] **Step 6 : Commit**

```bash
git add apps/api/src/routes/sales.ts apps/api/test/sales-cle-requete.test.ts
git commit -m "feat(api): consultation d'une vente par clé d'idempotence"
```

---

### Task 2 : Front — résolution automatique de l'ambiguïté

**Files:**
- Modify: `apps/web/src/lib/pos-api.ts`
- Modify: `apps/web/src/pos/ecran-vente.tsx`
- Modify: `apps/web/src/pos/ecran-vente.test.tsx`

**Interfaces:**
- Consumes : route `GET /api/v1/sales/par-cle-requete/:clientRequestId` → `{ sale: VenteDetail }` | 404 (Task 1) ; `ApiError` (`@/lib/api`) qui porte `status: number` et `code: string | null`.
- Produces (dans `ecran-vente.tsx`) :
  - `finaliserVente(sale: VenteDetail): void` — le corps actuel de `onSuccess`, extrait pour être rejoué par la résolution.
  - `resoudreAmbiguite(): Promise<void>` — interroge le serveur et tranche.
  - état `verificationEnCours: boolean`.
- Produces (dans `pos-api.ts`) : `fetchVenteParCleRequete(clientRequestId: string): Promise<{ sale: VenteDetail }>`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à la fin de `apps/web/src/pos/ecran-vente.test.tsx` :

```ts
describe("EcranVente — levée de l'ambiguïté après réponse perdue", () => {
  const venteResolue: VenteDetail = {
    id: "sale-resolue",
    ticketNumber: 7,
    total: 500,
    currency: "XOF",
    status: "completed",
    createdAt: new Date().toISOString(),
    storeId: "store1",
    storeName: "Boutique",
    cashierName: "Caissier",
    items: [],
    payments: [
      {
        method: "cash",
        amount: 500,
        reference: null,
        receivedAmount: 500,
        changeGiven: 0,
      },
    ],
  }

  beforeEach(() => {
    vi.spyOn(window, "print").mockImplementation(() => undefined)
    vi.spyOn(posApi, "fetchCataloguePos").mockResolvedValue({
      categories: [],
      articles: [article],
    })
    vi.spyOn(posApi, "fetchReglagesTicket").mockResolvedValue({
      name: "Org",
      currency: "XOF",
      receiptHeader: "",
      receiptFooter: "",
    })
    vi.spyOn(posApi, "envoyerVente").mockRejectedValue(
      new Error("Failed to fetch")
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function soumettreEtEchouer() {
    renderEcran()
    const tuile = await screen.findByRole("button", { name: /^Coca 50cl/ })
    fireEvent.click(tuile)
    fireEvent.click(screen.getByRole("button", { name: /ENCAISSER/ }))
    fireEvent.click(screen.getByRole("button", { name: "Montant exact" }))
    fireEvent.click(screen.getByRole("button", { name: "Valider la vente" }))
  }

  it("vente retrouvée : imprime, confirme et vide le panier", async () => {
    vi.spyOn(posApi, "fetchVenteParCleRequete").mockResolvedValue({
      sale: venteResolue,
    })
    await soumettreEtEchouer()

    expect(await screen.findByText("Vente n° 7 enregistrée")).toBeTruthy()
    // Panier vidé : plus aucune ligne.
    expect(
      screen.queryByRole("button", { name: "Retirer Coca 50cl" })
    ).toBeNull()
  })

  it("404 : déverrouille le panier ET régénère la clé d'idempotence", async () => {
    const { ApiError } = await import("@/lib/api")
    vi.spyOn(posApi, "fetchVenteParCleRequete").mockRejectedValue(
      new ApiError("Vente introuvable", 404, "INTROUVABLE", null)
    )
    const envoyer = vi.spyOn(posApi, "envoyerVente")
    await soumettreEtEchouer()

    await waitFor(() => expect(envoyer).toHaveBeenCalledTimes(1))
    const premiereCle = (
      envoyer.mock.calls[0][0] as { clientRequestId: string }
    ).clientRequestId

    // Panier déverrouillé : la tuile ajoute de nouveau une unité.
    const tuile = screen.getByRole("button", { name: /^Coca 50cl/ })
    fireEvent.click(tuile)
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Diminuer la quantité de Coca 50cl",
        }).disabled
      ).toBe(false)
    )

    // Assertion DISCRIMINANTE : le prochain encaissement doit porter une clé
    // DIFFÉRENTE — rejouer l'ancienne renverrait l'ancienne vente.
    fireEvent.click(screen.getByRole("button", { name: /ENCAISSER/ }))
    fireEvent.click(screen.getByRole("button", { name: "Montant exact" }))
    fireEvent.click(screen.getByRole("button", { name: "Valider la vente" }))
    await waitFor(() => expect(envoyer).toHaveBeenCalledTimes(2))
    const secondeCle = (
      envoyer.mock.calls[1][0] as { clientRequestId: string }
    ).clientRequestId
    expect(secondeCle).not.toBe(premiereCle)
  })

  it("consultation en échec : le verrou reste posé", async () => {
    vi.spyOn(posApi, "fetchVenteParCleRequete").mockRejectedValue(
      new Error("Failed to fetch")
    )
    await soumettreEtEchouer()

    await waitFor(() =>
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0)
    )
    // Verrou maintenu : la tuile n'ajoute RIEN (le stepper reste désactivé
    // à la quantité 1).
    fireEvent.click(screen.getByRole("button", { name: /^Coca 50cl/ }))
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Diminuer la quantité de Coca 50cl",
      }).disabled
    ).toBe(true)
  })
})
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run : `bun run --cwd apps/web test -- src/pos/ecran-vente.test.tsx`
Expected : FAIL — `posApi.fetchVenteParCleRequete` n'existe pas.

- [ ] **Step 3 : Ajouter le client API**

Dans `apps/web/src/lib/pos-api.ts`, juste après `fetchVente` :

```ts
/**
 * Asks whether a sale already exists for an idempotency key. Used to resolve an
 * AMBIGUOUS submission (request sent, response lost) instead of guessing.
 */
export function fetchVenteParCleRequete(clientRequestId: string) {
  return apiFetch<{ sale: VenteDetail }>(
    `/api/v1/sales/par-cle-requete/${encodeURIComponent(clientRequestId)}`
  )
}
```

- [ ] **Step 4 : Extraire `finaliserVente` puis brancher la résolution**

Dans `apps/web/src/pos/ecran-vente.tsx` :

**4a.** Compléter l'import depuis `@/lib/pos-api` pour inclure `fetchVenteParCleRequete` (garder `envoyerVente`, `fetchCataloguePos`, `fetchReglagesTicket`).

**4b.** Ajouter, juste avant `const vente = useMutation({` :

```ts
  // Extracted from the mutation's onSuccess so the ambiguity resolution can
  // replay the exact same completion path when it finds the sale server-side.
  const finaliserVente = useCallback(
    (sale: VenteDetail) => {
      setPaiementOuvert(false)
      setLignes([])
      setErreurVente(null)
      // Without this, a later cart reusing the same line key would replay the
      // price alert from the previous sale.
      setErreurPrix(null)
      setPanierVerrouille(false)
      setConfirmation(sale)
      requestId.current = crypto.randomUUID()
      void queryClient.invalidateQueries({
        queryKey: ["pos-catalogue", boutique.id],
      })
    },
    [boutique.id, queryClient]
  )

  const [verificationEnCours, setVerificationEnCours] = useState(false)

  /**
   * Resolves an AMBIGUOUS submission by asking the server whether a sale
   * already exists for our idempotency key. Found -> complete as a success.
   * 404 -> nothing was committed, so unlock AND rotate the key. Lookup itself
   * failing -> conclude nothing and keep the lock.
   */
  const resoudreAmbiguite = useCallback(async () => {
    setVerificationEnCours(true)
    try {
      const { sale } = await fetchVenteParCleRequete(requestId.current)
      finaliserVente(sale)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setPanierVerrouille(false)
        requestId.current = crypto.randomUUID()
        setErreurVente(
          "La vente n'a pas été enregistrée — le panier est de nouveau modifiable."
        )
        return
      }
      setErreurVente(MESSAGE_AMBIGU)
    } finally {
      setVerificationEnCours(false)
    }
  }, [finaliserVente])
```

**4c.** Ajouter la constante au niveau module, juste après `type CleLigne = …` :

```ts
const MESSAGE_AMBIGU =
  "La vente est peut-être déjà enregistrée, et le serveur est injoignable pour le vérifier. Utilisez « Vérifier » avant de modifier le panier."
```

**4d.** Remplacer le corps de `onSuccess` par un appel à l'extraction :

```ts
    onSuccess: ({ sale }) => {
      // Revue — impression et `dejaEnregistree` : on n'inspecte pas ce flag
      // ici volontairement. La clé d'idempotence est régénérée après CHAQUE
      // vente réussie, donc le seul cas où le serveur répond
      // `dejaEnregistree: true` est un retry après une réponse réseau perdue
      // côté client — qui n'a donc jamais imprimé. Imprimer systématiquement
      // ici est le comportement voulu, pas un oubli.
      finaliserVente(sale)
    },
```

**4e.** Remplacer la branche ambiguë de `onError` (les trois dernières instructions, à partir du commentaire « Erreur réseau/timeout AMBIGUË ») par :

```ts
      // Erreur réseau/timeout AMBIGUË : pas de réponse reçue, le batch a pu
      // être commité côté serveur. On verrouille, puis on DEMANDE au serveur
      // si la vente existe au lieu de deviner (issue #21).
      setPanierVerrouille(true)
      setErreurVente(MESSAGE_AMBIGU)
      void resoudreAmbiguite()
```

- [ ] **Step 5 : Lancer les tests pour vérifier qu'ils passent**

Run : `bun run --cwd apps/web test -- src/pos/ecran-vente.test.tsx`
Expected : PASS — y compris les tests de verrouillage et de persistance préexistants du fichier, qui ne doivent pas régresser.

Puis la suite complète `bun run --cwd apps/web test`, puis `bun run typecheck`.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/lib/pos-api.ts apps/web/src/pos/ecran-vente.tsx apps/web/src/pos/ecran-vente.test.tsx
git commit -m "feat(pos): résolution automatique d'une soumission ambiguë"
```

---

### Task 3 : Front — bouton « Vérifier » et abandon qui ne devine plus

**Files:**
- Modify: `apps/web/src/pos/ecran-vente.tsx`
- Modify: `apps/web/src/pos/ecran-vente.test.tsx`

**Interfaces:**
- Consumes : `resoudreAmbiguite`, `verificationEnCours`, `panierVerrouille` (Task 2).

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter dans le bloc `describe("EcranVente — levée de l'ambiguïté après réponse perdue", …)` de `apps/web/src/pos/ecran-vente.test.tsx` :

```ts
  it("consultation en échec : propose « Vérifier », qui relance la consultation", async () => {
    const consultation = vi
      .spyOn(posApi, "fetchVenteParCleRequete")
      .mockRejectedValue(new Error("Failed to fetch"))
    await soumettreEtEchouer()

    const bouton = await screen.findByRole("button", { name: /Vérifier/ })
    await waitFor(() => expect(consultation).toHaveBeenCalledTimes(1))

    // Le réseau revient : la seconde consultation trouve la vente.
    consultation.mockResolvedValue({ sale: venteResolue })
    fireEvent.click(bouton)

    expect(await screen.findByText("Vente n° 7 enregistrée")).toBeTruthy()
    expect(consultation).toHaveBeenCalledTimes(2)
  })

  it("fermer la modale ne lève PAS le verrou tant que l'ambiguïté persiste", async () => {
    vi.spyOn(posApi, "fetchVenteParCleRequete").mockRejectedValue(
      new Error("Failed to fetch")
    )
    await soumettreEtEchouer()
    await screen.findByRole("button", { name: /Vérifier/ })

    fireEvent.click(screen.getByLabelText("Fermer"))

    // Verrou maintenu : la tuile n'ajoute rien (stepper toujours désactivé).
    fireEvent.click(screen.getByRole("button", { name: /^Coca 50cl/ }))
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Diminuer la quantité de Coca 50cl",
      }).disabled
    ).toBe(true)
  })
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run : `bun run --cwd apps/web test -- src/pos/ecran-vente.test.tsx`
Expected : FAIL — aucun bouton « Vérifier », et la fermeture déverrouille encore.

- [ ] **Step 3 : Afficher le bouton « Vérifier »**

Dans `apps/web/src/pos/ecran-vente.tsx`, remplacer le bloc de rendu de `erreurVente` :

```tsx
      {erreurVente && (
        <p
          role="alert"
          className="bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {erreurVente}
        </p>
      )}
```

par :

```tsx
      {erreurVente && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          <p>{erreurVente}</p>
          {panierVerrouille && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={verificationEnCours}
              onClick={() => void resoudreAmbiguite()}
            >
              {verificationEnCours ? "Vérification…" : "Vérifier"}
            </Button>
          )}
        </div>
      )}
```

- [ ] **Step 4 : L'abandon ne lève plus le verrou**

Toujours dans `apps/web/src/pos/ecran-vente.tsx`, remplacer le `onFermer` de `<ModalePaiement>` :

```tsx
          onFermer={() => {
            // Fermer la modale après une tentative ambiguë vaut abandon
            // explicite (décision : déverrouille le panier, cf.
            // panierVerrouille) — requestId.current n'est pas régénéré,
            // un futur encaissement rejouera donc la même tentative.
            setPanierVerrouille(false)
            setPaiementOuvert(false)
          }}
```

par :

```tsx
          onFermer={() => {
            // Closing no longer lifts the lock (issue #21). While the ambiguity
            // stands we do not know whether the sale landed: unlocking here let
            // the cashier edit the cart, and the next checkout replayed the same
            // idempotency key — returning the OLD sale and silently discarding
            // those edits. "Vérifier" is the only way out, and it settles it.
            setPaiementOuvert(false)
          }}
```

- [ ] **Step 5 : Lancer les tests pour vérifier qu'ils passent**

Run : `bun run --cwd apps/web test -- src/pos/ecran-vente.test.tsx`
Expected : PASS.

⚠️ Le test préexistant « bloque les tuiles après une erreur réseau ambiguë, puis débloque à la fermeture explicite » (premier `it` du fichier) repose sur l'ancien comportement et **doit** échouer : il attend qu'une fermeture déverrouille, ce que l'issue #21 corrige. Il n'a par ailleurs aucun mock pour la consultation, qui partirait donc en vrai `fetch`. Le remplacer **intégralement** par :

```ts
  it("bloque les tuiles après une erreur réseau ambiguë, et la fermeture ne déverrouille pas", async () => {
    const envoyerVente = vi
      .spyOn(posApi, "envoyerVente")
      .mockRejectedValue(new Error("Failed to fetch"))
    // La consultation échoue aussi : l'ambiguïté n'est pas levée, donc le
    // verrou doit tenir — y compris après fermeture de la modale (issue #21).
    vi.spyOn(posApi, "fetchVenteParCleRequete").mockRejectedValue(
      new Error("Failed to fetch")
    )
    renderEcran()

    const tuile = await screen.findByRole("button", { name: /^Coca 50cl/ })
    fireEvent.click(tuile)

    fireEvent.click(screen.getByRole("button", { name: /ENCAISSER/ }))
    fireEvent.click(screen.getByRole("button", { name: "Montant exact" }))
    fireEvent.click(screen.getByRole("button", { name: "Valider la vente" }))

    await waitFor(() => expect(envoyerVente).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0)
    )
    const totalAvant =
      screen.getByText("Total à encaisser").nextSibling?.textContent

    // Panier verrouillé : re-cliquer la tuile ne doit PAS ajouter une
    // 2e unité — le total affiché en tête de modale ne bouge pas.
    fireEvent.click(tuile)
    const totalApres =
      screen.getByText("Total à encaisser").nextSibling?.textContent
    expect(totalApres).toBe(totalAvant)

    // Fermer la modale ne lève plus le verrou : le stepper reste désactivé.
    fireEvent.click(screen.getByLabelText("Fermer"))
    fireEvent.click(tuile)
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Diminuer la quantité de Coca 50cl",
      }).disabled
    ).toBe(true)
  })
```

Le second test du fichier (« n'active PAS le verrou sur une erreur API structurée ») reste valide tel quel : une `ApiError` ne passe jamais par la branche ambiguë, donc aucune consultation n'est déclenchée.

Puis la suite complète `bun run --cwd apps/web test`, puis `bun run typecheck` et `bun run lint`.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/pos/ecran-vente.tsx apps/web/src/pos/ecran-vente.test.tsx
git commit -m "feat(pos): bouton Vérifier et abandon qui ne déverrouille plus à l'aveugle"
```

---

## Validation finale (après les 3 tâches)

- [ ] Suite API verte : `CI=true bun run --cwd apps/api test`
- [ ] Suite web verte : `bun run --cwd apps/web test`
- [ ] `bun run typecheck` et `bun run lint` propres
- [ ] **E2E navigateur** sur l'app locale (`http://localhost:3000`, compte owner de dev local — identifiants dans `CLAUDE.md`) :
  1. ouvrir une session de caisse, mettre un article au panier ;
  2. couper le réseau (DevTools → Offline), encaisser → l'ambiguïté apparaît ;
  3. rétablir le réseau, cliquer **« Vérifier »** → si la vente était passée, le ticket s'imprime et le panier se vide ; sinon le panier redevient modifiable ;
  4. vérifier qu'une fermeture de la modale, réseau toujours coupé, **ne déverrouille pas** le panier.
