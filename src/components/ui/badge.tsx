import { type HTMLAttributes } from 'react'

import { cn } from './utils'

function Badge({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <span className={cn('badge', className)} {...props} />
}

export { Badge }
