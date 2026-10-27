'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
	BarChart3,
	Bell,
	ChevronRight,
	ClipboardList,
	Image,
	LayoutGrid,
	Monitor,
	Moon,
	MoreHorizontal,
	Plus,
	Settings,
	Store,
	Sun,
	UsersRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from 'cn'

const navItems = [
	{ label: 'Обзор', icon: LayoutGrid, value: 'overview' },
	{ label: 'Сотрудники', icon: UsersRound, value: 'employees' },
	{ label: 'Магазины', icon: Store, value: 'stores' },
	{ label: 'Тесты', icon: ClipboardList, value: 'quizzes' },
	{ label: 'Результаты', icon: BarChart3, value: 'results' },
	{ label: 'Фотографии', icon: Image, value: 'photos' },
]

export function ThemeSwitcher() {
	const { theme, setTheme } = useTheme()
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])
	return (
		<div className="theme-switcher" aria-label="Тема интерфейса">
			{[
				{ value: 'light', label: 'Светлая', icon: Sun },
				{ value: 'dark', label: 'Тёмная', icon: Moon },
				{ value: 'system', label: 'Системная', icon: Monitor },
			].map(({ value, label, icon: Icon }) => (
				<button key={value} type="button" aria-label={label} className={cn('theme-choice', mounted && theme === value && 'theme-choice-active')} onClick={() => setTheme(value)}>
					<Icon size={15} />
				</button>
			))}
		</div>
	)
}

function AccountMenu() {
	const [open, setOpen] = useState(false)
	return (
		<div className="account-menu-wrap">
			<button type="button" className="account-row" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
				<span className="account-avatar">АК</span>
				<span className="account-copy"><strong>Администратор</strong><small>admin@vizaje.ru</small></span>
				<ChevronRight size={15} className={cn('account-chevron', open && 'account-chevron-open')} />
			</button>
			{open && <div className="account-popover"><button type="button" onClick={() => toast.info('Профиль будет доступен в следующем обновлении')}>Профиль</button><button type="button" onClick={() => toast.info('Выход будет подключён вместе с авторизацией')}>Выйти</button></div>}
		</div>
	)
}

export function AdminShell({ children }: { children: ReactNode }) {
	const pathname = usePathname()
	const isOverview = pathname === '/' || pathname === '/design-system'

	return (
		<div className="admin-shell">
			<aside className="sidebar">
				<div className="sidebar-brand"><span className="brand-mark">V</span><span>vizaje <em>staff</em></span></div>
				<nav className="sidebar-nav" aria-label="Основная навигация">
					<p className="sidebar-label">Рабочая область</p>
					{navItems.map(({ label, icon: Icon, value }) => {
						const active = value === 'overview' && isOverview
						return <button key={value} type="button" className={cn('nav-item', active && 'nav-item-active')} onClick={() => {
							if (!active) toast.info(`${label}: раздел будет доступен после подключения API`)
						}}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{active && <span className="nav-active-dot" />}</button>
					})}
				</nav>
				<div className="sidebar-bottom">
					<button type="button" className="nav-item" onClick={() => toast.info('Настройки будут доступны позже')}><Settings size={17} strokeWidth={1.8} /><span>Настройки</span></button>
					<div className="sidebar-rule" />
					<AccountMenu />
				</div>
			</aside>
			<main className="app-main">
				<div className="topbar"><div className="topbar-spacer" /><div className="topbar-actions"><button type="button" className="icon-button" aria-label="Уведомления" onClick={() => toast.info('Новых уведомлений нет')}><Bell size={17} /></button><ThemeSwitcher /><Button size="sm" onClick={() => toast.success('Форма добавления сотрудника будет подключена позже')}><Plus size={15} />Добавить сотрудника</Button><button type="button" className="icon-button" aria-label="Дополнительные действия" onClick={() => toast.info('Сейчас доступен только демонстрационный режим')}><MoreHorizontal size={18} /></button></div></div>
				<div className="page-container">{children}</div>
			</main>
		</div>
	)
}
