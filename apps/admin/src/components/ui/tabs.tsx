'use client'

import { useState, type ReactNode } from 'react'
import { cn } from 'cn'

type Tab = { value: string; label: string; content: ReactNode }

export function Tabs({ tabs, defaultValue }: { tabs: Tab[]; defaultValue?: string }) {
	const [active, setActive] = useState(defaultValue ?? tabs[0]?.value ?? '')
	const selected = tabs.find((tab) => tab.value === active) ?? tabs[0]
	return <div><div className="tab-list" role="tablist">{tabs.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={tab.value === active} className={cn('tab-trigger', tab.value === active && 'tab-trigger-active')} onClick={() => setActive(tab.value)}>{tab.label}</button>)}</div><div className="tab-panel">{selected?.content}</div></div>
}
