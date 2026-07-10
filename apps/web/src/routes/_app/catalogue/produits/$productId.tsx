import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/catalogue/produits/$productId")({
  component: () => <p>À venir</p>,
})
