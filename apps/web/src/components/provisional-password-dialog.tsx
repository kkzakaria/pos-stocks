import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Props = { password: string; email: string; onClose: () => void }

/**
 * Non-dismissible dialog showing the provisional password of a newly created
 * account; offers clipboard copy (with a fallback when it fails outside HTTPS),
 * the password never being shown again afterwards.
 */
export function ProvisionalPasswordDialog({ password, email, onClose }: Props) {
  const [copie, setCopie] = useState<"copié" | "échec" | null>(null)

  async function copier() {
    try {
      // navigator.clipboard peut être absent hors HTTPS : le TypeError tombe dans le catch
      await navigator.clipboard.writeText(password)
      setCopie("copié")
    } catch {
      setCopie("échec")
    }
  }

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Compte créé</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Transmettez ce mot de passe provisoire à <strong>{email}</strong>. Il
          ne sera plus jamais affiché ; l'employé devra le changer à sa première
          connexion.
        </p>
        <p className="my-2 rounded-md bg-muted px-4 py-3 text-center font-mono text-lg tracking-widest select-all">
          {password}
        </p>
        {copie && (
          <p
            role="status"
            className={`text-center text-sm font-medium ${
              copie === "copié" ? "text-success" : "text-destructive"
            }`}
          >
            {copie === "copié"
              ? "Copié !"
              : "Échec de la copie — notez le mot de passe manuellement."}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => void copier()}>
            Copier
          </Button>
          <Button onClick={onClose}>J'ai transmis le mot de passe</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
