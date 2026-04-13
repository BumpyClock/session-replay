import { type InputHTMLAttributes } from 'react'

import { cn } from './utils'

function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input', className)} {...props} />
}

export { Input }
