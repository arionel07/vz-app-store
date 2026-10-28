'use client'

import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
	BarChart3,
	Bell,
	ChevronRight,
	ClipboardList,
	Image,
	Leaf,
	LayoutGrid,
	Monitor,
	Moon,
	MoreHorizontal,
	Plus,
	Search,
	Settings,
	Store,
	Sun,
	UsersRound,
	LoaderCircle,
} from 'lucide-react'
import { cn } from 'cn'
import { getBrowserCsrfToken } from '@/lib/auth-client'
import { useSessionUser } from '@/components/session-provider'

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

const roleLabels = {
	admin: 'Администратор',
	manager: 'Менеджер',
	staff: 'Сотрудник',
} as const

function userInitials(firstName: string, lastName: string): string {
	return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase()
}

function AccountMenu() {
	const user = useSessionUser()
	const router = useRouter()
	const [open, setOpen] = useState(false)
	const [isLoggingOut, setIsLoggingOut] = useState(false)

	async function handleLogout() {
		setIsLoggingOut(true)
		try {
			const csrfToken = getBrowserCsrfToken()
			const response = await fetch('/api/auth/logout', {
				method: 'POST',
				credentials: 'same-origin',
				headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : undefined,
			})
			if (!response.ok && response.status !== 401) {
				toast.error('Не удалось завершить сеанс')
				return
			}
			router.replace('/login')
			router.refresh()
		} catch {
			toast.error('Сервис авторизации временно недоступен')
		} finally {
			setIsLoggingOut(false)
		}
	}

	return (
		<div className="account-menu-wrap">
			<button type="button" className="account-row" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
				<span className="account-avatar">{userInitials(user.firstName, user.lastName)}</span>
				<span className="account-copy"><strong>{user.firstName} {user.lastName}</strong><small>{user.email ?? roleLabels[user.role]}</small></span>
				<ChevronRight size={15} className={cn('account-chevron', open && 'account-chevron-open')} />
			</button>
			{open && <div className="account-popover"><div className="px-2 py-2 text-xs text-muted-foreground"><strong className="block text-foreground">{roleLabels[user.role]}</strong><span>{user.email ?? 'Email не указан'}</span></div><div className="account-theme"><span>Тема</span><ThemeSwitcher /></div><button type="button" disabled={isLoggingOut} onClick={handleLogout}>{isLoggingOut && <LoaderCircle size={14} className="mr-2 inline animate-spin" />}Выйти</button></div>}
		</div>
	)
}

export function AdminShell({ children }: { children: ReactNode }) {
	const pathname = usePathname()
	const isOverview = pathname === '/' || pathname === '/design-system'
	const router = useRouter()

	return (
		<div className="admin-shell">
			<aside className="sidebar">
				<div className="sidebar-brand"><Leaf size={17} strokeWidth={2.2} /><strong>Vizaje</strong><ChevronRight size={14} className="brand-chevron" /><button type="button" className="sidebar-search" aria-label="Поиск" onClick={() => toast.info('Поиск откроется по сочетанию ⌘ K')}><Search size={15} /></button><button type="button" className="sidebar-compose" aria-label="Создать" onClick={() => toast.info('Создание доступно в разделах «Сотрудники» и «Магазины»')}><Plus size={15} /></button></div>
				<nav className="sidebar-nav" aria-label="Основная навигация">
					<p className="sidebar-label">Рабочая область</p>
					{navItems.map(({ label, icon: Icon, value }) => {
						const path = value === 'overview' ? '/' : `/${value}`
						const active = value === 'overview' ? isOverview : pathname.startsWith(path)
						const implemented = value === 'overview' || value === 'employees' || value === 'stores' || value === 'quizzes' || value === 'results' || value === 'photos'
						return <button key={value} type="button" className={cn('nav-item', active && 'nav-item-active')} onClick={() => {
							if (implemented) router.push(path)
							else toast.info(`${label}: раздел будет доступен позже`)
						}}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{active && <span className="nav-active-dot" />}</button>
					})}
				</nav>
				<div className="sidebar-bottom">
					<button type="button" className="nav-item" onClick={() => toast.info('Настройки будут доступны позже')}><Settings size={17} strokeWidth={1.8} /><span>Настройки</span></button>
					<div className="sidebar-rule" />
					<p className="sidebar-footnote">API подключён</p>
				</div>
			</aside>
			<main className="app-main">
				<div className="topbar"><div className="global-search"><Search size={15} /><span>Поиск сотрудников, магазинов, тестов...</span><kbd>⌘ K</kbd></div><div className="topbar-actions"><button type="button" className="icon-button notification-button" aria-label="Уведомления" onClick={() => toast.info('Новых уведомлений нет')}><Bell size={16} /><i className="notification-dot" /></button><AccountMenu /><button type="button" className="icon-button" aria-label="Дополнительные действия" onClick={() => toast.info('Сейчас доступен только демонстрационный режим')}><MoreHorizontal size={18} /></button></div></div>
				<div className="page-container">{children}</div>
			</main>
		</div>
	)
}
