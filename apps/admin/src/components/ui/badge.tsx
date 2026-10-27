import type { HTMLAttributes } from 'react'
import { cn } from 'cn'

type BadgeTone = 'neutral' | 'blue' | 'green' | 'orange' | 'danger'

export function Badge({ className, tone = 'neutral', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
	return <span className={cn('status-badge', `status-badge-${tone}`, className)} {...props} />
}
