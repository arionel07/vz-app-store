import type { HTMLAttributes } from 'react'
import { cn } from 'cn'

export function Separator({ orientation = 'horizontal', className, ...props }: HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical' }) {
	return <div role="separator" className={cn(orientation === 'horizontal' ? 'separator-horizontal' : 'separator-vertical', className)} {...props} />
}
