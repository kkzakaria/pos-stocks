import type { Context } from "hono"
import type { z } from "zod"

// Factorise le motif répété dans toutes les routes :
// lecture JSON tolérante + safeParse + enveloppe VALIDATION 400.
export async function validerCorps<TSchema extends z.ZodType>(
  c: Context,
  schema: TSchema
): Promise<
  { ok: true; data: z.infer<TSchema> } | { ok: false; reponse: Response }
> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return {
      ok: false,
      reponse: c.json(
        {
          code: "VALIDATION",
          message: "Données invalides",
          details: parsed.error.flatten(),
        },
        400
      ),
    }
  }
  return { ok: true, data: parsed.data }
}
