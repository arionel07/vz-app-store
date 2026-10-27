import type { HTMLAttributes } from 'react'
import { cn } from 'cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <section className={cn('surface-panel', className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn('panel-header', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
	return <h2 className={cn('panel-title', className)} {...props} />
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
	return <p className={cn('panel-description', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn('panel-content', className)} {...props} />
}
