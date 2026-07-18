export function analyserCookieSession(enteteSetCookie: string): string {
  // Ne garder que le nom=valeur (avant le premier `;` de chaque paire, et
  // avant la première `,` s'il y a plusieurs cookies posés) : Path,
  // HttpOnly, SameSite… ne doivent pas être renvoyés dans `Cookie`.
  const pairePart = enteteSetCookie.split(",")[0].split(";")[0].trim()
  if (!pairePart.includes("=")) {
    throw new Error(`En-tête Set-Cookie inattendu : ${enteteSetCookie}`)
  }
  return pairePart
}

export interface ClientApi {
  baseUrl: string
  cookie: string
}

export async function connecter(
  baseUrl: string,
  email: string,
  password: string,
  origin: string
): Promise<ClientApi> {
  const reponse = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Web origin configured as trustedOrigins in auth.ts (differs by environment:
      // dev local = http://localhost:3000, prod = https://pos-stocks-web.koffiz2110.workers.dev).
      origin,
    },
    body: JSON.stringify({ email, password }),
  })
  if (!reponse.ok) {
    throw new Error(
      `Échec de connexion (${reponse.status}) : ${await reponse.text()}`
    )
  }
  const enteteSetCookie = reponse.headers.get("set-cookie")
  if (enteteSetCookie === null) {
    throw new Error("Aucun cookie de session reçu à la connexion")
  }
  return { baseUrl, cookie: analyserCookieSession(enteteSetCookie) }
}

export async function requeteJson<T>(
  client: ClientApi,
  method: "GET" | "POST",
  chemin: string,
  corps?: unknown
): Promise<{ status: number; donnees: T }> {
  const reponse = await fetch(`${client.baseUrl}${chemin}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: client.cookie,
    },
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  })
  const donnees = (await reponse.json()) as T
  return { status: reponse.status, donnees }
}

export async function televerserImage(
  client: ClientApi,
  productId: string,
  buffer: Buffer,
  nomFichier: string,
  contentType: string
): Promise<{
  status: number
  donnees: { imageKey?: string; code?: string; message?: string }
}> {
  const formulaire = new FormData()
  formulaire.append(
    "image",
    new Blob([new Uint8Array(buffer)], { type: contentType }),
    nomFichier
  )
  const reponse = await fetch(
    `${client.baseUrl}/api/v1/products/${productId}/image`,
    {
      method: "POST",
      headers: { cookie: client.cookie },
      body: formulaire,
    }
  )
  const donnees = (await reponse.json()) as {
    imageKey?: string
    code?: string
    message?: string
  }
  return { status: reponse.status, donnees }
}
