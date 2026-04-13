import { type HTMLAttributes } from 'react'

import { cn } from './utils'

function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <article className={cn('card', className)} {...props} />
}

function CardHeader({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <header className={cn('card__header', className)} {...props} />
}

function CardTitle({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <h3 className={cn('card__title', className)} {...props} />
}

function CardContent({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <div className={cn('card__content', className)} {...props} />
}

function CardFooter({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <footer className={cn('card__footer', className)} {...props} />
}

export { Card, CardContent, CardFooter, CardHeader, CardTitle }
