import sharp from "sharp"

const TAILLE_MAX_OCTETS = 2 * 1024 * 1024

export async function convertirEnWebp(entree: Buffer): Promise<Buffer> {
  return sharp(entree).webp({ quality: 82 }).toBuffer()
}

export interface ImageTelechargee {
  buffer: Buffer
  contentType: "image/webp"
  nomFichier: string
}

export async function telechargerEtConvertir(
  url: string,
  sourceId: string
): Promise<ImageTelechargee | null> {
  const reponse = await fetch(url)
  if (!reponse.ok) {
    console.warn(
      `image ${sourceId} : téléchargement échoué (${reponse.status})`
    )
    return null
  }

  const original = Buffer.from(await reponse.arrayBuffer())

  let webp: Buffer
  try {
    webp = await convertirEnWebp(original)
  } catch (err) {
    console.warn(`image ${sourceId} : conversion WebP échouée (${String(err)})`)
    return null
  }

  if (webp.byteLength > TAILLE_MAX_OCTETS) {
    console.warn(
      `image ${sourceId} : ${webp.byteLength} octets > limite de 2 Mo`
    )
    return null
  }

  return {
    buffer: webp,
    contentType: "image/webp",
    nomFichier: `${sourceId}.webp`,
  }
}
