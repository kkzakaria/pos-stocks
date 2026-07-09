import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Props = { password: string; email: string; onClose: () => void }

export function ProvisionalPasswordDialog({ password, email, onClose }: Props) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Compte créé</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600">
          Transmettez ce mot de passe provisoire à <strong>{email}</strong>. Il
          ne sera plus jamais affiché ; l'employé devra le changer à sa première
          connexion.
        </p>
        <p className="my-2 rounded-md bg-gray-100 px-4 py-3 text-center font-mono text-lg tracking-widest select-all">
          {password}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(password)
            }}
          >
            Copier
          </Button>
          <Button onClick={onClose}>J'ai transmis le mot de passe</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
