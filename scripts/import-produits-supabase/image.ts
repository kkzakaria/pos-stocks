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
  let reponse: Response
  let original: Buffer

  try {
    reponse = await fetch(url)
  } catch (err) {
    console.warn(`image ${sourceId} : téléchargement échoué (${String(err)})`)
    return null
  }

  if (!reponse.ok) {
    console.warn(
      `image ${sourceId} : téléchargement échoué (${reponse.status})`
    )
    return null
  }

  try {
    original = Buffer.from(await reponse.arrayBuffer())
  } catch (err) {
    console.warn(
      `image ${sourceId} : lecture du buffer échouée (${String(err)})`
    )
    return null
  }

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
