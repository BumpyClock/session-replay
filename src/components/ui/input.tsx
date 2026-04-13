import { forwardRef, type InputHTMLAttributes } from 'react'

import { cn } from './utils'

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn('input', className)} {...props} />
})

export { Input }
