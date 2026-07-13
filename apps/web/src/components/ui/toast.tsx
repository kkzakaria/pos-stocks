"use client"

import type { ReactNode } from "react"
import { Toast } from "@base-ui/react/toast"
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react"

import { cn } from "@/lib/utils"

/** Manager impératif : `toast.success(...)` déclenche depuis n'importe où. */
export const toastManager = Toast.createToastManager()

type Options = { description?: ReactNode }

function emettre(
  type: string | undefined,
  title: ReactNode,
  options?: Options
) {
  return toastManager.add({ title, description: options?.description, type })
}

export const toast = {
  success: (title: ReactNode, options?: Options) =>
    emettre("success", title, options),
  error: (title: ReactNode, options?: Options) =>
    emettre("error", title, options),
  message: (title: ReactNode, options?: Options) =>
    emettre(undefined, title, options),
}

const ICONE: Record<string, { Icon: typeof Info; classe: string }> = {
  success: { Icon: CheckCircle2, classe: "text-success" },
  error: { Icon: AlertCircle, classe: "text-destructive" },
}

function ListeToasts() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((t) => {
    const meta = t.type ? ICONE[t.type] : undefined
    const Icone = meta?.Icon ?? Info
    return (
      <Toast.Root
        key={t.id}
        toast={t}
        // Profondeur par filet (règle du DS), jamais d'ombre.
        className="flex items-start gap-2 rounded-lg bg-popover p-3 text-popover-foreground ring-1 ring-foreground/10 transition-all data-[ending-style]:[transform:translateY(0.5rem)] data-[ending-style]:opacity-0 data-[starting-style]:[transform:translateY(0.5rem)] data-[starting-style]:opacity-0"
      >
        <Icone
          className={cn(
            "mt-px size-4 shrink-0",
            meta?.classe ?? "text-muted-foreground"
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <Toast.Title className="text-xs font-medium" />
          <Toast.Description className="text-xs text-muted-foreground empty:hidden" />
        </div>
        <Toast.Close
          aria-label="Fermer"
          className="-m-1 rounded-md p-1 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <X className="size-3.5" />
        </Toast.Close>
      </Toast.Root>
    )
  })
}

/** À monter une fois près de la racine (dans `ToastProvider`). */
function Toaster() {
  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed right-4 bottom-4 z-100 flex w-80 max-w-[calc(100vw-2rem)] flex-col-reverse gap-2 outline-none">
        <ListeToasts />
      </Toast.Viewport>
    </Toast.Portal>
  )
}

/** Fournit le contexte toast + monte le viewport. Enveloppe l'app. */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider toastManager={toastManager}>
      {children}
      <Toaster />
    </Toast.Provider>
  )
}
