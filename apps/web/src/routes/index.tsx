import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: () => (
    <main className="grid min-h-screen place-items-center">
      <h1 className="text-2xl font-semibold">pos-stocks</h1>
    </main>
  ),
})
