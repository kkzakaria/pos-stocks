import { apiUrl } from "@/lib/api"
import { formaterMontant } from "@/lib/format"
import type { ArticlePos } from "@/lib/pos"

type Props = {
  articles: ArticlePos[]
  onChoisir: (article: ArticlePos) => void
}

// Grille de tuiles produits (spec §7) : image, nom, prix, badge rupture ;
// tuiles ≥ 88 px, utilisables au doigt.
/** POS product tile grid: image (or initials), name, price, and "Rupture" badge, each tile adding the item to the cart on click. */
export function GrilleArticles({ articles, onChoisir }: Props) {
  if (articles.length === 0) {
    return <p className="p-6 text-muted-foreground">Aucun article.</p>
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2 p-2">
      {articles.map((article) => (
        <button
          key={article.variantId}
          onClick={() => onChoisir(article)}
          className="relative flex min-h-[88px] flex-col items-stretch justify-between rounded-lg bg-card p-2 text-left ring-1 ring-foreground/10 transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95"
        >
          {article.imageKey ? (
            <img
              src={apiUrl(`/api/v1/files/${article.imageKey}`)}
              alt=""
              // Grille potentiellement longue : le navigateur charge les tuiles
              // proches du viewport et diffère le reste (matériel modeste,
              // connexions variables — cf. PRODUCT.md). Décodage hors du thread
              // principal. La taille est déjà réservée (h-14), donc pas de CLS.
              loading="lazy"
              decoding="async"
              className="mb-1 h-14 w-full rounded object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="mb-1 grid h-14 w-full place-items-center rounded bg-muted text-lg font-semibold text-muted-foreground"
            >
              {article.nom.slice(0, 2).toUpperCase()}
            </div>
          )}
          <span className="line-clamp-2 text-xs font-medium">
            {article.nom}
          </span>
          <span className="text-sm font-semibold">
            {formaterMontant(article.price)}
          </span>
          {article.quantity <= 0 && (
            <span className="absolute top-1 right-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
              Rupture
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
