import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from 'cn'

export function Tooltip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
	return <span className={cn('tooltip-wrap', className)} title={label}>{children}</span>
}
