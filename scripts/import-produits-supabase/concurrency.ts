export async function executerAvecConcurrence<T>(
  items: T[],
  limite: number,
  tache: (item: T, index: number) => Promise<void>
): Promise<void> {
  let curseur = 0

  async function travailleur(): Promise<void> {
    while (curseur < items.length) {
      const index = curseur
      curseur += 1
      const item = items[index]
      await tache(item, index)
    }
  }

  const nbTravailleurs = Math.min(limite, items.length)
  const travailleurs = Array.from({ length: nbTravailleurs }, () =>
    travailleur()
  )
  await Promise.all(travailleurs)
}
