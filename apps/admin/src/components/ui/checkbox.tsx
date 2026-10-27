'use client'

import type { InputHTMLAttributes } from 'react'
import { cn } from 'cn'

export function Checkbox({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
	return <input type="checkbox" className={cn('checkbox-control', className)} {...props} />
}
