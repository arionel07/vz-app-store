export type DialogFocusWrapTarget = 'first' | 'last' | 'panel' | null

export function dialogFocusWrapTarget(activeIndex: number, focusableCount: number, shiftKey: boolean): DialogFocusWrapTarget {
	if (focusableCount === 0) return 'panel'
	if (shiftKey && activeIndex <= 0) return 'last'
	if (!shiftKey && (activeIndex === -1 || activeIndex === focusableCount - 1)) return 'first'
	return null
}
