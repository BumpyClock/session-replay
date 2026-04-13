import { type ButtonHTMLAttributes } from 'react'

import { cn } from './utils'

type Variant = 'default' | 'outline' | 'ghost' | 'subtle'
type Size = 'xs' | 'sm' | 'md'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  asChild?: boolean
}

const variantClassMap: Record<Variant, string> = {
  default:
    'button button--default',
  outline:
    'button button--outline',
  ghost:
    'button button--ghost',
  subtle:
    'button button--subtle',
}

const sizeClassMap: Record<Size, string> = {
  xs: 'button--xs',
  sm: 'button--sm',
  md: 'button--md',
}

function Button({
  type = 'button',
  variant = 'default',
  size = 'md',
  className,
  asChild = false,
  ...props
}: ButtonProps) {
  if (asChild) {
    return (
      <button
        type={type}
        className={cn(variantClassMap[variant], sizeClassMap[size], className)}
        {...props}
      />
    )
  }

  return (
    <button
      type={type}
      className={cn(variantClassMap[variant], sizeClassMap[size], className)}
      {...props}
    />
  )
}

export { Button }
export type { ButtonProps }
