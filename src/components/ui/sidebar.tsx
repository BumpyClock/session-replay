import {
  createContext,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useState,
} from 'react'

import { cn } from './utils'

type SidebarContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

type SidebarProviderProps = {
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function SidebarProvider({
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
}: SidebarProviderProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen)
    }

    onOpenChange?.(nextOpen)
  }

  const value = {
    open,
    setOpen,
    toggle: () => setOpen(!open),
  }

  return (
    <SidebarContext.Provider value={value}>
      <div className={cn('sidebar-provider', open ? 'is-open' : '')} data-state={open ? 'open' : 'closed'}>
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function useSidebar() {
  const context = useContext(SidebarContext)

  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }

  return context
}

type SidebarProps = HTMLAttributes<HTMLElement> & {
  collapsible?: 'offcanvas' | 'none'
}

function Sidebar({
  className,
  children,
  collapsible = 'offcanvas',
  ...props
}: SidebarProps) {
  const { open, setOpen } = useSidebar()

  return (
    <>
      {collapsible === 'offcanvas' ? (
        <button
          aria-hidden={!open}
          aria-label="Close session sidebar"
          className={cn('sidebar-overlay', open ? 'is-visible' : '')}
          onClick={() => setOpen(false)}
          tabIndex={open ? 0 : -1}
          type="button"
        />
      ) : null}
      <aside
        className={cn('sidebar', className)}
        data-collapsible={collapsible}
        data-open={open ? 'true' : 'false'}
        data-state={open ? 'expanded' : 'collapsed'}
        {...props}
      >
        {children}
      </aside>
    </>
  )
}

function SidebarInset({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('sidebar-inset', className)} {...props} />
}

function SidebarHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('sidebar-header', className)} {...props} />
}

function SidebarContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('sidebar-content', className)} {...props} />
}

function SidebarFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('sidebar-footer', className)} {...props} />
}

function SidebarGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={cn('sidebar-group', className)} {...props} />
}

function SidebarGroupLabel({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('sidebar-group-label', className)} {...props} />
}

function SidebarGroupContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('sidebar-group-content', className)} {...props} />
}

function SidebarMenu({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn('sidebar-menu', className)} {...props} />
}

function SidebarMenuItem({ className, ...props }: HTMLAttributes<HTMLLIElement>) {
  return <li className={cn('sidebar-menu-item', className)} {...props} />
}

type SidebarMenuButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isActive?: boolean
}

function SidebarMenuButton({
  className,
  isActive = false,
  type = 'button',
  ...props
}: SidebarMenuButtonProps) {
  return (
    <button
      type={type}
      className={cn('sidebar-menu-button', isActive ? 'is-active' : '', className)}
      {...props}
    />
  )
}

function SidebarTrigger({
  className,
  type = 'button',
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { toggle } = useSidebar()

  return (
    <button
      type={type}
      className={cn('sidebar-trigger', className)}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          toggle()
        }
      }}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
}
