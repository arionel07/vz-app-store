import type { InputHTMLAttributes } from 'react'
import { cn } from 'cn'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
	return <input className={cn('field-control', className)} {...props} />
}
