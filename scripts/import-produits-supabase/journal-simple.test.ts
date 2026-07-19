import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { chargerJson, ecrireJsonAtomique } from "./journal-simple"

test("chargerJson renvoie le défaut si absent, relit après écriture", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jrnl-"))
  const f = path.join(dir, "j.json")
  expect(chargerJson<{ a: number; b?: number[] }>(f, { a: 1 })).toEqual({
    a: 1,
  })
  ecrireJsonAtomique(f, { a: 2, b: [3] })
  expect(chargerJson<{ a: number; b?: number[] }>(f, { a: 1 })).toEqual({
    a: 2,
    b: [3],
  })
})
