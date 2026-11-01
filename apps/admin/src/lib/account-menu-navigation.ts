export function shouldDismissAccountPopover(input: {
	key: string
	shiftKey: boolean
	focusIndex: number
	focusableCount: number
}): boolean {
	if (input.key === 'Escape') return true
	if (input.key !== 'Tab' || input.focusableCount === 0 || input.focusIndex < 0) return false
	return input.shiftKey ? input.focusIndex === 0 : input.focusIndex === input.focusableCount - 1
}
