"use client"

import { XIcon } from "lucide-react"
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Drawer({ ...props }: DrawerPrimitive.Root.Props) {
  // swipeDirection only drives the dismiss gesture — anchoring is pure CSS
  // on the popup below. Keep the two consistent.
  return (
    <DrawerPrimitive.Root data-slot="drawer" swipeDirection="left" {...props} />
  )
}

function DrawerTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({ ...props }: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 duration-100 print:hidden data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DrawerViewport({ ...props }: DrawerPrimitive.Viewport.Props) {
  return <DrawerPrimitive.Viewport data-slot="drawer-viewport" {...props} />
}

function DrawerContent({
  className,
  children,
  ...props
}: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerViewport>
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            // Portalled onto <body>: it escapes any ancestor `print:hidden`,
            // hence its own. Anchoring is written here because base-ui exposes
            // no side/anchor prop.
            "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-2 overflow-y-auto overscroll-contain border-r bg-sidebar p-4 text-sidebar-foreground duration-100 outline-none print:hidden data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left",
            className
          )}
          {...props}
        >
          {children}
          <DrawerPrimitive.Close
            data-slot="drawer-close"
            // `icon` and not `icon-sm`: only `icon` carries
            // `pointer-coarse:size-11`, and this button is touch-first.
            render={
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Fermer</span>
          </DrawerPrimitive.Close>
        </DrawerPrimitive.Popup>
      </DrawerViewport>
    </DrawerPortal>
  )
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-base font-semibold", className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
}
