import * as DialogPrimitive from '@radix-ui/react-dialog'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'

import { cn } from './utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return <DialogPrimitive.Overlay ref={ref} className={cn('dialog-overlay', className)} {...props} />
})

const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function DialogContent({ className, children, ...props }, ref) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content ref={ref} className={cn('dialog-content', className)} {...props}>
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})

const DialogHeader = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function DialogHeader(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('dialog-header', className)} {...props} />
})

const DialogFooter = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function DialogFooter(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('dialog-footer', className)} {...props} />
})

const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return <DialogPrimitive.Title ref={ref} className={cn('dialog-title', className)} {...props} />
})

const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description ref={ref} className={cn('dialog-description', className)} {...props} />
  )
})

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
