import { describe, it, expect } from "vitest"
import { env } from "cloudflare:test"
import { estErreurDeclencheur, estViolationUnicite } from "../src/lib/db-errors"

async function erreurDe(promesse: Promise<unknown>): Promise<unknown> {
  try {
    await promesse
  } catch (err) {
    return err
  }
  throw new Error("l'instruction aurait dû échouer")
}

describe("estErreurDeclencheur — ancrage sur la forme d'erreur trigger D1", () => {
  it("reconnaît le code exact d'un RAISE(ABORT) et rejette les autres codes", async () => {
    // Trigger jetable : reproduit la forme d'erreur réelle des triggers
    // custom (0005/0007) sans dépendre d'un document métier.
    await env.DB.prepare("CREATE TABLE scratch_declencheur (id integer)").run()
    await env.DB.prepare(
      "CREATE TRIGGER scratch_declencheur_tr BEFORE INSERT ON scratch_declencheur BEGIN SELECT RAISE(ABORT, 'CODE_DE_TEST'); END"
    ).run()
    const err = await erreurDe(
      env.DB.prepare("INSERT INTO scratch_declencheur VALUES (1)").run()
    )
    // Format observé (vérifié empiriquement) :
    // « D1_ERROR: CODE_DE_TEST: SQLITE_CONSTRAINT », cause imbriquée
    // « CODE_DE_TEST: SQLITE_CONSTRAINT ».
    expect(estErreurDeclencheur(err, "CODE_DE_TEST")).toBe(true)
    expect(estErreurDeclencheur(err, "AUTRE_CODE")).toBe(false)
    // Un préfixe du code ne matche plus : l'ancrage exige
    // « <code>: SQLITE_CONSTRAINT » en entier.
    expect(estErreurDeclencheur(err, "CODE_DE")).toBe(false)
  })

  it("ne confond pas une violation d'unicité avec une erreur de déclencheur", async () => {
    await env.DB.prepare(
      "CREATE TABLE scratch_unicite (id integer PRIMARY KEY)"
    ).run()
    await env.DB.prepare("INSERT INTO scratch_unicite VALUES (1)").run()
    const err = await erreurDe(
      env.DB.prepare("INSERT INTO scratch_unicite VALUES (1)").run()
    )
    expect(estViolationUnicite(err)).toBe(true)
    expect(estErreurDeclencheur(err, "RECEPTION_VALIDEE")).toBe(false)
  })
})
