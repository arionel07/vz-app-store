'use client'

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from 'cn'
import { Button } from './button'
import { dialogFocusWrapTarget } from './dialog-focus'

const focusableSelector = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"])'

export function Dialog({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }) {
	const panelRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return

		const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
		const firstFocusable = panelRef.current?.querySelector<HTMLElement>(focusableSelector)
		firstFocusable?.focus()

		return () => {
			if (previousFocus?.isConnected) previousFocus.focus()
		}
	}, [open])

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (event.key === 'Escape') {
			event.preventDefault()
			onClose()
			return
		}
		if (event.key !== 'Tab') return

		const panel = panelRef.current
		if (!panel) return
		const focusable = [...panel.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0)
		const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
		const wrapTarget = dialogFocusWrapTarget(activeIndex, focusable.length, event.shiftKey)
		if (wrapTarget === 'panel') {
			event.preventDefault()
			panel.focus()
			return
		}
		if (wrapTarget === 'last') {
			event.preventDefault()
			focusable.at(-1)?.focus()
		} else if (wrapTarget === 'first') {
			event.preventDefault()
			focusable[0]?.focus()
		}
	}

	if (!open) return null
	return (
		<div className="dialog-layer" role="dialog" aria-modal="true" aria-label={title} onKeyDown={handleKeyDown} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
			<div ref={panelRef} className={cn('dialog-panel', className)} tabIndex={-1}>
				<div className="dialog-header"><h2 className="panel-title">{title}</h2><Button variant="ghost" size="icon-sm" aria-label="Закрыть" onClick={onClose}><X /></Button></div>
				<div className="dialog-body">{children}</div>
			</div>
		</div>
	)
}
