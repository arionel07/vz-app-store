'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from 'cn'
import { Button } from './button'

export function Dialog({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }) {
	if (!open) return null
	return (
		<div className="dialog-layer" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
			<div className={cn('dialog-panel', className)}>
				<div className="dialog-header"><h2 className="panel-title">{title}</h2><Button variant="ghost" size="icon-sm" aria-label="Закрыть" onClick={onClose}><X /></Button></div>
				<div className="dialog-body">{children}</div>
			</div>
		</div>
	)
}
