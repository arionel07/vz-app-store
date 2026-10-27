'use client'

import type { InputHTMLAttributes } from 'react'
import { cn } from 'cn'

export function Switch({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
	return (
		<label className={cn('switch-control', className)}>
			<input type="checkbox" {...props} />
			<span aria-hidden="true" />
		</label>
	)
}
