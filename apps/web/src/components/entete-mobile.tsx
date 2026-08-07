import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Compact bar shown below the `lg` tier, where the sidebar is a drawer. */
export function EnteteMobile({ onOuvrir }: { onOuvrir: () => void }) {
  return (
    <header className="flex items-center gap-2 border-b bg-sidebar px-3 py-2 text-sidebar-foreground lg:hidden print:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Ouvrir le menu"
        onClick={onOuvrir}
      >
        <Menu />
      </Button>
      <span className="font-semibold">pos-stocks</span>
    </header>
  )
}
